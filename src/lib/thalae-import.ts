// Glue between the generic ImportPanel UI, the extraction pipeline, and the
// mutation/persistence layer — one orchestration function per entity type,
// mirroring Thalae's ImportSupplierPanel/ImportPanel processFiles logic.

import {
  extractPdfText,
  parseCsvOrders,
  parseOrderBasic,
  parseOrderWithClaude,
  parsePaymentTermsText,
  parseSupplierBasic,
  parseSupplierWithClaude,
} from "@/lib/thalae-extract";
import { saveOrder, saveSupplier } from "@/lib/thalae-mutations";
import type { OrdersTable, PartyTable } from "@/lib/thalae-mutations";
import { getSettings } from "@/lib/settings";
import type { RawOrder, RawSupplier } from "@/lib/thalae-types";

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
const tod = () => new Date().toISOString().slice(0, 10);

async function readFileText(file: File): Promise<string> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  return isPdf ? await extractPdfText(file) : await file.text();
}

export async function importSupplierFile(
  file: File,
  table: PartyTable = "suppliers",
): Promise<string> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    throw new Error("L'import CSV est réservé aux commandes, pas aux fiches.");
  }
  const text = await readFileText(file);
  const apiKey = getSettings().apiKey;
  let parsed;
  if (apiKey) {
    try {
      parsed = await parseSupplierWithClaude(apiKey, text);
    } catch (apiErr) {
      console.warn("Claude API:", apiErr);
      parsed = parseSupplierBasic(text);
    }
  } else {
    parsed = parseSupplierBasic(text);
  }
  const conditions = parsePaymentTermsText(parsed.conditionsPaiementText || "");
  const supplier: RawSupplier = {
    id: uid(),
    nom: parsed.nom || "",
    pays: parsed.pays || "",
    adresse: parsed.adresse || "",
    email: parsed.email || "",
    telephone: parsed.telephone || "",
    devise: parsed.devise || "EUR",
    incoterms: parsed.incoterms || "",
    conditionsPaiementText: parsed.conditionsPaiementText || "",
    conditionsPaiement: conditions,
    notes: [
      parsed.coordonneesBancaires ? "Banque: " + parsed.coordonneesBancaires : "",
      parsed.notes || "",
    ]
      .filter(Boolean)
      .join(" | "),
  };
  await saveSupplier(supplier, table);
  return supplier.nom || file.name;
}

// Deviation from Thalae, documented in the migration plan: Thalae's own import
// pipeline builds the legacy documents[]/milestones[] shape, which 0 real orders
// actually use — everything real lives in docFlow. This builds docFlow.proforma
// instead, so an imported order is immediately visible/editable like any other.
export async function importOrderFile(file: File, table: OrdersTable = "orders"): Promise<string> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = await file.text();
    const rows = parseCsvOrders(text);
    if (!rows.length) throw new Error("Aucune ligne trouvée dans le CSV.");
    for (const row of rows) {
      const order: RawOrder = {
        id: uid(),
        createdAt: tod(),
        reference: row.reference,
        fournisseur: row.fournisseur,
        fournisseurId: "",
        produit: row.produit,
        montant: row.montant,
        devise: row.devise,
        dateCommande: row.dateCommande,
        dateLivraison: row.dateLivraison,
        incoterms: row.incoterms,
        notes: row.notes,
        quantite: row.quantite,
        nop: row.nop,
        progressProduction: row.progressProduction,
        progressLivraison: row.progressLivraison,
        attachments: [],
        documents: [],
      };
      await saveOrder(order, table);
    }
    return `${rows.length} commande(s) depuis ${file.name}`;
  }

  const text = await readFileText(file);
  const apiKey = getSettings().apiKey;
  let parsed;
  if (apiKey) {
    try {
      parsed = await parseOrderWithClaude(apiKey, text);
    } catch (apiErr) {
      console.warn("Claude API:", apiErr);
      parsed = parseOrderBasic(text);
    }
  } else {
    parsed = parseOrderBasic(text);
  }
  const order: RawOrder = {
    id: uid(),
    createdAt: tod(),
    reference: parsed.reference,
    fournisseur: parsed.fournisseur,
    fournisseurId: "",
    produit: parsed.produit,
    montant: parsed.montant,
    devise: parsed.devise,
    dateCommande: parsed.dateCommande,
    dateLivraison: parsed.dateLivraison,
    incoterms: parsed.incoterms,
    notes: parsed.notes,
    attachments: [],
    documents: [],
    ...(parsed.montant > 0
      ? { docFlow: { proforma: { pdf: null, montant: parsed.montant, paiements: [] } } }
      : {}),
  };
  await saveOrder(order, table);
  return order.reference || file.name;
}

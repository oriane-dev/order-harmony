// Supplier order-list CSV import: recognises the PO export (one row = one order) and
// upserts each order by reference (Docket), so re-importing the reference file updates
// existing orders instead of creating duplicates. Documents/payments already attached
// to an order (its docFlow) are preserved — only the order header fields are refreshed.

import { parseCsvOrders } from "@/lib/csv-orders";
import { saveOrder, type OrdersTable } from "@/lib/thalae-mutations";
import type { RawOrder } from "@/lib/thalae-types";

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
const tod = () => new Date().toISOString().slice(0, 10);

export interface OrderCsvReport {
  created: number;
  updated: number;
  skipped: number;
  total: number;
}

export async function runSupplierCsvImport(
  text: string,
  existing: RawOrder[],
  table: OrdersTable = "orders",
): Promise<OrderCsvReport> {
  const rows = parseCsvOrders(text);
  const byRef = new Map<string, RawOrder>();
  for (const o of existing) {
    const r = (o.reference ?? "").trim();
    if (r) byRef.set(r, o);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const ref = row.reference.trim();
    if (!ref) {
      skipped += 1;
      continue;
    }
    const prev = byRef.get(ref);
    const order: RawOrder = prev
      ? {
          // keep docFlow, comments, attachments, cloture, id… refresh header fields
          ...prev,
          fournisseur: row.fournisseur || prev.fournisseur,
          montant: row.montant || prev.montant,
          devise: row.devise || prev.devise || "EUR",
          dateLivraison: row.dateLivraison || prev.dateLivraison,
          notes: row.notes || prev.notes,
          quantite: row.quantite || prev.quantite,
          nop: row.nop,
          progressProduction: row.progressProduction,
          progressLivraison: row.progressLivraison,
        }
      : {
          id: uid(),
          createdAt: tod(),
          reference: ref,
          fournisseur: row.fournisseur,
          fournisseurId: "",
          produit: row.produit,
          montant: row.montant,
          devise: row.devise || "EUR",
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
    byRef.set(ref, order);
    if (prev) updated += 1;
    else created += 1;
  }
  return { created, updated, skipped, total: rows.length };
}

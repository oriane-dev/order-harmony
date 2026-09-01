// Adapts raw Thalae Supabase rows (jsonb "data" blobs) into the Order/Party shape
// the Ledger UI components already render. See PROMPT.md and the migration plan for
// the real-data audit this derivation logic is grounded in.

import type {
  Alert,
  Currency,
  DocRef,
  Order,
  Party,
  ShipmentStatus,
  TimelineEvent,
} from "@/lib/ledger-types";
import type { RawFacture, RawOrder, RawPackingList, RawPdf } from "@/lib/thalae-types";
import { seasonOf } from "@/lib/season";

// Saisons "en cours" : un paiement de livraison sans facture y est normal (acompte
// versé avant expédition, facture pas encore émise) — on ne le signale donc PAS en
// erreur. Pour les saisons plus anciennes, ce cas est une anomalie de saisie.
const CURRENT_SEASONS = new Set(["AW26", "PS27", "SS27"]);

export type { RawOrder, RawSupplier } from "@/lib/thalae-types";

function num(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}

function hasPdf(p: RawPdf | null | undefined): boolean {
  return Boolean(p && (p.url || p.id));
}

// Total of the credit notes (avoirs) attached to an invoice — a positive amount that
// is subtracted from the invoice's own amount to get the net invoiced value.
function creditsOf(item: { creditNotes?: { montant?: number }[] } | undefined): number {
  return (item?.creditNotes ?? []).reduce((a, c) => a + num(c.montant), 0);
}

function toCurrency(v: string | undefined): Currency {
  return v === "USD" || v === "GBP" || v === "CNY" ? v : "EUR";
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

export function synthesizeParty(name: string | undefined): Party {
  const clean = (name ?? "").trim() || "Fournisseur inconnu";
  return { id: `sup-${slugify(clean)}`, name: clean };
}

// One packing list's invoice-like entries: prefer factures[] when populated,
// else fall back to the legacy flat fields (facturePdf/factureAmount/factureMontantBrut).
function packingListInvoices(pl: RawPackingList): RawFacture[] {
  if (pl.factures && pl.factures.length > 0) return pl.factures;
  if (pl.facturePdf || pl.factureAmount || pl.factureMontantBrut) {
    return [
      {
        id: `${pl.id}_flat`,
        pdf: pl.facturePdf,
        montant: pl.factureAmount,
        montantBrut: pl.factureMontantBrut,
      },
    ];
  }
  return [];
}

function edgeSet(pairs: [string, string][]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    if (!m.has(a)) m.set(a, new Set());
    if (!m.has(b)) m.set(b, new Set());
    m.get(a)!.add(b);
    m.get(b)!.add(a);
  }
  return m;
}

export function rawOrderToLedgerOrder(
  row: RawOrder,
  supplierIndex: Map<string, Party>,
  side: Order["side"] = "payable",
): Order {
  const currency = toCurrency(row.devise);
  const ordered = num(row.montant);
  const party =
    supplierIndex.get((row.fournisseur ?? "").trim()) ?? synthesizeParty(row.fournisseur);

  const docs: DocRef[] = [];
  const timeline: TimelineEvent[] = [];
  const edgePairs: [string, string][] = [];

  const poId = `${row.id}:po`;
  docs.push({
    id: poId,
    kind: "po",
    number: row.reference ?? row.id,
    date: row.dateCommande ?? row.createdAt ?? "",
    amount: ordered,
    currency,
    status: "issued",
    linkedTo: [],
  });
  if (row.dateCommande) {
    timeline.push({
      id: `t:${row.id}:po`,
      at: row.dateCommande,
      kind: "po",
      title: "Bon de commande émis",
      amount: ordered,
      currency,
      refId: poId,
    });
  }

  let invoiced = 0;
  let delivered = 0;
  let paid = 0;
  let missingInvoiceCount = 0;
  // status-ladder signals
  let hasProforma = false; // une pro forma (devis/acompte) est renseignée
  let depositPaid = false; // l'acompte (pro forma ou facture d'acompte) a un paiement
  let deliveryInvoiceCount = 0; // nb de factures rattachées à des livraisons
  let hasFactureDefinitive = false; // une facture définitive est renseignée
  let paymentWithoutInvoice = false; // une livraison a un paiement mais aucune facture
  let livraisonProformaCount = 0; // nb de « pro formas pour livraison » (before shipment)
  let anyLivraisonUnpaid = false; // au moins une pro forma pour livraison reste à payer

  const df = row.docFlow;

  if (
    df?.proforma &&
    (hasPdf(df.proforma.pdf) ||
      num(df.proforma.montant) > 0 ||
      (df.proforma.paiements?.length ?? 0) > 0 ||
      (df.proforma.depositInvoices?.length ?? 0) > 0 ||
      Boolean(df.proforma.docDate))
  ) {
    const pfId = `${row.id}:pf`;
    const pfMontant = num(df.proforma.montant);
    const pfPaid = (df.proforma.paiements ?? []).reduce((a, p) => a + num(p.montant), 0);
    // A pro forma is a quote, NOT an invoice — its amount is never counted as "facturé".
    // Only the factures added under a delivery (packing list) count toward invoiced.
    // A deposit paid against the pro forma is still real money out, so it does count as paid.
    paid += pfPaid;
    hasProforma = true;
    if (pfPaid > 0) depositPaid = true;
    docs.push({
      id: pfId,
      kind: "proforma",
      number: "Pro forma",
      date: row.dateCommande ?? "",
      amount: pfMontant,
      currency: toCurrency(df.proforma.devise) || currency,
      status: pfMontant > 0 && pfPaid >= pfMontant * 0.99 ? "paid" : "issued",
      remaining: pfMontant > 0 ? pfMontant - pfPaid : undefined,
      linkedTo: [],
    });
    edgePairs.push([poId, pfId]);
    for (const pay of df.proforma.paiements ?? []) {
      const payId = `${row.id}:pf:pay:${pay.id}`;
      docs.push({
        id: payId,
        kind: "transfer",
        number: "Virement",
        date: pay.date ?? "",
        amount: num(pay.montant),
        currency: toCurrency(pay.devise) || currency,
        status: "sent",
        linkedTo: [],
      });
      edgePairs.push([pfId, payId]);
      if (pay.date) {
        timeline.push({
          id: `t:${payId}`,
          at: pay.date,
          kind: "transfer",
          title: "Virement d'acompte envoyé",
          amount: num(pay.montant),
          currency: toCurrency(pay.devise) || currency,
          refId: payId,
        });
      }
    }

    // Deposit invoices billed against the pro forma — real invoices: their amount
    // counts as invoiced and their payments as paid (they are NOT deliveries, so
    // they don't add to `delivered`). Attached to the pro forma node in the graph.
    for (const di of df.proforma.depositInvoices ?? []) {
      const diId = `${row.id}:pf:di:${di.id}`;
      const diMontant = num(di.montant) - creditsOf(di);
      const diPaid = (di.paiements ?? []).reduce((a, p) => a + num(p.montant), 0);
      invoiced += diMontant;
      paid += diPaid;
      if (diPaid > 0) depositPaid = true;
      docs.push({
        id: diId,
        kind: "supplier_invoice",
        number: "Facture d'acompte",
        date: di.docDate ?? row.dateCommande ?? "",
        amount: diMontant,
        currency: toCurrency(di.devise) || currency,
        status:
          diMontant > 0 && diPaid >= diMontant * 0.99
            ? "paid"
            : diPaid > 0
              ? "partially_paid"
              : "issued",
        remaining: diMontant > 0 ? Math.max(0, diMontant - diPaid) : undefined,
        linkedTo: [],
      });
      edgePairs.push([pfId, diId]);
      for (const pay of di.paiements ?? []) {
        const payId = `${diId}:pay:${pay.id}`;
        docs.push({
          id: payId,
          kind: "transfer",
          number: "Virement",
          date: pay.date ?? "",
          amount: num(pay.montant),
          currency: toCurrency(pay.devise) || currency,
          status: "sent",
          linkedTo: [],
        });
        edgePairs.push([diId, payId]);
        if (pay.date) {
          timeline.push({
            id: `t:${payId}`,
            at: pay.date,
            kind: "transfer",
            title: "Encaissement d'acompte",
            amount: num(pay.montant),
            currency: toCurrency(pay.devise) || currency,
            refId: payId,
          });
        }
      }
      for (const cn of di.creditNotes ?? []) {
        const cnId = `${diId}:cn:${cn.id}`;
        docs.push({
          id: cnId,
          kind: "supplier_invoice",
          number: "Avoir",
          date: cn.date ?? cn.docDate ?? "",
          amount: -num(cn.montant),
          currency: toCurrency(cn.devise) || currency,
          status: "issued",
          linkedTo: [],
        });
        edgePairs.push([diId, cnId]);
      }
    }
  }

  for (const pl of df?.packingLists ?? []) {
    const plId = `${row.id}:pl:${pl.id}`;
    const invoices = packingListInvoices(pl);
    // net of credit notes (avoirs) attached to each invoice
    const plInvoiced = invoices.reduce(
      (a, f) => a + (num(f.montant) || num(f.montantBrut)) - creditsOf(f),
      0,
    );
    const plPaid = (pl.paiements ?? []).reduce((a, p) => a + num(p.montant), 0);
    delivered += plInvoiced;
    invoiced += plInvoiced;
    paid += plPaid;
    deliveryInvoiceCount += invoices.length;
    const hasLivraisonProforma = (pl.livraisonProformas?.length ?? 0) > 0;
    // une livraison avec une « pro forma pour livraison » mais pas encore de facture
    // est normale (paiement demandé avant expédition) → pas d'anomalie « facture manquante »
    if (invoices.length === 0 && !hasLivraisonProforma) {
      missingInvoiceCount += 1;
      // a delivery that carries a payment but no facture — the docFlow anomaly
      if (plPaid > 0) paymentWithoutInvoice = true;
    }
    // pro formas pour livraison (before shipment appelé) — leurs paiements sont réels
    for (const lp of pl.livraisonProformas ?? []) {
      const lpPaid = (lp.paiements ?? []).reduce((a, p) => a + num(p.montant), 0);
      paid += lpPaid;
      if (num(lp.montant) > 0) {
        livraisonProformaCount += 1;
        if (lpPaid < num(lp.montant) * 0.99) anyLivraisonUnpaid = true;
      }
    }

    docs.push({
      id: plId,
      kind: "delivery",
      number: "Bordereau de livraison",
      date: row.dateLivraison ?? "",
      amount: plInvoiced,
      currency,
      status: "received",
      linkedTo: [],
    });
    edgePairs.push([poId, plId]);
    if (row.dateLivraison) {
      timeline.push({
        id: `t:${plId}`,
        at: row.dateLivraison,
        kind: "delivery",
        title: "Bordereau de livraison reçu",
        amount: plInvoiced || undefined,
        currency,
        refId: plId,
      });
    }

    invoices.forEach((f, i) => {
      const fId = `${row.id}:pl:${pl.id}:inv:${f.id ?? i}`;
      const fAmount = (num(f.montant) || num(f.montantBrut)) - creditsOf(f);
      docs.push({
        id: fId,
        kind: "supplier_invoice",
        number: "Facture",
        date: row.dateLivraison ?? "",
        amount: fAmount,
        currency: toCurrency(f.devise) || currency,
        status:
          fAmount > 0 && plPaid >= fAmount * 0.99
            ? "paid"
            : plPaid > 0
              ? "partially_paid"
              : "issued",
        remaining: invoices.length === 1 && fAmount > 0 ? Math.max(0, fAmount - plPaid) : undefined,
        linkedTo: [],
      });
      edgePairs.push([plId, fId]);
      for (const cn of f.creditNotes ?? []) {
        const cnId = `${fId}:cn:${cn.id}`;
        docs.push({
          id: cnId,
          kind: "supplier_invoice",
          number: "Avoir",
          date: cn.date ?? cn.docDate ?? row.dateLivraison ?? "",
          amount: -num(cn.montant),
          currency: toCurrency(cn.devise) || currency,
          status: "issued",
          linkedTo: [],
        });
        edgePairs.push([fId, cnId]);
      }
    });

    for (const pay of pl.paiements ?? []) {
      const payId = `${row.id}:pl:${pl.id}:pay:${pay.id}`;
      docs.push({
        id: payId,
        kind: "transfer",
        number: "Virement",
        date: pay.date ?? "",
        amount: num(pay.montant),
        currency: toCurrency(pay.devise) || currency,
        status: "sent",
        linkedTo: [],
      });
      // attribute the payment to the packing list's first invoice, if any, else the delivery node
      edgePairs.push([
        invoices.length > 0 ? `${row.id}:pl:${pl.id}:inv:${invoices[0].id ?? 0}` : plId,
        payId,
      ]);
      if (pay.date) {
        timeline.push({
          id: `t:${payId}`,
          at: pay.date,
          kind: "transfer",
          title: "Virement envoyé",
          amount: num(pay.montant),
          currency: toCurrency(pay.devise) || currency,
          refId: payId,
        });
      }
    }
  }

  if (
    df?.factureDefinitive &&
    (hasPdf(df.factureDefinitive.pdf) || num(df.factureDefinitive.montant) > 0)
  ) {
    const fdId = `${row.id}:fd`;
    hasFactureDefinitive = true;
    const fdMontant = num(df.factureDefinitive.montant);
    const fdPaid = (df.factureDefinitive.paiements ?? []).reduce((a, p) => a + num(p.montant), 0);
    invoiced += fdMontant;
    paid += fdPaid;
    docs.push({
      id: fdId,
      kind: "supplier_invoice",
      number: "Facture définitive",
      date: row.dateLivraison ?? "",
      amount: fdMontant,
      currency: toCurrency(df.factureDefinitive.devise) || currency,
      status:
        fdMontant > 0 && fdPaid >= fdMontant * 0.99
          ? "paid"
          : fdPaid > 0
            ? "partially_paid"
            : "issued",
      remaining: fdMontant > 0 ? Math.max(0, fdMontant - fdPaid) : undefined,
      linkedTo: [],
    });
    edgePairs.push([poId, fdId]);
    for (const pay of df.factureDefinitive.paiements ?? []) {
      const payId = `${row.id}:fd:pay:${pay.id}`;
      docs.push({
        id: payId,
        kind: "transfer",
        number: "Virement",
        date: pay.date ?? "",
        amount: num(pay.montant),
        currency: toCurrency(pay.devise) || currency,
        status: "sent",
        linkedTo: [],
      });
      edgePairs.push([fdId, payId]);
    }
  }

  // wire up linkedTo from the accumulated edge pairs
  const edges = edgeSet(edgePairs);
  for (const d of docs) {
    d.linkedTo = Array.from(edges.get(d.id) ?? []);
  }

  timeline.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  // ── Status ladder ─────────────────────────────────────────────────────────
  const season = seasonOf(row.notes);
  const hasInvoice = deliveryInvoiceCount > 0 || hasFactureDefinitive;
  // a delivery-stage invoice fully paid?
  const invoicePaid = invoiced > 0 && paid >= invoiced * 0.99;
  // total facturé au niveau du montant commandé ?
  const invoicedMatchesOrder = ordered > 0 && invoiced >= ordered * 0.99;
  // "Erreur" (fournisseurs, hors saisons en cours) : une pro forma est renseignée et
  // un paiement est rattaché à une LIVRAISON mais aucune facture n'y est enregistrée.
  // Un paiement rattaché à la pro forma (un acompte) est légitime → "Deposit payé",
  // ce n'est PAS une erreur.
  const isDocflowError =
    side === "payable" &&
    !CURRENT_SEASONS.has(season) &&
    hasProforma &&
    !hasInvoice &&
    paymentWithoutInvoice;

  let status: Order["status"];
  if (row.cloture) {
    // clôture manuelle par l'utilisateur — prime sur la grille calculée
    status = "closed";
  } else if (side === "payable" && CURRENT_SEASONS.has(season)) {
    // ── FOURNISSEURS, saisons courantes (AW26/PS27/SS27) : NOUVELLE grille ──
    // Commande → Deposit à régler → Deposit payé → Expédition à payer →
    // Partiellement facturé → Facture payée → Clôturé.
    const hasDemande = livraisonProformaCount > 0;
    const fullyShipped = ordered > 0 && invoiced >= ordered * 0.99;
    const fullyPaid = ordered > 0 && paid >= ordered * 0.99;
    if (hasProforma && !depositPaid && !hasDemande && !hasInvoice) {
      status = "deposit_to_pay";
    } else if (hasDemande && anyLivraisonUnpaid) {
      status = "expedition_to_pay";
    } else if (fullyShipped && fullyPaid) {
      // facture totale ET tout payé (acompte + demandes) = commande → clôturé direct
      status = "closed";
    } else if (hasInvoice) {
      // demande payée + facture présente (pas encore soldé au total)
      status = "facture_paid";
    } else if (hasDemande) {
      // demande de livraison payée mais pas encore de facture
      status = "partially_billed";
    } else if (hasProforma) {
      status = depositPaid ? "deposit_paid" : "deposit_to_pay";
    } else {
      status = "confirmed";
    }
  } else if (side === "payable") {
    // ── FOURNISSEURS, anciennes saisons : grille d'origine (rétrocompat) ──
    if (isDocflowError) {
      status = "error";
    } else if (!hasProforma && !hasInvoice) {
      status = "confirmed";
    } else if (hasProforma && !hasInvoice && !depositPaid) {
      status = "deposit_to_pay";
    } else if (hasProforma && !hasInvoice && depositPaid) {
      status = "deposit_paid";
    } else if (hasInvoice) {
      if (!invoicePaid) status = "invoice_to_pay";
      else if (invoicedMatchesOrder) status = "closed";
      else status = "partially_invoiced";
    } else {
      status = "confirmed";
    }
  } else {
    // ── CLIENTS : grille simplifiée, basée sur les totaux ──
    if (invoiced <= 0) status = "confirmed";
    else if (!invoicePaid) status = "invoice_to_pay";
    else if (invoicedMatchesOrder) status = "closed";
    else status = "partially_invoiced";
  }

  // Axe EXPÉDITION (fournisseurs) — basé sur le total facturé (factures reçues) par
  // rapport au montant commandé. Indépendant de l'axe paiement.
  let shipmentStatus: ShipmentStatus | undefined;
  if (side === "payable") {
    shipmentStatus =
      invoiced <= 0.01
        ? "not_shipped"
        : invoiced < ordered * 0.99
          ? "partially_shipped"
          : "fully_shipped";
  }

  const progress = row.cloture
    ? 1
    : ordered === 0
      ? 0
      : Math.min(1, (delivered + invoiced + paid) / (ordered * 3));

  const alerts: Alert[] = [];
  if (status === "error") {
    alerts.push({
      id: `a:${row.id}:docflow_error`,
      severity: "high",
      kind: "payment_without_invoice",
      title: "Erreur — facture manquante sur une livraison payée",
      detail:
        `La commande ${row.reference ?? row.id} a un paiement rattaché à une livraison ` +
        `(${paid.toFixed(2)} ${currency}) mais aucune facture n'y est enregistrée. ` +
        `Il manque la facture correspondant à cette livraison.`,
      orderId: row.id,
    });
  }
  if (invoiced > ordered * 1.01) {
    alerts.push({
      id: `a:${row.id}:invoice_exceeds_po`,
      severity: "high",
      kind: "invoice_exceeds_po",
      title: "Facture supérieure au bon de commande",
      detail: `Le total facturé dépasse le montant du bon de commande pour ${row.reference ?? row.id}.`,
      orderId: row.id,
    });
  }
  if (invoiced > 0 && paid > invoiced * 1.01) {
    alerts.push({
      id: `a:${row.id}:overpayment`,
      severity: "medium",
      kind: "overpayment",
      title: "Trop-perçu",
      detail: `Le montant payé dépasse le total facturé pour ${row.reference ?? row.id}.`,
      orderId: row.id,
    });
  }
  if (missingInvoiceCount > 0) {
    alerts.push({
      id: `a:${row.id}:missing_invoice`,
      severity: "medium",
      kind: "missing_invoice",
      title: "Facture manquante",
      detail: `Un bordereau de livraison n'a aucune facture rattachée pour ${row.reference ?? row.id}.`,
      orderId: row.id,
    });
  }
  // Only flag orders with some real docFlow engagement (a proforma, at least) — bare
  // stub rows with no docFlow at all give no reliable signal either way, and flagging
  // all of them floods the alerts page with noise on old/since-completed orders.
  if (
    df &&
    row.dateLivraison &&
    new Date(row.dateLivraison) < new Date() &&
    !df.packingLists?.length
  ) {
    alerts.push({
      id: `a:${row.id}:late_delivery`,
      severity: "medium",
      kind: "late_delivery",
      title: "Risque de retard de livraison",
      detail: `La livraison prévue le ${row.dateLivraison} est dépassée sans bordereau de livraison enregistré.`,
      orderId: row.id,
    });
  }

  return {
    id: row.id,
    side,
    number: row.reference ?? row.id,
    party,
    createdAt: row.dateCommande ?? row.createdAt ?? "",
    expectedAt: row.dateLivraison ?? "",
    currency,
    status,
    totals: { ordered, delivered, invoiced, paid },
    progress,
    owner: "",
    docs,
    timeline,
    // a manually-closed order is considered settled — hide its alerts everywhere
    alerts: row.cloture ? [] : alerts,
    archived: Boolean(row.archived),
    shipmentStatus,
  };
}

export function buildSupplierIndex(names: string[]): Map<string, Party> {
  const m = new Map<string, Party>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name || m.has(name)) continue;
    m.set(name, synthesizeParty(name));
  }
  return m;
}

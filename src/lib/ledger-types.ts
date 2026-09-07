// Shared types for the reconciliation dashboard, and pure helpers derived from an Order[].

export type Currency = "EUR" | "USD" | "GBP" | "CNY";
export type Side = "payable" | "receivable"; // supplier vs customer
export type DocKind =
  | "po"
  | "so"
  | "delivery"
  | "supplier_invoice"
  | "customer_invoice"
  | "proforma"
  | "credit_note"
  | "payment"
  | "transfer";

// Statut de PAIEMENT (axe paiement)
export type OrderStatus =
  | "confirmed" // aucun document (ni pro forma ni facture)
  | "deposit_to_pay" // pro forma ajoutée, acompte pas encore réglé (fournisseurs)
  | "deposit_paid" // pro forma + acompte réglé, aucune livraison (fournisseurs)
  | "expedition_to_pay" // une pro forma pour livraison est à régler (fournisseurs)
  | "partially_billed" // demande de livraison payée mais pas encore de facture (fournisseurs)
  | "facture_paid" // pro forma(s) pour livraison réglée(s) + facture (fournisseurs)
  | "invoice_to_pay" // une facture est présente mais pas entièrement payée
  | "partially_invoiced" // facture payée mais le total facturé ≠ montant commandé
  | "closed" // tout facturé au bon montant et payé
  | "error"; // anomalie docFlow (fournisseurs) : paiement de livraison sans facture

// Statut d'EXPÉDITION (axe expédition, fournisseurs) — basé sur les factures reçues
export type ShipmentStatus =
  | "not_shipped" // aucune facture reçue
  | "partially_shipped" // facture(s) reçue(s), montant < total attendu
  | "fully_shipped"; // facture(s) couvrant la totalité attendue

export interface Party {
  id: string;
  name: string;
  city?: string;
  country?: string;
}

export interface DocRef {
  id: string;
  kind: DocKind;
  number: string;
  date: string; // ISO
  amount: number;
  currency: Currency;
  status: string;
  remaining?: number;
  linkedTo: string[]; // ids of connected docs
  note?: string;
}

export interface TimelineEvent {
  id: string;
  at: string; // ISO
  kind: DocKind | "status" | "note";
  title: string;
  amount?: number;
  currency?: Currency;
  refId?: string;
}

export const severityLabel: Record<"high" | "medium" | "low", string> = {
  high: "élevée",
  medium: "moyenne",
  low: "faible",
};

export interface Alert {
  id: string;
  severity: "high" | "medium" | "low";
  kind:
    | "missing_invoice"
    | "missing_delivery"
    | "invoice_without_po"
    | "payment_without_invoice"
    | "invoice_exceeds_po"
    | "proforma_exceeds_po"
    | "overpayment"
    | "duplicate_payment"
    | "currency_mismatch"
    | "unlinked_document"
    | "late_payment"
    | "late_delivery";
  title: string;
  detail: string;
  orderId?: string;
  // Marquée « ce n'est pas une erreur » par l'utilisateur → masquée des décomptes/vues actives.
  acknowledged?: boolean;
}

export interface Order {
  id: string;
  side: Side;
  number: string;
  party: Party;
  createdAt: string;
  expectedAt: string;
  currency: Currency;
  status: OrderStatus;
  totals: {
    ordered: number;
    delivered: number;
    invoiced: number; // FACTURÉ BRUT (avant retours)
    paid: number; // ENCAISSÉ BRUT (avant avoirs)
    // Retours : la RA (autorisation de retour) diminue le facturé net, la CN (avoir)
    // diminue l'encaissé net. Distincts car il peut y avoir un délai entre les deux.
    returnedInvoiced?: number; // Σ des retours (RA) → à soustraire du facturé
    returnedPaid?: number; // Σ des avoirs reçus (CN) → à soustraire de l'encaissé
  };
  progress: number; // 0..1
  owner: string;
  docs: DocRef[];
  timeline: TimelineEvent[];
  alerts: Alert[];
  archived: boolean; // masquée de l'échéancier et du calendrier (non supprimée)
  season: string; // saison déduite des notes (ex. "AW26"), "" si inconnue
  // Axe expédition (fournisseurs uniquement) — affiché À CÔTÉ de `status` (paiement).
  shipmentStatus?: ShipmentStatus;
}

export function findOrder(orders: Order[], id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

/* ── Facturé / encaissé net des retours ────────────────────────────────── */

// La commande a-t-elle des retours qui impactent le facturé net ?
export function hasReturns(o: Order): boolean {
  return (o.totals.returnedInvoiced ?? 0) > 0.01;
}
// Facturé NET = facturé brut − Σ des retours (RA).
export function invoicedNet(o: Order): number {
  return o.totals.invoiced - (o.totals.returnedInvoiced ?? 0);
}
// Encaissé NET = encaissé brut − Σ des avoirs reçus (CN).
export function paidNet(o: Order): number {
  return o.totals.paid - (o.totals.returnedPaid ?? 0);
}
// Reste dû (net) = facturé net − encaissé net, plancher 0.
export function remainingNet(o: Order): number {
  return Math.max(0, invoicedNet(o) - paidNet(o));
}

// Alertes actives (hors celles marquées « ce n'est pas une erreur »).
export function globalAlerts(orders: Order[]): Alert[] {
  return orders.flatMap((o) => o.alerts).filter((a) => !a.acknowledged);
}

export function summary(orders: Order[]) {
  const payable = orders.filter((o) => o.side === "payable");
  const receivable = orders.filter((o) => o.side === "receivable");
  const sum = (arr: Order[], key: keyof Order["totals"]) =>
    arr.reduce((a, o) => a + o.totals[key], 0);
  // "Restant dû" is floored per order at 0 — a supplier prepaid via a deposit
  // (paid before its invoice is entered) must not net out against amounts still
  // owed on other orders, which would show a confusing negative. Matches the
  // Échéances page so the same label shows the same number everywhere.
  const outstanding = (arr: Order[]) =>
    arr.reduce((a, o) => a + Math.max(0, o.totals.invoiced - o.totals.paid), 0);
  return {
    outstandingPayable: outstanding(payable),
    outstandingReceivable: outstanding(receivable),
    cashPaid: sum(payable, "paid"),
    cashExpected: outstanding(receivable),
    ordersInProgress: orders.filter((o) => o.status !== "closed").length,
    awaitingInvoice: orders.filter((o) => o.totals.delivered > o.totals.invoiced).length,
    awaitingPayment: orders.filter((o) => o.totals.invoiced > o.totals.paid).length,
  };
}

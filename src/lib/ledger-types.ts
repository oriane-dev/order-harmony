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

export type OrderStatus =
  | "confirmed" // aucun document ajouté
  | "partially_shipped" // packing list(s) en cours, montant expédié < commande
  | "partially_invoiced" // packing lists au complet, factures manquantes
  | "to_settle" // tout facturé, paiements manquants
  | "closed"; // tout payé

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
    | "overpayment"
    | "duplicate_payment"
    | "currency_mismatch"
    | "unlinked_document"
    | "late_payment"
    | "late_delivery";
  title: string;
  detail: string;
  orderId?: string;
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
    invoiced: number;
    paid: number;
  };
  progress: number; // 0..1
  owner: string;
  docs: DocRef[];
  timeline: TimelineEvent[];
  alerts: Alert[];
}

export function findOrder(orders: Order[], id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

export function globalAlerts(orders: Order[]): Alert[] {
  return orders.flatMap((o) => o.alerts);
}

export function summary(orders: Order[]) {
  const payable = orders.filter((o) => o.side === "payable");
  const receivable = orders.filter((o) => o.side === "receivable");
  const sum = (arr: Order[], key: keyof Order["totals"]) =>
    arr.reduce((a, o) => a + o.totals[key], 0);
  return {
    outstandingPayable: sum(payable, "invoiced") - sum(payable, "paid"),
    outstandingReceivable: sum(receivable, "invoiced") - sum(receivable, "paid"),
    cashPaid: sum(payable, "paid"),
    cashExpected: sum(receivable, "invoiced") - sum(receivable, "paid"),
    ordersInProgress: orders.filter((o) => o.status !== "closed").length,
    awaitingInvoice: orders.filter((o) => o.totals.delivered > o.totals.invoiced).length,
    awaitingPayment: orders.filter((o) => o.totals.invoiced > o.totals.paid).length,
  };
}

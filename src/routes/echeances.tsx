import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { StatusChip } from "@/components/status-chip";
import { OrderLink } from "@/components/order-link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import type { Order, OrderStatus } from "@/lib/ledger-types";
import { ordersQueryOptions, customerOrdersQueryOptions } from "@/lib/data";
import { shortMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/echeances")({
  head: () => ({
    meta: [
      { title: "Échéances · Cash Flow Management" },
      {
        name: "description",
        content:
          "Échéancier : acomptes et factures à régler, côté fournisseurs et clients — filtrable et triable.",
      },
    ],
  }),
  component: EcheancesPage,
});

type DueType = "Acompte" | "Facture";

interface DueItem {
  order: Order;
  side: "payable" | "receivable";
  sideLabel: string;
  type: DueType;
  amount: number;
}

// Turn an order into its outstanding échéance, if any.
// - deposit_to_pay (fournisseurs) → acompte encore à régler (solde de la pro forma)
// - toute commande dont il reste un montant facturé non réglé → facture à payer
function dueOf(order: Order): DueItem | null {
  const sideLabel = order.side === "payable" ? "Fournisseur" : "Client";
  if (order.status === "deposit_to_pay") {
    const pf = order.docs.find((d) => d.kind === "proforma");
    const amount = pf?.remaining ?? pf?.amount ?? order.totals.ordered;
    if (amount > 0.01)
      return { order, side: order.side, sideLabel, type: "Acompte", amount };
    return null;
  }
  const gap = order.totals.invoiced - order.totals.paid;
  if (gap > 0.01) return { order, side: order.side, sideLabel, type: "Facture", amount: gap };
  return null;
}

type SortKey = "number" | "party" | "side" | "type" | "status" | "date" | "amount";

const STATUS_RANK: Record<OrderStatus, number> = {
  confirmed: 0,
  deposit_to_pay: 1,
  deposit_paid: 2,
  invoice_to_pay: 3,
  partially_invoiced: 4,
  closed: 5,
  error: 6,
};

function EcheancesPage() {
  const { data: supplierOrders } = useSuspenseQuery(ordersQueryOptions());
  const { data: customerOrders } = useSuspenseQuery(customerOrdersQueryOptions());

  const allDue = useMemo(
    () => [...supplierOrders, ...customerOrders].map(dueOf).filter((x): x is DueItem => x !== null),
    [supplierOrders, customerOrders],
  );

  const totalPayable = allDue
    .filter((d) => d.side === "payable")
    .reduce((a, d) => a + d.amount, 0);
  const totalReceivable = allDue
    .filter((d) => d.side === "receivable")
    .reduce((a, d) => a + d.amount, 0);

  const [sideFilter, setSideFilter] = useState<"all" | "payable" | "receivable">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | DueType>("all");
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    const filtered = allDue.filter(
      (d) =>
        (sideFilter === "all" || d.side === sideFilter) &&
        (typeFilter === "all" || d.type === typeFilter),
    );
    const val = (d: DueItem): string | number => {
      switch (sortKey) {
        case "number":
          return d.order.number.toLowerCase();
        case "party":
          return d.order.party.name.toLowerCase();
        case "side":
          return d.sideLabel;
        case "type":
          return d.type;
        case "status":
          return STATUS_RANK[d.order.status] ?? 99;
        case "date":
          return d.order.expectedAt ? new Date(d.order.expectedAt).getTime() : Infinity;
        case "amount":
          return d.amount;
      }
    };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [allDue, sideFilter, typeFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "amount" ? "desc" : "asc");
    }
  };

  const Th = ({
    label,
    k,
    align = "left",
    className,
  }: {
    label: ReactNode;
    k: SortKey;
    align?: "left" | "right";
    className?: string;
  }) => {
    const active = sortKey === k;
    const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={cn(
            "inline-flex items-center gap-1 hover:text-foreground transition-colors uppercase",
            align === "right" && "flex-row-reverse",
            active && "text-foreground",
          )}
        >
          <span>{label}</span>
          <Icon className={cn("size-3 shrink-0", !active && "opacity-40")} />
        </button>
      </div>
    );
  };

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Échéances</div>
          <h1 className="font-serif text-4xl mt-1">Échéancier</h1>
          <p className="text-muted-foreground mt-2">
            Les acomptes et les factures encore à régler, côté fournisseurs et clients.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <KpiCard label="À régler aux fournisseurs" value={totalPayable} tone="warning" />
          <KpiCard label="À encaisser des clients" value={totalReceivable} tone="warning" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={sideFilter} onValueChange={(v) => setSideFilter(v as typeof sideFilter)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Côté" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Fournisseurs et clients</SelectItem>
              <SelectItem value="payable">Fournisseurs</SelectItem>
              <SelectItem value="receivable">Clients</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              <SelectItem value="Acompte">Acompte</SelectItem>
              <SelectItem value="Facture">Facture</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground ml-auto">
            {rows.length} échéance{rows.length > 1 ? "s" : ""}
          </div>
        </div>

        <div className="card-elev overflow-hidden">
          <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-border text-[10px] tracking-widest text-muted-foreground">
            <Th label="Commande" k="number" className="col-span-2" />
            <Th label="Contrepartie" k="party" className="col-span-3" />
            <Th label="Côté" k="side" className="col-span-1" />
            <Th label="Type" k="type" className="col-span-1" />
            <Th label="Statut" k="status" className="col-span-2" />
            <Th label="Livraison" k="date" align="right" className="col-span-1 text-right" />
            <Th label="Montant dû" k="amount" align="right" className="col-span-2 text-right" />
          </div>
          <div className="divide-y divide-border">
            {rows.length === 0 && (
              <div className="px-5 py-8 text-sm text-muted-foreground text-center">
                Aucune échéance — tout est réglé.
              </div>
            )}
            {rows.map((d) => (
              <OrderLink
                key={`${d.order.id}:${d.type}`}
                order={d.order}
                className="grid grid-cols-12 gap-3 px-5 py-4 items-center hover:bg-surface-2 transition-colors"
              >
                <div className="col-span-2 text-sm font-medium">{d.order.number}</div>
                <div className="col-span-3 text-sm truncate">{d.order.party.name}</div>
                <div className="col-span-1 text-xs text-muted-foreground">{d.sideLabel}</div>
                <div className="col-span-1">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                      d.type === "Acompte"
                        ? "bg-info/10 text-info"
                        : "bg-warning/15 text-warning-foreground",
                    )}
                  >
                    {d.type}
                  </span>
                </div>
                <div className="col-span-2">
                  <StatusChip status={d.order.status} />
                </div>
                <div className="col-span-1 text-right text-xs num text-muted-foreground">
                  {d.order.expectedAt ? fmtDate(d.order.expectedAt) : "—"}
                </div>
                <div className="col-span-2 text-right font-serif text-lg num text-warning-foreground">
                  {shortMoney(d.amount, d.order.currency)}
                </div>
              </OrderLink>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

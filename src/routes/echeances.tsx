import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { OrderLink } from "@/components/order-link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import type { Order } from "@/lib/ledger-types";
import type { RawOrder } from "@/lib/thalae-types";
import {
  ordersQueryOptions,
  customerOrdersQueryOptions,
  rawOrdersQueryOptions,
  rawCustomerOrdersQueryOptions,
  rawSuppliersQueryOptions,
} from "@/lib/data";
import { computeSupplierSchedule, supplierByNameIndex } from "@/lib/payment-schedule";
import { seasonOf, seasonSortKey } from "@/lib/season";
import { shortMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/echeances")({
  head: () => ({
    meta: [
      { title: "Échéances · Cash Flow Management" },
      {
        name: "description",
        content:
          "Échéancier daté : acomptes, before shipment et soldes à régler, avec la date d'échéance de chaque paiement.",
      },
    ],
  }),
  component: EcheancesPage,
});

type Category = "Acompte" | "Before shipment" | "Solde" | "Facture";

interface DueItem {
  key: string;
  order: Order;
  side: "payable" | "receivable";
  sideLabel: string;
  season: string;
  category: Category;
  label: string; // libellé détaillé (ex. "Acompte 30%")
  amount: number;
  date: string; // ISO ou ""
  estimated: boolean;
}

// première échéance dueDate d'une facture client non soldée (pour dater la ligne)
function customerDueDate(raw: RawOrder | undefined): string {
  const dates: string[] = [];
  for (const pl of raw?.docFlow?.packingLists ?? [])
    for (const f of pl.factures ?? []) if (f.dueDate) dates.push(f.dueDate);
  for (const di of raw?.docFlow?.proforma?.depositInvoices ?? []) if (di.dueDate) dates.push(di.dueDate);
  dates.sort();
  return dates[0] ?? "";
}

type SortKey = "number" | "party" | "side" | "season" | "type" | "date" | "amount";

function EcheancesPage() {
  const { data: supplierOrders } = useSuspenseQuery(ordersQueryOptions());
  const { data: customerOrders } = useSuspenseQuery(customerOrdersQueryOptions());
  const { data: rawSupplierOrders } = useSuspenseQuery(rawOrdersQueryOptions());
  const { data: rawCustomerOrders } = useSuspenseQuery(rawCustomerOrdersQueryOptions());
  const { data: rawSuppliers } = useSuspenseQuery(rawSuppliersQueryOptions());

  const allDue = useMemo(() => {
    const supIndex = supplierByNameIndex(rawSuppliers);
    const rawSupById = new Map(rawSupplierOrders.map((o) => [o.id, o]));
    const rawCustById = new Map(rawCustomerOrders.map((o) => [o.id, o]));
    const out: DueItem[] = [];

    for (const o of supplierOrders) {
      if (o.archived) continue; // les archivées ne sont pas dans l'échéancier
      const raw = rawSupById.get(o.id);
      const season = seasonOf(raw?.notes);
      const sched = raw
        ? computeSupplierSchedule(raw, supIndex.get((raw.fournisseur ?? "").trim().toLowerCase()))
        : [];
      if (sched.length) {
        for (const inst of sched) {
          if (inst.remaining <= 0.01 || !inst.date) continue;
          const category: Category =
            inst.kind === "deposit"
              ? "Acompte"
              : inst.kind === "before_shipment"
                ? "Before shipment"
                : "Solde";
          out.push({
            key: `${o.id}:${inst.id}`,
            order: o,
            side: "payable",
            sideLabel: "Fournisseur",
            season,
            category,
            label: inst.label,
            amount: inst.remaining,
            date: inst.date,
            estimated: inst.estimated,
          });
        }
      } else {
        // pas de conditions complètes → affichage simple
        if (o.status === "deposit_to_pay") {
          const pf = o.docs.find((d) => d.kind === "proforma");
          const amount = pf?.remaining ?? pf?.amount ?? o.totals.ordered;
          if (amount > 0.01)
            out.push({
              key: `${o.id}:dep`,
              order: o,
              side: "payable",
              sideLabel: "Fournisseur",
              season,
              category: "Acompte",
              label: "Acompte",
              amount,
              date: raw?.docFlow?.proforma?.docDate ?? "",
              estimated: false,
            });
        } else {
          const gap = o.totals.invoiced - o.totals.paid;
          if (gap > 0.01)
            out.push({
              key: `${o.id}:fac`,
              order: o,
              side: "payable",
              sideLabel: "Fournisseur",
              season,
              category: "Facture",
              label: "Facture",
              amount: gap,
              date: "",
              estimated: false,
            });
        }
      }
    }

    for (const o of customerOrders) {
      if (o.archived) continue;
      const raw = rawCustById.get(o.id);
      const gap = o.totals.invoiced - o.totals.paid;
      if (gap > 0.01)
        out.push({
          key: `${o.id}:fac`,
          order: o,
          side: "receivable",
          sideLabel: "Client",
          season: seasonOf(raw?.notes),
          category: "Facture",
          label: "Facture",
          amount: gap,
          date: customerDueDate(raw),
          estimated: false,
        });
    }
    return out;
  }, [supplierOrders, customerOrders, rawSupplierOrders, rawCustomerOrders, rawSuppliers]);

  const totalPayable = allDue
    .filter((d) => d.side === "payable")
    .reduce((a, d) => a + d.amount, 0);
  const totalReceivable = allDue
    .filter((d) => d.side === "receivable")
    .reduce((a, d) => a + d.amount, 0);

  const [sideFilter, setSideFilter] = useState<"all" | "payable" | "receivable">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | Category>("all");
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const seasonOptions = useMemo(
    () =>
      Array.from(new Set(allDue.map((d) => d.season).filter(Boolean))).sort(
        (a, b) => seasonSortKey(a) - seasonSortKey(b),
      ),
    [allDue],
  );

  const rows = useMemo(() => {
    const filtered = allDue.filter(
      (d) =>
        (sideFilter === "all" || d.side === sideFilter) &&
        (typeFilter === "all" || d.category === typeFilter) &&
        (seasonFilter === "all" || d.season === seasonFilter),
    );
    const val = (d: DueItem): string | number => {
      switch (sortKey) {
        case "number":
          return d.order.number.toLowerCase();
        case "party":
          return d.order.party.name.toLowerCase();
        case "side":
          return d.sideLabel;
        case "season":
          return d.season ? seasonSortKey(d.season) : Infinity;
        case "type":
          return d.category;
        case "date":
          return d.date ? new Date(d.date).getTime() : Infinity; // sans date → en dernier
        case "amount":
          return d.amount;
      }
    };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "number" && typeof vb === "number") {
        if (va === vb) return 0;
        // Infinity (sans date) toujours en bas quel que soit le sens
        if (va === Infinity) return 1;
        if (vb === Infinity) return -1;
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [allDue, sideFilter, typeFilter, seasonFilter, sortKey, sortDir]);

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
            Chaque paiement à venir, à sa date d'échéance : acomptes (date de la pro forma), before
            shipment (à réception de la facture) et soldes (net X jours après livraison).
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
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              <SelectItem value="Acompte">Acompte</SelectItem>
              <SelectItem value="Before shipment">Before shipment</SelectItem>
              <SelectItem value="Solde">Solde (net X)</SelectItem>
              <SelectItem value="Facture">Facture</SelectItem>
            </SelectContent>
          </Select>
          <Select value={seasonFilter} onValueChange={setSeasonFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Saison" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les saisons</SelectItem>
              {seasonOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
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
            <Th label="Saison" k="season" className="col-span-1" />
            <Th label="Type" k="type" className="col-span-2" />
            <Th label="Échéance" k="date" className="col-span-2" />
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
                key={d.key}
                order={d.order}
                className="grid grid-cols-12 gap-3 px-5 py-4 items-center hover:bg-surface-2 transition-colors"
              >
                <div className="col-span-2">
                  <div className="text-sm font-medium">{d.order.number}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {d.sideLabel}
                  </div>
                </div>
                <div className="col-span-3 text-sm truncate">{d.order.party.name}</div>
                <div className="col-span-1 text-xs num">
                  {d.season || <span className="text-muted-foreground">—</span>}
                </div>
                <div className="col-span-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                      d.category === "Acompte"
                        ? "bg-info/10 text-info"
                        : d.category === "Facture"
                          ? "bg-warning/15 text-warning-foreground"
                          : "bg-surface-2 text-foreground border border-border",
                    )}
                  >
                    {d.label}
                  </span>
                </div>
                <div className="col-span-2 text-sm num">
                  {d.date ? (
                    <span className={cn(d.estimated && "text-muted-foreground")}>
                      {fmtDate(d.date)}
                      {d.estimated && " (prév.)"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">date à définir</span>
                  )}
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

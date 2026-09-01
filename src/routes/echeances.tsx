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
import {
  ordersQueryOptions,
  customerOrdersQueryOptions,
  rawOrdersQueryOptions,
  rawCustomerOrdersQueryOptions,
  rawSuppliersQueryOptions,
} from "@/lib/data";
import { seasonSortKey } from "@/lib/season";
import {
  buildDueItems,
  currentWeek,
  currentMonth,
  isInPeriod,
  type DueItem,
  type Category,
} from "@/lib/echeancier";
import { shortMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Search = { cote?: "payable" | "receivable"; due?: "week" | "month" };

export const Route = createFileRoute("/echeances")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    cote:
      search.cote === "payable" || search.cote === "receivable" ? search.cote : undefined,
    due: search.due === "week" || search.due === "month" ? search.due : undefined,
  }),
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

type SortKey = "number" | "party" | "side" | "season" | "type" | "date" | "amount";

function EcheancesPage() {
  const { data: supplierOrders } = useSuspenseQuery(ordersQueryOptions());
  const { data: customerOrders } = useSuspenseQuery(customerOrdersQueryOptions());
  const { data: rawSupplierOrders } = useSuspenseQuery(rawOrdersQueryOptions());
  const { data: rawCustomerOrders } = useSuspenseQuery(rawCustomerOrdersQueryOptions());
  const { data: rawSuppliers } = useSuspenseQuery(rawSuppliersQueryOptions());

  const allDue = useMemo(
    () =>
      buildDueItems(
        supplierOrders,
        customerOrders,
        rawSupplierOrders,
        rawCustomerOrders,
        rawSuppliers,
      ),
    [supplierOrders, customerOrders, rawSupplierOrders, rawCustomerOrders, rawSuppliers],
  );

  const search = Route.useSearch();

  const [sideFilter, setSideFilter] = useState<"all" | "payable" | "receivable">(
    search.cote ?? "all",
  );
  const [typeFilter, setTypeFilter] = useState<"all" | Category>("all");
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [partyFilter, setPartyFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<"all" | "week" | "month">(search.due ?? "all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Semaine : seulement les échéances PRÉCISES (non estimées) ; mois : tout (prévisionnel).
  const period = periodFilter === "week" ? currentWeek() : periodFilter === "month" ? currentMonth() : null;

  const seasonOptions = useMemo(
    () =>
      Array.from(new Set(allDue.map((d) => d.season).filter(Boolean))).sort(
        (a, b) => seasonSortKey(a) - seasonSortKey(b),
      ),
    [allDue],
  );

  // liste des contreparties présentes dans l'échéancier (respecte le filtre côté)
  const partyOptions = useMemo(
    () =>
      Array.from(
        new Set(
          allDue
            .filter((d) => sideFilter === "all" || d.side === sideFilter)
            .map((d) => d.order.party.name)
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [allDue, sideFilter],
  );

  const rows = useMemo(() => {
    const filtered = allDue.filter(
      (d) =>
        (sideFilter === "all" || d.side === sideFilter) &&
        (typeFilter === "all" || d.category === typeFilter) &&
        (seasonFilter === "all" || d.season === seasonFilter) &&
        (partyFilter === "all" || d.order.party.name === partyFilter) &&
        // période : semaine = échéances précises uniquement ; mois = tout (prévisionnel)
        (period === null ||
          (isInPeriod(d, period) && (periodFilter !== "week" || !d.estimated))),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDue, sideFilter, typeFilter, seasonFilter, partyFilter, periodFilter, sortKey, sortDir]);

  // Totaux alignés sur la vue filtrée (côté, type, saison, contrepartie, période).
  const totalPayable = rows
    .filter((d) => d.side === "payable")
    .reduce((a, d) => a + d.amount, 0);
  const totalReceivable = rows
    .filter((d) => d.side === "receivable")
    .reduce((a, d) => a + d.amount, 0);

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
          <Select value={partyFilter} onValueChange={setPartyFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Contrepartie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les contreparties</SelectItem>
              {partyOptions.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={periodFilter}
            onValueChange={(v) => setPeriodFilter(v as typeof periodFilter)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Période" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les dates</SelectItem>
              <SelectItem value="week">Cette semaine</SelectItem>
              <SelectItem value="month">Ce mois-ci</SelectItem>
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

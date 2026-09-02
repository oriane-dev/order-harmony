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
import { ChevronUp, ChevronDown, ChevronsUpDown, Download } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  ordersQueryOptions,
  customerOrdersQueryOptions,
  rawOrdersQueryOptions,
  rawCustomerOrdersQueryOptions,
  rawSuppliersQueryOptions,
  rawCustomersQueryOptions,
} from "@/lib/data";
import { seasonSortKey } from "@/lib/season";
import {
  buildDueItems,
  currentWeek,
  currentMonth,
  isInPeriod,
  exportEcheancesExcel,
  type DueItem,
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
  const { data: rawCustomers } = useSuspenseQuery(rawCustomersQueryOptions());

  const allDue = useMemo(
    () =>
      buildDueItems(
        supplierOrders,
        customerOrders,
        rawSupplierOrders,
        rawCustomerOrders,
        rawSuppliers,
        rawCustomers,
      ),
    [
      supplierOrders,
      customerOrders,
      rawSupplierOrders,
      rawCustomerOrders,
      rawSuppliers,
      rawCustomers,
    ],
  );

  const search = Route.useSearch();

  // Filtres multi-sélection : liste vide = « tout ».
  const [sideFilter, setSideFilter] = useState<string[]>(search.cote ? [search.cote] : []);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [seasonFilter, setSeasonFilter] = useState<string[]>([]);
  const [partyFilter, setPartyFilter] = useState<string[]>([]);
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
            .filter((d) => sideFilter.length === 0 || sideFilter.includes(d.side))
            .map((d) => d.order.party.name)
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [allDue, sideFilter],
  );

  const rows = useMemo(() => {
    const filtered = allDue.filter(
      (d) =>
        (sideFilter.length === 0 || sideFilter.includes(d.side)) &&
        (typeFilter.length === 0 || typeFilter.includes(d.category)) &&
        (seasonFilter.length === 0 || seasonFilter.includes(d.season)) &&
        (partyFilter.length === 0 || partyFilter.includes(d.order.party.name)) &&
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

  // Deux blocs : demandes CONFIRMÉES (date précise, non estimée) vs PRÉVISIONNEL
  // (dates estimées ou sans date encore fixée).
  const confirmedRows = rows.filter((d) => !d.estimated && !!d.date);
  const previsionnelRows = rows.filter((d) => d.estimated || !d.date);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggleSelectAll = (items: DueItem[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const d of items) if (on) n.add(d.key);
      else n.delete(d.key);
      return n;
    });
  const selectedItems = rows.filter((d) => selected.has(d.key));
  const selectedTotal = selectedItems.reduce((a, d) => a + d.amount, 0);

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

  const renderBlock = (title: string, items: DueItem[], hint: string) => {
    const total = items.reduce((a, d) => a + d.amount, 0);
    const selTotal = items.filter((d) => selected.has(d.key)).reduce((a, d) => a + d.amount, 0);
    const allSelected = items.length > 0 && items.every((d) => selected.has(d.key));
    return (
      <section className="space-y-2">
        <div>
          <h2 className="font-serif text-2xl">{title}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="card-elev overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border text-[10px] tracking-widest text-muted-foreground">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(v) => toggleSelectAll(items, v === true)}
              aria-label="Tout sélectionner"
            />
            <div className="grid grid-cols-12 gap-3 flex-1">
              <Th label="Commande" k="number" className="col-span-2" />
              <Th label="Contrepartie" k="party" className="col-span-3" />
              <Th label="Saison" k="season" className="col-span-1" />
              <Th label="Type" k="type" className="col-span-2" />
              <Th label="Échéance" k="date" className="col-span-2" />
              <Th label="Montant dû" k="amount" align="right" className="col-span-2 text-right" />
            </div>
          </div>
          <div className="divide-y divide-border">
            {items.length === 0 && (
              <div className="px-5 py-6 text-sm text-muted-foreground text-center">
                Aucune échéance dans ce bloc.
              </div>
            )}
            {items.map((d) => (
              <div
                key={d.key}
                className={cn(
                  "flex items-center gap-3 px-5 hover:bg-surface-2 transition-colors",
                  selected.has(d.key) && "bg-accent/5",
                )}
              >
                <Checkbox
                  checked={selected.has(d.key)}
                  onCheckedChange={() => toggleSelect(d.key)}
                  aria-label="Sélectionner l'échéance"
                />
                <OrderLink
                  order={d.order}
                  className="grid grid-cols-12 gap-3 py-4 items-center flex-1 min-w-0"
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
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-surface-2/40 text-sm">
            <span className="text-muted-foreground">
              Total sélectionné : <span className="num font-medium">{shortMoney(selTotal, "EUR")}</span>
            </span>
            <span>
              Total échéances : <span className="font-serif text-lg num">{shortMoney(total, "EUR")}</span>
            </span>
          </div>
        </div>
      </section>
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
          <MultiSelect
            label="Côté"
            className="w-44"
            selected={sideFilter}
            onChange={setSideFilter}
            options={[
              { value: "payable", label: "Fournisseurs" },
              { value: "receivable", label: "Clients" },
            ]}
          />
          <MultiSelect
            label="Type"
            className="w-44"
            selected={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: "Acompte", label: "Acompte" },
              { value: "Before shipment", label: "Before shipment" },
              { value: "Solde", label: "Solde (net X)" },
              { value: "Facture", label: "Facture" },
            ]}
          />
          <MultiSelect
            label="Saison"
            className="w-40"
            selected={seasonFilter}
            onChange={setSeasonFilter}
            options={seasonOptions.map((s) => ({ value: s, label: s }))}
          />
          <MultiSelect
            label="Contrepartie"
            className="w-56"
            selected={partyFilter}
            onChange={setPartyFilter}
            options={partyOptions.map((p) => ({ value: p, label: p }))}
          />
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

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {selectedItems.length > 0 ? (
              <>
                <span className="font-medium text-foreground">{selectedItems.length}</span>{" "}
                sélectionnée{selectedItems.length > 1 ? "s" : ""} · Total sélectionné{" "}
                <span className="num font-medium text-foreground">
                  {shortMoney(selectedTotal, "EUR")}
                </span>
              </>
            ) : (
              "Coche des échéances pour les additionner et les exporter en Excel."
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={selectedItems.length === 0}
            onClick={() => exportEcheancesExcel(selectedItems)}
          >
            <Download /> Exporter
          </Button>
        </div>

        {renderBlock(
          "Demandes confirmées de paiement à effectuer",
          confirmedRows,
          "Échéances à date précise (acomptes, pro formas pour livraison, factures) — montant confirmé et daté.",
        )}
        {renderBlock(
          "Autres décaissements prévisionnels",
          previsionnelRows,
          "Montants estimés d'après les conditions de paiement (dates prévisionnelles), en attendant une demande précise.",
        )}
      </div>
    </AppShell>
  );
}

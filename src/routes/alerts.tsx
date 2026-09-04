import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { OrderLink } from "@/components/order-link";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect } from "@/components/ui/multi-select";
import { severityLabel } from "@/lib/ledger-types";
import type { Alert, Order } from "@/lib/ledger-types";
import {
  ordersQueryOptions,
  customerOrdersQueryOptions,
  rawOrdersQueryOptions,
  rawCustomerOrdersQueryOptions,
} from "@/lib/data";
import { saveOrder } from "@/lib/thalae-mutations";
import type { RawOrder } from "@/lib/thalae-types";
import { seasonSortKey } from "@/lib/season";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, ChevronsUpDown, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Alertes · Cash Flow Management" },
      {
        name: "description",
        content:
          "Anomalies détectées : erreurs de paiement, montants supérieurs au bon de commande, trop-perçus et retards. Filtrable par côté, saison et contrepartie.",
      },
    ],
  }),
  component: AlertsPage,
});

// Libellés courts des types d'alerte (pour le filtre « Type »).
const KIND_LABEL: Record<Alert["kind"], string> = {
  payment_without_invoice: "Erreur — paiement sans facture",
  proforma_exceeds_po: "Pro forma > bon de commande",
  invoice_exceeds_po: "Factures livraison > bon de commande",
  overpayment: "Trop-perçu",
  missing_invoice: "Facture manquante",
  late_delivery: "Retard de livraison",
  missing_delivery: "Livraison manquante",
  invoice_without_po: "Facture sans bon de commande",
  duplicate_payment: "Paiement en double",
  currency_mismatch: "Devise incohérente",
  unlinked_document: "Document non rattaché",
  late_payment: "Paiement en retard",
};

// Alertes pour lesquelles l'utilisateur peut cocher « ce n'est pas une erreur » (masquer).
const DISMISSABLE = new Set<Alert["kind"]>(["invoice_exceeds_po", "proforma_exceeds_po"]);

const SEVERITY_RANK: Record<Alert["severity"], number> = { high: 0, medium: 1, low: 2 };

type SortKey = "number" | "party" | "season" | "severity" | "kind" | "date";

interface Row {
  alert: Alert;
  order: Order;
}

function AlertsPage() {
  const queryClient = useQueryClient();
  const { data: supplierOrders } = useSuspenseQuery(ordersQueryOptions());
  const { data: customerOrders } = useSuspenseQuery(customerOrdersQueryOptions());
  const { data: rawSupplierOrders } = useSuspenseQuery(rawOrdersQueryOptions());
  const { data: rawCustomerOrders } = useSuspenseQuery(rawCustomerOrdersQueryOptions());

  const rawById = useMemo(
    () => new Map<string, RawOrder>([...rawSupplierOrders, ...rawCustomerOrders].map((o) => [o.id, o])),
    [rawSupplierOrders, rawCustomerOrders],
  );

  // Vue courante : Fournisseurs ou Clients (bascule « comme le calendrier »).
  const [side, setSide] = useState<"payable" | "receivable">("payable");
  const [seasonFilter, setSeasonFilter] = useState<string[]>([]);
  const [partyFilter, setPartyFilter] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const [showAck, setShowAck] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  const orders = side === "payable" ? supplierOrders : customerOrders;

  // Toutes les lignes d'alerte du côté courant (archivées exclues).
  const allRows = useMemo<Row[]>(
    () =>
      orders
        .filter((o) => !o.archived)
        .flatMap((o) => o.alerts.map((alert) => ({ alert, order: o }))),
    [orders],
  );

  const ackCount = allRows.filter((r) => r.alert.acknowledged).length;

  const seasonOptions = useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.order.season).filter(Boolean))).sort(
        (a, b) => seasonSortKey(a) - seasonSortKey(b),
      ),
    [allRows],
  );
  const partyOptions = useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.order.party.name).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [allRows],
  );
  const kindOptions = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.alert.kind))),
    [allRows],
  );

  const rows = useMemo(() => {
    const filtered = allRows.filter(
      (r) =>
        (showAck || !r.alert.acknowledged) &&
        (seasonFilter.length === 0 || seasonFilter.includes(r.order.season)) &&
        (partyFilter.length === 0 || partyFilter.includes(r.order.party.name)) &&
        (kindFilter.length === 0 || kindFilter.includes(r.alert.kind)),
    );
    const val = (r: Row): string | number => {
      switch (sortKey) {
        case "number":
          return r.order.number.toLowerCase();
        case "party":
          return r.order.party.name.toLowerCase();
        case "season":
          return r.order.season ? seasonSortKey(r.order.season) : Infinity;
        case "severity":
          return SEVERITY_RANK[r.alert.severity];
        case "kind":
          return KIND_LABEL[r.alert.kind] ?? r.alert.kind;
        case "date":
          return r.order.createdAt ? new Date(r.order.createdAt).getTime() : Infinity;
      }
    };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "number" && typeof vb === "number") {
        if (va === vb) return 0;
        if (va === Infinity) return 1;
        if (vb === Infinity) return -1;
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [allRows, showAck, seasonFilter, partyFilter, kindFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  async function toggleAck(order: Order, alert: Alert, on: boolean) {
    const raw = rawById.get(order.id);
    if (!raw) return;
    const table = order.side === "payable" ? "orders" : "customer_orders";
    const set = new Set(raw.acknowledgedAlerts ?? []);
    if (on) set.add(alert.id);
    else set.delete(alert.id);
    setSavingIds((s) => new Set(s).add(alert.id));
    try {
      await saveOrder({ ...raw, acknowledgedAlerts: [...set] }, table);
      await queryClient.invalidateQueries({ queryKey: [table] });
      await queryClient.refetchQueries({ queryKey: [table] });
    } finally {
      setSavingIds((s) => {
        const n = new Set(s);
        n.delete(alert.id);
        return n;
      });
    }
  }

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
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Alertes</div>
          <h1 className="font-serif text-4xl mt-1">Anomalies détectées</h1>
          <p className="text-muted-foreground mt-2">
            Erreurs de paiement, montants dépassant le bon de commande, trop-perçus et retards.
            Choisis une vue, puis filtre et trie comme dans l'échéancier.
          </p>
        </div>

        {/* Bascule de vue Fournisseurs / Clients — comme le calendrier */}
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
          {(["payable", "receivable"] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setSide(s);
                setSeasonFilter([]);
                setPartyFilter([]);
                setKindFilter([]);
              }}
              className={cn(
                "px-5 py-2 transition-colors",
                side === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface-2",
              )}
            >
              {s === "payable" ? "Fournisseurs" : "Clients"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <MultiSelect
            label="Saison"
            className="w-40"
            selected={seasonFilter}
            onChange={setSeasonFilter}
            options={seasonOptions.map((s) => ({ value: s, label: s }))}
          />
          <MultiSelect
            label={side === "payable" ? "Fournisseur" : "Client"}
            className="w-56"
            selected={partyFilter}
            onChange={setPartyFilter}
            options={partyOptions.map((p) => ({ value: p, label: p }))}
          />
          <MultiSelect
            label="Type d'alerte"
            className="w-56"
            selected={kindFilter}
            onChange={setKindFilter}
            options={kindOptions.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))}
          />
          {ackCount > 0 && (
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <Checkbox checked={showAck} onCheckedChange={(v) => setShowAck(v === true)} />
              Afficher les alertes vérifiées ({ackCount})
            </label>
          )}
          <div className="text-sm text-muted-foreground ml-auto">
            {rows.length} alerte{rows.length > 1 ? "s" : ""}
          </div>
        </div>

        <div className="card-elev overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border text-[10px] tracking-widest text-muted-foreground">
            <div className="grid grid-cols-12 gap-3 flex-1">
              <Th label="Commande" k="number" className="col-span-2" />
              <Th label={side === "payable" ? "Fournisseur" : "Client"} k="party" className="col-span-3" />
              <Th label="Saison" k="season" className="col-span-1" />
              <Th label="Alerte" k="kind" className="col-span-4" />
              <Th label="Date" k="date" className="col-span-2" />
            </div>
            <div className="w-28 shrink-0" />
          </div>

          <div className="divide-y divide-border">
            {rows.length === 0 && (
              <div className="px-5 py-10 text-sm text-muted-foreground text-center">
                Aucune anomalie {side === "payable" ? "côté fournisseurs" : "côté clients"} pour ces
                filtres.
              </div>
            )}
            {rows.map(({ alert: a, order: o }) => {
              const dismissable = DISMISSABLE.has(a.kind);
              const saving = savingIds.has(a.id);
              return (
                <div
                  key={a.id}
                  className={cn(
                    "flex items-center gap-3 px-5 hover:bg-surface-2 transition-colors",
                    a.acknowledged && "opacity-55",
                  )}
                >
                  <OrderLink
                    order={o}
                    className="grid grid-cols-12 gap-3 py-4 items-center flex-1 min-w-0"
                  >
                    <div className="col-span-2 text-sm font-medium">{o.number}</div>
                    <div className="col-span-3 text-sm truncate">{o.party.name}</div>
                    <div className="col-span-1 text-xs num">
                      {o.season || <span className="text-muted-foreground">—</span>}
                    </div>
                    <div className="col-span-4 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "size-2 rounded-full shrink-0",
                            a.severity === "high" ? "bg-destructive" : "bg-warning",
                          )}
                        />
                        <span className="text-sm font-medium truncate">{a.title}</span>
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
                          {severityLabel[a.severity]}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {a.detail}
                      </div>
                    </div>
                    <div className="col-span-2 text-sm num text-muted-foreground">
                      {o.createdAt ? fmtDate(o.createdAt) : "—"}
                    </div>
                  </OrderLink>
                  <div className="w-28 shrink-0 flex justify-end">
                    {dismissable && (
                      <label
                        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none leading-tight"
                        title="Marquer cette alerte comme vérifiée (ce n'est pas une erreur)"
                      >
                        <Checkbox
                          checked={Boolean(a.acknowledged)}
                          disabled={saving}
                          onCheckedChange={(v) => toggleAck(o, a, v === true)}
                        />
                        <span>Pas une erreur</span>
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

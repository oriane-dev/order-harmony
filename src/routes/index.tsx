import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatusChip } from "@/components/status-chip";
import { OrderLink } from "@/components/order-link";
import { globalAlerts } from "@/lib/ledger-types";
import {
  ordersQueryOptions,
  customerOrdersQueryOptions,
  rawOrdersQueryOptions,
  rawCustomerOrdersQueryOptions,
  rawSuppliersQueryOptions,
} from "@/lib/data";
import {
  buildDueItems,
  currentWeek,
  currentMonth,
  isInPeriod,
  type DueItem,
} from "@/lib/echeancier";
import { shortMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowUpRight, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tableau de bord · Cash Flow Management" },
      {
        name: "description",
        content:
          "Situation financière globale : montants dus et à recevoir, commandes bloquées, retards de paiement et activité récente.",
      },
    ],
  }),
  component: Home,
});

// Grand onglet Fournisseurs / Clients : restant dû ce mois-ci (prévisionnel global)
// avec bascule Mois / Semaine. En semaine → seulement les échéances précises saisies.
// Un clic ouvre l'échéancier filtré sur ce côté + cette période.
function DuePanel({
  title,
  side,
  items,
}: {
  title: string;
  side: "payable" | "receivable";
  items: DueItem[];
}) {
  const [mode, setMode] = useState<"month" | "week">("month");
  const period = mode === "week" ? currentWeek() : currentMonth();
  const total = items
    .filter(
      (d) => d.side === side && isInPeriod(d, period) && (mode !== "week" || !d.estimated),
    )
    .reduce((a, d) => a + d.amount, 0);
  return (
    <Link
      to="/echeances"
      search={{ cote: side, due: mode }}
      className="card-elev p-6 block hover:bg-surface-2 transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{title}</div>
        <div
          className="inline-flex rounded-md border border-border overflow-hidden text-xs"
          onClick={(e) => e.preventDefault()}
        >
          {(["month", "week"] as const).map((m) => (
            <button
              key={m}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMode(m);
              }}
              className={cn(
                "px-3 py-1 transition-colors",
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface-2",
              )}
            >
              {m === "month" ? "Mois" : "Semaine"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">
        {mode === "month" ? "Restant dû ce mois-ci" : "Restant dû cette semaine"}
      </div>
      <div className="font-serif text-5xl mt-1 num text-warning-foreground">
        {shortMoney(total, "EUR")}
      </div>
      <div className="mt-3 text-xs text-accent inline-flex items-center gap-1">
        Voir le détail des échéances <ArrowUpRight className="size-3.5" />
      </div>
    </Link>
  );
}

function Home() {
  const { data: supplierOrders } = useSuspenseQuery(ordersQueryOptions());
  const { data: customerOrders } = useSuspenseQuery(customerOrdersQueryOptions());
  const { data: rawSupplierOrders } = useSuspenseQuery(rawOrdersQueryOptions());
  const { data: rawCustomerOrders } = useSuspenseQuery(rawCustomerOrdersQueryOptions());
  const { data: rawSuppliers } = useSuspenseQuery(rawSuppliersQueryOptions());
  const orders = [...supplierOrders, ...customerOrders];
  const alerts = globalAlerts(orders);
  const recent = orders.slice(0, 5);

  const dueItems = useMemo(
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

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto space-y-8">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Vue d'ensemble
            </div>
            <h1 className="font-serif text-4xl mt-1">Où en est chaque commande, à l'instant.</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DuePanel title="Fournisseurs" side="payable" items={dueItems} />
          <DuePanel title="Clients" side="receivable" items={dueItems} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card-elev p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-serif text-2xl">Commandes en cours</h2>
              <Link
                to="/orders"
                className="text-sm text-accent hover:underline inline-flex items-center gap-1"
              >
                Tout voir <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            <div className="divide-y divide-border">
              {recent.map((o) => (
                <OrderLink
                  key={o.id}
                  order={o}
                  className="grid grid-cols-12 gap-3 py-3.5 items-center hover:bg-surface-2 -mx-2 px-2 rounded-md transition-colors"
                >
                  <div className="col-span-4">
                    <div className="text-sm font-medium">{o.number}</div>
                    <div className="text-xs text-muted-foreground">
                      {o.party.name}
                      {o.party.city ? ` · ${o.party.city}` : ""}
                    </div>
                  </div>
                  <div className="col-span-3 text-xs text-muted-foreground uppercase">
                    {o.side === "payable" ? "Fournisseur" : "Client"}
                  </div>
                  <div className="col-span-3">
                    <StatusChip status={o.status} />
                  </div>
                  <div className="col-span-2 text-right font-serif text-lg num">
                    {shortMoney(o.totals.ordered, o.currency)}
                  </div>
                </OrderLink>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="card-elev p-6">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Alertes
                </div>
                <Link to="/alerts" className="text-xs text-accent hover:underline">
                  Tout voir
                </Link>
              </div>
              <div className="mt-4 space-y-3">
                {alerts.slice(0, 8).map((a) => {
                  const ao = orders.find((o) => o.id === a.orderId);
                  return (
                    <OrderLink
                      key={a.id}
                      order={{ id: a.orderId ?? "", side: ao?.side ?? "payable" }}
                      className="flex gap-3 -mx-2 px-2 py-2 rounded-md hover:bg-surface-2 transition-colors"
                    >
                      <div
                        className={`mt-0.5 size-6 rounded-full grid place-items-center shrink-0 ${a.severity === "high" ? "bg-destructive/10 text-destructive" : "bg-warning/20 text-warning-foreground"}`}
                      >
                        <AlertTriangle className="size-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{a.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{a.detail}</div>
                      </div>
                    </OrderLink>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="card-elev p-6">
          <h2 className="font-serif text-2xl mb-4">Activité récente</h2>
          <ul className="space-y-3">
            {orders
              .flatMap((o) =>
                o.timeline
                  .slice(-1)
                  .map((t) => ({ ...t, orderId: o.id, party: o.party.name, side: o.side })),
              )
              .sort((a, b) => (a.at < b.at ? 1 : -1))
              .slice(0, 6)
              .map((t) => (
                <li key={t.id} className="flex items-center gap-4 text-sm">
                  <div className="text-xs text-muted-foreground w-20 num">{fmtDate(t.at)}</div>
                  <div className="flex-1 truncate">
                    <span className="font-medium">{t.title}</span>
                    <span className="text-muted-foreground"> · {t.party}</span>
                  </div>
                  <OrderLink
                    order={{ id: t.orderId, side: t.side }}
                    className="text-xs text-accent hover:underline"
                  >
                    {t.orderId}
                  </OrderLink>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}

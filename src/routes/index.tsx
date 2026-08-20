import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { StatusChip } from "@/components/status-chip";
import { OrderLink } from "@/components/order-link";
import { summary, globalAlerts } from "@/lib/ledger-types";
import { ordersQueryOptions, customerOrdersQueryOptions } from "@/lib/data";
import { shortMoney, fmtDate } from "@/lib/format";
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

function Home() {
  const { data: supplierOrders } = useSuspenseQuery(ordersQueryOptions());
  const { data: customerOrders } = useSuspenseQuery(customerOrdersQueryOptions());
  const orders = [...supplierOrders, ...customerOrders];
  const s = summary(orders);
  const alerts = globalAlerts(orders);
  const recent = orders.slice(0, 5);

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

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Restant dû aux fournisseurs"
            value={s.outstandingPayable}
            hint="Dû aux fournisseurs"
            tone="warning"
          />
          <KpiCard
            label="Restant dû par les clients"
            value={s.outstandingReceivable}
            hint="Dû par les clients"
            tone="warning"
          />
          <KpiCard
            label="Trésorerie versée"
            value={s.cashPaid}
            hint="Ce trimestre"
            tone="positive"
          />
          <KpiCard label="Trésorerie attendue" value={s.cashExpected} hint="Sous 60 jours" />
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
                  <div className="col-span-2 text-xs text-muted-foreground uppercase">
                    {o.side === "payable" ? "Fournisseur" : "Client"}
                  </div>
                  <div className="col-span-2">
                    <StatusChip status={o.status} />
                  </div>
                  <div className="col-span-2">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent"
                        style={{ width: `${Math.round(o.progress * 100)}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1 num">
                      {Math.round(o.progress * 100)}%
                    </div>
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

import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { StatusChip } from "@/components/status-chip";
import { OrderLink } from "@/components/order-link";
import type { Order } from "@/lib/ledger-types";
import { ordersQueryOptions, customerOrdersQueryOptions } from "@/lib/data";
import { shortMoney, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/echeances")({
  head: () => ({
    meta: [
      { title: "Échéances · Ledger" },
      {
        name: "description",
        content:
          "Soldes restants sur chaque commande — montants facturés non encore réglés, côté fournisseurs et clients.",
      },
    ],
  }),
  component: EcheancesPage,
});

function OutstandingTable({ orders }: { orders: Order[] }) {
  const outstanding = orders
    .map((o) => ({ order: o, gap: o.totals.invoiced - o.totals.paid }))
    .filter((x) => x.gap > 0.01)
    .sort((a, b) => b.gap - a.gap);

  return (
    <div className="card-elev overflow-hidden">
      <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
        <div className="col-span-3">Commande</div>
        <div className="col-span-3">Contrepartie</div>
        <div className="col-span-2">Statut</div>
        <div className="col-span-2 text-right">Livraison prévue</div>
        <div className="col-span-2 text-right">Solde</div>
      </div>
      <div className="divide-y divide-border">
        {outstanding.length === 0 && (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">
            Aucun solde restant — tout ce qui a été facturé a été réglé.
          </div>
        )}
        {outstanding.map(({ order, gap }) => (
          <OrderLink
            key={order.id}
            order={order}
            className="grid grid-cols-12 gap-3 px-5 py-4 items-center hover:bg-surface-2 transition-colors"
          >
            <div className="col-span-3">
              <div className="text-sm font-medium">{order.number}</div>
            </div>
            <div className="col-span-3 text-sm truncate">{order.party.name}</div>
            <div className="col-span-2">
              <StatusChip status={order.status} />
            </div>
            <div className="col-span-2 text-right text-xs num text-muted-foreground">
              {order.expectedAt ? fmtDate(order.expectedAt) : "—"}
            </div>
            <div className="col-span-2 text-right font-serif text-lg num text-warning-foreground">
              {shortMoney(gap, order.currency)}
            </div>
          </OrderLink>
        ))}
      </div>
    </div>
  );
}

function EcheancesPage() {
  const { data: supplierOrders } = useSuspenseQuery(ordersQueryOptions());
  const { data: customerOrders } = useSuspenseQuery(customerOrdersQueryOptions());

  const totalPayable = supplierOrders.reduce(
    (a, o) => a + Math.max(0, o.totals.invoiced - o.totals.paid),
    0,
  );
  const totalReceivable = customerOrders.reduce(
    (a, o) => a + Math.max(0, o.totals.invoiced - o.totals.paid),
    0,
  );

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Échéances</div>
          <h1 className="font-serif text-4xl mt-1">Soldes restants</h1>
          <p className="text-muted-foreground mt-2">
            Chaque commande dont le montant facturé n'a pas encore été entièrement réglé.
          </p>
        </div>

        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <KpiCard label="Restant dû aux fournisseurs" value={totalPayable} tone="warning" />
            <KpiCard label="Restant dû par les clients" value={totalReceivable} tone="warning" />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-2xl">Fournisseurs — à payer</h2>
          <OutstandingTable orders={supplierOrders} />
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-2xl">Clients — à encaisser</h2>
          <OutstandingTable orders={customerOrders} />
        </section>
      </div>
    </AppShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { StatusChip } from "@/components/status-chip";
import { ordersQueryOptions } from "@/lib/data";
import { shortMoney, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/echeances")({
  head: () => ({
    meta: [
      { title: "Échéances · Ledger" },
      {
        name: "description",
        content:
          "Soldes restants sur chaque commande fournisseur — montants facturés non encore payés.",
      },
    ],
  }),
  component: EcheancesPage,
});

function EcheancesPage() {
  const { data: orders } = useSuspenseQuery(ordersQueryOptions());
  const outstanding = orders
    .map((o) => ({ order: o, gap: o.totals.invoiced - o.totals.paid }))
    .filter((x) => x.gap > 0.01)
    .sort((a, b) => b.gap - a.gap);

  const totalOutstanding = outstanding.reduce((a, x) => a + x.gap, 0);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Échéances</div>
          <h1 className="font-serif text-4xl mt-1">Soldes restants</h1>
          <p className="text-muted-foreground mt-2">
            Chaque commande dont le montant facturé n'a pas encore été entièrement payé.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <KpiCard label="Total restant dû" value={totalOutstanding} tone="warning" />
          <KpiCard label="Commandes avec un solde" value={outstanding.length} tone="default" />
        </div>

        <div className="card-elev overflow-hidden">
          <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
            <div className="col-span-3">Commande</div>
            <div className="col-span-3">Fournisseur</div>
            <div className="col-span-2">Statut</div>
            <div className="col-span-2 text-right">Livraison prévue</div>
            <div className="col-span-2 text-right">Solde</div>
          </div>
          <div className="divide-y divide-border">
            {outstanding.length === 0 && (
              <div className="px-5 py-8 text-sm text-muted-foreground text-center">
                Aucun solde restant — tout ce qui a été facturé a été payé.
              </div>
            )}
            {outstanding.map(({ order, gap }) => (
              <Link
                key={order.id}
                to="/orders/$id"
                params={{ id: order.id }}
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
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { ReconciliationFlow } from "@/components/reconciliation-flow";
import { ordersQueryOptions } from "@/lib/data";
import { StatusChip } from "@/components/status-chip";

export const Route = createFileRoute("/reconciliation")({
  head: () => ({
    meta: [
      { title: "Rapprochement · Ledger" },
      {
        name: "description",
        content:
          "Schémas de flux reliant bons de commande, livraisons, factures et paiements pour chaque commande.",
      },
    ],
  }),
  component: ReconciliationPage,
});

function ReconciliationPage() {
  const { data: orders } = useSuspenseQuery(ordersQueryOptions());
  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto space-y-8">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Rapprochement
          </div>
          <h1 className="font-serif text-4xl mt-1">Chaque flux, côte à côte.</h1>
          <p className="text-muted-foreground mt-2">
            Survole un document pour tracer toute sa chaîne — pro forma, bordereaux de livraison,
            factures et virements.
          </p>
        </div>

        <div className="space-y-6">
          {orders.map((o) => (
            <section key={o.id} className="card-elev p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    {o.side === "payable" ? "Commande fournisseur" : "Commande client"}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <h2 className="font-serif text-2xl">{o.number}</h2>
                    <StatusChip status={o.status} />
                    <span className="text-sm text-muted-foreground">· {o.party.name}</span>
                  </div>
                </div>
              </div>
              <ReconciliationFlow docs={o.docs} />
            </section>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

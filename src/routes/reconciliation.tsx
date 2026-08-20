import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { ReconciliationFlow } from "@/components/reconciliation-flow";
import { OrderLink } from "@/components/order-link";
import { ArrowUpRight } from "lucide-react";
import { ordersQueryOptions, customerOrdersQueryOptions } from "@/lib/data";
import { StatusChip } from "@/components/status-chip";
import type { Order } from "@/lib/ledger-types";

export const Route = createFileRoute("/reconciliation")({
  head: () => ({
    meta: [
      { title: "Rapprochement · Cash Flow Management" },
      {
        name: "description",
        content:
          "Schémas de flux reliant bons de commande, livraisons, factures et paiements pour chaque commande.",
      },
    ],
  }),
  component: ReconciliationPage,
});

function FlowSection({
  title,
  eyebrow,
  orders,
}: {
  title: string;
  eyebrow: string;
  orders: Order[];
}) {
  return (
    <section className="space-y-4">
      <h2 className="font-serif text-3xl">
        {title}
        <span className="text-muted-foreground text-lg"> · {orders.length}</span>
      </h2>
      {orders.length === 0 && (
        <div className="card-elev px-6 py-8 text-sm text-muted-foreground text-center">
          Aucune commande.
        </div>
      )}
      <div className="space-y-6">
        {orders.map((o) => (
          <section key={o.id} className="card-elev p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  {eyebrow}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <OrderLink order={o} className="font-serif text-2xl hover:underline">
                    {o.number}
                  </OrderLink>
                  <StatusChip status={o.status} />
                  <span className="text-sm text-muted-foreground">· {o.party.name}</span>
                </div>
              </div>
              <OrderLink
                order={o}
                className="text-sm text-accent hover:underline inline-flex items-center gap-1 shrink-0"
              >
                Voir la commande <ArrowUpRight className="size-3.5" />
              </OrderLink>
            </div>
            <ReconciliationFlow docs={o.docs} />
          </section>
        ))}
      </div>
    </section>
  );
}

function ReconciliationPage() {
  const { data: supplierOrders } = useSuspenseQuery(ordersQueryOptions());
  const { data: customerOrders } = useSuspenseQuery(customerOrdersQueryOptions());

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto space-y-10">
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

        <FlowSection title="Fournisseurs" eyebrow="Commande fournisseur" orders={supplierOrders} />
        <FlowSection title="Clients" eyebrow="Commande client" orders={customerOrders} />
      </div>
    </AppShell>
  );
}

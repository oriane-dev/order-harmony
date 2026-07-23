import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { globalAlerts, severityLabel } from "@/lib/ledger-types";
import { ordersQueryOptions } from "@/lib/data";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Alertes · Ledger" },
      {
        name: "description",
        content:
          "Factures manquantes, trop-perçus, factures dépassant le bon de commande, retards de livraison et autres anomalies.",
      },
    ],
  }),
  component: AlertsPage,
});

function AlertsPage() {
  const { data: orders } = useSuspenseQuery(ordersQueryOptions());
  const alerts = globalAlerts(orders);
  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Alertes</div>
          <h1 className="font-serif text-4xl mt-1">{alerts.length} anomalies</h1>
          <p className="text-muted-foreground mt-2">
            Tous les problèmes détectés sur les commandes fournisseurs et clients.
          </p>
        </div>

        <ul className="space-y-3">
          {alerts.map((a) => {
            const order = orders.find((o) => o.id === a.orderId);
            return (
              <li key={a.id}>
                <Link
                  to="/orders/$id"
                  params={{ id: a.orderId ?? "" }}
                  className={`card-elev flex items-start gap-4 p-5 hover:bg-surface-2 transition-colors block ${a.severity === "high" ? "border-destructive/40" : ""}`}
                >
                  <div
                    className={`size-9 rounded-full grid place-items-center shrink-0 ${a.severity === "high" ? "bg-destructive/10 text-destructive" : "bg-warning/20 text-warning-foreground"}`}
                  >
                    <AlertTriangle className="size-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium">{a.title}</div>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {severityLabel[a.severity]}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">{a.detail}</div>
                    {order && (
                      <div className="text-xs text-muted-foreground mt-2">
                        {order.number} · {order.party.name}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </AppShell>
  );
}

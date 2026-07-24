import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import type { Order, Alert } from "@/lib/ledger-types";
import { StatusChip } from "@/components/status-chip";
import { Timeline } from "@/components/timeline";
import { ReconciliationFlow } from "@/components/reconciliation-flow";
import { DocflowEditor } from "@/components/docflow-editor";
import { OrderForm } from "@/components/order-form";
import { OrderComments } from "@/components/order-comments";
import { Button } from "@/components/ui/button";
import { findOrder, severityLabel } from "@/lib/ledger-types";
import { ordersQueryOptions, rawOrdersQueryOptions } from "@/lib/data";
import { deleteOrder } from "@/lib/thalae-mutations";
import { shortMoney, fmtDate, pct } from "@/lib/format";
import { AlertTriangle, ArrowLeft, Pencil, Trash2, User } from "lucide-react";

export const Route = createFileRoute("/orders/$id")({
  loader: async ({ params, context }): Promise<{ order: Order }> => {
    const orders = await context.queryClient.ensureQueryData(ordersQueryOptions());
    const order = findOrder(orders, params.id);
    if (!order) throw notFound();
    return { order };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.order.number} · Ledger` : "Commande · Ledger" },
      {
        name: "description",
        content: loaderData
          ? `${loaderData.order.party.name} — ${loaderData.order.number}`
          : "Détail de la commande",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrderPage,
  notFoundComponent: () => (
    <AppShell>
      <div className="max-w-xl mx-auto text-center py-24">
        <h1 className="font-serif text-3xl">Commande introuvable</h1>
        <p className="text-muted-foreground mt-2">La commande que tu cherches n'existe pas.</p>
        <Link to="/orders" className="inline-block mt-6 text-accent hover:underline">
          Retour aux commandes
        </Link>
      </div>
    </AppShell>
  ),
});

function OrderPage() {
  const { order } = Route.useLoaderData();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: rawOrders } = useSuspenseQuery(rawOrdersQueryOptions());
  const rawOrder = rawOrders.find((o) => o.id === order.id);
  const [editOpen, setEditOpen] = useState(false);

  const delMutation = useMutation({
    mutationFn: () => deleteOrder(order.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate({ to: "/orders" });
    },
  });

  const remainingToDeliver = Math.max(0, order.totals.ordered - order.totals.delivered);
  const remainingToInvoice = Math.max(0, order.totals.ordered - order.totals.invoiced);
  const remainingToPay = Math.max(0, order.totals.invoiced - order.totals.paid);

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto space-y-8">
        <div>
          <Link
            to="/orders"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Toutes les commandes
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-4 mt-3">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-serif text-4xl">{order.number}</h1>
                <StatusChip status={order.status} />
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {order.side === "payable" ? "Fournisseur" : "Client"} · {order.party.name}
                {(order.party.city || order.party.country) && (
                  <> · {[order.party.city, order.party.country].filter(Boolean).join(", ")}</>
                )}
              </div>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Responsable
                </div>
                <div className="mt-0.5 inline-flex items-center gap-1.5">
                  <User className="size-3.5" /> {order.owner || "—"}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Livraison prévue
                </div>
                <div className="mt-0.5 num">{fmtDate(order.expectedAt)}</div>
              </div>
              <div className="w-40">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                  Avancement · {pct(order.progress)}
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${Math.round(order.progress * 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil /> Modifier
                </Button>
                {rawOrder && <OrderComments order={rawOrder} />}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (
                      confirm(
                        `Supprimer la commande ${order.number} ? Cette action est irréversible.`,
                      )
                    )
                      delMutation.mutate();
                  }}
                >
                  <Trash2 /> Supprimer
                </Button>
              </div>
            </div>
          </div>
        </div>

        {order.alerts.length > 0 && (
          <div className="space-y-2">
            {order.alerts.map((a: Alert) => (
              <div
                key={a.id}
                className={`card-elev flex items-start gap-3 p-4 ${a.severity === "high" ? "border-destructive/40 bg-destructive/5" : "border-warning/40"}`}
              >
                <div
                  className={`size-8 rounded-full grid place-items-center shrink-0 ${a.severity === "high" ? "bg-destructive/10 text-destructive" : "bg-warning/20 text-warning-foreground"}`}
                >
                  <AlertTriangle className="size-4" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{a.title}</div>
                  <div className="text-sm text-muted-foreground">{a.detail}</div>
                </div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {severityLabel[a.severity]}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Montant commandé"
            value={order.totals.ordered}
            currency={order.currency}
          />
          <KpiCard
            label="Livré"
            value={order.totals.delivered}
            currency={order.currency}
            hint={`${shortMoney(remainingToDeliver, order.currency)} restant`}
            tone={remainingToDeliver > 0 ? "warning" : "positive"}
          />
          <KpiCard
            label="Facturé"
            value={order.totals.invoiced}
            currency={order.currency}
            hint={`${shortMoney(remainingToInvoice, order.currency)} à facturer`}
          />
          <KpiCard
            label="Payé"
            value={order.totals.paid}
            currency={order.currency}
            hint={`${shortMoney(remainingToPay, order.currency)} à payer`}
            tone={remainingToPay > 0 ? "warning" : "positive"}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <section className="lg:col-span-3 card-elev p-6 space-y-5 min-w-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-serif text-2xl">Rapprochement</h2>
                <p className="text-sm text-muted-foreground">
                  Survole un document pour voir le flux associé.
                </p>
              </div>
            </div>
            <ReconciliationFlow docs={order.docs} />
          </section>

          <section className="lg:col-span-2 card-elev p-6">
            <h2 className="font-serif text-2xl mb-5">Chronologie</h2>
            <Timeline events={order.timeline} />
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card-elev p-6">
            <h3 className="font-serif text-xl mb-4">Analyse des paiements</h3>
            <ul className="space-y-3 text-sm">
              <PayRow label="Total facturé" v={order.totals.invoiced} c={order.currency} />
              <PayRow label="Déjà payé" v={order.totals.paid} c={order.currency} tone="positive" />
              <PayRow
                label="Solde restant"
                v={remainingToPay}
                c={order.currency}
                tone={remainingToPay > 0 ? "warning" : "default"}
              />
            </ul>
          </div>
          <div className="card-elev p-6">
            <h3 className="font-serif text-xl mb-4">Analyse des livraisons</h3>
            <ul className="space-y-3 text-sm">
              <PayRow label="Commandé" v={order.totals.ordered} c={order.currency} />
              <PayRow label="Livré" v={order.totals.delivered} c={order.currency} tone="positive" />
              <PayRow
                label="Restant à livrer"
                v={remainingToDeliver}
                c={order.currency}
                tone={remainingToDeliver > 0 ? "warning" : "default"}
              />
            </ul>
          </div>
        </div>

        <div>
          <h2 className="font-serif text-2xl mb-4">Documents</h2>
          {rawOrder ? (
            <DocflowEditor order={rawOrder} />
          ) : (
            <div className="card-elev p-6 text-sm text-muted-foreground">Chargement…</div>
          )}
        </div>
      </div>

      {rawOrder && <OrderForm open={editOpen} onOpenChange={setEditOpen} order={rawOrder} />}
    </AppShell>
  );
}

function PayRow({
  label,
  v,
  c,
  tone,
}: {
  label: string;
  v: number;
  c: string;
  tone?: "positive" | "warning" | "default";
}) {
  const cls =
    tone === "positive"
      ? "text-success"
      : tone === "warning"
        ? "text-warning-foreground"
        : "text-foreground";
  return (
    <li className="flex items-center justify-between border-b border-border last:border-0 pb-2 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-serif text-xl num ${cls}`}>{shortMoney(v, c)}</span>
    </li>
  );
}

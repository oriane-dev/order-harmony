import { Link, useNavigate } from "@tanstack/react-router";
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
import {
  ordersQueryOptions,
  customerOrdersQueryOptions,
  rawOrdersQueryOptions,
  rawCustomerOrdersQueryOptions,
} from "@/lib/data";
import { severityLabel } from "@/lib/ledger-types";
import { deleteOrder, saveOrder, setDeliveryDate, setArchived } from "@/lib/thalae-mutations";
import { shortMoney, fmtDate } from "@/lib/format";
import { ENTITIES, type Entity } from "@/lib/entities";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
  Pencil,
  Trash2,
  User,
  Archive,
  ArchiveRestore,
} from "lucide-react";

export function OrderDetailContent({ order: initialOrder, entity }: { order: Order; entity: Entity }) {
  const cfg = ENTITIES[entity];
  const isSupplier = entity === "supplier";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: rawOrders } = useSuspenseQuery(
    isSupplier ? rawOrdersQueryOptions() : rawCustomerOrdersQueryOptions(),
  );
  // Read the LIVE adapted order from the query cache (not the frozen route-loader
  // copy) so status/alerts/KPIs update immediately after a mutation like "Clôturer".
  const { data: liveOrders } = useSuspenseQuery(
    isSupplier ? ordersQueryOptions() : customerOrdersQueryOptions(),
  );
  const order = liveOrders.find((o) => o.id === initialOrder.id) ?? initialOrder;
  const rawOrder = rawOrders.find((o) => o.id === order.id);
  const [editOpen, setEditOpen] = useState(false);

  // resync the cache with the server and tell the user when a save fails (network,
  // permissions…) instead of silently losing the change
  const resync = () => {
    queryClient.invalidateQueries({ queryKey: cfg.ordersKey });
    queryClient.invalidateQueries({ queryKey: cfg.rawOrdersKey });
  };
  const onSaveError = (e: Error) => {
    resync();
    alert(e.message || "Échec de l'enregistrement. Vérifiez votre connexion et réessayez.");
  };

  const delMutation = useMutation({
    mutationFn: () => deleteOrder(order.id, cfg.ordersTable),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cfg.ordersKey });
      navigate(isSupplier ? { to: "/orders" } : { to: "/customer-orders" });
    },
    onError: onSaveError,
  });

  const isClosed = Boolean(rawOrder?.cloture);
  const clotureMutation = useMutation({
    mutationFn: (value: boolean) => saveOrder({ ...rawOrder!, cloture: value }, cfg.ordersTable),
    onSuccess: resync,
    onError: onSaveError,
  });

  const deliveryMutation = useMutation({
    mutationFn: (value: string) => saveOrder(setDeliveryDate(rawOrder!, value), cfg.ordersTable),
    onSuccess: resync,
    onError: onSaveError,
  });

  const isArchived = Boolean(rawOrder?.archived);
  const archiveMutation = useMutation({
    mutationFn: (value: boolean) => saveOrder(setArchived(rawOrder!, value), cfg.ordersTable),
    onSuccess: resync,
    onError: onSaveError,
  });

  const remainingToDeliver = Math.max(0, order.totals.ordered - order.totals.delivered);
  const remainingToInvoice = Math.max(0, order.totals.ordered - order.totals.invoiced);
  const remainingToPay = Math.max(0, order.totals.invoiced - order.totals.paid);

  const paidLabel = isSupplier ? "Payé" : "Encaissé";
  const remainingPayLabel = isSupplier ? "à payer" : "à encaisser";

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto space-y-8">
        <div>
          {isSupplier ? (
            <Link
              to="/orders"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3.5" /> Toutes les commandes fournisseurs
            </Link>
          ) : (
            <Link
              to="/customer-orders"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3.5" /> Toutes les commandes clients
            </Link>
          )}
          <div className="flex flex-wrap items-end justify-between gap-4 mt-3">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-serif text-4xl">{order.number}</h1>
                <StatusChip status={order.status} />
                {order.shipmentStatus && <StatusChip status={order.shipmentStatus} />}
                {isArchived && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    Archivée
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {cfg.party} · {order.party.name}
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
                {rawOrder ? (
                  <input
                    type="date"
                    value={rawOrder.dateLivraison ?? ""}
                    disabled={deliveryMutation.isPending}
                    onChange={(e) => deliveryMutation.mutate(e.target.value)}
                    className="mt-0.5 rounded-md border border-border bg-surface px-2 py-1 text-sm num disabled:opacity-50"
                    title="Modifier la date de livraison — le solde 'net X jours' se recalcule automatiquement"
                  />
                ) : (
                  <div className="mt-0.5 num">{fmtDate(order.expectedAt)}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {rawOrder &&
                  (isClosed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={clotureMutation.isPending}
                      onClick={() => clotureMutation.mutate(false)}
                      title="Rouvrir la commande (le statut redevient calculé automatiquement)"
                    >
                      <RotateCcw /> Rouvrir
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={clotureMutation.isPending}
                      onClick={() => clotureMutation.mutate(true)}
                      title="Clôturer manuellement — le statut passe à « Clôturée » et les alertes sont masquées, même si le facturé dépasse le bon de commande."
                    >
                      <CheckCircle2 /> Clôturer
                    </Button>
                  ))}
                {rawOrder &&
                  (isArchived ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={archiveMutation.isPending}
                      onClick={() => archiveMutation.mutate(false)}
                      title="Désarchiver — la commande réapparaît dans l'échéancier et le calendrier"
                    >
                      <ArchiveRestore /> Désarchiver
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={archiveMutation.isPending}
                      onClick={() => archiveMutation.mutate(true)}
                      title="Archiver — retire la commande de l'échéancier et du calendrier, sans la supprimer"
                    >
                      <Archive /> Archiver
                    </Button>
                  ))}
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil /> Modifier
                </Button>
                {rawOrder && <OrderComments order={rawOrder} entity={entity} />}
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
            label={paidLabel}
            value={order.totals.paid}
            currency={order.currency}
            hint={`${shortMoney(remainingToPay, order.currency)} ${remainingPayLabel}`}
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
            <h3 className="font-serif text-xl mb-4">
              {isSupplier ? "Analyse des paiements" : "Analyse des encaissements"}
            </h3>
            <ul className="space-y-3 text-sm">
              <PayRow label="Total facturé" v={order.totals.invoiced} c={order.currency} />
              <PayRow
                label={isSupplier ? "Déjà payé" : "Déjà encaissé"}
                v={order.totals.paid}
                c={order.currency}
                tone="positive"
              />
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
            <DocflowEditor order={rawOrder} entity={entity} />
          ) : (
            <div className="card-elev p-6 text-sm text-muted-foreground">Chargement…</div>
          )}
        </div>
      </div>

      {rawOrder && (
        <OrderForm open={editOpen} onOpenChange={setEditOpen} order={rawOrder} entity={entity} />
      )}
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

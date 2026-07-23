import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatusChip } from "@/components/status-chip";
import { OrderForm } from "@/components/order-form";
import { ImportPanel } from "@/components/import-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ordersQueryOptions, rawOrdersQueryOptions, rawSuppliersQueryOptions } from "@/lib/data";
import { deleteOrder } from "@/lib/thalae-mutations";
import { importOrderFile } from "@/lib/thalae-import";
import { exportBackup, exportOrdersExcel, importBackup } from "@/lib/thalae-export";
import { shortMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Plus, Upload, Trash2, MoreHorizontal } from "lucide-react";

export const Route = createFileRoute("/orders/")({
  head: () => ({
    meta: [
      { title: "Commandes · Ledger" },
      {
        name: "description",
        content:
          "Toutes les commandes fournisseurs et clients, avec l'avancement de production, le montant payé et le reste à payer.",
      },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const { data: orders } = useSuspenseQuery(ordersQueryOptions());
  const { data: rawOrders } = useSuspenseQuery(rawOrdersQueryOptions());
  const { data: rawSuppliers } = useSuspenseQuery(rawSuppliersQueryOptions());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"all" | "payable" | "receivable">("all");
  const list = orders.filter((o) => tab === "all" || o.side === tab);
  const produitById = new Map(rawOrders.map((o) => [o.id, o.produit]));

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);

  const delMutation = useMutation({
    mutationFn: (id: string) => deleteOrder(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });

  const restoreMutation = useMutation({
    mutationFn: (file: File) => importBackup(file, rawOrders),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      alert(`${count} commande(s) restaurée(s).`);
    },
    onError: (e: Error) => alert(e.message || "Échec de la restauration."),
  });

  return (
    <AppShell>
      <div className="max-w-[1500px] mx-auto space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Commandes</div>
            <h1 className="font-serif text-4xl mt-1">Toutes les commandes</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 p-1 rounded-lg border border-border bg-surface">
              {(["all", "payable", "receivable"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded-md transition-colors",
                    tab === t
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "all" ? "Toutes" : t === "payable" ? "Fournisseurs" : "Clients"}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload /> Importer
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportOrdersExcel(rawOrders)}>
                  Exporter en Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportBackup(rawOrders, rawSuppliers)}>
                  Exporter une sauvegarde (JSON)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (
                      confirm(
                        "Restaurer une sauvegarde ? Les références existantes seront mises à jour, les nouvelles ajoutées. Les documents et paiements déjà enregistrés ne seront pas touchés.",
                      )
                    ) {
                      restoreRef.current?.click();
                    }
                  }}
                >
                  Restaurer une sauvegarde…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={restoreRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) restoreMutation.mutate(e.target.files[0]);
                e.target.value = "";
              }}
            />
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus /> Nouvelle commande
            </Button>
          </div>
        </div>

        <div className="card-elev overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="text-left font-medium px-5 py-3 whitespace-nowrap">
                  Référence · Fournisseur
                </th>
                <th className="text-left font-medium px-3 py-3 whitespace-nowrap">Produit</th>
                <th className="text-left font-medium px-3 py-3 whitespace-nowrap">Statut</th>
                <th className="text-left font-medium px-3 py-3 whitespace-nowrap w-36">
                  Avancement
                </th>
                <th className="text-right font-medium px-3 py-3 whitespace-nowrap">
                  Montant commandé
                </th>
                <th className="text-right font-medium px-3 py-3 whitespace-nowrap">
                  Montant facturé
                </th>
                <th className="text-right font-medium px-3 py-3 whitespace-nowrap">Montant payé</th>
                <th className="text-right font-medium px-3 py-3 whitespace-nowrap">
                  Reste à payer
                </th>
                <th className="text-right font-medium px-3 py-3 whitespace-nowrap">
                  Livraison prévue
                </th>
                <th className="px-3 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((o) => {
                const remaining = Math.max(0, o.totals.invoiced - o.totals.paid);
                return (
                  <tr
                    key={o.id}
                    onClick={() => navigate({ to: "/orders/$id", params: { id: o.id } })}
                    className="hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3.5">
                      <div className="text-sm font-medium">{o.number}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {o.party.name}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-sm text-muted-foreground truncate max-w-[220px]">
                      {produitById.get(o.id) || "—"}
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusChip status={o.status} />
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${Math.round(o.progress * 100)}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1 num">
                        {Math.round(o.progress * 100)} %
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-right font-serif text-base num">
                      {shortMoney(o.totals.ordered, o.currency)}
                    </td>
                    <td className="px-3 py-3.5 text-right font-serif text-base num">
                      {shortMoney(o.totals.invoiced, o.currency)}
                    </td>
                    <td className="px-3 py-3.5 text-right font-serif text-base num text-success">
                      {shortMoney(o.totals.paid, o.currency)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3.5 text-right font-serif text-base num",
                        remaining > 0 && "text-warning-foreground",
                      )}
                    >
                      {shortMoney(remaining, o.currency)}
                    </td>
                    <td className="px-3 py-3.5 text-right text-xs num text-muted-foreground whitespace-nowrap">
                      {fmtDate(o.expectedAt)}
                    </td>
                    <td className="px-3 py-3.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Supprimer la commande ${o.number} ?`))
                            delMutation.mutate(o.id);
                        }}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Supprimer"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    Aucune commande.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <OrderForm open={formOpen} onOpenChange={setFormOpen} />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importer des commandes</DialogTitle>
          </DialogHeader>
          <ImportPanel
            accept=".pdf,.txt,.csv"
            helpText="Bons de commande PDF/texte (extraction IA si une clé API est renseignée dans Paramètres) ou un CSV de plusieurs commandes."
            onProcessFile={importOrderFile}
          />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

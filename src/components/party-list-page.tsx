import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SupplierForm } from "@/components/supplier-form";
import { ImportPanel } from "@/components/import-panel";
import {
  ordersQueryOptions,
  rawSuppliersQueryOptions,
  customerOrdersQueryOptions,
  rawCustomersQueryOptions,
} from "@/lib/data";
import { deleteSupplier } from "@/lib/thalae-mutations";
import { importSupplierFile } from "@/lib/thalae-import";
import { shortMoney } from "@/lib/format";
import { Plus, Upload, Pencil, Trash2 } from "lucide-react";
import type { RawSupplier } from "@/lib/thalae-types";
import { ENTITIES, type Entity } from "@/lib/entities";

export function PartyListPage({ entity }: { entity: Entity }) {
  const cfg = ENTITIES[entity];
  const isSupplier = entity === "supplier";

  const { data: orders } = useSuspenseQuery(
    isSupplier ? ordersQueryOptions() : customerOrdersQueryOptions(),
  );
  const { data: rawParties } = useSuspenseQuery(
    isSupplier ? rawSuppliersQueryOptions() : rawCustomersQueryOptions(),
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RawSupplier | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);

  const delMutation = useMutation({
    mutationFn: (id: string) => deleteSupplier(id, cfg.partyTable),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cfg.partyKey }),
  });

  // Merge real party records with free-text names that only exist on orders
  // (fournisseurId is empty on historical orders) — a real record and a free-text
  // name are the same row when the name matches (case-insensitive), so counters
  // and balances aren't duplicated.
  const byNameLower = new Map(rawParties.map((s) => [(s.nom ?? "").trim().toLowerCase(), s]));
  const orderPartyNames = new Set(orders.map((o) => o.party.name.trim().toLowerCase()));

  const rows = [
    ...rawParties.map((s) => ({ party: s, name: s.nom ?? "" })),
    ...Array.from(orderPartyNames)
      .filter((n) => n && !byNameLower.has(n))
      .map((n) => ({
        party: undefined as RawSupplier | undefined,
        name: orders.find((o) => o.party.name.trim().toLowerCase() === n)!.party.name,
      })),
  ];

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }
  function openEdit(s: RawSupplier) {
    setEditing(s);
    setFormOpen(true);
  }
  function openCreateFromName(name: string) {
    setEditing({ id: "", nom: name });
    setFormOpen(true);
  }
  function openOrder(id: string) {
    return isSupplier
      ? navigate({ to: "/orders/$id", params: { id } })
      : navigate({ to: "/customer-orders/$id", params: { id } });
  }

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              {cfg.partyPlural}
            </div>
            <h1 className="font-serif text-4xl mt-1">
              Registre des {cfg.partyPlural.toLowerCase()}
            </h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload /> Importer
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus /> {cfg.newParty}
            </Button>
          </div>
        </div>

        <div className="card-elev overflow-hidden">
          {rows.length === 0 && (
            <div className="px-5 py-8 text-sm text-muted-foreground text-center">
              Aucun {cfg.party.toLowerCase()} pour l'instant.
            </div>
          )}
          {rows.map(({ party, name }) => {
            const partyOrders = orders.filter(
              (o) => o.party.name.trim().toLowerCase() === name.trim().toLowerCase(),
            );
            const outstanding = partyOrders.reduce(
              (a, o) => a + (o.totals.invoiced - o.totals.paid),
              0,
            );
            return (
              <div
                key={party?.id ?? name}
                className="grid grid-cols-12 gap-3 px-5 py-4 items-center border-b border-border last:border-0"
              >
                <div className="col-span-4">
                  <div className="font-medium">{name}</div>
                  {party?.pays && <div className="text-xs text-muted-foreground">{party.pays}</div>}
                </div>
                <div className="col-span-3 text-sm text-muted-foreground">
                  {partyOrders.length} commande{partyOrders.length > 1 ? "s" : ""}
                </div>
                <div className="col-span-2 text-right font-serif text-lg num">
                  {shortMoney(outstanding, "EUR")}
                </div>
                <div className="col-span-3 flex items-center justify-end gap-3">
                  {partyOrders[0] && (
                    <button
                      onClick={() => openOrder(partyOrders[0].id)}
                      className="text-xs text-accent hover:underline"
                    >
                      Voir →
                    </button>
                  )}
                  {party ? (
                    <>
                      <button
                        onClick={() => openEdit(party)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Modifier"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Supprimer « ${name} » ?`)) delMutation.mutate(party.id);
                        }}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Supprimer"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => openCreateFromName(name)}
                      className="text-xs text-accent hover:underline"
                    >
                      Créer une fiche
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <SupplierForm open={formOpen} onOpenChange={setFormOpen} supplier={editing} entity={entity} />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importer des {cfg.partyPlural.toLowerCase()}</DialogTitle>
          </DialogHeader>
          <ImportPanel
            accept=".pdf,.txt"
            helpText="Fiches PDF ou texte — analysées par IA si une clé API est renseignée dans Paramètres, sinon par reconnaissance de motifs simple."
            onProcessFile={(f) => importSupplierFile(f, cfg.partyTable)}
          />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

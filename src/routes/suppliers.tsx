import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SupplierForm } from "@/components/supplier-form";
import { ImportPanel } from "@/components/import-panel";
import { ordersQueryOptions, rawSuppliersQueryOptions } from "@/lib/data";
import { deleteSupplier } from "@/lib/thalae-mutations";
import { importSupplierFile } from "@/lib/thalae-import";
import { shortMoney } from "@/lib/format";
import { Plus, Upload, Pencil, Trash2 } from "lucide-react";
import type { RawSupplier } from "@/lib/thalae-types";

export const Route = createFileRoute("/suppliers")({
  head: () => ({ meta: [{ title: "Fournisseurs · Ledger" }] }),
  component: SuppliersPage,
});

function SuppliersPage() {
  const { data: orders } = useSuspenseQuery(ordersQueryOptions());
  const { data: rawSuppliers } = useSuspenseQuery(rawSuppliersQueryOptions());
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RawSupplier | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);

  const delMutation = useMutation({
    mutationFn: (id: string) => deleteSupplier(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
  });

  // Fusionne les vraies fiches fournisseur avec les noms en texte libre qui
  // n'existent que sur des commandes (fournisseurId est vide sur toutes les
  // commandes historiques) — une fiche réelle et un nom en texte libre sont
  // traités comme la même ligne quand le nom correspond (insensible à la casse),
  // pour ne pas dupliquer les compteurs/soldes.
  const byNameLower = new Map(rawSuppliers.map((s) => [(s.nom ?? "").trim().toLowerCase(), s]));
  const orderPartyNames = new Set(orders.map((o) => o.party.name.trim().toLowerCase()));

  const rows = [
    ...rawSuppliers.map((s) => ({ supplier: s, name: s.nom ?? "" })),
    ...Array.from(orderPartyNames)
      .filter((n) => n && !byNameLower.has(n))
      .map((n) => ({
        supplier: undefined as RawSupplier | undefined,
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

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Fournisseurs
            </div>
            <h1 className="font-serif text-4xl mt-1">Registre des fournisseurs</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload /> Importer
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus /> Nouveau fournisseur
            </Button>
          </div>
        </div>

        <div className="card-elev overflow-hidden">
          {rows.map(({ supplier, name }) => {
            const supOrders = orders.filter(
              (o) => o.party.name.trim().toLowerCase() === name.trim().toLowerCase(),
            );
            const outstanding = supOrders.reduce(
              (a, o) => a + (o.totals.invoiced - o.totals.paid),
              0,
            );
            return (
              <div
                key={supplier?.id ?? name}
                className="grid grid-cols-12 gap-3 px-5 py-4 items-center border-b border-border last:border-0"
              >
                <div className="col-span-4">
                  <div className="font-medium">{name}</div>
                  {supplier?.pays && (
                    <div className="text-xs text-muted-foreground">{supplier.pays}</div>
                  )}
                </div>
                <div className="col-span-3 text-sm text-muted-foreground">
                  {supOrders.length} commande{supOrders.length > 1 ? "s" : ""}
                </div>
                <div className="col-span-2 text-right font-serif text-lg num">
                  {shortMoney(outstanding, "EUR")}
                </div>
                <div className="col-span-3 flex items-center justify-end gap-3">
                  {supOrders[0] && (
                    <Link
                      to="/orders/$id"
                      params={{ id: supOrders[0].id }}
                      className="text-xs text-accent hover:underline"
                    >
                      Voir →
                    </Link>
                  )}
                  {supplier ? (
                    <>
                      <button
                        onClick={() => openEdit(supplier)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Modifier"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Supprimer le fournisseur « ${name} » ?`))
                            delMutation.mutate(supplier.id);
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

      <SupplierForm open={formOpen} onOpenChange={setFormOpen} supplier={editing} />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importer des fournisseurs</DialogTitle>
          </DialogHeader>
          <ImportPanel
            accept=".pdf,.txt"
            helpText="Fiches fournisseur PDF ou texte — analysées par IA si une clé API est renseignée dans Paramètres, sinon par reconnaissance de motifs simple."
            onProcessFile={importSupplierFile}
          />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

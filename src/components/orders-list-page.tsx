import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatusChip } from "@/components/status-chip";
import { OrderForm } from "@/components/order-form";
import { CustomerImportDialog } from "@/components/customer-import-dialog";
import { SupplierImportDialog } from "@/components/supplier-import-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  ordersQueryOptions,
  rawOrdersQueryOptions,
  rawSuppliersQueryOptions,
  customerOrdersQueryOptions,
  rawCustomerOrdersQueryOptions,
  rawCustomersQueryOptions,
} from "@/lib/data";
import { deleteOrder } from "@/lib/thalae-mutations";
import { exportBackup, exportOrdersExcel, importBackup } from "@/lib/thalae-export";
import { shortMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Plus, Upload, Trash2, MoreHorizontal, X } from "lucide-react";
import type { OrderStatus } from "@/lib/ledger-types";
import { seasonOf, seasonSortKey } from "@/lib/season";
import { ENTITIES, type Entity } from "@/lib/entities";

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: "confirmed", label: "Commande confirmée" },
  { value: "partially_shipped", label: "Expédiée partiellement" },
  { value: "partially_invoiced", label: "Facturée partiellement" },
  { value: "to_settle", label: "À solder" },
  { value: "closed", label: "Clôturée" },
];

export function OrdersListPage({ entity }: { entity: Entity }) {
  const cfg = ENTITIES[entity];
  const isSupplier = entity === "supplier";

  const { data: orders } = useSuspenseQuery(
    isSupplier ? ordersQueryOptions() : customerOrdersQueryOptions(),
  );
  const { data: rawOrders } = useSuspenseQuery(
    isSupplier ? rawOrdersQueryOptions() : rawCustomerOrdersQueryOptions(),
  );
  const { data: rawParties } = useSuspenseQuery(
    isSupplier ? rawSuppliersQueryOptions() : rawCustomersQueryOptions(),
  );

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [partyFilter, setPartyFilter] = useState<string>("all");
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const produitById = useMemo(() => new Map(rawOrders.map((o) => [o.id, o.produit])), [rawOrders]);
  const seasonById = useMemo(
    () => new Map(rawOrders.map((o) => [o.id, seasonOf(o.notes)])),
    [rawOrders],
  );

  const partyOptions = useMemo(
    () => Array.from(new Set(orders.map((o) => o.party.name))).sort((a, b) => a.localeCompare(b)),
    [orders],
  );

  const seasonOptions = useMemo(
    () =>
      Array.from(new Set(rawOrders.map((o) => seasonOf(o.notes)).filter(Boolean))).sort(
        (a, b) => seasonSortKey(a) - seasonSortKey(b),
      ),
    [rawOrders],
  );

  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (partyFilter !== "all" && o.party.name !== partyFilter) return false;
      if (seasonFilter !== "all" && (seasonById.get(o.id) || "") !== seasonFilter) return false;
      if (needle) {
        const produit = produitById.get(o.id) ?? "";
        const haystack = `${o.number} ${o.party.name} ${produit}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [orders, statusFilter, partyFilter, seasonFilter, search, produitById, seasonById]);

  const hasActiveFilters =
    statusFilter !== "all" || partyFilter !== "all" || seasonFilter !== "all" || search !== "";

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);

  const openDetail = (id: string) =>
    isSupplier
      ? navigate({ to: "/orders/$id", params: { id } })
      : navigate({ to: "/customer-orders/$id", params: { id } });

  const delMutation = useMutation({
    mutationFn: (id: string) => deleteOrder(id, cfg.ordersTable),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cfg.ordersKey }),
  });

  const restoreMutation = useMutation({
    mutationFn: (file: File) => importBackup(file, rawOrders, cfg.ordersTable),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: cfg.ordersKey });
      alert(`${count} commande(s) restaurée(s).`);
    },
    onError: (e: Error) => alert(e.message || "Échec de la restauration."),
  });

  return (
    <AppShell>
      <div className="max-w-[1500px] mx-auto space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              {cfg.ordersEyebrow}
            </div>
            <h1 className="font-serif text-4xl mt-1">{cfg.ordersTitle}</h1>
          </div>
          <div className="flex items-center gap-3">
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
                <DropdownMenuItem onClick={() => exportBackup(rawOrders, rawParties)}>
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
              <Plus /> {cfg.newOrder}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder={`Rechercher une référence, un ${cfg.party.toLowerCase()}, un produit…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as OrderStatus | "all")}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={partyFilter} onValueChange={setPartyFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder={cfg.party} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les {cfg.partyPlural.toLowerCase()}</SelectItem>
              {partyOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={seasonFilter} onValueChange={setSeasonFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Saison" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les saisons</SelectItem>
              {seasonOptions.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setStatusFilter("all");
                setPartyFilter("all");
                setSeasonFilter("all");
                setSearch("");
              }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" /> Réinitialiser les filtres
            </button>
          )}
          <div className="text-xs text-muted-foreground ml-auto">
            {list.length} commande{list.length > 1 ? "s" : ""}
          </div>
        </div>

        <div className="card-elev overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="text-left font-medium px-5 py-3 whitespace-nowrap">
                  Référence · {cfg.party}
                </th>
                <th className="text-left font-medium px-3 py-3 whitespace-nowrap">Produit</th>
                <th className="text-left font-medium px-3 py-3 whitespace-nowrap">Saison</th>
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
                <th className="text-right font-medium px-3 py-3 whitespace-nowrap">
                  {isSupplier ? "Montant payé" : "Montant encaissé"}
                </th>
                <th className="text-right font-medium px-3 py-3 whitespace-nowrap">
                  {isSupplier ? "Reste à payer" : "Reste à encaisser"}
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
                    onClick={() => openDetail(o.id)}
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
                    <td className="px-3 py-3.5 text-sm num whitespace-nowrap">
                      {seasonById.get(o.id) || <span className="text-muted-foreground">—</span>}
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
                  <td colSpan={11} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    Aucune commande.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <OrderForm open={formOpen} onOpenChange={setFormOpen} entity={entity} />

      {isSupplier ? (
        <SupplierImportDialog open={importOpen} onOpenChange={setImportOpen} entity={entity} />
      ) : (
        <CustomerImportDialog open={importOpen} onOpenChange={setImportOpen} entity={entity} />
      )}
    </AppShell>
  );
}

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { isOrderListCsv } from "@/lib/csv-orders";
import { runSupplierCsvImport, type OrderCsvReport } from "@/lib/supplier-import";
import { ENTITIES, type Entity } from "@/lib/entities";
import type { RawOrder } from "@/lib/thalae-types";

export function SupplierImportDialog({
  open,
  onOpenChange,
  entity,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entity: Entity;
}) {
  const cfg = ENTITIES[entity];
  const queryClient = useQueryClient();
  const csvRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<OrderCsvReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rawOrders = () =>
    (queryClient.getQueryData<RawOrder[]>(cfg.rawOrdersKey) ?? []) as RawOrder[];

  async function onCsv(file: File) {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const text = await file.text();
      if (!isOrderListCsv(text)) {
        throw new Error(
          "Ce fichier ne ressemble pas à un CSV de commandes (colonnes attendues : Docket, Manufacturer, Docket Qty, Total Cost, Season…).",
        );
      }
      const rep = await runSupplierCsvImport(text, rawOrders(), cfg.ordersTable);
      await queryClient.invalidateQueries({ queryKey: cfg.rawOrdersKey });
      await queryClient.invalidateQueries({ queryKey: cfg.ordersKey });
      await queryClient.refetchQueries({ queryKey: cfg.rawOrdersKey });
      setReport(rep);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) {
          onOpenChange(v);
          if (!v) {
            setReport(null);
            setError(null);
          }
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importer des commandes fournisseurs</DialogTitle>
        </DialogHeader>

        <input
          ref={csvRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) onCsv(e.target.files[0]);
            e.target.value = "";
          }}
        />

        <div className="space-y-3">
          <button
            disabled={busy}
            onClick={() => csvRef.current?.click()}
            className="w-full text-left rounded-lg border border-border hover:border-accent hover:bg-surface-2 transition-colors p-4 flex items-start gap-3 disabled:opacity-50"
          >
            <FileSpreadsheet className="size-5 text-accent shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-sm">Importer le CSV des commandes</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Le fichier « Import PO » (Docket, Manufacturer, Docket Qty, Total Cost, Delivery
                From, Season). Crée les nouvelles commandes et met à jour les existantes par numéro
                de Docket — sans doublon. Les documents déjà attachés à une commande sont conservés.
              </div>
            </div>
          </button>

          <p className="text-xs text-muted-foreground px-1">
            Les PDF (bon de commande, pro forma, livraison, facture) s'ajoutent commande par
            commande via les boutons de téléversement dans le détail de chaque commande.
          </p>

          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
              <Loader2 className="size-4 animate-spin" /> Import du CSV en cours…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive px-1">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {report && (
            <div className="rounded-lg border border-border p-3 space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-success shrink-0" /> CSV importé avec succès ✅
              </div>
              <div className="text-xs text-muted-foreground">
                {report.created} commande(s) créée(s), {report.updated} mise(s) à jour
                {report.skipped > 0 && `, ${report.skipped} ignorée(s) (sans référence)`}. (
                {report.total} ligne(s) lues.)
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

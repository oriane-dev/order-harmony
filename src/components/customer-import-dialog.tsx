import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileSpreadsheet, FileStack, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  runCustomerCsvImport,
  runCustomerPdfImport,
  type ImportReport,
  type PdfImportReport,
} from "@/lib/customer-import";
import { ENTITIES, type Entity } from "@/lib/entities";
import type { RawOrder } from "@/lib/thalae-types";

type Phase = "idle" | "csv" | "pdf" | "done";

export function CustomerImportDialog({
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
  const pdfRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [csvReport, setCsvReport] = useState<ImportReport | null>(null);
  const [pdfReport, setPdfReport] = useState<PdfImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rawOrders = () =>
    (queryClient.getQueryData<RawOrder[]>(cfg.rawOrdersKey) ?? []) as RawOrder[];

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: cfg.rawOrdersKey });
    await queryClient.invalidateQueries({ queryKey: cfg.ordersKey });
    await queryClient.refetchQueries({ queryKey: cfg.rawOrdersKey });
  }

  async function onCsv(file: File) {
    setPhase("csv");
    setError(null);
    setPdfReport(null);
    try {
      const text = await file.text();
      const report = await runCustomerCsvImport(text, rawOrders(), cfg.ordersTable);
      await refresh();
      setCsvReport(report);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }

  async function onPdfs(files: File[]) {
    if (!files.length) return;
    setPhase("pdf");
    setError(null);
    setProgress({ done: 0, total: files.length });
    try {
      const report = await runCustomerPdfImport(
        files,
        rawOrders(),
        cfg.ordersTable,
        (done, total) => setProgress({ done, total }),
      );
      await refresh();
      setPdfReport(report);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    } finally {
      setProgress(null);
    }
  }

  function reset() {
    setPhase("idle");
    setCsvReport(null);
    setPdfReport(null);
    setError(null);
    setProgress(null);
  }

  const busy = phase === "csv" || phase === "pdf";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) {
          onOpenChange(v);
          if (!v) reset();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importer des commandes clients</DialogTitle>
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
        <input
          ref={pdfRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onPdfs(Array.from(e.target.files));
            e.target.value = "";
          }}
        />

        <div className="space-y-3">
          {/* CSV */}
          <button
            disabled={busy}
            onClick={() => csvRef.current?.click()}
            className="w-full text-left rounded-lg border border-border hover:border-accent hover:bg-surface-2 transition-colors p-4 flex items-start gap-3 disabled:opacity-50"
          >
            <FileSpreadsheet className="size-5 text-accent shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-sm">1 · Importer le CSV</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Le fichier « Import Complet Sales Orders ». Crée/met à jour les commandes et
                enregistre chaque document (proforma, livraison, facture) sans doublon.
              </div>
            </div>
          </button>

          {/* PDFs */}
          <button
            disabled={busy}
            onClick={() => pdfRef.current?.click()}
            className="w-full text-left rounded-lg border border-border hover:border-accent hover:bg-surface-2 transition-colors p-4 flex items-start gap-3 disabled:opacity-50"
          >
            <FileStack className="size-5 text-accent shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-sm">2 · Importer les PDF (plusieurs à la fois)</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Sélectionne tous les fichiers d'un coup. Chaque PDF est rattaché à son document
                d'après son nom (ex. <span className="num">IN-500632-Client.pdf</span>).
              </div>
            </div>
          </button>

          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
              <Loader2 className="size-4 animate-spin" />
              {phase === "csv"
                ? "Import du CSV en cours…"
                : `Import des PDF… ${progress ? `${progress.done}/${progress.total}` : ""}`}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive px-1">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {phase === "done" && csvReport && <CsvReportView report={csvReport} />}
          {phase === "done" && pdfReport && <PdfReportView report={pdfReport} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="size-4 text-success shrink-0" />
      ) : (
        <AlertTriangle className="size-4 text-warning-foreground shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}

function ProblemList({
  title,
  items,
}: {
  title: string;
  items: { label: string; reason: string }[];
}) {
  if (!items.length) return null;
  return (
    <details className="rounded-md bg-surface-2 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-warning-foreground">
        {title} ({items.length})
      </summary>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground max-h-40 overflow-y-auto">
        {items.map((it, i) => (
          <li key={i}>
            <span className="num font-medium text-foreground">{it.label}</span> — {it.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

function CsvReportView({ report }: { report: ImportReport }) {
  const docs = Object.entries(report.docsAdded)
    .map(([t, n]) => `${n} ${t}`)
    .join(" · ");
  const clean = report.errors.length === 0 && report.skipped.length === 0;
  return (
    <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
      <Line ok={clean}>
        {clean ? "CSV importé avec succès ✅" : "CSV importé (avec des points à vérifier)"}
      </Line>
      <div className="text-xs text-muted-foreground">
        {report.ordersCreated} commande(s) créée(s), {report.ordersUpdated} mise(s) à jour.
        {docs && <> Documents ajoutés : {docs}.</>}
      </div>
      <ProblemList
        title="Erreurs (documents non rattachés)"
        items={report.errors.map((e) => ({ label: e.ref, reason: e.reason }))}
      />
      <ProblemList
        title="Ignorés (types non pris en charge)"
        items={report.skipped.map((s) => ({ label: s.docNo, reason: s.reason }))}
      />
      {report.warnings.length > 0 && (
        <ProblemList
          title="Avertissements"
          items={report.warnings.map((w) => ({ label: "•", reason: w }))}
        />
      )}
    </div>
  );
}

function PdfReportView({ report }: { report: PdfImportReport }) {
  const clean = report.unmatched.length === 0 && report.errors.length === 0;
  return (
    <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
      <Line ok={clean}>
        {clean ? "PDF importés avec succès ✅" : "PDF importés (avec des fichiers à vérifier)"}
      </Line>
      <div className="text-xs text-muted-foreground">
        {report.attached} rattaché(s)
        {report.already > 0 && <>, {report.already} déjà présent(s)</>}.
      </div>
      <ProblemList
        title="Non rattachés"
        items={report.unmatched.map((u) => ({ label: u.file, reason: u.reason }))}
      />
      <ProblemList
        title="Erreurs"
        items={report.errors.map((e) => ({ label: e.file, reason: e.reason }))}
      />
    </div>
  );
}

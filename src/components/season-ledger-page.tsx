import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Order } from "@/lib/ledger-types";
import type { RawLedger, RawLedgerEntry, RawOrder } from "@/lib/thalae-types";
import * as M from "@/lib/thalae-mutations";
import type { LedgerSection } from "@/lib/thalae-mutations";
import {
  ordersQueryOptions,
  customerOrdersQueryOptions,
  rawOrdersQueryOptions,
  rawCustomerOrdersQueryOptions,
} from "@/lib/data";
import { ENTITIES, type Entity } from "@/lib/entities";
import { fmtDate } from "@/lib/format";
import { ArrowLeft, Paperclip, Plus, Trash2, Upload, X } from "lucide-react";

const EMPTY_LEDGER: RawLedger = {
  invoices: [],
  creditNotes: [],
  deposits: [],
  payments: [],
  returns: [],
};

function eur(n: number, currency = "EUR") {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
const sumOf = (rows: RawLedgerEntry[]) => rows.reduce((a, r) => a + (Number(r.montant) || 0), 0);

// Same serialized-mutation pattern as the doc-flow editor: one write at a time per
// order so quick successive edits don't race and silently overwrite each other.
function useLedgerMutation(orderId: string, entity: Entity) {
  const queryClient = useQueryClient();
  const cfg = ENTITIES[entity];
  return useMutation({
    scope: { id: `order-mutation-${orderId}` },
    mutationFn: async (updater: (order: RawOrder) => Promise<RawOrder> | RawOrder) => {
      const orders = queryClient.getQueryData<RawOrder[]>(cfg.rawOrdersKey) ?? [];
      const current = orders.find((o) => o.id === orderId);
      if (!current) throw new Error("Fiche introuvable dans le cache.");
      const next = await updater(current);
      queryClient.setQueryData<RawOrder[]>(cfg.rawOrdersKey, (old) =>
        (old ?? []).map((o) => (o.id === orderId ? next : o)),
      );
      await M.saveOrder(next, cfg.ordersTable);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cfg.ordersKey }),
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: cfg.ordersKey });
      alert(e.message || "Une erreur est survenue.");
    },
  });
}

type Mut = ReturnType<typeof useLedgerMutation>;

/* ── PDF cell ──────────────────────────────────────────────────────────── */
function PdfCell({
  pdf,
  busy,
  onUpload,
  onDelete,
}: {
  pdf: RawLedgerEntry["pdf"];
  busy: boolean;
  onUpload: (f: File) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <input
        ref={ref}
        type="file"
        accept=".pdf,image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) onUpload(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {pdf ? (
        <>
          <a
            href={pdf.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline truncate max-w-[130px]"
            title={pdf.name}
          >
            <Paperclip className="size-3.5 shrink-0" /> PDF
          </a>
          <button
            disabled={busy}
            onClick={() => ref.current?.click()}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Remplacer"
          >
            <Upload className="size-3.5" />
          </button>
          <button
            disabled={busy}
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Retirer le PDF"
          >
            <X className="size-3.5" />
          </button>
        </>
      ) : (
        <button
          disabled={busy}
          onClick={() => ref.current?.click()}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-dashed border-border rounded-md text-muted-foreground hover:bg-surface-2"
        >
          <Upload className="size-3.5" /> PDF
        </button>
      )}
    </div>
  );
}

/* ── One editable row ──────────────────────────────────────────────────── */
function LedgerRow({
  entry,
  section,
  withDocNo,
  currency,
  mut,
  entity,
}: {
  entry: RawLedgerEntry;
  section: LedgerSection;
  withDocNo: boolean;
  currency: string;
  mut: Mut;
  entity: Entity;
}) {
  const busy = mut.isPending;
  const patch = (p: { docNo?: string; montant?: number; date?: string }) =>
    mut.mutate((o) => M.updateLedgerEntry(o, section, entry.id, p));
  return (
    <tr className="border-b border-border last:border-0">
      {withDocNo && (
        <td className="py-1.5 pr-2">
          <Input
            defaultValue={entry.docNo ?? ""}
            placeholder="N°"
            disabled={busy}
            onBlur={(e) => {
              if (e.target.value !== (entry.docNo ?? "")) patch({ docNo: e.target.value });
            }}
            className="h-8 w-full text-sm"
          />
        </td>
      )}
      <td className="py-1.5 pr-2">
        <Input
          type="number"
          step="0.01"
          defaultValue={entry.montant ?? ""}
          placeholder="0,00"
          disabled={busy}
          onBlur={(e) => {
            const v = e.target.value === "" ? undefined : Number(e.target.value);
            if (v !== entry.montant) patch({ montant: v });
          }}
          className="h-8 w-28 text-sm num text-right"
        />
      </td>
      <td className="py-1.5 pr-2">
        <Input
          type="date"
          defaultValue={entry.date ?? ""}
          disabled={busy}
          onChange={(e) => patch({ date: e.target.value })}
          className="h-8 w-[150px] text-sm num"
        />
      </td>
      <td className="py-1.5 pr-2">
        <PdfCell
          pdf={entry.pdf}
          busy={busy}
          onUpload={(f) => mut.mutate((o) => M.setLedgerEntryPdf(o, section, entry.id, f))}
          onDelete={() => mut.mutate((o) => M.clearLedgerEntryPdf(o, section, entry.id))}
        />
      </td>
      <td className="py-1.5 w-8 text-right">
        <button
          disabled={busy}
          onClick={() => mut.mutate((o) => M.removeLedgerEntry(o, section, entry.id))}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Supprimer la ligne"
        >
          <Trash2 className="size-4" />
        </button>
      </td>
    </tr>
  );
}

/* ── Add-row form ──────────────────────────────────────────────────────── */
function AddRow({
  section,
  withDocNo,
  mut,
  addLabel,
}: {
  section: LedgerSection;
  withDocNo: boolean;
  mut: Mut;
  addLabel: string;
}) {
  const [docNo, setDocNo] = useState("");
  const [montant, setMontant] = useState("");
  const [date, setDate] = useState("");
  const busy = mut.isPending;

  function add() {
    if (montant === "" && !docNo && !date) return;
    mut.mutate((o) =>
      M.addLedgerEntry(o, section, {
        docNo: withDocNo ? docNo : undefined,
        montant: montant === "" ? undefined : Number(montant),
        date: date || undefined,
      }),
    );
    setDocNo("");
    setMontant("");
    setDate("");
  }

  return (
    <tr className="bg-surface-2/40">
      {withDocNo && (
        <td className="py-2 pr-2">
          <Input
            value={docNo}
            onChange={(e) => setDocNo(e.target.value)}
            placeholder="N°"
            disabled={busy}
            className="h-8 w-full text-sm"
          />
        </td>
      )}
      <td className="py-2 pr-2">
        <Input
          type="number"
          step="0.01"
          value={montant}
          onChange={(e) => setMontant(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="0,00"
          disabled={busy}
          className="h-8 w-28 text-sm num text-right"
        />
      </td>
      <td className="py-2 pr-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={busy}
          className="h-8 w-[150px] text-sm num"
        />
      </td>
      <td className="py-2 pr-2" colSpan={2}>
        <Button size="sm" className="h-8" disabled={busy} onClick={add}>
          <Plus className="size-3.5" /> {addLabel}
        </Button>
      </td>
    </tr>
  );
}

/* ── A full section table ──────────────────────────────────────────────── */
function LedgerTable({
  title,
  rows,
  section,
  withDocNo,
  currency,
  mut,
  entity,
  addLabel,
  totalLabel,
  totalTone,
}: {
  title: string;
  rows: RawLedgerEntry[];
  section: LedgerSection;
  withDocNo: boolean;
  currency: string;
  mut: Mut;
  entity: Entity;
  addLabel: string;
  totalLabel: string;
  totalTone?: "positive" | "danger";
}) {
  const total = sumOf(rows);
  const toneCls =
    totalTone === "positive"
      ? "text-success"
      : totalTone === "danger"
        ? "text-destructive"
        : "text-foreground";
  return (
    <section className="card-elev p-5">
      <h3 className="font-serif text-xl mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground text-left">
              {withDocNo && <th className="font-medium pb-1 pr-2">N° {title.includes("voir") ? "avoir" : "facture"}</th>}
              <th className="font-medium pb-1 pr-2">Montant</th>
              <th className="font-medium pb-1 pr-2">Date</th>
              <th className="font-medium pb-1 pr-2 text-right">Justificatif</th>
              <th className="pb-1 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={withDocNo ? 5 : 4}
                  className="py-3 text-sm text-muted-foreground italic"
                >
                  Aucune ligne pour l'instant.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <LedgerRow
                key={r.id}
                entry={r}
                section={section}
                withDocNo={withDocNo}
                currency={currency}
                mut={mut}
                entity={entity}
              />
            ))}
            <AddRow section={section} withDocNo={withDocNo} mut={mut} addLabel={addLabel} />
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border">
              {withDocNo && <td></td>}
              <td className="pt-2 pr-2">
                <span className={`font-serif text-lg num ${toneCls}`}>{eur(total, currency)}</span>
              </td>
              <td className="pt-2 text-xs uppercase tracking-wider text-muted-foreground" colSpan={3}>
                {totalLabel}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ── Supporting documents (BL, pro forma…) ─────────────────────────────── */
function OtherDocuments({
  order,
  mut,
}: {
  order: RawOrder;
  mut: Mut;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const atts = order.attachments ?? [];
  const busy = mut.isPending;
  return (
    <section className="card-elev p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-serif text-xl">Autres documents</h3>
        <input
          ref={ref}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) mut.mutate((o) => M.addAttachment(o, e.target.files![0]));
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()}>
          <Plus className="size-3.5" /> Ajouter un document
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Bordereaux de livraison, pro formas et autres pièces rattachées à la saison.
      </p>
      {atts.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">Aucun document.</div>
      ) : (
        <ul className="space-y-1.5">
          {atts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-accent hover:underline truncate"
              >
                <Paperclip className="size-3.5 shrink-0" /> {a.name || "Document"}
              </a>
              <button
                disabled={busy}
                onClick={() => mut.mutate((o) => M.removeAttachment(o, a.id))}
                className="text-muted-foreground hover:text-destructive shrink-0"
                aria-label="Supprimer le document"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── The page ──────────────────────────────────────────────────────────── */
export function SeasonLedgerContent({
  order: initialOrder,
  entity,
}: {
  order: Order;
  entity: Entity;
}) {
  const cfg = ENTITIES[entity];
  const isSupplier = entity === "supplier";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: rawOrders } = useSuspenseQuery(
    isSupplier ? rawOrdersQueryOptions() : rawCustomerOrdersQueryOptions(),
  );
  const { data: liveOrders } = useSuspenseQuery(
    isSupplier ? ordersQueryOptions() : customerOrdersQueryOptions(),
  );
  const order = liveOrders.find((o) => o.id === initialOrder.id) ?? initialOrder;
  const raw = rawOrders.find((o) => o.id === order.id);
  const mut = useLedgerMutation(order.id, entity);

  const ledger = raw?.ledger ?? EMPTY_LEDGER;
  const currency = raw?.devise || "EUR";

  const invoicesTot = sumOf(ledger.invoices);
  const creditsTot = sumOf(ledger.creditNotes);
  const depositsTot = sumOf(ledger.deposits);
  const paymentsTot = sumOf(ledger.payments);
  const returnsTot = sumOf(ledger.returns ?? []);
  // Les factures de livraison excluent déjà l'acompte : les factures d'acompte
  // (deposits) font donc partie du facturé et s'AJOUTENT au total (sinon il en
  // manque). Leur paiement éventuel figure, lui, dans la table Paiements.
  const facturedNet = invoicesTot + depositsTot - creditsTot;
  const balance = facturedNet - paymentsTot - returnsTot;

  const delMutation = useMutation({
    mutationFn: () => M.deleteOrder(order.id, cfg.ordersTable),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cfg.ordersKey });
      navigate(isSupplier ? { to: "/orders" } : { to: "/customer-orders" });
    },
    onError: (e: Error) => alert(e.message || "Échec de la suppression."),
  });

  return (
    <AppShell>
      <div className="max-w-[1100px] mx-auto space-y-8">
        <div>
          <Link
            to="/customer-orders"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Toutes les commandes clients
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-4 mt-3">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-serif text-4xl">{order.number}</h1>
                <span className="inline-flex items-center rounded-full bg-accent/10 text-accent px-2.5 py-1 text-xs font-medium">
                  Registre saisonnier
                </span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {cfg.party} · {order.party.name}
                {raw?.notes && <> · {raw.notes}</>}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm(`Supprimer la fiche ${order.number} ? Cette action est irréversible.`))
                  delMutation.mutate();
              }}
            >
              <Trash2 /> Supprimer
            </Button>
          </div>
        </div>

        {/* Résumé */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard label="Total facturé" value={facturedNet} currency={currency} />
          <KpiCard label="Avoirs" value={creditsTot} currency={currency} />
          <KpiCard label="Stock rendu" value={returnsTot} currency={currency} />
          <KpiCard label="Acomptes facturés" value={depositsTot} currency={currency} />
          <KpiCard label="Paiements" value={paymentsTot} currency={currency} tone="positive" />
          <KpiCard
            label="Balance"
            value={balance}
            currency={currency}
            tone={balance > 0.01 ? "warning" : "positive"}
            hint={balance > 0.01 ? "reste à encaisser" : "soldé"}
          />
        </div>

        {/* Factures + avoirs */}
        <LedgerTable
          title="Factures"
          rows={ledger.invoices}
          section="invoices"
          withDocNo
          currency={currency}
          mut={mut}
          entity={entity}
          addLabel="Ajouter une facture"
          totalLabel="Total factures"
        />
        <LedgerTable
          title="Avoirs (credit notes)"
          rows={ledger.creditNotes}
          section="creditNotes"
          withDocNo
          currency={currency}
          mut={mut}
          entity={entity}
          addLabel="Ajouter un avoir"
          totalLabel="Total avoirs"
          totalTone="danger"
        />

        {/* Acomptes (factures d'acompte) — comptent dans le facturé */}
        <LedgerTable
          title="Acomptes (factures d'acompte)"
          rows={ledger.deposits}
          section="deposits"
          withDocNo
          currency={currency}
          mut={mut}
          entity={entity}
          addLabel="Ajouter un acompte"
          totalLabel="Total acomptes"
        />

        {/* Total facturé net */}
        <div className="card-elev p-5 flex items-center justify-between">
          <span className="font-medium">Total facturé (factures + acomptes − avoirs)</span>
          <span className="font-serif text-2xl num">{eur(facturedNet, currency)}</span>
        </div>

        {/* Paiements */}
        <LedgerTable
          title="Paiements"
          rows={ledger.payments}
          section="payments"
          withDocNo={false}
          currency={currency}
          mut={mut}
          entity={entity}
          addLabel="Ajouter un paiement"
          totalLabel="Total paiements"
          totalTone="positive"
        />

        {/* Stock rendu */}
        <LedgerTable
          title="Stock rendu"
          rows={ledger.returns ?? []}
          section="returns"
          withDocNo={false}
          currency={currency}
          mut={mut}
          entity={entity}
          addLabel="Ajouter un retour"
          totalLabel="Total stock rendu"
          totalTone="danger"
        />

        {/* Balance */}
        <div
          className={`card-elev p-6 flex items-center justify-between ${balance > 0.01 ? "border-warning/40" : "border-success/40"}`}
        >
          <div>
            <div className="font-serif text-2xl">Balance</div>
            <div className="text-sm text-muted-foreground">
              Facturé net (factures + acomptes − avoirs) − paiements − stock rendu
            </div>
          </div>
          <span
            className={`font-serif text-4xl num ${balance > 0.01 ? "text-warning-foreground" : "text-success"}`}
          >
            {eur(balance, currency)}
          </span>
        </div>

        {/* Autres documents (BL, pro forma…) */}
        {raw && <OtherDocuments order={raw} mut={mut} />}
      </div>
    </AppShell>
  );
}

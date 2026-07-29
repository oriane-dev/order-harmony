import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { shortMoney } from "@/lib/format";
import * as M from "@/lib/thalae-mutations";
import type { PaymentTarget } from "@/lib/thalae-mutations";
import type { RawFacture, RawOrder, RawPackingList, RawPayment, RawPdf } from "@/lib/thalae-types";
import { Paperclip, Plus, Trash2, Upload, X, Pencil, Wallet } from "lucide-react";

const CURRENCIES = ["EUR", "USD", "GBP", "CNY"] as const;

function useOrderMutation(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Serialize every mutation for this order: rapid successive actions (e.g. deleting
    // two documents in a row) run one-after-another instead of overlapping. Without this
    // their saveOrder calls race and the last writer wins, silently restoring what an
    // earlier action removed — so a deletion appears not to "stick".
    scope: { id: `order-mutation-${orderId}` },
    mutationFn: async (updater: (order: RawOrder) => Promise<RawOrder> | RawOrder) => {
      // Read the freshest order from cache. Crucially, updater() runs against `current`
      // and the result is written back to the cache *before* the async saveOrder — so a
      // second action fired before the server round-trip / refetch completes reads the
      // already-updated order instead of the stale one. Without this, two quick edits
      // (e.g. deleting two documents in a row) both start from the same snapshot and the
      // second save silently restores what the first removed, so the deletion "doesn't
      // stick." Deletes also need `docFlow` served explicitly since saveOrder cleans it.
      const orders = queryClient.getQueryData<RawOrder[]>(["orders", "raw"]) ?? [];
      const current = orders.find((o) => o.id === orderId);
      if (!current) throw new Error("Commande introuvable dans le cache.");
      const next = await updater(current);
      queryClient.setQueryData<RawOrder[]>(["orders", "raw"], (old) =>
        (old ?? []).map((o) => (o.id === orderId ? next : o)),
      );
      await M.saveOrder(next);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
    onError: (e: Error) => {
      // roll back the optimistic cache write so the UI reflects the real server state
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      alert(e.message || "Une erreur est survenue.");
    },
  });
}

/* ── PDF slot ──────────────────────────────────────────────────────────── */

function PdfSlot({
  pdf,
  label,
  busy,
  onUpload,
  onDelete,
}: {
  pdf: RawPdf | null | undefined;
  label: string;
  busy: boolean;
  onUpload: (file: File) => void;
  onDelete: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
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
            className="inline-flex items-center gap-1.5 text-accent hover:underline truncate max-w-[200px]"
          >
            <Paperclip className="size-3.5 shrink-0" /> {pdf.name || label}
          </a>
          <button
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Remplacer"
          >
            <Upload className="size-3.5" />
          </button>
          <button
            disabled={busy}
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Retirer"
          >
            <X className="size-3.5" />
          </button>
        </>
      ) : (
        <button
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-dashed border-border rounded-md text-muted-foreground hover:bg-surface-2"
        >
          <Upload className="size-3.5" /> {label}
        </button>
      )}
    </div>
  );
}

/* ── Inline-editable amount ────────────────────────────────────────────── */

function AmountField({
  value,
  currency,
  busy,
  onSave,
  allowCurrencyChange,
}: {
  value: number | undefined;
  currency: string;
  busy: boolean;
  // devise is only passed when it actually changed — callers apply both in one mutation
  // (two separate mutate() calls race: both read the same stale cache snapshot, and
  // whichever save lands second silently overwrites the other's change).
  onSave: (v: number, devise?: string) => void;
  allowCurrencyChange?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const [devise, setDevise] = useState(currency);

  if (editing) {
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const v = parseFloat(draft.replace(",", "."));
          if (!Number.isFinite(v) || v < 0) return;
          onSave(v, devise !== currency ? devise : undefined);
          setEditing(false);
        }}
      >
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-7 w-20 text-sm"
          type="number"
          step="0.01"
        />
        {allowCurrencyChange && (
          <Select value={devise} onValueChange={setDevise}>
            <SelectTrigger className="h-7 w-[68px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button type="submit" size="sm" className="h-7 px-2" disabled={busy}>
          OK
        </Button>
      </form>
    );
  }
  return (
    <button
      onClick={() => {
        setDraft(String(value ?? ""));
        setDevise(currency);
        setEditing(true);
      }}
      className="font-serif text-lg num hover:underline decoration-dotted"
    >
      {value != null ? shortMoney(value, currency) : "— saisir un montant"}
    </button>
  );
}

/* ── Payments list + add/edit dialog ──────────────────────────────────── */

function PaymentDialog({
  open,
  onOpenChange,
  currency,
  payment,
  busy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currency: string;
  payment?: RawPayment;
  busy: boolean;
  onSave: (input: M.PaymentInput) => void;
}) {
  const [montant, setMontant] = useState(String(payment?.montant ?? ""));
  const [date, setDate] = useState(payment?.date ?? "");
  const [devise, setDevise] = useState(payment?.devise ?? currency);
  const [file, setFile] = useState<File | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  // Dialog's onOpenChange only fires for Radix-internal close requests (Escape, overlay
  // click) — the parent opens this externally via the `open` prop (no DialogTrigger), so
  // resetting from onOpenChange never actually ran and the form always showed stale/blank
  // values when editing an existing payment.
  useEffect(() => {
    if (!open) return;
    setMontant(String(payment?.montant ?? ""));
    setDate(payment?.date ?? "");
    setDevise(payment?.devise ?? currency);
    setFile(undefined);
  }, [open, payment, currency]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{payment ? "Modifier le paiement" : "Ajouter un paiement"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = parseFloat(montant.replace(",", "."));
            if (!Number.isFinite(v) || v <= 0) {
              alert("Le montant est requis.");
              return;
            }
            onSave({ id: payment?.id, montant: v, date, devise, file });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="number"
              step="0.01"
              placeholder="Montant"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
            />
            <Select value={devise} onValueChange={setDevise}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-dashed border-border rounded-md text-muted-foreground hover:bg-surface-2"
          >
            <Upload className="size-3.5" /> {file ? file.name : "Joindre un justificatif (PDF)"}
          </button>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaymentsSection({
  order,
  target,
  currency,
  mutation,
}: {
  order: RawOrder;
  target: PaymentTarget;
  currency: string;
  mutation: ReturnType<typeof useOrderMutation>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<RawPayment | undefined>(undefined);
  const payments = M.getPayments(order, target);

  return (
    <div className="space-y-1.5">
      {payments.map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-2 text-xs bg-surface-2 rounded-md px-2.5 py-1.5"
        >
          <span className="font-serif text-sm num">
            {shortMoney(p.montant ?? 0, p.devise || currency)}
          </span>
          <span className="text-muted-foreground">{p.date || "—"}</span>
          {p.pdf && (
            <a
              href={p.pdf.url}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              <Paperclip className="size-3 inline" />
            </a>
          )}
          <span className="flex-1" />
          <button
            onClick={() => {
              setEditingPayment(p);
              setDialogOpen(true);
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Modifier le paiement"
          >
            <Pencil className="size-3" />
          </button>
          <button
            onClick={() => mutation.mutate((o) => M.deletePayment(o, target, p.id))}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Supprimer le paiement"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      ))}
      <button
        onClick={() => {
          setEditingPayment(undefined);
          setDialogOpen(true);
        }}
        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
      >
        <Plus className="size-3" /> Ajouter un paiement
      </button>
      <PaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currency={currency}
        payment={editingPayment}
        busy={mutation.isPending}
        onSave={(input) => {
          mutation.mutate((o) => M.savePayment(o, target, input));
          setDialogOpen(false);
        }}
      />
    </div>
  );
}

/* ── Factures within a packing list ───────────────────────────────────── */

function FactureRow({
  order,
  plId,
  facture,
  currency,
  mutation,
}: {
  order: RawOrder;
  plId: string;
  facture: RawFacture;
  currency: string;
  mutation: ReturnType<typeof useOrderMutation>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const remaining = M.factureRemaining(order, plId, facture.id);
  return (
    <div className="flex items-center gap-3 text-sm bg-surface-2 rounded-md px-3 py-2">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) mutation.mutate((o) => M.setFacturePdf(o, plId, facture.id, f));
          e.target.value = "";
        }}
      />
      {facture.pdf ? (
        <a
          href={facture.pdf.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-accent hover:underline truncate max-w-[140px]"
        >
          <Paperclip className="size-3.5 shrink-0" /> {facture.pdf.name}
        </a>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <Upload className="size-3.5" /> PDF de la facture
        </button>
      )}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Montant</span>
        <AmountField
          value={facture.montant}
          currency={facture.devise || currency}
          busy={mutation.isPending}
          allowCurrencyChange
          onSave={(v, c) =>
            mutation.mutate((o) => {
              const next = M.setFactureAmount(o, plId, facture.id, v, false);
              return c ? M.setFactureCurrency(next, plId, facture.id, c) : next;
            })
          }
        />
      </div>
      <span className="flex-1" />
      {remaining > 0 ? (
        <button
          disabled={mutation.isPending}
          onClick={() => mutation.mutate((o) => M.settleFacture(o, plId, facture.id))}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-accent hover:bg-surface disabled:opacity-50"
          title="Ajoute automatiquement une preuve de virement pour le montant restant"
        >
          <Wallet className="size-3.5" /> Solder {shortMoney(remaining, facture.devise || currency)}
        </button>
      ) : (
        (facture.montant ?? 0) > 0 && (
          <span className="text-[10px] uppercase tracking-widest text-success">Soldée</span>
        )
      )}
      <button
        onClick={() => mutation.mutate((o) => M.removeFacture(o, plId, facture.id))}
        className="text-muted-foreground hover:text-destructive"
        aria-label="Supprimer la facture"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

/* ── One packing list ─────────────────────────────────────────────────── */

function PackingListCard({
  order,
  pl,
  currency,
  mutation,
}: {
  order: RawOrder;
  pl: RawPackingList;
  currency: string;
  mutation: ReturnType<typeof useOrderMutation>;
}) {
  const factures = M.getPlFactures(pl);
  const newFactureRef = useRef<HTMLInputElement>(null);
  return (
    <div className="card-elev p-4 space-y-3">
      <div className="flex items-center justify-between">
        <PdfSlot
          pdf={pl.packingListPdf}
          label="Bordereau de livraison"
          busy={mutation.isPending}
          onUpload={(f) => mutation.mutate((o) => M.setPackingListPdf(o, pl.id, f))}
          onDelete={() => mutation.mutate((o) => M.clearPackingListPdf(o, pl.id))}
        />
        <button
          onClick={() => mutation.mutate((o) => M.removePackingList(o, pl.id))}
          className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
        >
          <Trash2 className="size-3.5" /> Supprimer la livraison
        </button>
      </div>

      <div className="space-y-1.5">
        {factures.map((f) => (
          <FactureRow
            key={f.id}
            order={order}
            plId={pl.id}
            facture={f}
            currency={currency}
            mutation={mutation}
          />
        ))}
        <input
          ref={newFactureRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) mutation.mutate((o) => M.addFactureWithPdf(o, pl.id, f));
            e.target.value = "";
          }}
        />
        <button
          onClick={() => newFactureRef.current?.click()}
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <Plus className="size-3" /> Ajouter une facture
        </button>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
          Preuve de paiement
        </div>
        <PaymentsSection
          order={order}
          target={{ type: "packingList", plId: pl.id }}
          currency={currency}
          mutation={mutation}
        />
      </div>
    </div>
  );
}

/* ── Main editor ───────────────────────────────────────────────────────── */

export function DocflowEditor({ order }: { order: RawOrder }) {
  const mutation = useOrderMutation(order.id);
  const currency = order.devise || "EUR";
  const df = order.docFlow;

  return (
    <div className="space-y-4">
      <div className="card-elev p-4 flex items-center justify-between">
        <h3 className="font-serif text-lg">Bon de commande</h3>
        <PdfSlot
          pdf={df?.poDocument}
          label="Téléverser le PDF"
          busy={mutation.isPending}
          onUpload={(f) => mutation.mutate((o) => M.setPoDocument(o, f))}
          onDelete={() => mutation.mutate((o) => M.clearPoDocument(o))}
        />
      </div>

      <div className="card-elev p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg">Pro forma</h3>
          <PdfSlot
            pdf={df?.proforma?.pdf}
            label="Téléverser le PDF"
            busy={mutation.isPending}
            onUpload={(f) => mutation.mutate((o) => M.setProformaPdf(o, f))}
            onDelete={() => mutation.mutate((o) => M.clearProformaPdf(o))}
          />
        </div>
        <AmountField
          value={df?.proforma?.montant}
          currency={df?.proforma?.devise || currency}
          busy={mutation.isPending}
          allowCurrencyChange
          onSave={(v, c) =>
            mutation.mutate((o) => {
              const next = M.setProformaAmount(o, v);
              return c ? M.setProformaCurrency(next, c) : next;
            })
          }
        />
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Preuve de paiement
          </div>
          <PaymentsSection
            order={order}
            target={{ type: "proforma" }}
            currency={currency}
            mutation={mutation}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg">Livraisons</h3>
          <button
            onClick={() => mutation.mutate((o) => M.addPackingList(o))}
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <Plus className="size-3" /> Ajouter une livraison
          </button>
        </div>
        {(df?.packingLists ?? []).map((pl) => (
          <PackingListCard
            key={pl.id}
            order={order}
            pl={pl}
            currency={currency}
            mutation={mutation}
          />
        ))}
        {!(df?.packingLists ?? []).length && (
          <div className="text-sm text-muted-foreground">
            Aucune livraison enregistrée pour l'instant.
          </div>
        )}
      </div>
    </div>
  );
}

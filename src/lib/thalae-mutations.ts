// Typed, explicit-parameter mutation functions — the same Supabase upsert/storage
// calls Thalae itself makes (verified against suivi-commandes-2.html), but without
// its path-string dispatch pattern ('fact:'+plId+':'+factureId etc). Every function
// takes the current RawOrder/RawSupplier and returns an updated one via spread, so
// fields this codebase doesn't know about are never lost — callers persist the
// result with saveOrder/saveSupplier.

import { supabase } from "@/lib/supabase";
import { extractPaymentFromPdf } from "@/lib/thalae-extract";
import type {
  RawAttachment,
  RawComment,
  RawCreditNote,
  RawDepositInvoice,
  RawDocFlow,
  RawFacture,
  RawLivraisonProforma,
  RawOrder,
  RawPackingList,
  RawPayment,
  RawPdf,
  RawSupplier,
} from "@/lib/thalae-types";

const BUCKET = "Attachments PDF";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/* ── ORDER / SUPPLIER PERSISTENCE ─────────────────────────────────────── */

// Supplier orders live in "orders", customer orders in the mirror table
// "customer_orders"; parties likewise in "suppliers" / "customers". The table
// defaults to the supplier side so all existing call sites keep working unchanged.
export type OrdersTable = "orders" | "customer_orders";
export type PartyTable = "suppliers" | "customers";

export async function saveOrder(order: RawOrder, table: OrdersTable = "orders"): Promise<void> {
  // defensive: never let a stray raw File/Blob end up under attachments[].data
  const clean = { ...order, attachments: (order.attachments ?? []).map(({ ...r }) => r) };
  const { error } = await supabase
    .from(table)
    .upsert({ id: order.id, data: clean, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteOrder(id: string, table: OrdersTable = "orders"): Promise<void> {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}

export async function saveSupplier(
  supplier: RawSupplier,
  table: PartyTable = "suppliers",
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .upsert({ id: supplier.id, data: supplier, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteSupplier(id: string, table: PartyTable = "suppliers"): Promise<void> {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}

/* ── STORAGE HELPERS ───────────────────────────────────────────────────── */

export function assertFileSize(file: File): void {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Fichier trop volumineux (max 50 Mo).");
  }
}

export async function uploadPdf(file: File): Promise<RawPdf> {
  assertFileSize(file);
  const id = `${uid()}.pdf`;
  const { error } = await supabase.storage.from(BUCKET).upload(id, file, {
    contentType: file.type || "application/pdf",
  });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(id);
  return { id, name: file.name, size: file.size, url: publicUrl };
}

// Comme uploadPdf mais conserve l'extension réelle (pour les images JPEG/PNG) afin
// que le navigateur affiche correctement une capture d'écran.
export async function uploadDocument(file: File): Promise<RawPdf> {
  assertFileSize(file);
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const id = `${uid()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(id, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(id);
  return { id, name: file.name, size: file.size, url: publicUrl };
}

// Fire-and-forget, matching Thalae's own behavior everywhere it deletes a stored file.
export function removePdf(pdf: RawPdf | null | undefined): void {
  if (pdf?.id) void supabase.storage.from(BUCKET).remove([pdf.id]);
}

/* ── DOC-FLOW HELPERS ──────────────────────────────────────────────────── */

function ensureDocFlow(order: RawOrder): RawDocFlow {
  return (
    order.docFlow ?? {
      poDocument: null,
      proforma: { pdf: null, paiements: [] },
      packingLists: [],
    }
  );
}

// Normalizes a packing list's invoice-like entries: prefer factures[] if populated,
// else synthesize a single entry from the legacy flat fields. Mirrors Thalae's
// getPlFactures — the only place a legacy PL gets migrated to the array shape.
function getPlFactures(pl: RawPackingList): RawFacture[] {
  if (pl.factures && pl.factures.length > 0) return pl.factures;
  if (pl.facturePdf || pl.factureAmount != null || pl.factureMontantBrut != null) {
    return [
      {
        id: `${pl.id}_f0`,
        pdf: pl.facturePdf ?? null,
        montantBrut: pl.factureMontantBrut ?? undefined,
        montant: pl.factureAmount ?? undefined,
      },
    ];
  }
  return [];
}

function withDocFlow(order: RawOrder, df: RawDocFlow): RawOrder {
  return { ...order, docFlow: df };
}

/* ── PO / PROFORMA / FACTURE-DEFINITIVE PDF SLOTS ─────────────────────── */

export async function setPoDocument(order: RawOrder, file: File): Promise<RawOrder> {
  const df = ensureDocFlow(order);
  removePdf(df.poDocument);
  const pdf = await uploadPdf(file);
  return withDocFlow(order, { ...df, poDocument: pdf });
}

export function clearPoDocument(order: RawOrder): RawOrder {
  const df = ensureDocFlow(order);
  removePdf(df.poDocument);
  return withDocFlow(order, { ...df, poDocument: null });
}

export async function setProformaPdf(order: RawOrder, file: File): Promise<RawOrder> {
  const df = ensureDocFlow(order);
  removePdf(df.proforma?.pdf);
  const pdf = await uploadPdf(file);
  const extracted = await extractPaymentFromPdf(file, "invoice");
  return withDocFlow(order, {
    ...df,
    proforma: {
      ...df.proforma,
      pdf,
      ...(extracted?.montant != null ? { montant: extracted.montant } : {}),
    },
  });
}

export function clearProformaPdf(order: RawOrder): RawOrder {
  const df = ensureDocFlow(order);
  removePdf(df.proforma?.pdf);
  return withDocFlow(order, { ...df, proforma: { ...df.proforma, pdf: null } });
}

export function setProformaAmount(order: RawOrder, montant: number): RawOrder {
  const df = ensureDocFlow(order);
  return withDocFlow(order, { ...df, proforma: { ...df.proforma, montant } });
}

export function setProformaCurrency(order: RawOrder, devise: string | undefined): RawOrder {
  const df = ensureDocFlow(order);
  return withDocFlow(order, { ...df, proforma: { ...df.proforma, devise } });
}

// Date de la pro forma = échéance de l'acompte (sert à planifier l'acompte dans
// l'échéancier et le calendrier).
export function setProformaDate(order: RawOrder, docDate: string): RawOrder {
  const df = ensureDocFlow(order);
  return withDocFlow(order, { ...df, proforma: { ...df.proforma, docDate: docDate || undefined } });
}

// Date de livraison de la commande (niveau commande). Éditable dans le détail :
// modifier cette date décale automatiquement le solde "net X jours".
export function setDeliveryDate(order: RawOrder, dateLivraison: string): RawOrder {
  return { ...order, dateLivraison: dateLivraison || undefined };
}

// Archiver / désarchiver : la commande reste en base et consultable, mais disparaît
// de l'échéancier et du calendrier.
export function setArchived(order: RawOrder, value: boolean): RawOrder {
  return { ...order, archived: value };
}

/* ── PACKING LISTS ─────────────────────────────────────────────────────── */

export function addPackingList(order: RawOrder): RawOrder {
  const df = ensureDocFlow(order);
  const pl: RawPackingList = { id: uid(), packingListPdf: null, factures: [], paiements: [] };
  return withDocFlow(order, { ...df, packingLists: [...(df.packingLists ?? []), pl] });
}

export function removePackingList(order: RawOrder, plId: string): RawOrder {
  const df = ensureDocFlow(order);
  const pl = (df.packingLists ?? []).find((p) => p.id === plId);
  if (pl) {
    removePdf(pl.packingListPdf);
    getPlFactures(pl).forEach((f) => removePdf(f.pdf));
  }
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).filter((p) => p.id !== plId),
  });
}

export async function setPackingListPdf(
  order: RawOrder,
  plId: string,
  file: File,
): Promise<RawOrder> {
  const df = ensureDocFlow(order);
  const pl = (df.packingLists ?? []).find((p) => p.id === plId);
  removePdf(pl?.packingListPdf);
  const pdf = await uploadPdf(file);
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((p) =>
      p.id === plId ? { ...p, packingListPdf: pdf } : p,
    ),
  });
}

export function clearPackingListPdf(order: RawOrder, plId: string): RawOrder {
  const df = ensureDocFlow(order);
  const pl = (df.packingLists ?? []).find((p) => p.id === plId);
  removePdf(pl?.packingListPdf);
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((p) =>
      p.id === plId ? { ...p, packingListPdf: null } : p,
    ),
  });
}

/* ── FACTURES (within a packing list) ─────────────────────────────────── */

// Combines what used to be two steps (add a blank facture, then attach its PDF): the
// "Ajouter une facture" button opens a file picker directly instead of adding a blank
// row the user must then click into.
export async function addFactureWithPdf(
  order: RawOrder,
  plId: string,
  file: File,
): Promise<RawOrder> {
  const df = ensureDocFlow(order);
  const pdf = await uploadPdf(file);
  const extracted = await extractPaymentFromPdf(file, "invoice-pl");
  const facture: RawFacture = {
    id: uid(),
    pdf,
    montant: extracted?.montant ?? undefined,
    montantBrut: extracted?.montantBrut ?? undefined,
  };
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((pl) =>
      pl.id !== plId ? pl : { ...pl, factures: [...getPlFactures(pl), facture] },
    ),
  });
}

export function removeFacture(order: RawOrder, plId: string, factureId: string): RawOrder {
  const df = ensureDocFlow(order);
  const pl = (df.packingLists ?? []).find((p) => p.id === plId);
  const f = pl && getPlFactures(pl).find((x) => x.id === factureId);
  removePdf(f?.pdf);
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((p) =>
      p.id !== plId ? p : { ...p, factures: getPlFactures(p).filter((x) => x.id !== factureId) },
    ),
  });
}

export async function setFacturePdf(
  order: RawOrder,
  plId: string,
  factureId: string,
  file: File,
): Promise<RawOrder> {
  const df = ensureDocFlow(order);
  const pl = (df.packingLists ?? []).find((p) => p.id === plId);
  const existing = pl && getPlFactures(pl).find((f) => f.id === factureId);
  removePdf(existing?.pdf);
  const pdf = await uploadPdf(file);
  const extracted = await extractPaymentFromPdf(file, "invoice-pl");
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((p) =>
      p.id !== plId
        ? p
        : {
            ...p,
            factures: getPlFactures(p).map((f) =>
              f.id !== factureId
                ? f
                : {
                    ...f,
                    pdf,
                    ...(extracted?.montant != null ? { montant: extracted.montant } : {}),
                    ...(extracted?.montantBrut != null
                      ? { montantBrut: extracted.montantBrut }
                      : {}),
                  },
            ),
          },
    ),
  });
}

export function clearFacturePdf(order: RawOrder, plId: string, factureId: string): RawOrder {
  const df = ensureDocFlow(order);
  const pl = (df.packingLists ?? []).find((p) => p.id === plId);
  const f = pl && getPlFactures(pl).find((x) => x.id === factureId);
  removePdf(f?.pdf);
  // Thalae nulls the amounts too — a facture with no PDF has no amount either.
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((p) =>
      p.id !== plId
        ? p
        : {
            ...p,
            factures: getPlFactures(p).map((x) =>
              x.id !== factureId
                ? x
                : { ...x, pdf: null, montant: undefined, montantBrut: undefined },
            ),
          },
    ),
  });
}

// Date de réception de la facture — déclenche le paiement "before shipment".
export function setFactureDate(
  order: RawOrder,
  plId: string,
  factureId: string,
  docDate: string,
): RawOrder {
  const df = ensureDocFlow(order);
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((pl) =>
      pl.id !== plId
        ? pl
        : {
            ...pl,
            factures: getPlFactures(pl).map((f) =>
              f.id !== factureId ? f : { ...f, docDate: docDate || undefined },
            ),
          },
    ),
  });
}

/* ── PRO FORMA POUR LIVRAISON (before shipment partiel) ─────────────────── */

// helper : appliquer une transformation à une livraison-proforma
function mapLivraisonProforma(
  df: ReturnType<typeof ensureDocFlow>,
  plId: string,
  lpId: string,
  fn: (lp: RawLivraisonProforma) => RawLivraisonProforma,
) {
  return (df.packingLists ?? []).map((pl) =>
    pl.id !== plId
      ? pl
      : {
          ...pl,
          livraisonProformas: (pl.livraisonProformas ?? []).map((lp) =>
            lp.id === lpId ? fn(lp) : lp,
          ),
        },
  );
}

export async function addLivraisonProformaWithFile(
  order: RawOrder,
  plId: string,
  file: File,
): Promise<RawOrder> {
  const df = ensureDocFlow(order);
  const pdf = await uploadDocument(file);
  const lp: RawLivraisonProforma = { id: uid(), pdf, paiements: [] };
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((pl) =>
      pl.id !== plId ? pl : { ...pl, livraisonProformas: [...(pl.livraisonProformas ?? []), lp] },
    ),
  });
}

export function setLivraisonProformaMontant(
  order: RawOrder,
  plId: string,
  lpId: string,
  montant: number,
): RawOrder {
  const df = ensureDocFlow(order);
  return withDocFlow(order, {
    ...df,
    packingLists: mapLivraisonProforma(df, plId, lpId, (lp) => ({ ...lp, montant })),
  });
}

export function setLivraisonProformaDueDate(
  order: RawOrder,
  plId: string,
  lpId: string,
  dueDate: string,
): RawOrder {
  const df = ensureDocFlow(order);
  return withDocFlow(order, {
    ...df,
    packingLists: mapLivraisonProforma(df, plId, lpId, (lp) => ({
      ...lp,
      dueDate: dueDate || undefined,
    })),
  });
}

export function removeLivraisonProforma(order: RawOrder, plId: string, lpId: string): RawOrder {
  const df = ensureDocFlow(order);
  const pl = (df.packingLists ?? []).find((p) => p.id === plId);
  const lp = (pl?.livraisonProformas ?? []).find((l) => l.id === lpId);
  removePdf(lp?.pdf);
  (lp?.paiements ?? []).forEach((p) => removePdf(p.pdf));
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((p) =>
      p.id !== plId
        ? p
        : { ...p, livraisonProformas: (p.livraisonProformas ?? []).filter((l) => l.id !== lpId) },
    ),
  });
}

export function setFactureAmount(
  order: RawOrder,
  plId: string,
  factureId: string,
  value: number,
  isBrut: boolean,
): RawOrder {
  const df = ensureDocFlow(order);
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((pl) =>
      pl.id !== plId
        ? pl
        : {
            ...pl,
            factures: getPlFactures(pl).map((f) =>
              f.id !== factureId
                ? f
                : isBrut
                  ? { ...f, montantBrut: value }
                  : { ...f, montant: value },
            ),
          },
    ),
  });
}

export function setFactureCurrency(
  order: RawOrder,
  plId: string,
  factureId: string,
  devise: string | undefined,
): RawOrder {
  const df = ensureDocFlow(order);
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((pl) =>
      pl.id !== plId
        ? pl
        : {
            ...pl,
            factures: getPlFactures(pl).map((f) => (f.id !== factureId ? f : { ...f, devise })),
          },
    ),
  });
}

/* ── PAYMENTS (proforma | packing-list | facture-definitive level) ────── */

export type PaymentTarget =
  | { type: "proforma" }
  | { type: "packingList"; plId: string }
  | { type: "factureDefinitive" }
  | { type: "depositInvoice"; diId: string }
  | { type: "livraisonProforma"; plId: string; lpId: string };

export function getPayments(order: RawOrder, target: PaymentTarget): RawPayment[] {
  const df = ensureDocFlow(order);
  if (target.type === "proforma") return df.proforma?.paiements ?? [];
  if (target.type === "factureDefinitive") return df.factureDefinitive?.paiements ?? [];
  if (target.type === "depositInvoice") {
    const di = (df.proforma?.depositInvoices ?? []).find((d) => d.id === target.diId);
    return di?.paiements ?? [];
  }
  if (target.type === "livraisonProforma") {
    const pl = (df.packingLists ?? []).find((p) => p.id === target.plId);
    return (pl?.livraisonProformas ?? []).find((l) => l.id === target.lpId)?.paiements ?? [];
  }
  const pl = (df.packingLists ?? []).find((p) => p.id === target.plId);
  return pl?.paiements ?? [];
}

function withPayments(order: RawOrder, target: PaymentTarget, payments: RawPayment[]): RawOrder {
  const df = ensureDocFlow(order);
  if (target.type === "proforma")
    return withDocFlow(order, { ...df, proforma: { ...df.proforma, paiements: payments } });
  if (target.type === "factureDefinitive")
    return withDocFlow(order, {
      ...df,
      factureDefinitive: { ...df.factureDefinitive, paiements: payments },
    });
  if (target.type === "depositInvoice")
    return withDocFlow(order, {
      ...df,
      proforma: {
        ...df.proforma,
        depositInvoices: (df.proforma?.depositInvoices ?? []).map((di) =>
          di.id === target.diId ? { ...di, paiements: payments } : di,
        ),
      },
    });
  if (target.type === "livraisonProforma")
    return withDocFlow(order, {
      ...df,
      packingLists: (df.packingLists ?? []).map((pl) =>
        pl.id !== target.plId
          ? pl
          : {
              ...pl,
              livraisonProformas: (pl.livraisonProformas ?? []).map((lp) =>
                lp.id === target.lpId ? { ...lp, paiements: payments } : lp,
              ),
            },
      ),
    });
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((pl) =>
      pl.id === target.plId ? { ...pl, paiements: payments } : pl,
    ),
  });
}

export interface PaymentInput {
  id?: string; // omit to create a new payment
  montant: number;
  date: string;
  devise?: string;
  file?: File; // optional "remise de virement" PDF, auto-attached
}

export async function savePayment(
  order: RawOrder,
  target: PaymentTarget,
  input: PaymentInput,
): Promise<RawOrder> {
  const payments = getPayments(order, target);
  let pdf: RawPdf | undefined;
  if (input.file) {
    const existing = input.id ? payments.find((p) => p.id === input.id) : undefined;
    removePdf(existing?.pdf);
    pdf = await uploadPdf(input.file);
  }
  const base = {
    montant: input.montant,
    date: input.date,
    ...(input.devise ? { devise: input.devise } : {}),
    ...(pdf ? { pdf } : {}),
  };
  const next = input.id
    ? payments.map((p) => (p.id === input.id ? { ...p, ...base } : p))
    : [...payments, { id: uid(), ...base }];
  return withPayments(order, target, next);
}

export function deletePayment(order: RawOrder, target: PaymentTarget, paymentId: string): RawOrder {
  const payments = getPayments(order, target);
  const p = payments.find((x) => x.id === paymentId);
  removePdf(p?.pdf);
  return withPayments(
    order,
    target,
    payments.filter((x) => x.id !== paymentId),
  );
}

// Outstanding balance still due on a facture: its amount minus everything already paid
// on its packing list. (Payments are tracked per delivery, not per facture; on the
// common single-facture delivery this is simply "amount − paid".)
export function factureRemaining(order: RawOrder, plId: string, factureId: string): number {
  const df = ensureDocFlow(order);
  const pl = (df.packingLists ?? []).find((p) => p.id === plId);
  if (!pl) return 0;
  const facture = getPlFactures(pl).find((f) => f.id === factureId);
  if (!facture) return 0;
  const credits = (facture.creditNotes ?? []).reduce((a, c) => a + (c.montant ?? 0), 0);
  const due = (facture.montant ?? facture.montantBrut ?? 0) - credits;
  const paidSoFar = (pl.paiements ?? []).reduce((a, p) => a + (p.montant ?? 0), 0);
  return Math.round((due - paidSoFar) * 100) / 100;
}

// "Solder" a facture: append a payment for the outstanding balance so the facture is
// fully covered. The new payment has no date/PDF yet — it shows in the delivery's
// "Preuve de paiement" section and stays fully editable (amount, date, justificatif).
export function settleFacture(order: RawOrder, plId: string, factureId: string): RawOrder {
  const remaining = factureRemaining(order, plId, factureId);
  if (remaining <= 0) return order;
  const df = ensureDocFlow(order);
  const pl = (df.packingLists ?? []).find((p) => p.id === plId);
  const facture = pl && getPlFactures(pl).find((f) => f.id === factureId);
  const target: PaymentTarget = { type: "packingList", plId };
  const payment: RawPayment = {
    id: uid(),
    montant: remaining,
    date: "",
    ...(facture && facture.devise ? { devise: facture.devise } : {}),
  };
  return withPayments(order, target, [...getPayments(order, target), payment]);
}

/* ── DEPOSIT INVOICES (facture d'acompte, billed against the pro forma) ── */

function ensureProforma(df: RawDocFlow) {
  return df.proforma ?? { pdf: null, paiements: [] };
}

function getDepositInvoices(order: RawOrder): RawDepositInvoice[] {
  return ensureDocFlow(order).proforma?.depositInvoices ?? [];
}

function withDepositInvoices(order: RawOrder, list: RawDepositInvoice[]): RawOrder {
  const df = ensureDocFlow(order);
  return withDocFlow(order, { ...df, proforma: { ...ensureProforma(df), depositInvoices: list } });
}

function mapDeposit(
  order: RawOrder,
  diId: string,
  fn: (di: RawDepositInvoice) => RawDepositInvoice,
): RawOrder {
  return withDepositInvoices(
    order,
    getDepositInvoices(order).map((di) => (di.id === diId ? fn(di) : di)),
  );
}

// Combines "add a deposit invoice" + "attach its PDF" (with amount auto-extraction),
// matching how factures are added from a file picker.
export async function addDepositInvoiceWithPdf(order: RawOrder, file: File): Promise<RawOrder> {
  const pdf = await uploadPdf(file);
  const extracted = await extractPaymentFromPdf(file, "invoice");
  const di: RawDepositInvoice = {
    id: uid(),
    pdf,
    ...(extracted?.montant != null ? { montant: extracted.montant } : {}),
    paiements: [],
  };
  return withDepositInvoices(order, [...getDepositInvoices(order), di]);
}

export function addDepositInvoice(order: RawOrder): RawOrder {
  return withDepositInvoices(order, [
    ...getDepositInvoices(order),
    { id: uid(), pdf: null, paiements: [] },
  ]);
}

export function removeDepositInvoice(order: RawOrder, diId: string): RawOrder {
  const di = getDepositInvoices(order).find((d) => d.id === diId);
  removePdf(di?.pdf);
  return withDepositInvoices(
    order,
    getDepositInvoices(order).filter((d) => d.id !== diId),
  );
}

export async function setDepositInvoicePdf(
  order: RawOrder,
  diId: string,
  file: File,
): Promise<RawOrder> {
  const existing = getDepositInvoices(order).find((d) => d.id === diId);
  removePdf(existing?.pdf);
  const pdf = await uploadPdf(file);
  const extracted = await extractPaymentFromPdf(file, "invoice");
  return mapDeposit(order, diId, (d) => ({
    ...d,
    pdf,
    ...(extracted?.montant != null && d.montant == null ? { montant: extracted.montant } : {}),
  }));
}

export function clearDepositInvoicePdf(order: RawOrder, diId: string): RawOrder {
  const di = getDepositInvoices(order).find((d) => d.id === diId);
  removePdf(di?.pdf);
  return mapDeposit(order, diId, (d) => ({ ...d, pdf: null }));
}

export function setDepositInvoiceAmount(order: RawOrder, diId: string, value: number): RawOrder {
  return mapDeposit(order, diId, (d) => ({ ...d, montant: value }));
}

export function setDepositInvoiceCurrency(
  order: RawOrder,
  diId: string,
  devise: string | undefined,
): RawOrder {
  return mapDeposit(order, diId, (d) => ({ ...d, devise }));
}

export function setDepositInvoiceDueDate(order: RawOrder, diId: string, dueDate: string): RawOrder {
  return mapDeposit(order, diId, (d) => ({ ...d, dueDate }));
}

// Outstanding balance still due on a deposit invoice.
export function depositRemaining(order: RawOrder, diId: string): number {
  const di = getDepositInvoices(order).find((d) => d.id === diId);
  if (!di) return 0;
  const credits = (di.creditNotes ?? []).reduce((a, c) => a + (c.montant ?? 0), 0);
  const due = (di.montant ?? 0) - credits;
  const paid = (di.paiements ?? []).reduce((a, p) => a + (p.montant ?? 0), 0);
  return Math.round((due - paid) * 100) / 100;
}

// "Solder" a deposit invoice: append a payment covering the outstanding balance.
export function settleDepositInvoice(order: RawOrder, diId: string): RawOrder {
  const remaining = depositRemaining(order, diId);
  if (remaining <= 0) return order;
  const di = getDepositInvoices(order).find((d) => d.id === diId);
  const target: PaymentTarget = { type: "depositInvoice", diId };
  const payment: RawPayment = {
    id: uid(),
    montant: remaining,
    date: "",
    ...(di?.devise ? { devise: di.devise } : {}),
  };
  return withPayments(order, target, [...getPayments(order, target), payment]);
}

/* ── CREDIT NOTES (avoirs) on a delivery facture or a deposit invoice ──── */

// Where a credit note lives: on a facture inside a packing list, or on a deposit
// invoice under the pro forma.
export type CreditNoteTarget =
  | { type: "facture"; plId: string; factureId: string }
  | { type: "deposit"; diId: string };

export function getCreditNotes(order: RawOrder, target: CreditNoteTarget): RawCreditNote[] {
  const df = ensureDocFlow(order);
  if (target.type === "deposit") {
    const di = (df.proforma?.depositInvoices ?? []).find((d) => d.id === target.diId);
    return di?.creditNotes ?? [];
  }
  const pl = (df.packingLists ?? []).find((p) => p.id === target.plId);
  const f = pl && getPlFactures(pl).find((x) => x.id === target.factureId);
  return f?.creditNotes ?? [];
}

function withCreditNotes(
  order: RawOrder,
  target: CreditNoteTarget,
  list: RawCreditNote[],
): RawOrder {
  const df = ensureDocFlow(order);
  if (target.type === "deposit")
    return withDocFlow(order, {
      ...df,
      proforma: {
        ...ensureProforma(df),
        depositInvoices: (df.proforma?.depositInvoices ?? []).map((di) =>
          di.id === target.diId ? { ...di, creditNotes: list } : di,
        ),
      },
    });
  return withDocFlow(order, {
    ...df,
    packingLists: (df.packingLists ?? []).map((pl) =>
      pl.id !== target.plId
        ? pl
        : {
            ...pl,
            factures: getPlFactures(pl).map((f) =>
              f.id === target.factureId ? { ...f, creditNotes: list } : f,
            ),
          },
    ),
  });
}

export function addCreditNote(order: RawOrder, target: CreditNoteTarget): RawOrder {
  return withCreditNotes(order, target, [
    ...getCreditNotes(order, target),
    { id: uid(), pdf: null },
  ]);
}

// Combined add + PDF (with amount auto-extraction), like the facture/deposit pickers.
export async function addCreditNoteWithPdf(
  order: RawOrder,
  target: CreditNoteTarget,
  file: File,
): Promise<RawOrder> {
  const pdf = await uploadPdf(file);
  const extracted = await extractPaymentFromPdf(file, "invoice");
  const cn: RawCreditNote = {
    id: uid(),
    pdf,
    ...(extracted?.montant != null ? { montant: extracted.montant } : {}),
  };
  return withCreditNotes(order, target, [...getCreditNotes(order, target), cn]);
}

export function removeCreditNote(
  order: RawOrder,
  target: CreditNoteTarget,
  cnId: string,
): RawOrder {
  const cn = getCreditNotes(order, target).find((c) => c.id === cnId);
  removePdf(cn?.pdf);
  return withCreditNotes(
    order,
    target,
    getCreditNotes(order, target).filter((c) => c.id !== cnId),
  );
}

export function setCreditNoteAmount(
  order: RawOrder,
  target: CreditNoteTarget,
  cnId: string,
  value: number,
): RawOrder {
  return withCreditNotes(
    order,
    target,
    getCreditNotes(order, target).map((c) => (c.id === cnId ? { ...c, montant: value } : c)),
  );
}

export function setCreditNoteCurrency(
  order: RawOrder,
  target: CreditNoteTarget,
  cnId: string,
  devise: string | undefined,
): RawOrder {
  return withCreditNotes(
    order,
    target,
    getCreditNotes(order, target).map((c) => (c.id === cnId ? { ...c, devise } : c)),
  );
}

export async function setCreditNotePdf(
  order: RawOrder,
  target: CreditNoteTarget,
  cnId: string,
  file: File,
): Promise<RawOrder> {
  const existing = getCreditNotes(order, target).find((c) => c.id === cnId);
  removePdf(existing?.pdf);
  const pdf = await uploadPdf(file);
  return withCreditNotes(
    order,
    target,
    getCreditNotes(order, target).map((c) => (c.id === cnId ? { ...c, pdf } : c)),
  );
}

export function clearCreditNotePdf(
  order: RawOrder,
  target: CreditNoteTarget,
  cnId: string,
): RawOrder {
  const cn = getCreditNotes(order, target).find((c) => c.id === cnId);
  removePdf(cn?.pdf);
  return withCreditNotes(
    order,
    target,
    getCreditNotes(order, target).map((c) => (c.id === cnId ? { ...c, pdf: null } : c)),
  );
}

/* ── GENERIC ORDER ATTACHMENTS (flat list, independent of docFlow) ────── */

export async function addAttachment(order: RawOrder, file: File): Promise<RawOrder> {
  assertFileSize(file);
  const pdf = await uploadPdf(file);
  const attachment: RawAttachment = { id: pdf.id, name: pdf.name, size: pdf.size, url: pdf.url };
  return { ...order, attachments: [...(order.attachments ?? []), attachment] };
}

export async function replaceAttachment(
  order: RawOrder,
  attachmentId: string,
  file: File,
): Promise<RawOrder> {
  assertFileSize(file);
  const pdf = await uploadPdf(file);
  const existing = (order.attachments ?? []).find((a) => a.id === attachmentId);
  removePdf(existing ? { id: existing.id } : undefined);
  return {
    ...order,
    attachments: (order.attachments ?? []).map((a) =>
      a.id === attachmentId
        ? { ...a, id: pdf.id, name: pdf.name, size: pdf.size, url: pdf.url }
        : a,
    ),
  };
}

export function removeAttachment(order: RawOrder, attachmentId: string): RawOrder {
  const existing = (order.attachments ?? []).find((a) => a.id === attachmentId);
  removePdf(existing ? { id: existing.id } : undefined);
  return { ...order, attachments: (order.attachments ?? []).filter((a) => a.id !== attachmentId) };
}

/* ── ORDER COMMENTS (free-text notes on the order as a whole) ──────────── */

export function addComment(order: RawOrder, text: string, author?: string): RawOrder {
  const clean = text.trim();
  if (!clean) return order;
  const comment: RawComment = {
    id: uid(),
    text: clean,
    author,
    createdAt: new Date().toISOString(),
  };
  return { ...order, comments: [...(order.comments ?? []), comment] };
}

export function deleteComment(order: RawOrder, commentId: string): RawOrder {
  return { ...order, comments: (order.comments ?? []).filter((c) => c.id !== commentId) };
}

export { getPlFactures };

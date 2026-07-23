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
  RawDocFlow,
  RawFacture,
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

export async function saveOrder(order: RawOrder): Promise<void> {
  // defensive: never let a stray raw File/Blob end up under attachments[].data
  const clean = { ...order, attachments: (order.attachments ?? []).map(({ ...r }) => r) };
  const { error } = await supabase
    .from("orders")
    .upsert({ id: order.id, data: clean, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteOrder(id: string): Promise<void> {
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) throw error;
}

export async function saveSupplier(supplier: RawSupplier): Promise<void> {
  const { error } = await supabase
    .from("suppliers")
    .upsert({ id: supplier.id, data: supplier, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteSupplier(id: string): Promise<void> {
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
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
  | { type: "factureDefinitive" };

export function getPayments(order: RawOrder, target: PaymentTarget): RawPayment[] {
  const df = ensureDocFlow(order);
  if (target.type === "proforma") return df.proforma?.paiements ?? [];
  if (target.type === "factureDefinitive") return df.factureDefinitive?.paiements ?? [];
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

export { getPlFactures };

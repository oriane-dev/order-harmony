// Orchestration for the document-level customer import: wires the pure logic in
// customer-docs.ts to Supabase persistence + storage. Two entry points, one per
// step of the workflow — import the CSV first (creates/updates orders and registers
// each expected document), then drop the PDFs (each file is matched to an already
// registered document by its Document No and just attaches the file).

import {
  attachPdfToOrder,
  buildCustomerImport,
  docPdfState,
  existingDocNos,
  parseDocsCsv,
  parsePdfFilename,
  type ImportReport,
} from "@/lib/customer-docs";
import { saveOrder, uploadPdf, type OrdersTable } from "@/lib/thalae-mutations";
import type { RawOrder } from "@/lib/thalae-types";

export type { ImportReport };

// Step 1 — CSV. Returns the report; caller invalidates the orders query afterwards.
export async function runCustomerCsvImport(
  text: string,
  existing: RawOrder[],
  table: OrdersTable = "customer_orders",
): Promise<ImportReport> {
  const map = new Map<string, RawOrder>();
  for (const o of existing) map.set((o.reference ?? o.id).trim(), o);
  const { upserts, report } = buildCustomerImport(parseDocsCsv(text), map);
  for (const order of upserts) await saveOrder(order, table);
  return report;
}

export interface PdfImportReport {
  attached: number;
  already: number;
  unmatched: { file: string; reason: string }[];
  errors: { file: string; reason: string }[];
}

// Step 2 — bulk PDFs. Matches each file to a registered document by Document No,
// uploads and attaches it. Files targeting the same order are applied together and
// saved once. Idempotent: a document that already has a PDF is skipped (no re-upload).
export async function runCustomerPdfImport(
  files: File[],
  existing: RawOrder[],
  table: OrdersTable = "customer_orders",
  onProgress?: (done: number, total: number) => void,
): Promise<PdfImportReport> {
  const rep: PdfImportReport = { attached: 0, already: 0, unmatched: [], errors: [] };

  // Document No → owning order id (covers SO/PF/DN/IN registered on any order)
  const docOwner = new Map<string, string>();
  for (const o of existing) for (const d of existingDocNos(o)) docOwner.set(d, o.id);

  // group the incoming files by the order they belong to
  const byOrder = new Map<string, { file: File; docNo: string }[]>();
  for (const f of files) {
    const parsed = parsePdfFilename(f.name);
    if (!parsed) {
      rep.unmatched.push({
        file: f.name,
        reason: "nom de fichier non reconnu (attendu ex. IN-500632-Client.pdf)",
      });
      continue;
    }
    if (parsed.type === "CN" || parsed.type === "RA") {
      rep.unmatched.push({
        file: f.name,
        reason: `${parsed.type} : à rattacher à la main sur la boîte « Retour » (ou l'avoir d'acompte) de la commande`,
      });
      continue;
    }
    const orderId = docOwner.get(parsed.docNo);
    if (!orderId) {
      rep.unmatched.push({
        file: f.name,
        reason: `document ${parsed.docNo} introuvable — importe d'abord le CSV`,
      });
      continue;
    }
    if (!byOrder.has(orderId)) byOrder.set(orderId, []);
    byOrder.get(orderId)!.push({ file: f, docNo: parsed.docNo });
  }

  const orderById = new Map(existing.map((o) => [o.id, o]));
  const total = files.length;
  let done = files.length - [...byOrder.values()].reduce((a, v) => a + v.length, 0); // already-counted unmatched
  onProgress?.(done, total);

  for (const [orderId, items] of byOrder) {
    let order = orderById.get(orderId);
    if (!order) continue;
    let dirty = false;
    for (const { file, docNo } of items) {
      try {
        const state = docPdfState(order, docNo);
        if (state === "absent") {
          rep.errors.push({ file: file.name, reason: `emplacement introuvable pour ${docNo}` });
        } else if (state === "filled") {
          rep.already += 1;
        } else {
          const pdf = await uploadPdf(file);
          const res = attachPdfToOrder(order, docNo, pdf);
          if (res && res.status === "attached") {
            order = res.order;
            dirty = true;
            rep.attached += 1;
          } else {
            rep.already += 1;
          }
        }
      } catch (e) {
        rep.errors.push({ file: file.name, reason: e instanceof Error ? e.message : String(e) });
      }
      done += 1;
      onProgress?.(done, total);
    }
    if (dirty) await saveOrder(order, table);
  }

  return rep;
}

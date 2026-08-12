// Document-level customer import — framework-free core logic (no React, no Supabase,
// no PDF.js), so it can be unit-tested in isolation and reused both by the in-app
// import UI and by one-off migration scripts.
//
// The new customer CSV is one row PER DOCUMENT (not per order). Each row's
// "Document No" prefix identifies its type:
//   SO = Order Confirmation (the sales order itself)   PF = Pro Forma
//   DN = Delivery Note                                  IN = Invoice
//   CN = Credit Note        RA = Return                 (CN/RA not yet supported)
//
// Documents attach to an existing Sales Order via the "SO Number" column
// (e.g. "SO-00053/2" → base order "SO-00053"; the "/N" is only a per-document
// counter, NOT a delivery-batch id — a Delivery Note and its matching Invoice do
// NOT share the same /N, so factures are paired to deliveries by amount instead).
//
// Design decision (validated with the user): faithful import — every Invoice counts
// as one facture; an Invoice with Status "Paid" also creates the matching payment so
// "encaissé" is correct. On the few orders with a billed deposit the invoiced total
// can exceed the ordered total; that is surfaced by the existing over-invoice alert.

import type {
  RawDocFlow,
  RawFacture,
  RawOrder,
  RawPackingList,
  RawPayment,
  RawPdf,
} from "@/lib/thalae-types";

export type DocType = "SO" | "PF" | "DN" | "IN" | "CN" | "RA";

export interface DocRow {
  type: DocType | string;
  docNo: string; // "IN-500632"
  soRef: string; // full "SO-00053/2"
  soBase: string; // "SO-00053"
  customer: string;
  status: string;
  season: string; // goes into notes; drives the season filter
  date: string; // ISO yyyy-mm-dd
  qty: number;
  total: number;
  dueDate: string; // ISO yyyy-mm-dd
}

/* ── parsing helpers ──────────────────────────────────────────────────── */

function parseAmt(s: string): number {
  s = (s || "").replace(/\s/g, "").trim();
  if (!s) return 0;
  // European "107850,60" or "1.234,56"; also plain "187.20"
  if (s.includes(",")) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  return parseFloat(s) || 0;
}

function normDate(s: string): string {
  s = (s || "").trim();
  if (!s) return "";
  const p = s.split(/[/\-.]/);
  if (p.length !== 3) return s;
  const [a, b, c] = p;
  if (a.length === 4) return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`; // yyyy-mm-dd
  if (c.length === 4) return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`; // dd/mm/yyyy
  return s;
}

function baseOf(soRef: string): string {
  return (soRef || "").replace(/\/\d+$/, "").trim();
}

// The document-level CSV is recognised by its two signature columns.
export function isDocLevelCsv(text: string): boolean {
  const first = (text.split(/\r?\n/)[0] || "").toLowerCase();
  return first.includes("document no") && first.includes("so number");
}

export function parseDocsCsv(text: string): DocRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === delim && !q) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const header = split(lines[0]).map((h) => h.toLowerCase().trim());
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const iDoc = col("document no");
  const iSo = col("so number");
  const iCust = col("customer");
  const iStatus = col("status");
  const iSeason = col("season");
  const iDate = header.findIndex((h) => h === "date" || h.includes("order date"));
  const iQty = col("quantity");
  const iTotal = col("total");
  const iDue = col("due");
  const rows: DocRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = split(lines[i]);
    const docNo = (r[iDoc] || "").trim();
    if (!docNo) continue;
    const soRef = (r[iSo] || "").trim();
    rows.push({
      type: docNo.slice(0, 2).toUpperCase(),
      docNo,
      soRef,
      soBase: baseOf(soRef),
      customer: (r[iCust] || "").trim(),
      status: (r[iStatus] || "").trim(),
      season: (r[iSeason] || "").trim(),
      date: normDate(r[iDate] || ""),
      qty: parseAmt(r[iQty] || "0"),
      total: parseAmt(r[iTotal] || "0"),
      dueDate: normDate(r[iDue] || ""),
    });
  }
  return rows;
}

/* ── PDF filename parsing ─────────────────────────────────────────────── */

// "IN-500632-247_TWENTYFOURSEVEN SRL.pdf" → { docNo: "IN-500632", customer: "247…" }
export function parsePdfFilename(
  name: string,
): { type: string; docNo: string; customer: string } | null {
  const base = name.replace(/\.pdf$/i, "").trim();
  const m = base.match(/^([A-Za-z]{2})[-\s]*(\d+)\s*-\s*(.*)$/);
  if (!m) return null;
  const type = m[1].toUpperCase();
  return { type, docNo: `${type}-${m[2]}`, customer: (m[3] || "").trim() };
}

/* ── docFlow construction ─────────────────────────────────────────────── */

let seq = 0;
// Deterministic-ish unique id (no Date.now in test scripts): callers may pass a salt.
function uid(salt: string): string {
  seq += 1;
  return `imp-${salt}-${seq}`;
}

// All Document No values already present anywhere in an order's docFlow — used to
// skip documents that were imported on a previous run (dedup by Document No).
export function existingDocNos(order: RawOrder): Set<string> {
  const s = new Set<string>();
  const df = order.docFlow;
  if (!df) return s;
  if (order.reference) s.add(order.reference); // SO / order-confirmation
  if (df.proforma?.docNo) s.add(df.proforma.docNo);
  for (const pl of df.packingLists ?? []) {
    if (pl.docNo) s.add(pl.docNo);
    for (const f of pl.factures ?? []) if (f.docNo) s.add(f.docNo);
  }
  return s;
}

export interface ImportReport {
  ordersCreated: number;
  ordersUpdated: number;
  docsAdded: Record<string, number>; // by type
  skipped: { docNo: string; reason: string }[];
  errors: { ref: string; reason: string }[];
  warnings: string[];
}

function emptyReport(): ImportReport {
  return {
    ordersCreated: 0,
    ordersUpdated: 0,
    docsAdded: {},
    skipped: [],
    errors: [],
    warnings: [],
  };
}

function bump(rep: ImportReport, type: string) {
  rep.docsAdded[type] = (rep.docsAdded[type] ?? 0) + 1;
}

// Build the delivery/facture packing lists for one order from its DN + IN rows.
// Factures are paired to deliveries by matching total within the order; unpaired
// invoices get their own packing list (e.g. deposit invoices with no delivery),
// unpaired deliveries get a packing list with no facture (shipped, not yet invoiced).
function buildPackingLists(
  dns: DocRow[],
  ins: DocRow[],
  salt: string,
  seen: Set<string>,
  rep: ImportReport,
): RawPackingList[] {
  const lists: RawPackingList[] = [];
  const insLeft = ins.filter((x) => !seen.has(x.docNo));
  const used = new Set<number>();

  const makeFacture = (inv: DocRow): RawFacture => {
    bump(rep, "IN");
    seen.add(inv.docNo);
    return {
      id: uid(salt),
      pdf: null,
      montant: inv.total,
      docNo: inv.docNo,
      docDate: inv.date,
      ...(inv.dueDate ? { dueDate: inv.dueDate } : {}),
    };
  };
  const paymentFor = (inv: DocRow): RawPayment[] =>
    /paid/i.test(inv.status)
      ? [{ id: uid(salt), montant: inv.total, date: inv.dueDate || inv.date || "" }]
      : [];

  for (const dn of dns) {
    if (seen.has(dn.docNo)) continue;
    bump(rep, "DN");
    seen.add(dn.docNo);
    // pair an invoice by equal total (2-cent tolerance), preferring same quantity
    let idx = insLeft.findIndex(
      (inv, k) => !used.has(k) && Math.abs(inv.total - dn.total) < 0.02 && inv.qty === dn.qty,
    );
    if (idx < 0)
      idx = insLeft.findIndex((inv, k) => !used.has(k) && Math.abs(inv.total - dn.total) < 0.02);
    const paired = idx >= 0 ? insLeft[idx] : undefined;
    if (idx >= 0) used.add(idx);
    const pl: RawPackingList = {
      id: uid(salt),
      packingListPdf: null,
      docNo: dn.docNo,
      docDate: dn.date,
      qty: dn.qty,
      factures: paired ? [makeFacture(paired)] : [],
      paiements: paired ? paymentFor(paired) : [],
    };
    lists.push(pl);
  }

  // invoices with no delivery (deposit / advance invoices)
  insLeft.forEach((inv, k) => {
    if (used.has(k) || seen.has(inv.docNo)) return;
    lists.push({
      id: uid(salt),
      packingListPdf: null,
      factures: [makeFacture(inv)],
      paiements: paymentFor(inv),
    });
  });

  return lists;
}

// Merge the CSV documents for a set of rows into new/updated RawOrders.
// `existing` maps SO reference → the current RawOrder (to update in place / dedup).
export function buildCustomerImport(
  rows: DocRow[],
  existing: Map<string, RawOrder>,
): { upserts: RawOrder[]; report: ImportReport } {
  const rep = emptyReport();
  const byBase = new Map<string, DocRow[]>();
  for (const r of rows) {
    if (!byBase.has(r.soBase)) byBase.set(r.soBase, []);
    byBase.get(r.soBase)!.push(r);
  }

  const upserts: RawOrder[] = [];
  for (const [base, group] of byBase) {
    // orders whose base isn't an SO-… reference (e.g. TR-…) and aren't already in
    // the tool can't be attached to anything → report and skip the whole group.
    const known = existing.has(base);
    if (!/^SO-/i.test(base) && !known) {
      for (const g of group)
        rep.errors.push({
          ref: g.docNo,
          reason: `commande ${base || "?"} introuvable (non importée)`,
        });
      continue;
    }

    const soRow = group.find((g) => g.type === "SO");
    const prev = existing.get(base);
    const salt = base.replace(/[^a-z0-9]/gi, "");
    const order: RawOrder = prev
      ? { ...prev }
      : {
          id: uid(salt),
          createdAt: soRow?.date ?? "",
          reference: base,
          attachments: [],
          documents: [],
        };

    // refresh order-level fields from the SO row (source of truth)
    if (soRow) {
      order.reference = base;
      order.fournisseur = soRow.customer || order.fournisseur || "";
      order.montant = soRow.total || order.montant || 0;
      order.devise = order.devise || "EUR";
      order.dateCommande = soRow.date || order.dateCommande || "";
      order.notes = soRow.season || order.notes || "";
      order.quantite = soRow.qty || order.quantite;
      if (!prev) rep.ordersCreated += 1;
      else rep.ordersUpdated += 1;
    } else if (prev) {
      rep.ordersUpdated += 1;
    } else {
      // SO base referenced by documents but no SO row and not already imported
      const any = group[0];
      order.fournisseur = any.customer || "";
      order.notes = any.season || "";
      order.devise = "EUR";
      rep.ordersCreated += 1;
      rep.warnings.push(`${base} : créée sans ligne SO (données minimales, à vérifier)`);
    }

    const seen = existingDocNos(order);
    const df: RawDocFlow = order.docFlow ? { ...order.docFlow } : {};

    // Pro forma
    const pf = group.find((g) => g.type === "PF" && !seen.has(g.docNo));
    if (pf) {
      bump(rep, "PF");
      seen.add(pf.docNo);
      df.proforma = {
        ...(df.proforma ?? {}),
        pdf: df.proforma?.pdf ?? null,
        montant: pf.total,
        paiements: df.proforma?.paiements ?? [],
        docNo: pf.docNo,
        docDate: pf.date,
        dueDate: pf.dueDate,
      };
    }
    const extraPf = group.filter(
      (g) => g.type === "PF" && g.docNo !== pf?.docNo && !seen.has(g.docNo),
    );
    for (const x of extraPf) rep.warnings.push(`${base} : proforma multiple ${x.docNo} ignorée`);

    // Deliveries + invoices
    const dns = group.filter((g) => g.type === "DN");
    const ins = group.filter((g) => g.type === "IN");
    const newLists = buildPackingLists(dns, ins, salt, seen, rep);
    df.packingLists = [...(df.packingLists ?? []), ...newLists];

    // Not-yet-supported document types
    for (const g of group)
      if (g.type === "CN" || g.type === "RA")
        rep.skipped.push({ docNo: g.docNo, reason: `${g.type} pas encore pris en charge` });

    order.docFlow = df;
    upserts.push(order);
  }

  return { upserts, report: rep };
}

/* ── PDF attachment (phase 2) ─────────────────────────────────────────── */

// Whether the doc identified by `docNo` exists in this order and already has a PDF.
// Lets the importer skip re-uploading a file that's already attached.
export function docPdfState(order: RawOrder, docNo: string): "filled" | "empty" | "absent" {
  const df = order.docFlow;
  if (docNo === order.reference) return df?.poDocument ? "filled" : "empty";
  if (!df) return "absent";
  if (df.proforma?.docNo === docNo) return df.proforma.pdf ? "filled" : "empty";
  for (const pl of df.packingLists ?? []) {
    if (pl.docNo === docNo) return pl.packingListPdf ? "filled" : "empty";
    for (const f of pl.factures ?? []) if (f.docNo === docNo) return f.pdf ? "filled" : "empty";
  }
  return "absent";
}

// Locate the doc identified by `docNo` inside an order's docFlow and set its PDF.
// Returns the updated order, or null if the doc isn't found (CSV not imported yet).
// Skips (returns the order unchanged, flag "already") if a PDF is already attached.
export function attachPdfToOrder(
  order: RawOrder,
  docNo: string,
  pdf: RawPdf,
): { order: RawOrder; status: "attached" | "already" } | null {
  const df = order.docFlow;
  // SO / order confirmation → poDocument
  if (docNo === order.reference) {
    if (df?.poDocument) return { order, status: "already" };
    return { order: { ...order, docFlow: { ...(df ?? {}), poDocument: pdf } }, status: "attached" };
  }
  if (!df) return null;
  const pf = df.proforma;
  if (pf?.docNo === docNo) {
    if (pf.pdf) return { order, status: "already" };
    return {
      order: { ...order, docFlow: { ...df, proforma: { ...pf, pdf } } },
      status: "attached",
    };
  }
  let found = false;
  let already = false;
  const packingLists = (df.packingLists ?? []).map((pl) => {
    if (pl.docNo === docNo) {
      found = true;
      if (pl.packingListPdf) {
        already = true;
        return pl;
      }
      return { ...pl, packingListPdf: pdf };
    }
    const factures = (pl.factures ?? []).map((f) => {
      if (f.docNo === docNo) {
        found = true;
        if (f.pdf) {
          already = true;
          return f;
        }
        return { ...f, pdf };
      }
      return f;
    });
    return { ...pl, factures };
  });
  if (!found) return null;
  if (already) return { order, status: "already" };
  return { order: { ...order, docFlow: { ...df, packingLists } }, status: "attached" };
}

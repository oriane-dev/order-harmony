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
  RawCreditNote,
  RawDepositInvoice,
  RawDocFlow,
  RawFacture,
  RawOrder,
  RawPackingList,
  RawPayment,
  RawPdf,
  RawReturn,
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

// "IN-500632_247_TWENTYFOURSEVEN_SRL.PDF" or "IN-500632-Client.pdf" →
// { docNo: "IN-500632", customer: "247…" }. Separator between the document number and
// the customer name may be "_", "-" or a space; the extension is case-insensitive.
export function parsePdfFilename(
  name: string,
): { type: string; docNo: string; customer: string } | null {
  const base = name.replace(/\.pdf$/i, "").trim();
  const m = base.match(/^([A-Za-z]{2})[-_\s]*(\d+)[-_\s]+(.*)$/);
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
  for (const di of df.proforma?.depositInvoices ?? []) {
    if (di.docNo) s.add(di.docNo);
    for (const cn of di.creditNotes ?? []) if (cn.docNo) s.add(cn.docNo);
  }
  for (const pl of df.packingLists ?? []) {
    if (pl.docNo) s.add(pl.docNo);
    for (const f of pl.factures ?? []) {
      if (f.docNo) s.add(f.docNo);
      for (const cn of f.creditNotes ?? []) if (cn.docNo) s.add(cn.docNo);
    }
  }
  for (const r of df.returns ?? []) {
    if (r.raNo) s.add(r.raNo);
    if (r.cnNo) s.add(r.cnNo);
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

// Build the deliveries (packing lists) and deposit invoices for one order from its
// DN + IN rows. An invoice is paired to a delivery by matching total within the order
// → it's a delivery invoice (facture under that packing list). An invoice that pairs
// with NO delivery is a deposit invoice (billing of the pro forma deposit) → it goes
// under the pro forma, not the deliveries. Unpaired deliveries get a packing list with
// no facture (shipped, not yet invoiced).
function buildDeliveriesAndDeposits(
  dns: DocRow[],
  ins: DocRow[],
  salt: string,
  seen: Set<string>,
  rep: ImportReport,
): { lists: RawPackingList[]; deposits: RawDepositInvoice[] } {
  const lists: RawPackingList[] = [];
  const deposits: RawDepositInvoice[] = [];
  const insLeft = ins.filter((x) => !seen.has(x.docNo));
  // A deposit invoice bills the pro forma deposit — it carries NO goods, so its
  // quantity is 0. Delivery invoices always bill delivered goods (quantity ≥ 1).
  // This cleanly separates the two even when an invoice doesn't pair with a delivery
  // (e.g. a delivery credit/adjustment stays a delivery facture, not a deposit).
  const deliveryIns = insLeft.filter((inv) => inv.qty !== 0);
  const depositIns = insLeft.filter((inv) => inv.qty === 0);
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
    // pair a delivery invoice by equal total (2-cent tolerance), preferring same qty
    let idx = deliveryIns.findIndex(
      (inv, k) => !used.has(k) && Math.abs(inv.total - dn.total) < 0.02 && inv.qty === dn.qty,
    );
    if (idx < 0)
      idx = deliveryIns.findIndex(
        (inv, k) => !used.has(k) && Math.abs(inv.total - dn.total) < 0.02,
      );
    const paired = idx >= 0 ? deliveryIns[idx] : undefined;
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

  // delivery invoices with no matching delivery → standalone facture (e.g. a credit)
  deliveryIns.forEach((inv, k) => {
    if (used.has(k) || seen.has(inv.docNo)) return;
    lists.push({
      id: uid(salt),
      packingListPdf: null,
      factures: [makeFacture(inv)],
      paiements: paymentFor(inv),
    });
  });

  // deposit invoices (quantity 0) → billed against the pro forma
  for (const inv of depositIns) {
    if (seen.has(inv.docNo)) continue;
    bump(rep, "IN");
    seen.add(inv.docNo);
    deposits.push({
      id: uid(salt),
      docNo: inv.docNo,
      montant: inv.total,
      docDate: inv.date,
      ...(inv.dueDate ? { dueDate: inv.dueDate } : {}),
      pdf: null,
      paiements: paymentFor(inv),
    });
  }

  return { lists, deposits };
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

    // Deliveries (with their delivery invoices) + deposit invoices (under pro forma)
    const dns = group.filter((g) => g.type === "DN");
    const ins = group.filter((g) => g.type === "IN");
    const { lists: newLists, deposits: newDeposits } = buildDeliveriesAndDeposits(
      dns,
      ins,
      salt,
      seen,
      rep,
    );
    df.packingLists = [...(df.packingLists ?? []), ...newLists];
    if (newDeposits.length) {
      const pf = df.proforma ?? { pdf: null, paiements: [] };
      df.proforma = { ...pf, depositInvoices: [...(pf.depositInvoices ?? []), ...newDeposits] };
    }

    // Retours (RA + CN) et avoirs d'acompte (CN sur une facture d'acompte)
    reconcileReturnsAndCredits(group, df, salt, seen, rep);

    order.docFlow = df;
    upserts.push(order);
  }

  return { upserts, report: rep };
}

// Montant lisible pour les messages d'erreur d'import.
function fmtAmt(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Rapproche les Credit Notes (CN) et Return Authorisations (RA) d'un groupe de commande.
// Un retour est TOUJOURS piloté par le RA (l'autorisation de retour vient en premier) :
//  1. CN d'acompte  : un CN (qté 0) dont le montant = une facture d'acompte → avoir sur cet
//                     acompte (format « GIGI ROME » : la deposit invoice est annulée).
//  2. Retour        : un RA ouvre une boîte « Retour » (informative, sans effet trésorerie).
//                     Son CN de même ligne SO + même montant vient la compléter — dans le même
//                     import OU dans un import ultérieur (RA d'abord, CN ensuite).
//  3. CN sans RA    : ERREUR (« je ne l'ai mis nulle part ») — un avoir sans retour n'est pas
//                     autorisé. Un RA sans CN est en revanche normal (retour en attente d'avoir).
function reconcileReturnsAndCredits(
  group: DocRow[],
  df: RawDocFlow,
  salt: string,
  seen: Set<string>,
  rep: ImportReport,
): void {
  // `seen` (= existingDocNos) contient déjà les RA/CN/avoirs déjà importés → on ne traite
  // que les nouvelles lignes, et les RA déjà ouverts en boîte « Retour » sont ignorés ici.
  const cns = group.filter((g) => g.type === "CN" && !seen.has(g.docNo));
  const ras = group.filter((g) => g.type === "RA" && !seen.has(g.docNo));
  const returns: RawReturn[] = (df.returns ?? []).map((r) => ({ ...r }));
  const raUsed = new Set<number>();
  const cnErrors: DocRow[] = [];

  for (const cn of cns) {
    // 1. Avoir d'acompte — CN (qté 0) au montant d'une facture d'acompte non créditée.
    const deposits = df.proforma?.depositInvoices ?? [];
    const di =
      cn.qty === 0
        ? deposits.find(
            (d) =>
              Math.abs((d.montant ?? 0) - cn.total) < 0.02 &&
              !(d.creditNotes ?? []).some((c) => c.docNo === cn.docNo),
          )
        : undefined;
    if (di) {
      const note: RawCreditNote = {
        id: uid(salt),
        docNo: cn.docNo,
        montant: cn.total,
        docDate: cn.date,
        ...(cn.dueDate ? { date: cn.dueDate } : {}),
        pdf: null,
      };
      df.proforma = {
        ...df.proforma,
        depositInvoices: deposits.map((d) =>
          d.id === di.id ? { ...d, creditNotes: [...(d.creditNotes ?? []), note] } : d,
        ),
      };
      seen.add(cn.docNo);
      bump(rep, "Avoir (acompte)");
      continue;
    }

    // 2a. Retour complet — un RA de la même ligne SO et du même montant est présent.
    const rIdx = ras.findIndex(
      (ra, i) => !raUsed.has(i) && ra.soRef === cn.soRef && Math.abs(ra.total - cn.total) < 0.02,
    );
    if (rIdx >= 0) {
      const ra = ras[rIdx];
      raUsed.add(rIdx);
      seen.add(cn.docNo);
      seen.add(ra.docNo);
      returns.push({
        id: uid(salt),
        raNo: ra.docNo,
        cnNo: cn.docNo,
        soLine: cn.soRef,
        montant: cn.total,
        docDate: cn.date || ra.date,
        qty: cn.qty,
        raPdf: null,
        cnPdf: null,
      });
      bump(rep, "Retour");
      continue;
    }

    // 2b. Le CN complète un retour déjà ouvert (RA importé plus tôt, CN pas encore reçu).
    const pIdx = returns.findIndex(
      (r) => r.raNo && !r.cnNo && r.soLine === cn.soRef && Math.abs((r.montant ?? 0) - cn.total) < 0.02,
    );
    if (pIdx >= 0) {
      returns[pIdx] = { ...returns[pIdx], cnNo: cn.docNo, docDate: returns[pIdx].docDate || cn.date };
      seen.add(cn.docNo);
      bump(rep, "Retour (complété)");
      continue;
    }

    // 3. CN sans RA → erreur.
    cnErrors.push(cn);
  }

  // Les RA restants (sans CN) ouvrent une boîte « Retour » en attente de leur avoir.
  ras.forEach((ra, i) => {
    if (raUsed.has(i)) return;
    seen.add(ra.docNo);
    returns.push({
      id: uid(salt),
      raNo: ra.docNo,
      soLine: ra.soRef,
      montant: ra.total,
      docDate: ra.date,
      qty: ra.qty,
      raPdf: null,
      cnPdf: null,
    });
    bump(rep, "Retour (RA en attente)");
  });

  if (returns.length) df.returns = returns;

  for (const cn of cnErrors)
    rep.errors.push({
      ref: cn.docNo,
      reason: `avoir (CN) sans retour : aucun RA de ${fmtAmt(cn.total)} sur ${cn.soRef}, ni facture d'acompte de ce montant — un CN sans RA n'est pas autorisé`,
    });
}

/* ── PDF attachment (phase 2) ─────────────────────────────────────────── */

// Whether the doc identified by `docNo` exists in this order and already has a PDF.
// Lets the importer skip re-uploading a file that's already attached.
export function docPdfState(order: RawOrder, docNo: string): "filled" | "empty" | "absent" {
  const df = order.docFlow;
  if (docNo === order.reference) return df?.poDocument ? "filled" : "empty";
  if (!df) return "absent";
  if (df.proforma?.docNo === docNo) return df.proforma.pdf ? "filled" : "empty";
  for (const di of df.proforma?.depositInvoices ?? []) {
    if (di.docNo === docNo) return di.pdf ? "filled" : "empty";
    for (const c of di.creditNotes ?? []) if (c.docNo === docNo) return c.pdf ? "filled" : "empty";
  }
  for (const pl of df.packingLists ?? []) {
    if (pl.docNo === docNo) return pl.packingListPdf ? "filled" : "empty";
    for (const f of pl.factures ?? []) {
      if (f.docNo === docNo) return f.pdf ? "filled" : "empty";
      for (const c of f.creditNotes ?? []) if (c.docNo === docNo) return c.pdf ? "filled" : "empty";
    }
  }
  for (const r of df.returns ?? []) {
    if (r.raNo === docNo) return r.raPdf ? "filled" : "empty";
    if (r.cnNo === docNo) return r.cnPdf ? "filled" : "empty";
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
  // deposit invoices (under the pro forma)
  if ((pf?.depositInvoices ?? []).some((di) => di.docNo === docNo)) {
    let diAlready = false;
    const depositInvoices = (pf!.depositInvoices ?? []).map((di) => {
      if (di.docNo !== docNo) return di;
      if (di.pdf) {
        diAlready = true;
        return di;
      }
      return { ...di, pdf };
    });
    if (diAlready) return { order, status: "already" };
    return {
      order: { ...order, docFlow: { ...df, proforma: { ...pf!, depositInvoices } } },
      status: "attached",
    };
  }
  // avoirs d'acompte (credit notes rattachés à une facture d'acompte)
  if ((pf?.depositInvoices ?? []).some((di) => (di.creditNotes ?? []).some((c) => c.docNo === docNo))) {
    let cnAlready = false;
    const depositInvoices = (pf!.depositInvoices ?? []).map((di) => ({
      ...di,
      creditNotes: (di.creditNotes ?? []).map((c) => {
        if (c.docNo !== docNo) return c;
        if (c.pdf) {
          cnAlready = true;
          return c;
        }
        return { ...c, pdf };
      }),
    }));
    if (cnAlready) return { order, status: "already" };
    return {
      order: { ...order, docFlow: { ...df, proforma: { ...pf!, depositInvoices } } },
      status: "attached",
    };
  }
  // retours : PDF de l'autorisation de retour (RA) ou de son avoir (CN)
  if ((df.returns ?? []).some((r) => r.raNo === docNo || r.cnNo === docNo)) {
    let retAlready = false;
    const returns = (df.returns ?? []).map((r) => {
      if (r.raNo === docNo) {
        if (r.raPdf) {
          retAlready = true;
          return r;
        }
        return { ...r, raPdf: pdf };
      }
      if (r.cnNo === docNo) {
        if (r.cnPdf) {
          retAlready = true;
          return r;
        }
        return { ...r, cnPdf: pdf };
      }
      return r;
    });
    if (retAlready) return { order, status: "already" };
    return { order: { ...order, docFlow: { ...df, returns } }, status: "attached" };
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
      // avoir (credit note) rattaché à une facture de livraison
      if ((f.creditNotes ?? []).some((c) => c.docNo === docNo)) {
        return {
          ...f,
          creditNotes: (f.creditNotes ?? []).map((c) => {
            if (c.docNo !== docNo) return c;
            found = true;
            if (c.pdf) {
              already = true;
              return c;
            }
            return { ...c, pdf };
          }),
        };
      }
      return f;
    });
    return { ...pl, factures };
  });
  if (!found) return null;
  if (already) return { order, status: "already" };
  return { order: { ...order, docFlow: { ...df, packingLists } }, status: "attached" };
}

// Order-list CSV parser (one row = one order) — framework-free and PDF.js-free, so
// it can run both in the app and in one-off migration scripts. Handles the supplier
// PO export (Docket / Manufacturer / Docket Qty / Total Cost (€) / Delivery From /
// Pending / In Transit / Received / Closed / Season) as well as the earlier client
// order export, via forgiving substring header matching.

export interface ParsedCsvOrder {
  reference: string;
  fournisseur: string;
  produit: string;
  montant: number;
  devise: string;
  dateCommande: string;
  dateLivraison: string;
  incoterms: string;
  notes: string;
  quantite: number;
  nop: number;
  progressProduction: number;
  progressLivraison: number;
}

export function parseCsvOrders(txt: string): ParsedCsvOrder[] {
  const lines = txt
    .replace(/^﻿/, "")
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return [];
  const sample = lines[0];
  const delim = sample.includes("\t")
    ? "\t"
    : sample.split(";").length > sample.split(",").length
      ? ";"
      : ",";
  function parseRow(line: string): string[] {
    const f: string[] = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === delim && !inQ) {
        f.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    f.push(cur.trim());
    return f;
  }
  function parseAmt(s: string): number {
    if (!s) return 0;
    s = s.replace(/\s/g, "");
    if (s.includes(",") && s.includes("."))
      return s.lastIndexOf(",") > s.lastIndexOf(".")
        ? parseFloat(s.replace(/\./g, "").replace(",", "."))
        : parseFloat(s.replace(/,/g, ""));
    return parseFloat(s.replace(",", "."));
  }
  function isDate(s: string): boolean {
    return /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}$/.test(s);
  }
  function normD(s: string): string {
    if (!s) return "";
    const p = s.split(/[/\-.]/);
    if (p.length !== 3) return s;
    const [a, b, cc] = p;
    return cc.length === 4 ? cc + "-" + b.padStart(2, "0") + "-" + a.padStart(2, "0") : s;
  }

  const firstRow = parseRow(lines[0]);
  const looksLikeHeader =
    firstRow.filter((f) => f.trim()).length > 0 &&
    firstRow
      .filter((f) => f.trim())
      .every((f) => {
        const n = f.replace(/[^a-z0-9]/gi, "");
        return (
          n &&
          isNaN(Number(n)) &&
          !isDate(f) &&
          n.length > 0 &&
          n.length < 30 &&
          !/^\d+[,.]\d+$/.test(f)
        );
      });

  const IDX: Record<string, number> = {
    reference: -1,
    fournisseur: -1,
    produit: -1,
    montant: -1,
    devise: -1,
    dateCommande: -1,
    dateLivraison: -1,
    incoterms: -1,
    notes: -1,
    quantite: -1,
    pending: -1,
    inTransit: -1,
    received: -1,
    closed: -1,
  };
  let dataStart = 0;

  if (looksLikeHeader) {
    dataStart = 1;
    firstRow.forEach((col, i) => {
      const n = col
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // strip accents: "Référence" → "reference"
        .replace(/[^a-z0-9\s()€]/g, "")
        .trim();
      // Partial (substring) matching throughout, so real-world headers like
      // "Order Number", "Total Amount", "Total (€)" work — not just the bare word.
      // Order matters: more specific columns are claimed before broader ones.
      //
      // Product / style ref first, so "Docket Ref" isn't mistaken for the order number.
      if (/docket\s*ref|docket\s*reference|produit|product|description|article|style/.test(n))
        IDX.produit = i;
      // Delivery/due date, then order date — both before the order-number match, so
      // "Order Date" is read as a date rather than the reference.
      else if (/delivery|livraison|ship\s*date|due\s*date|\bdue\b|expected|\beta\b/.test(n))
        IDX.dateLivraison = i;
      else if (/order\s*date|date\s*commande|po\s*date|docket\s*date|created|\bdate\b/.test(n))
        IDX.dateCommande = i;
      // Quantity before amount, so "Total Quantity" isn't grabbed as the amount.
      else if (/docket\s*qty|quantit|quantity|\bqty\b|pieces|\bpcs\b|\bunits?\b/.test(n))
        IDX.quantite = i;
      // Amount before reference, so "Order Value"/"Order Total" go to amount, not the number.
      else if (/total|montant|amount|\bvalue\b|\bcost\b|prix|price|€|\beur\b/.test(n))
        IDX.montant = i;
      // Order / reference number — partial, so "Order Number", "Order #", "N° commande" work.
      else if (/docket|reference|\bref\b|commande|\border\b|\bpo\b|purchase\s*order/.test(n))
        IDX.reference = i;
      // Counterparty — supplier OR customer column names
      else if (
        /manufacturer|fournisseur|supplier|vendor|maker|client|customer|acheteur|buyer/.test(n)
      )
        IDX.fournisseur = i;
      else if (/^pending$/.test(n)) IDX.pending = i;
      else if (/in\s*transit/.test(n)) IDX.inTransit = i;
      else if (/^received$/.test(n)) IDX.received = i;
      else if (/^closed$/.test(n)) IDX.closed = i;
      else if (/devise|currency|ccy/.test(n)) IDX.devise = i;
      else if (/incoterm/.test(n)) IDX.incoterms = i;
      else if (/notes|note|remarks|season|saison|collection/.test(n)) IDX.notes = i;
    });
  } else {
    Object.assign(IDX, {
      reference: 1,
      fournisseur: 2,
      produit: 3,
      montant: 10,
      devise: -1,
      incoterms: -1,
      dateCommande: 5,
      dateLivraison: 12,
      notes: 17,
      quantite: 7,
      pending: 13,
      inTransit: 14,
      received: 15,
      closed: 16,
    });
  }

  const getNum = (row: string[], idx: number): number => {
    if (idx < 0 || idx >= row.length) return 0;
    const s = (row[idx] || "").replace(/^["']|["']$/g, "").trim();
    return parseFloat(s.replace(",", ".")) || 0;
  };
  const get = (row: string[], k: keyof typeof IDX): string =>
    IDX[k] >= 0 ? (row[IDX[k]] || "").replace(/^["']|["']$/g, "").trim() : "";
  const res: ParsedCsvOrder[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    if (row.every((x) => !x.trim())) continue;
    const reference = get(row, "reference");
    const fournisseur = get(row, "fournisseur");
    const produit = get(row, "produit");
    if (!reference && !fournisseur && !produit) continue;
    const dateLivraison = normD(get(row, "dateLivraison"));
    const dateCommande = normD(get(row, "dateCommande"));
    const quantite = getNum(row, IDX.quantite);
    const pending = getNum(row, IDX.pending);
    const inTransit = getNum(row, IDX.inTransit);
    const received = getNum(row, IDX.received);
    const nop = pending + inTransit + received;
    const progressProduction = inTransit + received;
    const progressLivraison = received;
    res.push({
      reference,
      fournisseur,
      produit,
      montant: parseAmt(get(row, "montant")),
      devise: get(row, "devise") || "EUR",
      dateCommande,
      dateLivraison,
      incoterms: get(row, "incoterms"),
      notes: get(row, "notes"),
      quantite,
      nop,
      progressProduction,
      progressLivraison,
    });
  }
  return res;
}

// Recognise the supplier/order list CSV (one row per order) vs the customer
// document-level CSV — used to route the file to the right importer.
export function isOrderListCsv(text: string): boolean {
  const first = (text.split(/\r?\n/)[0] || "").toLowerCase();
  // the document-level customer CSV has these two signature columns; anything else
  // with a docket/manufacturer/order header is the order-list format.
  if (first.includes("document no") && first.includes("so number")) return false;
  return /docket|manufacturer|order|commande|reference/.test(first);
}

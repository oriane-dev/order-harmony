// Ported from Thalae (suivi-commandes-2.html) — PDF text extraction, CSV parsing, and
// two-tier document parsing (Claude API first, regex heuristics as fallback). Same
// logic, clean TypeScript, no Preact. Kept close to the original line-by-line so it's
// easy to diff against the source if Thalae itself changes.

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { RawConditionPaiement } from "@/lib/thalae-types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/* ── PDF TEXT EXTRACTION ───────────────────────────────────────────────── */

function cleanPdfText(text: string): string {
  function normTok(t: string): string {
    const n = t.length;
    for (let l = 1; l <= Math.floor(n / 2); l++) {
      if (n % l === 0) {
        const base = t.slice(0, l);
        if (base.repeat(n / l) === t) return base;
      }
    }
    return t;
  }
  const toks = text.split(/\s+/).filter(Boolean).map(normTok);
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    let merged = false;
    const maxLen = Math.min(8, Math.floor((toks.length - i) / 3));
    for (let len = maxLen; len >= 1; len--) {
      const phrase = toks.slice(i, i + len).join(" ");
      if (
        toks.slice(i + len, i + 2 * len).join(" ") === phrase &&
        toks.slice(i + 2 * len, i + 3 * len).join(" ") === phrase
      ) {
        let cnt = 3;
        while (
          i + cnt * len <= toks.length &&
          toks.slice(i + cnt * len, i + (cnt + 1) * len).join(" ") === phrase
        )
          cnt++;
        out.push(phrase);
        i += cnt * len;
        merged = true;
        break;
      }
    }
    if (!merged) {
      out.push(toks[i]);
      i++;
    }
  }
  return out.join(" ");
}

export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((x) => ("str" in x ? x.str : "")).join(" ") + "\n";
  }
  return cleanPdfText(text);
}

/* ── PAYMENT/AMOUNT EXTRACTOR (for a payment remittance or an invoice PDF) ── */

export type PaymentExtractMode = "payment" | "invoice" | "invoice-pl";

export interface ExtractedPayment {
  montant: number | null;
  montantBrut: number | null;
  date: string | null;
}

export async function extractPaymentFromPdf(
  file: File,
  mode: PaymentExtractMode,
): Promise<ExtractedPayment | null> {
  try {
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const ct = await pg.getTextContent();
      text += ct.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }
    function parseAmt(s: string): number {
      const r = s.replace(/\s/g, "");
      if (r.includes(",") && r.includes(".")) {
        return r.lastIndexOf(",") > r.lastIndexOf(".")
          ? parseFloat(r.replace(/\./g, "").replace(",", "."))
          : parseFloat(r.replace(/,/g, ""));
      }
      return parseFloat(r.includes(",") ? r.replace(",", ".") : r);
    }
    let montant: number | null = null;
    let montantBrut: number | null = null;
    if (mode === "invoice" || mode === "invoice-pl") {
      const allAmts: number[] = [];
      const re = /((?:\d{1,3}[\s,.])*\d+[.,]\d{2})/g;
      for (const m of text.matchAll(re)) {
        const v = parseAmt(m[1]);
        if (v >= 50 && v < 100000000) allAmts.push(v);
      }
      if (allAmts.length) {
        const largest = Math.max(...allAmts);
        if (mode === "invoice-pl") {
          let deduction: number | null = null;
          const advPat =
            /less\s+(?:\d+[%\s]*)?(?:advance|acompte|deposit)[^\d]{0,15}([\d][\d\s,.]*\d{2})/gi;
          for (const am of text.matchAll(advPat)) {
            const v = parseAmt(am[1]);
            if (v > 0 && v < largest) {
              deduction = v;
              break;
            }
          }
          if (deduction === null) {
            const bsPat = /before\s+shipment[^0-9]{0,5}([\d][\d\s,.]*\d{2})/gi;
            for (const bm of text.matchAll(bsPat)) {
              const v = parseAmt(bm[1]);
              if (v > 0 && v < largest) {
                deduction = v;
                break;
              }
            }
          }
          montantBrut = Math.round(largest * 100) / 100;
          montant = Math.round((deduction != null ? largest - deduction : largest) * 100) / 100;
        } else {
          montant = Math.round(largest * 100) / 100;
        }
      }
    } else {
      const pats = [
        /montant\s*(?:du\s*)?(?:virement|vir[eé]?|pay[eé]|r[eè]gl[eé]|total)?\s*[:-]?\s*([\d \s]{1,14}[,.]\d{2})\s*(?:EUR|USD|GBP|CHF|€)?/gi,
        /(?:total|amount|somme|sum|payment)\s*[:-]?\s*([\d \s]{1,14}[,.]\d{2})\s*(?:EUR|USD|GBP|CHF|€)?/gi,
        /([\d \s]{1,14}[,.]\d{2})\s*(?:EUR|€)/gi,
        /(?:EUR|€)\s*([\d \s]{1,14}[,.]\d{2})/gi,
      ];
      for (const pat of pats) {
        pat.lastIndex = 0;
        for (const m of text.matchAll(pat)) {
          const v = parseAmt(m[1]);
          if (v >= 1 && v < 10000000) {
            montant = Math.round(v * 100) / 100;
            break;
          }
        }
        if (montant) break;
      }
    }
    let date: string | null = null;
    const dm = text.match(/(\d{2})[/\-.](\d{2})[/\-.](\d{4})/);
    const dy = text.match(/(\d{4})[/\-.](\d{2})[/\-.](\d{2})/);
    if (dm) date = dm[3] + "-" + dm[2] + "-" + dm[1];
    else if (dy) date = dy[1] + "-" + dy[2] + "-" + dy[3];
    return { montant, montantBrut, date };
  } catch (e) {
    console.error("PDF extract:", e);
    return null;
  }
}

/* ── DATE HELPERS ──────────────────────────────────────────────────────── */

function normDate(str: string): string {
  if (!str) return "";
  const p = str.split(/[/\-.]/);
  if (p.length !== 3) return "";
  const [a, b, c] = p;
  if (a.length === 4) return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
  if (c.length === 4) return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  return "";
}

/* ── CSV IMPORT (orders) — moved to a PDF.js-free module ─────────────── */

export { parseCsvOrders, type ParsedCsvOrder } from "@/lib/csv-orders";

/* ── ORDER PDF PARSING (regex fallback) ───────────────────────────────── */

export interface ParsedOrderLine {
  reference: string;
  produit: string;
  dateLivraison: string;
  qty: number;
  unitCost: number;
  montant: number;
}

export interface ParsedOrder {
  reference: string;
  fournisseur: string;
  produit: string;
  montant: number;
  devise: string;
  dateCommande: string;
  dateLivraison: string;
  incoterms: string;
  notes: string;
  conditionsPaiement: unknown[];
  lignes: ParsedOrderLine[];
}

export function parseOrderBasic(text: string): ParsedOrder {
  const refM =
    text.match(/docket[:\s]*([A-Z]{0,4}\d{4,})/i) ||
    text.match(
      /(?:P\.?O\.?|purchase\s*order|order\s*n[o°]?|bon\s*de\s*commande)[^\w\n]*([A-Z]{1,6}[/-]\d{3,}|\d{4,})/i,
    );
  const mfrM = text.match(
    /manufacturer[\s:]+([A-Z][A-Z\s&.'()-]{2,50}?)(?=\s*(?:manufacturer|edit|ship|delivery|printed|page)|$)/i,
  );
  function parseAmt(s: string): number {
    if (!s) return 0;
    s = s.replace(/\s/g, "");
    const ci = s.lastIndexOf(",");
    const di = s.lastIndexOf(".");
    if (ci > di) return parseFloat(s.replace(/\./g, "").replace(",", "."));
    return parseFloat(s.replace(/,/g, ""));
  }
  let amtVal = 0;
  const gtMatch = text.match(/grand\s*total([\s\S]{0,600})/i);
  if (gtMatch) {
    const nums = [...gtMatch[1].matchAll(/\d[\d,.]*[.,]\d{2}/g)]
      .map((m) => parseAmt(m[0]))
      .filter((n) => n > 0);
    if (nums.length) amtVal = Math.max(...nums);
  }
  if (!amtVal) {
    const amtM = text.match(
      /(?:total|montant\s*total|amount)[\s:]*[\S]?\s*(\d[\d,.\s]*[.,]\d{2})/i,
    );
    if (amtM) amtVal = parseAmt(amtM[1]);
  }
  const devM = text.match(/\b(EUR|USD|GBP)\b/) || text.match(/([€$£])/);
  const devMap: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };
  const incoM = text.match(/\b(FOB|CIF|EXW|DDP|CFR|FCA|DAP|DPU)\b/i);
  function normD(str: string): string {
    if (!str) return "";
    const p = str.split(/[/\-.]/);
    if (p.length !== 3) return "";
    const [a, b, cc] = p;
    if (a.length === 4) return a + "-" + b.padStart(2, "0") + "-" + cc.padStart(2, "0");
    if (cc.length === 4) return cc + "-" + b.padStart(2, "0") + "-" + a.padStart(2, "0");
    return "";
  }
  const dcM = text.match(/(?:^|\s)date[:\s]+(\d{2}[/\-.]\d{2}[/\-.]\d{4})/i);
  const allDates = (text.match(/\d{2}[/\-.]\d{2}[/\-.]\d{2,4}|\d{4}[/-]\d{2}[/-]\d{2}/g) || [])
    .map(normD)
    .filter(Boolean);
  const dateCommande = dcM ? normD(dcM[1]) : allDates.sort()[0] || "";
  const delivM = text.match(/delivery\s*(?:\([^)]*\))?[\s:]*(\d{2}[/-]\d{2}[/-]\d{4})/i);
  const otherDates = allDates.filter((d) => d !== dateCommande);
  const dateLivraison = delivM ? normD(delivM[1]) : otherDates.sort()[0] || "";
  const conditionsPaiement: unknown[] = [];
  const pctRx =
    /(\d{1,3})\s*%[^.\n]{0,100}?(acompte|deposit|advance|down.?pay|solde|balance|remain|avant.exp|before.ship|livraison|shipment)/gi;
  let pm;
  while ((pm = pctRx.exec(text)) !== null) {
    const pct = parseInt(pm[1]);
    const isBalance = /(solde|balance|remain|avant|before|livraison|shipment)/i.test(pm[2]);
    if (pct > 0 && pct <= 100)
      conditionsPaiement.push({
        label: pm[0].trim().slice(0, 80),
        percent: pct,
        montant: 0,
        type: isBalance ? "event" : "date",
        event: isBalance ? "expedition" : "",
        dueDate: "",
      });
  }
  const PSKIP =
    /^(PRODUCT|DELIVERY|FABRIC|COLOUR|COLOURS|SIZES|PRINT|GRAND|TOTAL|PAGE|SIZE|EDIT|SHIP|PRODUCTION|MANUFACTURER|DOCKET)/i;
  const allCodes = [...text.matchAll(/\b([A-Z]{2,}\d[A-Z0-9]{3,})\b/g)]
    .map((m) => ({ code: m[1], pos: m.index ?? 0 }))
    .filter(({ code }) => code.length >= 7 && !PSKIP.test(code));
  const allDts = [...text.matchAll(/(\d{2}[/-]\d{2}[/-]\d{4})/g)]
    .map((m) => ({ date: normD(m[1]), pos: m.index ?? 0 }))
    .filter((d) => d.date);
  const seenCodes = new Set<string>();
  const lignes: ParsedOrderLine[] = [];
  for (const { code, pos } of allCodes) {
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);
    const nd = allDts.filter((d) => d.pos > pos).sort((a, b) => a.pos - b.pos)[0];
    if (!nd) continue;
    const nameSlice = text.slice(pos + code.length, pos + code.length + 120);
    const nm = nameSlice.match(/^\s+([A-Z][A-Z ]{2,40}?)(?=\s+[^A-Z]|\s*\d|$)/);
    const nextC = allCodes.find((c) => c.pos > pos);
    const gtPos2 = text.search(/grand\s*total/i);
    const amtBound = nextC ? nextC.pos : gtPos2 >= 0 ? gtPos2 : nd.pos + 400;
    const amtSlice = text.slice(nd.pos + 10, Math.min(amtBound, nd.pos + 500));
    const amts = [...amtSlice.matchAll(/\b(\d[\d,.]*[.,]\d{2})\b/g)]
      .map((m) => parseAmt(m[0]))
      .filter((n) => n > 0 && n < 1e7)
      .sort((a, b) => a - b);
    const unitCost = amts.length >= 2 ? amts[0] : 0;
    const montantL = amts.length >= 1 ? amts[amts.length - 1] : 0;
    const qty = unitCost > 0 && montantL > 0 ? Math.round(montantL / unitCost) : 0;
    lignes.push({
      reference: code,
      produit: nm ? nm[1].trim() : "",
      dateLivraison: nd.date,
      qty,
      unitCost,
      montant: montantL,
    });
  }
  const produit = lignes
    .map((l) => l.produit)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ")
    .slice(0, 120);
  return {
    reference: refM ? refM[1].trim() : "",
    fournisseur: mfrM ? mfrM[1].trim() : "",
    produit,
    montant: amtVal,
    devise: devM ? devMap[devM[1]] || devM[1] : "EUR",
    dateCommande,
    dateLivraison,
    incoterms: incoM ? incoM[1].toUpperCase() : "",
    notes: "",
    conditionsPaiement,
    lignes,
  };
}

/* ── ORDER PDF PARSING (Claude, needs an API key) ─────────────────────── */

async function callClaude(apiKey: string, prompt: string, maxTokens: number): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e.error?.message || "Erreur API " + resp.status);
  }
  const data = await resp.json();
  return data.content[0].text.trim();
}

function extractJson<T>(raw: string): T {
  const m = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : raw) as T;
}

export async function parseOrderWithClaude(apiKey: string, text: string): Promise<ParsedOrder> {
  const prompt = `Tu analyses un bon de commande fournisseur (mode/textile/production).
Extrais ces informations et retourne UNIQUEMENT un objet JSON valide, sans explication :
{
  "reference": "numero du docket/PO ex: 100033 ou MIL/00039",
  "fournisseur": "nom exact du fabricant (champ Manufacturer)",
  "produit": "description generale des produits",
  "montant": 0,
  "devise": "EUR ou USD ou GBP selon le symbole (euro=EUR, livre=GBP, dollar=USD)",
  "dateCommande": "YYYY-MM-DD — cherche Date: ou Production Order Date:",
  "dateLivraison": "YYYY-MM-DD — si plusieurs dates de livraison, prends la plus proche",
  "incoterms": "FOB/CIF/etc. ou vide",
  "notes": "quantite totale, saison, autres infos",
  "lignes": [
    {"reference":"BZFW25JA11055","produit":"VESTIGE JACKET","qty":26,"unitCost":112.00,"montant":2912.00,"dateLivraison":"2026-01-20"}
  ],
  "conditionsPaiement": []
}
Regles importantes:
- reference: prends le numero Docket ou PO, pas le numero de page.
- fournisseur: prends le champ Manufacturer, pas la societe emettrice.
- dateCommande: c'est la date du bon de commande (champ Date:), format YYYY-MM-DD.
- dateLivraison: si plusieurs dates, prends la PLUS PROCHE (premiere chronologiquement).
- devise: deduis du symbole monetaire (euro/EUR=EUR, livre/GBP=GBP, dollar/USD=USD).
- montant: total general de la commande (Grand Total).
- lignes: extrait CHAQUE ligne produit avec son Product ID, nom, quantite, cout unitaire, montant et date de livraison. Si une ligne n'a pas de date specifique, utilise dateLivraison globale.
- conditionsPaiement: laisse [].

Document :
${text.slice(0, 7000)}`;
  const raw = await callClaude(apiKey, prompt, 2000);
  return extractJson<ParsedOrder>(raw);
}

/* ── SUPPLIER PARSING ──────────────────────────────────────────────────── */

export function parsePaymentTermsText(str: string | undefined): RawConditionPaiement[] {
  if (!str) return [];
  const conditions: RawConditionPaiement[] = [];
  // Net terms recognised as "X days after shipment": "net X", "within X days",
  // "X days net", "at X days", and a bare "X days" (the common shorthand). The more
  // specific patterns come first so their days are captured before the bare fallback.
  const rx =
    /(\d{1,3})\s*%[^,%]{0,90}?(deposit|advance|acompte|commande|before\s*ship|before\s*deliv|avant\s*exp|avant\s*livr|within\s*(\d+)\s*days?|net\s*(\d+)|(\d+)\s*days?\s*net|at\s*(\d+)\s*days?|(\d+)\s*days?|after\s*ship)/gi;
  let m;
  while ((m = rx.exec(str)) !== null) {
    const pct = parseInt(m[1]);
    const kw = m[2].toLowerCase();
    const days = parseInt(m[3] || m[4] || m[5] || m[6] || m[7] || "0");
    const isDeposit = /(deposit|advance|acompte|commande)/i.test(kw);
    if (pct > 0 && pct <= 100) {
      if (isDeposit)
        conditions.push({
          id: uid(),
          label: m[0].trim(),
          percent: pct,
          triggerType: "date_order",
          daysAfterOrder: 0,
        });
      else if (days > 0)
        conditions.push({
          id: uid(),
          label: m[0].trim(),
          percent: pct,
          triggerType: "event",
          triggerEvent: "expedition",
          daysAfterEvent: days,
        });
      else
        conditions.push({
          id: uid(),
          label: m[0].trim(),
          percent: pct,
          triggerType: "event",
          triggerEvent: "expedition",
          daysAfterEvent: 0,
        });
    }
  }
  return conditions;
}

export interface ParsedSupplier {
  nom: string;
  pays: string;
  adresse: string;
  email: string;
  telephone: string;
  devise: string;
  incoterms: string;
  conditionsPaiementText: string;
  coordonneesBancaires?: string;
  notes: string;
}

export function parseSupplierBasic(text: string): ParsedSupplier {
  const emailM = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const telM =
    text.match(/mobile\s+(\+?[\d\s\-().]{7,18})/i) ||
    text.match(/telephone\s*2\s+(\+?[\d\s\-().]{7,18})/i) ||
    text.match(/(\+[\d\s\-()]{9,18})/);
  const incoM = text.match(/\b(FOB|CIF|EXW|DDP|CFR|FCA|DAP|DPU)\b/i);
  const NEXT_LABEL =
    "(?=\\s+(?:CONTACT|ADDRESS|CITY|POST|COUNTRY|TELEPHONE|MOBILE|FAX|EMAIL|WWW|BANK|PAYMENT|SHIPPER|AGENT|PAGE)|$)";
  const nameM =
    text.match(new RegExp("manufacturer\\s*name\\s+(.+?)" + NEXT_LABEL, "i")) ||
    text.match(new RegExp("company\\s*name\\s+(.+?)" + NEXT_LABEL, "i"));
  const countryM =
    text.match(/country\s+([A-Z][A-Za-z\s]{2,20}?)(?=\s+[A-Z]{2,}\s|$)/i) ||
    text.match(
      /\b(INDIA|CHINA|VIETNAM|BANGLADESH|TURKEY|PORTUGAL|FRANCE|ITALY|MOROCCO|PAKISTAN|CAMBODIA|MYANMAR|INDONESIA)\b/i,
    );
  const ptM = text.match(
    /payment\s*terms?\s+(.+?)(?=\s+(?:SHIPPER|AGENT|COMMENT|PAGE|BANK|WWW|$))/i,
  );
  const conditionsPaiementText = ptM ? ptM[1].trim().replace(/\s+/g, " ") : "";
  const devM = text.match(/\b(EUR|USD|GBP)\b/);
  return {
    nom: nameM ? nameM[1].trim() : "",
    pays: countryM ? (countryM[1] || countryM[0]).trim() : "",
    adresse: "",
    email: emailM ? emailM[0] : "",
    telephone: telM ? (telM[1] || telM[0]).trim() : "",
    devise: devM ? devM[1] : "EUR",
    incoterms: incoM ? incoM[1].toUpperCase() : "",
    conditionsPaiementText,
    notes: "",
  };
}

export async function parseSupplierWithClaude(
  apiKey: string,
  text: string,
): Promise<ParsedSupplier> {
  const prompt = `Tu analyses une fiche fournisseur ou un document fournisseur dans le secteur mode/textile.
Extrais ces informations et retourne UNIQUEMENT un objet JSON valide, sans explication :
{
  "nom": "nom de l entreprise/fabricant",
  "pays": "pays ex INDIA, CHINA, FRANCE",
  "adresse": "adresse complete ou vide",
  "email": "email principal ou vide",
  "telephone": "numero principal ou vide",
  "devise": "EUR ou USD ou GBP",
  "incoterms": "FOB/CIF/etc. ou vide",
  "conditionsPaiementText": "conditions de paiement textuelles ex: 50% DEPOSIT, 50% BEFORE SHIPMENT",
  "coordonneesBancaires": "banque et numero de compte ou vide",
  "notes": "autres infos utiles"
}

Document :
${text.slice(0, 5000)}`;
  const raw = await callClaude(apiKey, prompt, 800);
  return extractJson<ParsedSupplier>(raw);
}

export { normDate };

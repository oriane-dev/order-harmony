// Construction des « échéances » (montants à régler / encaisser, datés) à partir des
// commandes. Partagé par la page Échéancier ET le tableau de bord pour qu'ils
// s'appuient exactement sur le même calcul.

import * as XLSX from "xlsx";
import type { Order } from "@/lib/ledger-types";
import type { RawOrder, RawSupplier } from "@/lib/thalae-types";
import {
  computeSupplierSchedule,
  computeCustomerSchedule,
  supplierByNameIndex,
} from "@/lib/payment-schedule";
import { seasonOf } from "@/lib/season";
import { fmtDate } from "@/lib/format";

export type Category = "Acompte" | "Before shipment" | "Solde" | "Facture";

export interface DueItem {
  key: string;
  order: Order;
  side: "payable" | "receivable";
  sideLabel: string;
  season: string;
  category: Category;
  label: string; // libellé détaillé (ex. "Acompte 30%")
  amount: number;
  date: string; // ISO ou ""
  estimated: boolean; // true = date prévisionnelle (pas une échéance précise saisie)
}

// première échéance dueDate d'une facture client non soldée (pour dater la ligne)
function customerDueDate(raw: RawOrder | undefined): string {
  const dates: string[] = [];
  for (const pl of raw?.docFlow?.packingLists ?? [])
    for (const f of pl.factures ?? []) if (f.dueDate) dates.push(f.dueDate);
  for (const di of raw?.docFlow?.proforma?.depositInvoices ?? [])
    if (di.dueDate) dates.push(di.dueDate);
  dates.sort();
  return dates[0] ?? "";
}

export function buildDueItems(
  supplierOrders: Order[],
  customerOrders: Order[],
  rawSupplierOrders: RawOrder[],
  rawCustomerOrders: RawOrder[],
  rawSuppliers: RawSupplier[],
  rawCustomers: RawSupplier[] = [],
): DueItem[] {
  const supIndex = supplierByNameIndex(rawSuppliers);
  const custIndex = supplierByNameIndex(rawCustomers); // fiches clients (même forme)
  const rawSupById = new Map(rawSupplierOrders.map((o) => [o.id, o]));
  const rawCustById = new Map(rawCustomerOrders.map((o) => [o.id, o]));
  const out: DueItem[] = [];

  for (const o of supplierOrders) {
    if (o.archived) continue;
    const raw = rawSupById.get(o.id);
    const season = seasonOf(raw?.notes);
    const sched = raw
      ? computeSupplierSchedule(raw, supIndex.get((raw.fournisseur ?? "").trim().toLowerCase()))
      : [];
    if (sched.length) {
      for (const inst of sched) {
        if (inst.remaining <= 0.01 || !inst.date) continue;
        const category: Category =
          inst.kind === "deposit"
            ? "Acompte"
            : inst.kind === "before_shipment"
              ? "Before shipment"
              : "Solde";
        out.push({
          key: `${o.id}:${inst.id}`,
          order: o,
          side: "payable",
          sideLabel: "Fournisseur",
          season,
          category,
          label: inst.label,
          amount: inst.remaining,
          date: inst.date,
          estimated: inst.estimated,
        });
      }
    } else if (o.status === "deposit_to_pay") {
      const pf = o.docs.find((d) => d.kind === "proforma");
      const amount = pf?.remaining ?? pf?.amount ?? o.totals.ordered;
      if (amount > 0.01)
        out.push({
          key: `${o.id}:dep`,
          order: o,
          side: "payable",
          sideLabel: "Fournisseur",
          season,
          category: "Acompte",
          label: "Acompte",
          amount,
          date: raw?.docFlow?.proforma?.docDate ?? "",
          estimated: false,
        });
    } else {
      const gap = o.totals.invoiced - o.totals.paid;
      if (gap > 0.01)
        out.push({
          key: `${o.id}:fac`,
          order: o,
          side: "payable",
          sideLabel: "Fournisseur",
          season,
          category: "Facture",
          label: "Facture",
          amount: gap,
          date: "",
          estimated: false,
        });
    }
  }

  for (const o of customerOrders) {
    if (o.archived) continue;
    const raw = rawCustById.get(o.id);
    const season = seasonOf(raw?.notes);
    const fiche = raw ? custIndex.get((raw.fournisseur ?? "").trim().toLowerCase()) : undefined;
    const sched = raw ? computeCustomerSchedule(raw, fiche) : [];
    if (sched.length) {
      for (const inst of sched) {
        if (inst.remaining <= 0.01 || !inst.date) continue;
        const category: Category =
          inst.kind === "deposit"
            ? "Acompte"
            : inst.kind === "before_shipment"
              ? "Before shipment"
              : "Solde";
        out.push({
          key: `${o.id}:${inst.id}`,
          order: o,
          side: "receivable",
          sideLabel: "Client",
          season,
          category,
          label: inst.label,
          amount: inst.remaining,
          date: inst.date,
          estimated: inst.estimated,
        });
      }
    } else {
      // client sans conditions complètes → affichage simple (gap à la due date)
      const gap = o.totals.invoiced - o.totals.paid;
      if (gap > 0.01)
        out.push({
          key: `${o.id}:fac`,
          order: o,
          side: "receivable",
          sideLabel: "Client",
          season,
          category: "Facture",
          label: "Facture",
          amount: gap,
          date: customerDueDate(raw),
          estimated: false,
        });
    }
  }
  return out;
}

/* ── Notion du « jour » : bornes du mois et de la semaine en cours ─────────── */

// yyyy-mm-dd local
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export interface Period {
  start: string; // ISO yyyy-mm-dd inclus
  end: string; // ISO yyyy-mm-dd inclus
}

export function currentMonth(now: Date = new Date()): Period {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: isoDay(start), end: isoDay(end) };
}

// Semaine ISO (lundi → dimanche) contenant `now`.
export function currentWeek(now: Date = new Date()): Period {
  const day = now.getDay(); // 0 dim … 6 sam
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { start: isoDay(monday), end: isoDay(sunday) };
}

// Une échéance est « due » sur la période si sa date est <= fin de période (inclut
// donc les échéances en retard non réglées) et non vide.
export function isDueWithin(item: DueItem, period: Period): boolean {
  return !!item.date && item.date <= period.end;
}

// Idem mais strictement dans la période (utilisé pour l'affichage détaillé).
export function isInPeriod(item: DueItem, period: Period): boolean {
  return !!item.date && item.date >= period.start && item.date <= period.end;
}

// Export Excel d'une liste d'échéances (reprend les colonnes du tableau + une ligne
// TOTAL en bas). Téléchargement déclenché par l'utilisateur.
export function exportEcheancesExcel(items: DueItem[], filename = "echeances.xlsx"): void {
  if (!items.length) {
    alert("Aucune échéance sélectionnée à exporter.");
    return;
  }
  const rows: Record<string, string | number>[] = items.map((d) => ({
    Commande: d.order.number,
    Contrepartie: d.order.party.name,
    Côté: d.sideLabel,
    Saison: d.season || "",
    Type: d.label,
    Échéance: d.date ? fmtDate(d.date) : "",
    "Montant dû (€)": Math.round(d.amount),
  }));
  const total = items.reduce((a, d) => a + d.amount, 0);
  rows.push({
    Commande: "",
    Contrepartie: "",
    Côté: "",
    Saison: "",
    Type: "TOTAL",
    Échéance: "",
    "Montant dû (€)": Math.round(total),
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Échéances");
  XLSX.writeFile(wb, filename);
}

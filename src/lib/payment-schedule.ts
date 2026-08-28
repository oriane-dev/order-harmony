// Échéancier de paiement d'une commande fournisseur, dérivé des conditions de
// paiement du fournisseur et des dates du docFlow. Partagé par l'échéancier et le
// calendrier pour qu'ils affichent exactement les mêmes échéances.
//
// Déclencheurs :
//   • Acompte (triggerType "date_order")      → à la DATE DE LA PRO FORMA
//   • Before shipment (event, 0 jour)         → à la réception de la 1re FACTURE
//                                                (estimé à la date de livraison tant
//                                                 que la facture n'est pas reçue)
//   • Solde net X (event, X jours)            → date de LIVRAISON + X jours
//
// Les paiements déjà enregistrés sont imputés aux échéances dans l'ordre
// chronologique (waterfall), de sorte qu'une échéance soldée n'apparaît plus.

import type { RawFacture, RawOrder, RawSupplier } from "@/lib/thalae-types";

export type InstallmentKind = "deposit" | "before_shipment" | "net_x";

export interface Installment {
  id: string;
  kind: InstallmentKind;
  label: string;
  date: string; // ISO yyyy-mm-dd ; "" si le déclencheur n'a pas encore de date
  amount: number; // montant total de l'échéance
  remaining: number; // restant à payer après imputation des paiements
  estimated: boolean; // true = date prévisionnelle (livraison prévue, pas encore déclenchée)
}

export function addDaysIso(iso: string | undefined, n: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Somme de tous les paiements enregistrés sur la commande (acompte pro forma,
// factures d'acompte, livraisons, facture définitive).
export function paidOfOrder(order: RawOrder): number {
  const df = order.docFlow;
  if (!df) return 0;
  const all = [
    ...(df.proforma?.paiements ?? []),
    ...(df.proforma?.depositInvoices ?? []).flatMap((di) => di.paiements ?? []),
    ...(df.packingLists ?? []).flatMap((pl) => pl.paiements ?? []),
    ...(df.factureDefinitive?.paiements ?? []),
  ];
  return all.reduce((a, p) => a + (p.montant ?? 0), 0);
}

// La première facture (de livraison) reçue, la plus ancienne par date de document.
function firstFactureOf(order: RawOrder): RawFacture | undefined {
  let first: RawFacture | undefined;
  for (const pl of order.docFlow?.packingLists ?? []) {
    for (const f of pl.factures ?? []) {
      if (!first) first = f;
      else if (f.docDate && (!first.docDate || f.docDate < first.docDate)) first = f;
    }
  }
  return first;
}

// Renvoie les échéances de paiement de la commande, dates calculées et restant à
// payer imputé. Renvoie [] si le fournisseur n'a pas de conditions complètes (~100 %)
// ou si la commande n'a pas de montant — dans ce cas l'appelant retombe sur un
// affichage simple (acompte / facture à payer).
export function computeSupplierSchedule(
  order: RawOrder,
  supplier: RawSupplier | undefined,
): Installment[] {
  const conds = supplier?.conditionsPaiement ?? [];
  const montant = order.montant ?? 0;
  const pctSum = conds.reduce((a, c) => a + (c.percent ?? 0), 0);
  if (conds.length === 0 || montant <= 0 || Math.abs(pctSum - 100) > 0.5) return [];

  const df = order.docFlow;
  const proformaDate = df?.proforma?.docDate || "";
  const delivery = order.dateLivraison || "";
  const firstFacture = firstFactureOf(order);
  const hasFacture = !!firstFacture;
  const factureDate = firstFacture?.docDate || delivery;

  const insts: Installment[] = conds.map((c, i) => {
    const amount = (montant * (c.percent ?? 0)) / 100;
    const days = c.daysAfterEvent ?? 0;
    const id = c.id || `c${i}`;
    if (c.triggerType === "date_order") {
      // Acompte → échéance = date de la pro forma
      return {
        id,
        kind: "deposit",
        label: `Acompte ${c.percent}%`,
        date: proformaDate,
        amount,
        remaining: amount,
        estimated: false,
      };
    }
    if (days > 0) {
      // Solde net X → date de livraison + X jours
      return {
        id,
        kind: "net_x",
        label: `Solde ${c.percent}% (net ${days}j)`,
        date: addDaysIso(delivery, days),
        amount,
        remaining: amount,
        estimated: false,
      };
    }
    // Before shipment → déclenché par la 1re facture ; estimé à la livraison sinon
    return {
      id,
      kind: "before_shipment",
      label: `Before shipment ${c.percent}%`,
      date: hasFacture ? factureDate : delivery,
      amount,
      remaining: amount,
      estimated: !hasFacture,
    };
  });

  // waterfall : imputer le total payé aux échéances par ordre chronologique
  const dated = insts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let paidLeft = paidOfOrder(order);
  for (const it of dated) {
    const cover = Math.min(paidLeft, it.amount);
    paidLeft -= cover;
    it.remaining = it.amount - cover;
  }
  return dated;
}

// Index nom de fournisseur (minuscule) → fiche fournisseur, pour retrouver les
// conditions de paiement à partir de `order.fournisseur`.
export function supplierByNameIndex(suppliers: RawSupplier[]): Map<string, RawSupplier> {
  const m = new Map<string, RawSupplier>();
  for (const s of suppliers) if (s.nom) m.set(s.nom.trim().toLowerCase(), s);
  return m;
}

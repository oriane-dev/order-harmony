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

export type InstallmentKind = "deposit" | "post_proforma" | "before_shipment" | "net_x";

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

// Toutes les « pro formas pour livraison » de la commande (parties appelées du
// Before Shipment), avec leur montant, date d'échéance et total payé.
export function livraisonProformasOf(
  order: RawOrder,
): { id: string; montant: number; dueDate: string; paid: number }[] {
  const out: { id: string; montant: number; dueDate: string; paid: number }[] = [];
  for (const pl of order.docFlow?.packingLists ?? []) {
    for (const lp of pl.livraisonProformas ?? []) {
      out.push({
        id: lp.id,
        montant: lp.montant ?? 0,
        dueDate: lp.dueDate ?? "",
        paid: (lp.paiements ?? []).reduce((a, p) => a + (p.montant ?? 0), 0),
      });
    }
  }
  return out;
}

// Total réellement payé sur les pro formas pour livraison (before shipment appelé).
export function livraisonProformaPaidOf(order: RawOrder): number {
  return livraisonProformasOf(order).reduce((a, lp) => a + lp.paid, 0);
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
  const pf = df?.proforma;
  // Certaines commandes fournisseurs n'ont PAS de deposit (ce n'est pas une erreur) :
  // aucune pro forma initiale n'est renseignée. Dans ce cas on saute l'acompte et son
  // montant est reporté sur le Before Shipment (rien n'est perdu dans le prévisionnel).
  const hasProformaInitiale = !!(
    pf &&
    (pf.pdf ||
      (pf.montant ?? 0) > 0 ||
      (pf.paiements?.length ?? 0) > 0 ||
      (pf.depositInvoices?.length ?? 0) > 0 ||
      pf.docDate)
  );
  const proformaDate = df?.proforma?.docDate || "";
  const delivery = order.dateLivraison || "";
  const firstFacture = firstFactureOf(order);
  const hasFacture = !!firstFacture;
  const factureDate = firstFacture?.docDate || delivery;

  // 1) Échéances issues des conditions (acompte, net X, post-pro forma). Le Before
  //    Shipment est agrégé à part pour être scindé en "appelé" + "reste".
  const conditionInsts: Installment[] = [];
  let beforeShipTotal = 0;
  conds.forEach((c, i) => {
    const amount = (montant * (c.percent ?? 0)) / 100;
    const days = c.daysAfterEvent ?? 0;
    const id = c.id || `c${i}`;
    if (c.triggerType === "date_order") {
      const dao = c.daysAfterOrder ?? 0;
      if (dao > 0) {
        conditionInsts.push({
          id,
          kind: "post_proforma",
          label: `Solde ${c.percent}% (net ${dao}j pro forma)`,
          date: addDaysIso(proformaDate, dao),
          amount,
          remaining: amount,
          estimated: true,
        });
      } else if (hasProformaInitiale) {
        conditionInsts.push({
          id,
          kind: "deposit",
          label: `Acompte ${c.percent}%`,
          date: proformaDate,
          amount,
          remaining: amount,
          estimated: false,
        });
      } else {
        // pas de deposit sur cette commande → le montant est reporté sur le Before Shipment
        beforeShipTotal += amount;
      }
    } else if (days > 0) {
      conditionInsts.push({
        id,
        kind: "net_x",
        label: `Solde ${c.percent}% (net ${days}j)`,
        date: addDaysIso(delivery, days),
        amount,
        remaining: amount,
        estimated: true,
      });
    } else {
      beforeShipTotal += amount; // before shipment (event, 0 jour)
    }
  });

  // 2) Before Shipment APPELÉ via les pro formas pour livraison (chacune avec sa date
  //    d'échéance et ses propres paiements).
  const lps = livraisonProformasOf(order).filter((lp) => lp.montant > 0);
  let calledTotal = 0;
  const lpInsts: Installment[] = lps.map((lp) => {
    calledTotal += lp.montant;
    return {
      id: `lp:${lp.id}`,
      kind: "before_shipment",
      label: "Before shipment (demandé)",
      date: lp.dueDate || factureDate || delivery,
      amount: lp.montant,
      remaining: Math.max(0, lp.montant - lp.paid),
      estimated: false,
    };
  });

  // 3) Reste du Before Shipment non encore appelé → prévisionnel (conditions).
  const uncalled = Math.max(0, beforeShipTotal - calledTotal);
  if (uncalled > 0.01) {
    conditionInsts.push({
      id: "bs-uncalled",
      kind: "before_shipment",
      label: "Before shipment (prévu)",
      date: hasFacture ? factureDate : delivery,
      amount: uncalled,
      remaining: uncalled,
      estimated: true,
    });
  }

  // 4) Waterfall du pool général (acompte pro forma, paiements livraison/facture ;
  //    PAS les paiements des pro formas pour livraison, imputés à leur propre échéance)
  //    sur les échéances issues des conditions, par ordre chronologique.
  const dated = conditionInsts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let pool = paidOfOrder(order);
  for (const it of dated) {
    const cover = Math.min(pool, it.amount);
    pool -= cover;
    it.remaining = it.amount - cover;
  }

  // 5) Fusion (échéances conditions + pro formas livraison) triées par date.
  return [...dated, ...lpInsts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Index nom de fournisseur (minuscule) → fiche fournisseur, pour retrouver les
// conditions de paiement à partir de `order.fournisseur`.
export function supplierByNameIndex(suppliers: RawSupplier[]): Map<string, RawSupplier> {
  const m = new Map<string, RawSupplier>();
  for (const s of suppliers) if (s.nom) m.set(s.nom.trim().toLowerCase(), s);
  return m;
}

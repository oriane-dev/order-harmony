// Payments calendar pivot — months as columns, seasons as rows. Shared by the
// supplier and customer sides via an `entity` prop:
//   • supplier ("payable")  → money paid out; forecast from each order's outstanding
//                              balance at its expected-delivery month.
//   • customer ("receivable") → money received in; forecast from each unpaid invoice's
//                              outstanding balance at its own due date (échéance).
// In both cases: up to the current month, cells show the real payments recorded (by
// their date); after the current month, cells show what's still expected.

import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ordersQueryOptions,
  rawOrdersQueryOptions,
  customerOrdersQueryOptions,
  rawCustomerOrdersQueryOptions,
} from "@/lib/data";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { seasonOf, seasonSortKey } from "@/lib/season";
import { shortMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Entity } from "@/lib/entities";
import type { RawFacture } from "@/lib/thalae-types";

/* ── month-key helpers (keys are "YYYY-MM", so string compare = chronological) ── */
function keyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function keyFromIso(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : keyFromDate(d);
}
function addMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  return keyFromDate(new Date(y, m - 1 + delta, 1));
}
function monthLabelShort(key: string): { m: string; y: string } {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return { m: d.toLocaleDateString("fr-FR", { month: "short" }), y: String(y).slice(2) };
}
function monthLabelFull(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

interface OverdueItem {
  season: string;
  orderId: string;
  ref: string;
  client: string;
  docNo?: string;
  amount: number;
  dueDate?: string;
}

function bump(map: Map<string, Map<string, number>>, season: string, key: string, amt: number) {
  let row = map.get(season);
  if (!row) {
    row = new Map();
    map.set(season, row);
  }
  row.set(key, (row.get(key) ?? 0) + amt);
}

export function PaymentsCalendar({ entity }: { entity: Entity }) {
  const isSupplier = entity === "supplier";
  const { data: orders } = useSuspenseQuery(
    isSupplier ? ordersQueryOptions() : customerOrdersQueryOptions(),
  );
  const { data: rawOrders } = useSuspenseQuery(
    isSupplier ? rawOrdersQueryOptions() : rawCustomerOrdersQueryOptions(),
  );

  // Re-evaluated on every render, so the "current month" divider tracks the real calendar.
  const now = new Date();
  const currentKey = keyFromDate(now);
  const nextKey = addMonthKey(currentKey, 1);

  const model = useMemo(() => {
    const seasonById = new Map(rawOrders.map((o) => [o.id, seasonOf(o.notes)]));
    const rawById = new Map(rawOrders.map((o) => [o.id, o]));

    // ACTUAL: real payments (out or in), bucketed by the month of the payment date × season.
    const actual = new Map<string, Map<string, number>>();
    for (const ro of rawOrders) {
      const season = seasonById.get(ro.id) ?? "";
      const df = ro.docFlow;
      if (!df) continue;
      const payments = [
        ...(df.proforma?.paiements ?? []),
        ...(df.proforma?.depositInvoices ?? []).flatMap((di) => di.paiements ?? []),
        ...(df.packingLists ?? []).flatMap((pl) => pl.paiements ?? []),
        ...(df.factureDefinitive?.paiements ?? []),
      ];
      for (const p of payments) {
        const key = keyFromIso(p.date);
        if (!key) continue;
        bump(actual, season, key, p.montant ?? 0);
      }
    }

    // EXPECTED: outstanding balance scheduled in a future month.
    const expected = new Map<string, Map<string, number>>();
    // OVERDUE (customer only): outstanding whose due date is already reached (this month
    // or earlier) and still not collected — shown in a distinct "En retard" column.
    const overdueBySeason = new Map<string, number>();
    // Per-invoice detail behind each overdue amount (for the drill-down dialog).
    const overdueItems: OverdueItem[] = [];
    if (isSupplier) {
      // Supplier: whole-order outstanding (facturé − payé) at the expected-delivery
      // month if still ahead, else next month.
      for (const o of orders) {
        const outstanding = Math.max(0, o.totals.invoiced - o.totals.paid);
        if (outstanding <= 0.01) continue;
        const ro = rawById.get(o.id);
        const season = seasonById.get(o.id) ?? "";
        const delivKey = keyFromIso(ro?.dateLivraison);
        const key = delivKey && delivKey > currentKey ? delivKey : nextKey;
        bump(expected, season, key, outstanding);
      }
    } else {
      // Customer: each unpaid invoice's own outstanding, at its due date (échéance).
      // Invoices whose échéance is already reached go to the "En retard" bucket.
      for (const ro of rawOrders) {
        const season = seasonById.get(ro.id) ?? "";
        const df = ro.docFlow;
        if (!df) continue;
        const slots = [
          ...(df.packingLists ?? []).map((pl) => ({
            paiements: pl.paiements ?? [],
            factures: pl.factures ?? [],
          })),
          // deposit invoices behave like factures for the receivables forecast
          ...(df.proforma?.depositInvoices ?? []).map((di) => ({
            paiements: di.paiements ?? [],
            factures: [
              {
                id: di.id,
                montant: di.montant,
                dueDate: di.dueDate,
                docNo: di.docNo,
              } as RawFacture,
            ],
          })),
        ];
        if (df.factureDefinitive?.montant)
          slots.push({
            paiements: df.factureDefinitive.paiements ?? [],
            factures: [
              {
                id: `${ro.id}-fd`,
                montant: df.factureDefinitive.montant,
                dueDate: df.factureDefinitive.dueDate,
              },
            ],
          });
        for (const slot of slots) {
          let paidLeft = slot.paiements.reduce((a, p) => a + (p.montant ?? 0), 0);
          for (const f of slot.factures) {
            const amount = f.montant ?? f.montantBrut ?? 0;
            // Positive invoices are reduced by payments already received; a negative
            // invoice (credit / adjustment) lowers the receivable in its own due month.
            let outstanding: number;
            if (amount >= 0) {
              const alloc = Math.min(paidLeft, amount);
              paidLeft -= alloc;
              outstanding = amount - alloc;
            } else {
              outstanding = amount;
            }
            if (Math.abs(outstanding) <= 0.01) continue;
            const dueKey = keyFromIso(f.dueDate);
            if (dueKey && dueKey >= currentKey) {
              // due this month or later → shown as "attendu" in its due month
              bump(expected, season, dueKey, outstanding);
            } else {
              // échéance d'un mois déjà passé (ou absente) → en retard
              overdueBySeason.set(season, (overdueBySeason.get(season) ?? 0) + outstanding);
              overdueItems.push({
                season,
                orderId: ro.id,
                ref: ro.reference ?? ro.id,
                client: ro.fournisseur ?? "",
                docNo: f.docNo,
                amount: outstanding,
                dueDate: f.dueDate,
              });
            }
          }
        }
      }
    }

    // Columns: a contiguous month range covering all data (+ the current month).
    const keySet = new Set<string>([currentKey]);
    actual.forEach((row) => row.forEach((_, k) => keySet.add(k)));
    expected.forEach((row) => row.forEach((_, k) => keySet.add(k)));
    const bounds = [...keySet].sort();
    const months: string[] = [];
    let k = bounds[0];
    const last = bounds[bounds.length - 1];
    while (k <= last && months.length < 240) {
      months.push(k);
      k = addMonthKey(k, 1);
    }

    // Rows: every season with data, chronological; unlabelled orders ("") sink to the end.
    const seasonSet = new Set<string>();
    actual.forEach((_, s) => seasonSet.add(s));
    expected.forEach((_, s) => seasonSet.add(s));
    overdueBySeason.forEach((_, s) => seasonSet.add(s));
    const seasons = [...seasonSet].sort((a, b) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return seasonSortKey(a) - seasonSortKey(b);
    });

    // Main value shown in a cell: real payments up to the current month, expected after.
    const cell = (season: string, key: string): number =>
      key <= currentKey
        ? (actual.get(season)?.get(key) ?? 0)
        : (expected.get(season)?.get(key) ?? 0);
    // Expected (attendu) receivable for a given month — used to also surface, on the
    // CURRENT month, what's still due this month on top of what's already been received.
    const expectedAt = (season: string, key: string): number => expected.get(season)?.get(key) ?? 0;

    const overdueOf = (season: string): number => overdueBySeason.get(season) ?? 0;
    const hasOverdue = [...overdueBySeason.values()].some((v) => Math.abs(v) > 0.01);

    return { months, seasons, cell, expectedAt, overdueOf, hasOverdue, overdueItems };
  }, [orders, rawOrders, currentKey, nextKey, isSupplier]);

  const { months, seasons, cell, expectedAt, overdueOf, hasOverdue, overdueItems } = model;

  // The current month contributes both what's been received (cell) and what's still
  // expected this month (expectedAt) — count both so totals stay whole.
  const monthValue = (season: string, key: string) =>
    cell(season, key) + (key === currentKey ? expectedAt(season, key) : 0);
  const rowTotal = (season: string) =>
    overdueOf(season) + months.reduce((a, k) => a + monthValue(season, k), 0);
  const colTotal = (key: string) => seasons.reduce((a, s) => a + monthValue(s, key), 0);
  const colActual = (key: string) => seasons.reduce((a, s) => a + cell(s, key), 0);
  const colExpectedNow = seasons.reduce((a, s) => a + expectedAt(s, currentKey), 0);
  const overdueTotal = seasons.reduce((a, s) => a + overdueOf(s), 0);
  const grandTotal = seasons.reduce((a, s) => a + rowTotal(s), 0);

  // Drill-down on the "En retard" column: which orders, how overdue, when they were due.
  const navigate = useNavigate();
  const [overdueScope, setOverdueScope] = useState<"all" | string | null>(null);
  const openOverdue = (scope: "all" | string) => {
    if (hasOverdue) setOverdueScope(scope);
  };
  const dialogItems = useMemo(() => {
    if (overdueScope == null) return [];
    const list =
      overdueScope === "all"
        ? overdueItems
        : overdueItems.filter((it) => it.season === overdueScope);
    const rank = (it: OverdueItem) => (it.dueDate ? new Date(it.dueDate).getTime() : Infinity);
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [overdueScope, overdueItems]);
  const todayMs = now.getTime();
  const daysLate = (iso?: string) =>
    iso ? Math.floor((todayMs - new Date(iso).getTime()) / 86_400_000) : null;

  // Synced scrollbar shown ABOVE the table (mirrors the table's own horizontal scroll).
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollW, setScrollW] = useState(0);
  const syncing = useRef(false);
  useEffect(() => {
    if (bodyRef.current) setScrollW(bodyRef.current.scrollWidth);
  }, [months.length, seasons.length]);
  const syncFrom = (src: HTMLDivElement | null, dst: HTMLDivElement | null) => {
    if (syncing.current || !src || !dst) return;
    syncing.current = true;
    dst.scrollLeft = src.scrollLeft;
    syncing.current = false;
  };

  const seasonLabel = (s: string) => (s === "" ? "Sans saison" : s);
  const realWord = isSupplier ? "Payé" : "Encaissé";
  const expectedNote = isSupplier
    ? "prévu d'après le facturé"
    : "prévu d'après les échéances (due dates)";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          {isSupplier ? "Décaissements" : "Encaissements"} par mois et par saison
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Mois en cours
          </div>
          <div className="font-serif text-2xl capitalize">{monthLabelFull(currentKey)}</div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-foreground/70" /> {realWord} (réel), jusqu'au mois
          en cours
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-accent/40" /> Attendu ({expectedNote}), dès le
          mois en cours
          {!isSupplier && " (le mois en cours affiche les deux : encaissé + « +attendu »)"}
        </span>
        {hasOverdue && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-destructive/30" /> En retard (échéance dépassée,
            non encaissé)
          </span>
        )}
      </div>

      {/* top scrollbar */}
      <div
        ref={topRef}
        onScroll={() => syncFrom(topRef.current, bodyRef.current)}
        className="overflow-x-auto"
        aria-hidden
      >
        <div style={{ width: scrollW, height: 1 }} />
      </div>

      <div
        ref={bodyRef}
        onScroll={() => syncFrom(bodyRef.current, topRef.current)}
        className="card-elev overflow-x-auto"
      >
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card text-left font-medium px-4 py-3 whitespace-nowrap">
                Saison
              </th>
              {hasOverdue && (
                <th className="text-right font-semibold px-3 py-3 whitespace-nowrap bg-destructive/15 text-destructive border-r border-destructive/25">
                  En retard
                </th>
              )}
              {months.map((key) => {
                const { m, y } = monthLabelShort(key);
                const isCurrent = key === currentKey;
                const isFuture = key > currentKey;
                return (
                  <th
                    key={key}
                    className={cn(
                      "text-right font-medium px-3 py-3 whitespace-nowrap",
                      isCurrent && "bg-accent/10 text-accent-foreground",
                      isFuture && !isCurrent && "text-muted-foreground/70",
                    )}
                  >
                    <span className="capitalize">{m}</span> {y}
                  </th>
                );
              })}
              <th className="text-right font-medium px-4 py-3 whitespace-nowrap border-l border-border">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {seasons.map((season) => (
              <tr key={season} className="hover:bg-surface-2/50 transition-colors">
                <td className="sticky left-0 z-10 bg-card px-4 py-3 font-medium whitespace-nowrap">
                  {seasonLabel(season)}
                </td>
                {hasOverdue && (
                  <td
                    onClick={() => overdueOf(season) > 0.01 && openOverdue(season)}
                    className={cn(
                      "px-3 py-3 text-right num tabular-nums bg-destructive/10 text-destructive font-medium border-r border-destructive/25",
                      overdueOf(season) > 0.01 &&
                        "cursor-pointer hover:bg-destructive/20 underline decoration-dotted underline-offset-2",
                    )}
                    title={overdueOf(season) > 0.01 ? "Voir le détail des retards" : undefined}
                  >
                    {overdueOf(season) > 0.01 ? (
                      shortMoney(overdueOf(season))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {months.map((key) => {
                  const v = cell(season, key);
                  const isCurrent = key === currentKey;
                  const isFuture = key > currentKey;
                  // current month also surfaces what's still expected this month (light blue)
                  const exp = isCurrent ? expectedAt(season, key) : 0;
                  return (
                    <td
                      key={key}
                      className={cn(
                        "px-3 py-3 text-right num tabular-nums",
                        isCurrent && "bg-accent/5",
                        isFuture ? "text-accent/90 italic" : "text-foreground",
                      )}
                    >
                      {isCurrent ? (
                        <div className="flex flex-col items-end leading-tight">
                          <span>
                            {v > 0.01 ? (
                              shortMoney(v)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                          {exp > 0.01 && (
                            <span className="text-accent/90 italic text-xs">
                              +{shortMoney(exp)}
                            </span>
                          )}
                        </div>
                      ) : v > 0.01 ? (
                        shortMoney(v)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right font-serif text-base num border-l border-border">
                  {shortMoney(rowTotal(season))}
                </td>
              </tr>
            ))}
            {seasons.length === 0 && (
              <tr>
                <td
                  colSpan={months.length + 2 + (hasOverdue ? 1 : 0)}
                  className="px-5 py-8 text-center text-sm text-muted-foreground"
                >
                  {isSupplier
                    ? "Aucun paiement enregistré pour l'instant."
                    : "Aucun encaissement enregistré pour l'instant."}
                </td>
              </tr>
            )}
          </tbody>
          {seasons.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-medium">
                <td className="sticky left-0 z-10 bg-card px-4 py-3 whitespace-nowrap uppercase text-[10px] tracking-widest text-muted-foreground">
                  Total
                </td>
                {hasOverdue && (
                  <td
                    onClick={() => overdueTotal > 0.01 && openOverdue("all")}
                    className={cn(
                      "px-3 py-3 text-right font-serif text-base num bg-destructive/10 text-destructive border-r border-destructive/25",
                      overdueTotal > 0.01 &&
                        "cursor-pointer hover:bg-destructive/20 underline decoration-dotted underline-offset-2",
                    )}
                    title={overdueTotal > 0.01 ? "Voir tout le détail des retards" : undefined}
                  >
                    {overdueTotal > 0.01 ? (
                      shortMoney(overdueTotal)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {months.map((key) => (
                  <td
                    key={key}
                    className={cn(
                      "px-3 py-3 text-right font-serif text-base num",
                      key === currentKey && "bg-accent/5",
                      key > currentKey && "text-accent/90",
                    )}
                  >
                    {key === currentKey ? (
                      <div className="flex flex-col items-end leading-tight">
                        <span>
                          {colActual(key) > 0.01 ? (
                            shortMoney(colActual(key))
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </span>
                        {colExpectedNow > 0.01 && (
                          <span className="text-accent/90 italic text-xs">
                            +{shortMoney(colExpectedNow)}
                          </span>
                        )}
                      </div>
                    ) : colTotal(key) > 0.01 ? (
                      shortMoney(colTotal(key))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ))}
                <td className="px-4 py-3 text-right font-serif text-lg num border-l border-border">
                  {shortMoney(grandTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Montants additionnés en euros. Jusqu'au mois en cours inclus, chaque cellule affiche les{" "}
        {isSupplier ? "paiements" : "encaissements"} réellement enregistrés (d'après leur date).
        Après le mois en cours, elle affiche le solde restant à {isSupplier ? "payer" : "encaisser"}{" "}
        {isSupplier
          ? "(facturé non payé), planifié sur le mois de livraison prévu, ou le mois prochain si la livraison est déjà passée."
          : "(factures non réglées), planifié sur le mois de leur échéance (due date)."}
        {!isSupplier && hasOverdue && (
          <>
            {" "}
            La colonne <span className="text-destructive font-medium">En retard</span> regroupe les
            factures dont l'échéance est déjà atteinte (ce mois-ci ou avant) et non encore
            encaissées. Clique un montant rouge pour voir le détail des commandes concernées.
          </>
        )}
      </p>

      <Dialog open={overdueScope != null} onOpenChange={(v) => !v && setOverdueScope(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Factures en retard
              {overdueScope && overdueScope !== "all" ? ` · ${overdueScope}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground -mt-1">
            {dialogItems.length} facture{dialogItems.length > 1 ? "s" : ""} · total{" "}
            <span className="text-destructive font-medium num">
              {shortMoney(dialogItems.reduce((a, it) => a + it.amount, 0))}
            </span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="text-left font-medium px-2 py-2">Commande · Client</th>
                  <th className="text-left font-medium px-2 py-2 whitespace-nowrap">Échéance</th>
                  <th className="text-right font-medium px-2 py-2 whitespace-nowrap">Retard</th>
                  <th className="text-right font-medium px-2 py-2 whitespace-nowrap">Montant dû</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dialogItems.map((it, i) => {
                  const late = daysLate(it.dueDate);
                  return (
                    <tr
                      key={`${it.orderId}-${it.docNo ?? i}`}
                      onClick={() => {
                        setOverdueScope(null);
                        navigate({ to: "/customer-orders/$id", params: { id: it.orderId } });
                      }}
                      className="cursor-pointer hover:bg-surface-2 transition-colors"
                    >
                      <td className="px-2 py-2.5">
                        <div className="font-medium">{it.ref}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[240px]">
                          {it.client}
                          {it.docNo ? ` · ${it.docNo}` : ""}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap num">
                        {it.dueDate ? fmtDate(it.dueDate) : "—"}
                      </td>
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        {late != null && late > 0 ? (
                          <span className="text-destructive">
                            {late} jour{late > 1 ? "s" : ""}
                          </span>
                        ) : late != null && late <= 0 ? (
                          <span className="text-muted-foreground">échéance ce mois</span>
                        ) : (
                          <span className="text-muted-foreground">échéance inconnue</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right font-serif text-base num text-destructive">
                        {shortMoney(it.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

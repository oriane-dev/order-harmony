import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ordersQueryOptions, rawOrdersQueryOptions } from "@/lib/data";
import { seasonOf, seasonSortKey } from "@/lib/season";
import { shortMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/calendrier")({
  head: () => ({
    meta: [
      { title: "Calendrier des paiements · Ledger" },
      {
        name: "description",
        content:
          "Vue calendrier des montants payés par mois et par saison — réel jusqu'au mois en cours, attendu ensuite.",
      },
    ],
  }),
  component: CalendarPage,
});

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

function bump(map: Map<string, Map<string, number>>, season: string, key: string, amt: number) {
  let row = map.get(season);
  if (!row) {
    row = new Map();
    map.set(season, row);
  }
  row.set(key, (row.get(key) ?? 0) + amt);
}

function CalendarPage() {
  const { data: orders } = useSuspenseQuery(ordersQueryOptions());
  const { data: rawOrders } = useSuspenseQuery(rawOrdersQueryOptions());

  // Re-evaluated on every render, so the "current month" divider tracks the real calendar.
  const now = new Date();
  const currentKey = keyFromDate(now);
  const nextKey = addMonthKey(currentKey, 1);

  const model = useMemo(() => {
    const seasonById = new Map(rawOrders.map((o) => [o.id, seasonOf(o.notes)]));
    const rawById = new Map(rawOrders.map((o) => [o.id, o]));

    // ACTUAL: real payments, bucketed by the month of the payment date × season.
    const actual = new Map<string, Map<string, number>>();
    for (const ro of rawOrders) {
      const season = seasonById.get(ro.id) ?? "";
      const df = ro.docFlow;
      if (!df) continue;
      const payments = [
        ...(df.proforma?.paiements ?? []),
        ...(df.packingLists ?? []).flatMap((pl) => pl.paiements ?? []),
        ...(df.factureDefinitive?.paiements ?? []),
      ];
      for (const p of payments) {
        const key = keyFromIso(p.date);
        if (!key) continue;
        bump(actual, season, key, p.montant ?? 0);
      }
    }

    // EXPECTED: outstanding balance (facturé − payé) per order, scheduled in a future
    // month — its expected-delivery month if that's still ahead, otherwise next month.
    const expected = new Map<string, Map<string, number>>();
    for (const o of orders) {
      const outstanding = Math.max(0, o.totals.invoiced - o.totals.paid);
      if (outstanding <= 0.01) continue;
      const ro = rawById.get(o.id);
      const season = seasonById.get(o.id) ?? "";
      const delivKey = keyFromIso(ro?.dateLivraison);
      const key = delivKey && delivKey > currentKey ? delivKey : nextKey;
      bump(expected, season, key, outstanding);
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
    const seasons = [...seasonSet].sort((a, b) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return seasonSortKey(a) - seasonSortKey(b);
    });

    const cell = (season: string, key: string): number =>
      key <= currentKey
        ? (actual.get(season)?.get(key) ?? 0)
        : (expected.get(season)?.get(key) ?? 0);

    return { months, seasons, cell };
  }, [orders, rawOrders, currentKey, nextKey]);

  const { months, seasons, cell } = model;

  const rowTotal = (season: string) => months.reduce((a, k) => a + cell(season, k), 0);
  const colTotal = (key: string) => seasons.reduce((a, s) => a + cell(s, key), 0);
  const grandTotal = seasons.reduce((a, s) => a + rowTotal(s), 0);

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

  return (
    <AppShell>
      <div className="max-w-[1500px] mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Calendrier
            </div>
            <h1 className="font-serif text-4xl mt-1">Paiements par mois et par saison</h1>
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
            <span className="size-2.5 rounded-sm bg-foreground/70" /> Payé (réel), jusqu'au mois en
            cours
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-accent/40" /> Attendu (prévu d'après le
            facturé), après le mois en cours
          </span>
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
                  {months.map((key) => {
                    const v = cell(season, key);
                    const isCurrent = key === currentKey;
                    const isFuture = key > currentKey;
                    return (
                      <td
                        key={key}
                        className={cn(
                          "px-3 py-3 text-right num tabular-nums",
                          isCurrent && "bg-accent/5",
                          isFuture ? "text-accent/90 italic" : "text-foreground",
                        )}
                      >
                        {v > 0.01 ? (
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
                    colSpan={months.length + 2}
                    className="px-5 py-8 text-center text-sm text-muted-foreground"
                  >
                    Aucun paiement enregistré pour l'instant.
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
                  {months.map((key) => (
                    <td
                      key={key}
                      className={cn(
                        "px-3 py-3 text-right font-serif text-base num",
                        key === currentKey && "bg-accent/5",
                        key > currentKey && "text-accent/90",
                      )}
                    >
                      {colTotal(key) > 0.01 ? (
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
          Les montants sont additionnés en euros. Jusqu'au mois en cours inclus, chaque cellule
          affiche les paiements réellement enregistrés (d'après leur date). Après le mois en cours,
          elle affiche le solde restant à payer (facturé non encore payé), planifié sur le mois de
          livraison prévu, ou le mois prochain si la livraison est déjà passée.
        </p>
      </div>
    </AppShell>
  );
}

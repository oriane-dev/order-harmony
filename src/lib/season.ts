// A supplier order's "saison" is stored as the leading code of its `notes` field,
// e.g. "AW26 (AUTOMN/WINTER 2026)" → "AW26". Shared by the orders filter and the
// payments calendar so both derive seasons the same way.

export function seasonOf(notes: string | undefined): string {
  const m = (notes ?? "").trim().match(/^([A-Za-z]{2}\d{2})/);
  return m ? m[1].toUpperCase() : "";
}

// Chronological rank so seasons list in calendar order (by year, then phase within
// the year) rather than alphabetically.
const SEASON_PHASE_RANK: Record<string, number> = { CR: 0, PS: 1, SS: 2, PF: 3, AW: 4 };

export function seasonSortKey(code: string): number {
  const m = code.match(/^([A-Z]{2})(\d{2})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return parseInt(m[2], 10) * 10 + (SEASON_PHASE_RANK[m[1]] ?? 9);
}

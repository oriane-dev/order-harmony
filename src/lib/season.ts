// A supplier order's "saison" is derived from its `notes` field. Two accepted formats:
//   1. Code court en tête : "AW26 (AUTOMN/WINTER 2026)" → "AW26" (format Baziszt).
//   2. Nom complet sans code : "FALL/WINTER 2026", "SPRING/SUMMER 2027" → "AW26" / "SS27"
//      (format Husbands). On convertit alors la phase + l'année en code.
// Partagé par le filtre commandes, l'échéancier et le calendrier.

export function seasonOf(notes: string | undefined): string {
  const raw = (notes ?? "").trim();
  if (!raw) return "";
  // 1. Code court déjà présent en début de texte.
  const code = raw.match(/^([A-Za-z]{2}\d{2})/);
  if (code) return code[1].toUpperCase();
  // 2. Nom complet → code (phase + année sur 2 chiffres). Sans année, on ne devine pas.
  const year = raw.match(/(\d{4})/);
  if (!year) return "";
  const yy = year[1].slice(-2);
  const s = raw.toUpperCase();
  let phase = "";
  if (/PRE[\s-]*FALL/.test(s)) phase = "PF";
  else if (/PRE[\s-]*SPRING/.test(s)) phase = "PS";
  else if (/RESORT|CRUISE|CROISI/.test(s)) phase = "CR";
  else if (/SPRING|SUMMER|PRINTEMPS|\bETE\b|ÉTÉ/.test(s)) phase = "SS";
  else if (/FALL|WINTER|AUTUMN|AUTOMNE|HIVER/.test(s)) phase = "AW";
  return phase ? phase + yy : "";
}

// Chronological rank so seasons list in calendar order (by year, then phase within
// the year) rather than alphabetically.
const SEASON_PHASE_RANK: Record<string, number> = { CR: 0, PS: 1, SS: 2, PF: 3, AW: 4 };

export function seasonSortKey(code: string): number {
  const m = code.match(/^([A-Z]{2})(\d{2})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return parseInt(m[2], 10) * 10 + (SEASON_PHASE_RANK[m[1]] ?? 9);
}

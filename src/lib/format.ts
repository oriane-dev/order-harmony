export function money(amount: number, currency: string = "EUR") {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function shortMoney(amount: number, currency: string = "EUR") {
  const sign = amount < 0 ? "-" : "";
  const a = Math.abs(amount);
  const s =
    a >= 1_000_000
      ? `${(a / 1_000_000).toFixed(1)}M`
      : a >= 1_000
        ? `${(a / 1_000).toFixed(0)}K`
        : `${Math.round(a)}`;
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency === "CNY" ? "¥" : "$";
  return `${sign}${sym}${s}`;
}

export function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

export function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function shortDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

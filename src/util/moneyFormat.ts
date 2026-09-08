/** Signed Kalshi-style change: +$1.18 (+0.84%) or — while collecting. */
export function formatChange24h(usd: number | null, pct: number | null): string {
  if (usd == null || !Number.isFinite(usd)) return '—';
  const sign = usd > 0 ? '+' : usd < 0 ? '-' : '';
  const pctSign = pct != null && pct > 0 ? '+' : pct != null && pct < 0 ? '-' : '';
  const pctPart =
    pct != null && Number.isFinite(pct) ? ` (${pctSign}${Math.abs(pct).toFixed(2)}%)` : '';
  return `${sign}$${Math.abs(usd).toFixed(2)}${pctPart}`;
}

export function formatUsd(valueUsd: number | null): string {
  if (valueUsd == null || !Number.isFinite(valueUsd)) return '—';
  return `$${valueUsd.toFixed(2)}`;
}

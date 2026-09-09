/** Signed Kalshi-style change: +$1.18 (+0.84%) or Collecting… until a baseline exists. */
export function formatChange24h(usd: number | null, pct: number | null): string {
  if (usd == null || !Number.isFinite(usd)) return 'Collecting…';
  const sign = usd > 0 ? '+' : usd < 0 ? '-' : '';
  const pctSign = pct != null && pct > 0 ? '+' : pct != null && pct < 0 ? '-' : '';
  const pctPart =
    pct != null && Number.isFinite(pct) ? ` (${pctSign}${Math.abs(pct).toFixed(2)}%)` : '';
  return `${sign}$${Math.abs(usd).toFixed(2)}${pctPart}`;
}

/** Honest window: Change (24h) once we have a day of samples, else Change (4h). */
export function formatChangeWindowLabel(windowMs: number | null, usd: number | null): string {
  if (usd == null || windowMs == null || !Number.isFinite(windowMs)) return 'Change (24h)';
  if (windowMs >= 23 * 60 * 60 * 1000) return 'Change (24h)';
  if (windowMs < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.round(windowMs / 60_000));
    return `Change (${mins}m)`;
  }
  const hours = Math.max(1, Math.round(windowMs / (60 * 60 * 1000)));
  return `Change (${hours}h)`;
}

export function formatUsd(valueUsd: number | null): string {
  if (valueUsd == null || !Number.isFinite(valueUsd)) return '—';
  return `$${valueUsd.toFixed(2)}`;
}

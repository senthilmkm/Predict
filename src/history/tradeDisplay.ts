import { parseEntryPath } from '../storage/repos';

function moneyUsd(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : '—';
}

export function entryPathChipLabel(
  path: unknown
): 'Home' | 'Auto' | 'Cash out' | 'Gold fade' | 'TWAP lock' | 'Last-minute' | null {
  const parsed = parseEntryPath(path);
  if (parsed === 'home') return 'Home';
  if (parsed === 'auto') return 'Auto';
  if (parsed === 'cash_out') return 'Cash out';
  if (parsed === 'gold_fade') return 'Gold fade';
  if (parsed === 'twap_lock') return 'TWAP lock';
  if (parsed === 'last_minute') return 'Last-minute';
  return null;
}

/** `ticker · 5 ctr @ $0.55 · cost $4.60 · P&L $0.40` */
export function formatHistoryTradeSubline(item: {
  market_ticker?: string | null;
  notional_usd?: number | null;
  fill_count?: number | null;
  fill_price?: number | null;
  pnl_usd?: number | null;
}): string {
  const parts: string[] = [];
  const ticker = String(item.market_ticker || '').trim();
  if (ticker) parts.push(ticker);
  const fills =
    item.fill_count != null && Number.isFinite(Number(item.fill_count)) ? Number(item.fill_count) : null;
  const price =
    item.fill_price != null && Number.isFinite(Number(item.fill_price)) && Number(item.fill_price) > 0
      ? Number(item.fill_price)
      : null;
  if (fills != null && price != null) {
    parts.push(`${fills} ctr @ $${moneyUsd(price)}`);
  } else if (fills != null) {
    parts.push(`${fills} ctr`);
  } else if (price != null) {
    parts.push(`@ $${moneyUsd(price)}`);
  }
  parts.push(`cost $${moneyUsd(item.notional_usd)}`);
  if (item.pnl_usd != null && Number.isFinite(Number(item.pnl_usd))) {
    parts.push(`P&L $${moneyUsd(item.pnl_usd)}`);
  }
  return parts.join(' · ');
}

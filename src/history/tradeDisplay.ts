import { parseEntryPath } from '../storage/repos';

function moneyUsd(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : '—';
}

export function formatSignedUsd(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v).toFixed(2);
  if (v > 0) return `+$${abs}`;
  if (v < 0) return `-$${abs}`;
  return '$0.00';
}

export function entryPathChipLabel(
  path: unknown,
  pairNo?: number | null
):
  | 'Home Buy'
  | 'Cushion lean'
  | 'Cash out'
  | 'Gold fade'
  | 'TWAP lock'
  | 'Last-minute'
  | 'Step buy'
  | 'Spike fade'
  | 'Pair lock'
  | 'PL hedge'
  | 'Cap lock'
  | string
  | null {
  const parsed = parseEntryPath(path);
  if (parsed === 'home') return 'Home Buy';
  if (parsed === 'auto') return 'Cushion lean';
  if (parsed === 'cash_out') return 'Cash out';
  if (parsed === 'gold_fade') return 'Gold fade';
  if (parsed === 'twap_lock') return 'TWAP lock';
  if (parsed === 'last_minute') return 'Last-minute';
  if (parsed === 'step_buy') return 'Step buy';
  if (parsed === 'spike_fade') return 'Spike fade';
  if (parsed === 'cap_lock') return 'Cap lock';
  if (parsed === 'buffer_run') return 'Buffer run';
  if (parsed === 'cheap_loop') return 'Cheap loop 15m';
  if (parsed === 'cheap_loop_hourly') return 'Cheap loop hourly';
  if (parsed === 'cheap_loop_weekly') return 'Cheap loop weekly';
  const n = Number(pairNo);
  const numbered = Number.isFinite(n) && n >= 1 ? ` ${Math.floor(n)}` : '';
  if (parsed === 'pair_lock') return numbered ? `Pair lock${numbered}` : 'Pair lock';
  if (parsed === 'pair_lock_hedge') return numbered ? `PL hedge${numbered}` : 'PL hedge';
  return null;
}

function pairLockLegKey(path: unknown): 'runner' | 'hedge' | null {
  const parsed = parseEntryPath(path);
  if (parsed === 'pair_lock') return 'runner';
  if (parsed === 'pair_lock_hedge') return 'hedge';
  return null;
}

function isPairLockHistoryFill(row: {
  dry_run?: boolean;
  outcome?: string | null;
  fill_count?: number | null;
}): boolean {
  if (row.dry_run) return false;
  if (String(row.outcome || '') === 'miss') return false;
  const fills = Number(row.fill_count);
  if (Number.isFinite(fills) && fills <= 0) return false;
  return true;
}

/** 1-based pair index per ticker: first runner/hedge = 1, next stack = 2. */
export function pairLockHistoryPairNumbers(
  trades: Array<{
    id?: string;
    at?: string;
    market_ticker?: string | null;
    entry_path?: unknown;
    dry_run?: boolean;
    outcome?: string | null;
    fill_count?: number | null;
  }>
): Map<string, number> {
  const out = new Map<string, number>();
  const groups = new Map<string, Array<{ id: string; atMs: number }>>();
  for (const t of trades || []) {
    const id = String(t.id || '').trim();
    const ticker = String(t.market_ticker || '').trim();
    const leg = pairLockLegKey(t.entry_path);
    if (!id || !ticker || !leg || !isPairLockHistoryFill(t)) continue;
    const key = `${ticker}|${leg}`;
    const atMs = Date.parse(String(t.at || ''));
    const rows = groups.get(key) || [];
    rows.push({ id, atMs: Number.isFinite(atMs) ? atMs : 0 });
    groups.set(key, rows);
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
    rows.forEach((row, i) => out.set(row.id, i + 1));
  }
  return out;
}

/** `ticker · 5 ctr @ $0.55 · cost $4.60 · P&L $0.40` */
export function formatHistoryTradeSubline(item: {
  market_ticker?: string | null;
  notional_usd?: number | null;
  fill_count?: number | null;
  fill_price?: number | null;
  pnl_usd?: number | null;
  live_pnl_usd?: number | null;
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
  } else if (item.live_pnl_usd != null && Number.isFinite(Number(item.live_pnl_usd))) {
    parts.push(`live ${formatSignedUsd(item.live_pnl_usd)}`);
  }
  return parts.join(' · ');
}

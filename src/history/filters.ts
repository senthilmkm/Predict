import { AssetKey, AssetRegistry } from '../config/types';
import { AlertRecord, TradeRecord, TradeSide } from '../storage/repos';

export type AlertFilter =
  | 'all'
  | 'unread'
  | 'lean_signal'
  | 'order_placed'
  | 'order_filled'
  | 'ioc_miss'
  | 'trade_result'
  | 'protect_sell'
  | 'daily_loss_stop'
  | 'error';

export type TradeStatusFilter = 'all' | 'pending' | 'win' | 'loss' | 'miss' | 'exited';
export type TradeSideFilter = 'all' | TradeSide;
export type TradeAssetFilter = 'all' | AssetKey;

export interface TradeFilterSelection {
  status: TradeStatusFilter;
  side: TradeSideFilter;
  asset: TradeAssetFilter;
}

export const DEFAULT_TRADE_FILTERS: TradeFilterSelection = {
  status: 'pending',
  side: 'all',
  asset: 'all',
};

export const TRADE_STATUS_FILTERS: { id: TradeStatusFilter; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'win', label: 'Wins' },
  { id: 'loss', label: 'Losses' },
  { id: 'miss', label: 'Misses' },
  { id: 'exited', label: 'Exited' },
  { id: 'all', label: 'All' },
];

export const TRADE_SIDE_FILTERS: { id: TradeSideFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'YES', label: 'YES' },
  { id: 'NO', label: 'NO' },
];

const STATUS_IDS = new Set<string>(TRADE_STATUS_FILTERS.map((f) => f.id));
const SIDE_IDS = new Set<string>(TRADE_SIDE_FILTERS.map((f) => f.id));

export const ALERT_FILTERS: { id: AlertFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'lean_signal', label: 'Signals' },
  { id: 'order_placed', label: 'Orders' },
  { id: 'order_filled', label: 'Fills' },
  { id: 'ioc_miss', label: 'Misses' },
  { id: 'trade_result', label: 'Results' },
  { id: 'protect_sell', label: 'Protect' },
  { id: 'daily_loss_stop', label: 'Loss stop' },
  { id: 'error', label: 'Errors' },
];

export function alertFilterLabel(kind: string): string {
  return ALERT_FILTERS.find((f) => f.id === kind)?.label ?? kind;
}

export function tradeStatusFilterLabel(id: TradeStatusFilter): string {
  return TRADE_STATUS_FILTERS.find((f) => f.id === id)?.label ?? 'Pending';
}

export function tradeSideFilterLabel(id: TradeSideFilter): string {
  return TRADE_SIDE_FILTERS.find((f) => f.id === id)?.label ?? 'All';
}

export function normalizeTradeFilters(
  raw?: Partial<TradeFilterSelection> | null
): TradeFilterSelection {
  const status = STATUS_IDS.has(String(raw?.status || ''))
    ? (raw!.status as TradeStatusFilter)
    : DEFAULT_TRADE_FILTERS.status;
  const side = SIDE_IDS.has(String(raw?.side || ''))
    ? (raw!.side as TradeSideFilter)
    : DEFAULT_TRADE_FILTERS.side;
  const assetRaw = String(raw?.asset ?? 'all').trim();
  const asset: TradeAssetFilter = assetRaw ? assetRaw : 'all';
  return { status, side, asset };
}

/** All + catalog keys + any extra assets that appear on trade rows. */
export function tradeAssetFilterOptions(
  rows?: TradeRecord[] | null
): { id: TradeAssetFilter; label: string }[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  try {
    for (const key of AssetRegistry.keys) {
      const k = String(key || '').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      keys.push(k);
    }
  } catch {
    /* catalog unavailable — still list assets from rows */
  }
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const k = String(row?.asset || '').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      keys.push(k);
    }
  }
  return [{ id: 'all', label: 'All' }, ...keys.map((k) => ({ id: k, label: k }))];
}

export function filterAlerts(rows: AlertRecord[] | null | undefined, filter: AlertFilter): AlertRecord[] {
  if (!Array.isArray(rows)) return [];
  const safe = rows.filter((a) => a && typeof a === 'object');
  if (filter === 'all') return safe;
  if (filter === 'unread') return safe.filter((a) => !a.read);
  return safe.filter((a) => a.kind === filter);
}

export function filterTrades(
  rows: TradeRecord[] | null | undefined,
  selection?: Partial<TradeFilterSelection> | null
): TradeRecord[] {
  if (!Array.isArray(rows)) return [];
  const f = normalizeTradeFilters(selection);
  const out: TradeRecord[] = [];
  for (const t of rows) {
    if (!t || typeof t !== 'object') continue;
    try {
      if (f.status !== 'all' && t.outcome !== f.status) continue;
      if (f.side !== 'all' && t.side !== f.side) continue;
      if (f.asset !== 'all' && String(t.asset || '') !== f.asset) continue;
      out.push(t);
    } catch {
      continue;
    }
  }
  return out;
}

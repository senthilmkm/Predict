import { AssetKey } from '../config/types';
import { AlertRecord, TradeOutcome, TradeRecord } from '../storage/repos';

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

export type TradeFilter =
  | 'all'
  | 'pending'
  | 'win'
  | 'loss'
  | 'miss'
  | 'exited'
  | 'YES'
  | 'NO'
  | AssetKey;

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

export const TRADE_FILTERS: { id: TradeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'win', label: 'Wins' },
  { id: 'loss', label: 'Losses' },
  { id: 'miss', label: 'Misses' },
  { id: 'exited', label: 'Exited' },
  { id: 'YES', label: 'YES' },
  { id: 'NO', label: 'NO' },
  { id: 'WTI', label: 'WTI' },
  { id: 'Gold', label: 'Gold' },
  { id: 'Silver', label: 'Silver' },
  { id: 'BTC', label: 'BTC' },
  { id: 'ETH', label: 'ETH' },
];

export function alertFilterLabel(kind: string): string {
  return ALERT_FILTERS.find((f) => f.id === kind)?.label ?? kind;
}

export function filterAlerts(rows: AlertRecord[], filter: AlertFilter): AlertRecord[] {
  if (filter === 'all') return rows;
  if (filter === 'unread') return rows.filter((a) => !a.read);
  return rows.filter((a) => a.kind === filter);
}

export function filterTrades(rows: TradeRecord[], filter: TradeFilter): TradeRecord[] {
  if (filter === 'all') return rows;
  if (filter === 'YES' || filter === 'NO') return rows.filter((t) => t.side === filter);
  if (
    filter === 'WTI' ||
    filter === 'Gold' ||
    filter === 'Silver' ||
    filter === 'BTC' ||
    filter === 'ETH'
  ) {
    return rows.filter((t) => t.asset === filter);
  }
  return rows.filter((t) => t.outcome === (filter as TradeOutcome));
}

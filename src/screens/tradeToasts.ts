import { entryPathChipLabel } from '../history/tradeDisplay';
import { AlertRecord, TradeRecord, parseEntryPath } from '../storage/repos';
import type { TradeToastAction, TradeToastItem } from '../components/TradeToastStack';

/** Build a corner toast from a Home manual fill. */
export function toastFromManualTrade(opts: {
  asset: string;
  action: TradeToastAction;
  side?: 'YES' | 'NO' | null;
  id?: string;
}): TradeToastItem {
  return {
    id: opts.id || `manual-${opts.asset}-${opts.action}-${Date.now()}`,
    action: opts.action,
    asset: String(opts.asset || '').trim() || '—',
    side: opts.side === 'YES' || opts.side === 'NO' ? opts.side : null,
    pathLabel: opts.action === 'sell' ? 'Home Sell' : 'Home Buy',
  };
}

/** Build a corner toast from a synced fill row (path entries). */
export function toastFromTradeRecord(trade: TradeRecord): TradeToastItem | null {
  const fills = Number(trade.fill_count ?? 0);
  if (!(fills > 0)) return null;
  if (String(trade.outcome || '') === 'miss') return null;
  const asset = String(trade.asset || '').trim();
  if (!asset) return null;
  const path = parseEntryPath(trade.entry_path);
  const pathLabel = entryPathChipLabel(trade.entry_path) || null;
  // Exited / sold lots still show as sell when outcome is exited.
  const action: TradeToastAction =
    trade.outcome === 'exited' || String(trade.status || '').toLowerCase().includes('sold')
      ? 'sell'
      : 'buy';
  return {
    id: `trade-${trade.id}`,
    action,
    asset,
    side: trade.side === 'YES' || trade.side === 'NO' ? trade.side : null,
    pathLabel: path === 'home' ? 'Home Buy' : pathLabel,
  };
}

/**
 * order_filled → buy · protect_sell → sell.
 * Titles look like: "Order Placed · Last-minute · BTC YES"
 */
export function toastFromAlert(alert: AlertRecord): TradeToastItem | null {
  const kind = String(alert.kind || '').toLowerCase();
  let action: TradeToastAction | null = null;
  if (kind === 'order_filled') action = 'buy';
  else if (kind === 'protect_sell') action = 'sell';
  else return null;

  const title = String(alert.title || '');
  const body = String(alert.body || '');
  const blob = `${title} ${body}`;
  const assetMatch = blob.match(/\b([A-Z]{2,6}|Gold|WTI|Silver)\b/);
  const sideMatch = blob.match(/\b(YES|NO)\b/);
  const asset = assetMatch?.[1] || '';
  if (!asset) return null;

  let pathLabel: string | null = null;
  const pathBits = title.split('·').map((s) => s.trim());
  if (pathBits.length >= 3) pathLabel = pathBits[1] || null;
  else if (pathBits.length === 2 && !/^order placed$/i.test(pathBits[0])) {
    pathLabel = pathBits[0] || null;
  }

  return {
    id: `alert-${alert.id}`,
    action,
    asset,
    side: sideMatch?.[1] === 'NO' ? 'NO' : sideMatch?.[1] === 'YES' ? 'YES' : null,
    pathLabel,
  };
}

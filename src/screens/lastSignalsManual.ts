import { TradeRecord } from '../storage/repos';

export interface LastSignalRowInput {
  asset: string;
  decision: string;
  err?: string;
  isOpen: boolean;
  noMarket: boolean;
  marketTicker?: string | null;
}

export function isOpenHeldFill(
  trade: Pick<TradeRecord, 'market_ticker' | 'dry_run' | 'outcome' | 'fill_count'>,
  ticker: string
): boolean {
  const tkr = String(ticker || '').trim();
  if (!tkr) return false;
  if (String(trade.market_ticker || '').trim() !== tkr) return false;
  if (trade.dry_run) return false;
  const fills = Number(trade.fill_count ?? 0);
  if (!(fills > 0)) return false;
  const outcome = String(trade.outcome || 'pending');
  return outcome === 'pending' || outcome === 'exiting';
}

export function heldOpenFillForTicker(
  trades: Array<Pick<TradeRecord, 'market_ticker' | 'dry_run' | 'outcome' | 'fill_count' | 'side'>>,
  ticker: string | null | undefined
) {
  const tkr = String(ticker || '').trim();
  if (!tkr) return undefined;
  return trades.find((t) => isOpenHeldFill(t, tkr));
}

export function lastSignalManualKind(opts: {
  featureOn: boolean;
  killSwitch: boolean;
  row: LastSignalRowInput;
  held?: { side: 'YES' | 'NO' } | null;
}): 'buy' | 'sell' | 'none' {
  if (!opts.featureOn || opts.killSwitch) return 'none';
  const row = opts.row;
  if (!row.isOpen || row.noMarket || row.err) return 'none';
  if (opts.held) return 'sell';
  if (row.decision === 'YES' || row.decision === 'NO') return 'buy';
  return 'none';
}

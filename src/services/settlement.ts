import { TradeRecord, TradeOutcome } from '../storage/repos';
import { KalshiClient } from './kalshi/client';

export function computeTradePnlUsd(opts: {
  side: 'YES' | 'NO';
  payPrice: number;
  fillCount: number;
  marketResult: 'yes' | 'no';
}): number {
  const pay = Number(opts.payPrice);
  const count = Number(opts.fillCount);
  if (!(pay > 0) || !(count > 0)) return 0;
  const won =
    (opts.side === 'YES' && opts.marketResult === 'yes') ||
    (opts.side === 'NO' && opts.marketResult === 'no');
  if (won) return Math.round(count * (1 - pay) * 100) / 100;
  return Math.round(-count * pay * 100) / 100;
}

export function inferFillCount(trade: TradeRecord): number {
  if (trade.fill_count != null && Number.isFinite(Number(trade.fill_count))) {
    return Math.max(0, Number(trade.fill_count));
  }
  const pay = Number(trade.fill_price || 0);
  const notional = Number(trade.notional_usd || 0);
  if (pay > 0 && notional > 0) return Math.max(1, Math.round(notional / pay));
  return 1;
}

/** True when a pending trade is old enough to bother checking settlement. */
export function isReadyToSettle(trade: TradeRecord, now = new Date()): boolean {
  const at = new Date(trade.at).getTime();
  if (!Number.isFinite(at)) return true;
  // 15m windows + buffer; also allow early check after 90s for already-finalized markets
  return now.getTime() - at >= 90_000;
}

export function settleFromMarket(
  trade: TradeRecord,
  market: { status?: string; result?: string } | null
): { outcome: TradeOutcome; pnl_usd: number } | null {
  if (!market) return null;
  const result = String(market.result || '').toLowerCase();
  if (result !== 'yes' && result !== 'no') return null;
  const fillCount = inferFillCount(trade);
  const pay = Number(trade.fill_price || 0);
  const pnl = computeTradePnlUsd({
    side: trade.side,
    payPrice: pay,
    fillCount,
    marketResult: result,
  });
  const won =
    (trade.side === 'YES' && result === 'yes') || (trade.side === 'NO' && result === 'no');
  return { outcome: won ? 'win' : 'loss', pnl_usd: pnl };
}

/**
 * Fetch market results for pending filled trades and update outcomes.
 * Returns how many trades were settled.
 */
export async function settlePendingTrades(
  trades: { list: (n?: number) => TradeRecord[]; update: (id: string, patch: Partial<TradeRecord>) => boolean },
  client: KalshiClient,
  now = new Date()
): Promise<{ settled: number; details: { id: string; outcome: TradeOutcome; pnl_usd: number }[] }> {
  const details: { id: string; outcome: TradeOutcome; pnl_usd: number }[] = [];
  const pending = trades
    .list(200)
    .filter((t) => !t.dry_run && t.outcome === 'pending' && inferFillCount(t) > 0);

  for (const t of pending) {
    if (!isReadyToSettle(t, now)) continue;
    try {
      const market = await client.getMarket(t.market_ticker);
      const settled = settleFromMarket(t, market);
      if (!settled) continue;
      trades.update(t.id, {
        outcome: settled.outcome,
        pnl_usd: settled.pnl_usd,
      });
      details.push({ id: t.id, outcome: settled.outcome, pnl_usd: settled.pnl_usd });
    } catch {
      /* ignore one bad ticker */
    }
  }
  return { settled: details.length, details };
}

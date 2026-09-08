import { getMarketQuote } from 'trading-core';
import { etDateKey } from '../util/time';
import { TradeRecordDoc, updateTradeRecord } from './firestore';

export type MarketQuoteFn = (ticker: string) => Promise<any>;

/** Tick-scoped cache: 1000 users share the same ~20 15m markets. */
export function createQuoteCache(fetchQuote: MarketQuoteFn = getMarketQuote) {
  const inflight = new Map<string, Promise<any>>();
  return {
    get(ticker: string): Promise<any> {
      const key = String(ticker || '').trim();
      if (!key) return Promise.resolve(null);
      const hit = inflight.get(key);
      if (hit) return hit;
      const p = fetchQuote(key).catch(() => null);
      inflight.set(key, p);
      return p;
    },
    size(): number {
      return inflight.size;
    },
  };
}

/** Same formula as `src/services/settlement.ts` — win = count × (1 − pay), loss = −count × pay. */
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

export function economicPayPrice(trade: TradeRecordDoc): number {
  const planned = trade.payPrice != null ? Number(trade.payPrice) : NaN;
  if (Number.isFinite(planned) && planned > 0) {
    return planned > 1 ? planned / 100 : planned;
  }
  const raw = Number(trade.price);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 1 ? raw / 100 : raw;
}

export function fillCountOf(trade: TradeRecordDoc): number {
  if (trade.fillCount != null && Number.isFinite(Number(trade.fillCount))) {
    return Math.max(0, Number(trade.fillCount));
  }
  const c = Number(trade.count);
  return Number.isFinite(c) && c > 0 ? c : 0;
}

export function isReadyToSettle(trade: TradeRecordDoc, now = new Date()): boolean {
  const at = new Date(trade.executedAt).getTime();
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at >= 90_000;
}

export function needsSettlement(trade: TradeRecordDoc, now = new Date()): boolean {
  if (trade.dryRun) return false;
  if (trade.status !== 'FILLED' && trade.status !== 'SUBMITTED') return false;
  if (trade.outcome === 'exited' || trade.outcome === 'exiting' || trade.outcome === 'miss') {
    return false;
  }
  if (!(fillCountOf(trade) > 0)) return false;
  if (!trade.ticker) return false;
  return isReadyToSettle(trade, now);
}

export function applyMarketResult(
  trade: TradeRecordDoc,
  market: { result?: string } | null,
  now = new Date()
): Pick<TradeRecordDoc, 'status' | 'pnlUsd' | 'outcome' | 'settledAt'> | null {
  if (trade.outcome === 'exited' || trade.outcome === 'exiting') return null;
  const result = String(market?.result || '').toLowerCase();
  if (result !== 'yes' && result !== 'no') return null;
  const pay = economicPayPrice(trade);
  const count = fillCountOf(trade);
  const pnlUsd = computeTradePnlUsd({
    side: trade.decision,
    payPrice: pay,
    fillCount: count,
    marketResult: result,
  });
  const won =
    (trade.decision === 'YES' && result === 'yes') || (trade.decision === 'NO' && result === 'no');
  return {
    status: 'SETTLED',
    pnlUsd,
    outcome: won ? 'win' : 'loss',
    settledAt: now.toISOString(),
  };
}

export function liveCloudTradesToday(trades: TradeRecordDoc[], now = new Date()): TradeRecordDoc[] {
  const day = etDateKey(now);
  return trades.filter((t) => {
    if (t.dryRun) return false;
    try {
      return etDateKey(new Date(t.executedAt)) === day;
    } catch {
      return false;
    }
  });
}

export function cloudDailyRealizedPnl(tradesToday: TradeRecordDoc[]): number {
  let realized = 0;
  for (const t of tradesToday) {
    if (t.status !== 'SETTLED' && t.outcome !== 'win' && t.outcome !== 'loss' && t.outcome !== 'exited') {
      continue;
    }
    realized += Number(t.pnlUsd || 0);
  }
  return Math.round(realized * 100) / 100;
}

export async function settlePendingCloudTrades(
  userId: string,
  trades: TradeRecordDoc[],
  now = new Date(),
  quoteCache = createQuoteCache()
): Promise<TradeRecordDoc[]> {
  const updated = trades.map((t) => ({ ...t }));
  const candidates = updated.filter((t) => needsSettlement(t, now));
  if (candidates.length === 0) return updated;

  const tickers = [...new Set(candidates.map((t) => t.ticker))];
  await Promise.all(tickers.map((ticker) => quoteCache.get(ticker)));

  const writes: Promise<void>[] = [];
  for (const trade of candidates) {
    const market = await quoteCache.get(trade.ticker);
    const patch = applyMarketResult(trade, market, now);
    if (!patch) continue;
    Object.assign(trade, patch);
    writes.push(updateTradeRecord(userId, trade.tradeId, patch));
  }
  if (writes.length > 0) await Promise.all(writes);
  return updated;
}

import {
  capLockLotsForTicker,
  evaluateCapLockWatch,
  isCapLockEntryPath,
  shouldWatchCapLockLots,
} from '../../../../packages/trading-core/src/capLock';
import { isOpenLiveFill } from '../../../../packages/trading-core/src/cashOut';
import { TradeRecordDoc, claimProtectSell, updateTradeRecord } from './firestore';
import { economicPayPrice, fillCountOf } from './settlement';
import { computeProtectSellPnlUsd } from '../../../../packages/trading-core/src/protectSell';

export type CapLockPlaceFn = (input: {
  ticker: string;
  side: 'bid' | 'ask';
  count: string;
  price: string;
  time_in_force: string;
  dry_run: boolean;
  client_order_id?: string;
}) => Promise<{ ok: boolean; fill_count?: string | number | null; order_id?: string | null }>;

export function pendingCapLockExtraTradesForMarket(
  trades: TradeRecordDoc[],
  marketTicker: string
): TradeRecordDoc[] {
  const lots = capLockLotsForTicker(trades, marketTicker);
  if (!shouldWatchCapLockLots(lots) || !lots.extraSide) return [];
  const tkr = String(marketTicker || '').trim();
  const rows = (trades || []).filter(
    (t) =>
      String(t.ticker || '').trim() === tkr &&
      isCapLockEntryPath(t.entryPath) &&
      isOpenLiveFill(t) &&
      !t.protectExitOrderId &&
      String(t.decision || '').toUpperCase() === lots.extraSide
  );
  rows.sort((a, b) => {
    const am = Date.parse(String(a.executedAt || '')) || 0;
    const bm = Date.parse(String(b.executedAt || '')) || 0;
    return bm - am;
  });
  const out: TradeRecordDoc[] = [];
  let need = lots.extraCount;
  for (const t of rows) {
    if (need <= 0) break;
    out.push(t);
    const n = Number(t.fillCount);
    need -= Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  }
  return out;
}

async function revertCapLockClaim(userId: string, trade: TradeRecordDoc): Promise<void> {
  trade.outcome = 'pending';
  trade.protectClaimedAt = null;
  await updateTradeRecord(userId, trade.tradeId, {
    outcome: 'pending',
    protectClaimedAt: null,
  });
}

export async function runCloudCapLockWatch(opts: {
  userId: string;
  asset: string;
  ticker: string;
  lean: {
    yes_bid?: number | null;
    yes_ask?: number | null;
    no_bid?: number | null;
    no_ask?: number | null;
    minutes_remaining?: number | null;
    minutes_left?: number | null;
  };
  trades: TradeRecordDoc[];
  maxLockLossUsd?: unknown;
  alreadyRetried?: boolean;
  dryRun: boolean;
  now?: Date;
  place: CapLockPlaceFn;
}): Promise<{
  kind: 'none' | 'retry_second' | 'flatten';
  skipped: string[];
  alerts: Array<{ tradeId: string; title: string; body: string; pnlUsd: number }>;
  placed: number;
  exited: number;
  secondGate?: { side?: string; count?: string; price?: string; pay_price?: number; decision?: string };
}> {
  const now = opts.now || new Date();
  const skipped: string[] = [];
  const alerts: Array<{ tradeId: string; title: string; body: string; pnlUsd: number }> = [];
  const lots = capLockLotsForTicker(opts.trades, opts.ticker);
  const watch = evaluateCapLockWatch({
    lots,
    quotes: {
      yes_bid: opts.lean.yes_bid,
      yes_ask: opts.lean.yes_ask,
      no_bid: opts.lean.no_bid,
      no_ask: opts.lean.no_ask,
    },
    maxLockLossUsd: opts.maxLockLossUsd,
    alreadyRetried: opts.alreadyRetried === true,
    now,
    minutesRemaining: (opts.lean as { minutes_remaining?: unknown; minutes_left?: unknown }).minutes_remaining
      ?? (opts.lean as { minutes_left?: unknown }).minutes_left,
  });
  if (watch.kind === 'retry_second' && watch.second?.ok && watch.second.price && watch.second.count) {
    return {
      kind: 'retry_second',
      skipped,
      alerts,
      placed: 0,
      exited: 0,
      secondGate: watch.second,
    };
  }
  if (watch.kind !== 'flatten' || !watch.flatten?.ok) {
    return { kind: 'none', skipped: watch.reason ? [watch.reason] : skipped, alerts, placed: 0, exited: 0 };
  }
  const held = pendingCapLockExtraTradesForMarket(opts.trades, opts.ticker);
  let exited = 0;
  let placed = 0;
  for (const trade of held) {
    if (trade.protectExitOrderId) {
      skipped.push('already_exited_on_kalshi');
      continue;
    }
    const claimed = await claimProtectSell(opts.userId, trade, now);
    if (!claimed) {
      skipped.push('claim_lost');
      continue;
    }
    const flatten = watch.flatten;
    if (!flatten.side || !flatten.price || !flatten.count) {
      await revertCapLockClaim(opts.userId, trade);
      skipped.push(flatten.reason || 'quote');
      continue;
    }
    let placedRes: { ok: boolean; fill_count?: string | number | null; order_id?: string | null };
    try {
      placedRes = await opts.place({
        ticker: opts.ticker,
        side: flatten.side,
        count: flatten.count,
        price: flatten.price,
        time_in_force: 'immediate_or_cancel',
        dry_run: opts.dryRun,
        client_order_id: `clfl-${trade.tradeId}`.slice(0, 64),
      });
    } catch {
      await revertCapLockClaim(opts.userId, trade);
      skipped.push('place_exception');
      continue;
    }
    const exitFills = Number(placedRes.fill_count ?? 0);
    if (!placedRes.ok || !(exitFills > 0)) {
      await revertCapLockClaim(opts.userId, trade);
      skipped.push('ioc_miss');
      continue;
    }
    placed += 1;
    const fillCount = Math.min(fillCountOf(trade), Math.floor(exitFills));
    const pnlUsd = computeProtectSellPnlUsd({
      heldSide: trade.decision === 'NO' ? 'NO' : 'YES',
      fillCount,
      entryPay: economicPayPrice(trade),
      exitEconomic: Number(flatten.economicExit || flatten.price) || 0,
    });
    trade.outcome = 'exited';
    trade.protectExitOrderId = String(placedRes.order_id || '');
    trade.pnlUsd = pnlUsd;
    await updateTradeRecord(opts.userId, trade.tradeId, {
      outcome: 'exited',
      protectExitOrderId: trade.protectExitOrderId,
      pnlUsd,
    });
    exited += 1;
    alerts.push({
      tradeId: trade.tradeId,
      title: 'Cap lock flatten',
      body: `${opts.asset} ${trade.decision} · unmatched leftover · P&L $${pnlUsd.toFixed(2)}`,
      pnlUsd,
    });
  }
  return { kind: 'flatten', skipped, alerts, placed, exited };
}

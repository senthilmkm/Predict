import {
  buildCheapLoopSellOrder,
  evaluateCheapLoopExit,
  isCheapLoopEntryPath,
  isCheapLoopHistorySellableTrade,
  isCheapLoopHourlyEntryPath,
  isCheapLoopWeeklyEntryPath,
} from '../../../../packages/trading-core/src/cheapLoop';
import { isOpenLiveFill } from '../../../../packages/trading-core/src/cashOut';
import { TradeRecordDoc, claimProtectSell, updateTradeRecord } from './firestore';
import { economicPayPrice, fillCountOf } from './settlement';
import { computeProtectSellPnlUsd } from '../../../../packages/trading-core/src/protectSell';

export type CheapLoopPlaceFn = (input: {
  ticker: string;
  side: 'bid' | 'ask';
  count: string;
  price: string;
  time_in_force: string;
  dry_run: boolean;
  client_order_id?: string;
}) => Promise<{ ok: boolean; fill_count?: string | number | null; order_id?: string | null }>;

export function pendingCheapLoopTradesForMarket(
  trades: TradeRecordDoc[],
  marketTicker: string
): TradeRecordDoc[] {
  const tkr = String(marketTicker || '').trim();
  return (trades || []).filter(
    (t) =>
      String(t.ticker || '').trim() === tkr &&
      isCheapLoopEntryPath(t.entryPath) &&
      isOpenLiveFill(t) &&
      !t.protectExitOrderId
  );
}

export function pendingCheapLoopHourlyTradesForMarket(
  trades: TradeRecordDoc[],
  marketTicker: string
): TradeRecordDoc[] {
  const tkr = String(marketTicker || '').trim();
  return (trades || []).filter(
    (t) =>
      String(t.ticker || '').trim() === tkr &&
      isCheapLoopHourlyEntryPath(t.entryPath) &&
      isOpenLiveFill(t) &&
      !t.protectExitOrderId
  );
}

export function pendingCheapLoopWeeklyTradesForMarket(
  trades: TradeRecordDoc[],
  marketTicker: string
): TradeRecordDoc[] {
  const tkr = String(marketTicker || '').trim();
  return (trades || []).filter(
    (t) =>
      String(t.ticker || '').trim() === tkr &&
      isCheapLoopWeeklyEntryPath(t.entryPath) &&
      isOpenLiveFill(t) &&
      !t.protectExitOrderId
  );
}

async function revertCheapLoopClaim(userId: string, trade: TradeRecordDoc): Promise<void> {
  trade.outcome = 'pending';
  trade.protectClaimedAt = null;
  await updateTradeRecord(userId, trade.tradeId, {
    outcome: 'pending',
    protectClaimedAt: null,
  });
}

export async function runCloudCheapLoopExits(opts: {
  userId: string;
  asset: string;
  ticker: string;
  lean: {
    phase?: string;
    minutes_left?: number;
    minutes_remaining?: number;
    yes_bid?: number | null;
    yes_ask?: number | null;
    no_bid?: number | null;
    no_ask?: number | null;
  };
  trades: TradeRecordDoc[];
  takeUsd?: unknown;
  stopUsd?: unknown;
  flattenMinutes?: unknown;
  minHoldMinutes?: unknown;
  slippageUsd: number;
  dryRun: boolean;
  now?: Date;
  hourly?: boolean;
  weekly?: boolean;
  place: CheapLoopPlaceFn;
}): Promise<{
  exited: number;
  skipped: string[];
  alerts: Array<{ tradeId: string; title: string; body: string; pnlUsd: number }>;
  placed: number;
}> {
  const now = opts.now || new Date();
  const skipped: string[] = [];
  const alerts: Array<{ tradeId: string; title: string; body: string; pnlUsd: number }> = [];
  let exited = 0;
  let placed = 0;

  const held = opts.weekly
    ? pendingCheapLoopWeeklyTradesForMarket(opts.trades, opts.ticker)
    : opts.hourly
      ? pendingCheapLoopHourlyTradesForMarket(opts.trades, opts.ticker)
      : pendingCheapLoopTradesForMarket(opts.trades, opts.ticker);
  for (const trade of held) {
    if (trade.protectExitOrderId) {
      skipped.push('already_exited_on_kalshi');
      continue;
    }
    const quotes = {
      yes_bid: opts.lean.yes_bid,
      yes_ask: opts.lean.yes_ask,
      no_bid: opts.lean.no_bid,
      no_ask: opts.lean.no_ask,
    };
    const evalRes = evaluateCheapLoopExit({
      heldSide: trade.decision,
      quotes,
      fillUsd: economicPayPrice(trade),
      takeUsd: opts.takeUsd,
      stopUsd: opts.stopUsd,
      flattenMinutes: opts.flattenMinutes,
      minHoldMinutes: opts.minHoldMinutes,
      lean: {
        phase: opts.lean.phase,
        minutes_left: opts.lean.minutes_left,
        minutes_remaining: opts.lean.minutes_remaining,
      },
      filledAt: trade.executedAt,
      now,
    });
    if (!evalRes.sell) {
      skipped.push(evalRes.reason);
      continue;
    }
    const order = buildCheapLoopSellOrder({
      heldSide: trade.decision,
      fillCount: fillCountOf(trade),
      quotes,
      slippageUsd: opts.slippageUsd,
    });
    if (!order.ok || !order.side || !order.price || !order.count) {
      skipped.push(order.reason || 'quote');
      continue;
    }
    const claimed = await claimProtectSell(opts.userId, trade, now);
    if (!claimed) {
      skipped.push('claim_lost');
      continue;
    }
    const clientOrderId = `clp-${trade.tradeId}`.slice(0, 64);
    let placedRes: { ok: boolean; fill_count?: string | number | null; order_id?: string | null };
    try {
      placedRes = await opts.place({
        ticker: opts.ticker,
        side: order.side,
        count: order.count,
        price: order.price,
        time_in_force: 'immediate_or_cancel',
        dry_run: opts.dryRun,
        client_order_id: clientOrderId,
      });
    } catch {
      await revertCheapLoopClaim(opts.userId, trade);
      skipped.push('place_exception');
      continue;
    }
    placed += 1;
    const exitFills = Number(placedRes.fill_count ?? 0);
    if (!placedRes.ok || !(exitFills > 0)) {
      await revertCheapLoopClaim(opts.userId, trade);
      skipped.push('ioc_miss');
      continue;
    }
    const fillCount = Math.min(fillCountOf(trade), Math.floor(exitFills));
    const pnlUsd = computeProtectSellPnlUsd({
      heldSide: trade.decision === 'NO' ? 'NO' : 'YES',
      entryPay: economicPayPrice(trade),
      exitEconomic: Number(order.economicExit || 0),
      fillCount,
    });
    const exitOrderId = placedRes.order_id ?? null;
    const exitPayPrice = Math.round(Number(order.economicExit || 0) * 10000) / 10000;
    trade.outcome = 'exited';
    trade.pnlUsd = pnlUsd;
    trade.settledAt = now.toISOString();
    trade.status = 'SETTLED';
    trade.protectClaimedAt = null;
    trade.protectExitOrderId = exitOrderId;
    trade.exitPayPrice = exitPayPrice;
    await updateTradeRecord(opts.userId, trade.tradeId, {
      outcome: 'exited',
      status: 'SETTLED',
      pnlUsd,
      settledAt: now.toISOString(),
      protectClaimedAt: null,
      protectExitOrderId: exitOrderId,
      exitPayPrice,
    });
    exited += 1;
    const weekly = opts.weekly === true;
    const hourly = opts.hourly === true;
    const title =
      evalRes.kind === 'cheap_loop_take'
        ? weekly
          ? 'Cheap loop weekly take'
          : hourly
            ? 'Cheap loop hourly take'
            : 'Cheap loop 15m take'
        : evalRes.kind === 'cheap_loop_stop'
          ? weekly
            ? 'Cheap loop weekly stop'
            : hourly
              ? 'Cheap loop hourly stop'
              : 'Cheap loop 15m stop'
          : weekly
            ? 'Cheap loop weekly flatten'
            : hourly
              ? 'Cheap loop hourly flatten'
              : 'Cheap loop 15m flatten';
    alerts.push({
      tradeId: trade.tradeId,
      title,
      body: `${opts.asset} ${trade.decision} · ${title.toLowerCase()} · P&L $${pnlUsd.toFixed(2)}`,
      pnlUsd,
    });
  }

  return { exited, skipped, alerts, placed };
}

export async function runCheapLoopForcedBidExit(opts: {
  userId: string;
  asset: string;
  ticker: string;
  trade: TradeRecordDoc;
  quotes: {
    yes_bid?: number | null;
    yes_ask?: number | null;
    no_bid?: number | null;
    no_ask?: number | null;
  };
  slippageUsd: number;
  dryRun: boolean;
  now?: Date;
  place: CheapLoopPlaceFn;
}): Promise<{
  ok: boolean;
  skipped?: string;
  alert?: { tradeId: string; title: string; body: string; pnlUsd: number };
}> {
  const now = opts.now || new Date();
  const trade = opts.trade;
  if (!isCheapLoopHistorySellableTrade(trade)) {
    return { ok: false, skipped: 'not_sellable' };
  }
  if (String(trade.ticker || '').trim() !== String(opts.ticker || '').trim()) {
    return { ok: false, skipped: 'ticker_mismatch' };
  }
  if (trade.protectExitOrderId) {
    return { ok: false, skipped: 'already_exited_on_kalshi' };
  }
  const order = buildCheapLoopSellOrder({
    heldSide: trade.decision,
    fillCount: fillCountOf(trade),
    quotes: opts.quotes,
    slippageUsd: opts.slippageUsd,
  });
  if (!order.ok || !order.side || !order.price || !order.count) {
    return { ok: false, skipped: order.reason || 'quote' };
  }
  const claimed = await claimProtectSell(opts.userId, trade, now);
  if (!claimed) {
    return { ok: false, skipped: 'claim_lost' };
  }
  const clientOrderId = `clhs-${trade.tradeId}`.slice(0, 64);
  let placedRes: { ok: boolean; fill_count?: string | number | null; order_id?: string | null };
  try {
    placedRes = await opts.place({
      ticker: opts.ticker,
      side: order.side,
      count: order.count,
      price: order.price,
      time_in_force: 'immediate_or_cancel',
      dry_run: opts.dryRun,
      client_order_id: clientOrderId,
    });
  } catch {
    await revertCheapLoopClaim(opts.userId, trade);
    return { ok: false, skipped: 'place_exception' };
  }
  const exitFills = Number(placedRes.fill_count ?? 0);
  if (!placedRes.ok || !(exitFills > 0)) {
    await revertCheapLoopClaim(opts.userId, trade);
    return { ok: false, skipped: 'ioc_miss' };
  }
  const fillCount = Math.min(fillCountOf(trade), Math.floor(exitFills));
  const pnlUsd = computeProtectSellPnlUsd({
    heldSide: trade.decision === 'NO' ? 'NO' : 'YES',
    entryPay: economicPayPrice(trade),
    exitEconomic: Number(order.economicExit || 0),
    fillCount,
  });
  const exitOrderId = placedRes.order_id ?? null;
  const exitPayPrice = Math.round(Number(order.economicExit || 0) * 10000) / 10000;
  trade.outcome = 'exited';
  trade.pnlUsd = pnlUsd;
  trade.settledAt = now.toISOString();
  trade.status = 'SETTLED';
  trade.protectClaimedAt = null;
  trade.protectExitOrderId = exitOrderId;
  trade.exitPayPrice = exitPayPrice;
  await updateTradeRecord(opts.userId, trade.tradeId, {
    outcome: 'exited',
    status: 'SETTLED',
    pnlUsd,
    settledAt: now.toISOString(),
    protectClaimedAt: null,
    protectExitOrderId: exitOrderId,
    exitPayPrice,
  });
  const weekly = isCheapLoopWeeklyEntryPath(trade.entryPath);
  const title = weekly ? 'Cheap loop weekly sell' : 'Cheap loop hourly sell';
  return {
    ok: true,
    alert: {
      tradeId: trade.tradeId,
      title,
      body: `${opts.asset} ${trade.decision} · ${title.toLowerCase()} · P&L $${pnlUsd.toFixed(2)}`,
      pnlUsd,
    },
  };
}

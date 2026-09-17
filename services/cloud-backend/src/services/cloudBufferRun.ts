import {
  buildBufferRunSellOrder,
  evaluateBufferRunExit,
  isBufferRunEntryPath,
} from '../../../../packages/trading-core/src/bufferRun';
import { isOpenLiveFill } from '../../../../packages/trading-core/src/cashOut';
import { TradeRecordDoc, claimProtectSell, updateTradeRecord } from './firestore';
import { economicPayPrice, fillCountOf } from './settlement';
import { computeProtectSellPnlUsd } from '../../../../packages/trading-core/src/protectSell';

export type BufferRunPlaceFn = (input: {
  ticker: string;
  side: 'bid' | 'ask';
  count: string;
  price: string;
  time_in_force: string;
  dry_run: boolean;
  client_order_id?: string;
}) => Promise<{ ok: boolean; fill_count?: string | number | null; order_id?: string | null }>;

export function pendingBufferRunTradesForMarket(
  trades: TradeRecordDoc[],
  marketTicker: string
): TradeRecordDoc[] {
  const tkr = String(marketTicker || '').trim();
  return (trades || []).filter(
    (t) =>
      String(t.ticker || '').trim() === tkr &&
      isBufferRunEntryPath(t.entryPath) &&
      isOpenLiveFill(t) &&
      !t.protectExitOrderId
  );
}

async function revertBufferRunClaim(userId: string, trade: TradeRecordDoc): Promise<void> {
  trade.outcome = 'pending';
  trade.protectClaimedAt = null;
  await updateTradeRecord(userId, trade.tradeId, {
    outcome: 'pending',
    protectClaimedAt: null,
  });
}

function exitTitle(kind: string): string {
  if (kind === 'buffer_run_take') return 'Buffer run take';
  if (kind === 'buffer_run_sell_at') return 'Buffer run sell at %';
  if (kind === 'buffer_run_stop') return 'Buffer run stop';
  if (kind === 'buffer_run_lean_flip') return 'Buffer run lean flip';
  return 'Buffer run flatten';
}

export async function runCloudBufferRunExits(opts: {
  userId: string;
  asset: string;
  ticker: string;
  lean: {
    phase?: string;
    minutes_left?: number;
    minutes_remaining?: number;
    live?: number | null;
    strike?: number | null;
    yes_bid?: number | null;
    yes_ask?: number | null;
    no_bid?: number | null;
    no_ask?: number | null;
  };
  trades: TradeRecordDoc[];
  takeUsd?: unknown;
  stopUsd?: unknown;
  flattenMinutes?: unknown;
  sellAtPct?: unknown;
  slippageUsd: number;
  dryRun: boolean;
  now?: Date;
  place: BufferRunPlaceFn;
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

  const held = pendingBufferRunTradesForMarket(opts.trades, opts.ticker);
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
    const evalRes = evaluateBufferRunExit({
      heldSide: trade.decision,
      quotes,
      fillUsd: economicPayPrice(trade),
      takeUsd: opts.takeUsd,
      stopUsd: opts.stopUsd,
      flattenMinutes: opts.flattenMinutes,
      sellAtPct: opts.sellAtPct,
      lean: {
        phase: opts.lean.phase,
        minutes_left: opts.lean.minutes_left,
        minutes_remaining: opts.lean.minutes_remaining,
        live: opts.lean.live,
        strike: opts.lean.strike,
      },
      filledAt: trade.executedAt,
      now,
    });
    if (!evalRes.sell) {
      skipped.push(evalRes.reason);
      continue;
    }
    const order = buildBufferRunSellOrder({
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
    const clientOrderId = `bfr-${trade.tradeId}`.slice(0, 64);
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
      await revertBufferRunClaim(opts.userId, trade);
      skipped.push('place_exception');
      continue;
    }
    placed += 1;
    const exitFills = Number(placedRes.fill_count ?? 0);
    if (!placedRes.ok || !(exitFills > 0)) {
      await revertBufferRunClaim(opts.userId, trade);
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
      pnlUsd,
      settledAt: trade.settledAt,
      status: 'SETTLED',
      protectClaimedAt: null,
      protectExitOrderId: exitOrderId,
      exitPayPrice,
    });
    exited += 1;
    alerts.push({
      tradeId: trade.tradeId,
      title: exitTitle(evalRes.kind),
      body: `${opts.asset} ${trade.decision} · P&L $${pnlUsd.toFixed(2)}`,
      pnlUsd,
    });
  }
  return { exited, skipped, alerts, placed };
}

import {
  buildGoldFadeSellOrder,
  evaluateGoldFadeExit,
  isGoldFadeEntryPath,
} from '../../../../packages/trading-core/src/goldFade';
import { isOpenLiveFill } from '../../../../packages/trading-core/src/cashOut';
import { TradeRecordDoc, claimProtectSell, updateTradeRecord } from './firestore';
import { economicPayPrice, fillCountOf } from './settlement';
import { computeProtectSellPnlUsd } from '../../../../packages/trading-core/src/protectSell';

export type GoldFadePlaceFn = (input: {
  ticker: string;
  side: 'bid' | 'ask';
  count: string;
  price: string;
  time_in_force: string;
  dry_run: boolean;
  client_order_id?: string;
}) => Promise<{ ok: boolean; fill_count?: string | number | null; order_id?: string | null }>;

export function pendingGoldFadeTradesForMarket(
  trades: TradeRecordDoc[],
  marketTicker: string
): TradeRecordDoc[] {
  const tkr = String(marketTicker || '').trim();
  return (trades || []).filter(
    (t) =>
      String(t.ticker || '').trim() === tkr &&
      isGoldFadeEntryPath(t.entryPath) &&
      isOpenLiveFill(t) &&
      !t.protectExitOrderId
  );
}

async function revertGoldFadeClaim(userId: string, trade: TradeRecordDoc): Promise<void> {
  trade.outcome = 'pending';
  trade.protectClaimedAt = null;
  await updateTradeRecord(userId, trade.tradeId, {
    outcome: 'pending',
    protectClaimedAt: null,
  });
}

export async function runCloudGoldFadeExits(opts: {
  userId: string;
  asset: string;
  ticker: string;
  lean: {
    decision: string;
    abs_gap?: number;
    phase?: string;
    minutes_left?: number;
    minutes_remaining?: number;
    yes_bid?: number | null;
    yes_ask?: number | null;
    no_bid?: number | null;
    no_ask?: number | null;
  };
  trades: TradeRecordDoc[];
  cushion: number;
  takeUsd?: number | null;
  stopUsd?: number | null;
  flattenMinutes?: number | null;
  skipThinBid?: boolean;
  bidSize?: number | null;
  graceSeconds: number;
  slippageUsd: number;
  dryRun: boolean;
  now?: Date;
  place: GoldFadePlaceFn;
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

  const held = pendingGoldFadeTradesForMarket(opts.trades, opts.ticker);
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
    const evalRes = evaluateGoldFadeExit({
      heldSide: trade.decision,
      quotes,
      fillPayUsd: economicPayPrice(trade),
      takeUsd: opts.takeUsd,
      stopUsd: opts.stopUsd,
      flattenMinutes: opts.flattenMinutes,
      skipThinBid: Boolean(opts.skipThinBid),
      bidSize: opts.bidSize,
      needCount: fillCountOf(trade),
      lean: {
        decision: opts.lean.decision,
        abs_gap: opts.lean.abs_gap,
        phase: opts.lean.phase,
        minutes_left: opts.lean.minutes_left,
        minutes_remaining: opts.lean.minutes_remaining,
      },
      cushion: opts.cushion,
      filledAt: trade.executedAt,
      graceSeconds: opts.graceSeconds,
      now,
    });
    if (!evalRes.sell) {
      skipped.push(evalRes.reason);
      continue;
    }

    const order = buildGoldFadeSellOrder({
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

    const clientOrderId = `fade-${trade.tradeId}`.slice(0, 64);
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
      await revertGoldFadeClaim(opts.userId, trade);
      skipped.push('place_exception');
      continue;
    }

    placed += 1;
    const exitFills = Number(placedRes.fill_count ?? 0);
    if (!placedRes.ok || !(exitFills > 0)) {
      await revertGoldFadeClaim(opts.userId, trade);
      skipped.push('ioc_miss');
      continue;
    }

    const fillCount = Math.min(fillCountOf(trade), Math.floor(exitFills));
    const pnlUsd = computeProtectSellPnlUsd({
      heldSide: trade.decision,
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
    const title =
      evalRes.kind === 'gold_fade_take'
        ? 'Gold fade'
        : evalRes.kind === 'gold_fade_stop'
          ? 'Gold fade stop'
          : evalRes.kind === 'gold_fade_thin_bid'
            ? 'Gold fade thin bid'
            : evalRes.kind === 'gold_fade_flip'
              ? 'Gold fade flip'
              : 'Gold fade time';
    alerts.push({
      tradeId: trade.tradeId,
      title,
      body: `${opts.asset} ${trade.decision} · ${title.toLowerCase()} · P&L $${pnlUsd.toFixed(2)}`,
      pnlUsd,
    });
  }

  return { exited, skipped, alerts, placed };
}

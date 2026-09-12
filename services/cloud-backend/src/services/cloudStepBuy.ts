import {
  evaluateStepBuyStops,
  isStepBuyEntryPath,
  normalizeStepBuyStopUsd,
} from '../../../../packages/trading-core/src/stepBuy';
import { buildProtectSellOrder, computeProtectSellPnlUsd } from '../../../../packages/trading-core/src/protectSell';
import { isOpenLiveFill } from '../../../../packages/trading-core/src/cashOut';
import { TradeRecordDoc, claimProtectSell, updateTradeRecord } from './firestore';
import { economicPayPrice, fillCountOf } from './settlement';

export type StepBuyPlaceFn = (input: {
  ticker: string;
  side: 'bid' | 'ask';
  count: string;
  price: string;
  time_in_force: string;
  dry_run: boolean;
  client_order_id?: string;
}) => Promise<{ ok: boolean; fill_count?: string | number | null; order_id?: string | null }>;

export function pendingStepBuyTradesForMarket(trades: TradeRecordDoc[], marketTicker: string): TradeRecordDoc[] {
  const tkr = String(marketTicker || '').trim();
  return (trades || []).filter(
    (t) =>
      String(t.ticker || '').trim() === tkr &&
      isStepBuyEntryPath(t.entryPath) &&
      isOpenLiveFill(t) &&
      !t.protectExitOrderId
  );
}

async function revertStepBuyClaim(userId: string, trade: TradeRecordDoc): Promise<void> {
  trade.outcome = 'pending';
  trade.protectClaimedAt = null;
  await updateTradeRecord(userId, trade.tradeId, {
    outcome: 'pending',
    protectClaimedAt: null,
  });
}

export async function runCloudStepBuyStops(opts: {
  userId: string;
  asset: string;
  ticker: string;
  lean: {
    phase?: string;
    yes_bid?: number | null;
    yes_ask?: number | null;
    no_bid?: number | null;
    no_ask?: number | null;
  };
  trades: TradeRecordDoc[];
  stopUsd?: unknown;
  slippageUsd: number;
  dryRun: boolean;
  now?: Date;
  place: StepBuyPlaceFn;
}): Promise<{
  exited: number;
  skipped: string[];
  alerts: Array<{ tradeId: string; title: string; body: string; pnlUsd: number }>;
}> {
  const now = opts.now || new Date();
  const skipped: string[] = [];
  const alerts: Array<{ tradeId: string; title: string; body: string; pnlUsd: number }> = [];
  let exited = 0;
  if (opts.lean.phase === 'ended') return { exited: 0, skipped: ['window_ended'], alerts };

  const hits = evaluateStepBuyStops({
    trades: opts.trades,
    marketTicker: opts.ticker,
    yesAsk: opts.lean.yes_ask,
    noAsk: opts.lean.no_ask,
    stopUsd: opts.stopUsd,
    now,
  });
  for (const hit of hits) {
    const trade = opts.trades.find((t) => t.tradeId === (hit.trade as TradeRecordDoc).tradeId) || (hit.trade as TradeRecordDoc);
    if (trade.protectExitOrderId) {
      skipped.push('already_exited_on_kalshi');
      continue;
    }
    const order = buildProtectSellOrder({
      heldSide: trade.decision === 'NO' ? 'NO' : 'YES',
      fillCount: fillCountOf(trade),
      yesBid: opts.lean.yes_bid,
      yesAsk: opts.lean.yes_ask,
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
    const clientOrderId = `sbs-${trade.tradeId}`.slice(0, 64);
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
      await revertStepBuyClaim(opts.userId, trade);
      skipped.push('place_exception');
      continue;
    }
    const exitFills = Number(placedRes.fill_count ?? 0);
    if (!placedRes.ok || !(exitFills > 0)) {
      await revertStepBuyClaim(opts.userId, trade);
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
    const stop = normalizeStepBuyStopUsd(opts.stopUsd);
    alerts.push({
      tradeId: trade.tradeId,
      title: 'Step buy stop',
      body: `${opts.asset} ${trade.decision} · ${hit.flatten ? 'lot 1 flatten' : `stop ${Math.round(stop * 100)}¢`} · P&L $${pnlUsd.toFixed(2)}`,
      pnlUsd,
    });
  }
  return { exited, skipped, alerts };
}

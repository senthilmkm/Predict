import {
  evaluateLastMinuteFlipSell,
  isLastMinuteEntryPath,
  normalizeLastMinuteFlipSellUsd,
} from '../../../../packages/trading-core/src/lastMinute';
import { buildProtectSellOrder, computeProtectSellPnlUsd } from '../../../../packages/trading-core/src/protectSell';
import { isOpenLiveFill } from '../../../../packages/trading-core/src/cashOut';
import { TradeRecordDoc, claimProtectSell, updateTradeRecord } from './firestore';
import { economicPayPrice, fillCountOf } from './settlement';

export type LastMinuteFlipPlaceFn = (input: {
  ticker: string;
  side: 'bid' | 'ask';
  count: string;
  price: string;
  time_in_force: string;
  dry_run: boolean;
  client_order_id?: string;
}) => Promise<{ ok: boolean; fill_count?: string | number | null; order_id?: string | null }>;

export function pendingLastMinuteTradesForMarket(
  trades: TradeRecordDoc[],
  marketTicker: string
): TradeRecordDoc[] {
  const tkr = String(marketTicker || '').trim();
  return (trades || []).filter(
    (t) =>
      String(t.ticker || '').trim() === tkr &&
      isLastMinuteEntryPath(t.entryPath) &&
      isOpenLiveFill(t) &&
      !t.protectExitOrderId
  );
}

async function revertFlipClaim(userId: string, trade: TradeRecordDoc): Promise<void> {
  trade.outcome = 'pending';
  trade.protectClaimedAt = null;
  await updateTradeRecord(userId, trade.tradeId, {
    outcome: 'pending',
    protectClaimedAt: null,
  });
}

export async function runCloudLastMinuteFlipExits(opts: {
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
  flipSellUsd?: unknown;
  slippageUsd: number;
  dryRun: boolean;
  now?: Date;
  place: LastMinuteFlipPlaceFn;
}): Promise<{
  exited: number;
  skipped: string[];
  alerts: Array<{ tradeId: string; title: string; body: string; pnlUsd: number }>;
}> {
  const now = opts.now || new Date();
  const skipped: string[] = [];
  const alerts: Array<{ tradeId: string; title: string; body: string; pnlUsd: number }> = [];
  let exited = 0;
  const needUsd = normalizeLastMinuteFlipSellUsd(opts.flipSellUsd);
  if (needUsd <= 0) return { exited: 0, skipped: ['last_minute_flip_off'], alerts };

  const held = pendingLastMinuteTradesForMarket(opts.trades, opts.ticker);
  for (const trade of held) {
    if (trade.protectExitOrderId) {
      skipped.push('already_exited_on_kalshi');
      continue;
    }
    const evalRes = evaluateLastMinuteFlipSell({
      flipSellUsd: needUsd,
      heldSide: trade.decision,
      yesAsk: opts.lean.yes_ask,
      noAsk: opts.lean.no_ask,
      phase: opts.lean.phase,
      filledAt: trade.executedAt,
      now,
    });
    if (!evalRes.sell) {
      skipped.push(evalRes.reason);
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

    const clientOrderId = `lmf-${trade.tradeId}`.slice(0, 64);
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
      await revertFlipClaim(opts.userId, trade);
      skipped.push('place_exception');
      continue;
    }

    const exitFills = Number(placedRes.fill_count ?? 0);
    if (!placedRes.ok || !(exitFills > 0)) {
      await revertFlipClaim(opts.userId, trade);
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
    alerts.push({
      tradeId: trade.tradeId,
      title: 'Last-minute flip',
      body: `${opts.asset} ${trade.decision} · flip ${Math.round(evalRes.flipUsd * 100)}¢ · P&L $${pnlUsd.toFixed(2)}`,
      pnlUsd,
    });
  }

  return { exited, skipped, alerts };
}

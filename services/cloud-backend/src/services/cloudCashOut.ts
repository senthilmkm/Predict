import {
  buildCashOutSellOrder,
  evaluateCashOutExit,
  isCashOutEntryPath,
  isOpenLiveFill,
} from '../../../../packages/trading-core/src/cashOut';
import {
  TradeRecordDoc,
  claimProtectSell,
  updateTradeRecord,
} from './firestore';
import { economicPayPrice, fillCountOf } from './settlement';
import { computeProtectSellPnlUsd } from '../../../../packages/trading-core/src/protectSell';

export type CashOutPlaceFn = (input: {
  ticker: string;
  side: 'bid' | 'ask';
  count: string;
  price: string;
  time_in_force: string;
  dry_run: boolean;
  client_order_id?: string;
}) => Promise<{ ok: boolean; fill_count?: string | number | null; order_id?: string | null }>;

export function pendingCashOutTradesForMarket(
  trades: TradeRecordDoc[],
  marketTicker: string
): TradeRecordDoc[] {
  const tkr = String(marketTicker || '').trim();
  return (trades || []).filter(
    (t) =>
      String(t.ticker || '').trim() === tkr &&
      isCashOutEntryPath(t.entryPath) &&
      isOpenLiveFill(t) &&
      !t.protectExitOrderId
  );
}

export function usersHaveOpenCashOut(tradesByUser: Array<{ trades: TradeRecordDoc[] }>): boolean {
  return tradesByUser.some((row) => (row.trades || []).some((t) => isCashOutEntryPath(t.entryPath) && isOpenLiveFill(t)));
}

async function revertCashOutClaim(userId: string, trade: TradeRecordDoc): Promise<void> {
  trade.outcome = 'pending';
  trade.protectClaimedAt = null;
  await updateTradeRecord(userId, trade.tradeId, {
    outcome: 'pending',
    protectClaimedAt: null,
  });
}

export async function runCloudCashOutExits(opts: {
  userId: string;
  asset: string;
  ticker: string;
  lean: { decision: string; abs_gap?: number; phase?: string; yes_bid?: number | null; yes_ask?: number | null; no_bid?: number | null; no_ask?: number | null };
  trades: TradeRecordDoc[];
  cushion: number;
  cashOutBidUsd: number;
  cashOutMaxAskUsd?: number | null;
  graceSeconds: number;
  slippageUsd: number;
  dryRun: boolean;
  now?: Date;
  place: CashOutPlaceFn;
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

  const held = pendingCashOutTradesForMarket(opts.trades, opts.ticker);
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
    const evalRes = evaluateCashOutExit({
      heldSide: trade.decision,
      quotes,
      cashOutBidUsd: opts.cashOutBidUsd,
      cashOutMaxAskUsd: opts.cashOutMaxAskUsd,
      fillPayUsd: economicPayPrice(trade),
      lean: {
        decision: opts.lean.decision,
        abs_gap: opts.lean.abs_gap,
        phase: opts.lean.phase,
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

    const order = buildCashOutSellOrder({
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

    const clientOrderId = `cout-${trade.tradeId}`.slice(0, 64);
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
      await revertCashOutClaim(opts.userId, trade);
      skipped.push('place_exception');
      continue;
    }

    placed += 1;
    const exitFills = Number(placedRes.fill_count ?? 0);
    if (!placedRes.ok || !(exitFills > 0)) {
      await revertCashOutClaim(opts.userId, trade);
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
    const title = evalRes.kind === 'cash_out_bid' ? 'Cash out' : 'Cash out flip';
    alerts.push({
      tradeId: trade.tradeId,
      title,
      body: `${opts.asset} ${trade.decision} · ${title.toLowerCase()} · P&L $${pnlUsd.toFixed(2)}`,
      pnlUsd,
    });
  }

  return { exited, skipped, alerts, placed };
}

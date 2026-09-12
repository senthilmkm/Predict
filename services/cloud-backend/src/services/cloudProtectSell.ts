import {
  buildProtectSellOrder,
  computeProtectSellPnlUsd,
  shouldProtectSell,
} from '../../../../packages/trading-core/src/protectSell';
import {
  TradeRecordDoc,
  claimProtectSell,
  isProtectClaimable,
  updateTradeRecord,
} from './firestore';
import { economicPayPrice, fillCountOf } from './settlement';

export { PROTECT_CLAIM_STALE_MS } from './firestore';

export type ProtectPlaceFn = (input: {
  ticker: string;
  side: 'bid' | 'ask';
  count: string;
  price: string;
  time_in_force: string;
  dry_run: boolean;
  client_order_id?: string;
}) => Promise<{ ok: boolean; fill_count?: string | number | null; order_id?: string | null }>;

export function protectPushEnabled(cfg: any): boolean {
  if (!cfg || cfg.alerts_enabled === false) return false;
  const pref = cfg.alert_prefs?.protect_sell;
  if (pref && (pref.enabled === false || pref.push === false)) return false;
  return true;
}

export function protectCollapseId(userId: string, tradeId: string): string {
  const raw = `prot:${userId}:${tradeId}`;
  return raw.length <= 64 ? raw : raw.slice(0, 64);
}

export function isOpenProtectCandidate(trade: TradeRecordDoc, now = new Date()): boolean {
  if (!(fillCountOf(trade) > 0)) return false;
  return isProtectClaimable(trade, now);
}

export function pendingProtectTradesForMarket(
  trades: TradeRecordDoc[],
  marketTicker: string,
  now = new Date()
): TradeRecordDoc[] {
  return trades.filter(
    (t) =>
      t.ticker === marketTicker &&
      t.entryPath !== 'cash_out' &&
      t.entryPath !== 'gold_fade' &&
      t.entryPath !== 'twap_lock' &&
      t.entryPath !== 'last_minute' &&
      t.entryPath !== 'step_buy' &&
      isOpenProtectCandidate(t, now)
  );
}

export function evaluateCloudProtectSell(opts: {
  trade: TradeRecordDoc;
  lean: { decision: string; abs_gap?: number; phase?: string };
  cushion: number;
  gapRatio: number;
  graceSeconds: number;
  enabled: boolean;
  now?: Date;
}) {
  return shouldProtectSell({
    enabled: opts.enabled,
    heldSide: opts.trade.decision,
    lean: {
      decision: opts.lean.decision as 'YES' | 'NO' | 'SKIP',
      abs_gap: opts.lean.abs_gap,
      phase: (opts.lean.phase as 'live' | 'ended') || 'live',
    },
    cushion: opts.cushion,
    gapRatio: opts.gapRatio,
    filledAt: opts.trade.executedAt,
    graceSeconds: opts.graceSeconds,
    now: opts.now,
  });
}

async function revertProtectClaim(userId: string, trade: TradeRecordDoc): Promise<void> {
  trade.outcome = 'pending';
  trade.protectClaimedAt = null;
  await updateTradeRecord(userId, trade.tradeId, {
    outcome: 'pending',
    protectClaimedAt: null,
  });
}

export async function runCloudProtectSells(opts: {
  userId: string;
  asset: string;
  ticker: string;
  lean: { decision: string; abs_gap?: number; phase?: string; yes_bid?: number | null; yes_ask?: number | null };
  trades: TradeRecordDoc[];
  cushion: number;
  gapRatio: number;
  graceSeconds: number;
  slippageUsd: number;
  enabled: boolean;
  dryRun: boolean;
  now?: Date;
  place: ProtectPlaceFn;
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

  const held = pendingProtectTradesForMarket(opts.trades, opts.ticker, now);
  for (const trade of held) {
    if (trade.protectExitOrderId) {
      skipped.push('already_exited_on_kalshi');
      continue;
    }

    const evalRes = evaluateCloudProtectSell({
      trade,
      lean: opts.lean,
      cushion: opts.cushion,
      gapRatio: opts.gapRatio,
      graceSeconds: opts.graceSeconds,
      enabled: opts.enabled,
      now,
    });
    if (!evalRes.sell) {
      skipped.push(evalRes.reason);
      continue;
    }

    const order = buildProtectSellOrder({
      heldSide: trade.decision,
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

    const clientOrderId = `prot-${trade.tradeId}`.slice(0, 64);
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
      await revertProtectClaim(opts.userId, trade);
      skipped.push('place_exception');
      continue;
    }

    placed += 1;
    const exitFills = Number(placedRes.fill_count ?? 0);
    if (!placedRes.ok || !(exitFills > 0)) {
      await revertProtectClaim(opts.userId, trade);
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
    trade.outcome = 'exited';
    trade.pnlUsd = pnlUsd;
    trade.settledAt = now.toISOString();
    trade.status = 'SETTLED';
    trade.protectClaimedAt = null;
    trade.protectExitOrderId = exitOrderId;
    await updateTradeRecord(opts.userId, trade.tradeId, {
      outcome: 'exited',
      status: 'SETTLED',
      pnlUsd,
      settledAt: now.toISOString(),
      protectClaimedAt: null,
      protectExitOrderId: exitOrderId,
    });
    exited += 1;
    alerts.push({
      tradeId: trade.tradeId,
      title: 'Protect sell',
      body: `${opts.asset} ${trade.decision} · early sell · P&L $${pnlUsd.toFixed(2)} · gap $${evalRes.leanGap.toFixed(2)} (need ≥$${evalRes.minGap.toFixed(2)})`,
      pnlUsd,
    });
  }

  return { exited, skipped, alerts, placed };
}

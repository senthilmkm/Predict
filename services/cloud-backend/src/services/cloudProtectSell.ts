import {
  buildProtectSellOrder,
  computeProtectSellPnlUsd,
  homeAutoExitWatchNeeded,
  sellAtPctForEntryPath,
  shouldProtectSell,
  shouldSellAtProfitPct,
} from '../../../../packages/trading-core/src/protectSell';
import {
  TradeRecordDoc,
  claimProtectSell,
  isProtectClaimable,
  updateTradeRecord,
} from './firestore';
import { isPairLockEntryPath } from '../../../../packages/trading-core/src/pairLock';
import { isCapLockEntryPath } from '../../../../packages/trading-core/src/capLock';
import { isBufferRunEntryPath } from '../../../../packages/trading-core/src/bufferRun';
import { economicPayPrice, fillCountOf } from './settlement';

export { PROTECT_CLAIM_STALE_MS } from './firestore';
export { homeAutoExitWatchNeeded };

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

/** Home / Auto lots Protect / Sell at % can dump — 1s watch these assets only. */
export function openProtectWatchAssets(trades: TradeRecordDoc[], now = new Date()): string[] {
  const out: string[] = [];
  for (const t of trades || []) {
    if (
      t.entryPath === 'cash_out' ||
      t.entryPath === 'gold_fade' ||
      t.entryPath === 'twap_lock' ||
      t.entryPath === 'last_minute' ||
      t.entryPath === 'step_buy' ||
      t.entryPath === 'spike_fade' ||
      t.entryPath === 'cheap_loop' ||
      t.entryPath === 'cheap_loop_hourly' ||
      t.entryPath === 'cheap_loop_weekly' ||
      isPairLockEntryPath(t.entryPath) ||
      isCapLockEntryPath(t.entryPath) ||
      isBufferRunEntryPath(t.entryPath)
    ) {
      continue;
    }
    if (!isOpenProtectCandidate(t, now)) continue;
    const asset = String(t.asset || '').trim();
    if (asset && !out.includes(asset)) out.push(asset);
  }
  return out;
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
      t.entryPath !== 'spike_fade' &&
      t.entryPath !== 'cheap_loop' &&
      t.entryPath !== 'cheap_loop_hourly' &&
      t.entryPath !== 'cheap_loop_weekly' &&
      !isPairLockEntryPath(t.entryPath) &&
      !isCapLockEntryPath(t.entryPath) &&
      !isBufferRunEntryPath(t.entryPath) &&
      isOpenProtectCandidate(t, now)
  );
}

export function evaluateCloudProtectSell(opts: {
  trade: TradeRecordDoc;
  lean: {
    decision: string;
    abs_gap?: number;
    phase?: string;
    yes_bid?: number | null;
    yes_ask?: number | null;
  };
  cushion: number;
  gapRatio: number;
  graceSeconds: number;
  enabled: boolean;
  homeSellAtPct?: unknown;
  cushionLeanSellAtPct?: unknown;
  now?: Date;
}): { sell: boolean; reason: string; kind: 'protect_flip' | 'sell_at' | 'none'; minGap?: number; leanGap?: number; pct?: number } {
  const sellAtPct = sellAtPctForEntryPath(opts.trade.entryPath, {
    home_sell_at_pct: opts.homeSellAtPct,
    cushion_lean_sell_at_pct: opts.cushionLeanSellAtPct,
  });
  const take = shouldSellAtProfitPct({
    sellAtPct,
    entryPay: economicPayPrice(opts.trade),
    heldSide: opts.trade.decision,
    yesBid: opts.lean.yes_bid,
    yesAsk: opts.lean.yes_ask,
    filledAt: opts.trade.executedAt,
    graceSeconds: opts.graceSeconds,
    now: opts.now,
    phase: opts.lean.phase,
  });
  if (take.sell) {
    return { sell: true, reason: take.reason, kind: 'sell_at', pct: take.pct };
  }

  const flip = shouldProtectSell({
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
  if (flip.sell) {
    return {
      sell: true,
      reason: flip.reason,
      kind: 'protect_flip',
      minGap: flip.minGap,
      leanGap: flip.leanGap,
    };
  }
  return {
    sell: false,
    reason: take.pct > 0 ? take.reason : flip.reason,
    kind: 'none',
    minGap: flip.minGap,
    leanGap: flip.leanGap,
    pct: take.pct,
  };
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
  lean: {
    decision: string;
    abs_gap?: number;
    phase?: string;
    yes_bid?: number | null;
    yes_ask?: number | null;
  };
  trades: TradeRecordDoc[];
  cushion: number;
  gapRatio: number;
  graceSeconds: number;
  slippageUsd: number;
  enabled: boolean;
  homeSellAtPct?: unknown;
  cushionLeanSellAtPct?: unknown;
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
      homeSellAtPct: opts.homeSellAtPct,
      cushionLeanSellAtPct: opts.cushionLeanSellAtPct,
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
    if (evalRes.kind === 'sell_at') {
      alerts.push({
        tradeId: trade.tradeId,
        title: 'Sell at profit',
        body: `${opts.asset} ${trade.decision} · +${evalRes.pct}% target · P&L $${pnlUsd.toFixed(2)}`,
        pnlUsd,
      });
    } else {
      alerts.push({
        tradeId: trade.tradeId,
        title: 'Protect sell',
        body: `${opts.asset} ${trade.decision} · early sell · P&L $${pnlUsd.toFixed(2)} · gap $${Number(evalRes.leanGap || 0).toFixed(2)} (need ≥$${Number(evalRes.minGap || 0).toFixed(2)})`,
        pnlUsd,
      });
    }
  }

  return { exited, skipped, alerts, placed };
}

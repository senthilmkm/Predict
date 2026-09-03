import { LeanResult } from './lean/lean';
import { TradeRecord, TradeSide } from '../storage/repos';
import { inferFillCount } from './settlement';

export function protectSellMinGapUsd(cushion: number, gapRatio: number): number {
  const c = Math.max(0, Number(cushion) || 0);
  const r = Math.max(0.5, Number(gapRatio) || 1);
  return Math.round(c * r * 10000) / 10000;
}

/**
 * Sell early when the live lean flips against a held position with enough gap.
 * Example: you bought YES; lean is now NO with gap ≥ cushion × ratio → protect sell.
 */
export function inProtectSellGrace(opts: {
  filledAt: string | Date | number | null | undefined;
  graceSeconds: number;
  now?: Date;
}): boolean {
  const grace = Math.max(0, Number(opts.graceSeconds) || 0);
  if (grace <= 0) return false;
  const at = opts.filledAt instanceof Date ? opts.filledAt.getTime() : new Date(opts.filledAt as any).getTime();
  if (!Number.isFinite(at)) return false;
  const now = (opts.now ?? new Date()).getTime();
  return now - at < grace * 1000;
}

export function shouldProtectSell(opts: {
  enabled: boolean;
  heldSide: TradeSide;
  lean: Pick<LeanResult, 'decision' | 'abs_gap' | 'phase'>;
  cushion: number;
  gapRatio: number;
  filledAt?: string | Date | number | null;
  graceSeconds?: number;
  now?: Date;
}): { sell: boolean; reason: string; minGap: number; leanGap: number } {
  const minGap = protectSellMinGapUsd(opts.cushion, opts.gapRatio);
  const leanGap = Number(opts.lean.abs_gap ?? 0);
  if (!opts.enabled) {
    return { sell: false, reason: 'protect_off', minGap, leanGap };
  }
  if (opts.lean.phase === 'ended') {
    return { sell: false, reason: 'window_ended', minGap, leanGap };
  }
  const decision = opts.lean.decision;
  if (decision !== 'YES' && decision !== 'NO') {
    return { sell: false, reason: 'no_opposite_lean', minGap, leanGap };
  }
  if (decision === opts.heldSide) {
    return { sell: false, reason: 'lean_still_with_you', minGap, leanGap };
  }
  if (leanGap + 1e-9 < minGap) {
    return { sell: false, reason: 'gap_too_small', minGap, leanGap };
  }
  if (
    inProtectSellGrace({
      filledAt: opts.filledAt,
      graceSeconds: opts.graceSeconds ?? 0,
      now: opts.now,
    })
  ) {
    return { sell: false, reason: 'grace_after_fill', minGap, leanGap };
  }
  return {
    sell: true,
    reason: `opposite_${decision}_gap_${leanGap.toFixed(2)}`,
    minGap,
    leanGap,
  };
}

/** Build IOC exit order: sell YES with ask, cover NO with bid. */
export function buildProtectSellOrder(opts: {
  heldSide: TradeSide;
  fillCount: number;
  yesBid?: number | null;
  yesAsk?: number | null;
  slippageUsd?: number;
}): {
  ok: boolean;
  reason?: string;
  side?: 'bid' | 'ask';
  price?: string;
  count?: string;
  economicExit?: number;
} {
  const count = Math.max(0, Math.floor(Number(opts.fillCount) || 0));
  if (count < 1) return { ok: false, reason: 'zero_count' };
  let slip = Number(opts.slippageUsd ?? 0.02);
  if (!(slip >= 0)) slip = 0;
  if (slip > 0.1) slip = 0.1;

  if (opts.heldSide === 'YES') {
    const bid = Number(opts.yesBid);
    if (!(bid > 0)) return { ok: false, reason: 'bid_unavailable' };
    let limit = bid - slip;
    if (limit < 0.01) limit = 0.01;
    if (limit >= 0.99) limit = 0.98;
    return {
      ok: true,
      side: 'ask',
      price: limit.toFixed(4),
      count: String(count),
      economicExit: limit,
    };
  }

  const ask = Number(opts.yesAsk);
  if (!(ask > 0)) return { ok: false, reason: 'ask_unavailable' };
  let limit = ask + slip;
  if (limit >= 0.99) limit = 0.99;
  if (limit <= 0.01) limit = 0.02;
  return {
    ok: true,
    side: 'bid',
    price: limit.toFixed(4),
    count: String(count),
    economicExit: Math.round((1 - limit) * 10000) / 10000,
  };
}

export function computeProtectSellPnlUsd(opts: {
  heldSide: TradeSide;
  entryPay: number;
  exitEconomic: number;
  fillCount: number;
}): number {
  const n = Math.max(0, Number(opts.fillCount) || 0);
  const entry = Number(opts.entryPay) || 0;
  const exit = Number(opts.exitEconomic) || 0;
  if (n <= 0 || entry <= 0) return 0;
  // Economic P&L ≈ contracts × (exit_pay - entry_pay) for the held side
  return Math.round(n * (exit - entry) * 100) / 100;
}

export function pendingTradesForMarket(
  trades: TradeRecord[],
  marketTicker: string
): TradeRecord[] {
  return trades.filter(
    (t) =>
      !t.dry_run &&
      t.outcome === 'pending' &&
      t.market_ticker === marketTicker &&
      inferFillCount(t) > 0
  );
}

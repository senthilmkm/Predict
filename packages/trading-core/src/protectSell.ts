export type ProtectSide = 'YES' | 'NO';

export const SELL_AT_PCT_DEFAULT = 0;
export const SELL_AT_PCT_MIN = 0.5;
export const SELL_AT_PCT_MAX = 100;
export const SELL_AT_PCT_STEP = 0.5;

export function protectSellMinGapUsd(cushion: number, gapRatio: number): number {
  const c = Math.max(0, Number(cushion) || 0);
  const r = Math.max(0.5, Number(gapRatio) || 1);
  return Math.round(c * r * 10000) / 10000;
}

/** 0 = Off. Otherwise snap to 0.5–100 step 0.5. */
export function normalizeSellAtPct(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const clamped = Math.min(SELL_AT_PCT_MAX, Math.max(SELL_AT_PCT_MIN, n));
  return Math.round(clamped / SELL_AT_PCT_STEP) * SELL_AT_PCT_STEP;
}

/** Held-side mark for % profit: YES → yes_bid; NO → 1 − yes_ask. */
export function heldSideMarkUsd(opts: {
  heldSide: ProtectSide | string;
  yesBid?: number | null;
  yesAsk?: number | null;
}): number | null {
  const side = String(opts.heldSide || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  if (side === 'YES') {
    const bid = Number(opts.yesBid);
    return bid > 0 && Number.isFinite(bid) ? bid : null;
  }
  const ask = Number(opts.yesAsk);
  if (!(ask > 0) || !Number.isFinite(ask)) return null;
  const mark = 1 - ask;
  return mark > 0 ? Math.round(mark * 10000) / 10000 : null;
}

/**
 * Take profit when mark ≥ entry × (1 + pct/100).
 * pct ≤ 0 → Off. Respects grace after fill.
 */
export function shouldSellAtProfitPct(opts: {
  sellAtPct: unknown;
  entryPay: unknown;
  heldSide: ProtectSide | string;
  yesBid?: number | null;
  yesAsk?: number | null;
  filledAt?: string | Date | number | null;
  graceSeconds?: number;
  now?: Date;
  phase?: string;
}): { sell: boolean; reason: string; mark: number | null; need: number | null; pct: number } {
  const pct = normalizeSellAtPct(opts.sellAtPct);
  const entry = Number(opts.entryPay);
  const mark = heldSideMarkUsd({
    heldSide: opts.heldSide,
    yesBid: opts.yesBid,
    yesAsk: opts.yesAsk,
  });
  if (pct <= 0) {
    return { sell: false, reason: 'sell_at_off', mark, need: null, pct: 0 };
  }
  if (opts.phase === 'ended') {
    return { sell: false, reason: 'window_ended', mark, need: null, pct };
  }
  if (!(entry > 0) || !Number.isFinite(entry)) {
    return { sell: false, reason: 'no_entry', mark, need: null, pct };
  }
  const need = Math.round(entry * (1 + pct / 100) * 10000) / 10000;
  if (mark == null) {
    return { sell: false, reason: 'mark_unavailable', mark, need, pct };
  }
  if (
    inProtectSellGrace({
      filledAt: opts.filledAt,
      graceSeconds: opts.graceSeconds ?? 0,
      now: opts.now,
    })
  ) {
    return { sell: false, reason: 'grace_after_fill', mark, need, pct };
  }
  if (mark + 1e-9 >= need) {
    return { sell: true, reason: 'sell_at_profit', mark, need, pct };
  }
  return { sell: false, reason: 'below_sell_at', mark, need, pct };
}

/** True when Home/Auto exit watcher should run (Protect flip and/or Sell at %). */
export function homeAutoExitWatchNeeded(risk?: {
  protect_sell_enabled?: boolean;
  home_sell_at_pct?: unknown;
  cushion_lean_sell_at_pct?: unknown;
} | null): boolean {
  if (risk?.protect_sell_enabled === true) return true;
  return (
    normalizeSellAtPct(risk?.home_sell_at_pct) > 0 ||
    normalizeSellAtPct(risk?.cushion_lean_sell_at_pct) > 0
  );
}

export function sellAtPctForEntryPath(
  entryPath: unknown,
  risk?: { home_sell_at_pct?: unknown; cushion_lean_sell_at_pct?: unknown } | null
): number {
  const v = String(entryPath ?? '')
    .toLowerCase()
    .trim();
  if (v === 'home') return normalizeSellAtPct(risk?.home_sell_at_pct);
  if (v === 'auto') return normalizeSellAtPct(risk?.cushion_lean_sell_at_pct);
  return 0;
}

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
  heldSide: ProtectSide;
  lean: { decision: string; abs_gap?: number; phase?: string };
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
  heldSide: ProtectSide;
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
  heldSide: ProtectSide;
  entryPay: number;
  exitEconomic: number;
  fillCount: number;
}): number {
  const n = Math.max(0, Number(opts.fillCount) || 0);
  const entry = Number(opts.entryPay) || 0;
  const exit = Number(opts.exitEconomic) || 0;
  if (n <= 0 || entry <= 0) return 0;
  return Math.round(n * (exit - entry) * 100) / 100;
}

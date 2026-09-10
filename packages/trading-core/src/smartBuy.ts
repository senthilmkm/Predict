/**
 * Auto-trade Smart buy: leftover-move model vs Kalshi ask.
 *
 * our_guess = Φ(gap / (bounce × √minutes_remaining)), clipped to [0.55, 0.95]
 * extra     = our_guess − ask
 * buy only if extra ≥ min extra chance (default $0.08)
 *
 * bounce is RMS of time-scaled price increments from this window’s path
 * (Kalshi live timeseries). Home Buy never calls this.
 */

export const SMART_BUY_MIN_EDGE_DEFAULT = 0.08;
export const SMART_BUY_MIN_EDGE_MIN = 0.04;
export const SMART_BUY_MIN_EDGE_MAX = 0.15;
export const SMART_BUY_GUESS_MIN = 0.55;
export const SMART_BUY_GUESS_MAX = 0.95;
export const SMART_BUY_MIN_RETURNS = 3;
export const SMART_BUY_LOOKBACK_MS = 120_000;
export const SMART_BUY_LOOKBACK_TOLERANCE_MS = 90_000;
export const SMART_BUY_MIN_DT_MS = 5_000;
export const SMART_BUY_DYING_BOUNCE_MULT = 0.5;

export type SpotTick = { t: number; v: number };

export type SmartBuySkip = 'smart_buy_no_path' | 'smart_buy_gap_dying' | 'smart_buy_edge_too_small';

export interface SmartBuyInput {
  live: number;
  strike: number;
  absGap: number;
  minutesRemaining: number;
  ask: number;
  minEdgeUsd: number;
  timeseries?: SpotTick[] | null;
}

export interface SmartBuyDecision {
  ok: boolean;
  skip_reason?: SmartBuySkip;
  bounce: number | null;
  room_to_move: number | null;
  z: number | null;
  our_guess: number | null;
  ask: number;
  extra: number | null;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function snapCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Missing field → On (product default). Explicit false → Off. */
export function isSmartBuyEnabled(risk: { smart_buy_enabled?: boolean } | null | undefined): boolean {
  return risk?.smart_buy_enabled !== false;
}

export function normalizeSmartBuyMinEdge(raw: unknown): number {
  const n = Number(raw);
  const v = Number.isFinite(n) ? n : SMART_BUY_MIN_EDGE_DEFAULT;
  return snapCents(clamp(v, SMART_BUY_MIN_EDGE_MIN, SMART_BUY_MIN_EDGE_MAX));
}

/**
 * A&S 7.1.26 rational approximation. Max |error| ≈ 1.5e-7.
 * https://en.wikipedia.org/wiki/Error_function#Approximation_with_elementary_functions
 */
export function erf(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1 / (1 + p * a);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-a * a);
  return sign * y;
}

/** Standard normal CDF Φ(z) = ½ (1 + erf(z / √2)). */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return Number.NaN;
  if (z >= 8) return 1;
  if (z <= -8) return 0;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Seconds-since-epoch vs milliseconds. Threshold 1e11 ms ≈ 1973. */
export function tickTimeMs(t: number): number {
  if (!Number.isFinite(t)) return Number.NaN;
  return t < 1e11 ? t * 1000 : t;
}

export function sanitizeTimeseries(raw: unknown): SpotTick[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const out: SpotTick[] = [];
  for (const p of raw) {
    const t = Number((p as SpotTick)?.t);
    const v = Number((p as SpotTick)?.v);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    out.push({ t, v });
  }
  if (out.length < 2) return undefined;
  out.sort((a, b) => tickTimeMs(a.t) - tickTimeMs(b.t));
  return out;
}

/**
 * Realized 1-minute bounce: RMS of Δprice / √Δt_minutes.
 * Variance of a Brownian increment scales with time, so this is σ per √minute.
 */
export function computeBounce(ticks: SpotTick[]): number | null {
  const scaled: number[] = [];
  for (let i = 1; i < ticks.length; i++) {
    const t0 = tickTimeMs(ticks[i - 1].t);
    const t1 = tickTimeMs(ticks[i].t);
    const dtMs = t1 - t0;
    if (!(dtMs >= SMART_BUY_MIN_DT_MS)) continue;
    const dtMin = dtMs / 60_000;
    const dp = Number(ticks[i].v) - Number(ticks[i - 1].v);
    if (!Number.isFinite(dp) || !(dtMin > 0)) continue;
    scaled.push(dp / Math.sqrt(dtMin));
  }
  if (scaled.length < SMART_BUY_MIN_RETURNS) return null;
  let ss = 0;
  for (const x of scaled) ss += x * x;
  const rms = Math.sqrt(ss / scaled.length);
  if (!Number.isFinite(rms) || rms <= 0) return null;
  return rms;
}

export function gapAtLookback(
  ticks: SpotTick[],
  strike: number,
  nowMs: number
): number | null {
  const target = nowMs - SMART_BUY_LOOKBACK_MS;
  let best: SpotTick | null = null;
  let bestAbs = Infinity;
  for (const p of ticks) {
    const tm = tickTimeMs(p.t);
    const d = Math.abs(tm - target);
    if (d < bestAbs) {
      bestAbs = d;
      best = p;
    }
  }
  if (!best || bestAbs > SMART_BUY_LOOKBACK_TOLERANCE_MS) return null;
  const g = Math.abs(Number(best.v) - strike);
  return Number.isFinite(g) ? g : null;
}

function fail(
  reason: SmartBuySkip,
  ask: number,
  extra: Partial<SmartBuyDecision> = {}
): SmartBuyDecision {
  return {
    ok: false,
    skip_reason: reason,
    bounce: extra.bounce ?? null,
    room_to_move: extra.room_to_move ?? null,
    z: extra.z ?? null,
    our_guess: extra.our_guess ?? null,
    ask,
    extra: extra.extra ?? null,
  };
}

export function evaluateSmartBuy(input: SmartBuyInput): SmartBuyDecision {
  const ask = clamp(Number(input.ask), 0.01, 0.99);
  const minEdge = normalizeSmartBuyMinEdge(input.minEdgeUsd);
  const ticks = sanitizeTimeseries(input.timeseries);
  if (!ticks) return fail('smart_buy_no_path', ask);

  const bounce = computeBounce(ticks);
  if (bounce == null) return fail('smart_buy_no_path', ask);

  const tLeft = Number(input.minutesRemaining);
  if (!Number.isFinite(tLeft) || tLeft <= 0) {
    return fail('smart_buy_no_path', ask, { bounce });
  }

  const room = bounce * Math.sqrt(tLeft);
  if (!Number.isFinite(room) || room <= 0) {
    return fail('smart_buy_no_path', ask, { bounce, room_to_move: room });
  }

  const gap = Math.abs(Number(input.absGap));
  if (!Number.isFinite(gap)) return fail('smart_buy_no_path', ask, { bounce, room_to_move: room });

  const lastMs = tickTimeMs(ticks[ticks.length - 1].t);
  const gapThen = gapAtLookback(ticks, Number(input.strike), lastMs);
  if (gapThen != null && gap + 1e-12 < gapThen - SMART_BUY_DYING_BOUNCE_MULT * bounce) {
    return fail('smart_buy_gap_dying', ask, { bounce, room_to_move: room });
  }

  const z = gap / room;
  const rawGuess = normalCdf(z);
  if (!Number.isFinite(rawGuess)) {
    return fail('smart_buy_no_path', ask, { bounce, room_to_move: room, z });
  }
  const ourGuess = clamp(rawGuess, SMART_BUY_GUESS_MIN, SMART_BUY_GUESS_MAX);
  const extra = ourGuess - ask;

  if (extra + 1e-9 < minEdge) {
    return fail('smart_buy_edge_too_small', ask, {
      bounce,
      room_to_move: room,
      z,
      our_guess: ourGuess,
      extra,
    });
  }

  return {
    ok: true,
    bounce,
    room_to_move: room,
    z,
    our_guess: ourGuess,
    ask,
    extra,
  };
}

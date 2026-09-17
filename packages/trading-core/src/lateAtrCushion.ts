/**
 * Last-minute late ATR cushion: in the final 60s at a high ask, require
 * signed lead ≥ atr_mult × 1-minute ATR built from this window’s spot ticks.
 *
 * Design: docs/LAST_MINUTE.md — Locked: Late ATR cushion.
 */

import { sanitizeTimeseries, SpotTick, tickTimeMs } from './smartBuy';

export const LAST_MINUTE_ATR_WINDOW_SEC = 60;
export const LAST_MINUTE_ATR_PERIOD = 14;
export const LAST_MINUTE_ATR_MIN_BARS = 5;
export const LAST_MINUTE_ATR_ASK_DEFAULT = 0.88;
export const LAST_MINUTE_ATR_ASK_MIN = 0.8;
export const LAST_MINUTE_ATR_ASK_MAX = 0.95;
export const LAST_MINUTE_ATR_MULT_DEFAULT = 1.25;
export const LAST_MINUTE_ATR_MULT_MIN = 1;
export const LAST_MINUTE_ATR_MULT_MAX = 1.5;

export type LateAtrSkip = 'last_minute_atr_thin' | 'last_minute_atr_no_path';

export type MinuteBar = { minuteMs: number; high: number; low: number; close: number };

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function snap(n: number, step: number): number {
  if (step <= 0) return n;
  const rounded = Math.round(n / step) * step;
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  return Number(rounded.toFixed(decimals));
}

/** Missing / old docs → On. */
export function isLastMinuteAtrCushionEnabled(
  risk?: { last_minute_atr_cushion_enabled?: boolean } | null
): boolean {
  return risk?.last_minute_atr_cushion_enabled !== false;
}

export function normalizeLastMinuteAtrAskUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? LAST_MINUTE_ATR_ASK_DEFAULT), LAST_MINUTE_ATR_ASK_MIN, LAST_MINUTE_ATR_ASK_MAX),
    0.01
  );
}

export function normalizeLastMinuteAtrMult(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? LAST_MINUTE_ATR_MULT_DEFAULT), LAST_MINUTE_ATR_MULT_MIN, LAST_MINUTE_ATR_MULT_MAX),
    0.05
  );
}

/** Signed lead on the bought side. YES = live−strike, NO = strike−live. */
export function signedLeadUsd(opts: {
  decision: 'YES' | 'NO';
  live: unknown;
  strike: unknown;
}): number | null {
  const live = Number(opts.live);
  const strike = Number(opts.strike);
  if (!Number.isFinite(live) || !Number.isFinite(strike)) return null;
  return opts.decision === 'NO' ? strike - live : live - strike;
}

/** Bucket spot ticks into 1-minute OHLC-ish bars (open unused). */
export function buildOneMinuteBars(ticks: SpotTick[]): MinuteBar[] {
  const clean = sanitizeTimeseries(ticks);
  if (!clean || clean.length < 2) return [];
  const byMinute = new Map<number, MinuteBar>();
  for (const p of clean) {
    const ms = tickTimeMs(p.t);
    if (!Number.isFinite(ms)) continue;
    const minuteMs = Math.floor(ms / 60_000) * 60_000;
    const v = Number(p.v);
    if (!Number.isFinite(v)) continue;
    const cur = byMinute.get(minuteMs);
    if (!cur) {
      byMinute.set(minuteMs, { minuteMs, high: v, low: v, close: v });
    } else {
      cur.high = Math.max(cur.high, v);
      cur.low = Math.min(cur.low, v);
      cur.close = v;
    }
  }
  return [...byMinute.values()].sort((a, b) => a.minuteMs - b.minuteMs);
}

/**
 * Simple-mean ATR of the last `period` true ranges.
 * Needs at least LAST_MINUTE_ATR_MIN_BARS complete bars (with a prior close).
 */
export function computeOneMinuteAtr(
  ticks: SpotTick[] | null | undefined,
  period: number = LAST_MINUTE_ATR_PERIOD
): number | null {
  const bars = buildOneMinuteBars(ticks || []);
  if (bars.length < 2) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prevClose = bars[i - 1].close;
    const range = cur.high - cur.low;
    const up = Math.abs(cur.high - prevClose);
    const down = Math.abs(cur.low - prevClose);
    const tr = Math.max(range, up, down);
    if (Number.isFinite(tr) && tr >= 0) trs.push(tr);
  }
  if (trs.length < LAST_MINUTE_ATR_MIN_BARS) return null;
  const take = trs.slice(-Math.max(1, Math.floor(period)));
  if (take.length < LAST_MINUTE_ATR_MIN_BARS) return null;
  let sum = 0;
  for (const x of take) sum += x;
  const atr = sum / take.length;
  if (!Number.isFinite(atr) || atr <= 0) return null;
  return atr;
}

export type LateAtrEval = {
  active: boolean;
  ok: boolean;
  skip_reason?: LateAtrSkip;
  lead: number | null;
  atr: number | null;
  need: number | null;
};

/**
 * When inactive (outside window / ask under floor / Off), ok=true and active=false.
 * When active and ATR is known: ok only if lead ≥ atr_mult × ATR.
 * When active but ATR cannot be measured: allow (do not hard-block Last-minute).
 */
export function evaluateLateAtrCushion(opts: {
  enabled: boolean;
  secondsLeft: number;
  askUsd: number;
  highAskFloorUsd: number;
  atrMult: number;
  decision: 'YES' | 'NO';
  live: unknown;
  strike: unknown;
  timeseries?: SpotTick[] | null;
}): LateAtrEval {
  const empty: LateAtrEval = { active: false, ok: true, lead: null, atr: null, need: null };
  if (!opts.enabled) return empty;
  const left = Number(opts.secondsLeft);
  const ask = Number(opts.askUsd);
  const floor = normalizeLastMinuteAtrAskUsd(opts.highAskFloorUsd);
  if (!(left > 0) || left > LAST_MINUTE_ATR_WINDOW_SEC + 1e-9) return empty;
  if (!(ask + 1e-9 >= floor)) return empty;

  const lead = signedLeadUsd({
    decision: opts.decision,
    live: opts.live,
    strike: opts.strike,
  });
  const atr = computeOneMinuteAtr(opts.timeseries);
  // No measurable 1m path → do not veto. Thin-lead skip only when ATR is known.
  if (atr == null || lead == null) {
    return {
      active: true,
      ok: true,
      skip_reason: undefined,
      lead,
      atr,
      need: null,
    };
  }
  const mult = normalizeLastMinuteAtrMult(opts.atrMult);
  const need = atr * mult;
  if (lead + 1e-9 < need) {
    return {
      active: true,
      ok: false,
      skip_reason: 'last_minute_atr_thin',
      lead,
      atr,
      need,
    };
  }
  return { active: true, ok: true, lead, atr, need };
}

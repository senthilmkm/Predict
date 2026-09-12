import { AppConfig, AssetKey } from './types';
import { evaluateStaticGate, GateResult, LeanSignal } from './gates';
import { CashOutQuotes, isOpenLiveFill, openFillsForTicker, sideAskOf, ticketUsd } from './cashOut';

export const TWAP_LOCK_ASSETS: AssetKey[] = ['BTC', 'ETH'];
export const TWAP_LOCK_SAMPLE_COUNT = 60;
export const TWAP_LOCK_INTERVAL_SEC = 1;
export const TWAP_LOCK_WATCH_SEC = 70;
export const TWAP_LOCK_MAX_ASK_DEFAULT = 0.96;
export const TWAP_LOCK_MAX_ASK_MIN = 0.9;
export const TWAP_LOCK_MAX_ASK_MAX = 0.97;
export const TWAP_LOCK_CLOCK_SKEW_MAX_SEC = 1;

export type TwapLockPrint = { utcSec: number; price: number };

export type TwapLockSeriesResult = {
  ok: boolean;
  locked: boolean;
  banked: number;
  needed: number;
  leftover: number;
  elapsed: number;
  reason?: string;
};

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

export function normalizeTwapLockMaxAskUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? TWAP_LOCK_MAX_ASK_DEFAULT), TWAP_LOCK_MAX_ASK_MIN, TWAP_LOCK_MAX_ASK_MAX),
    0.01
  );
}

export function normalizeTwapLockAssets(raw: unknown): string[] {
  const allowed = new Set(TWAP_LOCK_ASSETS);
  if (raw == null) return [...TWAP_LOCK_ASSETS];
  if (!Array.isArray(raw)) return [...TWAP_LOCK_ASSETS];
  const out: string[] = [];
  for (const item of raw) {
    const k = String(item || '').trim();
    if (allowed.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function isTwapLockAsset(asset: string): boolean {
  return TWAP_LOCK_ASSETS.includes(String(asset) as AssetKey);
}

export function isTwapLockAssetSelected(assets: unknown, asset: string): boolean {
  return normalizeTwapLockAssets(assets).includes(String(asset));
}

export function isTwapLockEntryPath(raw: unknown): boolean {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim();
  return v === 'twap_lock' || v === 'twaplock' || v === 'twap';
}

/** Admin On + user On + BTC/ETH chip. */
export function isTwapLockEnterPath(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assets: unknown;
  asset: string;
}): boolean {
  return Boolean(
    opts.adminEnabled &&
      opts.userEnabled &&
      isTwapLockAsset(opts.asset) &&
      isTwapLockAssetSelected(opts.assets, opts.asset)
  );
}

/** TWAP owns this coin for the whole window — Cash out and lean Auto must not enter. */
export function twapLockBlocksOtherAutoPaths(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assets: unknown;
  asset: string;
}): boolean {
  return isTwapLockEnterPath(opts);
}

export function tickerHasOpenTwapLock(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some((t) =>
    isTwapLockEntryPath(
      (t as { entryPath?: unknown; entry_path?: unknown }).entryPath ??
        (t as { entry_path?: unknown }).entry_path
    )
  );
}

export function openTwapLockAssets(
  trades: Array<{ asset?: string; entryPath?: unknown; entry_path?: unknown } & Parameters<typeof isOpenLiveFill>[0]>
): string[] {
  const out: string[] = [];
  for (const t of trades || []) {
    if (!isOpenLiveFill(t) || !isTwapLockEntryPath(t.entryPath ?? t.entry_path)) continue;
    const asset = String(t.asset || '').trim();
    if (asset && !out.includes(asset)) out.push(asset);
  }
  return out;
}

export function twapLockNeededUsd(strike: number): number {
  return Number(strike) * TWAP_LOCK_SAMPLE_COUNT;
}

export function resolveTwapCloseUtc(
  lean: { close_utc?: string | Date | null; minutes_remaining?: number },
  now: Date
): Date | null {
  const raw = lean.close_utc;
  if (raw instanceof Date && Number.isFinite(raw.getTime())) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw);
    if (Number.isFinite(d.getTime())) return d;
  }
  const rem = Number(lean.minutes_remaining);
  if (Number.isFinite(rem)) {
    return new Date(now.getTime() + rem * 60_000);
  }
  return null;
}

export function twapLockWindow(closeUtc: Date): { startMs: number; endMs: number } {
  const endMs = closeUtc.getTime();
  return { startMs: endMs - TWAP_LOCK_SAMPLE_COUNT * 1000, endMs };
}

/** Complete elapsed seconds inside [close−60s, close). */
export function twapLockElapsedCompleteSeconds(now: Date, closeUtc: Date): number {
  const { startMs, endMs } = twapLockWindow(closeUtc);
  const t = now.getTime();
  if (t >= endMs) return TWAP_LOCK_SAMPLE_COUNT;
  if (t < startMs) return 0;
  return Math.floor((t - startMs) / 1000);
}

export function twapLockSecondsLeft(now: Date, closeUtc: Date): number {
  return Math.max(0, Math.ceil((closeUtc.getTime() - now.getTime()) / 1000));
}

export function isTwapLockLastMinute(now: Date, closeUtc: Date): boolean {
  const sec = (closeUtc.getTime() - now.getTime()) / 1000;
  return sec > 0 && sec <= TWAP_LOCK_SAMPLE_COUNT;
}

export function isTwapLockWatchWindow(now: Date, closeUtc: Date): boolean {
  const sec = (closeUtc.getTime() - now.getTime()) / 1000;
  return sec > 0 && sec <= TWAP_LOCK_WATCH_SEC;
}

function printMap(prints: TwapLockPrint[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const p of prints || []) {
    const sec = Math.floor(Number(p.utcSec));
    const price = Number(p.price);
    if (!Number.isFinite(sec) || !Number.isFinite(price) || price < 0) continue;
    map.set(sec, price);
  }
  return map;
}

/**
 * Yes is $0-remaining locked only if the official 1s sum already beats strike × 60.
 * Missing any elapsed second → not ok (fail closed). Do not carry-forward.
 */
export function evaluateTwapLockSeries(opts: {
  prints: TwapLockPrint[];
  closeUtc: Date;
  now: Date;
  strike: number;
}): TwapLockSeriesResult {
  const strike = Number(opts.strike);
  const needed = twapLockNeededUsd(strike);
  const empty = { locked: false, banked: 0, needed, leftover: 0, elapsed: 0 };
  if (!Number.isFinite(strike) || strike <= 0) {
    return { ok: false, reason: 'twap_lock_feed', ...empty };
  }
  const closeMs = opts.closeUtc.getTime();
  if (!Number.isFinite(closeMs)) {
    return { ok: false, reason: 'twap_lock_feed', ...empty };
  }
  const leftover = twapLockSecondsLeft(opts.now, opts.closeUtc);
  const elapsed = twapLockElapsedCompleteSeconds(opts.now, opts.closeUtc);
  if (leftover <= 0) {
    return { ok: false, locked: false, banked: 0, needed, leftover: 0, elapsed, reason: 'twap_lock_too_late' };
  }
  const { startMs } = twapLockWindow(opts.closeUtc);
  const startSec = Math.floor(startMs / 1000);
  const bySec = printMap(opts.prints);
  let banked = 0;
  for (let i = 0; i < elapsed; i += 1) {
    const price = bySec.get(startSec + i);
    if (price == null) {
      return { ok: false, locked: false, banked, needed, leftover, elapsed, reason: 'twap_lock_feed' };
    }
    banked += price;
  }
  return {
    ok: true,
    locked: banked + 1e-9 >= needed,
    banked,
    needed,
    leftover,
    elapsed,
  };
}

export function twapLockGateConfig(cfg: AppConfig, maxAskUsd: number): AppConfig {
  const cushions = { ...cfg.cushions };
  for (const asset of TWAP_LOCK_ASSETS) {
    cushions[asset] = 0;
  }
  return {
    ...cfg,
    risk: {
      ...cfg.risk,
      max_entry_ask_usd: maxAskUsd,
      min_minutes_left: 0,
      min_minutes_elapsed: 0,
      smart_buy_enabled: false,
      chase_above_ask_usd: 0,
    },
    cushions,
  };
}

export function evaluateTwapLockEnter(opts: {
  lean: LeanSignal & CashOutQuotes & { close_utc?: string | Date | null };
  cfg: AppConfig;
  adminEnabled: boolean;
  prints?: TwapLockPrint[];
  series?: TwapLockSeriesResult;
  now?: Date;
  clockSkewSec?: number;
  openPositions?: number;
  dailyPnlUsd?: number;
  tradesToday?: number;
  assetTradesInWindow?: number;
  hasOpenOnTicker?: boolean;
  skipThinBid?: boolean;
  bidSize?: number | null;
}): GateResult {
  const now = opts.now || new Date();
  const risk = opts.cfg.risk as AppConfig['risk'] & {
    twap_lock_enabled?: boolean;
    twap_lock_assets?: string[];
    twap_lock_max_ask_usd?: number;
    cash_out_skip_thin_bid?: boolean;
  };
  if (!opts.adminEnabled) {
    return { ok: false, skip_reason: 'twap_lock_admin_off' };
  }
  if (risk.twap_lock_enabled !== true) {
    return { ok: false, skip_reason: 'twap_lock_off' };
  }
  if (!isTwapLockAsset(opts.lean.asset) || !isTwapLockAssetSelected(risk.twap_lock_assets, opts.lean.asset)) {
    return { ok: false, skip_reason: 'twap_lock_asset_off' };
  }
  if (opts.lean.phase === 'ended') {
    return { ok: false, skip_reason: 'window_ended' };
  }
  const closeUtc = resolveTwapCloseUtc(opts.lean, now);
  if (!closeUtc) {
    return { ok: false, skip_reason: 'twap_lock_feed' };
  }
  const skew = Number(opts.clockSkewSec);
  if (Number.isFinite(skew) && Math.abs(skew) > TWAP_LOCK_CLOCK_SKEW_MAX_SEC + 1e-9) {
    return { ok: false, skip_reason: 'twap_lock_feed' };
  }
  if (!isTwapLockLastMinute(now, closeUtc)) {
    return { ok: false, skip_reason: 'twap_lock_not_last_minute' };
  }
  const strike = Number(opts.lean.strike);
  if (!Number.isFinite(strike) || strike <= 0) {
    return { ok: false, skip_reason: 'twap_lock_feed' };
  }
  const series =
    opts.series ||
    evaluateTwapLockSeries({
      prints: opts.prints || [],
      closeUtc,
      now,
      strike,
    });
  if (!series.ok) {
    return { ok: false, skip_reason: series.reason || 'twap_lock_feed' };
  }
  if (!series.locked) {
    return { ok: false, skip_reason: 'twap_lock_not_locked' };
  }
  if (series.leftover <= 0) {
    return { ok: false, skip_reason: 'twap_lock_too_late' };
  }
  const maxAsk = normalizeTwapLockMaxAskUsd(risk.twap_lock_max_ask_usd);
  const ask = sideAskOf('YES', opts.lean);
  const askUsd = ticketUsd(ask);
  if (askUsd == null || askUsd > maxAsk + 1e-9) {
    return { ok: false, skip_reason: 'twap_lock_ask_rich' };
  }
  if (opts.hasOpenOnTicker) {
    return { ok: false, skip_reason: 'twap_lock_holding_other_path' };
  }

  const leanForGate: LeanSignal = {
    ...opts.lean,
    decision: 'YES',
    abs_gap: Number(opts.lean.abs_gap) || 0,
    minutes_left: 0,
    minutes_elapsed: Number(opts.lean.minutes_elapsed) || 0,
  };
  const gate = evaluateStaticGate(leanForGate, twapLockGateConfig(opts.cfg, maxAsk), {
    openPositions: opts.openPositions,
    dailyPnlUsd: opts.dailyPnlUsd,
    tradesToday: opts.tradesToday,
    assetTradesInWindow: opts.assetTradesInWindow,
  });
  if (!gate.ok) return gate;

  const thinOn = opts.skipThinBid || Boolean(risk.cash_out_skip_thin_bid);
  if (thinOn) {
    const need = Math.floor(Number(gate.count) || 0);
    if (opts.bidSize == null || !Number.isFinite(Number(opts.bidSize))) {
      return { ok: false, skip_reason: 'twap_lock_feed' };
    }
    if (need > 0 && Number(opts.bidSize) < need) {
      return { ok: false, skip_reason: 'twap_lock_thin_bid' };
    }
  }
  return gate;
}

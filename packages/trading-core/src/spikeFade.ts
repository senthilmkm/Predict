import { AppConfig, ASSETS_CATALOG, AssetKey } from './types';
import { evaluateStaticGate, GateResult, LeanSignal } from './gates';
import {
  CashOutQuotes,
  isCashOutThinBid,
  isOpenLiveFill,
  openFillsForTicker,
  sideAskOf,
  sideBidOf,
  ticketUsd,
} from './cashOut';
import { buildProtectSellOrder, inProtectSellGrace } from './protectSell';
import { resolveSkipThinBid } from './skipThinBid';
import { lastMinuteTwapOwns } from './lastMinute';
import { goldFadeMinutesLeft } from './goldFade';

export const SPIKE_FADE_START_MIN_DEFAULT = 2;
export const SPIKE_FADE_START_MIN_MIN = 1;
export const SPIKE_FADE_START_MIN_MAX = 4;
export const SPIKE_FADE_UNTIL_MIN_DEFAULT = 6;
export const SPIKE_FADE_UNTIL_MIN_MIN = 4;
export const SPIKE_FADE_UNTIL_MIN_MAX = 8;
export const SPIKE_FADE_EXP_MIN_DEFAULT = 0.75;
export const SPIKE_FADE_EXP_MIN_MIN = 0.7;
export const SPIKE_FADE_EXP_MIN_MAX = 0.85;
export const SPIKE_FADE_EXP_MAX_DEFAULT = 0.8;
export const SPIKE_FADE_EXP_MAX_MIN = 0.75;
export const SPIKE_FADE_EXP_MAX_MAX = 0.9;
export const SPIKE_FADE_CHEAP_MIN_DEFAULT = 0.2;
export const SPIKE_FADE_CHEAP_MIN_MIN = 0.15;
export const SPIKE_FADE_CHEAP_MIN_MAX = 0.3;
export const SPIKE_FADE_CHEAP_MAX_DEFAULT = 0.25;
export const SPIKE_FADE_CHEAP_MAX_MIN = 0.2;
export const SPIKE_FADE_CHEAP_MAX_MAX = 0.35;
export const SPIKE_FADE_TAKE_DEFAULT = 0.42;
export const SPIKE_FADE_TAKE_MIN = 0.35;
export const SPIKE_FADE_TAKE_MAX = 0.5;
export const SPIKE_FADE_STOP_DEFAULT = 0.1;
export const SPIKE_FADE_STOP_MIN = 0.05;
export const SPIKE_FADE_STOP_MAX = 0.15;
export const SPIKE_FADE_FLATTEN_DEFAULT = 3;
export const SPIKE_FADE_FLATTEN_MIN = 2;
export const SPIKE_FADE_FLATTEN_MAX = 5;
export const SPIKE_FADE_LOT_COUNT_DEFAULT = 1;
export const SPIKE_FADE_LOT_COUNT_MAX = 5;
export const SPIKE_FADE_GRACE_SEC = 5;

export type SpikeFadeSide = 'YES' | 'NO';
export type SpikeFadeExitKind =
  | 'none'
  | 'spike_fade_take'
  | 'spike_fade_stop'
  | 'spike_fade_thin_bid'
  | 'spike_fade_flatten';

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

export function normalizeSpikeFadeStartMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? SPIKE_FADE_START_MIN_DEFAULT), SPIKE_FADE_START_MIN_MIN, SPIKE_FADE_START_MIN_MAX)
  );
}

export function normalizeSpikeFadeUntilMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? SPIKE_FADE_UNTIL_MIN_DEFAULT), SPIKE_FADE_UNTIL_MIN_MIN, SPIKE_FADE_UNTIL_MIN_MAX)
  );
}

export function normalizeSpikeFadeExpensiveMinUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? SPIKE_FADE_EXP_MIN_DEFAULT), SPIKE_FADE_EXP_MIN_MIN, SPIKE_FADE_EXP_MIN_MAX),
    0.01
  );
}

export function normalizeSpikeFadeExpensiveMaxUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? SPIKE_FADE_EXP_MAX_DEFAULT), SPIKE_FADE_EXP_MAX_MIN, SPIKE_FADE_EXP_MAX_MAX),
    0.01
  );
}

export function normalizeSpikeFadeCheapMinUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? SPIKE_FADE_CHEAP_MIN_DEFAULT), SPIKE_FADE_CHEAP_MIN_MIN, SPIKE_FADE_CHEAP_MIN_MAX),
    0.01
  );
}

export function normalizeSpikeFadeCheapMaxUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? SPIKE_FADE_CHEAP_MAX_DEFAULT), SPIKE_FADE_CHEAP_MAX_MIN, SPIKE_FADE_CHEAP_MAX_MAX),
    0.01
  );
}

export function reconcileSpikeFadeBands(opts: {
  expensiveMin?: unknown;
  expensiveMax?: unknown;
  cheapMin?: unknown;
  cheapMax?: unknown;
}): { expensiveMin: number; expensiveMax: number; cheapMin: number; cheapMax: number } {
  const expensiveMin = normalizeSpikeFadeExpensiveMinUsd(opts.expensiveMin);
  const expensiveMax = Math.max(normalizeSpikeFadeExpensiveMaxUsd(opts.expensiveMax), expensiveMin);
  const cheapMin = normalizeSpikeFadeCheapMinUsd(opts.cheapMin);
  const cheapMax = Math.max(normalizeSpikeFadeCheapMaxUsd(opts.cheapMax), cheapMin);
  return { expensiveMin, expensiveMax, cheapMin, cheapMax };
}

export function normalizeSpikeFadeTakeAskUsd(raw: unknown): number {
  return snap(clamp(Number(raw ?? SPIKE_FADE_TAKE_DEFAULT), SPIKE_FADE_TAKE_MIN, SPIKE_FADE_TAKE_MAX), 0.01);
}

export function normalizeSpikeFadeStopAskUsd(raw: unknown): number {
  return snap(clamp(Number(raw ?? SPIKE_FADE_STOP_DEFAULT), SPIKE_FADE_STOP_MIN, SPIKE_FADE_STOP_MAX), 0.01);
}

export function normalizeSpikeFadeFlattenMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? SPIKE_FADE_FLATTEN_DEFAULT), SPIKE_FADE_FLATTEN_MIN, SPIKE_FADE_FLATTEN_MAX)
  );
}

export function normalizeSpikeFadeLotCount(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? SPIKE_FADE_LOT_COUNT_DEFAULT), 1, SPIKE_FADE_LOT_COUNT_MAX));
}

export function spikeFadeDefaultAssets(): string[] {
  return ASSETS_CATALOG.map((a) => a.key);
}

export function normalizeSpikeFadeAssets(raw: unknown): string[] {
  const allowed = spikeFadeDefaultAssets();
  const allowedSet = new Set(allowed);
  if (raw == null || !Array.isArray(raw)) return allowed;
  const out: string[] = [];
  for (const item of raw) {
    const k = String(item || '').trim();
    if (allowedSet.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function isSpikeFadeAssetSelected(assets: unknown, asset: string): boolean {
  return normalizeSpikeFadeAssets(assets).includes(String(asset));
}

export function isSpikeFadeEntryPath(raw: unknown): boolean {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim();
  return v === 'spike_fade' || v === 'spikefade' || v === 'spike-fade';
}

export function isSpikeFadeEnterPath(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assetEnabled: boolean;
  asset: string;
  assets?: unknown;
}): boolean {
  return Boolean(
    opts.adminEnabled &&
      opts.userEnabled &&
      opts.assetEnabled &&
      String(opts.asset || '').trim() &&
      isSpikeFadeAssetSelected(opts.assets, opts.asset)
  );
}

export function spikeFadeTwapOwns(opts: {
  twapAdminEnabled: boolean;
  twapUserEnabled: boolean;
  twapAssets: unknown;
  asset: string;
}): boolean {
  return lastMinuteTwapOwns(opts);
}

export function isSpikeFadeEnterWindow(opts: {
  minutesElapsed?: unknown;
  startMinutes?: unknown;
  untilMinutes?: unknown;
}): boolean {
  const elapsed = Number(opts.minutesElapsed);
  if (!Number.isFinite(elapsed)) return false;
  const start = normalizeSpikeFadeStartMinutes(opts.startMinutes);
  const until = Math.max(normalizeSpikeFadeUntilMinutes(opts.untilMinutes), start);
  return elapsed + 1e-9 >= start && elapsed <= until + 1e-9;
}

export function askInBand(ask: unknown, minUsd: number, maxUsd: number): boolean {
  const a = ticketUsd(ask);
  if (a == null || a >= 0.995) return false;
  return a + 1e-9 >= minUsd && a <= maxUsd + 1e-9;
}

export function pickSpikeFadeSide(opts: {
  yesAsk?: unknown;
  noAsk?: unknown;
  expensiveMin?: unknown;
  expensiveMax?: unknown;
  cheapMin?: unknown;
  cheapMax?: unknown;
}): { ok: true; decision: SpikeFadeSide; cheapAsk: number } | { ok: false; skip_reason: string } {
  const bands = reconcileSpikeFadeBands({
    expensiveMin: opts.expensiveMin,
    expensiveMax: opts.expensiveMax,
    cheapMin: opts.cheapMin,
    cheapMax: opts.cheapMax,
  });
  const yes = ticketUsd(opts.yesAsk);
  const no = ticketUsd(opts.noAsk);
  if (yes == null || no == null) return { ok: false, skip_reason: 'spike_fade_no_ask' };
  const yesExp = askInBand(yes, bands.expensiveMin, bands.expensiveMax);
  const noExp = askInBand(no, bands.expensiveMin, bands.expensiveMax);
  const yesCheap = askInBand(yes, bands.cheapMin, bands.cheapMax);
  const noCheap = askInBand(no, bands.cheapMin, bands.cheapMax);
  if (yesExp && noCheap) return { ok: true, decision: 'NO', cheapAsk: no };
  if (noExp && yesCheap) return { ok: true, decision: 'YES', cheapAsk: yes };
  if (!yesExp && !noExp) return { ok: false, skip_reason: 'spike_fade_no_spike' };
  return { ok: false, skip_reason: 'spike_fade_cheap_off_band' };
}

export function tickerHasOpenSpikeFade(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some((t) =>
    isSpikeFadeEntryPath((t as { entryPath?: unknown; entry_path?: unknown }).entryPath ?? (t as { entry_path?: unknown }).entry_path)
  );
}

export function tickerHasOpenOtherThanSpikeFade(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some(
    (t) => !isSpikeFadeEntryPath((t as { entryPath?: unknown; entry_path?: unknown }).entryPath ?? (t as { entry_path?: unknown }).entry_path)
  );
}

export function spikeFadeGateConfig(cfg: AppConfig, cheapMax: number, lotCount: number, flatten: number): AppConfig {
  const cushions = { ...cfg.cushions };
  for (const key of Object.keys(cushions) as AssetKey[]) {
    cushions[key] = 0;
  }
  const clipUsd = Math.max(0.01, lotCount * cheapMax);
  return {
    ...cfg,
    risk: {
      ...cfg.risk,
      max_entry_ask_usd: cheapMax,
      min_minutes_left: flatten,
      min_minutes_elapsed: 0,
      smart_buy_enabled: false,
      chase_above_ask_usd: 0,
      time_in_force: 'immediate_or_cancel',
      fixed_dollars_per_trade: clipUsd,
      max_dollars_per_trade: clipUsd,
      min_dollars_per_trade: 0.01,
    },
    cushions,
  };
}

export function evaluateSpikeFadeEnter(opts: {
  lean: LeanSignal & CashOutQuotes;
  cfg: AppConfig;
  adminEnabled: boolean;
  twapAdminEnabled?: boolean;
  openPositions?: number;
  dailyPnlUsd?: number;
  tradesToday?: number;
  assetTradesInWindow?: number;
  hasOpenOnTicker?: boolean;
  lastMinuteOwnsNewBuys?: boolean;
  skipThinBid?: boolean;
  bidSize?: number | null;
}): GateResult {
  const risk = opts.cfg.risk as AppConfig['risk'] & {
    spike_fade_enabled?: boolean;
    spike_fade_start_minutes?: number;
    spike_fade_until_minutes?: number;
    spike_fade_expensive_min_usd?: number;
    spike_fade_expensive_max_usd?: number;
    spike_fade_cheap_min_usd?: number;
    spike_fade_cheap_max_usd?: number;
    spike_fade_take_ask_usd?: number;
    spike_fade_stop_ask_usd?: number;
    spike_fade_flatten_minutes?: number;
    spike_fade_lot_count?: number;
    spike_fade_assets?: string[];
    spike_fade_skip_thin_bid?: boolean;
    twap_lock_enabled?: boolean;
    twap_lock_assets?: string[];
  };
  if (!opts.adminEnabled) return { ok: false, skip_reason: 'spike_fade_admin_off' };
  if (risk.spike_fade_enabled !== true) return { ok: false, skip_reason: 'spike_fade_off' };
  if (!opts.cfg.assets_enabled?.[opts.lean.asset]) return { ok: false, skip_reason: 'asset_disabled' };
  if (!isSpikeFadeAssetSelected(risk.spike_fade_assets, opts.lean.asset)) {
    return { ok: false, skip_reason: 'spike_fade_asset_off' };
  }
  if (
    spikeFadeTwapOwns({
      twapAdminEnabled: opts.twapAdminEnabled === true,
      twapUserEnabled: risk.twap_lock_enabled === true,
      twapAssets: risk.twap_lock_assets,
      asset: opts.lean.asset,
    })
  ) {
    return { ok: false, skip_reason: 'spike_fade_twap_owns' };
  }
  if (opts.lean.phase === 'ended') return { ok: false, skip_reason: 'window_ended' };
  if (opts.lastMinuteOwnsNewBuys) return { ok: false, skip_reason: 'spike_fade_last_minute_owns' };
  if (opts.hasOpenOnTicker) return { ok: false, skip_reason: 'spike_fade_holding_other_path' };
  if (
    !isSpikeFadeEnterWindow({
      minutesElapsed: opts.lean.minutes_elapsed,
      startMinutes: risk.spike_fade_start_minutes,
      untilMinutes: risk.spike_fade_until_minutes,
    })
  ) {
    return { ok: false, skip_reason: 'spike_fade_outside_window' };
  }
  const flatten = normalizeSpikeFadeFlattenMinutes(risk.spike_fade_flatten_minutes);
  if (goldFadeMinutesLeft(opts.lean) <= flatten + 1e-9) {
    return { ok: false, skip_reason: 'spike_fade_too_late' };
  }
  const picked = pickSpikeFadeSide({
    yesAsk: opts.lean.yes_ask,
    noAsk: opts.lean.no_ask,
    expensiveMin: risk.spike_fade_expensive_min_usd,
    expensiveMax: risk.spike_fade_expensive_max_usd,
    cheapMin: risk.spike_fade_cheap_min_usd,
    cheapMax: risk.spike_fade_cheap_max_usd,
  });
  if (!picked.ok) return { ok: false, skip_reason: picked.skip_reason };
  const lotCount = normalizeSpikeFadeLotCount(risk.spike_fade_lot_count);
  const bands = reconcileSpikeFadeBands({
    expensiveMin: Number(risk.spike_fade_expensive_min_usd),
    expensiveMax: Number(risk.spike_fade_expensive_max_usd),
    cheapMin: Number(risk.spike_fade_cheap_min_usd),
    cheapMax: Number(risk.spike_fade_cheap_max_usd),
  });
  const leanForGate: LeanSignal = {
    ...opts.lean,
    decision: picked.decision,
    abs_gap: Number(opts.lean.abs_gap) || 0,
    minutes_left: Number(opts.lean.minutes_left) || 0,
    minutes_elapsed: Number(opts.lean.minutes_elapsed) || 0,
  };
  const gate = evaluateStaticGate(leanForGate, spikeFadeGateConfig(opts.cfg, bands.cheapMax, lotCount, flatten), {
    openPositions: opts.openPositions,
    dailyPnlUsd: opts.dailyPnlUsd,
    tradesToday: opts.tradesToday,
    assetTradesInWindow: opts.assetTradesInWindow,
  });
  if (!gate.ok) return gate;
  const thinOn = resolveSkipThinBid(risk, 'spike_fade', opts.skipThinBid);
  if (thinOn) {
    const need = Math.floor(Number(gate.count) || 0);
    if (opts.bidSize == null || !Number.isFinite(Number(opts.bidSize))) {
      return { ok: false, skip_reason: 'spike_fade_thin_bid' };
    }
    if (need > 0 && Number(opts.bidSize) < need) {
      return { ok: false, skip_reason: 'spike_fade_thin_bid' };
    }
  }
  return { ...gate, decision: picked.decision };
}

export function evaluateSpikeFadeExit(opts: {
  heldSide: SpikeFadeSide | string;
  quotes: CashOutQuotes;
  takeAskUsd?: unknown;
  stopAskUsd?: unknown;
  flattenMinutes?: unknown;
  lean: { phase?: string; minutes_left?: number; minutes_remaining?: number };
  filledAt?: string | Date | number | null;
  now?: Date;
  skipThinBid?: boolean;
  bidSize?: number | null;
  needCount?: number | null;
}): { sell: boolean; kind: SpikeFadeExitKind; reason: string } {
  const held = String(opts.heldSide || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  const take = normalizeSpikeFadeTakeAskUsd(opts.takeAskUsd);
  const stop = normalizeSpikeFadeStopAskUsd(opts.stopAskUsd);
  const flatten = normalizeSpikeFadeFlattenMinutes(opts.flattenMinutes);
  const bid = sideBidOf(held, opts.quotes);
  const ask = sideAskOf(held, opts.quotes);
  if (opts.lean.phase === 'ended') {
    return { sell: true, kind: 'spike_fade_flatten', reason: 'window_ended' };
  }
  if (
    inProtectSellGrace({
      filledAt: opts.filledAt,
      graceSeconds: SPIKE_FADE_GRACE_SEC,
      now: opts.now,
    })
  ) {
    return { sell: false, kind: 'none', reason: 'grace_after_fill' };
  }
  if (bid != null && bid + 1e-9 >= take) {
    return { sell: true, kind: 'spike_fade_take', reason: 'spike_fade_take' };
  }
  if (ask != null && ask <= stop + 1e-9) {
    return { sell: true, kind: 'spike_fade_stop', reason: 'spike_fade_stop' };
  }
  if (opts.skipThinBid && isCashOutThinBid(opts.bidSize, opts.needCount)) {
    return { sell: true, kind: 'spike_fade_thin_bid', reason: 'thin_bid' };
  }
  if (goldFadeMinutesLeft(opts.lean) <= flatten + 1e-9) {
    return { sell: true, kind: 'spike_fade_flatten', reason: 'flatten_minutes' };
  }
  return { sell: false, kind: 'none', reason: 'spike_fade_hold' };
}

export function buildSpikeFadeSellOrder(opts: {
  heldSide: SpikeFadeSide | string;
  fillCount: number;
  quotes: CashOutQuotes;
  slippageUsd?: number;
}) {
  return buildProtectSellOrder({
    heldSide: String(opts.heldSide || '').toUpperCase() === 'NO' ? 'NO' : 'YES',
    fillCount: opts.fillCount,
    yesBid: opts.quotes.yes_bid,
    yesAsk: opts.quotes.yes_ask,
    slippageUsd: opts.slippageUsd,
  });
}

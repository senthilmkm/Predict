import { AppConfig, ASSETS_CATALOG, AssetKey } from './types';
import { capGateLotCount, evaluateStaticGate, GateResult, LeanSignal } from './gates';
import {
  CashOutQuotes,
  isOpenLiveFill,
  openFillsForTicker,
  sideAskOf,
  sideBidOf,
  ticketUsd,
} from './cashOut';
import { buildProtectSellOrder, inProtectSellGrace } from './protectSell';
import { lastMinuteTwapOwns } from './lastMinute';
import { goldFadeMinutesLeft } from './goldFade';

export const CHEAP_LOOP_START_DEFAULT = 2;
export const CHEAP_LOOP_START_MIN = 1;
export const CHEAP_LOOP_START_MAX = 20;
export const CHEAP_LOOP_FLATTEN_DEFAULT = 5;
export const CHEAP_LOOP_FLATTEN_MIN = 3;
export const CHEAP_LOOP_FLATTEN_MAX = 10;
export const CHEAP_LOOP_CHEAP_MAX_DEFAULT = 0.4;
export const CHEAP_LOOP_CHEAP_MAX_MIN = 0.25;
export const CHEAP_LOOP_CHEAP_MAX_MAX = 0.45;
export const CHEAP_LOOP_MIN_GAP_DEFAULT = 0.1;
export const CHEAP_LOOP_MIN_GAP_MIN = 0.08;
export const CHEAP_LOOP_MIN_GAP_MAX = 0.2;
export const CHEAP_LOOP_TAKE_DEFAULT = 0.05;
export const CHEAP_LOOP_TAKE_MIN = 0.03;
export const CHEAP_LOOP_TAKE_MAX = 0.08;
export const CHEAP_LOOP_STOP_DEFAULT = 0.06;
export const CHEAP_LOOP_STOP_MIN = 0.05;
export const CHEAP_LOOP_STOP_MAX = 0.12;
export const CHEAP_LOOP_MIN_HOLD_DEFAULT = 1;
export const CHEAP_LOOP_MIN_HOLD_MIN = 1;
export const CHEAP_LOOP_MIN_HOLD_MAX = 8;
export const CHEAP_LOOP_COOLDOWN_DEFAULT = 2;
export const CHEAP_LOOP_COOLDOWN_MIN = 1;
export const CHEAP_LOOP_COOLDOWN_MAX = 10;
export const CHEAP_LOOP_CYCLES_DEFAULT = 1;
export const CHEAP_LOOP_CYCLES_MIN = 1;
export const CHEAP_LOOP_CYCLES_MAX = 5;
export const CHEAP_LOOP_LOT_COUNT_DEFAULT = 1;
export const CHEAP_LOOP_LOT_COUNT_MAX = 5;
export const CHEAP_LOOP_GRACE_SEC = 5;
export const CHEAP_LOOP_ASK_CEILING = 0.995;

export type CheapLoopSide = 'YES' | 'NO';
export type CheapLoopExitKind =
  | 'none'
  | 'cheap_loop_take'
  | 'cheap_loop_stop'
  | 'cheap_loop_flatten';

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

export function normalizeCheapLoopStartMinutes(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? CHEAP_LOOP_START_DEFAULT), CHEAP_LOOP_START_MIN, CHEAP_LOOP_START_MAX));
}

export function normalizeCheapLoopFlattenMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? CHEAP_LOOP_FLATTEN_DEFAULT), CHEAP_LOOP_FLATTEN_MIN, CHEAP_LOOP_FLATTEN_MAX)
  );
}

export function normalizeCheapLoopCheapMaxAskUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? CHEAP_LOOP_CHEAP_MAX_DEFAULT), CHEAP_LOOP_CHEAP_MAX_MIN, CHEAP_LOOP_CHEAP_MAX_MAX),
    0.01
  );
}

export function normalizeCheapLoopMinGapUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? CHEAP_LOOP_MIN_GAP_DEFAULT), CHEAP_LOOP_MIN_GAP_MIN, CHEAP_LOOP_MIN_GAP_MAX),
    0.01
  );
}

export function normalizeCheapLoopTakeUsd(raw: unknown): number {
  return snap(clamp(Number(raw ?? CHEAP_LOOP_TAKE_DEFAULT), CHEAP_LOOP_TAKE_MIN, CHEAP_LOOP_TAKE_MAX), 0.01);
}

export function normalizeCheapLoopStopUsd(raw: unknown): number {
  return snap(clamp(Number(raw ?? CHEAP_LOOP_STOP_DEFAULT), CHEAP_LOOP_STOP_MIN, CHEAP_LOOP_STOP_MAX), 0.01);
}

/** Take must stay strictly below Stop. Cut Take; never raise Stop. */
export function reconcileCheapLoopTakeStop(opts: {
  takeUsd?: unknown;
  stopUsd?: unknown;
}): { takeUsd: number; stopUsd: number } {
  const stopUsd = normalizeCheapLoopStopUsd(opts.stopUsd);
  let takeUsd = normalizeCheapLoopTakeUsd(opts.takeUsd);
  if (takeUsd + 1e-9 >= stopUsd) {
    takeUsd = snap(clamp(stopUsd - 0.01, CHEAP_LOOP_TAKE_MIN, CHEAP_LOOP_TAKE_MAX), 0.01);
    if (takeUsd + 1e-9 >= stopUsd) {
      takeUsd = CHEAP_LOOP_TAKE_MIN;
    }
  }
  return { takeUsd, stopUsd };
}

export function normalizeCheapLoopMinHoldMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? CHEAP_LOOP_MIN_HOLD_DEFAULT), CHEAP_LOOP_MIN_HOLD_MIN, CHEAP_LOOP_MIN_HOLD_MAX)
  );
}

export function normalizeCheapLoopCooldownMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? CHEAP_LOOP_COOLDOWN_DEFAULT), CHEAP_LOOP_COOLDOWN_MIN, CHEAP_LOOP_COOLDOWN_MAX)
  );
}

export function normalizeCheapLoopCycles(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? CHEAP_LOOP_CYCLES_DEFAULT), CHEAP_LOOP_CYCLES_MIN, CHEAP_LOOP_CYCLES_MAX));
}

export function normalizeCheapLoopLotCount(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? CHEAP_LOOP_LOT_COUNT_DEFAULT), 1, CHEAP_LOOP_LOT_COUNT_MAX));
}

export function normalizeCheapLoopAssets(raw: unknown): string[] {
  const allowed = new Set(ASSETS_CATALOG.map((a) => a.key));
  if (raw == null || !Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const k = String(item || '').trim();
    if (allowed.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function isCheapLoopAssetSelected(assets: unknown, asset: string): boolean {
  return normalizeCheapLoopAssets(assets).includes(String(asset));
}

export function isCheapLoopEntryPath(raw: unknown): boolean {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim();
  return v === 'cheap_loop' || v === 'cheaploop' || v === 'cheap-loop';
}

export function isCheapLoopEnterPath(opts: {
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
      isCheapLoopAssetSelected(opts.assets, opts.asset)
  );
}

export function cheapLoopTwapOwns(opts: {
  twapAdminEnabled: boolean;
  twapUserEnabled: boolean;
  twapAssets: unknown;
  asset: string;
}): boolean {
  return lastMinuteTwapOwns(opts);
}

export function isCheapLoopEnterWindow(opts: {
  minutesElapsed?: unknown;
  minutesLeft?: unknown;
  startMinutes?: unknown;
  flattenMinutes?: unknown;
}): boolean {
  const elapsed = Number(opts.minutesElapsed);
  if (!Number.isFinite(elapsed)) return false;
  const start = normalizeCheapLoopStartMinutes(opts.startMinutes);
  if (elapsed + 1e-9 < start) return false;
  const left = Number(opts.minutesLeft);
  if (!Number.isFinite(left)) return false;
  const flatten = normalizeCheapLoopFlattenMinutes(opts.flattenMinutes);
  return left > flatten + 1e-9;
}

export function pickCheapLoopSide(opts: {
  yesAsk?: unknown;
  noAsk?: unknown;
  cheapMaxAskUsd?: unknown;
  minGapUsd?: unknown;
}): { ok: true; decision: CheapLoopSide; cheapAsk: number } | { ok: false; skip_reason: string } {
  const yes = ticketUsd(opts.yesAsk);
  const no = ticketUsd(opts.noAsk);
  if (yes == null || no == null) return { ok: false, skip_reason: 'cheap_loop_no_ask' };
  if (yes >= CHEAP_LOOP_ASK_CEILING || no >= CHEAP_LOOP_ASK_CEILING) {
    return { ok: false, skip_reason: 'cheap_loop_ask_rich' };
  }
  if (Math.abs(yes - no) < 1e-9) return { ok: false, skip_reason: 'cheap_loop_no_cheap_side' };
  const minGap = normalizeCheapLoopMinGapUsd(opts.minGapUsd);
  if (Math.abs(yes - no) + 1e-9 < minGap) return { ok: false, skip_reason: 'cheap_loop_no_favorite' };
  const cheapMax = normalizeCheapLoopCheapMaxAskUsd(opts.cheapMaxAskUsd);
  const decision: CheapLoopSide = yes < no ? 'YES' : 'NO';
  const cheapAsk = decision === 'YES' ? yes : no;
  if (cheapAsk > cheapMax + 1e-9) return { ok: false, skip_reason: 'cheap_loop_ask_rich' };
  return { ok: true, decision, cheapAsk };
}

type CheapLoopTradeRow = {
  ticker?: string;
  market_ticker?: string;
  entryPath?: unknown;
  entry_path?: unknown;
  outcome?: unknown;
  status?: unknown;
  protectExitOrderId?: unknown;
  settledAt?: unknown;
  executedAt?: unknown;
};

function tickerOf(t: CheapLoopTradeRow): string {
  return String(t.ticker || t.market_ticker || '').trim();
}

function entryOf(t: CheapLoopTradeRow): unknown {
  return t.entryPath ?? t.entry_path;
}

export function isCheapLoopCompletedExit(trade: CheapLoopTradeRow): boolean {
  if (!isCheapLoopEntryPath(entryOf(trade))) return false;
  const outcome = String(trade.outcome || '').toLowerCase();
  if (outcome === 'exited') return true;
  return Boolean(trade.protectExitOrderId) && String(trade.status || '').toUpperCase() === 'SETTLED';
}

export function cheapLoopExitsForTicker(trades: CheapLoopTradeRow[], marketTicker: string): number {
  const tkr = String(marketTicker || '').trim();
  if (!tkr) return 0;
  return (trades || []).filter((t) => tickerOf(t) === tkr && isCheapLoopCompletedExit(t)).length;
}

export function cheapLoopLastExitAt(trades: CheapLoopTradeRow[], marketTicker: string): Date | null {
  const tkr = String(marketTicker || '').trim();
  if (!tkr) return null;
  let latest = 0;
  for (const t of trades || []) {
    if (tickerOf(t) !== tkr || !isCheapLoopCompletedExit(t)) continue;
    const raw = t.settledAt ?? t.executedAt ?? (t as { at?: unknown }).at;
    const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw || ''));
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  }
  return latest > 0 ? new Date(latest) : null;
}

export function cheapLoopCooldownRemainingSec(opts: {
  trades: CheapLoopTradeRow[];
  marketTicker: string;
  cooldownMinutes?: unknown;
  now?: Date;
}): number {
  const last = cheapLoopLastExitAt(opts.trades, opts.marketTicker);
  if (!last) return 0;
  const coolMs = normalizeCheapLoopCooldownMinutes(opts.cooldownMinutes) * 60_000;
  const now = (opts.now || new Date()).getTime();
  return Math.max(0, Math.ceil((last.getTime() + coolMs - now) / 1000));
}

export function isCheapLoopCooldown(opts: {
  trades: CheapLoopTradeRow[];
  marketTicker: string;
  cooldownMinutes?: unknown;
  now?: Date;
}): boolean {
  return cheapLoopCooldownRemainingSec(opts) > 0;
}

/** Spike / Step / Pair / Auto sit out while Cheap loop is cooling down with cycles left. */
export function cheapLoopCooldownOwnsTicker(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assetEnabled: boolean;
  asset: string;
  assets?: unknown;
  trades: CheapLoopTradeRow[];
  marketTicker: string;
  cooldownMinutes?: unknown;
  cycles?: unknown;
  flattenMinutes?: unknown;
  lean: { phase?: string; minutes_left?: number; minutes_remaining?: number };
  now?: Date;
}): boolean {
  if (
    !isCheapLoopEnterPath({
      adminEnabled: opts.adminEnabled,
      userEnabled: opts.userEnabled,
      assetEnabled: opts.assetEnabled,
      asset: opts.asset,
      assets: opts.assets,
    })
  ) {
    return false;
  }
  if (opts.lean.phase === 'ended') return false;
  if (goldFadeMinutesLeft(opts.lean) <= normalizeCheapLoopFlattenMinutes(opts.flattenMinutes) + 1e-9) {
    return false;
  }
  const used = cheapLoopExitsForTicker(opts.trades, opts.marketTicker);
  if (used >= normalizeCheapLoopCycles(opts.cycles)) return false;
  return isCheapLoopCooldown({
    trades: opts.trades,
    marketTicker: opts.marketTicker,
    cooldownMinutes: opts.cooldownMinutes,
    now: opts.now,
  });
}

export function tickerHasOpenCheapLoop(
  trades: Array<CheapLoopTradeRow & Parameters<typeof isOpenLiveFill>[0]>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some((t) =>
    isCheapLoopEntryPath(t.entryPath ?? t.entry_path)
  );
}

export function tickerHasOpenOtherThanCheapLoop(
  trades: Array<CheapLoopTradeRow & Parameters<typeof isOpenLiveFill>[0]>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some(
    (t) => !isCheapLoopEntryPath(t.entryPath ?? t.entry_path)
  );
}

export function tickerHasAnyOpenFill(
  trades: Array<{ ticker?: string; market_ticker?: string } & Parameters<typeof isOpenLiveFill>[0]>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).length > 0;
}

export function cheapLoopGateConfig(cfg: AppConfig, cheapMax: number, lotCount: number, flatten: number): AppConfig {
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

export function evaluateCheapLoopEnter(opts: {
  lean: LeanSignal & CashOutQuotes;
  cfg: AppConfig;
  adminEnabled: boolean;
  twapAdminEnabled?: boolean;
  openPositions?: number;
  dailyPnlUsd?: number;
  tradesToday?: number;
  hasOpenOnTicker?: boolean;
  alreadyHolding?: boolean;
  lastMinuteOwnsNewBuys?: boolean;
  cyclesUsed?: number;
  inCooldown?: boolean;
  skipThinBid?: boolean;
  bidSize?: number | null;
}): GateResult {
  const risk = opts.cfg.risk as AppConfig['risk'] & {
    cheap_loop_enabled?: boolean;
    cheap_loop_start_minutes?: number;
    cheap_loop_flatten_minutes?: number;
    cheap_loop_cheap_max_ask_usd?: number;
    cheap_loop_min_gap_usd?: number;
    cheap_loop_take_usd?: number;
    cheap_loop_stop_usd?: number;
    cheap_loop_lot_count?: number;
    cheap_loop_cycles?: number;
    cheap_loop_assets?: string[];
    cheap_loop_skip_thin_bid?: boolean;
    twap_lock_enabled?: boolean;
    twap_lock_assets?: string[];
  };
  if (!opts.adminEnabled) return { ok: false, skip_reason: 'cheap_loop_admin_off' };
  if (risk.cheap_loop_enabled !== true) return { ok: false, skip_reason: 'cheap_loop_off' };
  if (!opts.cfg.assets_enabled?.[opts.lean.asset]) return { ok: false, skip_reason: 'asset_disabled' };
  if (!isCheapLoopAssetSelected(risk.cheap_loop_assets, opts.lean.asset)) {
    return { ok: false, skip_reason: 'cheap_loop_asset_off' };
  }
  if (
    cheapLoopTwapOwns({
      twapAdminEnabled: opts.twapAdminEnabled === true,
      twapUserEnabled: risk.twap_lock_enabled === true,
      twapAssets: risk.twap_lock_assets,
      asset: opts.lean.asset,
    })
  ) {
    return { ok: false, skip_reason: 'cheap_loop_twap_owns' };
  }
  if (opts.lean.phase === 'ended') return { ok: false, skip_reason: 'window_ended' };
  if (opts.lastMinuteOwnsNewBuys) return { ok: false, skip_reason: 'cheap_loop_last_minute_owns' };
  if (opts.alreadyHolding) return { ok: false, skip_reason: 'cheap_loop_holding' };
  if (opts.hasOpenOnTicker) return { ok: false, skip_reason: 'cheap_loop_holding_other_path' };
  const flatten = normalizeCheapLoopFlattenMinutes(risk.cheap_loop_flatten_minutes);
  if (
    !isCheapLoopEnterWindow({
      minutesElapsed: opts.lean.minutes_elapsed,
      minutesLeft: goldFadeMinutesLeft(opts.lean),
      startMinutes: risk.cheap_loop_start_minutes,
      flattenMinutes: flatten,
    })
  ) {
    const elapsed = Number(opts.lean.minutes_elapsed);
    const start = normalizeCheapLoopStartMinutes(risk.cheap_loop_start_minutes);
    if (!Number.isFinite(elapsed) || elapsed + 1e-9 < start) {
      return { ok: false, skip_reason: 'cheap_loop_outside_window' };
    }
    return { ok: false, skip_reason: 'cheap_loop_too_late' };
  }
  const cycles = normalizeCheapLoopCycles(risk.cheap_loop_cycles);
  if ((opts.cyclesUsed ?? 0) >= cycles) return { ok: false, skip_reason: 'cheap_loop_cycles' };
  if (opts.inCooldown) return { ok: false, skip_reason: 'cheap_loop_cooldown' };
  const picked = pickCheapLoopSide({
    yesAsk: opts.lean.yes_ask,
    noAsk: opts.lean.no_ask,
    cheapMaxAskUsd: risk.cheap_loop_cheap_max_ask_usd,
    minGapUsd: risk.cheap_loop_min_gap_usd,
  });
  if (!picked.ok) return { ok: false, skip_reason: picked.skip_reason };
  const lotCount = normalizeCheapLoopLotCount(risk.cheap_loop_lot_count);
  const cheapMax = normalizeCheapLoopCheapMaxAskUsd(risk.cheap_loop_cheap_max_ask_usd);
  const leanForGate: LeanSignal = {
    ...opts.lean,
    decision: picked.decision,
    abs_gap: Number(opts.lean.abs_gap) || 0,
    minutes_left: Number(opts.lean.minutes_left) || 0,
    minutes_elapsed: Number(opts.lean.minutes_elapsed) || 0,
  };
  const gate = evaluateStaticGate(leanForGate, cheapLoopGateConfig(opts.cfg, cheapMax, lotCount, flatten), {
    openPositions: opts.openPositions,
    dailyPnlUsd: opts.dailyPnlUsd,
    tradesToday: opts.tradesToday,
    assetTradesInWindow: 0,
  });
  if (!gate.ok) return gate;
  const capped = capGateLotCount(gate, lotCount);
  if (!capped.ok) return capped;
  const thinOn = opts.skipThinBid === true || risk.cheap_loop_skip_thin_bid === true;
  if (thinOn) {
    const need = Math.floor(Number(capped.count) || 0);
    if (opts.bidSize == null || !Number.isFinite(Number(opts.bidSize))) {
      return { ok: false, skip_reason: 'cheap_loop_thin_bid' };
    }
    if (need > 0 && Number(opts.bidSize) < need) {
      return { ok: false, skip_reason: 'cheap_loop_thin_bid' };
    }
  }
  return { ...capped, decision: picked.decision };
}

export function evaluateCheapLoopExit(opts: {
  heldSide: CheapLoopSide | string;
  quotes: CashOutQuotes;
  fillUsd?: unknown;
  takeUsd?: unknown;
  stopUsd?: unknown;
  flattenMinutes?: unknown;
  minHoldMinutes?: unknown;
  lean: { phase?: string; minutes_left?: number; minutes_remaining?: number };
  filledAt?: string | Date | number | null;
  now?: Date;
}): { sell: boolean; kind: CheapLoopExitKind; reason: string } {
  const held = String(opts.heldSide || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  const bands = reconcileCheapLoopTakeStop({ takeUsd: opts.takeUsd, stopUsd: opts.stopUsd });
  const flatten = normalizeCheapLoopFlattenMinutes(opts.flattenMinutes);
  const minHoldMs = normalizeCheapLoopMinHoldMinutes(opts.minHoldMinutes) * 60_000;
  const fill = ticketUsd(opts.fillUsd);
  const bid = sideBidOf(held, opts.quotes);
  const ask = sideAskOf(held, opts.quotes);
  const rawAsk = Number(held === 'NO' ? opts.quotes.no_ask : opts.quotes.yes_ask);
  const left = goldFadeMinutesLeft(opts.lean);
  if (
    opts.lean.phase === 'ended' ||
    left <= flatten + 1e-9 ||
    (Number.isFinite(rawAsk) && rawAsk + 1e-9 >= CHEAP_LOOP_ASK_CEILING)
  ) {
    return { sell: true, kind: 'cheap_loop_flatten', reason: 'cheap_loop_flatten' };
  }
  if (
    inProtectSellGrace({
      filledAt: opts.filledAt,
      graceSeconds: CHEAP_LOOP_GRACE_SEC,
      now: opts.now,
    })
  ) {
    return { sell: false, kind: 'none', reason: 'grace_after_fill' };
  }
  if (fill != null && ask != null && ask <= fill - bands.stopUsd + 1e-9) {
    return { sell: true, kind: 'cheap_loop_stop', reason: 'cheap_loop_stop' };
  }
  const filledAt = opts.filledAt instanceof Date ? opts.filledAt.getTime() : Date.parse(String(opts.filledAt || ''));
  const nowMs = (opts.now || new Date()).getTime();
  const minHoldDone = Number.isFinite(filledAt) ? nowMs - filledAt >= minHoldMs : true;
  if (minHoldDone && fill != null && bid != null && bid + 1e-9 >= fill + bands.takeUsd) {
    return { sell: true, kind: 'cheap_loop_take', reason: 'cheap_loop_take' };
  }
  return { sell: false, kind: 'none', reason: 'cheap_loop_hold' };
}

export function buildCheapLoopSellOrder(opts: {
  heldSide: CheapLoopSide | string;
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

export function cheapLoopHoldingWatchText(takeUsd?: unknown): string {
  const take = reconcileCheapLoopTakeStop({ takeUsd, stopUsd: CHEAP_LOOP_STOP_DEFAULT }).takeUsd;
  return `Cheap loop holding · take +${Math.round(take * 100)}¢`;
}

export function cheapLoopCooldownWatchText(remainingSec: number): string {
  return `Cheap loop cooldown · ${Math.max(0, Math.round(remainingSec))}s`;
}

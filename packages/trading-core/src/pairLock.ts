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

export const PAIR_LOCK_START_MIN_DEFAULT = 2;
export const PAIR_LOCK_START_MIN_MIN = 1;
export const PAIR_LOCK_START_MIN_MAX = 8;
export const PAIR_LOCK_UNTIL_MIN_DEFAULT = 10;
export const PAIR_LOCK_UNTIL_MIN_MIN = 6;
export const PAIR_LOCK_UNTIL_MIN_MAX = 14;
export const PAIR_LOCK_RUNNER_MAX_ASK_DEFAULT = 0.6;
export const PAIR_LOCK_RUNNER_MAX_ASK_MIN = 0.4;
export const PAIR_LOCK_RUNNER_MAX_ASK_MAX = 0.7;
export const PAIR_LOCK_MIN_LOCK_DEFAULT = 0.05;
export const PAIR_LOCK_MIN_LOCK_MIN = 0.02;
export const PAIR_LOCK_MIN_LOCK_MAX = 0.15;
export const PAIR_LOCK_FLATTEN_DEFAULT = 3;
export const PAIR_LOCK_FLATTEN_MIN = 2;
export const PAIR_LOCK_FLATTEN_MAX = 5;
export const PAIR_LOCK_RUNNER_STOP_DEFAULT = 0.1;
export const PAIR_LOCK_RUNNER_STOP_MIN = 0;
export const PAIR_LOCK_RUNNER_STOP_MAX = 0.2;
export const PAIR_LOCK_LOT_COUNT_DEFAULT = 1;
export const PAIR_LOCK_LOT_COUNT_MAX = 5;
/** Extra pairs after the first. 0 = first pair only. 3 = 3 more (4 pairs total). */
export const PAIR_LOCK_ADD_PAIRS_DEFAULT = 0;
export const PAIR_LOCK_ADD_PAIRS_MAX = 3;
export const PAIR_LOCK_GRACE_SEC = 5;

export type PairLockSide = 'YES' | 'NO';
export type PairLockExitKind = 'none' | 'pair_lock_flatten' | 'pair_lock_thin_bid' | 'pair_lock_runner_stop';
export type PairLockWatchKind =
  | 'none'
  | 'hedge'
  | 'flatten'
  | 'thin_bid'
  | 'runner_stop'
  | 'hold_locked'
  | 'stack'
  | 'stack_finish'
  | 'stack_dump';

export type PairLockTrade = {
  ticker?: string;
  market_ticker?: string;
  entryPath?: unknown;
  entry_path?: unknown;
  decision?: unknown;
  executedAt?: string | Date | number | null;
  payPrice?: unknown;
  pay_price?: unknown;
  price?: unknown;
  fillCount?: number | null;
  fill_count?: number | null;
  dryRun?: boolean;
  dry_run?: boolean;
  status?: string;
  outcome?: string | null;
};

export type PairLockLotState = {
  runnerSide: PairLockSide | null;
  runnerFillUsd: number | null;
  runnerCount: number;
  runnerFilledAt: string | Date | number | null;
  hedgeSide: PairLockSide | null;
  hedgeFillUsd: number | null;
  hedgeCount: number;
  locked: boolean;
  unmatched: boolean;
  matchedCount?: number;
  extraSide?: PairLockSide | null;
  extraCount?: number;
  extraFillUsd?: number | null;
  extraFilledAt?: string | Date | number | null;
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

function sideOf(raw: unknown): PairLockSide | null {
  const v = String(raw || '').toUpperCase();
  if (v === 'YES') return 'YES';
  if (v === 'NO') return 'NO';
  return null;
}

function oppositeSide(side: PairLockSide): PairLockSide {
  return side === 'YES' ? 'NO' : 'YES';
}

function fillCountOf(trade: PairLockTrade): number {
  const n = Number(trade.fillCount ?? trade.fill_count);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function fillUsdOf(trade: PairLockTrade): number | null {
  return ticketUsd(trade.payPrice ?? trade.pay_price ?? trade.price);
}

function executedAtMs(raw: string | Date | number | null | undefined): number {
  if (raw == null) return 0;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function normalizePairLockStartMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? PAIR_LOCK_START_MIN_DEFAULT), PAIR_LOCK_START_MIN_MIN, PAIR_LOCK_START_MIN_MAX)
  );
}

export function normalizePairLockUntilMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? PAIR_LOCK_UNTIL_MIN_DEFAULT), PAIR_LOCK_UNTIL_MIN_MIN, PAIR_LOCK_UNTIL_MIN_MAX)
  );
}

export function reconcilePairLockWindow(opts: {
  startMinutes?: unknown;
  untilMinutes?: unknown;
}): { startMinutes: number; untilMinutes: number } {
  const startMinutes = normalizePairLockStartMinutes(opts.startMinutes);
  const untilMinutes = Math.max(normalizePairLockUntilMinutes(opts.untilMinutes), startMinutes);
  return { startMinutes, untilMinutes };
}

export function normalizePairLockRunnerMaxAskUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? PAIR_LOCK_RUNNER_MAX_ASK_DEFAULT), PAIR_LOCK_RUNNER_MAX_ASK_MIN, PAIR_LOCK_RUNNER_MAX_ASK_MAX),
    0.01
  );
}

export function normalizePairLockMinLockUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? PAIR_LOCK_MIN_LOCK_DEFAULT), PAIR_LOCK_MIN_LOCK_MIN, PAIR_LOCK_MIN_LOCK_MAX),
    0.01
  );
}

export function normalizePairLockFlattenMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? PAIR_LOCK_FLATTEN_DEFAULT), PAIR_LOCK_FLATTEN_MIN, PAIR_LOCK_FLATTEN_MAX)
  );
}

/** $0 = off. Missing → 10¢. */
export function normalizePairLockRunnerStopUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? PAIR_LOCK_RUNNER_STOP_DEFAULT), PAIR_LOCK_RUNNER_STOP_MIN, PAIR_LOCK_RUNNER_STOP_MAX),
    0.01
  );
}

export function normalizePairLockLotCount(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? PAIR_LOCK_LOT_COUNT_DEFAULT), 1, PAIR_LOCK_LOT_COUNT_MAX));
}

/** 0 = first pair only. 3 = 3 extra pairs on top of the first. */
export function normalizePairLockAddPairs(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? PAIR_LOCK_ADD_PAIRS_DEFAULT), 0, PAIR_LOCK_ADD_PAIRS_MAX));
}

export function pairLockDefaultAssets(): string[] {
  return ASSETS_CATALOG.map((a) => a.key);
}

/** Missing → catalog coins that start On. Empty = no Pair lock buys. Off-by-default coins stay selectable. */
export function normalizePairLockAssets(raw: unknown): string[] {
  const allowed = pairLockDefaultAssets();
  const allowedSet = new Set(allowed);
  if (raw == null || !Array.isArray(raw)) {
    return allowed.filter((k) => ASSETS_CATALOG.find((a) => a.key === k)?.defaultOn !== false);
  }
  const out: string[] = [];
  for (const item of raw) {
    const k = String(item || '').trim();
    if (allowedSet.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function isPairLockAssetSelected(assets: unknown, asset: string): boolean {
  return normalizePairLockAssets(assets).includes(String(asset));
}

export function isPairLockEntryPath(raw: unknown): boolean {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/-/g, '_');
  return v === 'pair_lock' || v === 'pairlock' || v === 'pair_lock_hedge' || v === 'pairlockhedge';
}

export function isPairLockEnterPath(opts: {
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
      isPairLockAssetSelected(opts.assets, opts.asset)
  );
}

export function pairLockTwapOwns(opts: {
  twapAdminEnabled: boolean;
  twapUserEnabled: boolean;
  twapAssets: unknown;
  asset: string;
}): boolean {
  return lastMinuteTwapOwns(opts);
}

export function isPairLockEnterWindow(opts: {
  minutesElapsed?: unknown;
  startMinutes?: unknown;
  untilMinutes?: unknown;
}): boolean {
  const elapsed = Number(opts.minutesElapsed);
  if (!Number.isFinite(elapsed)) return false;
  const win = reconcilePairLockWindow({ startMinutes: opts.startMinutes, untilMinutes: opts.untilMinutes });
  return elapsed + 1e-9 >= win.startMinutes && elapsed <= win.untilMinutes + 1e-9;
}

/** Max hedge ask so runner fill + hedge ≤ $1 − min lock. */
export function pairLockHedgeAskLimitUsd(runnerFillUsd: unknown, minLockUsd?: unknown): number | null {
  const fill = ticketUsd(runnerFillUsd);
  if (fill == null) return null;
  const minLock = normalizePairLockMinLockUsd(minLockUsd);
  return snap(1 - fill - minLock, 0.01);
}

export function canPairLockHedge(opts: {
  runnerFillUsd?: unknown;
  hedgeAskUsd?: unknown;
  minLockUsd?: unknown;
}): boolean {
  const fill = ticketUsd(opts.runnerFillUsd);
  const ask = ticketUsd(opts.hedgeAskUsd);
  const limit = pairLockHedgeAskLimitUsd(fill, opts.minLockUsd);
  if (fill == null || ask == null || limit == null) return false;
  if (ask >= 0.995) return false;
  return ask <= limit + 1e-9;
}

/** Live runner ask at or under this → unmatched stop, if the hedge still cannot lock. */
export function pairLockRunnerStopAskUsd(runnerFillUsd: unknown, runnerStopUsd?: unknown): number | null {
  const fill = ticketUsd(runnerFillUsd);
  const stop = normalizePairLockRunnerStopUsd(runnerStopUsd);
  if (fill == null || stop <= 0) return null;
  return snap(fill - stop, 0.01);
}

export function canPairLockRunnerStop(opts: {
  lots: Pick<PairLockLotState, 'locked' | 'unmatched' | 'runnerSide' | 'runnerFillUsd'>;
  quotes: CashOutQuotes;
  runnerStopUsd?: unknown;
  minLockUsd?: unknown;
}): boolean {
  if (opts.lots.locked || !opts.lots.unmatched || !opts.lots.runnerSide || opts.lots.runnerFillUsd == null) {
    return false;
  }
  const stop = normalizePairLockRunnerStopUsd(opts.runnerStopUsd);
  if (stop <= 0) return false;
  const hedgeSide = oppositeSide(opts.lots.runnerSide);
  if (
    canPairLockHedge({
      runnerFillUsd: opts.lots.runnerFillUsd,
      hedgeAskUsd: sideAskOf(hedgeSide, opts.quotes),
      minLockUsd: opts.minLockUsd,
    })
  ) {
    return false;
  }
  const ask = sideAskOf(opts.lots.runnerSide, opts.quotes);
  const trigger = pairLockRunnerStopAskUsd(opts.lots.runnerFillUsd, stop);
  if (ask == null || trigger == null) return false;
  return ask <= trigger + 1e-9;
}

/** Locked dollars per matched contract: $1 − (YES fill + NO fill). */
export function pairLockLockedUsd(yesFillUsd: unknown, noFillUsd: unknown): number | null {
  const yes = ticketUsd(yesFillUsd);
  const no = ticketUsd(noFillUsd);
  if (yes == null || no == null) return null;
  return snap(1 - yes - no, 0.01);
}

export function pairLockLotsForTicker(trades: PairLockTrade[], marketTicker: string): PairLockLotState {
  const want = String(marketTicker || '').trim();
  const empty: PairLockLotState = {
    runnerSide: null,
    runnerFillUsd: null,
    runnerCount: 0,
    runnerFilledAt: null,
    hedgeSide: null,
    hedgeFillUsd: null,
    hedgeCount: 0,
    locked: false,
    unmatched: false,
    matchedCount: 0,
    extraSide: null,
    extraCount: 0,
    extraFillUsd: null,
    extraFilledAt: null,
  };
  const yes: PairLockTrade[] = [];
  const no: PairLockTrade[] = [];
  for (const t of trades || []) {
    const ticker = String(t.ticker || t.market_ticker || '').trim();
    if (ticker !== want) continue;
    if (!isPairLockEntryPath(t.entryPath ?? t.entry_path)) continue;
    if (!isOpenLiveFill(t)) continue;
    const side = sideOf(t.decision);
    if (side === 'YES') yes.push(t);
    else if (side === 'NO') no.push(t);
  }
  const firstOf = (rows: PairLockTrade[]) =>
    rows.slice().sort((a, b) => executedAtMs(a.executedAt) - executedAtMs(b.executedAt))[0];
  const sumCount = (rows: PairLockTrade[]) => rows.reduce((s, t) => s + Math.max(1, fillCountOf(t)), 0);
  const avgFill = (rows: PairLockTrade[]) => {
    let w = 0;
    let c = 0;
    for (const t of rows) {
      const px = fillUsdOf(t);
      const n = Math.max(1, fillCountOf(t));
      if (px == null) continue;
      w += px * n;
      c += n;
    }
    return c > 0 ? snap(w / c, 0.01) : null;
  };
  const newestSlice = (rows: PairLockTrade[], take: number) => {
    const sorted = rows.slice().sort((a, b) => executedAtMs(b.executedAt) - executedAtMs(a.executedAt));
    let left = Math.max(0, take);
    let w = 0;
    let c = 0;
    let filledAt: string | Date | number | null = sorted[0]?.executedAt ?? null;
    for (const t of sorted) {
      if (left <= 0) break;
      const n = Math.max(1, fillCountOf(t));
      const use = Math.min(n, left);
      const px = fillUsdOf(t);
      if (px != null) {
        w += px * use;
        c += use;
      }
      filledAt = t.executedAt ?? filledAt;
      left -= use;
    }
    return { fillUsd: c > 0 ? snap(w / c, 0.01) : null, filledAt, count: take - left };
  };

  if (yes.length === 0 && no.length === 0) return empty;
  const yesCount = sumCount(yes);
  const noCount = sumCount(no);
  const matchedCount = Math.min(yesCount, noCount);
  const extraCount = Math.abs(yesCount - noCount);
  const extraSide: PairLockSide | null = extraCount <= 0 ? null : yesCount > noCount ? 'YES' : 'NO';
  const extraSlice = extraSide === 'YES' ? newestSlice(yes, extraCount) : extraSide === 'NO' ? newestSlice(no, extraCount) : null;

  if (yes.length > 0 && no.length > 0) {
    const yesFirst = firstOf(yes);
    const noFirst = firstOf(no);
    const yesFirstMs = executedAtMs(yesFirst?.executedAt);
    const noFirstMs = executedAtMs(noFirst?.executedAt);
    const runnerIsYes = yesFirstMs <= noFirstMs;
    return {
      runnerSide: runnerIsYes ? 'YES' : 'NO',
      runnerFillUsd: runnerIsYes ? avgFill(yes) : avgFill(no),
      runnerCount: runnerIsYes ? yesCount : noCount,
      runnerFilledAt: runnerIsYes ? yesFirst?.executedAt ?? null : noFirst?.executedAt ?? null,
      hedgeSide: runnerIsYes ? 'NO' : 'YES',
      hedgeFillUsd: runnerIsYes ? avgFill(no) : avgFill(yes),
      hedgeCount: runnerIsYes ? noCount : yesCount,
      locked: matchedCount > 0,
      unmatched: extraCount > 0,
      matchedCount,
      extraSide,
      extraCount,
      extraFillUsd: extraSlice?.fillUsd ?? null,
      extraFilledAt: extraSlice?.filledAt ?? null,
    };
  }
  const rows = yes.length > 0 ? yes : no;
  const side: PairLockSide = yes.length > 0 ? 'YES' : 'NO';
  const first = firstOf(rows);
  return {
    runnerSide: side,
    runnerFillUsd: avgFill(rows),
    runnerCount: sumCount(rows),
    runnerFilledAt: first?.executedAt ?? null,
    hedgeSide: null,
    hedgeFillUsd: null,
    hedgeCount: 0,
    locked: false,
    unmatched: true,
    matchedCount: 0,
    extraSide: side,
    extraCount: sumCount(rows),
    extraFillUsd: avgFill(rows),
    extraFilledAt: first?.executedAt ?? null,
  };
}

export function tickerHasOpenPairLock(trades: PairLockTrade[], marketTicker: string): boolean {
  const lots = pairLockLotsForTicker(trades, marketTicker);
  return lots.runnerCount > 0 || lots.hedgeCount > 0 || lots.locked;
}

/** Unmatched runner / extra, or a completed pair that still has Add new pair room. */
export function shouldWatchPairLockLots(opts: {
  lots: PairLockLotState;
  addPairs?: unknown;
  lotCount?: unknown;
}): boolean {
  if (opts.lots.unmatched || pairLockExtraCount(opts.lots) > 0) return true;
  const addPairs = normalizePairLockAddPairs(opts.addPairs);
  if (addPairs <= 0) return false;
  const matched = pairLockMatchedCount(opts.lots);
  if (matched <= 0) return false;
  const lotCount = normalizePairLockLotCount(opts.lotCount);
  return matched < (1 + addPairs) * lotCount;
}

/** 1s watcher: hunt first runner in the enter window, or stay after fills for hedge / add. */
export function shouldWatchPairLockTicker(opts: {
  lots: PairLockLotState;
  addPairs?: unknown;
  lotCount?: unknown;
  minutesElapsed?: number;
  startMinutes?: unknown;
  untilMinutes?: unknown;
}): boolean {
  if (shouldWatchPairLockLots(opts)) return true;
  if (pairLockMatchedCount(opts.lots) > 0) return false;
  return isPairLockEnterWindow({
    minutesElapsed: opts.minutesElapsed,
    startMinutes: opts.startMinutes,
    untilMinutes: opts.untilMinutes,
  });
}

export function tickerHasOpenOtherThanPairLock(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some(
    (t) => !isPairLockEntryPath((t as PairLockTrade).entryPath ?? (t as PairLockTrade).entry_path)
  );
}

export function pairLockGateConfig(cfg: AppConfig, runnerMaxAsk: number, lotCount: number, flatten: number): AppConfig {
  const cushions = { ...cfg.cushions };
  for (const key of Object.keys(cushions) as AssetKey[]) {
    cushions[key] = 0;
  }
  const clipUsd = Math.max(0.01, lotCount * runnerMaxAsk);
  return {
    ...cfg,
    risk: {
      ...cfg.risk,
      max_entry_ask_usd: runnerMaxAsk,
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

function pairLockRisk(cfg: AppConfig) {
  return cfg.risk as AppConfig['risk'] & {
    pair_lock_enabled?: boolean;
    pair_lock_start_minutes?: number;
    pair_lock_until_minutes?: number;
    pair_lock_runner_max_ask_usd?: number;
    pair_lock_min_lock_usd?: number;
    pair_lock_flatten_minutes?: number;
    pair_lock_runner_stop_usd?: number;
    pair_lock_lot_count?: number;
    pair_lock_add_pairs?: number;
    pair_lock_assets?: string[];
    pair_lock_skip_thin_bid?: boolean;
    twap_lock_enabled?: boolean;
    twap_lock_assets?: string[];
  };
}

export function evaluatePairLockEnter(opts: {
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
  const risk = pairLockRisk(opts.cfg);
  if (!opts.adminEnabled) return { ok: false, skip_reason: 'pair_lock_admin_off' };
  if (risk.pair_lock_enabled !== true) return { ok: false, skip_reason: 'pair_lock_off' };
  if (!opts.cfg.assets_enabled?.[opts.lean.asset]) return { ok: false, skip_reason: 'asset_disabled' };
  if (!isPairLockAssetSelected(risk.pair_lock_assets, opts.lean.asset)) {
    return { ok: false, skip_reason: 'pair_lock_asset_off' };
  }
  if (
    pairLockTwapOwns({
      twapAdminEnabled: opts.twapAdminEnabled === true,
      twapUserEnabled: risk.twap_lock_enabled === true,
      twapAssets: risk.twap_lock_assets,
      asset: opts.lean.asset,
    })
  ) {
    return { ok: false, skip_reason: 'pair_lock_twap_owns' };
  }
  if (opts.lean.phase === 'ended') return { ok: false, skip_reason: 'window_ended' };
  if (opts.lastMinuteOwnsNewBuys) return { ok: false, skip_reason: 'pair_lock_last_minute_owns' };
  if (opts.hasOpenOnTicker) return { ok: false, skip_reason: 'pair_lock_holding_other_path' };
  if (
    !isPairLockEnterWindow({
      minutesElapsed: opts.lean.minutes_elapsed,
      startMinutes: risk.pair_lock_start_minutes,
      untilMinutes: risk.pair_lock_until_minutes,
    })
  ) {
    return { ok: false, skip_reason: 'pair_lock_outside_window' };
  }
  const flatten = normalizePairLockFlattenMinutes(risk.pair_lock_flatten_minutes);
  if (goldFadeMinutesLeft(opts.lean) <= flatten + 1e-9) {
    return { ok: false, skip_reason: 'pair_lock_too_late' };
  }
  const decision = String(opts.lean.decision || '').toUpperCase();
  if (decision !== 'YES' && decision !== 'NO') return { ok: false, skip_reason: 'pair_lock_no_lean' };
  const runnerAsk = decision === 'NO' ? ticketUsd(opts.lean.no_ask) : ticketUsd(opts.lean.yes_ask);
  if (runnerAsk == null) return { ok: false, skip_reason: 'pair_lock_no_ask' };
  const runnerMax = normalizePairLockRunnerMaxAskUsd(risk.pair_lock_runner_max_ask_usd);
  if (runnerAsk + 1e-9 > runnerMax) return { ok: false, skip_reason: 'pair_lock_ask_rich' };
  // Live opposite ask must already lock Min lock. Do not buy a runner and hope.
  const hedgeAsk = decision === 'NO' ? ticketUsd(opts.lean.yes_ask) : ticketUsd(opts.lean.no_ask);
  if (hedgeAsk == null) return { ok: false, skip_reason: 'pair_lock_no_ask' };
  if (
    !canPairLockHedge({
      runnerFillUsd: runnerAsk,
      hedgeAskUsd: hedgeAsk,
      minLockUsd: risk.pair_lock_min_lock_usd,
    })
  ) {
    return { ok: false, skip_reason: 'pair_lock_min_lock' };
  }
  const lotCount = normalizePairLockLotCount(risk.pair_lock_lot_count);
  const leanForGate: LeanSignal = {
    ...opts.lean,
    decision: decision === 'NO' ? 'NO' : 'YES',
    abs_gap: Number(opts.lean.abs_gap) || 0,
    minutes_left: Number(opts.lean.minutes_left) || 0,
    minutes_elapsed: Number(opts.lean.minutes_elapsed) || 0,
  };
  const gate = evaluateStaticGate(leanForGate, pairLockGateConfig(opts.cfg, runnerMax, lotCount, flatten), {
    openPositions: opts.openPositions,
    dailyPnlUsd: opts.dailyPnlUsd,
    tradesToday: opts.tradesToday,
    assetTradesInWindow: opts.assetTradesInWindow,
  });
  if (!gate.ok) return gate;
  const thinOn = resolveSkipThinBid(risk, 'pair_lock', opts.skipThinBid);
  if (thinOn) {
    const need = Math.floor(Number(gate.count) || 0);
    if (opts.bidSize == null || !Number.isFinite(Number(opts.bidSize))) {
      return { ok: false, skip_reason: 'pair_lock_thin_bid' };
    }
    if (need > 0 && Number(opts.bidSize) < need) {
      return { ok: false, skip_reason: 'pair_lock_thin_bid' };
    }
  }
  return { ...gate, decision: decision === 'NO' ? 'NO' : 'YES' };
}

export function pairLockMatchedCount(lots: Pick<PairLockLotState, 'matchedCount' | 'locked' | 'runnerCount' | 'hedgeCount'>): number {
  if (lots.matchedCount != null && Number.isFinite(Number(lots.matchedCount))) {
    return Math.max(0, Math.floor(Number(lots.matchedCount)));
  }
  if (lots.locked) return Math.min(Math.max(0, lots.runnerCount || 0), Math.max(0, lots.hedgeCount || 0));
  return 0;
}

export function pairLockExtraCount(
  lots: Pick<PairLockLotState, 'extraCount' | 'locked' | 'unmatched' | 'runnerCount' | 'hedgeCount'>
): number {
  if (lots.extraCount != null && Number.isFinite(Number(lots.extraCount))) {
    return Math.max(0, Math.floor(Number(lots.extraCount)));
  }
  if (lots.locked && lots.unmatched) return Math.abs((lots.runnerCount || 0) - (lots.hedgeCount || 0));
  if (!lots.locked && lots.unmatched) return Math.max(0, lots.runnerCount || 0);
  return 0;
}

function pairLockBuyGate(side: PairLockSide, ask: number, count: number): GateResult {
  const need = Math.max(1, count);
  const price = ask.toFixed(2);
  return {
    ok: true,
    decision: side,
    count: String(need),
    side: side === 'YES' ? 'bid' : 'ask',
    price,
    pay_price: ask,
    notional_usd: Math.round(need * ask * 100) / 100,
  };
}

export type PairLockStackAddResult = {
  ok: boolean;
  skip_reason?: string;
  count: string;
  yesAsk: number;
  noAsk: number;
  yes: GateResult;
  no: GateResult;
};

/** After a completed pair, fire YES and NO together if the new pair still locks Min lock. */
export function evaluatePairLockStackAdd(opts: {
  lots: PairLockLotState;
  quotes: CashOutQuotes;
  addPairs?: unknown;
  lotCount?: unknown;
  minLockUsd?: unknown;
  flattenMinutes?: unknown;
  lean: { phase?: string; minutes_left?: number; minutes_remaining?: number };
  skipThinBid?: boolean;
  yesBidSize?: number | null;
  noBidSize?: number | null;
}): PairLockStackAddResult {
  const addPairs = normalizePairLockAddPairs(opts.addPairs);
  const lotCount = normalizePairLockLotCount(opts.lotCount);
  const matched = pairLockMatchedCount(opts.lots);
  const extra = pairLockExtraCount(opts.lots);
  const fail = (skip_reason: string): PairLockStackAddResult => ({
    ok: false,
    skip_reason,
    count: String(lotCount),
    yesAsk: 0,
    noAsk: 0,
    yes: { ok: false, skip_reason },
    no: { ok: false, skip_reason },
  });
  if (addPairs <= 0) return fail('pair_lock_add_off');
  if (extra > 0) return fail('pair_lock_unmatched_extra');
  if (matched <= 0) return fail('pair_lock_no_runner');
  if (matched >= (1 + addPairs) * lotCount) return fail('pair_lock_stack_max');
  if (opts.lean.phase === 'ended') return fail('window_ended');
  const flatten = normalizePairLockFlattenMinutes(opts.flattenMinutes);
  if (goldFadeMinutesLeft(opts.lean) <= flatten + 1e-9) return fail('pair_lock_too_late');
  const yesAsk = sideAskOf('YES', opts.quotes);
  const noAsk = sideAskOf('NO', opts.quotes);
  if (yesAsk == null || noAsk == null) return fail('pair_lock_no_ask');
  if (!canPairLockHedge({ runnerFillUsd: yesAsk, hedgeAskUsd: noAsk, minLockUsd: opts.minLockUsd })) {
    return fail('pair_lock_min_lock');
  }
  if (opts.skipThinBid) {
    if (opts.yesBidSize == null || !Number.isFinite(Number(opts.yesBidSize)) || Number(opts.yesBidSize) < lotCount) {
      return fail('pair_lock_thin_bid');
    }
    if (opts.noBidSize == null || !Number.isFinite(Number(opts.noBidSize)) || Number(opts.noBidSize) < lotCount) {
      return fail('pair_lock_thin_bid');
    }
  }
  return {
    ok: true,
    count: String(lotCount),
    yesAsk,
    noAsk,
    yes: pairLockBuyGate('YES', yesAsk, lotCount),
    no: pairLockBuyGate('NO', noAsk, lotCount),
  };
}

/** After one stacked leg fills, pick finish vs dump — smaller loss (or still a profit). */
export function evaluatePairLockStackRecover(opts: {
  lots: PairLockLotState;
  quotes: CashOutQuotes;
  skipThinBid?: boolean;
  bidSize?: number | null;
}): {
  kind: 'stack_finish' | 'stack_dump' | 'none';
  reason: string;
  finishLossUsd: number | null;
  dumpLossUsd: number | null;
  hedge?: GateResult;
} {
  const extra = pairLockExtraCount(opts.lots);
  const extraSide = opts.lots.extraSide || (opts.lots.unmatched ? opts.lots.runnerSide : null);
  const extraFill = opts.lots.extraFillUsd ?? opts.lots.runnerFillUsd;
  if (pairLockMatchedCount(opts.lots) <= 0 || extra <= 0 || !extraSide || extraFill == null) {
    return { kind: 'none', reason: 'pair_lock_no_runner', finishLossUsd: null, dumpLossUsd: null };
  }
  const opp = oppositeSide(extraSide);
  const oppAsk = sideAskOf(opp, opts.quotes);
  const extraBid = sideBidOf(extraSide, opts.quotes);
  const finishLossUsd = oppAsk == null ? null : snap(extraFill + oppAsk - 1, 0.01);
  const dumpLossUsd = extraBid == null ? null : snap(extraFill - extraBid, 0.01);
  const canFinish =
    oppAsk != null &&
    oppAsk < 0.995 &&
    finishLossUsd != null &&
    (dumpLossUsd == null || finishLossUsd <= dumpLossUsd + 1e-9);
  if (canFinish) {
    if (opts.skipThinBid) {
      if (opts.bidSize == null || !Number.isFinite(Number(opts.bidSize)) || Number(opts.bidSize) < extra) {
        if (dumpLossUsd != null) {
          return { kind: 'stack_dump', reason: 'thin_bid', finishLossUsd, dumpLossUsd };
        }
        return { kind: 'none', reason: 'pair_lock_thin_bid', finishLossUsd, dumpLossUsd };
      }
    }
    return {
      kind: 'stack_finish',
      reason: 'pair_lock_stack_finish',
      finishLossUsd,
      dumpLossUsd,
      hedge: pairLockBuyGate(opp, Number(oppAsk), extra),
    };
  }
  if (dumpLossUsd != null) {
    return { kind: 'stack_dump', reason: 'pair_lock_stack_dump', finishLossUsd, dumpLossUsd };
  }
  return { kind: 'none', reason: 'pair_lock_min_lock', finishLossUsd, dumpLossUsd };
}

/** Hedge as soon as the lock prints. Flatten / runner stop still use 5s grace. */
export function evaluatePairLockHedge(opts: {
  lots: PairLockLotState;
  quotes: CashOutQuotes;
  minLockUsd?: unknown;
  skipThinBid?: boolean;
  bidSize?: number | null;
  filledAt?: string | Date | number | null;
  now?: Date;
}): GateResult {
  if (pairLockMatchedCount(opts.lots) > 0) return { ok: false, skip_reason: 'pair_lock_already_locked' };
  if (!opts.lots.unmatched || !opts.lots.runnerSide || opts.lots.runnerFillUsd == null) {
    return { ok: false, skip_reason: 'pair_lock_no_runner' };
  }
  const hedgeSide = oppositeSide(opts.lots.runnerSide);
  const hedgeAsk = sideAskOf(hedgeSide, opts.quotes);
  if (!canPairLockHedge({ runnerFillUsd: opts.lots.runnerFillUsd, hedgeAskUsd: hedgeAsk, minLockUsd: opts.minLockUsd })) {
    return { ok: false, skip_reason: 'pair_lock_min_lock' };
  }
  const need = Math.max(1, opts.lots.runnerCount - opts.lots.hedgeCount);
  if (opts.skipThinBid) {
    if (opts.bidSize == null || !Number.isFinite(Number(opts.bidSize))) {
      return { ok: false, skip_reason: 'pair_lock_thin_bid' };
    }
    if (need > 0 && Number(opts.bidSize) < need) {
      return { ok: false, skip_reason: 'pair_lock_thin_bid' };
    }
  }
  const ask = Number(hedgeAsk);
  const price = ask.toFixed(2);
  return {
    ok: true,
    decision: hedgeSide,
    count: String(need),
    side: hedgeSide === 'YES' ? 'bid' : 'ask',
    price,
    pay_price: ask,
    notional_usd: Math.round(need * ask * 100) / 100,
  };
}

export function evaluatePairLockFlatten(opts: {
  lots: PairLockLotState;
  quotes: CashOutQuotes;
  flattenMinutes?: unknown;
  runnerStopUsd?: unknown;
  minLockUsd?: unknown;
  lean: { phase?: string; minutes_left?: number; minutes_remaining?: number };
  filledAt?: string | Date | number | null;
  now?: Date;
  skipThinBid?: boolean;
  bidSize?: number | null;
}): { sell: boolean; kind: PairLockExitKind; reason: string } {
  if (pairLockMatchedCount(opts.lots) > 0) return { sell: false, kind: 'none', reason: 'pair_lock_hold_locked' };
  if (!opts.lots.unmatched || !opts.lots.runnerSide) {
    return { sell: false, kind: 'none', reason: 'pair_lock_no_runner' };
  }
  if (opts.lean.phase === 'ended') {
    return { sell: true, kind: 'pair_lock_flatten', reason: 'window_ended' };
  }
  if (
    inProtectSellGrace({
      filledAt: opts.filledAt ?? opts.lots.runnerFilledAt,
      graceSeconds: PAIR_LOCK_GRACE_SEC,
      now: opts.now,
    })
  ) {
    return { sell: false, kind: 'none', reason: 'grace_after_fill' };
  }
  if (opts.skipThinBid && isCashOutThinBid(opts.bidSize, opts.lots.runnerCount)) {
    return { sell: true, kind: 'pair_lock_thin_bid', reason: 'thin_bid' };
  }
  if (
    canPairLockRunnerStop({
      lots: opts.lots,
      quotes: opts.quotes,
      runnerStopUsd: opts.runnerStopUsd,
      minLockUsd: opts.minLockUsd,
    })
  ) {
    return { sell: true, kind: 'pair_lock_runner_stop', reason: 'runner_stop' };
  }
  const flatten = normalizePairLockFlattenMinutes(opts.flattenMinutes);
  if (goldFadeMinutesLeft(opts.lean) <= flatten + 1e-9) {
    return { sell: true, kind: 'pair_lock_flatten', reason: 'flatten_minutes' };
  }
  return { sell: false, kind: 'none', reason: 'pair_lock_hold' };
}

/** Hedge first if the lock prints; flatten unmatched only if the second leg is still missing. */
export function evaluatePairLockWatch(opts: {
  lots: PairLockLotState;
  quotes: CashOutQuotes;
  minLockUsd?: unknown;
  flattenMinutes?: unknown;
  runnerStopUsd?: unknown;
  addPairs?: unknown;
  lotCount?: unknown;
  lean: { phase?: string; minutes_left?: number; minutes_remaining?: number };
  filledAt?: string | Date | number | null;
  now?: Date;
  skipThinBid?: boolean;
  hedgeBidSize?: number | null;
  flattenBidSize?: number | null;
  yesBidSize?: number | null;
  noBidSize?: number | null;
}): {
  kind: PairLockWatchKind;
  reason: string;
  hedge?: GateResult;
  flatten?: { sell: boolean; kind: PairLockExitKind; reason: string };
  stack?: PairLockStackAddResult;
} {
  const matched = pairLockMatchedCount(opts.lots);
  const extra = pairLockExtraCount(opts.lots);
  if (matched > 0 && extra > 0) {
    const recover = evaluatePairLockStackRecover({
      lots: opts.lots,
      quotes: opts.quotes,
      skipThinBid: opts.skipThinBid,
      bidSize: opts.hedgeBidSize,
    });
    if (recover.kind === 'stack_finish') {
      return { kind: 'stack_finish', reason: recover.reason, hedge: recover.hedge };
    }
    if (recover.kind === 'stack_dump') {
      return {
        kind: 'stack_dump',
        reason: recover.reason,
        flatten: { sell: true, kind: 'pair_lock_flatten', reason: recover.reason },
      };
    }
    return { kind: 'none', reason: recover.reason };
  }
  if (matched > 0) {
    const stack = evaluatePairLockStackAdd({
      lots: opts.lots,
      quotes: opts.quotes,
      addPairs: opts.addPairs,
      lotCount: opts.lotCount,
      minLockUsd: opts.minLockUsd,
      flattenMinutes: opts.flattenMinutes,
      lean: opts.lean,
      skipThinBid: opts.skipThinBid,
      yesBidSize: opts.yesBidSize,
      noBidSize: opts.noBidSize,
    });
    if (stack.ok) return { kind: 'stack', reason: 'pair_lock_stack', stack };
    if (stack.skip_reason === 'pair_lock_add_off' || stack.skip_reason === 'pair_lock_stack_max') {
      return { kind: 'hold_locked', reason: 'pair_lock_hold_locked' };
    }
    return { kind: 'hold_locked', reason: stack.skip_reason || 'pair_lock_hold_locked' };
  }
  const hedge = evaluatePairLockHedge({
    lots: opts.lots,
    quotes: opts.quotes,
    minLockUsd: opts.minLockUsd,
    skipThinBid: opts.skipThinBid,
    bidSize: opts.hedgeBidSize,
    filledAt: opts.filledAt,
    now: opts.now,
  });
  if (hedge.ok) return { kind: 'hedge', reason: 'pair_lock_hedge', hedge };
  const flatten = evaluatePairLockFlatten({
    lots: opts.lots,
    quotes: opts.quotes,
    flattenMinutes: opts.flattenMinutes,
    runnerStopUsd: opts.runnerStopUsd,
    minLockUsd: opts.minLockUsd,
    lean: opts.lean,
    filledAt: opts.filledAt,
    now: opts.now,
    skipThinBid: opts.skipThinBid,
    bidSize: opts.flattenBidSize,
  });
  if (flatten.sell) {
    return {
      kind:
        flatten.kind === 'pair_lock_thin_bid'
          ? 'thin_bid'
          : flatten.kind === 'pair_lock_runner_stop'
            ? 'runner_stop'
            : 'flatten',
      reason: flatten.reason,
      hedge,
      flatten,
    };
  }
  return { kind: 'none', reason: hedge.skip_reason || flatten.reason, hedge, flatten };
}

export function buildPairLockSellOrder(opts: {
  heldSide: PairLockSide | string;
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

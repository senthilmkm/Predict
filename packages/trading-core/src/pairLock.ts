import { AppConfig, ASSETS_CATALOG, AssetKey } from './types';
import { evaluateStaticGate, GateResult, LeanSignal } from './gates';
import {
  CashOutQuotes,
  isCashOutThinBid,
  isOpenLiveFill,
  openFillsForTicker,
  sideAskOf,
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
export const PAIR_LOCK_LOT_COUNT_DEFAULT = 1;
export const PAIR_LOCK_LOT_COUNT_MAX = 5;
export const PAIR_LOCK_GRACE_SEC = 5;

export type PairLockSide = 'YES' | 'NO';
export type PairLockExitKind = 'none' | 'pair_lock_flatten' | 'pair_lock_thin_bid';
export type PairLockWatchKind = 'none' | 'hedge' | 'flatten' | 'thin_bid' | 'hold_locked';

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

export function normalizePairLockLotCount(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? PAIR_LOCK_LOT_COUNT_DEFAULT), 1, PAIR_LOCK_LOT_COUNT_MAX));
}

export function pairLockDefaultAssets(): string[] {
  return ASSETS_CATALOG.map((a) => a.key);
}

/** Missing → all catalog assets. Empty = no Pair lock buys. */
export function normalizePairLockAssets(raw: unknown): string[] {
  const allowed = pairLockDefaultAssets();
  const allowedSet = new Set(allowed);
  if (raw == null || !Array.isArray(raw)) return allowed;
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
    .trim();
  return v === 'pair_lock' || v === 'pairlock' || v === 'pair-lock';
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

  if (yes.length === 0 && no.length === 0) return empty;
  if (yes.length > 0 && no.length > 0) {
    const yesFirst = firstOf(yes);
    const noFirst = firstOf(no);
    const yesFirstMs = executedAtMs(yesFirst?.executedAt);
    const noFirstMs = executedAtMs(noFirst?.executedAt);
    const runnerIsYes = yesFirstMs <= noFirstMs;
    return {
      runnerSide: runnerIsYes ? 'YES' : 'NO',
      runnerFillUsd: runnerIsYes ? avgFill(yes) : avgFill(no),
      runnerCount: runnerIsYes ? sumCount(yes) : sumCount(no),
      runnerFilledAt: runnerIsYes ? yesFirst?.executedAt ?? null : noFirst?.executedAt ?? null,
      hedgeSide: runnerIsYes ? 'NO' : 'YES',
      hedgeFillUsd: runnerIsYes ? avgFill(no) : avgFill(yes),
      hedgeCount: runnerIsYes ? sumCount(no) : sumCount(yes),
      locked: true,
      unmatched: false,
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
  };
}

export function tickerHasOpenPairLock(trades: PairLockTrade[], marketTicker: string): boolean {
  const lots = pairLockLotsForTicker(trades, marketTicker);
  return lots.runnerCount > 0 || lots.hedgeCount > 0 || lots.locked;
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
    pair_lock_lot_count?: number;
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

export function evaluatePairLockHedge(opts: {
  lots: PairLockLotState;
  quotes: CashOutQuotes;
  minLockUsd?: unknown;
  skipThinBid?: boolean;
  bidSize?: number | null;
  filledAt?: string | Date | number | null;
  now?: Date;
}): GateResult {
  if (opts.lots.locked) return { ok: false, skip_reason: 'pair_lock_already_locked' };
  if (!opts.lots.unmatched || !opts.lots.runnerSide || opts.lots.runnerFillUsd == null) {
    return { ok: false, skip_reason: 'pair_lock_no_runner' };
  }
  if (
    inProtectSellGrace({
      filledAt: opts.filledAt ?? opts.lots.runnerFilledAt,
      graceSeconds: PAIR_LOCK_GRACE_SEC,
      now: opts.now,
    })
  ) {
    return { ok: false, skip_reason: 'grace_after_fill' };
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
  lean: { phase?: string; minutes_left?: number; minutes_remaining?: number };
  filledAt?: string | Date | number | null;
  now?: Date;
  skipThinBid?: boolean;
  bidSize?: number | null;
}): { sell: boolean; kind: PairLockExitKind; reason: string } {
  if (opts.lots.locked) return { sell: false, kind: 'none', reason: 'pair_lock_hold_locked' };
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
  lean: { phase?: string; minutes_left?: number; minutes_remaining?: number };
  filledAt?: string | Date | number | null;
  now?: Date;
  skipThinBid?: boolean;
  hedgeBidSize?: number | null;
  flattenBidSize?: number | null;
}): {
  kind: PairLockWatchKind;
  reason: string;
  hedge?: GateResult;
  flatten?: { sell: boolean; kind: PairLockExitKind; reason: string };
} {
  if (opts.lots.locked) return { kind: 'hold_locked', reason: 'pair_lock_hold_locked' };
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
    lean: opts.lean,
    filledAt: opts.filledAt,
    now: opts.now,
    skipThinBid: opts.skipThinBid,
    bidSize: opts.flattenBidSize,
  });
  if (flatten.sell) {
    return {
      kind: flatten.kind === 'pair_lock_thin_bid' ? 'thin_bid' : 'flatten',
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

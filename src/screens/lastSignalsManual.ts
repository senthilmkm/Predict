import { decideLean, LeanResult } from '../services/lean/lean';
import { TradeRecord } from '../storage/repos';
import { AppConfig, AssetRegistry } from '../config/types';
import { configForHomeBuy } from '../config/normalize';
import { evaluateStaticGate } from '../engine/gates';
import {
  countWindowBuysForTicker,
  formatSkipReason,
  resolveMinutesElapsed,
} from '../../packages/trading-core/src/gates';
import {
  isTwapLockEnterPath,
  TWAP_LOCK_WATCH_SEC,
  twapLockSecondsLeft,
} from '../../packages/trading-core/src/twapLock';
import {
  isLastMinuteEnterPath,
  normalizeLastMinuteWatchSeconds,
} from '../../packages/trading-core/src/lastMinute';
import { isStepBuyEnterPath, normalizeStepBuyStartMinutes } from '../../packages/trading-core/src/stepBuy';
import { isSpikeFadeEnterPath, isSpikeFadeEnterWindow } from '../../packages/trading-core/src/spikeFade';
import { isPairLockEnterPath, isPairLockEnterWindow } from '../../packages/trading-core/src/pairLock';
import {
  capLockHoldingWatchText,
  isCapLockEnterPath,
  isCapLockEnterWindow,
  type CapLockLotState,
} from '../../packages/trading-core/src/capLock';
import {
  cheapLoopCooldownWatchText,
  cheapLoopHoldingWatchText,
  isCheapLoopEnterPath,
  isCheapLoopEnterWindow,
} from '../../packages/trading-core/src/cheapLoop';

export type GapLiveSide = 'above' | 'below';
export type GapDisplayTone = 'with' | 'against' | 'neutral';

/** Live vs strike. YES/NO is only a fallback when live/strike are missing. */
export function liveVsStrike(
  live?: number | null,
  strike?: number | null,
  decision?: string
): GapLiveSide | null {
  const l = Number(live);
  const s = Number(strike);
  if (Number.isFinite(l) && Number.isFinite(s)) {
    return l >= s ? 'above' : 'below';
  }
  if (decision === 'YES') return 'above';
  if (decision === 'NO') return 'below';
  return null;
}

export function formatGapAmount(gap: number, assetKey?: string): string {
  const abs = Math.abs(gap);
  const bounds = assetKey ? AssetRegistry.getCushionBounds(assetKey) : null;
  const decimals = bounds?.step ? (String(bounds.step).split('.')[1]?.length || 2) : 2;
  const prec = Math.max(decimals, abs < 0.01 ? 4 : abs < 1 ? 3 : 2);
  return `$${abs.toFixed(prec)}`;
}

/**
 * Home gap line: ▲ / ▼ vs strike when flat; with you / against you when holding.
 */
export function formatGapDisplay(opts: {
  gap: number | undefined | null;
  assetKey?: string;
  live?: number | null;
  strike?: number | null;
  decision?: string;
  heldSide?: 'YES' | 'NO' | null;
}): { text: string; tone: GapDisplayTone } {
  if (opts.gap == null || !Number.isFinite(Number(opts.gap))) {
    return { text: '', tone: 'neutral' };
  }
  const amt = formatGapAmount(Number(opts.gap), opts.assetKey);
  const dir = liveVsStrike(opts.live, opts.strike, opts.decision);
  const held = opts.heldSide;
  if (held === 'YES' || held === 'NO') {
    if (dir) {
      const withYou = (held === 'YES' && dir === 'above') || (held === 'NO' && dir === 'below');
      return {
        text: withYou ? `with you ${amt} (gap)` : `against you ${amt} (gap)`,
        tone: withYou ? 'with' : 'against',
      };
    }
    return { text: `${amt} (gap)`, tone: 'neutral' };
  }
  if (dir === 'above') return { text: `\u25B2 ${amt} (gap)`, tone: 'neutral' };
  if (dir === 'below') return { text: `\u25BC ${amt} (gap)`, tone: 'neutral' };
  return { text: `${amt} (gap)`, tone: 'neutral' };
}

/** Overlay Cloud 1s live/strike/gap onto a Home row. Decision still uses this user's Cushion. */
export function mergeCloudHomeLean(
  prev: LeanResult | undefined,
  incoming: Record<string, unknown> | null | undefined,
  cushion: number
): LeanResult | undefined {
  if (!incoming || typeof incoming !== 'object') return prev;
  const live = Number(incoming.live);
  const strike = Number(incoming.strike);
  if (!Number.isFinite(live) || !Number.isFinite(strike)) return prev;
  const phase = String(incoming.phase || prev?.phase || 'live') as LeanResult['phase'];
  const decided = decideLean(phase || 'live', live, strike, Number(cushion) || 0);
  return {
    ...(prev || { ok: true, asset: String(incoming.asset || ''), decision: 'SKIP', phase: 'live' }),
    ok: true,
    asset: (String(incoming.asset || prev?.asset || '') || prev?.asset) as LeanResult['asset'],
    market_ticker: String(incoming.market_ticker || prev?.market_ticker || '') || prev?.market_ticker,
    event_ticker: String(incoming.event_ticker || prev?.event_ticker || '') || prev?.event_ticker,
    live,
    strike,
    abs_gap: decided.abs_gap,
    decision: decided.decision,
    phase: phase || prev?.phase || 'live',
    yes_ask: Number.isFinite(Number(incoming.yes_ask)) ? Number(incoming.yes_ask) : prev?.yes_ask,
    no_ask: Number.isFinite(Number(incoming.no_ask)) ? Number(incoming.no_ask) : prev?.no_ask,
    yes_bid: Number.isFinite(Number(incoming.yes_bid)) ? Number(incoming.yes_bid) : prev?.yes_bid,
    no_bid: Number.isFinite(Number(incoming.no_bid)) ? Number(incoming.no_bid) : prev?.no_bid,
    minutes_left: Number.isFinite(Number(incoming.minutes_left))
      ? Number(incoming.minutes_left)
      : prev?.minutes_left,
    minutes_elapsed: Number.isFinite(Number(incoming.minutes_elapsed))
      ? Number(incoming.minutes_elapsed)
      : prev?.minutes_elapsed,
    minutes_remaining: Number.isFinite(Number(incoming.minutes_remaining))
      ? Number(incoming.minutes_remaining)
      : prev?.minutes_remaining,
    open_utc: incoming.open_utc != null ? String(incoming.open_utc) : prev?.open_utc,
    close_utc: incoming.close_utc != null ? String(incoming.close_utc) : prev?.close_utc,
    price_source: incoming.price_source != null ? String(incoming.price_source) : prev?.price_source,
  };
}

export type LiveAskQuote = {
  yes_ask?: number | null;
  no_ask?: number | null;
};

function finiteAsk(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Prefer the Cloud 1s watcher book; lean only when that book has no ask. */
export function pickLiveAsk(opts: {
  nowMs: number;
  cloudAt?: string | null;
  cloud?: LiveAskQuote | null;
  leanYes?: number | null;
  leanNo?: number | null;
}): { yes_ask?: number; no_ask?: number; source: 'watcher' | 'lean' } | null {
  void opts.nowMs;
  void opts.cloudAt;
  const cloudYes = finiteAsk(opts.cloud?.yes_ask);
  const cloudNo = finiteAsk(opts.cloud?.no_ask);
  if (cloudYes != null || cloudNo != null) {
    return { yes_ask: cloudYes, no_ask: cloudNo, source: 'watcher' };
  }
  const leanYes = finiteAsk(opts.leanYes);
  const leanNo = finiteAsk(opts.leanNo);
  if (leanYes != null || leanNo != null) {
    return { yes_ask: leanYes, no_ask: leanNo, source: 'lean' };
  }
  return null;
}

export function formatLiveAskAgeSec(nowMs: number, cloudAt?: string | null): string {
  const t = cloudAt ? Date.parse(cloudAt) : NaN;
  if (!Number.isFinite(t)) return '';
  return `${Math.max(0, Math.floor((nowMs - t) / 1000))}s`;
}

export function formatLiveAskLine(
  quote: { yes_ask?: number | null; no_ask?: number | null } | null | undefined,
  extra?: { age?: string | null }
): string {
  if (!quote) return '';
  const yes = finiteAsk(quote.yes_ask);
  const no = finiteAsk(quote.no_ask);
  const fmt = (v: number) => `${Math.round(v * 100)}¢`;
  const age = String(extra?.age || '').trim();
  const suffix = age ? ` · ${age}` : '';
  if (yes != null && no != null) return `YES ${fmt(yes)} · NO ${fmt(no)}${suffix}`;
  if (yes != null) return `YES ${fmt(yes)}${suffix}`;
  if (no != null) return `NO ${fmt(no)}${suffix}`;
  return '';
}

export interface LastSignalRowInput {
  asset: string;
  decision: string;
  err?: string;
  isOpen: boolean;
  noMarket: boolean;
  marketTicker?: string | null;
}

export function isOpenHeldFill(
  trade: Pick<TradeRecord, 'market_ticker' | 'dry_run' | 'outcome' | 'fill_count'>,
  ticker: string
): boolean {
  const tkr = String(ticker || '').trim();
  if (!tkr) return false;
  if (String(trade.market_ticker || '').trim() !== tkr) return false;
  if (trade.dry_run) return false;
  const fills = Number(trade.fill_count ?? 0);
  if (!(fills > 0)) return false;
  const outcome = String(trade.outcome || 'pending');
  return outcome === 'pending' || outcome === 'exiting';
}

export function heldOpenFillForTicker(
  trades: Array<
    Pick<TradeRecord, 'market_ticker' | 'dry_run' | 'outcome' | 'fill_count' | 'side' | 'entry_path'>
  >,
  ticker: string | null | undefined
) {
  const tkr = String(ticker || '').trim();
  if (!tkr) return undefined;
  return trades.find((t) => isOpenHeldFill(t, tkr));
}

/** Open YES/NO sides still held on this ticker (Home pair legs). */
export function openHeldSidesForTicker(
  trades: Array<
    Pick<TradeRecord, 'market_ticker' | 'dry_run' | 'outcome' | 'fill_count' | 'side'>
  >,
  ticker: string | null | undefined
): Array<'YES' | 'NO'> {
  const tkr = String(ticker || '').trim();
  if (!tkr) return [];
  const sides = new Set<'YES' | 'NO'>();
  for (const t of trades) {
    if (!isOpenHeldFill(t, tkr)) continue;
    const s = String(t.side || '').toUpperCase();
    if (s === 'YES' || s === 'NO') sides.add(s);
  }
  return [...sides];
}

/** Open Home sides that can be sold from the row (one or both). */
export function homeSellSides(opts: {
  offerKind: 'buy' | 'sell' | 'none';
  heldSide?: 'YES' | 'NO' | null;
  heldEntryPath?: string | null;
  openSides?: Array<'YES' | 'NO'>;
}): Array<'YES' | 'NO'> {
  if (opts.offerKind !== 'sell') return [];
  const path = String(opts.heldEntryPath || '')
    .toLowerCase()
    .trim();
  const isHome =
    !path ||
    path === 'home' ||
    path === 'manual' ||
    path === 'manual_buy' ||
    path === 'home_buy';
  if (path && !isHome) return [];
  const open = new Set(opts.openSides || []);
  if (opts.heldSide === 'YES' || opts.heldSide === 'NO') open.add(opts.heldSide);
  const out: Array<'YES' | 'NO'> = [];
  if (open.has('YES')) out.push('YES');
  if (open.has('NO')) out.push('NO');
  return out;
}

/**
 * Home never dual-offers Buy YES+NO, and never offers the opposite side after a fill.
 * One Buy only — lean side, when gap clears Home Enter × cushion (gate elsewhere).
 * Kept as a stub so HomeScreen / tests stay stable.
 */
export function homeStrongBuySides(_opts: {
  strongBuy: boolean;
  offerKind: 'buy' | 'sell' | 'none';
  leanDecision?: string;
  heldSide?: 'YES' | 'NO' | null;
  heldEntryPath?: string | null;
  openSides?: Array<'YES' | 'NO'>;
}): Array<'YES' | 'NO'> {
  return [];
}

export function lastSignalManualKind(opts: {
  featureOn: boolean;
  killSwitch: boolean;
  row: LastSignalRowInput;
  held?: { side: 'YES' | 'NO' } | null;
}): 'buy' | 'sell' | 'none' {
  if (!opts.featureOn || opts.killSwitch) return 'none';
  const row = opts.row;
  if (!row.isOpen || row.noMarket || row.err) return 'none';
  if (opts.held) return 'sell';
  if (row.decision === 'YES' || row.decision === 'NO') return 'buy';
  return 'none';
}

/** Buy is only offered when Cloud Home Buy gates would also pass. Sell stays. */
export function lastSignalOfferKind(
  kind: 'buy' | 'sell' | 'none',
  tapSkipReason?: string | null
): 'buy' | 'sell' | 'none' {
  if (kind === 'buy' && tapSkipReason) return 'none';
  return kind;
}

function openLiveFills(
  trades: Array<Pick<TradeRecord, 'dry_run' | 'outcome' | 'fill_count'>>
): number {
  return trades.filter((t) => {
    if (t.dry_run) return false;
    if (!(Number(t.fill_count ?? 0) > 0)) return false;
    const outcome = String(t.outcome || 'pending');
    return outcome === 'pending' || outcome === 'exiting';
  }).length;
}

/** Home Buy orb turns green when |live − strike| clears that coin’s Cushions $. */
export const HOME_BUY_STRONG_GAP_MULT = 1;

export function homeBuyGapBeatsCushion(opts: { absGap?: unknown; cushionUsd?: unknown }): boolean {
  const gap = Number(opts.absGap);
  const cushion = Number(opts.cushionUsd);
  if (!Number.isFinite(gap) || !Number.isFinite(cushion) || cushion <= 0) return false;
  return gap + 1e-9 >= cushion * HOME_BUY_STRONG_GAP_MULT;
}

/** Home Buy gate skip, or null if the tap would place. */
export function homeBuySkipReason(opts: {
  cfg: AppConfig;
  lean: {
    asset: string;
    market_ticker?: string | null;
    decision?: string;
    live?: number;
    strike?: number;
    abs_gap?: number;
    minutes_left?: number;
    minutes_elapsed?: number;
    open_utc?: string;
    close_utc?: string;
    phase?: string;
    yes_ask?: number;
    no_ask?: number;
  } | null;
  trades: TradeRecord[];
  nowMs?: number;
}): string | null {
  const lean = opts.lean;
  if (!lean || (lean.decision !== 'YES' && lean.decision !== 'NO')) return null;
  try {
    const buyCfg = configForHomeBuy(opts.cfg);
    const ticker = String(lean.market_ticker || '').trim();
    const elapsed = resolveMinutesElapsed(lean, opts.nowMs ?? Date.now());
    const gate = evaluateStaticGate(
      {
        asset: lean.asset,
        market_ticker: ticker,
        decision: lean.decision,
        live: Number(lean.live) || 0,
        strike: Number(lean.strike) || 0,
        abs_gap: Number(lean.abs_gap) || 0,
        minutes_left: Number(lean.minutes_left) || 0,
        minutes_elapsed: elapsed,
        minutes_remaining: Number((lean as { minutes_remaining?: number }).minutes_remaining),
        phase: lean.phase === 'ended' ? 'ended' : 'live',
        yes_ask: lean.yes_ask,
        no_ask: lean.no_ask,
        open_utc: lean.open_utc,
        close_utc: lean.close_utc,
      },
      buyCfg,
      {
        allowWhenAutoTradeOff: true,
        openPositions: openLiveFills(opts.trades),
        assetTradesInWindow: countWindowBuysForTicker(opts.trades, ticker),
      }
    );
    if (gate.ok) return null;
    return formatSkipReason(gate.skip_reason);
  } catch {
    return null;
  }
}

/** @deprecated Prefer resolveMinutesElapsed from trading-core gates. */
export function resolveHomeBuyMinutesElapsed(
  lean: { minutes_elapsed?: number; open_utc?: string; close_utc?: string } | null | undefined,
  nowMs = Date.now()
): number {
  return resolveMinutesElapsed(lean, nowMs);
}

/** SKIP line on Last signals — only "below cushion" when the 15m book is live. */
export function skipSignalReason(phase?: string | null): string {
  const p = String(phase || 'live').toLowerCase();
  if (p === 'upcoming') return 'next window';
  if (p === 'ended') return 'window ended';
  if (p === 'unknown') return 'window not live';
  return 'below cushion';
}

type PathWatchId = 'twap' | 'last_minute' | 'step_buy' | 'spike_fade' | 'pair_lock' | 'cap_lock' | 'cheap_loop';

const PATH_NAME_RE =
  /\b(TWAP|Last-minute|last-minute|Step buy|Spike fade|Pair lock|Cap lock|Cheap loop|Gold fade|gold fade|Cash out|cash out|Protect)\b/i;

const PATH_OWNED_RE: Record<PathWatchId, RegExp> = {
  twap: /\btwap\b|not locked|lock feed|not last minute/i,
  last_minute: /last[- ]?minute/i,
  step_buy: /step buy/i,
  spike_fade: /spike fade|no spike in band|cheap side off band/i,
  pair_lock: /pair lock/i,
  cap_lock: /cap lock|too rich to lock|first leg missed|waiting for second leg|holding leftover/i,
  cheap_loop:
    /cheap loop|cheap side already decided|favorite already decided|no cheap-side gap|live too close to strike|no unique atm|no hourly market|no weekly market|cheap side not cheap/i,
};

export function stripLastActionPrefix(detail: string): string {
  return String(detail || '')
    .replace(/^(skipped|failed)\s*·\s*/i, '')
    .trim();
}

/** Idle / closed-window copy that should not sit on Last signals. */
export function isIdleWindowLastSignalCopy(detail?: string | null): boolean {
  const raw = String(detail || '').trim();
  if (!raw) return true;
  const reason = stripLastActionPrefix(raw);
  if (/^(window ended|window_ended|next window|window not live)$/i.test(reason)) return true;
  if (/\bwatching\s*·\s*\d+\s*s\s*left\b/i.test(raw) || /\bwatching\s*·\s*\d+\s*s\s*left\b/i.test(reason)) {
    return true;
  }
  return false;
}

export function lastSignalCopyPathLabel(detail?: string | null): string | null {
  const reason = stripLastActionPrefix(String(detail || ''));
  const match = reason.match(PATH_NAME_RE);
  return match ? match[1] : null;
}

function pathOwnedWatchReason(
  path: PathWatchId,
  autoStatus?: string | null,
  autoDetail?: string | null
): string | null {
  const status = String(autoStatus || '').toLowerCase();
  if (status !== 'skipped' && status !== 'failed') return null;
  const raw = String(autoDetail || '').trim();
  if (!raw || isIdleWindowLastSignalCopy(raw)) return null;
  const reason = stripLastActionPrefix(raw);
  if (!reason) return null;
  const otherPath = lastSignalCopyPathLabel(reason);
  const own = PATH_OWNED_RE[path];
  if (otherPath && !own.test(otherPath) && !own.test(reason)) return null;
  if (!own.test(reason)) return null;
  return reason;
}

/** Cloud lastTradeAction on the row when no path watch/hold line applies. */
export function homeAutoLastActionCopy(opts: {
  autoDetail?: string | null;
  autoStatus?: string | null;
  phase?: string | null;
}): string | null {
  const detail = String(opts.autoDetail || '').trim();
  if (!detail) return null;
  const status = String(opts.autoStatus || '').toLowerCase();
  const isPlace = status === 'placed' || /^placed\b/i.test(detail) || /^resting\b/i.test(detail);
  if (isPlace) return detail;
  const phase = String(opts.phase || 'live').toLowerCase();
  if (phase && phase !== 'live') return null;
  if (isIdleWindowLastSignalCopy(detail)) return null;
  if (lastSignalCopyPathLabel(detail)) return null;
  const reason = stripLastActionPrefix(detail);
  if (/too rich to lock|^not locked$/i.test(reason)) return null;
  return detail;
}

/** Last ~70s on a TWAP coin. Stays on the row even if Home Buy is showing. */
export function formatTwapWatchLine(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assets: unknown;
  asset: string;
  secondsLeft: number | null;
  autoDetail?: string | null;
  autoStatus?: string | null;
}): string | null {
  if (
    !isTwapLockEnterPath({
      adminEnabled: opts.adminEnabled,
      userEnabled: opts.userEnabled,
      assets: opts.assets,
      asset: opts.asset,
    })
  ) {
    return null;
  }
  const left = opts.secondsLeft;
  if (left == null || !Number.isFinite(left) || left <= 0 || left > TWAP_LOCK_WATCH_SEC) {
    return null;
  }
  const status = String(opts.autoStatus || '');
  if (status === 'placed') return null;
  const owned = pathOwnedWatchReason('twap', opts.autoStatus, opts.autoDetail);
  if (owned) return `TWAP watching · ${owned}`;
  return `TWAP watching · ${Math.round(left)}s left`;
}

/** Watch window on an enabled Last-minute asset. TWAP line wins if both apply. */
export function formatLastMinuteWatchLine(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assetEnabled: boolean;
  asset: string;
  assets?: unknown;
  secondsLeft: number | null;
  watchSeconds?: unknown;
  autoDetail?: string | null;
  autoStatus?: string | null;
}): string | null {
  if (
    !isLastMinuteEnterPath({
      adminEnabled: opts.adminEnabled,
      userEnabled: opts.userEnabled,
      assetEnabled: opts.assetEnabled,
      asset: opts.asset,
      assets: opts.assets,
    })
  ) {
    return null;
  }
  const left = opts.secondsLeft;
  const watchSec = normalizeLastMinuteWatchSeconds(opts.watchSeconds);
  if (left == null || !Number.isFinite(left) || left <= 0 || left > watchSec) {
    return null;
  }
  const status = String(opts.autoStatus || '');
  if (status === 'placed') return null;
  const owned = pathOwnedWatchReason('last_minute', opts.autoStatus, opts.autoDetail);
  if (owned) return `Last-minute watching · ${owned}`;
  return `Last-minute watching · ${Math.round(left)}s left`;
}

export function formatStepBuyWatchLine(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assetEnabled: boolean;
  asset: string;
  assets?: unknown;
  secondsLeft: number | null;
  minutesElapsed?: number | null;
  startMinutes?: unknown;
  holding?: boolean;
  autoDetail?: string | null;
  autoStatus?: string | null;
}): string | null {
  if (
    !isStepBuyEnterPath({
      adminEnabled: opts.adminEnabled,
      userEnabled: opts.userEnabled,
      assetEnabled: opts.assetEnabled,
      asset: opts.asset,
      assets: opts.assets,
    })
  ) {
    return null;
  }
  const left = opts.secondsLeft;
  if (left == null || !Number.isFinite(left) || left <= 0) return null;
  const started =
    opts.holding === true ||
    (Number(opts.minutesElapsed) || 0) + 1e-9 >= normalizeStepBuyStartMinutes(opts.startMinutes);
  if (!started) return null;
  const status = String(opts.autoStatus || '');
  if (status === 'placed') return null;
  const owned = pathOwnedWatchReason('step_buy', opts.autoStatus, opts.autoDetail);
  if (owned) return `Step buy watching · ${owned}`;
  return null;
}

export function formatSpikeFadeWatchLine(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assetEnabled: boolean;
  asset: string;
  assets?: unknown;
  secondsLeft: number | null;
  minutesElapsed?: number | null;
  startMinutes?: unknown;
  untilMinutes?: unknown;
  holding?: boolean;
  autoDetail?: string | null;
  autoStatus?: string | null;
}): string | null {
  if (
    !isSpikeFadeEnterPath({
      adminEnabled: opts.adminEnabled,
      userEnabled: opts.userEnabled,
      assetEnabled: opts.assetEnabled,
      asset: opts.asset,
      assets: opts.assets,
    })
  ) {
    return null;
  }
  const left = opts.secondsLeft;
  if (left == null || !Number.isFinite(left) || left <= 0) return null;
  const inWindow =
    opts.holding === true ||
    isSpikeFadeEnterWindow({
      minutesElapsed: opts.minutesElapsed,
      startMinutes: opts.startMinutes,
      untilMinutes: opts.untilMinutes,
    });
  if (!inWindow) return null;
  const status = String(opts.autoStatus || '');
  if (status === 'placed') return null;
  const owned = pathOwnedWatchReason('spike_fade', opts.autoStatus, opts.autoDetail);
  if (owned) return `Spike fade watching · ${owned}`;
  return null;
}

export function formatPairLockWatchLine(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assetEnabled: boolean;
  asset: string;
  assets?: unknown;
  secondsLeft: number | null;
  minutesElapsed?: number | null;
  startMinutes?: unknown;
  untilMinutes?: unknown;
  holding?: boolean;
  autoDetail?: string | null;
  autoStatus?: string | null;
}): string | null {
  if (
    !isPairLockEnterPath({
      adminEnabled: opts.adminEnabled,
      userEnabled: opts.userEnabled,
      assetEnabled: opts.assetEnabled,
      asset: opts.asset,
      assets: opts.assets,
    })
  ) {
    return null;
  }
  const left = opts.secondsLeft;
  if (left == null || !Number.isFinite(left) || left <= 0) return null;
  const inWindow =
    opts.holding === true ||
    isPairLockEnterWindow({
      minutesElapsed: opts.minutesElapsed,
      startMinutes: opts.startMinutes,
      untilMinutes: opts.untilMinutes,
    });
  if (!inWindow) return null;
  const status = String(opts.autoStatus || '');
  if (status === 'placed') return null;
  const owned = pathOwnedWatchReason('pair_lock', opts.autoStatus, opts.autoDetail);
  if (owned) return `Pair lock watching · ${owned}`;
  return null;
}

export function formatCapLockWatchLine(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assetEnabled: boolean;
  asset: string;
  assets?: unknown;
  secondsLeft: number | null;
  minutesElapsed?: number | null;
  minutesRemaining?: number | null;
  windowOpenSeconds?: unknown;
  allowLater?: unknown;
  holding?: boolean;
  lots?: CapLockLotState | null;
  lockedPnlUsd?: number | null;
  autoDetail?: string | null;
  autoStatus?: string | null;
}): string | null {
  if (
    !isCapLockEnterPath({
      adminEnabled: opts.adminEnabled,
      userEnabled: opts.userEnabled,
      assetEnabled: opts.assetEnabled,
      asset: opts.asset,
      assets: opts.assets,
    })
  ) {
    return null;
  }
  const left = opts.secondsLeft;
  if (left == null || !Number.isFinite(left) || left <= 0) return null;
  const inWindow =
    opts.holding === true ||
    isCapLockEnterWindow({
      minutesElapsed: opts.minutesElapsed,
      minutesRemaining: opts.minutesRemaining,
      windowOpenSeconds: opts.windowOpenSeconds,
      allowLater: opts.allowLater,
    });
  if (!inWindow) return null;
  if (opts.lots) return capLockHoldingWatchText(opts.lots, opts.lockedPnlUsd);
  const status = String(opts.autoStatus || '');
  if (status === 'placed') return null;
  const owned = pathOwnedWatchReason('cap_lock', opts.autoStatus, opts.autoDetail);
  if (owned) return `Cap lock · ${owned}`;
  return null;
}

export function formatCheapLoopWatchLine(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assetEnabled: boolean;
  asset: string;
  assets?: unknown;
  minutesElapsed?: number | null;
  minutesLeft?: number | null;
  startMinutes?: unknown;
  flattenMinutes?: unknown;
  takeUsd?: unknown;
  holding?: boolean;
  livePnlUsd?: number | null;
  cooldownSec?: number;
  autoDetail?: string | null;
  autoStatus?: string | null;
}): string | null {
  if (
    !isCheapLoopEnterPath({
      adminEnabled: opts.adminEnabled,
      userEnabled: opts.userEnabled,
      assetEnabled: opts.assetEnabled,
      asset: opts.asset,
      assets: opts.assets,
    }) &&
    !opts.holding
  ) {
    return null;
  }
  if (opts.holding) return cheapLoopHoldingWatchText(opts.takeUsd, opts.livePnlUsd);
  const cool = Number(opts.cooldownSec);
  if (Number.isFinite(cool) && cool > 0) return cheapLoopCooldownWatchText(cool);
  if (
    !isCheapLoopEnterWindow({
      minutesElapsed: opts.minutesElapsed,
      minutesLeft: opts.minutesLeft,
      startMinutes: opts.startMinutes,
      flattenMinutes: opts.flattenMinutes,
    })
  ) {
    return null;
  }
  const status = String(opts.autoStatus || '');
  if (status === 'placed') return null;
  const owned = pathOwnedWatchReason('cheap_loop', opts.autoStatus, opts.autoDetail);
  if (owned) return `Cheap loop watching · ${owned}`;
  return null;
}

export function twapWatchSecondsLeft(closeUtc: unknown, nowMs: number): number | null {
  if (closeUtc == null) return null;
  const close = closeUtc instanceof Date ? closeUtc : new Date(String(closeUtc));
  if (!Number.isFinite(close.getTime())) return null;
  return twapLockSecondsLeft(new Date(nowMs), close);
}

/**
 * One extra line on a Last signals row.
 * TWAP last-minute watch stays on the coin even if Home Buy is showing.
 * Home Buy skip → that skip only (never Auto-trade's skip), even if Buy is hidden.
 * Sell showing → Cloud place/resting detail only (never Auto skip).
 * No Home skip and no button → Auto last action (not a closed path's leftover), or the SKIP reason for this phase.
 */
export function lastSignalExtraLine(opts: {
  manualKind: 'buy' | 'sell' | 'none';
  autoTradeOn: boolean;
  autoDetail?: string | null;
  autoStatus?: string | null;
  decision: string;
  isOpen: boolean;
  noMarket: boolean;
  err?: string;
  tapSkipReason?: string | null;
  phase?: string | null;
  cashOutHolding?: boolean;
  goldFadeHolding?: boolean;
  twapLockHolding?: boolean;
  lastMinuteHolding?: boolean;
  stepBuyHolding?: boolean;
  spikeFadeHolding?: boolean;
  pairLockHolding?: boolean;
  capLockHolding?: boolean;
  cheapLoopHolding?: boolean;
  twapWatchText?: string | null;
  lastMinuteWatchText?: string | null;
  stepBuyWatchText?: string | null;
  spikeFadeWatchText?: string | null;
  pairLockWatchText?: string | null;
  capLockWatchText?: string | null;
  cheapLoopWatchText?: string | null;
  overlapText?: string | null;
}): { testID: 'trade-action' | 'skip-reason'; text: string; placed?: boolean; failed?: boolean } | null {
  if (opts.err || !opts.isOpen || opts.noMarket) return null;
  if (opts.manualKind === 'sell') {
    const detail = String(opts.autoDetail || '').trim();
    const status = String(opts.autoStatus || '');
    const isPlace =
      status === 'placed' || /^placed\b/i.test(detail) || /^resting\b/i.test(detail);
    if (isPlace && detail) {
      return { testID: 'trade-action', text: detail, placed: true };
    }
  }
  if (opts.overlapText) {
    return { testID: 'skip-reason', text: opts.overlapText };
  }
  if (opts.twapLockHolding) {
    return { testID: 'skip-reason', text: 'twap lock is holding this ticket' };
  }
  if (opts.lastMinuteHolding) {
    return { testID: 'skip-reason', text: 'last-minute is holding this ticket' };
  }
  if (opts.stepBuyHolding) {
    return { testID: 'skip-reason', text: 'step buy is holding this ticket' };
  }
  if (opts.spikeFadeHolding) {
    return { testID: 'skip-reason', text: 'spike fade is holding this ticket' };
  }
  if (opts.pairLockHolding) {
    return { testID: 'skip-reason', text: 'pair lock is holding this ticket' };
  }
  if (opts.capLockHolding) {
    return { testID: 'skip-reason', text: 'cap lock is holding this ticket' };
  }
  if (opts.cheapLoopHolding) {
    return { testID: 'skip-reason', text: 'cheap loop is holding this ticket' };
  }
  if (opts.goldFadeHolding) {
    return { testID: 'skip-reason', text: 'gold fade is holding this ticket' };
  }
  if (opts.cashOutHolding) {
    return { testID: 'skip-reason', text: 'cash out is holding this ticket' };
  }
  if (opts.twapWatchText) {
    return { testID: 'skip-reason', text: opts.twapWatchText };
  }
  if (opts.lastMinuteWatchText) {
    return { testID: 'skip-reason', text: opts.lastMinuteWatchText };
  }
  if (opts.stepBuyWatchText) {
    return { testID: 'skip-reason', text: opts.stepBuyWatchText };
  }
  if (opts.spikeFadeWatchText) {
    return { testID: 'skip-reason', text: opts.spikeFadeWatchText };
  }
  if (opts.pairLockWatchText) {
    return { testID: 'skip-reason', text: opts.pairLockWatchText };
  }
  if (opts.capLockWatchText) {
    return { testID: 'skip-reason', text: opts.capLockWatchText };
  }
  if (opts.cheapLoopWatchText) {
    return { testID: 'skip-reason', text: opts.cheapLoopWatchText };
  }
  if (opts.manualKind === 'buy') {
    if (opts.tapSkipReason) return { testID: 'skip-reason', text: opts.tapSkipReason };
    return null;
  }
  if (opts.manualKind === 'sell') {
    const detail = String(opts.autoDetail || '').trim();
    const status = String(opts.autoStatus || '');
    const isPlace =
      status === 'placed' || /^placed\b/i.test(detail) || /^resting\b/i.test(detail);
    if (isPlace && detail) {
      return { testID: 'trade-action', text: detail, placed: true };
    }
    return null;
  }
  if (opts.autoTradeOn) {
    const copy = homeAutoLastActionCopy({
      autoDetail: opts.autoDetail,
      autoStatus: opts.autoStatus,
      phase: opts.phase,
    });
    if (copy) {
      return {
        testID: 'trade-action',
        text: copy,
        placed: opts.autoStatus === 'placed',
        failed: opts.autoStatus === 'failed',
      };
    }
  }
  if (opts.decision === 'SKIP') {
    return { testID: 'skip-reason', text: skipSignalReason(opts.phase) };
  }
  return null;
}


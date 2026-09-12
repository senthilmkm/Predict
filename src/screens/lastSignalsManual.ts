import { TradeRecord } from '../storage/repos';
import { AppConfig, AssetRegistry } from '../config/types';
import { configForHomeBuy } from '../config/normalize';
import { evaluateStaticGate } from '../engine/gates';
import {
  countWindowBuysForTicker,
  formatSkipReason,
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
    phase?: string;
    yes_ask?: number;
    no_ask?: number;
  } | null;
  trades: TradeRecord[];
}): string | null {
  const lean = opts.lean;
  if (!lean || (lean.decision !== 'YES' && lean.decision !== 'NO')) return null;
  try {
    const buyCfg = configForHomeBuy(opts.cfg);
    const ticker = String(lean.market_ticker || '').trim();
    const gate = evaluateStaticGate(
      {
        asset: lean.asset,
        market_ticker: ticker,
        decision: lean.decision,
        live: Number(lean.live) || 0,
        strike: Number(lean.strike) || 0,
        abs_gap: Number(lean.abs_gap) || 0,
        minutes_left: Number(lean.minutes_left) || 0,
        minutes_elapsed: Number(lean.minutes_elapsed) || 0,
        phase: lean.phase === 'ended' ? 'ended' : 'live',
        yes_ask: lean.yes_ask,
        no_ask: lean.no_ask,
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

/** SKIP line on Last signals — only "below cushion" when the 15m book is live. */
export function skipSignalReason(phase?: string | null): string {
  const p = String(phase || 'live').toLowerCase();
  if (p === 'upcoming') return 'next window';
  if (p === 'ended') return 'window ended';
  if (p === 'unknown') return 'window not live';
  return 'below cushion';
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
  if (status === 'skipped') {
    const reason = String(opts.autoDetail || '')
      .replace(/^skipped\s*·\s*/i, '')
      .trim();
    if (reason) return `TWAP watching · ${reason}`;
  }
  if (status === 'failed') {
    const detail = String(opts.autoDetail || '').trim();
    if (detail) return `TWAP watching · ${detail}`;
  }
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
  if (status === 'skipped') {
    const reason = String(opts.autoDetail || '')
      .replace(/^skipped\s*·\s*/i, '')
      .trim();
    if (reason) return `Last-minute watching · ${reason}`;
  }
  if (status === 'failed') {
    const detail = String(opts.autoDetail || '').trim();
    if (detail) return `Last-minute watching · ${detail}`;
  }
  return `Last-minute watching · ${Math.round(left)}s left`;
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
 * No Home skip and no button → Auto-trade last action, or the SKIP reason for this phase.
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
  twapWatchText?: string | null;
  lastMinuteWatchText?: string | null;
}): { testID: 'trade-action' | 'skip-reason'; text: string; placed?: boolean; failed?: boolean } | null {
  if (opts.err || !opts.isOpen || opts.noMarket) return null;
  if (opts.twapLockHolding) {
    return { testID: 'skip-reason', text: 'twap lock is holding this ticket' };
  }
  if (opts.lastMinuteHolding) {
    return { testID: 'skip-reason', text: 'last-minute is holding this ticket' };
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
  if (opts.autoTradeOn && opts.autoDetail) {
    return {
      testID: 'trade-action',
      text: opts.autoDetail,
      placed: opts.autoStatus === 'placed',
      failed: opts.autoStatus === 'failed',
    };
  }
  if (opts.decision === 'SKIP') {
    return { testID: 'skip-reason', text: skipSignalReason(opts.phase) };
  }
  return null;
}


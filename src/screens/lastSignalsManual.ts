import { TradeRecord } from '../storage/repos';
import { AppConfig } from '../config/types';
import { configForHomeBuy } from '../config/normalize';
import { evaluateStaticGate } from '../engine/gates';
import {
  countWindowBuysForTicker,
  formatSkipReason,
} from '../../packages/trading-core/src/gates';

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

/**
 * One extra line on a Last signals row.
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
}): { testID: 'trade-action' | 'skip-reason'; text: string; placed?: boolean; failed?: boolean } | null {
  if (opts.err || !opts.isOpen || opts.noMarket) return null;
  if (opts.cashOutHolding) {
    return { testID: 'skip-reason', text: 'cash out is holding this ticket' };
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


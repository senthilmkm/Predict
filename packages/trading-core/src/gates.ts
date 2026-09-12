import { AppConfig, AssetKey } from './types';
import {
  evaluateSmartBuy,
  isSmartBuyEnabled,
  normalizeSmartBuyMinEdge,
  SpotTick,
} from './smartBuy';

export interface LeanSignal {
  asset: AssetKey;
  market_ticker: string;
  decision: 'YES' | 'NO' | 'SKIP';
  live: number;
  strike: number;
  abs_gap: number;
  minutes_left: number;
  minutes_elapsed?: number;
  phase: 'live' | 'ended';
  yes_ask?: number;
  no_ask?: number;
  yes_bid?: number;
  no_bid?: number;
  /** Kalshi live path for Auto Smart buy. Home Buy ignores this. */
  timeseries?: SpotTick[];
  /** Exact minutes until close (not floored). Falls back to minutes_left. */
  minutes_remaining?: number;
}

export interface GateResult {
  ok: boolean;
  skip_reason?: string;
  asset?: AssetKey;
  decision?: 'YES' | 'NO';
  market_ticker?: string;
  side?: 'bid' | 'ask';
  price?: string;
  count?: string;
  pay_price?: number;
  notional_usd?: number;
  time_in_force?: string;
  config_snapshot?: AppConfig;
}

function money2(n: number): string {
  return (Math.round(n * 10000) / 10000).toFixed(4);
}

/** Home Last-signals amber/green label for a Cloud gate skip. */
export function formatSkipReason(reason: string | undefined): string {
  switch (reason) {
    case 'auto_trade_off':
      return 'auto-trade off';
    case 'asset_disabled':
      return 'asset off';
    case 'window_ended':
      return 'window ended';
    case 'skip_decision':
      return 'SKIP signal';
    case 'minutes_left':
      return 'too little time left';
    case 'minutes_elapsed':
      return 'too early in window';
    case 'below_cushion':
      return 'below cushion';
    case 'max_open':
      return 'max open positions';
    case 'daily_loss_stop':
      return 'daily loss stop';
    case 'max_trades_day':
      return 'max trades/day';
    case 'max_trades_asset_window':
      return 'max trades/asset/15m window';
    case 'ask_too_rich':
      return 'ask too rich';
    case 'smart_buy_no_path':
      return 'need a longer price path';
    case 'smart_buy_gap_dying':
      return 'gap shrinking';
    case 'smart_buy_edge_too_small':
      return 'ticket not a good deal';
    case 'notional_too_small':
      return 'size too small';
    case 'window_locked':
      return 'already traded this window';
    case 'no_client':
      return 'no Kalshi credentials';
    case 'kill_switch':
      return 'kill switch on';
    case 'feature_disabled':
      return 'manual trade off';
    case 'kalshi_paused':
      return 'Kalshi paused after timeout/5xx';
    case 'already_holding':
      return 'already holding this window';
    case 'cash_out_admin_off':
      return 'cash out off';
    case 'cash_out_off':
      return 'cash out off';
    case 'cash_out_asset_off':
      return 'cash out asset off';
    case 'cash_out_invalid_targets':
      return 'cash out bid must beat max ask';
    case 'cash_out_holding_other_path':
      return 'Home or Auto already holding';
    case 'cash_out_no_bid':
      return 'no bid';
    case 'cash_out_spread_wide':
      return 'spread too wide';
    case 'cash_out_thin_bid':
      return 'bid too thin';
    case 'gold_fade_admin_off':
      return 'gold fade off';
    case 'gold_fade_off':
      return 'gold fade off';
    case 'gold_fade_not_gold':
      return 'gold fade off';
    case 'gold_fade_gap_wide':
      return 'gap too wide to fade';
    case 'gold_fade_ask_rich':
      return 'cheap side not cheap';
    case 'gold_fade_spread_wide':
      return 'spread too wide';
    case 'gold_fade_no_cheap_side':
      return 'no cheaper side';
    case 'gold_fade_thin_bid':
      return 'bid too thin';
    case 'gold_fade_holding_other_path':
      return 'Home, Auto, or Cash out already holding';
    case 'gold_fade_too_late':
      return 'too little time left';
    case 'gold_fade_holding':
      return 'gold fade is holding this ticket';
    case 'cash_out_holding':
      return 'cash out is holding this ticket';
    case 'twap_lock_admin_off':
    case 'twap_lock_off':
      return 'twap lock off';
    case 'twap_lock_asset_off':
      return 'twap asset off';
    case 'twap_lock_not_last_minute':
      return 'not last minute';
    case 'twap_lock_not_locked':
      return 'not locked';
    case 'twap_lock_ask_rich':
      return 'ask too rich';
    case 'twap_lock_feed':
      return 'lock feed';
    case 'twap_lock_holding_other_path':
      return 'already holding';
    case 'twap_lock_too_late':
      return 'too late';
    case 'twap_lock_thin_bid':
      return 'bid too thin';
    case 'twap_lock_holding':
      return 'twap lock is holding this ticket';
    case 'last_minute_admin_off':
    case 'last_minute_off':
      return 'last-minute off';
    case 'last_minute_asset_off':
      return 'last-minute asset off';
    case 'last_minute_not_last_minute':
      return 'not last minute';
    case 'last_minute_ask_rich':
      return 'Kalshi ask is above your Last-minute max';
    case 'last_minute_no_ask':
      return 'no ask';
    case 'last_minute_no_favorite':
      return 'no last-minute favorite';
    case 'last_minute_no_close':
      return 'no close time';
    case 'last_minute_twap_owns':
      return 'twap lock owns this coin';
    case 'last_minute_holding_other_path':
      return 'already holding';
    case 'last_minute_thin_bid':
      return 'bid too thin';
    case 'last_minute_stop_window':
      return 'Last-minute stop — no new clips';
    case 'last_minute_max_clips':
      return 'Last-minute max clips';
    case 'last_minute_ladder_wait':
      return 'Last-minute ladder wait';
    case 'last_minute_holding':
      return 'last-minute is holding this ticket';
    case 'last_minute_flip':
      return 'Last-minute flip sell';
    case 'last_minute_no_flip':
      return 'no Last-minute flip';
    case 'last_minute_flip_off':
      return 'Last-minute flip off';
    case 'no_open_fill':
      return 'no open fill to sell';
    case 'market_closed':
      return 'market closed';
    default:
      return reason || 'gate';
  }
}

/** Clamp 1–5. Missing / old per-day values default to 1 (do not inherit 100). */
export function windowBuyCap(risk: { max_trades_per_asset_per_window?: number } | null | undefined): number {
  const n = Number(risk?.max_trades_per_asset_per_window);
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function isCountableWindowBuy(trade: {
  dryRun?: boolean;
  dry_run?: boolean;
  status?: string;
  outcome?: string | null;
  fillCount?: number | null;
  fill_count?: number | null;
  count?: string | number | null;
}): boolean {
  if (trade.dryRun || trade.dry_run) return false;
  const outcome = String(trade.outcome || 'pending');
  if (outcome === 'miss' || outcome === 'dry_run') return false;
  const fills = Number(trade.fillCount ?? trade.fill_count ?? 0);
  if (Number.isFinite(fills) && fills > 0) return true;
  const status = String(trade.status || '');
  if (status === 'CANCELLED') return false;
  const count = Number(trade.count ?? 0);
  if (Number.isFinite(count) && count > 0 && (status === 'FILLED' || status === 'SUBMITTED' || status === 'SETTLED')) {
    return true;
  }
  return status === 'FILLED' || status === 'SUBMITTED' || status === 'SETTLED';
}

export function countWindowBuysForTicker(
  trades: Array<{ ticker?: string; market_ticker?: string } & Parameters<typeof isCountableWindowBuy>[0]>,
  marketTicker: string
): number {
  const ticker = String(marketTicker || '').trim();
  if (!ticker) return 0;
  let n = 0;
  for (const row of trades || []) {
    const rowTicker = String(row?.ticker || row?.market_ticker || '').trim();
    if (rowTicker === ticker && isCountableWindowBuy(row)) n += 1;
  }
  return n;
}

export function evaluateStaticGate(
  lean: LeanSignal,
  cfg: AppConfig,
  opts?: {
    openPositions?: number;
    dailyPnlUsd?: number;
    tradesToday?: number;
    assetTradesInWindow?: number;
    /** Home Buy tap: same risk gates except auto-trade Off. */
    allowWhenAutoTradeOff?: boolean;
  }
): GateResult {
  const openPositions = opts?.openPositions ?? 0;
  const dailyPnl = opts?.dailyPnlUsd ?? 0;
  const tradesToday = opts?.tradesToday ?? 0;
  const assetTradesInWindow = opts?.assetTradesInWindow ?? 0;

  if (!cfg.auto_trade_enabled && !opts?.allowWhenAutoTradeOff) {
    return { ok: false, skip_reason: 'auto_trade_off' };
  }
  if (!cfg.assets_enabled[lean.asset]) {
    return { ok: false, skip_reason: 'asset_disabled' };
  }
  if (lean.phase === 'ended') {
    return { ok: false, skip_reason: 'window_ended' };
  }
  if (lean.decision !== 'YES' && lean.decision !== 'NO') {
    return { ok: false, skip_reason: 'skip_decision' };
  }
  if (lean.minutes_left < cfg.risk.min_minutes_left) {
    return { ok: false, skip_reason: 'minutes_left' };
  }
  const elapsed = Number(lean.minutes_elapsed ?? 0);
  if (elapsed < cfg.risk.min_minutes_elapsed) {
    return { ok: false, skip_reason: 'minutes_elapsed' };
  }

  const cushion = Number(cfg.cushions[lean.asset]);
  if (lean.abs_gap + 1e-9 < cushion) {
    return { ok: false, skip_reason: 'below_cushion' };
  }

  if (openPositions >= cfg.risk.max_open_positions) {
    return { ok: false, skip_reason: 'max_open' };
  }
  if (dailyPnl <= -Math.abs(cfg.risk.daily_loss_stop_usd)) {
    return { ok: false, skip_reason: 'daily_loss_stop' };
  }
  if (tradesToday >= cfg.risk.max_trades_per_day) {
    return { ok: false, skip_reason: 'max_trades_day' };
  }
  if (assetTradesInWindow >= windowBuyCap(cfg.risk)) {
    return { ok: false, skip_reason: 'max_trades_asset_window' };
  }

  let ask = 0.9;
  if (lean.decision === 'YES' && lean.yes_ask != null) ask = Number(lean.yes_ask);
  if (lean.decision === 'NO' && lean.no_ask != null) ask = Number(lean.no_ask);
  ask = Math.min(0.99, Math.max(0.01, ask));

  if (ask > cfg.risk.max_entry_ask_usd + 1e-9) {
    return { ok: false, skip_reason: 'ask_too_rich' };
  }

  // Home Buy tap uses allowWhenAutoTradeOff — Smart buy is Auto-trade only.
  if (isSmartBuyEnabled(cfg.risk) && !opts?.allowWhenAutoTradeOff) {
    const tLeft = Number(
      lean.minutes_remaining != null && Number.isFinite(Number(lean.minutes_remaining))
        ? lean.minutes_remaining
        : lean.minutes_left
    );
    const smart = evaluateSmartBuy({
      live: lean.live,
      strike: lean.strike,
      absGap: lean.abs_gap,
      minutesRemaining: tLeft,
      ask,
      minEdgeUsd: normalizeSmartBuyMinEdge(cfg.risk.smart_buy_min_edge_usd),
      timeseries: lean.timeseries,
    });
    if (!smart.ok) {
      return { ok: false, skip_reason: smart.skip_reason || 'smart_buy_edge_too_small' };
    }
  }

  const chase = Math.max(0, Math.min(0.05, Number(cfg.risk.chase_above_ask_usd) || 0));
  let pay = ask + chase;
  pay = Math.min(cfg.risk.max_entry_ask_usd, pay);
  pay = Math.min(0.99, Math.max(0.01, pay));

  const dollars = Math.min(
    cfg.risk.fixed_dollars_per_trade,
    cfg.risk.max_dollars_per_trade
  );
  let countNum = Math.max(0, Math.floor(dollars / pay + 1e-9));
  if (countNum < 1) {
    return { ok: false, skip_reason: 'notional_too_small' };
  }
  let notional = Math.round(countNum * pay * 100) / 100;
  const maxDollars = Math.min(
    cfg.risk.max_dollars_per_trade,
    cfg.risk.fixed_dollars_per_trade
  );
  while (countNum > 0 && notional > maxDollars + 1e-9) {
    countNum -= 1;
    notional = Math.round(countNum * pay * 100) / 100;
  }
  if (countNum < 1 || notional < cfg.risk.min_dollars_per_trade - 1e-9) {
    return { ok: false, skip_reason: 'notional_too_small' };
  }

  const side: 'bid' | 'ask' = lean.decision === 'YES' ? 'bid' : 'ask';
  const priceNum = lean.decision === 'YES' ? pay : Math.max(0.01, 1 - pay);

  return {
    ok: true,
    asset: lean.asset,
    decision: lean.decision,
    market_ticker: lean.market_ticker,
    side,
    price: money2(priceNum),
    count: String(countNum),
    pay_price: pay,
    notional_usd: notional,
    time_in_force: cfg.risk.time_in_force,
    config_snapshot: cfg,
  };
}

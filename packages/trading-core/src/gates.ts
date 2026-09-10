import { AppConfig, AssetKey } from './types';

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
    /** Home Buy tap: skip min minutes left/elapsed and max entry ask. Chase still applies; pay is not capped by max ask. */
    skipTimingAndMaxAsk?: boolean;
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
  const skipTiming = opts?.skipTimingAndMaxAsk === true;
  if (!skipTiming && lean.minutes_left < cfg.risk.min_minutes_left) {
    return { ok: false, skip_reason: 'minutes_left' };
  }
  const elapsed = Number(lean.minutes_elapsed ?? 0);
  if (!skipTiming && elapsed < cfg.risk.min_minutes_elapsed) {
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

  if (!skipTiming && ask > cfg.risk.max_entry_ask_usd + 1e-9) {
    return { ok: false, skip_reason: 'ask_too_rich' };
  }

  const chase = Math.max(0, Math.min(0.05, Number(cfg.risk.chase_above_ask_usd) || 0));
  let pay = ask + chase;
  if (!skipTiming) {
    pay = Math.min(cfg.risk.max_entry_ask_usd, pay);
  }
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
    time_in_force: skipTiming
      ? cfg.risk.manual_buy_time_in_force || 'immediate_or_cancel'
      : cfg.risk.time_in_force,
    config_snapshot: cfg,
  };
}

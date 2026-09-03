import { AppConfig, AssetKey } from '../config/types';
import { snapshotConfig } from '../config/normalize';

export interface LeanSignal {
  asset: AssetKey;
  market_ticker: string;
  decision: 'YES' | 'NO' | 'SKIP';
  live: number;
  strike: number;
  abs_gap: number;
  minutes_left: number;
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

/**
 * Static-cushion gate aligned with Kalshi / Predict Tab risk fields.
 */
export function evaluateStaticGate(
  lean: LeanSignal,
  cfgIn: AppConfig,
  opts?: {
    openPositions?: number;
    dailyPnlUsd?: number;
    tradesToday?: number;
    assetTradesToday?: number;
  }
): GateResult {
  const cfg = snapshotConfig(cfgIn);
  const openPositions = opts?.openPositions ?? 0;
  const dailyPnl = opts?.dailyPnlUsd ?? 0;
  const tradesToday = opts?.tradesToday ?? 0;
  const assetTradesToday = opts?.assetTradesToday ?? 0;

  if (!cfg.auto_trade_enabled) {
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
  if (assetTradesToday >= cfg.risk.max_trades_per_asset_per_day) {
    return { ok: false, skip_reason: 'max_trades_asset_day' };
  }

  let ask = 0.9;
  if (lean.decision === 'YES' && lean.yes_ask != null) ask = Number(lean.yes_ask);
  if (lean.decision === 'NO' && lean.no_ask != null) ask = Number(lean.no_ask);
  ask = Math.min(0.99, Math.max(0.01, ask));

  if (ask > cfg.risk.max_entry_ask_usd + 1e-9) {
    return { ok: false, skip_reason: 'ask_too_rich' };
  }

  const chase = Math.max(0, Math.min(0.05, Number(cfg.risk.chase_above_ask_usd) || 0));
  let pay = Math.min(cfg.risk.max_entry_ask_usd, ask + chase);
  pay = Math.min(0.99, Math.max(0.01, pay));

  const dollars = Math.min(
    cfg.risk.fixed_dollars_per_trade,
    cfg.risk.max_dollars_per_trade
  );
  // Size by economic pay (YES ask or NO ask) — never spend more than dollars/max
  let countNum = Math.max(0, Math.floor(dollars / pay + 1e-9));
  if (countNum < 1) {
    return { ok: false, skip_reason: 'notional_too_small' };
  }
  let notional = Math.round(countNum * pay * 100) / 100;
  // Hard clamp (matches desktop): if float edge pushes over max, drop contracts
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

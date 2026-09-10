import { AppConfig, RiskConfig, TimeInForce } from './types';

/** Account-level caps — one Kalshi book. Same values for Home Buy and Auto-trade. */
export const SHARED_RISK_KEYS = [
  'max_open_positions',
  'max_trades_per_day',
  'max_trades_per_asset_per_window',
  'daily_loss_stop_usd',
] as const;

/** Size + timing that can differ per path. */
export const PATH_RISK_KEYS = [
  'fixed_dollars_per_trade',
  'max_dollars_per_trade',
  'min_dollars_per_trade',
  'min_minutes_left',
  'min_minutes_elapsed',
  'max_entry_ask_usd',
  'time_in_force',
  'chase_above_ask_usd',
] as const;

export type SharedRiskKey = (typeof SHARED_RISK_KEYS)[number];
export type PathRiskKey = (typeof PATH_RISK_KEYS)[number];

export type ManualPathRisk = Pick<RiskConfig, PathRiskKey>;

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function snap(n: number, step: number): number {
  if (step <= 0) return n;
  const rounded = Math.round(n / step) * step;
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  return Number(rounded.toFixed(decimals));
}

function normalizeTif(raw: string | undefined | null): TimeInForce {
  const t = String(raw || '').toLowerCase();
  if (t === 'good_till_canceled' || t === 'gtc') return 'good_till_canceled';
  if (t === 'fill_or_kill' || t === 'fok') return 'fill_or_kill';
  return 'immediate_or_cancel';
}

export function pathRiskFromRisk(risk: RiskConfig, tif?: TimeInForce | null): ManualPathRisk {
  return {
    fixed_dollars_per_trade: risk.fixed_dollars_per_trade,
    max_dollars_per_trade: risk.max_dollars_per_trade,
    min_dollars_per_trade: risk.min_dollars_per_trade,
    min_minutes_left: risk.min_minutes_left,
    min_minutes_elapsed: risk.min_minutes_elapsed,
    max_entry_ask_usd: risk.max_entry_ask_usd,
    time_in_force: tif || risk.time_in_force,
    chase_above_ask_usd: risk.chase_above_ask_usd,
  };
}

export function hasPathShape(raw: Partial<ManualPathRisk> | null | undefined): boolean {
  if (!raw || typeof raw !== 'object') return false;
  return PATH_RISK_KEYS.some((k) => raw[k] != null);
}

/** Seed Home Buy from today's single Risk blob (including legacy manual TIF). */
export function normalizeManualPathRisk(
  raw: Partial<ManualPathRisk> | null | undefined,
  fallbackRisk: RiskConfig
): ManualPathRisk {
  const seedTif = normalizeTif(fallbackRisk.manual_buy_time_in_force || fallbackRisk.time_in_force);
  const src = hasPathShape(raw) ? raw! : pathRiskFromRisk(fallbackRisk, seedTif);
  const d = pathRiskFromRisk(fallbackRisk, seedTif);
  const path: ManualPathRisk = {
    fixed_dollars_per_trade: clamp(Number(src.fixed_dollars_per_trade ?? d.fixed_dollars_per_trade), 1, 500),
    max_dollars_per_trade: clamp(Number(src.max_dollars_per_trade ?? d.max_dollars_per_trade), 1, 500),
    min_dollars_per_trade: clamp(Number(src.min_dollars_per_trade ?? d.min_dollars_per_trade), 1, 500),
    min_minutes_left: Math.round(clamp(Number(src.min_minutes_left ?? d.min_minutes_left), 0, 14)),
    min_minutes_elapsed: Math.round(
      clamp(Number(src.min_minutes_elapsed ?? d.min_minutes_elapsed), 0, 10)
    ),
    max_entry_ask_usd: clamp(Number(src.max_entry_ask_usd ?? d.max_entry_ask_usd), 0.5, 0.99),
    time_in_force: normalizeTif(src.time_in_force ?? d.time_in_force),
    chase_above_ask_usd: snap(clamp(Number(src.chase_above_ask_usd ?? d.chase_above_ask_usd), 0, 0.05), 0.01),
  };
  if (path.fixed_dollars_per_trade > path.max_dollars_per_trade) {
    path.fixed_dollars_per_trade = path.max_dollars_per_trade;
  }
  if (path.min_dollars_per_trade > path.max_dollars_per_trade) {
    path.min_dollars_per_trade = path.max_dollars_per_trade;
  }
  return path;
}

/**
 * Gate config for a Home Buy tap: shared caps + Home Buy size/timing/TIF/chase.
 * Protect money stays on Auto-trade risk.
 */
export function configForHomeBuy(cfg: AppConfig): AppConfig {
  const manual = normalizeManualPathRisk(cfg.manual_risk, cfg.risk);
  return {
    ...cfg,
    manual_risk: manual,
    risk: {
      ...cfg.risk,
      ...manual,
      manual_buy_time_in_force: manual.time_in_force,
    },
  };
}

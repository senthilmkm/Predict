import {
  AppConfig,
  AssetKey,
  CUSHION_BOUNDS,
  DEFAULT_CUSHIONS,
  defaultAppConfig,
  ExecutionMode,
  POLL_INTERVAL_DEFAULT_SEC,
  POLL_INTERVAL_MAX_SEC,
  POLL_INTERVAL_MIN_SEC,
  ALERT_RETENTION_DEFAULT_DAYS,
  ALERT_RETENTION_MAX_DAYS,
  ALERT_RETENTION_MIN_DAYS,
  RiskConfig,
  TimeInForce,
} from './types';
import { DEFAULT_RISK_CONFIG } from './riskDefaults';

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function snap(n: number, step: number): number {
  if (step <= 0) return n;
  const rounded = Math.round(n / step) * step;
  const decimals = String(step).includes('.')
    ? String(step).split('.')[1].length
    : 0;
  return Number(rounded.toFixed(decimals));
}

export function clampCushion(asset: AssetKey, value: number): number {
  const b = CUSHION_BOUNDS[asset];
  return snap(clamp(value, b.min, b.max), b.step);
}

export function clampPollIntervalSeconds(raw: number): number {
  return Math.round(
    clamp(Number(raw) || POLL_INTERVAL_DEFAULT_SEC, POLL_INTERVAL_MIN_SEC, POLL_INTERVAL_MAX_SEC)
  );
}

export function clampAlertRetentionDays(raw: number): number {
  return Math.round(
    clamp(
      Number(raw) || ALERT_RETENTION_DEFAULT_DAYS,
      ALERT_RETENTION_MIN_DAYS,
      ALERT_RETENTION_MAX_DAYS
    )
  );
}

export function normalizeTimeInForce(raw: string | undefined | null): TimeInForce {
  const t = String(raw || '').toLowerCase();
  if (t === 'good_till_canceled' || t === 'gtc') return 'good_till_canceled';
  if (t === 'fill_or_kill' || t === 'fok') return 'fill_or_kill';
  return 'immediate_or_cancel';
}

/** dry_run migrated away — treat as off. */
export function normalizeExecutionMode(raw: string | undefined | null): ExecutionMode {
  const m = String(raw || '').toLowerCase();
  if (m === 'live') return 'live';
  return 'off';
}

export function normalizeRiskConfig(raw: Partial<RiskConfig> | null | undefined): RiskConfig {
  const d = DEFAULT_RISK_CONFIG;
  const r = raw || {};
  const risk: RiskConfig = {
    fixed_dollars_per_trade: clamp(Number(r.fixed_dollars_per_trade ?? d.fixed_dollars_per_trade), 1, 500),
    max_dollars_per_trade: clamp(Number(r.max_dollars_per_trade ?? d.max_dollars_per_trade), 1, 500),
    min_dollars_per_trade: clamp(Number(r.min_dollars_per_trade ?? d.min_dollars_per_trade), 1, 500),
    max_open_positions: Math.round(clamp(Number(r.max_open_positions ?? d.max_open_positions), 1, 50)),
    max_trades_per_day: Math.round(
      clamp(Number(r.max_trades_per_day ?? d.max_trades_per_day), 1, 50000)
    ),
    max_trades_per_asset_per_day: Math.round(
      clamp(Number(r.max_trades_per_asset_per_day ?? d.max_trades_per_asset_per_day), 1, 5000)
    ),
    daily_loss_stop_usd: clamp(Number(r.daily_loss_stop_usd ?? d.daily_loss_stop_usd), 1, 10000),
    min_minutes_left: Math.round(clamp(Number(r.min_minutes_left ?? d.min_minutes_left), 0, 14)),
    min_minutes_elapsed: Math.round(
      clamp(Number(r.min_minutes_elapsed ?? d.min_minutes_elapsed), 0, 10)
    ),
    max_entry_ask_usd: clamp(Number(r.max_entry_ask_usd ?? d.max_entry_ask_usd), 0.5, 0.99),
    time_in_force: normalizeTimeInForce(r.time_in_force ?? d.time_in_force),
    chase_above_ask_usd: snap(
      clamp(Number(r.chase_above_ask_usd ?? d.chase_above_ask_usd), 0, 0.05),
      0.01
    ),
    protect_sell_enabled: Boolean(
      r.protect_sell_enabled ?? d.protect_sell_enabled
    ),
    protect_sell_gap_ratio: snap(
      clamp(Number(r.protect_sell_gap_ratio ?? d.protect_sell_gap_ratio), 0.5, 3),
      0.25
    ),
    protect_sell_grace_seconds: Math.round(
      snap(clamp(Number(r.protect_sell_grace_seconds ?? d.protect_sell_grace_seconds), 0, 120), 15)
    ),
  };
  if (risk.fixed_dollars_per_trade > risk.max_dollars_per_trade) {
    risk.fixed_dollars_per_trade = risk.max_dollars_per_trade;
  }
  if (risk.min_dollars_per_trade > risk.max_dollars_per_trade) {
    risk.min_dollars_per_trade = risk.max_dollars_per_trade;
  }
  return risk;
}

/** Immutable normalize — never mutates input. */
export function normalizeAppConfig(raw: Partial<AppConfig> | null | undefined): AppConfig {
  const d = defaultAppConfig();
  if (!raw) return d;

  const cushions = { ...DEFAULT_CUSHIONS };
  for (const asset of Object.keys(DEFAULT_CUSHIONS) as AssetKey[]) {
    const v = Number((raw.cushions as any)?.[asset] ?? DEFAULT_CUSHIONS[asset]);
    cushions[asset] = clampCushion(asset, v);
  }

  const assets_enabled = { ...d.assets_enabled };
  for (const asset of Object.keys(assets_enabled) as AssetKey[]) {
    const v = (raw.assets_enabled as any)?.[asset];
    if (typeof v === 'boolean') assets_enabled[asset] = v;
  }

  const risk = normalizeRiskConfig(raw.risk);

  const alert_prefs = { ...d.alert_prefs };
  if (raw.alert_prefs) {
    for (const k of Object.keys(alert_prefs) as (keyof typeof alert_prefs)[]) {
      const p = (raw.alert_prefs as any)[k];
      if (p && typeof p === 'object') {
        alert_prefs[k] = {
          enabled: p.enabled !== false,
          push: p.push !== false,
        };
      }
    }
  }

  const legacyDry = String(raw.execution_mode || '').toLowerCase() === 'dry_run';
  let auto_trade_enabled = Boolean(raw.auto_trade_enabled);
  if (legacyDry) auto_trade_enabled = false;

  return {
    version: 1,
    alerts_enabled: raw.alerts_enabled !== false,
    auto_trade_enabled,
    execution_mode: auto_trade_enabled ? 'live' : 'off',
    live_armed: auto_trade_enabled,
    poll_interval_seconds: clampPollIntervalSeconds(
      Number((raw as any).poll_interval_seconds ?? d.poll_interval_seconds)
    ),
    alert_retention_days: clampAlertRetentionDays(
      Number((raw as any).alert_retention_days ?? d.alert_retention_days)
    ),
    cushions,
    assets_enabled,
    risk,
    alert_prefs,
  };
}

export function snapshotConfig(cfg: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(cfg)) as AppConfig;
}

export function shouldPushAlert(cfg: AppConfig, kind: keyof AppConfig['alert_prefs']): boolean {
  if (!cfg.alerts_enabled) return false;
  const pref = cfg.alert_prefs[kind];
  if (!pref || !pref.enabled || !pref.push) return false;
  return true;
}

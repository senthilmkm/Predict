import assetsData from './assets.json';

export type AssetKey = string;

export interface AssetDefinition {
  key: string;
  name: string;
  seriesTicker: string;
  pythFeedId: string;
  defaultCushion: number;
  cushionBounds: { min: number; max: number; step: number };
  enabled?: boolean;
}

const rawAssets = assetsData as AssetDefinition[];
export const ALL_ASSETS_CATALOG: AssetDefinition[] = rawAssets;
export const ASSETS_CATALOG: AssetDefinition[] = rawAssets.filter((asset) => asset.enabled !== false);

export type ExecutionMode = 'off' | 'live';

export type TimeInForce = 'immediate_or_cancel' | 'good_till_canceled' | 'fill_or_kill';

export type AlertKind =
  | 'lean_signal'
  | 'order_placed'
  | 'order_filled'
  | 'ioc_miss'
  | 'trade_result'
  | 'protect_sell'
  | 'daily_loss_stop'
  | 'error';

export type CushionConfig = Record<string, number>;

export type AssetEnabled = Record<string, boolean>;

export interface RiskConfig {
  fixed_dollars_per_trade: number;
  max_dollars_per_trade: number;
  min_dollars_per_trade: number;
  max_open_positions: number;
  max_trades_per_day: number;
  max_trades_per_asset_per_day: number;
  daily_loss_stop_usd: number;
  min_minutes_left: number;
  min_minutes_elapsed: number;
  max_entry_ask_usd: number;
  time_in_force: TimeInForce;
  chase_above_ask_usd: number;
  protect_sell_enabled: boolean;
  protect_sell_gap_ratio: number;
  protect_sell_grace_seconds: number;
}

export interface AlertPref {
  enabled: boolean;
  push: boolean;
}

export const POLL_INTERVAL_MIN_SEC = 10;
export const POLL_INTERVAL_DEFAULT_SEC = 20;
export const POLL_INTERVAL_MAX_SEC = 120;

export interface AppConfig {
  version: number;
  alerts_enabled: boolean;
  auto_trade_enabled: boolean;
  execution_mode: ExecutionMode;
  live_armed: boolean;
  poll_interval_seconds: number;
  alert_retention_days: number;
  cushions: CushionConfig;
  assets_enabled: AssetEnabled;
  risk: RiskConfig;
  alert_prefs: Record<AlertKind, AlertPref>;
}

export const DEFAULT_CUSHIONS: CushionConfig = ASSETS_CATALOG.reduce((acc, asset) => {
  acc[asset.key] = asset.defaultCushion;
  return acc;
}, {} as CushionConfig);

export const CUSHION_BOUNDS: Record<string, { min: number; max: number; step: number }> =
  ASSETS_CATALOG.reduce((acc, asset) => {
    acc[asset.key] = asset.cushionBounds;
    return acc;
  }, {} as Record<string, { min: number; max: number; step: number }>);

export const ALL_ALERT_KINDS: AlertKind[] = [
  'lean_signal',
  'order_placed',
  'order_filled',
  'ioc_miss',
  'trade_result',
  'protect_sell',
  'daily_loss_stop',
  'error',
];

export function defaultAlertPrefs(): Record<AlertKind, AlertPref> {
  const prefs = {} as Record<AlertKind, AlertPref>;
  for (const k of ALL_ALERT_KINDS) {
    prefs[k] = { enabled: true, push: true };
  }
  return prefs;
}

export function defaultAppConfig(): AppConfig {
  const assetsEnabled = ASSETS_CATALOG.reduce((acc, asset) => {
    acc[asset.key] = true;
    return acc;
  }, {} as AssetEnabled);

  return {
    version: 1,
    alerts_enabled: true,
    auto_trade_enabled: false,
    execution_mode: 'off',
    live_armed: false,
    poll_interval_seconds: POLL_INTERVAL_DEFAULT_SEC,
    alert_retention_days: 30,
    cushions: { ...DEFAULT_CUSHIONS },
    assets_enabled: assetsEnabled,
    risk: {
      fixed_dollars_per_trade: 5,
      max_dollars_per_trade: 5,
      min_dollars_per_trade: 1,
      max_open_positions: 5,
      max_trades_per_day: 100,
      max_trades_per_asset_per_day: 100,
      daily_loss_stop_usd: 50,
      min_minutes_left: 2,
      min_minutes_elapsed: 2,
      max_entry_ask_usd: 0.9,
      time_in_force: 'immediate_or_cancel',
      chase_above_ask_usd: 0.02,
      protect_sell_enabled: false,
      protect_sell_gap_ratio: 1,
      protect_sell_grace_seconds: 45,
    },
    alert_prefs: defaultAlertPrefs(),
  };
}

export interface UserStatusDoc {
  userId: string;
  cloudTradingEnabled: boolean;
  kalshiConfigured: boolean;
  kalshiKeyId?: string;
  state: 'ARMED' | 'DISARMED' | 'KILL_SWITCH';
  disclaimerAccepted?: boolean;
  disclaimerAcceptedAt?: string;
  disclaimerVersion?: string;
  onboardingRecord?: Record<string, any>;
  lastTickAt?: string;
  lastError?: string | null;
  fcmTokens?: string[];
  updatedAt: string;
}

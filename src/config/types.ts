import assetsData from '../../packages/trading-core/src/assets.json';

export type AssetKey = string;

export type AssetCategory = 'Crypto 24/7' | 'CME Commodities' | 'Stock Indices' | 'Forex';

export const ALL_ASSET_CATEGORIES: AssetCategory[] = [
  'Crypto 24/7',
  'CME Commodities',
  'Stock Indices',
  'Forex',
];

export const CATEGORY_ICONS: Record<AssetCategory, string> = {
  'Crypto 24/7': '🪙',
  'CME Commodities': '🛢️',
  'Stock Indices': '📈',
  Forex: '💱',
};

export interface AssetDefinition {
  key: string;
  name: string;
  category: AssetCategory;
  seriesTicker: string;
  pythFeedId: string;
  defaultCushion: number;
  cushionBounds: { min: number; max: number; step: number };
  scheduleType?: 'CME_COMMODITY' | 'CRYPTO_24_7' | string;
  enabled?: boolean;
}

export const ASSETS_CATALOG: AssetDefinition[] = (assetsData as AssetDefinition[]).filter((a) => a.enabled !== false);

export class AssetRegistry {
  static get list(): AssetDefinition[] {
    return ASSETS_CATALOG;
  }
  static get keys(): string[] {
    return ASSETS_CATALOG.map((a) => a.key);
  }
  static get categories(): AssetCategory[] {
    return ALL_ASSET_CATEGORIES;
  }
  static getCategoryIcon(category: AssetCategory | string | undefined): string {
    if (!category) return '🪙';
    return CATEGORY_ICONS[category as AssetCategory] || '🪙';
  }
  static getByCategory(category: AssetCategory): AssetDefinition[] {
    return ASSETS_CATALOG.filter((a) => a.category === category);
  }
  static get byCategoryMap(): Record<AssetCategory, AssetDefinition[]> {
    const map: Record<AssetCategory, AssetDefinition[]> = {
      'Crypto 24/7': [],
      'CME Commodities': [],
      'Stock Indices': [],
      Forex: [],
    };
    for (const asset of ASSETS_CATALOG) {
      const cat = asset.category || 'Crypto 24/7';
      if (!map[cat]) map[cat] = [];
      map[cat].push(asset);
    }
    return map;
  }
  static get(key: string): AssetDefinition | undefined {
    return ASSETS_CATALOG.find((a) => a.key === key);
  }
  static getPythFeedId(key: string): string | undefined {
    return ASSETS_CATALOG.find((a) => a.key === key)?.pythFeedId;
  }
  static getSeriesTicker(key: string): string | undefined {
    return ASSETS_CATALOG.find((a) => a.key === key)?.seriesTicker;
  }
  static getCushionBounds(key: string): { min: number; max: number; step: number } {
    return (
      ASSETS_CATALOG.find((a) => a.key === key)?.cushionBounds || {
        min: 0.05,
        max: 500.0,
        step: 0.01,
      }
    );
  }
  static getScheduleType(key: string): 'CME_COMMODITY' | 'CRYPTO_24_7' | string {
    return ASSETS_CATALOG.find((a) => a.key === key)?.scheduleType || 'CRYPTO_24_7';
  }
  static getDefaultCushions(): Record<string, number> {
    return ASSETS_CATALOG.reduce((acc, asset) => {
      acc[asset.key] = asset.defaultCushion;
      return acc;
    }, {} as Record<string, number>);
  }
  static getDefaultEnabled(): Record<string, boolean> {
    return ASSETS_CATALOG.reduce((acc, asset) => {
      acc[asset.key] = true;
      return acc;
    }, {} as Record<string, boolean>);
  }
}

/** @deprecated dry_run removed from product — persisted values migrate to off */
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
  /**
   * New buys of this asset in the current 15-minute contract (same ticker).
   * Protect-sells do not count. Default 1. Range 1–5.
   */
  max_trades_per_asset_per_window: number;
  daily_loss_stop_usd: number;
  min_minutes_left: number;
  /**
   * Only enter after this many whole minutes have already passed in the 15m window.
   * 0 = allow from the open. Example: 2 = skip the first ~2 noisy minutes.
   */
  min_minutes_elapsed: number;
  /** Auto-trade max ask. Home Buy uses `manual_risk.max_entry_ask_usd`. */
  max_entry_ask_usd: number;
  time_in_force: TimeInForce;
  /** Kept in sync with manual_risk.time_in_force for older Cloud revisions. */
  manual_buy_time_in_force: TimeInForce;
  /** Add to ask for fill aid. Each path caps pay by that path's max_entry_ask. */
  chase_above_ask_usd: number;
  /**
   * When ON: if a held trade faces a strong opposite lean, sell early to protect money
   * instead of waiting for the window to settle.
   */
  protect_sell_enabled: boolean;
  /**
   * Opposite-lean gap must be at least (asset cushion × this ratio) to trigger a protect sell.
   * 1.0 = gap ≥ your cushion against you. Higher = harder to trigger (wait longer).
   */
  protect_sell_gap_ratio: number;
  /**
   * Seconds after a fill before protect-sell may fire. Avoids instant exits on noisy first ticks.
   * After this, sell can happen at any remaining time in the window (not last-minutes-only).
   */
  protect_sell_grace_seconds: number;
  /**
   * Auto-trade only. When On, Cloud also requires our guess to beat the ticket
   * by at least min extra chance. Home Buy ignores this. Missing → On.
   */
  smart_buy_enabled?: boolean;
  /** Dollars of extra chance (our guess − ask). Default $0.08. Range $0.04–$0.15. */
  smart_buy_min_edge_usd?: number;
  cash_out_enabled?: boolean;
  cash_out_enter_pct?: number;
  cash_out_max_ask_usd?: number;
  cash_out_bid_usd?: number;
  /** Sell if held-side bid falls this far below fill. Default $0.05. Range $0.03–$0.10. */
  cash_out_stop_usd?: number;
  /** Skip buy / sell early when bid size < contracts. Default Off. */
  cash_out_skip_thin_bid?: boolean;
  cash_out_assets?: string[];
  gold_fade_enabled?: boolean;
  gold_fade_max_gap_usd?: number;
  gold_fade_max_ask_usd?: number;
  gold_fade_take_usd?: number;
  gold_fade_stop_usd?: number;
  gold_fade_flatten_minutes?: number;
  /** Gold fade Skip thin bid. Missing → inherit cash_out_skip_thin_bid. */
  gold_fade_skip_thin_bid?: boolean;
  twap_lock_enabled?: boolean;
  twap_lock_assets?: string[];
  twap_lock_max_ask_usd?: number;
  /** TWAP lock Skip thin bid. Missing → inherit cash_out_skip_thin_bid. */
  twap_lock_skip_thin_bid?: boolean;
  last_minute_enabled?: boolean;
  last_minute_side?: 'yes' | 'no' | 'both';
  last_minute_max_ask_usd?: number;
  last_minute_watch_seconds?: number;
  last_minute_enter_seconds?: number;
  last_minute_stop_seconds?: number;
  last_minute_ladder_seconds?: number;
  last_minute_clip_count?: number;
  last_minute_max_clips?: number;
  last_minute_both_min_ask?: number;
  last_minute_both_gap?: number;
  last_minute_flip_sell_usd?: number;
  /** Last-minute Skip thin bid. Missing → inherit cash_out_skip_thin_bid. */
  last_minute_skip_thin_bid?: boolean;
  /** Assets on the Last-minute path. Missing → all catalog assets. Empty = no buys. */
  last_minute_assets?: string[];
}

export interface AlertPref {
  enabled: boolean;
  push: boolean;
}

export const POLL_INTERVAL_MIN_SEC = 10;
export const POLL_INTERVAL_DEFAULT_SEC = 20;
export const POLL_INTERVAL_MAX_SEC = 120;

export const ALERT_RETENTION_MIN_DAYS = 1;
export const ALERT_RETENTION_DEFAULT_DAYS = 30;
export const ALERT_RETENTION_MAX_DAYS = 365;

export interface ManualPathRisk {
  fixed_dollars_per_trade: number;
  max_dollars_per_trade: number;
  min_dollars_per_trade: number;
  min_minutes_left: number;
  min_minutes_elapsed: number;
  max_entry_ask_usd: number;
  time_in_force: TimeInForce;
  chase_above_ask_usd: number;
}

export interface AppConfig {
  version: number;
  alerts_enabled: boolean;
  auto_trade_enabled: boolean;
  /** Synced with auto_trade: live when on, off when off. */
  execution_mode: ExecutionMode;
  live_armed: boolean;
  /** How often the lean poller runs. Default 20s; minimum 10s. */
  poll_interval_seconds: number;
  /** Keep alert history on device for this many days; older rows auto-delete. */
  alert_retention_days: number;
  cushions: CushionConfig;
  assets_enabled: AssetEnabled;
  risk: RiskConfig;
  /** Home Buy size/timing. Shared caps live on `risk`. */
  manual_risk: ManualPathRisk;
  alert_prefs: Record<AlertKind, AlertPref>;
}

export const DEFAULT_CUSHIONS: CushionConfig = AssetRegistry.getDefaultCushions();

export const CUSHION_BOUNDS: Record<
  string,
  { min: number; max: number; step: number }
> = new Proxy({}, {
  get: (_target, key: string) => AssetRegistry.getCushionBounds(key)
});

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
  return {
    version: 1,
    alerts_enabled: true,
    auto_trade_enabled: false,
    execution_mode: 'off',
    live_armed: false,
    poll_interval_seconds: POLL_INTERVAL_DEFAULT_SEC,
    alert_retention_days: ALERT_RETENTION_DEFAULT_DAYS,
    cushions: { ...DEFAULT_CUSHIONS },
    assets_enabled: AssetRegistry.getDefaultEnabled(),
    // Keep in sync with riskDefaults.ts DEFAULT_RISK_CONFIG (Predict Tab)
    risk: {
      fixed_dollars_per_trade: 5,
      max_dollars_per_trade: 5,
      min_dollars_per_trade: 1,
      max_open_positions: 5,
      max_trades_per_day: 100,
      max_trades_per_asset_per_window: 1,
      daily_loss_stop_usd: 50,
      min_minutes_left: 2,
      min_minutes_elapsed: 2,
      max_entry_ask_usd: 0.9,
      time_in_force: 'immediate_or_cancel',
      manual_buy_time_in_force: 'immediate_or_cancel',
      chase_above_ask_usd: 0.02,
      protect_sell_enabled: false,
      protect_sell_gap_ratio: 1,
      protect_sell_grace_seconds: 45,
      smart_buy_enabled: true,
      smart_buy_min_edge_usd: 0.08,
      cash_out_enabled: false,
      cash_out_enter_pct: 60,
      cash_out_max_ask_usd: 0.82,
      cash_out_bid_usd: 0.88,
      cash_out_stop_usd: 0.05,
      cash_out_skip_thin_bid: false,
      cash_out_assets: ['Gold'],
      gold_fade_enabled: false,
      gold_fade_max_gap_usd: 3,
      gold_fade_max_ask_usd: 0.5,
      gold_fade_take_usd: 0.06,
      gold_fade_stop_usd: 0.05,
      gold_fade_flatten_minutes: 3,
      gold_fade_skip_thin_bid: false,
      twap_lock_enabled: false,
      twap_lock_assets: ['BTC', 'ETH'],
      twap_lock_max_ask_usd: 0.96,
      twap_lock_skip_thin_bid: false,
      last_minute_enabled: false,
      last_minute_side: 'yes',
      last_minute_max_ask_usd: 0.96,
      last_minute_watch_seconds: 150,
      last_minute_enter_seconds: 90,
      last_minute_stop_seconds: 10,
      last_minute_ladder_seconds: 2,
      last_minute_clip_count: 1,
      last_minute_max_clips: 5,
      last_minute_both_min_ask: 0.9,
      last_minute_both_gap: 0.1,
      last_minute_flip_sell_usd: 0,
      last_minute_skip_thin_bid: false,
      last_minute_assets: AssetRegistry.keys,
    },
    manual_risk: {
      fixed_dollars_per_trade: 5,
      max_dollars_per_trade: 5,
      min_dollars_per_trade: 1,
      min_minutes_left: 2,
      min_minutes_elapsed: 2,
      max_entry_ask_usd: 0.9,
      time_in_force: 'immediate_or_cancel',
      chase_above_ask_usd: 0.02,
    },
    alert_prefs: defaultAlertPrefs(),
  };
}

export function modeLabel(cfg: AppConfig): string {
  if (cfg.auto_trade_enabled && cfg.alerts_enabled) return 'Alerts on · auto-trading';
  if (cfg.auto_trade_enabled) return 'Auto-trading · alerts off';
  if (cfg.alerts_enabled) return 'Alerts on · not trading';
  return 'Paused';
}

/** One-line explanation under the Settings status chip. */
export function modeHint(cfg: AppConfig): string {
  if (cfg.auto_trade_enabled && cfg.alerts_enabled) {
    return 'You’ll get lean alerts and Predict may place real Kalshi orders when gates pass.';
  }
  if (cfg.auto_trade_enabled) {
    return 'Orders can place automatically, but lean notifications are muted.';
  }
  if (cfg.alerts_enabled) {
    return 'You’ll be notified of lean signals. No orders are placed until auto-trade is on.';
  }
  return 'No lean alerts and no automatic orders. Turn either control on below.';
}

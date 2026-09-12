import assetsData from './assets.json';

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

const rawAssets = assetsData as AssetDefinition[];
export const ALL_ASSETS_CATALOG: AssetDefinition[] = rawAssets;
export const ASSETS_CATALOG: AssetDefinition[] = rawAssets.filter((asset) => asset.enabled !== false);

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
  static getDefaultCushions(): CushionConfig {
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
  max_trades_per_asset_per_window: number;
  daily_loss_stop_usd: number;
  min_minutes_left: number;
  min_minutes_elapsed: number;
  max_entry_ask_usd: number;
  time_in_force: TimeInForce;
  /** Kept in sync with manual_risk.time_in_force for older Cloud revisions. */
  manual_buy_time_in_force: TimeInForce;
  chase_above_ask_usd: number;
  protect_sell_enabled: boolean;
  protect_sell_gap_ratio: number;
  protect_sell_grace_seconds: number;
  /**
   * Auto-trade only. When On, buy only if model win% − ask ≥ min extra chance.
   * Missing on old docs → On.
   */
  smart_buy_enabled?: boolean;
  /** Dollars of extra chance required. Default 0.08. Range 0.04–0.15. */
  smart_buy_min_edge_usd?: number;
  /** Auto-trade Cash out path. Missing → Off. */
  cash_out_enabled?: boolean;
  /** Percent of the asset cushion required to enter. Default 60. Range 40–100. */
  cash_out_enter_pct?: number;
  /** Do not buy if the ticket ask is above this. Default 0.82. */
  cash_out_max_ask_usd?: number;
  /** Sell when the bid on the held side is at least this. Default 0.88. */
  cash_out_bid_usd?: number;
  /** Sell if held-side bid falls this far below fill. Default 0.05. Range 0.03–0.10. */
  cash_out_stop_usd?: number;
  /** Skip buy / sell early when bid size < contracts. Default Off. */
  cash_out_skip_thin_bid?: boolean;
  /** Assets on the Cash out path. Default Gold. Empty = no Cash out buys. */
  cash_out_assets?: string[];
  /** Auto-trade Gold fade path. Missing → Off. */
  gold_fade_enabled?: boolean;
  /** Enter only if abs gap ≤ this. Default 3. Range 1–6. */
  gold_fade_max_gap_usd?: number;
  /** Cheap-side ask must be ≤ this. Default 0.50. */
  gold_fade_max_ask_usd?: number;
  /** Sell when held bid ≥ fill + this. Default 0.06. */
  gold_fade_take_usd?: number;
  /** Sell when held bid ≤ fill − this. Default 0.05. */
  gold_fade_stop_usd?: number;
  /** Sell all when minutes left ≤ this. Default 3. Range 2–5. */
  gold_fade_flatten_minutes?: number;
  /** Auto-trade TWAP lock path. Missing → Off. */
  twap_lock_enabled?: boolean;
  /** Assets on the TWAP lock path. Default BTC+ETH. Empty = no TWAP buys. */
  twap_lock_assets?: string[];
  /** Do not buy if Yes ask is above this. Default 0.96. Range 0.90–0.97. */
  twap_lock_max_ask_usd?: number;
  /** Last-minute Auto path. Missing → Off. */
  last_minute_enabled?: boolean;
  /** yes | no | both. Default yes. */
  last_minute_side?: 'yes' | 'no' | 'both';
  /** Do not buy if the chosen side’s ask is above this. Default 0.96. Range 0.80–0.99. */
  last_minute_max_ask_usd?: number;
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
  /** Home Buy size/timing. Shared caps live on `risk`. Missing → copied from `risk`. */
  manual_risk?: {
    fixed_dollars_per_trade: number;
    max_dollars_per_trade: number;
    min_dollars_per_trade: number;
    min_minutes_left: number;
    min_minutes_elapsed: number;
    max_entry_ask_usd: number;
    /** Home Last-signals Buy tap. Auto-trade uses time_in_force. Kept in sync with manual_risk. */
    time_in_force: TimeInForce;
    chase_above_ask_usd: number;
  };
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
      twap_lock_enabled: false,
      twap_lock_assets: ['BTC', 'ETH'],
      twap_lock_max_ask_usd: 0.96,
      last_minute_enabled: false,
      last_minute_side: 'yes',
      last_minute_max_ask_usd: 0.96,
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

export type TradeActionStatus = 'placed' | 'skipped' | 'failed' | 'idle';

export interface LastTradeAction {
  status: TradeActionStatus;
  /** Short human label, e.g. "placed YES · 2 @ $0.62" or "skipped · ask too rich" */
  detail: string;
  at: string;
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
  /** Per-asset last Cloud buy attempt. Phone Last signals reads this. */
  lastTradeAction?: Partial<Record<AssetKey, LastTradeAction>>;
  pushTokens?: string[];
  fcmTokens?: string[];
  updatedAt: string;
}

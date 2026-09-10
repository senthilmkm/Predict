/**
 * Bundled risk defaults — mirrored from Command Center Kalshi / Predict tab.
 * Also seeded into phone storage (`foresight.risk.defaults.v3`) so
 * Settings → Restore defaults can reload them offline.
 */
import { RiskConfig, TimeInForce } from './types';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
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
};

export type RiskFieldGroup = 'size' | 'caps' | 'timing';

export const RISK_GROUPS: { id: RiskFieldGroup; label: string }[] = [
  { id: 'size', label: 'Size' },
  { id: 'caps', label: 'Caps' },
  { id: 'timing', label: 'Timing & protect' },
];

export const RISK_FIELD_META: {
  key: keyof RiskConfig;
  label: string;
  group: RiskFieldGroup;
  kind: 'money' | 'int' | 'tif' | 'chase' | 'toggle' | 'ratio' | 'seconds';
  step: number;
  min: number;
  max: number;
}[] = [
  { key: 'fixed_dollars_per_trade', label: '$ per trade', group: 'size', kind: 'money', step: 1, min: 1, max: 500 },
  { key: 'max_dollars_per_trade', label: 'Max $ / trade', group: 'size', kind: 'money', step: 1, min: 1, max: 500 },
  { key: 'min_dollars_per_trade', label: 'Min $ / trade', group: 'size', kind: 'money', step: 1, min: 1, max: 500 },
  { key: 'max_open_positions', label: 'Max open positions', group: 'caps', kind: 'int', step: 1, min: 1, max: 50 },
  { key: 'max_trades_per_day', label: 'Max trades / day', group: 'caps', kind: 'int', step: 1, min: 1, max: 50000 },
  {
    key: 'max_trades_per_asset_per_window',
    label: 'Max trades / asset / 15m window',
    group: 'caps',
    kind: 'int',
    step: 1,
    min: 1,
    max: 5,
  },
  { key: 'daily_loss_stop_usd', label: 'Daily loss stop ($)', group: 'caps', kind: 'money', step: 5, min: 1, max: 10000 },
  { key: 'min_minutes_left', label: 'Min minutes left (Buy only)', group: 'timing', kind: 'int', step: 1, min: 0, max: 14 },
  {
    key: 'min_minutes_elapsed',
    label: 'Min minutes elapsed (Buy only)',
    group: 'timing',
    kind: 'int',
    step: 1,
    min: 0,
    max: 10,
  },
  { key: 'max_entry_ask_usd', label: 'Max entry ask ($) (Buy limit)', group: 'timing', kind: 'chase', step: 0.01, min: 0.5, max: 0.99 },
  { key: 'time_in_force', label: 'Time in force', group: 'timing', kind: 'tif', step: 0, min: 0, max: 0 },
  { key: 'chase_above_ask_usd', label: 'Chase above ask ($)', group: 'timing', kind: 'chase', step: 0.01, min: 0, max: 0.05 },
  {
    key: 'smart_buy_enabled',
    label: 'Smart buy',
    group: 'timing',
    kind: 'toggle',
    step: 0,
    min: 0,
    max: 1,
  },
  {
    key: 'smart_buy_min_edge_usd',
    label: 'Min extra chance ($)',
    group: 'timing',
    kind: 'chase',
    step: 0.01,
    min: 0.04,
    max: 0.15,
  },
  {
    key: 'protect_sell_enabled',
    label: 'Protect money (early sell)',
    group: 'timing',
    kind: 'toggle',
    step: 0,
    min: 0,
    max: 1,
  },
  {
    key: 'protect_sell_gap_ratio',
    label: 'Sell when gap ≥ cushion ×',
    group: 'timing',
    kind: 'ratio',
    step: 0.25,
    min: 0.5,
    max: 3,
  },
  {
    key: 'protect_sell_grace_seconds',
    label: 'Wait after fill before sell',
    group: 'timing',
    kind: 'seconds',
    step: 15,
    min: 0,
    max: 120,
  },
];

export const TIME_IN_FORCE_OPTIONS: { value: TimeInForce; label: string }[] = [
  { value: 'immediate_or_cancel', label: 'IOC' },
  { value: 'good_till_canceled', label: 'GTC' },
  { value: 'fill_or_kill', label: 'FOK' },
];

export const SHARED_RISK_FIELD_KEYS: (keyof RiskConfig)[] = [
  'max_open_positions',
  'max_trades_per_day',
  'max_trades_per_asset_per_window',
  'daily_loss_stop_usd',
];

export const PATH_RISK_FIELD_KEYS: (keyof RiskConfig)[] = [
  'fixed_dollars_per_trade',
  'max_dollars_per_trade',
  'min_dollars_per_trade',
  'min_minutes_left',
  'min_minutes_elapsed',
  'max_entry_ask_usd',
  'time_in_force',
  'chase_above_ask_usd',
];

export const SMART_BUY_RISK_FIELD_KEYS: (keyof RiskConfig)[] = [
  'smart_buy_enabled',
  'smart_buy_min_edge_usd',
];

export const PROTECT_RISK_FIELD_KEYS: (keyof RiskConfig)[] = [
  'protect_sell_enabled',
  'protect_sell_gap_ratio',
  'protect_sell_grace_seconds',
];

export const AUTO_ONLY_RISK_FIELD_KEYS: (keyof RiskConfig)[] = [
  ...SMART_BUY_RISK_FIELD_KEYS,
  ...PROTECT_RISK_FIELD_KEYS,
];

export function cloneDefaultRisk(): RiskConfig {
  return { ...DEFAULT_RISK_CONFIG };
}

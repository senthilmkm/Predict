/**
 * Bundled risk defaults — mirrored from Command Center Kalshi / Predict tab.
 * Also seeded into phone storage (`foresight.risk.defaults.v1`) so
 * Settings → Restore defaults can reload them offline.
 */
import { RiskConfig, TimeInForce } from './types';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  fixed_dollars_per_trade: 5,
  max_dollars_per_trade: 5,
  min_dollars_per_trade: 1,
  max_open_positions: 5,
  max_trades_per_day: 100,
  max_trades_per_asset_per_day: 100,
  daily_loss_stop_usd: 50,
  min_minutes_left: 2,
  max_entry_ask_usd: 0.9,
  time_in_force: 'immediate_or_cancel',
  chase_above_ask_usd: 0.02,
  protect_sell_enabled: false,
  protect_sell_gap_ratio: 1,
  protect_sell_grace_seconds: 45,
};

export const RISK_FIELD_META: {
  key: keyof RiskConfig;
  label: string;
  kind: 'money' | 'int' | 'tif' | 'chase' | 'toggle' | 'ratio' | 'seconds';
  step: number;
  min: number;
  max: number;
}[] = [
  { key: 'fixed_dollars_per_trade', label: '$ per trade', kind: 'money', step: 1, min: 1, max: 500 },
  { key: 'max_dollars_per_trade', label: 'Max $ / trade', kind: 'money', step: 1, min: 1, max: 500 },
  { key: 'min_dollars_per_trade', label: 'Min $ / trade', kind: 'money', step: 1, min: 1, max: 500 },
  { key: 'max_open_positions', label: 'Max open positions', kind: 'int', step: 1, min: 1, max: 50 },
  { key: 'max_trades_per_day', label: 'Max trades / day', kind: 'int', step: 1, min: 1, max: 50000 },
  {
    key: 'max_trades_per_asset_per_day',
    label: 'Max trades / asset / day',
    kind: 'int',
    step: 1,
    min: 1,
    max: 5000,
  },
  { key: 'daily_loss_stop_usd', label: 'Daily loss stop ($)', kind: 'money', step: 5, min: 1, max: 10000 },
  { key: 'min_minutes_left', label: 'Min minutes left', kind: 'int', step: 1, min: 0, max: 14 },
  { key: 'max_entry_ask_usd', label: 'Max entry ask ($)', kind: 'chase', step: 0.01, min: 0.5, max: 0.99 },
  { key: 'time_in_force', label: 'Time in force', kind: 'tif', step: 0, min: 0, max: 0 },
  { key: 'chase_above_ask_usd', label: 'Chase above ask ($)', kind: 'chase', step: 0.01, min: 0, max: 0.05 },
  {
    key: 'protect_sell_enabled',
    label: 'Protect money (early sell)',
    kind: 'toggle',
    step: 0,
    min: 0,
    max: 1,
  },
  {
    key: 'protect_sell_gap_ratio',
    label: 'Sell when gap ≥ cushion ×',
    kind: 'ratio',
    step: 0.25,
    min: 0.5,
    max: 3,
  },
  {
    key: 'protect_sell_grace_seconds',
    label: 'Wait after fill before sell',
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

export function cloneDefaultRisk(): RiskConfig {
  return { ...DEFAULT_RISK_CONFIG };
}

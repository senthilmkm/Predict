import {
  clampCushion,
  clampPollIntervalSeconds,
  clampAlertRetentionDays,
  normalizeAppConfig,
  shouldPushAlert,
  snapshotConfig,
} from '../src/config/normalize';
import {
  ALERT_RETENTION_DEFAULT_DAYS,
  defaultAppConfig,
  POLL_INTERVAL_DEFAULT_SEC,
  POLL_INTERVAL_MIN_SEC,
} from '../src/config/types';

describe('normalize / cushions', () => {
  test('clampCushion snaps WTI to step', () => {
    expect(clampCushion('WTI', 0.314)).toBe(0.31);
    expect(clampCushion('WTI', 0.01)).toBe(0.05); // min
    expect(clampCushion('WTI', 9)).toBe(2); // max
  });

  test('clampCushion BTC steps by 5', () => {
    expect(clampCushion('BTC', 177)).toBe(175);
    expect(clampCushion('BTC', 10)).toBe(25);
  });

  test('clampPollIntervalSeconds enforces min 10 default 15', () => {
    expect(clampPollIntervalSeconds(5)).toBe(POLL_INTERVAL_MIN_SEC);
    expect(clampPollIntervalSeconds(NaN)).toBe(POLL_INTERVAL_DEFAULT_SEC);
    expect(clampPollIntervalSeconds(15)).toBe(15);
    expect(clampPollIntervalSeconds(200)).toBe(120);
  });

  test('clampAlertRetentionDays enforces 1–365 default 30', () => {
    expect(clampAlertRetentionDays(0)).toBe(ALERT_RETENTION_DEFAULT_DAYS);
    expect(clampAlertRetentionDays(NaN)).toBe(ALERT_RETENTION_DEFAULT_DAYS);
    expect(clampAlertRetentionDays(-5)).toBe(1);
    expect(clampAlertRetentionDays(30)).toBe(30);
    expect(clampAlertRetentionDays(400)).toBe(365);
  });

  test('normalizeAppConfig defaults alert_retention_days', () => {
    const cfg = normalizeAppConfig({} as any);
    expect(cfg.alert_retention_days).toBe(ALERT_RETENTION_DEFAULT_DAYS);
  });

  test('normalizeAppConfig migrates dry_run → auto off; clamps risk', () => {
    const cfg = normalizeAppConfig({
      auto_trade_enabled: true,
      execution_mode: 'dry_run' as any,
      poll_interval_seconds: 5,
      risk: {
        fixed_dollars_per_trade: 999,
        max_dollars_per_trade: 10,
        daily_loss_stop_usd: 0,
        max_open_positions: 100,
        max_trades_per_day: 0,
        chase_above_ask_usd: 0.09,
      },
    } as any);
    expect(cfg.auto_trade_enabled).toBe(false);
    expect(cfg.execution_mode).toBe('off');
    expect(cfg.poll_interval_seconds).toBe(POLL_INTERVAL_MIN_SEC);
    expect(cfg.risk.max_dollars_per_trade).toBe(10);
    expect(cfg.risk.fixed_dollars_per_trade).toBe(10);
    expect(cfg.risk.daily_loss_stop_usd).toBe(1);
    expect(cfg.risk.max_open_positions).toBe(50);
    expect(cfg.risk.max_trades_per_day).toBe(1);
    expect(cfg.risk.chase_above_ask_usd).toBe(0.05);
    expect(cfg.risk.min_dollars_per_trade).toBe(1);
    expect(cfg.risk.time_in_force).toBe('immediate_or_cancel');
    expect(cfg.risk.protect_sell_enabled).toBe(false);
    expect(cfg.risk.protect_sell_gap_ratio).toBe(1);
    expect(cfg.risk.protect_sell_grace_seconds).toBe(45);
  });

  test('normalizeRiskConfig clamps protect sell ratio and grace', () => {
    const cfg = normalizeAppConfig({
      risk: {
        protect_sell_enabled: true,
        protect_sell_gap_ratio: 9,
        protect_sell_grace_seconds: 999,
      },
    } as any);
    expect(cfg.risk.protect_sell_enabled).toBe(true);
    expect(cfg.risk.protect_sell_gap_ratio).toBe(3);
    expect(cfg.risk.protect_sell_grace_seconds).toBe(120);
  });

  test('snapshotConfig is deep copy', () => {
    const a = defaultAppConfig();
    const b = snapshotConfig(a);
    b.cushions.WTI = 1.11;
    expect(a.cushions.WTI).not.toBe(1.11);
  });

  test('shouldPushAlert mute matrix', () => {
    const cfg = defaultAppConfig();
    expect(shouldPushAlert(cfg, 'lean_signal')).toBe(true);
    cfg.alerts_enabled = false;
    expect(shouldPushAlert(cfg, 'lean_signal')).toBe(false);
    cfg.alerts_enabled = true;
    cfg.alert_prefs.lean_signal.push = false;
    expect(shouldPushAlert(cfg, 'lean_signal')).toBe(false);
    cfg.alert_prefs.lean_signal.push = true;
    cfg.alert_prefs.lean_signal.enabled = false;
    expect(shouldPushAlert(cfg, 'lean_signal')).toBe(false);
  });
});

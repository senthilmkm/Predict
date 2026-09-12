import {
  clampCushion,
  clampPollIntervalSeconds,
  clampAlertRetentionDays,
  normalizeAppConfig,
  shouldPushAlert,
  snapshotConfig,
  isCloudOwnedAlertSound,
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

  test('clampPollIntervalSeconds enforces min 10 default 20', () => {
    expect(clampPollIntervalSeconds(5)).toBe(POLL_INTERVAL_MIN_SEC);
    expect(clampPollIntervalSeconds(NaN)).toBe(POLL_INTERVAL_DEFAULT_SEC);
    expect(clampPollIntervalSeconds(20)).toBe(20);
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
    expect(cfg.risk.max_trades_per_asset_per_window).toBe(1);
    expect(cfg.risk.chase_above_ask_usd).toBe(0.05);
    expect(cfg.risk.min_dollars_per_trade).toBe(1);
    expect(cfg.risk.time_in_force).toBe('immediate_or_cancel');
    expect(cfg.risk.manual_buy_time_in_force).toBe('immediate_or_cancel');
    expect(cfg.manual_risk.time_in_force).toBe('immediate_or_cancel');
    expect(cfg.manual_risk.max_entry_ask_usd).toBe(0.9);
    expect(cfg.risk.protect_sell_enabled).toBe(false);
    expect(cfg.risk.protect_sell_gap_ratio).toBe(1);
    expect(cfg.risk.protect_sell_grace_seconds).toBe(45);
    expect(cfg.risk.smart_buy_enabled).toBe(true);
    expect(cfg.risk.smart_buy_min_edge_usd).toBe(0.08);
  });

  test('old max_trades_per_asset_per_day is ignored; window cap defaults to 1 and clamps 1–5', () => {
    expect(
      normalizeAppConfig({
        risk: { max_trades_per_asset_per_day: 100 },
      } as any).risk.max_trades_per_asset_per_window
    ).toBe(1);
    expect(
      normalizeAppConfig({
        risk: { max_trades_per_asset_per_window: 2 },
      } as any).risk.max_trades_per_asset_per_window
    ).toBe(2);
    expect(
      normalizeAppConfig({
        risk: { max_trades_per_asset_per_window: 99 },
      } as any).risk.max_trades_per_asset_per_window
    ).toBe(5);
    expect(defaultAppConfig().risk.max_trades_per_asset_per_window).toBe(1);
    expect((defaultAppConfig().risk as any).max_trades_per_asset_per_day).toBeUndefined();
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

  test('normalizeRiskConfig defaults Smart buy On and clamps min extra chance', () => {
    expect(normalizeAppConfig({} as any).risk.smart_buy_enabled).toBe(true);
    expect(normalizeAppConfig({} as any).risk.smart_buy_min_edge_usd).toBe(0.08);
    const off = normalizeAppConfig({
      risk: { smart_buy_enabled: false, smart_buy_min_edge_usd: 0.01 },
    } as any);
    expect(off.risk.smart_buy_enabled).toBe(false);
    expect(off.risk.smart_buy_min_edge_usd).toBe(0.04);
    const hi = normalizeAppConfig({
      risk: { smart_buy_min_edge_usd: 0.99 },
    } as any);
    expect(hi.risk.smart_buy_enabled).toBe(true);
    expect(hi.risk.smart_buy_min_edge_usd).toBe(0.15);
  });

  test('normalizeRiskConfig defaults Cash out Off and keeps bid above max ask', () => {
    const d = normalizeAppConfig({} as any).risk;
    expect(d.cash_out_enabled).toBe(false);
    expect(d.cash_out_enter_pct).toBe(60);
    expect(d.cash_out_max_ask_usd).toBe(0.82);
    expect(d.cash_out_bid_usd).toBe(0.88);
    expect(d.cash_out_stop_usd).toBe(0.05);
    expect(d.cash_out_skip_thin_bid).toBe(false);
    expect(d.gold_fade_enabled).toBe(false);
    expect(d.gold_fade_max_gap_usd).toBe(3);
    expect(d.gold_fade_max_ask_usd).toBe(0.5);
    expect(d.gold_fade_take_usd).toBe(0.06);
    expect(d.gold_fade_stop_usd).toBe(0.05);
    expect(d.gold_fade_flatten_minutes).toBe(3);
    expect(d.twap_lock_enabled).toBe(false);
    expect(d.twap_lock_max_ask_usd).toBe(0.96);
    expect(d.twap_lock_assets).toEqual(['BTC', 'ETH']);
    expect(d.last_minute_enabled).toBe(false);
    expect(d.last_minute_side).toBe('yes');
    expect(d.last_minute_max_ask_usd).toBe(0.96);
    expect(d.last_minute_watch_seconds).toBe(150);
    expect(d.last_minute_enter_seconds).toBe(90);
    expect(d.last_minute_stop_seconds).toBe(10);
    expect(d.last_minute_ladder_seconds).toBe(2);
    expect(d.last_minute_clip_count).toBe(1);
    expect(d.last_minute_max_clips).toBe(5);
    expect(d.last_minute_both_min_ask).toBe(0.9);
    expect(d.last_minute_both_gap).toBe(0.1);
    expect(d.last_minute_flip_sell_usd).toBe(0);
    expect(d.last_minute_assets).toEqual(expect.arrayContaining(['Gold', 'BTC', 'ETH']));
    expect(
      normalizeAppConfig({ risk: { last_minute_assets: [] } } as any).risk.last_minute_assets
    ).toEqual([]);
    expect(
      normalizeAppConfig({ risk: { last_minute_assets: ['Gold', 'NOPE'] } } as any).risk
        .last_minute_assets
    ).toEqual(['Gold']);
    expect(d.cash_out_assets).toEqual(['Gold']);
    const fadeOn = normalizeAppConfig({
      risk: { gold_fade_enabled: true, gold_fade_max_gap_usd: 2.4 },
    } as any).risk;
    expect(fadeOn.gold_fade_enabled).toBe(true);
    expect(fadeOn.gold_fade_max_gap_usd).toBe(2.5);
    const twapOn = normalizeAppConfig({
      risk: { twap_lock_enabled: true, twap_lock_max_ask_usd: 0.989, twap_lock_assets: ['BTC', 'Gold'] },
    } as any).risk;
    expect(twapOn.twap_lock_enabled).toBe(true);
    expect(twapOn.twap_lock_max_ask_usd).toBe(0.97);
    expect(twapOn.twap_lock_assets).toEqual(['BTC']);
    const lastMin = normalizeAppConfig({
      risk: { last_minute_enabled: true, last_minute_side: 'BOTH', last_minute_max_ask_usd: 1.2 },
    } as any).risk;
    expect(lastMin.last_minute_enabled).toBe(true);
    expect(lastMin.last_minute_side).toBe('both');
    expect(lastMin.last_minute_max_ask_usd).toBe(0.99);
    const ladder = normalizeAppConfig({
      risk: {
        last_minute_watch_seconds: 200,
        last_minute_enter_seconds: 160,
        last_minute_stop_seconds: 1,
        last_minute_ladder_seconds: 9,
        last_minute_clip_count: 0,
        last_minute_max_clips: 99,
        last_minute_both_min_ask: 0.99,
        last_minute_both_gap: 0.01,
      },
    } as any).risk;
    expect(ladder.last_minute_watch_seconds).toBe(180);
    expect(ladder.last_minute_enter_seconds).toBe(150);
    expect(ladder.last_minute_stop_seconds).toBe(5);
    expect(ladder.last_minute_ladder_seconds).toBe(5);
    expect(ladder.last_minute_clip_count).toBe(1);
    expect(ladder.last_minute_max_clips).toBe(20);
    expect(ladder.last_minute_both_min_ask).toBe(0.95);
    expect(ladder.last_minute_both_gap).toBe(0.05);
    expect(d.gold_fade_skip_thin_bid).toBe(false);
    expect(d.twap_lock_skip_thin_bid).toBe(false);
    expect(d.last_minute_skip_thin_bid).toBe(false);
    expect(d.step_buy_enabled).toBe(false);
    expect(d.step_buy_start_minutes).toBe(5);
    expect(d.step_buy_cushion_pct).toBe(50);
    expect(d.step_buy_lot_count).toBe(1);
    expect(d.step_buy_add_wait_minutes).toBe(1);
    expect(d.step_buy_add_band_usd).toBe(0.02);
    expect(d.step_buy_max_lots).toBe(3);
    expect(d.step_buy_stop_usd).toBe(0.03);
    expect(d.step_buy_max_ask_usd).toBe(0.8);
    expect(d.step_buy_skip_thin_bid).toBe(false);
    expect(d.step_buy_assets).toEqual(expect.arrayContaining(['Gold', 'BTC', 'ETH']));
    expect(normalizeAppConfig({ risk: { step_buy_assets: [] } } as any).risk.step_buy_assets).toEqual([]);
    expect(
      normalizeAppConfig({ risk: { step_buy_assets: ['Gold', 'NOPE'] } } as any).risk.step_buy_assets
    ).toEqual(['Gold']);
    const stepOn = normalizeAppConfig({
      risk: {
        step_buy_enabled: true,
        step_buy_start_minutes: 1,
        step_buy_cushion_pct: 10,
        step_buy_lot_count: 0,
        step_buy_add_wait_minutes: 9,
        step_buy_add_band_usd: 0.09,
        step_buy_max_lots: 99,
        step_buy_stop_usd: 0,
        step_buy_max_ask_usd: 0.99,
      },
    } as any).risk;
    expect(stepOn.step_buy_enabled).toBe(true);
    expect(stepOn.step_buy_start_minutes).toBe(2);
    expect(stepOn.step_buy_cushion_pct).toBe(25);
    expect(stepOn.step_buy_lot_count).toBe(1);
    expect(stepOn.step_buy_add_wait_minutes).toBe(3);
    expect(stepOn.step_buy_add_band_usd).toBe(0.05);
    expect(stepOn.step_buy_max_lots).toBe(8);
    expect(stepOn.step_buy_stop_usd).toBe(0.01);
    expect(stepOn.step_buy_max_ask_usd).toBe(0.9);
    const on = normalizeAppConfig({
      risk: { cash_out_skip_thin_bid: true },
    } as any).risk;
    expect(on.cash_out_skip_thin_bid).toBe(true);
    expect(on.gold_fade_skip_thin_bid).toBe(true);
    expect(on.twap_lock_skip_thin_bid).toBe(true);
    expect(on.last_minute_skip_thin_bid).toBe(true);
    expect(on.step_buy_skip_thin_bid).toBe(true);
    const split = normalizeAppConfig({
      risk: { cash_out_skip_thin_bid: true, gold_fade_skip_thin_bid: false },
    } as any).risk;
    expect(split.gold_fade_skip_thin_bid).toBe(false);
    expect(split.twap_lock_skip_thin_bid).toBe(true);
    const fixed = normalizeAppConfig({
      risk: { cash_out_max_ask_usd: 0.9, cash_out_bid_usd: 0.88, cash_out_enter_pct: 10 },
    } as any).risk;
    expect(Number(fixed.cash_out_bid_usd)).toBeGreaterThan(Number(fixed.cash_out_max_ask_usd));
    expect(fixed.cash_out_enter_pct).toBe(40);
  });

  test('missing manual_risk is seeded from risk, including legacy Home TIF', () => {
    const cfg = normalizeAppConfig({
      risk: {
        fixed_dollars_per_trade: 8,
        max_dollars_per_trade: 10,
        min_minutes_left: 4,
        max_entry_ask_usd: 0.8,
        time_in_force: 'fill_or_kill',
        manual_buy_time_in_force: 'good_till_canceled',
      },
    } as any);
    expect(cfg.manual_risk.fixed_dollars_per_trade).toBe(8);
    expect(cfg.manual_risk.min_minutes_left).toBe(4);
    expect(cfg.manual_risk.max_entry_ask_usd).toBe(0.8);
    expect(cfg.manual_risk.time_in_force).toBe('good_till_canceled');
    expect(cfg.risk.manual_buy_time_in_force).toBe('good_till_canceled');
    expect(cfg.risk.time_in_force).toBe('fill_or_kill');
  });

  test('existing manual_risk stays independent of Auto-trade TIF', () => {
    const cfg = normalizeAppConfig({
      risk: {
        time_in_force: 'fill_or_kill',
        max_entry_ask_usd: 0.7,
      },
      manual_risk: {
        time_in_force: 'good_till_canceled',
        max_entry_ask_usd: 0.95,
        fixed_dollars_per_trade: 5,
        max_dollars_per_trade: 5,
        min_dollars_per_trade: 1,
        min_minutes_left: 0,
        min_minutes_elapsed: 0,
        chase_above_ask_usd: 0.02,
      },
    } as any);
    expect(cfg.manual_risk.time_in_force).toBe('good_till_canceled');
    expect(cfg.manual_risk.max_entry_ask_usd).toBe(0.95);
    expect(cfg.risk.time_in_force).toBe('fill_or_kill');
    expect(cfg.risk.max_entry_ask_usd).toBe(0.7);
    expect(cfg.risk.manual_buy_time_in_force).toBe('good_till_canceled');
  });

  test('snapshotConfig is deep copy', () => {
    const a = defaultAppConfig();
    const b = snapshotConfig(a);
    b.cushions.WTI = 1.11;
    expect(a.cushions.WTI).not.toBe(1.11);
  });

  test('shouldPushAlert mute matrix', () => {
    const cfg = defaultAppConfig();
    expect(isCloudOwnedAlertSound('lean_signal')).toBe(true);
    expect(isCloudOwnedAlertSound('order_filled')).toBe(true);
    expect(isCloudOwnedAlertSound('protect_sell')).toBe(true);
    expect(isCloudOwnedAlertSound('trade_result')).toBe(true);
    expect(isCloudOwnedAlertSound('ioc_miss')).toBe(true);
    expect(isCloudOwnedAlertSound('daily_loss_stop')).toBe(true);
    expect(shouldPushAlert(cfg, 'lean_signal')).toBe(false);
    expect(shouldPushAlert(cfg, 'order_filled')).toBe(false);
    expect(shouldPushAlert(cfg, 'trade_result')).toBe(false);
    expect(shouldPushAlert(cfg, 'ioc_miss')).toBe(false);
    expect(shouldPushAlert(cfg, 'daily_loss_stop')).toBe(false);
    cfg.alerts_enabled = false;
    expect(shouldPushAlert(cfg, 'error')).toBe(false);
    cfg.alerts_enabled = true;
    expect(shouldPushAlert(cfg, 'error')).toBe(true);
    cfg.alert_prefs.error.push = false;
    expect(shouldPushAlert(cfg, 'error')).toBe(false);
  });
});

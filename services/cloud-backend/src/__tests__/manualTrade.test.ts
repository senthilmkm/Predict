import request from 'supertest';
import { defaultAppConfig } from 'trading-core';
import { app } from '../index';
import { executeManualOrder } from '../services/manualTrade';
import {
  getAlertRecords,
  getAuditLogs,
  getTradeRecords,
  resetSystemConfigCacheForTests,
  saveTradeRecord,
  setSystemConfig,
  upsertUserDoc,
} from '../services/firestore';
import { resetPlaceLocksForTests } from '../services/placeLock';
import { resetKalshiPauseForTests } from '../services/kalshiPause';

const ADMIN = process.env.ADMIN_SECRET_KEY || 'predict-admin-secret-2026';

function richLean(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    asset: 'BTC',
    market_ticker: 'KXBTC15M-MANUAL',
    decision: 'YES' as const,
    live: 100_000,
    strike: 99_000,
    abs_gap: 1000,
    minutes_left: 8,
    minutes_elapsed: 5,
    phase: 'live' as const,
    yes_ask: 0.55,
    no_ask: 0.45,
    yes_bid: 0.54,
    ...over,
  };
}

function liveCfg() {
  const cfg = defaultAppConfig();
  cfg.auto_trade_enabled = false;
  cfg.execution_mode = 'off';
  cfg.live_armed = false;
  for (const key of Object.keys(cfg.assets_enabled)) {
    cfg.assets_enabled[key as keyof typeof cfg.assets_enabled] = key === 'BTC';
  }
  cfg.cushions.BTC = 10;
  cfg.risk.min_minutes_elapsed = 2;
  cfg.risk.min_minutes_left = 1;
  cfg.risk.max_entry_ask_usd = 0.9;
  cfg.risk.fixed_dollars_per_trade = 5;
  cfg.risk.max_dollars_per_trade = 5;
  return cfg;
}

describe('manual buy/sell place-now', () => {
  beforeEach(async () => {
    resetPlaceLocksForTests();
    resetKalshiPauseForTests();
    resetSystemConfigCacheForTests();
    await setSystemConfig({ featureFlags: { lastSignalsManualTrade: true } });
  });

  afterEach(() => {
    resetSystemConfigCacheForTests();
    resetPlaceLocksForTests();
    resetKalshiPauseForTests();
  });

  test('feature off returns 403 and ERROR audit', async () => {
    await setSystemConfig({ featureFlags: { lastSignalsManualTrade: false } });
    const uid = 'usr_manual_flag_off';
    await upsertUserDoc(uid, { state: 'DISARMED', kalshiConfigured: true, config: liveCfg() });
    const res = await executeManualOrder(
      { userId: uid, asset: 'BTC', action: 'buy', requestId: 'r1' },
      {
        computeLeanFn: async () => richLean() as any,
        getUserSecretFn: async () => ({ keyId: 'k', privateKeyPem: 'pem' }) as any,
        isMarketOpenFn: () => ({ open: true }) as any,
      }
    );
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(403);
    expect(res.skip_reason).toBe('feature_disabled');
    expect(res.message).toBe('Last signals Buy / Sell is turned off.');
    const logs = await getAuditLogs(uid);
    expect(logs.some((l) => l.eventType === 'ERROR' && l.details?.skip_reason === 'feature_disabled')).toBe(
      true
    );
  });

  test('kill switch blocks manual buy', async () => {
    const uid = 'usr_manual_kill';
    await upsertUserDoc(uid, { state: 'KILL_SWITCH', kalshiConfigured: true, config: liveCfg() });
    const res = await executeManualOrder(
      { userId: uid, asset: 'BTC', action: 'buy' },
      {
        computeLeanFn: async () => richLean() as any,
        getUserSecretFn: async () => ({ keyId: 'k', privateKeyPem: 'pem' }) as any,
        isMarketOpenFn: () => ({ open: true }) as any,
      }
    );
    expect(res.httpStatus).toBe(403);
    expect(res.skip_reason).toBe('kill_switch');
    expect(res.message).toBe('Kill Switch is on. Home Buy / Sell is disabled.');
  });

  test('auto-trade off still places a live buy when gates pass', async () => {
    const uid = 'usr_manual_buy_ok';
    await upsertUserDoc(uid, {
      state: 'DISARMED',
      cloudTradingEnabled: false,
      kalshiConfigured: true,
      config: liveCfg(),
    });
    const place = jest.fn(async () => ({
      ok: true,
      http_status: 200,
      dry_run: false,
      payload: {},
      fill_count: '8',
      order_id: 'ord_manual_1',
    }));
    const res = await executeManualOrder(
      { userId: uid, asset: 'BTC', action: 'buy', requestId: 'buy_ok' },
      {
        computeLeanFn: async () => richLean() as any,
        getUserSecretFn: async () => ({ keyId: 'k', privateKeyPem: 'pem' }) as any,
        isMarketOpenFn: () => ({ open: true }) as any,
        placeOrderFn: place as any,
      }
    );
    expect(res.ok).toBe(true);
    expect(res.filled).toBe(true);
    expect(place).toHaveBeenCalledTimes(1);
    expect(place).toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: false, time_in_force: 'immediate_or_cancel' })
    );
    const trades = await getTradeRecords(uid);
    expect(trades[0].orderId).toBe('ord_manual_1');
    expect(trades[0].entryPath).toBe('home');
    const alerts = await getAlertRecords(uid);
    expect(alerts.some((a) => a.kind === 'order_filled' && a.title === 'Order Placed · Home · BTC YES')).toBe(
      true
    );
    const logs = await getAuditLogs(uid);
    expect(logs.some((l) => l.eventType === 'TRADE_TRIGGERED' && l.details?.source === 'manual_buy')).toBe(
      true
    );
  });

  test('manual buy uses Home Buy path risk, not Auto-trade timing', async () => {
    const uid = 'usr_manual_timing';
    const cfg = liveCfg();
    cfg.risk.min_minutes_left = 5;
    cfg.risk.min_minutes_elapsed = 5;
    cfg.risk.max_entry_ask_usd = 0.5;
    cfg.risk.chase_above_ask_usd = 0.02;
    cfg.risk.time_in_force = 'fill_or_kill';
    cfg.manual_risk = {
      fixed_dollars_per_trade: 5,
      max_dollars_per_trade: 5,
      min_dollars_per_trade: 1,
      min_minutes_left: 0,
      min_minutes_elapsed: 0,
      max_entry_ask_usd: 0.99,
      time_in_force: 'good_till_canceled',
      chase_above_ask_usd: 0.02,
    };
    await upsertUserDoc(uid, { state: 'DISARMED', kalshiConfigured: true, config: cfg });
    const place = jest.fn(async () => ({
      ok: true,
      http_status: 200,
      dry_run: false,
      payload: {},
      fill_count: '5',
      order_id: 'ord_gtc',
    }));
    const res = await executeManualOrder(
      { userId: uid, asset: 'BTC', action: 'buy', requestId: 'buy_gtc' },
      {
        computeLeanFn: async () =>
          richLean({ minutes_left: 1, minutes_elapsed: 0, yes_ask: 0.94 }) as any,
        getUserSecretFn: async () => ({ keyId: 'k', privateKeyPem: 'pem' }) as any,
        isMarketOpenFn: () => ({ open: true }) as any,
        placeOrderFn: place as any,
      }
    );
    expect(res.ok).toBe(true);
    expect(place).toHaveBeenCalledWith(
      expect.objectContaining({
        dry_run: false,
        time_in_force: 'good_till_canceled',
        price: expect.stringMatching(/^0\.96/),
      })
    );
  });

  test('IOC fill_count 0 after place is a miss, not the intended size', async () => {
    const uid = 'usr_manual_ioc_zero';
    await upsertUserDoc(uid, { state: 'DISARMED', kalshiConfigured: true, config: liveCfg() });
    const res = await executeManualOrder(
      { userId: uid, asset: 'BTC', action: 'buy', requestId: 'ioc_zero' },
      {
        computeLeanFn: async () => richLean() as any,
        getUserSecretFn: async () => ({ keyId: 'k', privateKeyPem: 'pem' }) as any,
        isMarketOpenFn: () => ({ open: true }) as any,
        placeOrderFn: async () =>
          ({
            ok: true,
            http_status: 201,
            dry_run: false,
            payload: { time_in_force: 'immediate_or_cancel' },
            fill_count: '0',
            order_id: 'ord_zero',
          }) as any,
      }
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ioc_miss');
    expect(res.message).toMatch(/IOC no fill/i);
    expect(res.message).toMatch(/\$0\.\d{2}/);
    const alerts = await getAlertRecords(uid);
    const miss = alerts.find((a) => a.kind === 'ioc_miss');
    expect(miss?.title).toBe('IOC miss · Home');
    expect(miss?.body).toMatch(/Home · BTC YES · \d+ ctr @ \$0\.\d{2} · IOC no fill/);
  });

  test('GTC with no immediate fill is resting, not IOC miss', async () => {
    const uid = 'usr_manual_gtc_rest';
    const cfg = liveCfg();
    cfg.risk.manual_buy_time_in_force = 'good_till_canceled';
    cfg.manual_risk = {
      ...(defaultAppConfig().manual_risk as NonNullable<typeof cfg.manual_risk>),
      time_in_force: 'good_till_canceled',
    };
    await upsertUserDoc(uid, { state: 'DISARMED', kalshiConfigured: true, config: cfg });
    const res = await executeManualOrder(
      { userId: uid, asset: 'BTC', action: 'buy', requestId: 'gtc_rest' },
      {
        computeLeanFn: async () => richLean() as any,
        getUserSecretFn: async () => ({ keyId: 'k', privateKeyPem: 'pem' }) as any,
        isMarketOpenFn: () => ({ open: true }) as any,
        placeOrderFn: async () =>
          ({
            ok: true,
            http_status: 201,
            dry_run: false,
            payload: { time_in_force: 'good_till_canceled' },
            fill_count: '0',
            remaining_count: '8',
            order_id: 'ord_rest',
          }) as any,
      }
    );
    expect(res.ok).toBe(true);
    expect(res.filled).toBe(false);
    expect(res.message).toMatch(/resting/i);
  });

  test('gate skip returns message and ERROR audit without placing', async () => {
    const uid = 'usr_manual_gate';
    const cfg = liveCfg();
    cfg.cushions.BTC = 5000;
    await upsertUserDoc(uid, { state: 'DISARMED', kalshiConfigured: true, config: cfg });
    const place = jest.fn();
    const res = await executeManualOrder(
      { userId: uid, asset: 'BTC', action: 'buy' },
      {
        computeLeanFn: async () => richLean({ abs_gap: 10 }) as any,
        getUserSecretFn: async () => ({ keyId: 'k', privateKeyPem: 'pem' }) as any,
        isMarketOpenFn: () => ({ open: true }) as any,
        placeOrderFn: place as any,
      }
    );
    expect(res.ok).toBe(false);
    expect(res.skip_reason).toBe('below_cushion');
    expect(place).not.toHaveBeenCalled();
    const logs = await getAuditLogs(uid);
    expect(logs.some((l) => l.eventType === 'ERROR' && l.details?.skip_reason === 'below_cushion')).toBe(true);
  });

  test('two concurrent buys: only one places', async () => {
    const uid = 'usr_manual_race';
    await upsertUserDoc(uid, { state: 'DISARMED', kalshiConfigured: true, config: liveCfg() });
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const place = jest.fn(async () => {
      started += 1;
      if (started === 1) await gate;
      return {
        ok: true,
        http_status: 200,
        dry_run: false,
        payload: {},
        fill_count: '2',
        order_id: `ord_${started}`,
      };
    });
    const deps = {
      computeLeanFn: async () => richLean() as any,
      getUserSecretFn: async () => ({ keyId: 'k', privateKeyPem: 'pem' }) as any,
      isMarketOpenFn: () => ({ open: true }) as any,
      placeOrderFn: place as any,
    };
    const p1 = executeManualOrder({ userId: uid, asset: 'BTC', action: 'buy', requestId: 'race_a' }, deps);
    await new Promise((r) => setTimeout(r, 20));
    const p2 = executeManualOrder({ userId: uid, asset: 'BTC', action: 'buy', requestId: 'race_b' }, deps);
    release();
    const [a, b] = await Promise.all([p1, p2]);
    const wins = [a, b].filter((r) => r.ok);
    const loses = [a, b].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(loses).toHaveLength(1);
    expect(['window_locked', 'max_trades_asset_window', 'already_holding']).toContain(loses[0].skip_reason);
  });

  test('manual sell uses protect claim and records TRADE_TRIGGERED', async () => {
    const uid = 'usr_manual_sell';
    await upsertUserDoc(uid, { state: 'DISARMED', kalshiConfigured: true, config: liveCfg() });
    await saveTradeRecord(uid, {
      tradeId: 'trade_hold',
      userId: uid,
      ticker: 'KXBTC15M-MANUAL',
      asset: 'BTC',
      decision: 'YES',
      count: '4',
      price: '0.55',
      notionalUsd: 2.2,
      dryRun: false,
      status: 'FILLED',
      executedAt: new Date().toISOString(),
      fillCount: 4,
      payPrice: 0.55,
      outcome: 'pending',
    });
    const place = jest.fn(async () => ({
      ok: true,
      http_status: 200,
      dry_run: false,
      payload: {},
      fill_count: '4',
      order_id: 'ord_sell',
    }));
    const res = await executeManualOrder(
      { userId: uid, asset: 'BTC', action: 'sell', requestId: 'sell_ok' },
      {
        computeLeanFn: async () => richLean() as any,
        getUserSecretFn: async () => ({ keyId: 'k', privateKeyPem: 'pem' }) as any,
        isMarketOpenFn: () => ({ open: true }) as any,
        placeOrderFn: place as any,
      }
    );
    expect(res.ok).toBe(true);
    expect(place).toHaveBeenCalledTimes(1);
    const trades = await getTradeRecords(uid);
    expect(trades[0].outcome).toBe('exited');
    const logs = await getAuditLogs(uid);
    expect(logs.some((l) => l.eventType === 'TRADE_TRIGGERED' && l.details?.source === 'manual_sell')).toBe(
      true
    );
  });

  test('POST /me/orders/manual wires auth and returns skip message', async () => {
    const uid = 'usr_manual_http';
    await upsertUserDoc(uid, { state: 'KILL_SWITCH', kalshiConfigured: true, config: liveCfg() });
    const res = await request(app)
      .post('/me/orders/manual')
      .set('Authorization', `Bearer ${uid}`)
      .send({ asset: 'BTC', action: 'buy' });
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/kill switch/i);
  });

  test('GET /me/status includes featureFlags and activeBroadcast', async () => {
    await setSystemConfig({
      featureFlags: { lastSignalsManualTrade: false },
      broadcast: {
        templates: [
          {
            id: 'system_maintenance',
            title: 'System maintenance',
            message: 'Banner body',
            show: true,
            showUntil: '2099-01-01T00:00:00.000Z',
          },
        ],
      },
    });
    const res = await request(app).get('/me/status').set('Authorization', 'Bearer usr_status_flags');
    expect(res.status).toBe(200);
    expect(res.body.systemConfig.featureFlags.lastSignalsManualTrade).toBe(false);
    expect(res.body.activeBroadcast.message).toBe('Banner body');
  });

  test('POST /admin/api/config nested-merges flags and broadcast without wiping tick', async () => {
    const tick = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN)
      .send({ tick_interval_seconds: 18 });
    expect(tick.body.systemConfig.tick_interval_seconds).toBe(18);

    const flags = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN)
      .send({ featureFlags: { lastSignalsManualTrade: false } });
    expect(flags.body.systemConfig.featureFlags.lastSignalsManualTrade).toBe(false);
    expect(flags.body.systemConfig.tick_interval_seconds).toBe(18);

    const bc = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN)
      .send({
        broadcast: {
          templates: [
            {
              id: 'system_maintenance',
              show: true,
              message: 'Maint',
              showUntil: '2099-06-01T12:00:00.000Z',
            },
          ],
        },
      });
    expect(bc.body.systemConfig.broadcast.templates[0].show).toBe(true);
    expect(bc.body.systemConfig.featureFlags.lastSignalsManualTrade).toBe(false);
    expect(bc.body.systemConfig.tick_interval_seconds).toBe(18);
  });
});

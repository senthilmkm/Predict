import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../index';
import { upsertUserDoc, saveTradeRecord, setSystemConfig } from '../services/firestore';

describe('Predict Admin Web Portal API Suite', () => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || 'predict-admin-secret-2026';
  const testUserId = 'user_admin_test_101';

  beforeAll(async () => {
    await setSystemConfig({ last_worker_tick_at: new Date().toISOString() });

    // Setup test user doc & trade records
    await upsertUserDoc(testUserId, {
      userId: testUserId,
      cloudTradingEnabled: true,
      kalshiConfigured: true,
      state: 'ARMED',
      lastTickAt: new Date().toISOString(),
      config: {
        version: 1,
        alerts_enabled: true,
        auto_trade_enabled: true,
        execution_mode: 'live',
        cushions: { BTC: 175, Gold: 7 },
      },
    });

    await saveTradeRecord(testUserId, {
      tradeId: 'trade_admin_test_001',
      userId: testUserId,
      ticker: 'KXGOLD15M-TEST',
      asset: 'Gold',
      decision: 'YES',
      count: '5',
      price: '0.45',
      notionalUsd: 2.25,
      dryRun: false,
      status: 'FILLED',
      fillCount: 5,
      entryPath: 'cash_out',
      executedAt: new Date().toISOString(),
    });
    await saveTradeRecord(testUserId, {
      tradeId: 'trade_admin_test_002',
      userId: testUserId,
      ticker: 'KXBTC15M-WIN',
      asset: 'BTC',
      decision: 'YES',
      count: '10',
      price: '0.55',
      notionalUsd: 4.35,
      dryRun: false,
      status: 'SETTLED',
      fillCount: 10,
      outcome: 'win',
      pnlUsd: 4.35,
      entryPath: 'auto',
      executedAt: new Date().toISOString(),
    });
    await saveTradeRecord(testUserId, {
      tradeId: 'trade_admin_test_003',
      userId: testUserId,
      ticker: 'KXBTC15M-MISS',
      asset: 'BTC',
      decision: 'YES',
      count: '5',
      price: '0.50',
      notionalUsd: 2.5,
      dryRun: false,
      status: 'CANCELLED',
      fillCount: 0,
      outcome: 'miss',
      entryPath: 'home',
      executedAt: new Date().toISOString(),
    });
  });

  test('1. Admin endpoints reject requests without admin secret key (401)', async () => {
    const res = await request(app).get('/admin/api/overview');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('2. POST /admin/api/login validates admin secret passphrase', async () => {
    const invalidRes = await request(app)
      .post('/admin/api/login')
      .send({ secretKey: 'wrong-passphrase' });
    expect(invalidRes.status).toBe(401);
    expect(invalidRes.body.ok).toBe(false);

    const validRes = await request(app)
      .post('/admin/api/login')
      .send({ secretKey: ADMIN_SECRET });
    expect(validRes.status).toBe(200);
    expect(validRes.body.ok).toBe(true);
    expect(validRes.body.token).toBe(ADMIN_SECRET);
  });

  test('3. GET /admin/api/overview returns system KPIs and worker health', async () => {
    const res = await request(app)
      .get('/admin/api/overview')
      .set('x-admin-key', ADMIN_SECRET);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.metrics).toBeDefined();
    expect(res.body.metrics.totalUsers).toBeGreaterThanOrEqual(1);
    expect(res.body.metrics.activeTraders).toBeGreaterThanOrEqual(1);
    expect(res.body.metrics.trades24hCount).toBeGreaterThanOrEqual(3);
    expect(res.body.metrics.filled24hCount).toBeGreaterThanOrEqual(2);
    expect(res.body.metrics.volumeUsd24h).toBeGreaterThanOrEqual(6.6);
    expect(res.body.metrics.volumeUsd24h).toBeLessThan(6.6 + 2.5);
    expect(res.body.metrics.assetCount).toBe(16);
    expect(Array.isArray(res.body.assets)).toBe(true);
    expect(res.body.assets.length).toBe(16);
    expect(res.body.worker).toBeDefined();
    expect(res.body.worker.status).toBe('ACTIVE');
    expect(res.body.worker.tickIntervalSeconds).toBe(20);
    expect(res.body.worker.gcpProject).toBe('predict-trading-0904');
    expect(res.body.twapLockWatcher.label).toBe('TWAP watcher · idle');
    expect(res.body.twapLockWatcher.watching).toBe(false);
    expect(res.body.lastMinuteWatcher.label).toBe('Last-minute watcher · idle');
    expect(res.body.lastMinuteWatcher.watching).toBe(false);
    expect(res.body.stepBuyWatcher.label).toBe('Step buy watcher · idle');
    expect(res.body.stepBuyWatcher.watching).toBe(false);
    expect(res.body.spikeFadeWatcher.label).toBe('Spike fade watcher · idle');
    expect(res.body.spikeFadeWatcher.watching).toBe(false);
    expect(res.body.pairLockWatcher.label).toBe('Pair lock watcher · idle');
    expect(res.body.pairLockWatcher.watching).toBe(false);
    expect(res.body.cheapLoopWatcher.label).toBe('Cheap loop watcher · idle');
    expect(res.body.cheapLoopWatcher.watching).toBe(false);
  });

  test('4. GET /admin/api/users retrieves list of all enrolled users', async () => {
    const res = await request(app)
      .get('/admin/api/users')
      .set('x-admin-key', ADMIN_SECRET);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.users)).toBe(true);
    const userIds = res.body.users.map((u: any) => u.userId);
    expect(userIds).toContain(testUserId);
    const testUser = res.body.users.find((u: any) => u.userId === testUserId);
    expect(typeof testUser.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(testUser.createdAt))).toBe(false);
    expect(testUser.pnlTodayUsd).toBe(4.35);
    expect(testUser.pnlLifetimeUsd).toBe(4.35);
  });

  test('5. POST /admin/api/users/:userId/config updates asset cushions & risk limits', async () => {
    const res = await request(app)
      .post(`/admin/api/users/${testUserId}/config`)
      .set('x-admin-key', ADMIN_SECRET)
      .send({
        cushions: { BTC: 200, Gold: 10 },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.config.cushions.BTC).toBe(200);
    expect(res.body.user.config.cushions.Gold).toBe(10);
  });

  test('6. GET /admin/api/trades retrieves global execution stream', async () => {
    const res = await request(app)
      .get('/admin/api/trades')
      .set('x-admin-key', ADMIN_SECRET);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.trades)).toBe(true);
    expect(res.body.trades.length).toBeGreaterThanOrEqual(1);
  });

  test('7. GET /admin/api/audit retrieves system audit logs', async () => {
    const res = await request(app)
      .get('/admin/api/audit')
      .set('x-admin-key', ADMIN_SECRET);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  test('8. POST /admin/api/users/:userId/disarm disarms a specific account', async () => {
    const res = await request(app)
      .post(`/admin/api/users/${testUserId}/disarm`)
      .set('x-admin-key', ADMIN_SECRET);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.state).toBe('DISARMED');
    expect(res.body.user.cloudTradingEnabled).toBe(false);
  });

  test('9. POST /admin/api/kill-switch executes Emergency Disarm platform-wide', async () => {
    // Re-arm user first
    await upsertUserDoc(testUserId, { state: 'ARMED', cloudTradingEnabled: true });

    const killRes = await request(app)
      .post('/admin/api/kill-switch')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ reason: 'Unit test emergency disarm' });

    expect(killRes.status).toBe(200);
    expect(killRes.body.ok).toBe(true);
    expect(killRes.body.disarmedCount).toBeGreaterThanOrEqual(1);

    const userDoc = await request(app)
      .get(`/admin/api/users/${testUserId}`)
      .set('x-admin-key', ADMIN_SECRET);
    expect(userDoc.body.user.state).toBe('DISARMED');
  });

  test('10. GET /admin renders static Admin Web Portal HTML', async () => {
    const res = await request(app).get('/admin/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('PREDICT ADMIN');
    expect(res.text).toContain('GCP Cloud');
    expect(res.text).toContain('Created');
    expect(res.text).toContain('predict-trading-0904');
    expect(res.text).toContain('Cloud P&amp;L');
    expect(res.text).toContain('Search user ID');
    expect(res.text).toContain('Filtered realized P&amp;L');
    expect(res.text).toContain('tradeResultCount');
    expect(res.text).toContain('type="date"');
    expect(res.text).toContain('tradeFilterFromDate');
    expect(res.text).toContain('tradeFilterToDate');
    expect(res.text).toContain('tradeFilterFromLabel');
    expect(res.text).toContain('tradeFilterToLabel');
    expect(res.text).toContain('setTradeDatePreset');
    expect(res.text).toContain('applyDefaultTradeStreamFilters');
    expect(res.text).toMatch(/option value="SETTLED" selected/);
    expect(res.text).toContain('tradeDatePresetToday');
    expect(res.text).toContain('tradeDatePreset7d');
    expect(res.text).toContain('syncTradeDatePresetButtons');
    expect(res.text).toContain('trade-date-preset.is-active');
    expect(res.text).toMatch(/\.trade-date-native[\s\S]*opacity:\s*0/);
    expect(res.text).not.toContain('tradeFilterFromTime');
    expect(res.text).not.toContain('tradeFilterToTime');
    expect(res.text).not.toMatch(/>Apply<\/button>/);
    expect(res.text).toContain('Purge jobs');
    expect(res.text).toContain('users/*/audit');
    expect(res.text).toContain('users/*/alerts');
    expect(res.text).toContain('users/*/trades');
    expect(res.text).toContain('dismissedAt');
    expect(res.text).toContain('Save purge settings');
    expect(res.text).toContain('/purge/run');
    expect(res.text).toContain("switchTab('purge')");
    expect(res.text).toContain("switchTab('retry')");
    expect(res.text).toMatch(/\['overview', 'users', 'cushions', 'trades', 'audit', 'purge', 'retry', 'features', 'devdocs'\]/);
    expect(res.text).toContain("switchTab('features')");
    expect(res.text).toContain('Feature configs');
    expect(res.text).toContain('Last signals Buy / Sell');
    expect(res.text).toContain('Cash out');
    expect(res.text).toContain('Bid check (seconds)');
    expect(res.text).toContain('flagCashOut');
    expect(res.text).toContain('flagLastSignalsManualTrade');
    expect(res.text).toContain('saveFeatureSettings');
    expect(res.text).toContain('Broadcast');
    expect(res.text).toContain('openBroadcastModal');
    expect(res.text).toContain('Show to users');
    expect(res.text).toContain('Show until');
    expect(res.text).toContain('broadcastTemplateGrid');
    expect(res.text).toContain('broadcastUntilDate_');
    expect(res.text).toContain('openBroadcastDatePicker');
    expect(res.text).toContain('readBroadcastUntilIso');
    expect(res.text).toContain('showPicker');
    expect(res.text).toContain('Live Trade Stream, History, and Cloud P&amp;L');
    expect(res.text).toContain('Never auto-deleted');
    expect(res.text).toContain('purgeAuditCount');
    expect(res.text).toContain('purgeAlertsCount');
    expect(res.text).toContain('purgeTradesCount');
    expect(res.text).toContain('purgeAuditAdded24h');
    expect(res.text).toContain('purgeAlertsAdded24h');
    expect(res.text).toContain('purgeTradesAdded24h');
    expect(res.text).toContain('↑ 24h');
    expect(res.text).toContain('markPurgeFormDirty');
    expect(res.text).toContain('purgeUnsavedHint');
    expect(res.text).toContain('purgeFormDirty');
    expect(res.text).toContain('purgeNextRunAt');
    expect(res.text).toContain('Next purge pass');
    expect(res.text).toContain('purgeAuditIntervalDays');
    expect(res.text).toContain('purgeAlertsIntervalDays');
    expect(res.text).toContain('purgeTradesIntervalDays');
    expect(res.text).toContain('Run once in (days)');
    expect(res.text).toContain('Kalshi retries');
    expect(res.text).toContain('saveRetrySettings');
    expect(res.text).toContain('retryHttpCodes');
  });

  test('11. POST /admin/api/config updates tick_interval_seconds dynamically', async () => {
    const res = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ tick_interval_seconds: 15 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.systemConfig.tick_interval_seconds).toBe(15);

    const overviewRes = await request(app)
      .get('/admin/api/overview')
      .set('x-admin-key', ADMIN_SECRET);
    expect(overviewRes.body.worker.tickIntervalSeconds).toBe(15);
    expect(overviewRes.body.worker.subTicksPerMinute).toBe(4);
  });

  test('11b. POST /admin/api/config nested-merges kalshiRetry without wiping tick interval', async () => {
    const first = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN_SECRET)
      .send({
        kalshiRetry: {
          httpCodes: '503,504',
          includeTimeouts: true,
          maxRetries: 1,
          retryIntervalSeconds: 3,
          pauseSeconds: 60,
        },
      });
    expect(first.status).toBe(200);
    expect(first.body.systemConfig.kalshiRetry.httpCodes).toEqual([503, 504]);
    expect(first.body.systemConfig.kalshiRetry.maxRetries).toBe(1);
    expect(first.body.systemConfig.kalshiRetry.pauseSeconds).toBe(60);
    expect(typeof first.body.systemConfig.tick_interval_seconds).toBe('number');

    const pauseOnly = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ kalshiRetry: { pauseSeconds: 90 } });
    expect(pauseOnly.body.systemConfig.kalshiRetry.pauseSeconds).toBe(90);
    expect(pauseOnly.body.systemConfig.kalshiRetry.httpCodes).toEqual([503, 504]);
    expect(pauseOnly.body.systemConfig.kalshiRetry.maxRetries).toBe(1);
    expect(pauseOnly.body.systemConfig.tick_interval_seconds).toBe(first.body.systemConfig.tick_interval_seconds);
  });

  test('11c. POST /admin/api/config enables Cash out and clamps bid-check seconds', async () => {
    const res = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ featureFlags: { cashOut: true, cashOutBidCheckSeconds: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.systemConfig.featureFlags.cashOut).toBe(true);
    expect(res.body.systemConfig.featureFlags.cashOutBidCheckSeconds).toBe(2);
    expect(res.body.systemConfig.featureFlags.lastSignalsManualTrade).toBe(true);
    expect(res.body.systemConfig.featureFlags.twapLock).toBe(false);
    expect(res.body.systemConfig.featureFlags.lastMinute).toBe(false);
    expect(res.body.systemConfig.featureFlags.stepBuy).toBe(false);
    expect(res.body.systemConfig.featureFlags.spikeFade).toBe(false);
    expect(res.body.systemConfig.featureFlags.pairLock).toBe(false);
    expect(res.body.systemConfig.featureFlags.cheapLoop).toBe(false);
  });

  test('12. GET /admin/api/trades filters by asset, status, user, and reports realized P&L', async () => {
    const gold = await request(app)
      .get('/admin/api/trades')
      .query({ asset: 'Gold', userId: testUserId })
      .set('x-admin-key', ADMIN_SECRET);
    expect(gold.status).toBe(200);
    expect(gold.body.matchedCount).toBe(1);
    expect(gold.body.trades.every((t: any) => t.asset === 'Gold')).toBe(true);
    expect(gold.body.trades[0].entryPath).toBe('cash_out');
    expect(gold.body.totalPnlUsd).toBe(0);

    const cashOut = await request(app)
      .get('/admin/api/trades')
      .query({ entryPath: 'cash_out', userId: testUserId })
      .set('x-admin-key', ADMIN_SECRET);
    expect(cashOut.body.matchedCount).toBe(1);
    expect(cashOut.body.trades[0].tradeId).toBe('trade_admin_test_001');
    expect(cashOut.body.trades[0].entryPath).toBe('cash_out');

    const settled = await request(app)
      .get('/admin/api/trades')
      .query({ status: 'SETTLED', userId: testUserId })
      .set('x-admin-key', ADMIN_SECRET);
    expect(settled.body.trades.every((t: any) => t.status === 'SETTLED')).toBe(true);
    expect(settled.body.matchedCount).toBe(1);
    expect(settled.body.totalPnlUsd).toBe(4.35);
    expect(settled.body.trades[0].pnlUsd).toBe(4.35);

    const user = await request(app)
      .get('/admin/api/trades')
      .query({ userId: 'admin_test' })
      .set('x-admin-key', ADMIN_SECRET);
    expect(user.body.matchedCount).toBeGreaterThanOrEqual(3);
    expect(user.body.totalPnlUsd).toBe(4.35);

    const none = await request(app)
      .get('/admin/api/trades')
      .query({ userId: 'no-such-user-xyz' })
      .set('x-admin-key', ADMIN_SECRET);
    expect(none.body.matchedCount).toBe(0);
    expect(none.body.totalPnlUsd).toBe(0);
    expect(none.body.trades).toEqual([]);

    const truncated = await request(app)
      .get('/admin/api/trades')
      .query({ limit: 1, userId: testUserId })
      .set('x-admin-key', ADMIN_SECRET);
    expect(truncated.body.displayedCount).toBe(1);
    expect(truncated.body.matchedCount).toBeGreaterThan(1);
    expect(truncated.body.truncated).toBe(true);
    expect(truncated.body.totalPnlUsd).toBe(4.35);

    const future = await request(app)
      .get('/admin/api/trades')
      .query({ from: '2099-01-01T00:00:00.000Z', userId: testUserId })
      .set('x-admin-key', ADMIN_SECRET);
    expect(future.body.matchedCount).toBe(0);
  });
});

describe('Admin trade stream HTML', () => {
  test('Entered via chip and filter include Cheap loop', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../public/admin/index.html'), 'utf8');
    expect(html).toContain("v === 'cheap_loop'");
    expect(html).toContain('value="cheap_loop"');
    expect(html).toContain("label: 'Cheap loop 15m'");
    expect(html).toContain('>Cheap loop 15m</option>');
    expect(html).toContain("v === 'cheap_loop_hourly'");
    expect(html).toContain('value="cheap_loop_hourly"');
    expect(html).toContain("label: 'Cheap loop hourly'");
    expect(html).toContain('>Cheap loop hourly</option>');
    expect(html).toContain("v === 'cheap_loop_weekly'");
    expect(html).toContain('value="cheap_loop_weekly"');
    expect(html).toContain("label: 'Cheap loop weekly'");
    expect(html).toContain('>Cheap loop weekly</option>');
    expect(html).toContain('Cheap loop 15m, Cheap loop hourly, Cheap loop weekly');
    expect(html).toContain('/^Cheap loop (15m|hourly|weekly)$/');
  });
});

describe('Admin cheap loop Entered via', () => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || 'predict-admin-secret-2026';
  const userId = 'user_admin_cheap_loop_paths';

  test('GET /admin/api/trades labels 15m, hourly, and weekly Cheap loop separately', async () => {
    await upsertUserDoc(userId, {
      userId,
      cloudTradingEnabled: true,
      kalshiConfigured: true,
      state: 'ARMED',
      lastTickAt: new Date().toISOString(),
      config: { version: 1, alerts_enabled: true, auto_trade_enabled: true, execution_mode: 'live' },
    });
    await saveTradeRecord(userId, {
      tradeId: 'cl15-admin',
      userId,
      ticker: 'KXBTC15M-T',
      asset: 'BTC',
      decision: 'YES',
      count: '1',
      price: '0.30',
      notionalUsd: 0.3,
      dryRun: false,
      status: 'FILLED',
      fillCount: 1,
      entryPath: 'cheap_loop',
      executedAt: new Date().toISOString(),
    });
    await saveTradeRecord(userId, {
      tradeId: 'clh-admin',
      userId,
      ticker: 'KXBTCD-26SEP1406-T67099.99',
      asset: 'BTC',
      decision: 'YES',
      count: '1',
      price: '0.30',
      notionalUsd: 0.3,
      dryRun: false,
      status: 'FILLED',
      fillCount: 1,
      entryPath: 'cheap_loop_hourly',
      executedAt: new Date().toISOString(),
    });
    await saveTradeRecord(userId, {
      tradeId: 'clw-admin',
      userId,
      ticker: 'KXETHD-26SEP1817-T4500',
      asset: 'ETH',
      decision: 'NO',
      count: '1',
      price: '0.28',
      notionalUsd: 0.28,
      dryRun: false,
      status: 'FILLED',
      fillCount: 1,
      entryPath: 'cheap_loop_weekly',
      executedAt: new Date().toISOString(),
    });

    const all = await request(app)
      .get('/admin/api/trades')
      .query({ userId })
      .set('x-admin-key', ADMIN_SECRET);
    expect(all.status).toBe(200);
    expect(all.body.matchedCount).toBe(3);
    const byId = Object.fromEntries((all.body.trades as any[]).map((t) => [t.tradeId, t]));
    expect(byId['cl15-admin'].entryPath).toBe('cheap_loop');
    expect(byId['cl15-admin'].entryLabel).toBe('Cheap loop 15m');
    expect(byId['clh-admin'].entryPath).toBe('cheap_loop_hourly');
    expect(byId['clh-admin'].entryLabel).toBe('Cheap loop hourly');
    expect(byId['clw-admin'].entryPath).toBe('cheap_loop_weekly');
    expect(byId['clw-admin'].entryLabel).toBe('Cheap loop weekly');

    const hourly = await request(app)
      .get('/admin/api/trades')
      .query({ userId, entryPath: 'cheap_loop_hourly' })
      .set('x-admin-key', ADMIN_SECRET);
    expect(hourly.body.matchedCount).toBe(1);
    expect(hourly.body.trades[0].tradeId).toBe('clh-admin');
    expect(hourly.body.trades[0].entryLabel).toBe('Cheap loop hourly');

    const weekly = await request(app)
      .get('/admin/api/trades')
      .query({ userId, entryPath: 'cheap_loop_weekly' })
      .set('x-admin-key', ADMIN_SECRET);
    expect(weekly.body.matchedCount).toBe(1);
    expect(weekly.body.trades[0].tradeId).toBe('clw-admin');
    expect(weekly.body.trades[0].entryLabel).toBe('Cheap loop weekly');

    const fifteen = await request(app)
      .get('/admin/api/trades')
      .query({ userId, entryPath: 'cheap_loop' })
      .set('x-admin-key', ADMIN_SECRET);
    expect(fifteen.body.matchedCount).toBe(1);
    expect(fifteen.body.trades[0].tradeId).toBe('cl15-admin');
    expect(fifteen.body.trades[0].entryLabel).toBe('Cheap loop 15m');
  });
});

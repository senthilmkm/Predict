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
    expect(res.body.metrics.assetCount).toBe(19);
    expect(Array.isArray(res.body.assets)).toBe(true);
    expect(res.body.assets.length).toBe(19);
    expect(res.body.worker).toBeDefined();
    expect(res.body.worker.status).toBe('ACTIVE');
    expect(res.body.worker.tickIntervalSeconds).toBe(20);
    expect(res.body.worker.gcpProject).toBe('predict-trading-0904');
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
    expect(res.text).not.toMatch(/>Apply<\/button>/);
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

  test('12. GET /admin/api/trades filters by asset, status, user, and reports realized P&L', async () => {
    const gold = await request(app)
      .get('/admin/api/trades')
      .query({ asset: 'Gold', userId: testUserId })
      .set('x-admin-key', ADMIN_SECRET);
    expect(gold.status).toBe(200);
    expect(gold.body.matchedCount).toBe(1);
    expect(gold.body.trades.every((t: any) => t.asset === 'Gold')).toBe(true);
    expect(gold.body.totalPnlUsd).toBe(0);

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

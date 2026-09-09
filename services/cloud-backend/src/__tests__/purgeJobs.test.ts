import request from 'supertest';
import { app } from '../index';
import {
  dismissAlertRecords,
  getAuditLogs,
  getSystemConfig,
  getTradeRecords,
  isClosedTradeSafeToPurge,
  listAlertDocsIncludingDismissed,
  normalizePurgeConfig,
  invalidatePurgeCollectionCountsCache,
  resetSystemConfigCacheForTests,
  saveAlertRecord,
  saveTradeRecord,
  setSystemConfig,
  writeAuditLog,
  type TradeRecordDoc,
} from '../services/firestore';
import { runConfiguredPurgeJobs, setPurgeInFlightForTests } from '../services/purgeJobs';

const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || 'predict-admin-secret-2026';

function oldIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function closedTrade(partial: Partial<TradeRecordDoc> & Pick<TradeRecordDoc, 'tradeId' | 'userId'>): TradeRecordDoc {
  return {
    ticker: 'KXBTC15M-PURGE',
    asset: 'BTC',
    decision: 'YES',
    count: '1',
    price: '0.50',
    notionalUsd: 0.5,
    dryRun: false,
    status: 'SETTLED',
    executedAt: oldIso(400),
    ...partial,
  };
}

describe('Admin purge jobs', () => {
  beforeEach(async () => {
    setPurgeInFlightForTests(false);
    resetSystemConfigCacheForTests();
    invalidatePurgeCollectionCountsCache();
    await setSystemConfig({
      tick_interval_seconds: 20,
      purge: {
        audit: { enabled: true, retainDays: 30 },
        alerts: { enabled: false, retainDays: 90 },
        trades: { enabled: false, retainDays: 365 },
      },
    });
  });

  afterEach(() => {
    setPurgeInFlightForTests(false);
  });

  test('normalizePurgeConfig omits empty lastRunAt (Firestore rejects undefined)', () => {
    const p = normalizePurgeConfig({});
    expect(Object.prototype.hasOwnProperty.call(p, 'lastRunAt')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(p, 'lastDeleted')).toBe(false);
  });

  test('isClosedTradeSafeToPurge skips open fills', () => {
    expect(isClosedTradeSafeToPurge({ status: 'SUBMITTED', outcome: 'pending' })).toBe(false);
    expect(isClosedTradeSafeToPurge({ status: 'FILLED', outcome: 'pending' })).toBe(false);
    expect(isClosedTradeSafeToPurge({ status: 'FILLED', outcome: '' })).toBe(false);
    expect(isClosedTradeSafeToPurge({ status: 'FILLED', outcome: 'exiting' })).toBe(false);
    expect(isClosedTradeSafeToPurge({ status: 'FILLED', outcome: 'exited' })).toBe(true);
    expect(isClosedTradeSafeToPurge({ status: 'SETTLED', outcome: 'win' })).toBe(true);
    expect(isClosedTradeSafeToPurge({ status: 'CANCELLED', outcome: 'miss' })).toBe(true);
  });

  test('overview returns default purge settings', async () => {
    const res = await request(app).get('/admin/api/overview').set('x-admin-key', ADMIN_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.systemConfig.purge.audit.enabled).toBe(true);
    expect(res.body.systemConfig.purge.audit.retainDays).toBe(30);
    expect(res.body.systemConfig.purge.alerts.enabled).toBe(false);
    expect(res.body.systemConfig.purge.alerts.retainDays).toBe(90);
    expect(res.body.systemConfig.purge.trades.enabled).toBe(false);
    expect(res.body.systemConfig.purge.trades.retainDays).toBe(365);
  });

  test('POST /admin/api/config nested-merges purge and does not wipe tick interval', async () => {
    const first = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ purge: { audit: { retainDays: 14 } } });
    expect(first.status).toBe(200);
    expect(first.body.systemConfig.purge.audit.retainDays).toBe(14);
    expect(first.body.systemConfig.purge.audit.enabled).toBe(true);
    expect(first.body.systemConfig.purge.alerts.enabled).toBe(false);
    expect(first.body.systemConfig.tick_interval_seconds).toBe(20);

    const alertsOn = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ purge: { alerts: { enabled: true, retainDays: 60 } } });
    expect(alertsOn.body.systemConfig.purge.alerts.enabled).toBe(true);
    expect(alertsOn.body.systemConfig.purge.alerts.retainDays).toBe(60);
    expect(alertsOn.body.systemConfig.purge.audit.retainDays).toBe(14);

    const tickOnly = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ tick_interval_seconds: 15 });
    expect(tickOnly.status).toBe(200);
    expect(tickOnly.body.systemConfig.tick_interval_seconds).toBe(15);
    expect(tickOnly.body.systemConfig.purge.audit.retainDays).toBe(14);
    expect(tickOnly.body.systemConfig.purge.alerts.enabled).toBe(true);
    expect(tickOnly.body.systemConfig.purge.trades.enabled).toBe(false);
  });

  test('last-run heartbeat does not turn Off an enabled purge job', async () => {
    const on = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ purge: { alerts: { enabled: true }, trades: { enabled: true } } });
    expect(on.body.systemConfig.purge.alerts.enabled).toBe(true);
    expect(on.body.systemConfig.purge.trades.enabled).toBe(true);

    await setSystemConfig({
      last_worker_tick_at: new Date().toISOString(),
      purge: {
        lastRunAt: new Date().toISOString(),
        lastDeleted: { audit: 0, alerts: 0, trades: 0 },
      },
    });
    const cfg = await getSystemConfig({ fresh: true });
    expect(cfg.purge?.alerts.enabled).toBe(true);
    expect(cfg.purge?.trades.enabled).toBe(true);
  });

  test('clamps retainDays and rejects unknown purge/run job', async () => {
    const clamped = await request(app)
      .post('/admin/api/config')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ purge: { audit: { retainDays: 1 }, trades: { retainDays: 99999 } } });
    expect(clamped.body.systemConfig.purge.audit.retainDays).toBe(7);
    expect(clamped.body.systemConfig.purge.trades.retainDays).toBe(3650);

    const bad = await request(app)
      .post('/admin/api/purge/run')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ job: 'profiles' });
    expect(bad.status).toBe(400);

    const unauth = await request(app).post('/admin/api/purge/run').send({ job: 'audit' });
    expect(unauth.status).toBe(401);
  });

  test('disabled jobs are a no-op; Run once still deletes using keep-for days', async () => {
    const uid = 'usr_purge_disabled_jobs';
    await writeAuditLog(uid, 'ERROR', { staleOff: true }, '2018-01-01T00:00:00.000Z');
    await setSystemConfig({
      purge: { audit: { enabled: false, retainDays: 30 } },
    });

    const idle = await runConfiguredPurgeJobs();
    expect(idle.ran).toBe(false);
    expect(idle.deleted.audit).toBe(0);
    expect((await getAuditLogs(uid)).some((l) => l.details?.staleOff)).toBe(true);

    const runOnce = await request(app)
      .post('/admin/api/purge/run')
      .set('x-admin-key', ADMIN_SECRET)
      .send({ job: 'audit' });
    expect(runOnce.status).toBe(200);
    expect(runOnce.body.ok).toBe(true);
    expect(runOnce.body.skipped).toBe(false);
    expect(runOnce.body.deleted.audit).toBeGreaterThanOrEqual(1);
    expect((await getAuditLogs(uid)).some((l) => l.details?.staleOff)).toBe(false);
    const cfg = await getSystemConfig();
    expect(cfg.purge?.audit.enabled).toBe(false);
  });

  test('overlapping purge is skipped (no double-delete race)', async () => {
    setPurgeInFlightForTests(true);
    const skipped = await runConfiguredPurgeJobs();
    expect(skipped.skipped).toBe(true);
    expect(skipped.deleted).toEqual({ audit: 0, alerts: 0, trades: 0 });
    setPurgeInFlightForTests(false);
  });

  test('deletes old dismissed alerts only; undismissed stay (no re-push hole)', async () => {
    const uid = 'usr_purge_alerts';
    await saveAlertRecord(uid, {
      alertId: 'alert_old_dismissed',
      userId: uid,
      kind: 'fill',
      title: 'Old dismissed',
      body: 'gone',
      at: '2020-02-02T00:00:00.000Z',
      source: 'gcp',
    });
    await saveAlertRecord(uid, {
      alertId: 'alert_old_live',
      userId: uid,
      kind: 'fill',
      title: 'Old live',
      body: 'keep',
      at: '2020-02-02T00:00:00.000Z',
      source: 'gcp',
    });
    await saveAlertRecord(uid, {
      alertId: 'alert_new_dismissed',
      userId: uid,
      kind: 'fill',
      title: 'New dismissed',
      body: 'keep',
      at: new Date().toISOString(),
      source: 'gcp',
    });
    await dismissAlertRecords(uid, ['alert_old_dismissed', 'alert_new_dismissed']);

    const result = await runConfiguredPurgeJobs({
      jobs: ['alerts'],
      ignoreEnabled: true,
    });
    expect(result.deleted.alerts).toBeGreaterThanOrEqual(1);

    const remaining = await listAlertDocsIncludingDismissed(uid);
    const ids = remaining.map((r) => r.alertId);
    expect(ids).not.toContain('alert_old_dismissed');
    expect(ids).toContain('alert_old_live');
    expect(ids).toContain('alert_new_dismissed');
  });

  test('deletes old SETTLED/CANCELLED trades; skips pending FILLED and recent closed', async () => {
    const uid = 'usr_purge_trades';
    await saveTradeRecord(uid, closedTrade({ tradeId: 't_old_settled', userId: uid, status: 'SETTLED', outcome: 'win' }));
    await saveTradeRecord(uid, closedTrade({ tradeId: 't_old_cancelled', userId: uid, status: 'CANCELLED', outcome: 'miss' }));
    await saveTradeRecord(
      uid,
      closedTrade({ tradeId: 't_old_filled_pending', userId: uid, status: 'FILLED', outcome: 'pending' })
    );
    await saveTradeRecord(
      uid,
      closedTrade({ tradeId: 't_old_filled_exiting', userId: uid, status: 'FILLED', outcome: 'exiting' })
    );
    await saveTradeRecord(
      uid,
      closedTrade({ tradeId: 't_old_submitted', userId: uid, status: 'SUBMITTED', outcome: 'pending' })
    );
    await saveTradeRecord(
      uid,
      closedTrade({
        tradeId: 't_recent_settled',
        userId: uid,
        status: 'SETTLED',
        outcome: 'win',
        executedAt: new Date().toISOString(),
      })
    );

    const result = await runConfiguredPurgeJobs({ jobs: ['trades'], ignoreEnabled: true });
    expect(result.deleted.trades).toBeGreaterThanOrEqual(2);

    const trades = await getTradeRecords(uid);
    const ids = trades.map((t) => t.tradeId);
    expect(ids).not.toContain('t_old_settled');
    expect(ids).not.toContain('t_old_cancelled');
    expect(ids).toContain('t_old_filled_pending');
    expect(ids).toContain('t_old_filled_exiting');
    expect(ids).toContain('t_old_submitted');
    expect(ids).toContain('t_recent_settled');
  });

  test('worker /tick runs audit purge and records lastDeleted without a second scheduler', async () => {
    const uid = 'usr_purge_worker_tick';
    await writeAuditLog(uid, 'ERROR', { workerKeep: true });
    await writeAuditLog(uid, 'ERROR', { workerStale: true }, '2017-01-01T00:00:00.000Z');

    const tick = await request(app).post('/tick?single=true');
    expect(tick.status).toBe(200);
    expect(tick.body.purge.ran).toBe(true);
    expect(tick.body.purge.deleted.alerts).toBe(0);
    expect(tick.body.purge.deleted.trades).toBe(0);
    expect(tick.body.auditPruned).toBeGreaterThanOrEqual(1);

    const cfg = await getSystemConfig();
    expect(cfg.purge?.lastDeleted?.audit).toBeGreaterThanOrEqual(1);
    expect(typeof cfg.purge?.lastRunAt).toBe('string');
    expect(typeof cfg.last_worker_tick_at).toBe('string');
  });

  test('GET /admin/api/purge/counts returns collection document totals', async () => {
    const uid = 'usr_purge_counts';
    await writeAuditLog(uid, 'ERROR', { countProbe: true });
    await saveAlertRecord(uid, {
      alertId: 'alert_count_probe',
      userId: uid,
      kind: 'fill',
      title: 'Count probe',
      body: 'n',
      at: new Date().toISOString(),
      source: 'gcp',
    });
    await saveTradeRecord(uid, closedTrade({ tradeId: 't_count_probe', userId: uid, executedAt: new Date().toISOString() }));

    const unauth = await request(app).get('/admin/api/purge/counts');
    expect(unauth.status).toBe(401);

    const res = await request(app)
      .get('/admin/api/purge/counts')
      .query({ fresh: '1' })
      .set('x-admin-key', ADMIN_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.counts.audit).toBeGreaterThanOrEqual(1);
    expect(res.body.counts.alerts).toBeGreaterThanOrEqual(1);
    expect(res.body.counts.trades).toBeGreaterThanOrEqual(1);
  });
});

import request from 'supertest';
import { app } from '../index';
import {
  getAuditLogs,
  pruneExpiredAuditLogs,
  writeAuditLog,
} from '../services/firestore';

describe('Audit trail retention and heartbeat', () => {
  const userId = 'usr_audit_retention_test';

  test('POST /me/status logs CLOUD_ARMED once, not on every heartbeat', async () => {
    const arm = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${userId}`)
      .send({ cloudTradingEnabled: true, state: 'ARMED' });
    expect(arm.status).toBe(200);

    const first = await request(app).get('/me/audit').set('Authorization', `Bearer ${userId}`);
    const armedFirst = first.body.auditLogs.filter((l: { eventType: string }) => l.eventType === 'CLOUD_ARMED')
      .length;
    expect(armedFirst).toBeGreaterThanOrEqual(1);

    const heartbeat = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${userId}`)
      .send({ cloudTradingEnabled: true, state: 'ARMED' });
    expect(heartbeat.status).toBe(200);

    const second = await request(app).get('/me/audit').set('Authorization', `Bearer ${userId}`);
    const armedSecond = second.body.auditLogs.filter((l: { eventType: string }) => l.eventType === 'CLOUD_ARMED')
      .length;
    expect(armedSecond).toBe(armedFirst);

    const disarm = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${userId}`)
      .send({ cloudTradingEnabled: false, state: 'DISARMED' });
    expect(disarm.status).toBe(200);
    const third = await request(app).get('/me/audit').set('Authorization', `Bearer ${userId}`);
    const types = third.body.auditLogs.map((l: { eventType: string }) => l.eventType);
    expect(types).toContain('CLOUD_DISARMED');
  });

  test('pruneExpiredAuditLogs deletes Firestore/local rows older than 30 days', async () => {
    const uid = 'usr_audit_prune_old';
    await writeAuditLog(uid, 'ERROR', { keep: true });
    await writeAuditLog(uid, 'ERROR', { stale: true }, '2020-01-15T00:00:00.000Z');

    const before = await getAuditLogs(uid);
    expect(before.some((l) => l.details?.stale)).toBe(true);

    const removed = await pruneExpiredAuditLogs();
    expect(removed).toBeGreaterThanOrEqual(1);

    const after = await getAuditLogs(uid);
    expect(after.some((l) => l.details?.stale)).toBe(false);
    expect(after.some((l) => l.details?.keep)).toBe(true);
  });

  test('POST /tick purges old audit after trading (scheduler path)', async () => {
    const uid = 'usr_audit_tick_purge';
    await writeAuditLog(uid, 'ERROR', { keepTick: true });
    await writeAuditLog(uid, 'ERROR', { staleTick: true }, '2019-06-01T00:00:00.000Z');

    const tick = await request(app).post('/tick');
    expect(tick.status).toBe(200);
    expect(tick.body.ok).toBe(true);
    expect(tick.body.purge).toBeDefined();
    expect(tick.body.purge.skipped).toBe(false);
    expect(tick.body.purge.deleted.audit).toBeGreaterThanOrEqual(1);

    const after = await getAuditLogs(uid);
    expect(after.some((l) => l.details?.staleTick)).toBe(false);
    expect(after.some((l) => l.details?.keepTick)).toBe(true);
  });
});

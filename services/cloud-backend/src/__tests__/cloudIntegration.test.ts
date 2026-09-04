import request from 'supertest';
import forge from 'node-forge';
import { app } from '../index';
import { assertPemLooksValid } from 'trading-core';

// Generate a valid RSA keypair for dry-run testing
const rsaKeypair = forge.pki.rsa.generateKeyPair({ bits: 1024 });
const TEST_KEY_ID = 'test-kalshi-key-id-12345';
const TEST_PEM = forge.pki.privateKeyToPem(rsaKeypair.privateKey);

describe('Predict Cloud Backend — End-to-End Integration Suite', () => {
  const userId = 'user_test_apple_sub_9988';

  test('1. Assert PEM validation utility', () => {
    expect(() => assertPemLooksValid(TEST_PEM)).not.toThrow();
    expect(() => assertPemLooksValid('invalid-key-pem')).toThrow('invalid_pem');
  });

  test('2. GET /healthz returns ok status', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('3. POST /me/kalshi/credentials stores key in Secret Manager & Firestore', async () => {
    const res = await request(app)
      .post('/me/kalshi/credentials')
      .set('Authorization', `Bearer ${userId}`)
      .send({
        keyId: TEST_KEY_ID,
        privateKeyPem: TEST_PEM,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.kalshiConfigured).toBe(true);
    expect(res.body.kalshiKeyId).toBe(TEST_KEY_ID);
  });

  test('4. POST /me/status enables Cloud Trading (ARMED)', async () => {
    const res = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${userId}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.userDoc.cloudTradingEnabled).toBe(true);
    expect(res.body.userDoc.state).toBe('ARMED');
  });

  test('5. POST /tick executes 20s Cloud Scheduler tick in dry-run mode', async () => {
    const res = await request(app).post('/tick');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.activeUserCount).toBeGreaterThanOrEqual(1);
    expect(res.body.results).toBeDefined();
  });

  test('6. GET /me/trades retrieves trade record history', async () => {
    const res = await request(app)
      .get('/me/trades')
      .set('Authorization', `Bearer ${userId}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.trades)).toBe(true);
  });

  test('7. GET /me/audit retrieves security audit logs', async () => {
    const res = await request(app)
      .get('/me/audit')
      .set('Authorization', `Bearer ${userId}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.auditLogs)).toBe(true);
    const eventTypes = res.body.auditLogs.map((l: any) => l.eventType);
    expect(eventTypes).toContain('KEY_UPLOAD');
    expect(eventTypes).toContain('CLOUD_ARMED');
  });

  test('8. POST /me/disclaimer records legal disclaimer acceptance in Firestore DB & audit trail', async () => {
    const res = await request(app)
      .post('/me/disclaimer')
      .set('Authorization', `Bearer ${userId}`)
      .send({ disclaimerVersion: '2026.1', source: 'onboarding' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.disclaimerAccepted).toBe(true);
    expect(res.body.disclaimerVersion).toBe('2026.1');

    // Verify audit log has DISCLAIMER_ACCEPTED
    const auditRes = await request(app)
      .get('/me/audit')
      .set('Authorization', `Bearer ${userId}`);
    const eventTypes = auditRes.body.auditLogs.map((l: any) => l.eventType);
    expect(eventTypes).toContain('DISCLAIMER_ACCEPTED');
  });

  test('8. POST /me/execution/kill activates Emergency Kill Switch instantly', async () => {
    const killRes = await request(app)
      .post('/me/execution/kill')
      .set('Authorization', `Bearer ${userId}`);

    expect(killRes.status).toBe(200);
    expect(killRes.body.ok).toBe(true);
    expect(killRes.body.state).toBe('KILL_SWITCH');
    expect(killRes.body.cloudTradingEnabled).toBe(false);

    // Verify worker tick skips user on next tick
    const tickRes = await request(app).post('/tick');
    expect(tickRes.status).toBe(200);
    expect(tickRes.body.activeUserCount).toBe(0);
  });

  test('9. DELETE /me/kalshi/credentials permanently wipes Secret Manager keys', async () => {
    const res = await request(app)
      .delete('/me/kalshi/credentials')
      .set('Authorization', `Bearer ${userId}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.kalshiConfigured).toBe(false);

    // Verify audit log has KEY_WIPE
    const auditRes = await request(app)
      .get('/me/audit')
      .set('Authorization', `Bearer ${userId}`);
    const eventTypes = auditRes.body.auditLogs.map((l: any) => l.eventType);
    expect(eventTypes).toContain('KEY_WIPE');
  });
});

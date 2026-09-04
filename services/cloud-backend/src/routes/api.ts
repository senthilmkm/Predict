import { Router, Request, Response } from 'express';
import { assertPemLooksValid, defaultAppConfig } from 'trading-core';
import { saveUserSecret, deleteUserSecret } from '../services/secretManager';
import {
  getUserDoc,
  upsertUserDoc,
  getTradeRecords,
  getAuditLogs,
  writeAuditLog,
} from '../services/firestore';

export const apiRouter = Router();

// Middleware to extract userId (Apple Subject / Firebase UID)
function extractUserId(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) return token; // Simple token / user ID for API
  }
  return (req.headers['x-user-id'] as string) || 'default_user';
}

// Health check
apiRouter.get('/healthz', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'predict-cloud-api', timestamp: new Date().toISOString() });
});

// Upload Kalshi PEM & Key ID
apiRouter.post('/me/kalshi/credentials', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const { keyId, privateKeyPem } = req.body || {};

  if (!keyId || !privateKeyPem) {
    res.status(400).json({ error: 'missing_credentials', message: 'keyId and privateKeyPem required' });
    return;
  }

  try {
    assertPemLooksValid(privateKeyPem);
  } catch {
    res.status(400).json({ error: 'invalid_pem', message: 'RSA Private Key PEM format is invalid' });
    return;
  }

  try {
    await saveUserSecret(userId, keyId, privateKeyPem);
    const userDoc = await upsertUserDoc(userId, {
      kalshiConfigured: true,
      kalshiKeyId: keyId,
    });
    await writeAuditLog(userId, 'KEY_UPLOAD', { keyId });

    res.json({
      ok: true,
      kalshiConfigured: userDoc.kalshiConfigured,
      kalshiKeyId: userDoc.kalshiKeyId,
      message: 'Kalshi API credentials stored securely in GCP Secret Manager',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'save_failed', message: err?.message || 'Failed to store credentials' });
  }
});

// Delete / Wipe Kalshi Credentials
apiRouter.delete('/me/kalshi/credentials', async (req: Request, res: Response) => {
  const userId = extractUserId(req);

  try {
    await deleteUserSecret(userId);
    await upsertUserDoc(userId, {
      kalshiConfigured: false,
      kalshiKeyId: undefined,
      cloudTradingEnabled: false,
      state: 'DISARMED',
    });
    await writeAuditLog(userId, 'KEY_WIPE', { action: 'delete_secret' });

    res.json({
      ok: true,
      kalshiConfigured: false,
      message: 'Kalshi API secret deleted permanently from GCP Secret Manager',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'wipe_failed', message: err?.message || 'Failed to wipe secret' });
  }
});

// Emergency Kill Switch
apiRouter.post('/me/execution/kill', async (req: Request, res: Response) => {
  const userId = extractUserId(req);

  try {
    const userDoc = await upsertUserDoc(userId, {
      state: 'KILL_SWITCH',
      cloudTradingEnabled: false,
    });
    await writeAuditLog(userId, 'KILL_SWITCH', { action: 'emergency_kill_triggered' });

    res.json({
      ok: true,
      state: userDoc.state,
      cloudTradingEnabled: userDoc.cloudTradingEnabled,
      message: 'EMERGENCY KILL SWITCH ACTIVATED. Cloud trading stopped instantly.',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'kill_failed', message: err?.message || 'Failed to trigger kill switch' });
  }
});

// Record Legal Disclaimer Acceptance
apiRouter.post('/me/disclaimer', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const { disclaimerVersion, source } = req.body || {};

  try {
    const acceptedAt = new Date().toISOString();
    const userDoc = await upsertUserDoc(userId, {
      disclaimerAccepted: true,
      disclaimerAcceptedAt: acceptedAt,
      disclaimerVersion: disclaimerVersion || '2026.1',
    });
    await writeAuditLog(userId, 'DISCLAIMER_ACCEPTED', {
      disclaimerVersion: disclaimerVersion || '2026.1',
      source: source || 'onboarding',
      acceptedAt,
    });

    res.json({
      ok: true,
      disclaimerAccepted: userDoc.disclaimerAccepted,
      disclaimerAcceptedAt: userDoc.disclaimerAcceptedAt,
      disclaimerVersion: userDoc.disclaimerVersion,
      message: 'Legal disclaimer acceptance logged to Firestore DB and audit trail',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'disclaimer_log_failed', message: err?.message || 'Failed to record disclaimer acceptance' });
  }
});

// Get User Status & Config
apiRouter.get('/me/status', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const userDoc = (await getUserDoc(userId)) || {
    userId,
    cloudTradingEnabled: false,
    kalshiConfigured: false,
    state: 'DISARMED',
    updatedAt: new Date().toISOString(),
    config: defaultAppConfig(),
  };

  res.json({
    ok: true,
    userDoc,
  });
});

// Update User Status & Config
apiRouter.post('/me/status', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const { cloudTradingEnabled, state, config } = req.body || {};

  try {
    const updateData: any = {};
    if (typeof cloudTradingEnabled === 'boolean') updateData.cloudTradingEnabled = cloudTradingEnabled;
    if (state === 'ARMED' || state === 'DISARMED') updateData.state = state;
    if (config) updateData.config = config;

    const userDoc = await upsertUserDoc(userId, updateData);
    await writeAuditLog(
      userId,
      userDoc.cloudTradingEnabled ? 'CLOUD_ARMED' : 'CLOUD_DISARMED',
      { cloudTradingEnabled: userDoc.cloudTradingEnabled, state: userDoc.state }
    );

    res.json({ ok: true, userDoc });
  } catch (err: any) {
    res.status(500).json({ error: 'update_failed', message: err?.message || 'Failed to update user status' });
  }
});

// Register FCM Push Token
apiRouter.post('/me/push-token', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const { pushToken } = req.body || {};

  if (!pushToken) {
    res.status(400).json({ error: 'missing_token', message: 'pushToken required' });
    return;
  }

  try {
    const existing = await getUserDoc(userId);
    const tokens = new Set(existing?.fcmTokens || []);
    tokens.add(pushToken);

    await upsertUserDoc(userId, { fcmTokens: Array.from(tokens) });
    res.json({ ok: true, registeredTokenCount: tokens.size });
  } catch (err: any) {
    res.status(500).json({ error: 'token_failed', message: err?.message || 'Failed to register token' });
  }
});

// Get Trade History
apiRouter.get('/me/trades', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const trades = await getTradeRecords(userId);
  res.json({ ok: true, trades });
});

// Get Security Audit Logs
apiRouter.get('/me/audit', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const auditLogs = await getAuditLogs(userId);
  res.json({ ok: true, auditLogs });
});

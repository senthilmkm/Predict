import { Router, Request, Response } from 'express';
import { assertPemLooksValid, defaultAppConfig } from 'trading-core';
import { windowBuyCap } from '../../../../packages/trading-core/src/gates';
import { hasPathShape, normalizeManualPathRisk } from '../../../../packages/trading-core/src/pathRisk';
import { saveUserSecret, deleteUserSecret } from '../services/secretManager';
import {
  getUserDoc,
  upsertUserDoc,
  getTradeRecords,
  getAlertRecords,
  dismissAlertRecords,
  dismissAlertsOlderThan,
  getAuditLogs,
  writeAuditLog,
  getSystemConfig,
  syncAssetCatalogToFirestore,
} from '../services/firestore';
import { resolveActiveBroadcast } from '../services/broadcast';
import { executeManualOrder } from '../services/manualTrade';

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
  const [userDoc, systemConfig, assetsCatalog] = await Promise.all([
    getUserDoc(userId),
    getSystemConfig(),
    syncAssetCatalogToFirestore(),
  ]);
  const baseDoc = userDoc || {
    userId,
    cloudTradingEnabled: false,
    kalshiConfigured: false,
    state: 'DISARMED',
    updatedAt: new Date().toISOString(),
    config: defaultAppConfig(),
  };

  const finalUserDoc = {
    ...baseDoc,
    config: {
      ...(baseDoc.config || defaultAppConfig()),
      poll_interval_seconds: systemConfig.tick_interval_seconds,
    },
  };

  res.json({
    ok: true,
    userDoc: finalUserDoc,
    systemConfig,
    assetsCatalog,
    activeBroadcast: resolveActiveBroadcast(systemConfig.broadcast),
  });
});

// Update User Status & Config
apiRouter.post('/me/status', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const { cloudTradingEnabled, state, config, onboardingRecord, displayName, deviceName } = req.body || {};

  try {
    const systemConfig = await getSystemConfig();
    const updateData: any = {};
    if (typeof cloudTradingEnabled === 'boolean') updateData.cloudTradingEnabled = cloudTradingEnabled;
    const existing = await getUserDoc(userId);
    if (state === 'ARMED' || state === 'DISARMED') {
      if (existing?.state === 'KILL_SWITCH') {
        /* Phone snapshot must not clear emergency kill. Admin arm can. */
      } else {
        updateData.state = state;
      }
    }
    if (existing?.state === 'KILL_SWITCH' && updateData.cloudTradingEnabled === true) {
      updateData.cloudTradingEnabled = false;
    }
    if (config) {
      const risk = config.risk || {};
      const { max_trades_per_asset_per_day: _removedPerDay, ...restRisk } = risk;
      const prevCfg = existing?.config || {};
      const mergedRisk = {
        ...(prevCfg.risk || {}),
        ...restRisk,
        max_trades_per_asset_per_window: windowBuyCap(risk),
      };
      const incomingManual = hasPathShape(config.manual_risk) ? config.manual_risk : prevCfg.manual_risk;
      const manual_risk = normalizeManualPathRisk(incomingManual, mergedRisk);
      updateData.config = {
        ...prevCfg,
        ...config,
        poll_interval_seconds: systemConfig.tick_interval_seconds,
        risk: {
          ...mergedRisk,
          manual_buy_time_in_force: manual_risk.time_in_force,
        },
        manual_risk,
      };
    }
    if (onboardingRecord) updateData.onboardingRecord = onboardingRecord;
    if (displayName) updateData.displayName = displayName;
    if (deviceName) updateData.deviceName = deviceName;

    const before = existing;
    const userDoc = await upsertUserDoc(userId, updateData);
    const armedChanged =
      !before ||
      before.cloudTradingEnabled !== userDoc.cloudTradingEnabled ||
      before.state !== userDoc.state;
    if (armedChanged) {
      await writeAuditLog(
        userId,
        userDoc.cloudTradingEnabled ? 'CLOUD_ARMED' : 'CLOUD_DISARMED',
        { cloudTradingEnabled: userDoc.cloudTradingEnabled, state: userDoc.state }
      );
    }

    res.json({
      ok: true,
      userDoc,
      systemConfig,
      activeBroadcast: resolveActiveBroadcast(systemConfig.broadcast),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'update_failed', message: err?.message || 'Failed to update user status' });
  }
});

// Record Full Onboarding Choices under Apple ID
apiRouter.post('/me/onboarding', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const { onboardingRecord } = req.body || {};

  if (!onboardingRecord) {
    res.status(400).json({ error: 'missing_data', message: 'onboardingRecord required' });
    return;
  }

  try {
    const userDoc = await upsertUserDoc(userId, {
      onboardingRecord,
      disclaimerAccepted: Boolean(onboardingRecord.riskUnderstoodChecked),
      disclaimerAcceptedAt: onboardingRecord.riskAcceptedAt || new Date().toISOString(),
      disclaimerVersion: onboardingRecord.disclaimerVersion || '2026.1',
    });
    await writeAuditLog(userId, 'DISCLAIMER_ACCEPTED', {
      disclaimerVersion: onboardingRecord.disclaimerVersion || '2026.1',
      source: 'onboarding',
      intentMode: onboardingRecord.intentMode,
      assetsOfInterest: onboardingRecord.assetsOfInterest,
    });

    res.json({
      ok: true,
      onboardingRecord: userDoc.onboardingRecord,
      message: 'Onboarding survey responses and legal disclaimer consent saved to Firestore DB',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'onboarding_sync_failed', message: err?.message || 'Failed to save onboarding record' });
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
    const tokens = new Set([...(existing?.pushTokens || []), ...(existing?.fcmTokens || []), pushToken]);

    await upsertUserDoc(userId, {
      pushTokens: Array.from(tokens),
      fcmTokens: Array.from(tokens),
    });
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

// Trading alerts written by Cloud Run before Expo push
apiRouter.get('/me/alerts', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const raw = Number(req.query.limit);
  const limit = Number.isFinite(raw) ? raw : 400;
  const alerts = await getAlertRecords(userId, limit);
  res.json({ ok: true, alerts });
});

// Phone Alerts delete — hide rows without letting the same alertId re-push
apiRouter.post('/me/alerts/dismiss', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const dismissed = await dismissAlertRecords(userId, ids);
  res.json({ ok: true, dismissed });
});

// Settings → Prune older alerts — hide Cloud rows older than the phone retention window
apiRouter.post('/me/alerts/prune', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const dismissed = await dismissAlertsOlderThan(userId, Number(req.body?.olderThanDays));
  res.json({ ok: true, dismissed });
});

// Get Security Audit Logs
apiRouter.get('/me/audit', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const auditLogs = await getAuditLogs(userId);
  res.json({ ok: true, auditLogs });
});

// Home Last-signals Buy YES/NO / Sell — Cloud place-now (never from the phone)
apiRouter.post('/me/orders/manual', async (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const asset = String(req.body?.asset || '').trim();
  const action = req.body?.action === 'sell' ? 'sell' : req.body?.action === 'buy' ? 'buy' : '';
  const requestId = String(req.body?.requestId || '').trim() || undefined;
  if (!asset || (action !== 'buy' && action !== 'sell')) {
    res.status(400).json({
      ok: false,
      error: 'invalid_request',
      message: 'asset and action (buy|sell) are required',
    });
    return;
  }
  try {
    const result = await executeManualOrder({ userId, asset, action, requestId });
    res.status(result.httpStatus).json(result);
  } catch (err: any) {
    await writeAuditLog(userId, 'ERROR', {
      source: 'manual_order',
      error: 'exception',
      asset,
      action,
      message: err?.message || 'manual_order_failed',
    });
    res.status(500).json({
      ok: false,
      error: 'manual_order_failed',
      message: err?.message || 'Could not place order',
    });
  }
});

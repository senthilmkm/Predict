import { Router, Request, Response, NextFunction } from 'express';
import {
  getAllUsers,
  getUserDoc,
  upsertUserDoc,
  deleteUserDoc,
  getAllTradesForAdmin,
  getAllSystemAuditLogs,
  disarmAllUsers,
  writeAuditLog,
  getSystemConfig,
  setSystemConfig,
  mergePurgeConfig,
  countPurgeCollections,
  type PurgeConfig,
} from '../services/firestore';
import { parsePurgeJobName, runConfiguredPurgeJobs } from '../services/purgeJobs';
import { AssetRegistry, defaultAppConfig } from '../../../../packages/trading-core/src/types';
import { windowBuyCap } from '../../../../packages/trading-core/src/gates';
import {
  KalshiRetryPolicy,
  mergeKalshiRetryPolicy,
  parseHttpCodeList,
} from '../../../../packages/trading-core/src/kalshiRetry';
import { mergeFeatureFlags, type FeatureFlags } from '../services/featureFlags';
import { mergeBroadcastConfig, type BroadcastConfig } from '../services/broadcast';
import { cloudDailyRealizedPnl, liveCloudTradesToday } from '../services/settlement';
import {
  computeOverviewTradeMetrics,
  workerHealthStatus,
  parseTradeStreamQuery,
  buildTradeStreamResult,
} from '../services/adminMetrics';

export const adminRouter = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || 'predict-admin-secret-2026';

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const headerKey = req.headers['x-admin-key'] as string;
  const authHeader = req.headers['authorization'];
  const bearerKey = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const provided = headerKey || bearerKey || req.query.admin_key;

  if (!provided || provided !== ADMIN_SECRET) {
    res.status(401).json({ ok: false, error: 'Unauthorized: Invalid admin secret key' });
    return;
  }
  next();
}

// 1. Admin Login Verification
adminRouter.post('/login', (req: Request, res: Response) => {
  const { secretKey } = req.body || {};
  if (secretKey === ADMIN_SECRET) {
    res.json({ ok: true, token: ADMIN_SECRET, message: 'Admin authentication successful' });
  } else {
    res.status(401).json({ ok: false, error: 'Invalid admin secret key' });
  }
});

// Apply Auth Middleware to all subsequent admin routes
adminRouter.use(adminAuthMiddleware);

// 2. System Overview & Key Metrics
adminRouter.get('/overview', async (req: Request, res: Response) => {
  try {
    const [users, trades, systemConfig] = await Promise.all([
      getAllUsers(),
      getAllTradesForAdmin(),
      getSystemConfig(),
    ]);

    const tradeMetrics = computeOverviewTradeMetrics(trades);
    const activeTraders = users.filter((u) => u.state === 'ARMED' && u.cloudTradingEnabled).length;
    const lastTickAt = systemConfig?.last_worker_tick_at || null;

    const tickSec = systemConfig?.tick_interval_seconds || 20;
    const staleSec = systemConfig?.stale_timeout_seconds || 120;
    const subTicks = Math.max(1, Math.floor(60 / tickSec));
    const workerStatus = workerHealthStatus(lastTickAt, staleSec);
    const assets = AssetRegistry.list.map((a) => ({
      key: a.key,
      name: a.name,
      category: a.category,
      defaultCushion: a.defaultCushion,
      cushionBounds: a.cushionBounds,
    }));

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      systemConfig,
      metrics: {
        totalUsers: users.length,
        activeTraders,
        trades24hCount: tradeMetrics.trades24hCount,
        filled24hCount: tradeMetrics.filled24hCount,
        missed24hCount: tradeMetrics.missed24hCount,
        volumeUsd24h: tradeMetrics.volumeUsd24h,
        lastTickAt,
        assetCount: assets.length,
      },
      assets,
      worker: {
        status: workerStatus,
        tickIntervalSeconds: tickSec,
        subTicksPerMinute: subTicks,
        gcpRegion: process.env.GCP_REGION || 'us-east1',
        gcpProject: process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'predict-trading-0904',
      },
    });
  } catch (err: any) {
    console.error('admin overview error', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'Overview error' });
  }
});

function parseAdminPurgePatch(raw: unknown): Partial<PurgeConfig> | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('purge must be an object with audit, alerts, and/or trades');
  }
  const src = raw as Record<string, any>;
  const patch: Partial<PurgeConfig> = {};
  const readJob = (key: 'audit' | 'alerts' | 'trades') => {
    if (src[key] == null) return;
    if (typeof src[key] !== 'object') {
      throw new Error(`purge.${key} must be an object`);
    }
    const job = src[key] as Record<string, unknown>;
    const next: { enabled?: boolean; retainDays?: number } = {};
    if (job.enabled !== undefined) {
      next.enabled = job.enabled === true || job.enabled === 'true' || job.enabled === 1 || job.enabled === '1';
    }
    if (job.retainDays !== undefined && job.retainDays !== '') {
      next.retainDays = Number(job.retainDays);
    }
    patch[key] = next as PurgeConfig['audit'];
  };
  readJob('audit');
  readJob('alerts');
  readJob('trades');
  return patch;
}

function parseAdminKalshiRetryPatch(raw: unknown): Partial<KalshiRetryPolicy> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const body = raw as Record<string, unknown>;
  const patch: Partial<KalshiRetryPolicy> = {};
  if (body.httpCodes !== undefined) patch.httpCodes = parseHttpCodeList(body.httpCodes);
  if (body.includeTimeouts !== undefined) patch.includeTimeouts = Boolean(body.includeTimeouts);
  if (body.maxRetries !== undefined) patch.maxRetries = Number(body.maxRetries);
  if (body.retryIntervalSeconds !== undefined) patch.retryIntervalSeconds = Number(body.retryIntervalSeconds);
  if (body.pauseSeconds !== undefined) patch.pauseSeconds = Number(body.pauseSeconds);
  return Object.keys(patch).length ? patch : undefined;
}

function parseAdminFeatureFlagsPatch(raw: unknown): Partial<FeatureFlags> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const body = raw as Record<string, unknown>;
  const patch: Partial<FeatureFlags> = {};
  if (body.lastSignalsManualTrade !== undefined) {
    patch.lastSignalsManualTrade = body.lastSignalsManualTrade !== false;
  }
  return Object.keys(patch).length ? patch : undefined;
}

function parseAdminBroadcastPatch(raw: unknown): Partial<BroadcastConfig> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.templates)) return undefined;
  return { templates: body.templates as BroadcastConfig['templates'] };
}

// Update System Configuration (tick interval + purge jobs). Nested merge so a partial purge patch cannot wipe other jobs.
adminRouter.post('/config', async (req: Request, res: Response) => {
  try {
    const {
      tick_interval_seconds,
      stale_timeout_seconds,
      batch_size,
      purge,
      kalshiRetry,
      featureFlags,
      broadcast,
    } = req.body || {};
    const updateData: Record<string, unknown> = {};
    const tickSec = Number(tick_interval_seconds);
    if (tick_interval_seconds !== undefined && tick_interval_seconds !== null && tick_interval_seconds !== '') {
      if (!Number.isFinite(tickSec) || tickSec < 5 || tickSec > 60) {
        res.status(400).json({ ok: false, error: 'tick_interval_seconds must be between 5 and 60' });
        return;
      }
      updateData.tick_interval_seconds = Math.round(tickSec);
    }
    if (typeof stale_timeout_seconds === 'number' && stale_timeout_seconds >= 10) {
      updateData.stale_timeout_seconds = Math.round(stale_timeout_seconds);
    }
    if (typeof batch_size === 'number' && batch_size >= 1) {
      updateData.batch_size = Math.round(batch_size);
    }
    if (purge !== undefined || kalshiRetry !== undefined || featureFlags !== undefined || broadcast !== undefined) {
      const existing = await getSystemConfig({ fresh: true });
      if (purge !== undefined) {
        const patch = parseAdminPurgePatch(purge);
        if (patch) {
          updateData.purge = mergePurgeConfig(existing.purge, patch);
        }
      }
      if (kalshiRetry !== undefined) {
        const retryPatch = parseAdminKalshiRetryPatch(kalshiRetry);
        if (retryPatch) {
          updateData.kalshiRetry = mergeKalshiRetryPolicy(existing.kalshiRetry, retryPatch);
        }
      }
      if (featureFlags !== undefined) {
        const flagsPatch = parseAdminFeatureFlagsPatch(featureFlags);
        if (flagsPatch) {
          updateData.featureFlags = mergeFeatureFlags(existing.featureFlags, flagsPatch);
        }
      }
      if (broadcast !== undefined) {
        const bcPatch = parseAdminBroadcastPatch(broadcast);
        if (bcPatch) {
          updateData.broadcast = mergeBroadcastConfig(existing.broadcast, bcPatch);
        }
      }
    }
    const updated = await setSystemConfig(updateData as any);
    await writeAuditLog('system', 'CONFIG_CHANGE', { updated, changedBy: 'admin_portal' });
    res.json({ ok: true, systemConfig: updated });
  } catch (err: any) {
    const msg = err?.message || 'Config update error';
    const status = String(msg).startsWith('purge') ? 400 : 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

// Run one purge job now (uses Keep-for days even if the job is Off). Does not change On/Off.
adminRouter.post('/purge/run', async (req: Request, res: Response) => {
  try {
    const job = parsePurgeJobName(req.body?.job);
    if (!job) {
      res.status(400).json({
        ok: false,
        error: 'job must be audit, alerts, trades, or all',
      });
      return;
    }
    const jobs = job === 'all' ? (['audit', 'alerts', 'trades'] as const) : [job];
    const result = await runConfiguredPurgeJobs({
      jobs: [...jobs],
      ignoreEnabled: true,
    });
    if (!result.skipped && result.ran) {
      await setSystemConfig({
        purge: {
          lastRunAt: new Date().toISOString(),
          lastDeleted: result.deleted,
        },
      });
    }
    await writeAuditLog('system', 'CONFIG_CHANGE', {
      changedBy: 'admin_portal',
      purgeRun: job,
      skipped: result.skipped,
      ran: result.ran,
      deleted: result.deleted,
    });
    res.json({
      ok: true,
      skipped: result.skipped,
      ran: result.ran,
      message: result.skipped
        ? 'A purge is already running (Cloud Scheduler tick or another Run once). Try again in a minute.'
        : `Deleted ${result.deleted.audit} audit, ${result.deleted.alerts} dismissed alerts, ${result.deleted.trades} closed trades.`,
      deleted: result.deleted,
      scannedUsers: result.scannedUsers,
      counts: await countPurgeCollections({ fresh: true }),
      systemConfig: await getSystemConfig(),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Purge run failed' });
  }
});

// Collection document totals for the three purge cards (count aggregations, 15s cache).
adminRouter.get('/purge/counts', async (req: Request, res: Response) => {
  try {
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const counts = await countPurgeCollections({ fresh });
    res.json({ ok: true, counts });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Purge counts error' });
  }
});

// 3. Get All Users
adminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const [users, trades] = await Promise.all([getAllUsers(), getAllTradesForAdmin()]);
    const tradesByUser = new Map<string, typeof trades>();
    for (const trade of trades) {
      const uid = trade.userId || 'unknown';
      const list = tradesByUser.get(uid) || [];
      list.push(trade);
      tradesByUser.set(uid, list);
    }
    const usersWithPnl = users.map((u) => {
      const uid = u.userId || '';
      const userTrades = tradesByUser.get(uid) || [];
      const liveTrades = userTrades.filter((t) => !t.dryRun);
      return {
        ...u,
        pnlTodayUsd: cloudDailyRealizedPnl(liveCloudTradesToday(liveTrades)),
        pnlLifetimeUsd: cloudDailyRealizedPnl(liveTrades),
      };
    });
    res.json({ ok: true, count: usersWithPnl.length, users: usersWithPnl });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Fetch users error' });
  }
});

// 4. Get User Details
adminRouter.get('/users/:userId', async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || '');
    const user = await getUserDoc(userId);
    if (!user) {
      res.status(404).json({ ok: false, error: 'User not found' });
      return;
    }
    res.json({ ok: true, user });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Fetch user error' });
  }
});

// 5. Update User Config / Cushions
adminRouter.post('/users/:userId/config', async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || '');
    const existing = await getUserDoc(userId);
    if (!existing) {
      res.status(404).json({ ok: false, error: 'User not found' });
      return;
    }

    const currentConfig = existing.config || defaultAppConfig();
    const mergedRisk = {
      ...currentConfig.risk,
      ...(req.body.risk || {}),
    };
    const { max_trades_per_asset_per_day: _removedPerDay, ...restRisk } = mergedRisk as any;
    const updatedConfig = {
      ...currentConfig,
      ...req.body,
      cushions: {
        ...currentConfig.cushions,
        ...(req.body.cushions || {}),
      },
      risk: {
        ...restRisk,
        max_trades_per_asset_per_window: windowBuyCap(mergedRisk),
      },
    };

    const updatedUser = await upsertUserDoc(userId, {
      config: updatedConfig,
    });

    await writeAuditLog(userId, 'KEY_UPLOAD', {
      source: 'admin_portal',
      updatedBy: 'admin',
      changes: req.body,
    });

    res.json({ ok: true, user: updatedUser });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Config update error' });
  }
});

// 6. Disarm Specific User
adminRouter.post('/users/:userId/disarm', async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || '');
    const updatedUser = await upsertUserDoc(userId, {
      state: 'DISARMED',
      cloudTradingEnabled: false,
      lastError: 'Disarmed by Admin via Admin Portal',
    });

    await writeAuditLog(userId, 'KILL_SWITCH', {
      source: 'admin_portal',
      reason: 'Admin disarm request',
      disarmedAt: new Date().toISOString(),
    });

    res.json({ ok: true, user: updatedUser });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'User disarm error' });
  }
});

// 6b. Arm Specific User
adminRouter.post('/users/:userId/arm', async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || '');
    const updatedUser = await upsertUserDoc(userId, {
      state: 'ARMED',
      cloudTradingEnabled: true,
      lastError: null,
    });

    await writeAuditLog(userId, 'CLOUD_ARMED', {
      source: 'admin_portal',
      reason: 'Admin re-arm request',
      armedAt: new Date().toISOString(),
    });

    res.json({ ok: true, user: updatedUser });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'User arm error' });
  }
});

// 6c. Delete Specific Stale User Account
adminRouter.delete('/users/:userId', async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || '');
    await deleteUserDoc(userId);
    await writeAuditLog(userId, 'KILL_SWITCH', {
      source: 'admin_portal',
      reason: 'Admin deleted user document',
      deletedAt: new Date().toISOString(),
    });
    res.json({ ok: true, message: `User ${userId} deleted from Firestore DB` });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'User delete error' });
  }
});

// 7. Get Global Trade Stream (filter + realized P&L on the full match set)
adminRouter.get('/trades', async (req: Request, res: Response) => {
  try {
    const parsed = parseTradeStreamQuery(req.query as Record<string, unknown>);
    const all = await getAllTradesForAdmin();
    const result = buildTradeStreamResult(all, parsed, parsed.limit);
    res.json({
      ok: true,
      count: result.displayedCount,
      matchedCount: result.matchedCount,
      displayedCount: result.displayedCount,
      truncated: result.truncated,
      totalPnlUsd: result.totalPnlUsd,
      trades: result.trades,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Fetch trades error' });
  }
});

// 8. Get System Audit Logs
adminRouter.get('/audit', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const logs = await getAllSystemAuditLogs(limit);
    res.json({ ok: true, count: logs.length, logs });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Fetch audit logs error' });
  }
});

// 9. Emergency Global Kill-Switch (Platform-wide Disarm)
adminRouter.post('/kill-switch', async (req: Request, res: Response) => {
  try {
    const reason = req.body?.reason || 'Emergency Kill-Switch triggered via Admin Web Portal';
    const result = await disarmAllUsers(reason);
    res.json({
      ok: true,
      message: `Emergency Kill-Switch executed. Disarmed ${result.disarmedCount} active user(s).`,
      disarmedCount: result.disarmedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Kill-switch execution failed' });
  }
});

import { Router, Request, Response, NextFunction } from 'express';
import {
  getAllUsers,
  getUserDoc,
  upsertUserDoc,
  getAllGlobalTrades,
  getAllSystemAuditLogs,
  disarmAllUsers,
  writeAuditLog,
} from '../services/firestore';
import { AssetRegistry, defaultAppConfig } from 'trading-core';

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
    const users = await getAllUsers();
    const trades = await getAllGlobalTrades(500);

    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;

    const trades24h = trades.filter((t) => new Date(t.executedAt).getTime() >= last24h);
    const filled24h = trades24h.filter((t) => t.status === 'FILLED' || t.status === 'SUBMITTED');
    const volumeUsd24h = filled24h.reduce((acc, t) => acc + (t.notionalUsd || 0), 0);

    const activeTraders = users.filter((u) => u.state === 'ARMED' && u.cloudTradingEnabled).length;
    const latestUserTick = users.reduce((latest, u) => {
      if (!u.lastTickAt) return latest;
      const t = new Date(u.lastTickAt).getTime();
      return t > latest ? t : latest;
    }, 0);

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      metrics: {
        totalUsers: users.length,
        activeTraders,
        trades24hCount: trades24h.length,
        filled24hCount: filled24h.length,
        volumeUsd24h: Math.round(volumeUsd24h * 100) / 100,
        lastTickAt: latestUserTick ? new Date(latestUserTick).toISOString() : null,
      },
      worker: {
        status: 'ACTIVE',
        tickIntervalSeconds: 20,
        subTicksPerMinute: 3,
        gcpRegion: process.env.GCP_REGION || 'us-east1',
        gcpProject: process.env.GCP_PROJECT || 'predict-cloud-api-428463178740',
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Overview error' });
  }
});

// 3. Get All Users
adminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await getAllUsers();
    res.json({ ok: true, count: users.length, users });
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
    const updatedConfig = {
      ...currentConfig,
      ...req.body,
      cushions: {
        ...currentConfig.cushions,
        ...(req.body.cushions || {}),
      },
      risk: {
        ...currentConfig.risk,
        ...(req.body.risk || {}),
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

// 7. Get Global Trade Stream
adminRouter.get('/trades', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const trades = await getAllGlobalTrades(limit);
    res.json({ ok: true, count: trades.length, trades });
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

import { Firestore } from '@google-cloud/firestore';
import { UserStatusDoc } from 'trading-core';

export interface TradeRecordDoc {
  tradeId: string;
  userId: string;
  ticker: string;
  asset: string;
  decision: 'YES' | 'NO';
  count: string;
  price: string;
  notionalUsd: number;
  dryRun: boolean;
  status: 'SUBMITTED' | 'FILLED' | 'CANCELLED' | 'SETTLED';
  leanDiff?: number;
  liveSpot?: number;
  strike?: number;
  executedAt: string;
}

export interface AuditLogDoc {
  logId: string;
  userId: string;
  eventType: 'KEY_UPLOAD' | 'KEY_WIPE' | 'CLOUD_ARMED' | 'CLOUD_DISARMED' | 'KILL_SWITCH' | 'TRADE_TRIGGERED' | 'DISCLAIMER_ACCEPTED' | 'ERROR';
  details: Record<string, any>;
  timestamp: string;
}

export interface SystemConfig {
  tick_interval_seconds: number;
  stale_timeout_seconds: number;
  batch_size: number;
}

const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  tick_interval_seconds: 20,
  stale_timeout_seconds: 120,
  batch_size: 50,
};

// In-memory simulator & cache for system config
let localSystemConfig: SystemConfig = { ...DEFAULT_SYSTEM_CONFIG };
let cachedSystemConfig: SystemConfig | null = null;
let systemConfigLastFetched = 0;
const CACHE_TTL_MS = 60000;

const localUserStore = new Map<string, UserStatusDoc & { config?: any }>();
const localTradeStore = new Map<string, TradeRecordDoc[]>();
const localAuditStore = new Map<string, AuditLogDoc[]>();

let db: Firestore | null = null;
function getDb(): Firestore | null {
  if (process.env.NODE_ENV === 'test' || process.env.USE_LOCAL_FIRESTORE === 'true') {
    return null;
  }
  if (!db) {
    try {
      db = new Firestore();
    } catch {
      db = null;
    }
  }
  return db;
}

export async function getUserDoc(userId: string): Promise<(UserStatusDoc & { config?: any }) | null> {
  const f = getDb();
  if (!f) {
    return localUserStore.get(userId) || null;
  }
  try {
    const doc = await f.collection('users').doc(userId).get();
    if (!doc.exists) return null;
    return doc.data() as UserStatusDoc & { config?: any };
  } catch {
    return localUserStore.get(userId) || null;
  }
}

export async function upsertUserDoc(
  userId: string,
  data: Partial<UserStatusDoc & { config?: any }>
): Promise<UserStatusDoc & { config?: any }> {
  const existing = (await getUserDoc(userId)) || {
    userId,
    cloudTradingEnabled: false,
    kalshiConfigured: false,
    state: 'DISARMED',
    updatedAt: new Date().toISOString(),
  };

  const updated = {
    ...existing,
    ...data,
    userId,
    updatedAt: new Date().toISOString(),
  };

  localUserStore.set(userId, updated);

  const f = getDb();
  if (f) {
    try {
      await f.collection('users').doc(userId).set(updated, { merge: true });
    } catch {
      /* fallback to local store */
    }
  }

  return updated;
}

export async function getEnrolledActiveUsers(): Promise<(UserStatusDoc & { config?: any })[]> {
  const f = getDb();
  if (!f) {
    return Array.from(localUserStore.values()).filter(
      (u) =>
        (u.cloudTradingEnabled && u.state === 'ARMED' && u.kalshiConfigured) ||
        (u.config?.alerts_enabled !== false && Array.isArray(u.pushTokens) && u.pushTokens.length > 0)
    );
  }
  try {
    const snapshot = await f.collection('users').get();
    return snapshot.docs
      .map((doc: any) => doc.data() as UserStatusDoc & { config?: any })
      .filter((u) => {
        const isArmedTrader = u.cloudTradingEnabled && u.state === 'ARMED' && u.kalshiConfigured;
        const isAlertSubscriber =
          u.config?.alerts_enabled !== false && Array.isArray(u.pushTokens) && u.pushTokens.length > 0;
        return isArmedTrader || isAlertSubscriber;
      });
  } catch {
    return Array.from(localUserStore.values());
  }
}

export async function saveTradeRecord(userId: string, trade: TradeRecordDoc): Promise<void> {
  const userTrades = localTradeStore.get(userId) || [];
  userTrades.unshift(trade);
  localTradeStore.set(userId, userTrades);

  const f = getDb();
  if (f) {
    try {
      await f.collection('users').doc(userId).collection('trades').doc(trade.tradeId).set(trade);
    } catch {
      /* ignore */
    }
  }
}

export async function getTradeRecords(userId: string): Promise<TradeRecordDoc[]> {
  const f = getDb();
  if (!f) {
    return localTradeStore.get(userId) || [];
  }
  try {
    const snapshot = await f
      .collection('users')
      .doc(userId)
      .collection('trades')
      .orderBy('executedAt', 'desc')
      .limit(50)
      .get();
    return snapshot.docs.map((doc: any) => doc.data() as TradeRecordDoc);
  } catch {
    return localTradeStore.get(userId) || [];
  }
}

export async function writeAuditLog(
  userId: string,
  eventType: AuditLogDoc['eventType'],
  details: Record<string, any>
): Promise<void> {
  const logId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const logDoc: AuditLogDoc = {
    logId,
    userId,
    eventType,
    details,
    timestamp: new Date().toISOString(),
  };

  const logs = localAuditStore.get(userId) || [];
  logs.unshift(logDoc);
  localAuditStore.set(userId, logs);

  const f = getDb();
  if (f) {
    try {
      await f.collection('users').doc(userId).collection('audit').doc(logId).set(logDoc);
    } catch {
      /* ignore */
    }
  }
}

export async function getAuditLogs(userId: string): Promise<AuditLogDoc[]> {
  const f = getDb();
  if (!f) {
    return localAuditStore.get(userId) || [];
  }
  try {
    const snapshot = await f
      .collection('users')
      .doc(userId)
      .collection('audit')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    return snapshot.docs.map((doc: any) => doc.data() as AuditLogDoc);
  } catch {
    return localAuditStore.get(userId) || [];
  }
}

export async function getSystemConfig(): Promise<SystemConfig> {
  const now = Date.now();
  if (cachedSystemConfig && now - systemConfigLastFetched < CACHE_TTL_MS) {
    return cachedSystemConfig;
  }
  const f = getDb();
  if (!f) {
    cachedSystemConfig = localSystemConfig || DEFAULT_SYSTEM_CONFIG;
    systemConfigLastFetched = now;
    return cachedSystemConfig;
  }
  try {
    const doc = await f.collection('system').doc('config').get();
    if (doc.exists && doc.data()) {
      cachedSystemConfig = {
        ...DEFAULT_SYSTEM_CONFIG,
        ...doc.data(),
      };
    } else {
      cachedSystemConfig = DEFAULT_SYSTEM_CONFIG;
    }
  } catch {
    cachedSystemConfig = localSystemConfig || DEFAULT_SYSTEM_CONFIG;
  }
  systemConfigLastFetched = now;
  return cachedSystemConfig;
}

export async function setSystemConfig(
  config: Partial<SystemConfig>
): Promise<SystemConfig> {
  const existing = await getSystemConfig();
  const updated: SystemConfig = {
    ...existing,
    ...config,
  };
  localSystemConfig = updated;
  cachedSystemConfig = updated;
  systemConfigLastFetched = Date.now();

  const f = getDb();
  if (f) {
    try {
      await f.collection('system').doc('config').set(updated, { merge: true });
    } catch {
      /* fallback to local memory store */
    }
  }
  return updated;
}

export function resetSystemConfigCacheForTests(): void {
  cachedSystemConfig = null;
  systemConfigLastFetched = 0;
  localSystemConfig = { ...DEFAULT_SYSTEM_CONFIG };
}

export async function syncAssetCatalogToFirestore(): Promise<any[]> {
  const { ASSETS_CATALOG } = require('trading-core');
  const f = getDb();
  if (f) {
    try {
      await f.collection('system').doc('catalog').set(
        {
          assets: ASSETS_CATALOG,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch {
      /* fallback to local memory store */
    }
  }
  return ASSETS_CATALOG;
}

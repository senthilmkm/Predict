import { Firestore } from '@google-cloud/firestore';
import { UserStatusDoc } from 'trading-core';
import {
  KalshiRetryPolicy,
  mergeKalshiRetryPolicy,
  normalizeKalshiRetryPolicy,
} from '../../../../packages/trading-core/src/kalshiRetry';
import {
  BroadcastConfig,
  mergeBroadcastConfig,
  normalizeBroadcastConfig,
} from './broadcast';
import {
  FeatureFlags,
  mergeFeatureFlags,
  normalizeFeatureFlags,
} from './featureFlags';

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
  /** Kalshi order id — used to dedupe phone vs cloud copies of the same fill. */
  orderId?: string | null;
  /** Economic entry price in dollars (YES ask / NO cost), not the raw YES-contract quote. */
  payPrice?: number | null;
  fillCount?: number | null;
  pnlUsd?: number | null;
  outcome?: 'win' | 'loss' | 'pending' | 'miss' | 'exited' | 'exiting';
  settledAt?: string | null;
  /** Set after Trade won/lost is persisted. Missing means retry until written. */
  settlementAlertAt?: string | null;
  /** Set while an IOC protect-sell is in flight; stale claims can retry. */
  protectClaimedAt?: string | null;
  /** Kalshi order id of the IOC exit — never overwrite the entry `orderId`. */
  protectExitOrderId?: string | null;
  /** How the fill was opened. Protect / Home sell / Cash out must not overwrite. */
  entryPath?: 'home' | 'auto' | 'cash_out';
}

export interface CloudAlertDoc {
  alertId: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  at: string;
  source: 'gcp';
  asset?: string;
  ticker?: string;
  tradeId?: string;
  decision?: string;
  /** Set when the phone deletes the row. GET hides it; same alertId must not re-push. */
  dismissedAt?: string;
}

export interface AuditLogDoc {
  logId: string;
  userId: string;
  eventType: 'KEY_UPLOAD' | 'KEY_WIPE' | 'CLOUD_ARMED' | 'CLOUD_DISARMED' | 'KILL_SWITCH' | 'TRADE_TRIGGERED' | 'DISCLAIMER_ACCEPTED' | 'CONFIG_CHANGE' | 'ERROR';
  details: Record<string, any>;
  timestamp: string;
}

export interface PurgeJobSettings {
  enabled: boolean;
  retainDays: number;
}

export interface PurgeDeletedCounts {
  audit: number;
  alerts: number;
  trades: number;
}

export interface PurgeConfig {
  audit: PurgeJobSettings;
  alerts: PurgeJobSettings;
  trades: PurgeJobSettings;
  lastRunAt?: string;
  lastDeleted?: PurgeDeletedCounts;
}

export interface SystemConfig {
  tick_interval_seconds: number;
  stale_timeout_seconds: number;
  batch_size: number;
  /** ISO time of the last completed Cloud Scheduler /tick (worker heartbeat). */
  last_worker_tick_at?: string;
  /** Age-out deletes for audit / dismissed alerts / closed trades. Nested-merged on save. */
  purge?: PurgeConfig;
  /** Immediate GET retries + pause after timeouts/5xx. Nested-merged on save. */
  kalshiRetry?: KalshiRetryPolicy;
  /** Product feature On/Off. Nested-merged on save. */
  featureFlags?: FeatureFlags;
  /** In-app Home banners. Nested-merged on save. */
  broadcast?: BroadcastConfig;
}

export const MAX_PURGE_DELETES_PER_TICK = 400;
export const AUDIT_RETENTION_DAYS = 30;

export function cloneDefaultPurgeConfig(): PurgeConfig {
  return {
    audit: { enabled: true, retainDays: AUDIT_RETENTION_DAYS },
    alerts: { enabled: false, retainDays: 90 },
    trades: { enabled: false, retainDays: 365 },
  };
}

function cloneDefaultSystemConfig(): SystemConfig {
  return {
    tick_interval_seconds: 20,
    stale_timeout_seconds: 120,
    batch_size: 50,
    purge: cloneDefaultPurgeConfig(),
    kalshiRetry: normalizeKalshiRetryPolicy(null),
    featureFlags: normalizeFeatureFlags(null),
    broadcast: normalizeBroadcastConfig(null),
  };
}

function clampRetainDays(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function parseEnabledFlag(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

export function normalizePurgeConfig(raw?: Partial<PurgeConfig> | null): PurgeConfig {
  const defaults = cloneDefaultPurgeConfig();
  const lastDeleted = raw?.lastDeleted;
  const out: PurgeConfig = {
    audit: {
      enabled: parseEnabledFlag(raw?.audit?.enabled, defaults.audit.enabled),
      retainDays: clampRetainDays(Number(raw?.audit?.retainDays), 7, 365, defaults.audit.retainDays),
    },
    alerts: {
      enabled: parseEnabledFlag(raw?.alerts?.enabled, defaults.alerts.enabled),
      retainDays: clampRetainDays(Number(raw?.alerts?.retainDays), 7, 365, defaults.alerts.retainDays),
    },
    trades: {
      enabled: parseEnabledFlag(raw?.trades?.enabled, defaults.trades.enabled),
      retainDays: clampRetainDays(Number(raw?.trades?.retainDays), 30, 3650, defaults.trades.retainDays),
    },
  };
  if (typeof raw?.lastRunAt === 'string' && raw.lastRunAt.trim()) {
    out.lastRunAt = raw.lastRunAt;
  }
  if (lastDeleted && typeof lastDeleted === 'object') {
    out.lastDeleted = {
      audit: Math.max(0, Math.round(Number(lastDeleted.audit) || 0)),
      alerts: Math.max(0, Math.round(Number(lastDeleted.alerts) || 0)),
      trades: Math.max(0, Math.round(Number(lastDeleted.trades) || 0)),
    };
  }
  return out;
}

export function mergePurgeConfig(
  existing: PurgeConfig | undefined,
  patch: Partial<PurgeConfig> | undefined
): PurgeConfig {
  const base = existing || cloneDefaultPurgeConfig();
  if (!patch) return normalizePurgeConfig(base);
  return normalizePurgeConfig({
    audit: { ...base.audit, ...patch.audit },
    alerts: { ...base.alerts, ...patch.alerts },
    trades: { ...base.trades, ...patch.trades },
    lastRunAt: patch.lastRunAt ?? base.lastRunAt,
    lastDeleted: patch.lastDeleted ?? base.lastDeleted,
  });
}

export function omitUndefinedDeep<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => omitUndefinedDeep(item)) as T;
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) continue;
    out[key] = omitUndefinedDeep(nested);
  }
  return out as T;
}

export function normalizeSystemConfig(raw?: Partial<SystemConfig> | null): SystemConfig {
  const defaults = cloneDefaultSystemConfig();
  const tickAt =
    typeof raw?.last_worker_tick_at === 'string' && raw.last_worker_tick_at.trim()
      ? raw.last_worker_tick_at
      : undefined;
  return omitUndefinedDeep({
    tick_interval_seconds: Number.isFinite(Number(raw?.tick_interval_seconds))
      ? Number(raw?.tick_interval_seconds)
      : defaults.tick_interval_seconds,
    stale_timeout_seconds: Number.isFinite(Number(raw?.stale_timeout_seconds))
      ? Number(raw?.stale_timeout_seconds)
      : defaults.stale_timeout_seconds,
    batch_size: Number.isFinite(Number(raw?.batch_size)) ? Number(raw?.batch_size) : defaults.batch_size,
    ...(tickAt ? { last_worker_tick_at: tickAt } : {}),
    purge: mergePurgeConfig(defaults.purge, raw?.purge),
    kalshiRetry: mergeKalshiRetryPolicy(defaults.kalshiRetry, raw?.kalshiRetry),
    featureFlags: mergeFeatureFlags(defaults.featureFlags, raw?.featureFlags),
    broadcast: mergeBroadcastConfig(defaults.broadcast, raw?.broadcast),
  });
}

let localSystemConfig: SystemConfig = cloneDefaultSystemConfig();
let cachedSystemConfig: SystemConfig | null = null;
let systemConfigLastFetched = 0;
const CACHE_TTL_MS = 5000;

const localUserStore = new Map<string, UserStatusDoc & { config?: any }>();
const localTradeStore = new Map<string, TradeRecordDoc[]>();
const localAuditStore = new Map<string, AuditLogDoc[]>();
const localAlertStore = new Map<string, CloudAlertDoc[]>();
const ALERT_STORE_CAP = 400;

let db: Firestore | null = null;
function isoFromFirestoreTime(ts: any): string | undefined {
  if (!ts) return undefined;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  if (typeof ts === 'string' && ts.trim()) return ts;
  return undefined;
}

function userFromSnapshot(doc: { id: string; createTime?: any; data: () => any }): UserStatusDoc & {
  config?: any;
  createdAt?: string;
} {
  const data = doc.data() || {};
  return {
    userId: doc.id,
    ...data,
    createdAt: isoFromFirestoreTime(doc.createTime) || data.createdAt,
  };
}

export function getFirestoreDb(): Firestore | null {
  return getDb();
}

function getDb(): Firestore | null {
  if (process.env.NODE_ENV === 'test' || process.env.USE_LOCAL_FIRESTORE === 'true') {
    return null;
  }
  if (!db) {
    try {
      const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
      db = projectId ? new Firestore({ projectId }) : new Firestore();
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
    return userFromSnapshot(doc);
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

  const nowIso = new Date().toISOString();
  const existingCreatedAt = (existing as { createdAt?: string }).createdAt;
  const incomingCreatedAt = (data as { createdAt?: string }).createdAt;
  const updated = {
    ...existing,
    ...data,
    userId,
    createdAt: existingCreatedAt || incomingCreatedAt || nowIso,
    updatedAt: nowIso,
  };

  localUserStore.set(userId, updated);

  const f = getDb();
  if (f) {
    try {
      const ref = f.collection('users').doc(userId);
      await ref.set(updated, { merge: true });
      // set({merge}) deep-merges maps; skip reasons must be replaced as a whole field.
      if (Object.prototype.hasOwnProperty.call(data, 'lastTradeAction')) {
        await ref.update({ lastTradeAction: (data as any).lastTradeAction || {} });
      }
    } catch {
      /* fallback to local store */
    }
  }

  return updated;
}

export async function deleteUserDoc(userId: string): Promise<boolean> {
  localUserStore.delete(userId);
  const f = getDb();
  if (f) {
    try {
      await f.collection('users').doc(userId).delete();
    } catch {
      /* ignore */
    }
  }
  return true;
}

/** Keys saved: settle open fills even if Auto-trade / Protect / KILL_SWITCH. Buys still need ARMED. */
export function shouldLoadCloudTradeBook(user: {
  kalshiConfigured?: boolean;
  state?: string;
}): boolean {
  return Boolean(user?.kalshiConfigured);
}

export async function getEnrolledActiveUsers(): Promise<(UserStatusDoc & { config?: any; pushTokens?: string[]; fcmTokens?: string[] })[]> {
  const f = getDb();
  let users: any[] = [];
  if (!f) {
    users = Array.from(localUserStore.values());
  } else {
    try {
      const snapshot = await f.collection('users').get();
      users = snapshot.docs.map((doc: any) => userFromSnapshot(doc));
    } catch {
      users = Array.from(localUserStore.values());
    }
  }

  return users.filter((u) => {
    const hasTokens =
      (Array.isArray(u.pushTokens) && u.pushTokens.length > 0) ||
      (Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0);
    const isAlertSubscriber = u.config?.alerts_enabled !== false && hasTokens;
    // KILL_SWITCH + keys: settle / Trade won only. No keys: stay off the tick.
    if (u.state === 'KILL_SWITCH') return shouldLoadCloudTradeBook(u);
    return shouldLoadCloudTradeBook(u) || isAlertSubscriber;
  });
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

export const PROTECT_CLAIM_STALE_MS = 20_000;

export function isProtectClaimable(trade: TradeRecordDoc, now = new Date()): boolean {
  if (trade.dryRun) return false;
  if (!trade.ticker) return false;
  if (trade.status !== 'FILLED' && trade.status !== 'SUBMITTED') return false;
  const outcome = String(trade.outcome || 'pending');
  if (outcome === 'exited' || outcome === 'win' || outcome === 'loss' || outcome === 'miss') {
    return false;
  }
  if (outcome === 'exiting') {
    const claimedAt = new Date(trade.protectClaimedAt || 0).getTime();
    if (!Number.isFinite(claimedAt) || claimedAt <= 0) return true;
    return now.getTime() - claimedAt >= PROTECT_CLAIM_STALE_MS;
  }
  return outcome === 'pending' || outcome === '';
}

function upsertLocalTrade(userId: string, trade: TradeRecordDoc): void {
  const userTrades = localTradeStore.get(userId) || [];
  const i = userTrades.findIndex((t) => t.tradeId === trade.tradeId);
  if (i >= 0) userTrades[i] = trade;
  else userTrades.unshift(trade);
  localTradeStore.set(userId, userTrades);
}

/**
 * One-writer claim so two Cloud Run instances cannot IOC-exit the same fill.
 * Stale `exiting` claims (worker died mid-flight) can be retaken after 20s.
 */
export async function claimProtectSell(
  userId: string,
  trade: TradeRecordDoc,
  now = new Date()
): Promise<boolean> {
  const claimedAt = now.toISOString();
  const f = getDb();
  if (f) {
    const ref = f.collection('users').doc(userId).collection('trades').doc(trade.tradeId);
    try {
      const ok = await f.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = (snap.exists ? (snap.data() as TradeRecordDoc) : trade) || trade;
        if (!isProtectClaimable(data, now)) return false;
        tx.set(ref, { outcome: 'exiting', protectClaimedAt: claimedAt }, { merge: true });
        return true;
      });
      if (ok) {
        trade.outcome = 'exiting';
        trade.protectClaimedAt = claimedAt;
        upsertLocalTrade(userId, trade);
      }
      return ok;
    } catch {
      return false;
    }
  }

  const userTrades = localTradeStore.get(userId) || [];
  const existing = userTrades.find((t) => t.tradeId === trade.tradeId) || trade;
  if (!isProtectClaimable(existing, now)) return false;
  existing.outcome = 'exiting';
  existing.protectClaimedAt = claimedAt;
  trade.outcome = 'exiting';
  trade.protectClaimedAt = claimedAt;
  upsertLocalTrade(userId, existing);
  return true;
}

export async function updateTradeRecord(
  userId: string,
  tradeId: string,
  patch: Partial<TradeRecordDoc>
): Promise<void> {
  const userTrades = localTradeStore.get(userId) || [];
  const i = userTrades.findIndex((t) => t.tradeId === tradeId);
  if (i >= 0) {
    userTrades[i] = { ...userTrades[i], ...patch };
    localTradeStore.set(userId, userTrades);
  }
  const f = getDb();
  if (f) {
    try {
      await f.collection('users').doc(userId).collection('trades').doc(tradeId).set(patch, { merge: true });
    } catch {
      /* ignore */
    }
  }
}

function sortAlertsDesc(rows: CloudAlertDoc[]): CloudAlertDoc[] {
  return [...rows].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

function visibleAlerts(rows: CloudAlertDoc[]): CloudAlertDoc[] {
  return rows.filter((r) => isVisibleCloudAlert(r));
}

export function isVisibleCloudAlert(r: CloudAlertDoc): boolean {
  if (String(r.dismissedAt || '').trim()) return false;
  if (String(r.kind || '') === 'lean_signal' && isInvalidLeanAlert(r.alertId, r.decision, r.title, r.body)) {
    return false;
  }
  return true;
}

export function isSkipLeanAlert(alertId?: string, decision?: string, title?: string): boolean {
  if (String(decision || '').toUpperCase() === 'SKIP') return true;
  if (/:SKIP$/i.test(String(alertId || ''))) return true;
  return /signal\s*[·•\-]\s*\S+\s+SKIP\b/i.test(String(title || ''));
}

export function isBelowCushionLeanBody(body?: string): boolean {
  const m = String(body || '').match(/Gap\s*\$([0-9]*\.?[0-9]+).*Cushion\s*\$([0-9]*\.?[0-9]+)/i);
  if (!m) return false;
  const gap = Number(m[1]);
  const cushion = Number(m[2]);
  return Number.isFinite(gap) && Number.isFinite(cushion) && gap < cushion;
}

export function isZeroMinutesLeftLeanBody(body?: string): boolean {
  const m = String(body || '').match(/(\d+)\s*m left/i);
  if (!m) return false;
  return Number(m[1]) === 0;
}

export function isInvalidLeanAlert(
  alertId?: string,
  decision?: string,
  title?: string,
  body?: string
): boolean {
  return (
    isSkipLeanAlert(alertId, decision, title) ||
    isBelowCushionLeanBody(body) ||
    isZeroMinutesLeftLeanBody(body)
  );
}

export type SaveAlertResult = 'created' | 'exists' | false;

function upsertLocalAlert(userId: string, alert: CloudAlertDoc): SaveAlertResult {
  const rows = localAlertStore.get(userId) || [];
  if (rows.some((r) => r.alertId === alert.alertId)) return 'exists';
  rows.unshift(alert);
  if (rows.length > ALERT_STORE_CAP) rows.length = ALERT_STORE_CAP;
  localAlertStore.set(userId, rows);
  return 'created';
}

function isAlreadyExistsError(err: any): boolean {
  const code = String(err?.code ?? '');
  const msg = String(err?.message || err?.details || '');
  return code === '6' || msg.includes('ALREADY_EXISTS') || msg.toLowerCase().includes('already exists');
}

/**
 * Idempotent create. Same alertId is a no-op so worker retries cannot duplicate History.
 * `created` = first write (safe to push). `exists` = retry (do not push again).
 * Local map is test-only — production writes Firestore only (no Cloud Run leak).
 */
export async function saveAlertRecord(userId: string, alert: CloudAlertDoc): Promise<SaveAlertResult> {
  if (!userId || !alert?.alertId || !alert.kind || !alert.title) return false;
  const doc: CloudAlertDoc = {
    alertId: String(alert.alertId),
    userId,
    kind: String(alert.kind),
    title: String(alert.title),
    body: String(alert.body || ''),
    at: alert.at && String(alert.at).trim() ? String(alert.at) : new Date().toISOString(),
    source: 'gcp',
    ...(alert.asset ? { asset: String(alert.asset) } : {}),
    ...(alert.ticker ? { ticker: String(alert.ticker) } : {}),
    ...(alert.tradeId ? { tradeId: String(alert.tradeId) } : {}),
    ...(alert.decision ? { decision: String(alert.decision) } : {}),
  };

  const f = getDb();
  if (!f) return upsertLocalAlert(userId, doc);

  const ref = f.collection('users').doc(userId).collection('alerts').doc(doc.alertId);
  try {
    await ref.create(doc);
    return 'created';
  } catch (err: any) {
    if (isAlreadyExistsError(err)) return 'exists';
    try {
      const snap = await ref.get();
      return snap.exists ? 'exists' : false;
    } catch {
      return false;
    }
  }
}

/** Includes dismissed rows. Used by purge tests; History GET still hides dismissed. */
export async function listAlertDocsIncludingDismissed(userId: string): Promise<CloudAlertDoc[]> {
  const f = getDb();
  if (!f) {
    return [...(localAlertStore.get(userId) || [])];
  }
  try {
    const snapshot = await f.collection('users').doc(userId).collection('alerts').limit(400).get();
    return snapshot.docs.map((d: any) => d.data() as CloudAlertDoc);
  } catch {
    return [...(localAlertStore.get(userId) || [])];
  }
}

export async function getAlertRecords(userId: string, limit = 400): Promise<CloudAlertDoc[]> {
  const cap = Math.max(1, Math.min(400, Math.round(Number(limit) || 200)));
  const f = getDb();
  if (!f) {
    return sortAlertsDesc(visibleAlerts(localAlertStore.get(userId) || [])).slice(0, cap);
  }
  const col = f.collection('users').doc(userId).collection('alerts');
  try {
    const snapshot = await col.orderBy('at', 'desc').limit(cap).get();
    return visibleAlerts(snapshot.docs.map((d: any) => d.data() as CloudAlertDoc));
  } catch {
    // Missing `at` index (or any orderBy failure) must not wipe History.
    try {
      const snapshot = await col.limit(400).get();
      return sortAlertsDesc(visibleAlerts(snapshot.docs.map((d: any) => d.data() as CloudAlertDoc))).slice(0, cap);
    } catch {
      return [];
    }
  }
}

/** Hide alerts the phone deleted. Keeps the doc so emitCloudAlert still sees `exists` (no re-push). */
export async function dismissAlertRecords(userId: string, alertIds: string[]): Promise<number> {
  const ids = [
    ...new Set((alertIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
  ].slice(0, 400);
  if (!userId || ids.length === 0) return 0;
  const now = new Date().toISOString();
  const f = getDb();
  if (!f) {
    const rows = localAlertStore.get(userId) || [];
    let n = 0;
    for (const r of rows) {
      if (ids.includes(r.alertId) && !String(r.dismissedAt || '').trim()) {
        r.dismissedAt = now;
        n += 1;
      }
    }
    return n;
  }
  const col = f.collection('users').doc(userId).collection('alerts');
  const snaps = await Promise.all(ids.map((id) => col.doc(id).get()));
  const batch = f.batch();
  let n = 0;
  for (const snap of snaps) {
    if (!snap.exists) continue;
    batch.set(snap.ref, { dismissedAt: now }, { merge: true });
    n += 1;
  }
  if (n > 0) await batch.commit();
  return n;
}

function clampAlertRetentionDays(raw: number): number {
  if (!Number.isFinite(raw)) return 30;
  return Math.max(1, Math.min(365, Math.round(raw)));
}

function alertIsOlderThan(at: string | undefined, cutoffMs: number): boolean {
  const t = new Date(String(at || '')).getTime();
  return Number.isFinite(t) && t < cutoffMs;
}

/** Hide Cloud alerts older than the phone retention window. Docs stay so the same alertId cannot re-push. */
export async function dismissAlertsOlderThan(
  userId: string,
  olderThanDays: number,
  now = new Date()
): Promise<number> {
  if (!userId) return 0;
  const days = clampAlertRetentionDays(olderThanDays);
  const cutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const stamped = now.toISOString();
  const f = getDb();
  if (!f) {
    const rows = localAlertStore.get(userId) || [];
    let n = 0;
    for (const r of rows) {
      if (String(r.dismissedAt || '').trim()) continue;
      if (!alertIsOlderThan(r.at, cutoffMs)) continue;
      r.dismissedAt = stamped;
      n += 1;
    }
    return n;
  }

  const col = f.collection('users').doc(userId).collection('alerts');
  let total = 0;
  let cursor: any = null;
  for (let page = 0; page < 10; page += 1) {
    let docs: any[] = [];
    try {
      let q: any = col.where('at', '<', cutoffIso).orderBy('at', 'asc').limit(400);
      if (cursor) q = q.startAfter(cursor);
      const snapshot = await q.get();
      docs = snapshot.docs;
    } catch {
      const snapshot = await col.limit(400).get();
      docs = snapshot.docs.filter((d: any) => alertIsOlderThan(String(d.data()?.at || ''), cutoffMs));
      cursor = null;
    }
    if (docs.length === 0) break;
    cursor = docs[docs.length - 1];
    const pending = docs.filter((d: any) => !String(d.data()?.dismissedAt || '').trim());
    if (pending.length > 0) {
      const batch = f.batch();
      for (const d of pending) {
        batch.set(d.ref, { dismissedAt: stamped }, { merge: true });
      }
      await batch.commit();
      total += pending.length;
    }
    if (docs.length < 400) break;
    if (!cursor) break;
  }
  return total;
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
      .limit(200)
      .get();
    return snapshot.docs.map((doc: any) => doc.data() as TradeRecordDoc);
  } catch {
    return localTradeStore.get(userId) || [];
  }
}

export function retentionCutoffIso(retainDays: number, nowMs = Date.now()): string {
  const days = Number.isFinite(retainDays) ? retainDays : AUDIT_RETENTION_DAYS;
  return new Date(nowMs - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
}

export function auditRetentionCutoffIso(nowMs = Date.now()): string {
  return retentionCutoffIso(AUDIT_RETENTION_DAYS, nowMs);
}

export async function writeAuditLog(
  userId: string,
  eventType: AuditLogDoc['eventType'],
  details: Record<string, any>,
  timestamp = new Date().toISOString()
): Promise<void> {
  const logId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const logDoc: AuditLogDoc = {
    logId,
    userId,
    eventType,
    details,
    timestamp,
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

/** Closed trades only. Never delete open/pending fills (protect-sell / settlement still need them). */
export function isClosedTradeSafeToPurge(trade: Pick<TradeRecordDoc, 'status'> & { outcome?: TradeRecordDoc['outcome'] | '' }): boolean {
  const status = String(trade.status || '').toUpperCase();
  if (status === 'SUBMITTED') return false;
  const outcome = String(trade.outcome || '').toLowerCase().trim();
  if (status === 'FILLED') {
    if (outcome === 'pending' || outcome === '' || outcome === 'exiting') return false;
    return outcome === 'win' || outcome === 'loss' || outcome === 'miss' || outcome === 'exited';
  }
  return status === 'SETTLED' || status === 'CANCELLED';
}

function alertIsDismissed(alert: CloudAlertDoc): boolean {
  return Boolean(String(alert.dismissedAt || '').trim());
}

function pruneLocalAudit(cutoffIso: string): number {
  let removed = 0;
  for (const [userId, logs] of localAuditStore.entries()) {
    const kept = logs.filter((l) => String(l.timestamp) >= cutoffIso);
    removed += logs.length - kept.length;
    localAuditStore.set(userId, kept);
  }
  return removed;
}

function pruneLocalDismissedAlerts(cutoffIso: string, maxDeletes: number): number {
  let removed = 0;
  for (const [userId, rows] of localAlertStore.entries()) {
    if (removed >= maxDeletes) break;
    const next: CloudAlertDoc[] = [];
    for (const row of rows) {
      const oldEnough = String(row.at || '') < cutoffIso;
      if (removed < maxDeletes && alertIsDismissed(row) && oldEnough) {
        removed += 1;
        continue;
      }
      next.push(row);
    }
    localAlertStore.set(userId, next);
  }
  return removed;
}

function pruneLocalClosedTrades(cutoffIso: string, maxDeletes: number): number {
  let removed = 0;
  for (const [userId, rows] of localTradeStore.entries()) {
    if (removed >= maxDeletes) break;
    const next: TradeRecordDoc[] = [];
    for (const row of rows) {
      const oldEnough = String(row.executedAt || '') < cutoffIso;
      if (removed < maxDeletes && oldEnough && isClosedTradeSafeToPurge(row)) {
        removed += 1;
        continue;
      }
      next.push(row);
    }
    localTradeStore.set(userId, next);
  }
  return removed;
}

async function deleteExpiredAuditDocs(
  f: Firestore,
  userId: string,
  cutoffIso: string,
  limit: number
): Promise<number> {
  if (limit <= 0) return 0;
  const snap = await f
    .collection('users')
    .doc(userId)
    .collection('audit')
    .where('timestamp', '<', cutoffIso)
    .limit(limit)
    .get();
  if (snap.empty) return 0;
  const batch = f.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  return snap.size;
}

async function deleteExpiredDismissedAlertDocs(
  f: Firestore,
  userId: string,
  cutoffIso: string,
  limit: number
): Promise<number> {
  if (limit <= 0) return 0;
  const snap = await f
    .collection('users')
    .doc(userId)
    .collection('alerts')
    .where('at', '<', cutoffIso)
    .limit(limit)
    .get();
  if (snap.empty) return 0;
  const toDelete = snap.docs.filter((doc) => alertIsDismissed(doc.data() as CloudAlertDoc));
  if (toDelete.length === 0) return 0;
  const batch = f.batch();
  for (const doc of toDelete) batch.delete(doc.ref);
  await batch.commit();
  return toDelete.length;
}

async function deleteExpiredClosedTradeDocs(
  f: Firestore,
  userId: string,
  cutoffIso: string,
  limit: number
): Promise<number> {
  if (limit <= 0) return 0;
  const snap = await f
    .collection('users')
    .doc(userId)
    .collection('trades')
    .where('executedAt', '<', cutoffIso)
    .limit(limit)
    .get();
  if (snap.empty) return 0;
  const toDelete = snap.docs.filter((doc) => isClosedTradeSafeToPurge(doc.data() as TradeRecordDoc));
  if (toDelete.length === 0) return 0;
  const batch = f.batch();
  for (const doc of toDelete) batch.delete(doc.ref);
  await batch.commit();
  return toDelete.length;
}

export type SubcollectionPurgePass = {
  audit?: { retainDays: number };
  alerts?: { retainDays: number };
  trades?: { retainDays: number };
  maxDeletes?: number;
};

/**
 * One user-list pass. Disabled jobs are not queried (saves Firestore reads).
 * Local maps are always pruned when a job is selected (tests + Cloud Run memory).
 * Firestore deletes are capped at MAX_PURGE_DELETES_PER_TICK.
 */
export async function runSubcollectionPurge(
  opts: SubcollectionPurgePass
): Promise<{ deleted: PurgeDeletedCounts; scannedUsers: number }> {
  const maxDeletes = Math.max(
    1,
    Math.min(MAX_PURGE_DELETES_PER_TICK, Math.round(Number(opts.maxDeletes) || MAX_PURGE_DELETES_PER_TICK))
  );
  const deleted: PurgeDeletedCounts = { audit: 0, alerts: 0, trades: 0 };
  const auditCutoff = opts.audit ? retentionCutoffIso(opts.audit.retainDays) : '';
  const alertsCutoff = opts.alerts ? retentionCutoffIso(opts.alerts.retainDays) : '';
  const tradesCutoff = opts.trades ? retentionCutoffIso(opts.trades.retainDays) : '';

  const f = getDb();
  const countLocal = !f;
  if (opts.audit) {
    const n = pruneLocalAudit(auditCutoff);
    if (countLocal) deleted.audit += n;
  }
  if (opts.alerts) {
    const n = pruneLocalDismissedAlerts(alertsCutoff, maxDeletes);
    if (countLocal) deleted.alerts += n;
  }
  if (opts.trades) {
    const n = pruneLocalClosedTrades(tradesCutoff, Math.max(0, maxDeletes - deleted.alerts));
    if (countLocal) deleted.trades += n;
  }

  if (!f) {
    return { deleted, scannedUsers: 0 };
  }

  const remaining = () => maxDeletes - deleted.audit - deleted.alerts - deleted.trades;
  if (remaining() <= 0) return { deleted, scannedUsers: 0 };

  try {
    const users = await getAllUsers();
    const ids = [...new Set([...users.map((u) => u.userId).filter(Boolean), 'system'])];
    let scannedUsers = 0;
    for (const userId of ids) {
      if (remaining() <= 0) break;
      scannedUsers += 1;
      try {
        if (opts.audit && remaining() > 0) {
          deleted.audit += await deleteExpiredAuditDocs(f, userId, auditCutoff, remaining());
        }
        if (opts.alerts && remaining() > 0) {
          deleted.alerts += await deleteExpiredDismissedAlertDocs(f, userId, alertsCutoff, remaining());
        }
        if (opts.trades && remaining() > 0) {
          deleted.trades += await deleteExpiredClosedTradeDocs(f, userId, tradesCutoff, remaining());
        }
      } catch {
        /* skip this user; continue the pass */
      }
    }
    return { deleted, scannedUsers };
  } catch {
    return { deleted, scannedUsers: 0 };
  }
}

/** Deletes audit documents older than retainDays (default 30) from memory and Firestore. */
export async function pruneExpiredAuditLogs(
  maxDeletes = MAX_PURGE_DELETES_PER_TICK,
  retainDays = AUDIT_RETENTION_DAYS
): Promise<number> {
  const result = await runSubcollectionPurge({
    audit: { retainDays },
    maxDeletes,
  });
  return result.deleted.audit;
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

export async function getSystemConfig(opts?: { fresh?: boolean }): Promise<SystemConfig> {
  const now = Date.now();
  if (!opts?.fresh && cachedSystemConfig && now - systemConfigLastFetched < CACHE_TTL_MS) {
    return cachedSystemConfig;
  }
  const f = getDb();
  if (!f) {
    cachedSystemConfig = normalizeSystemConfig(localSystemConfig);
    systemConfigLastFetched = now;
    return cachedSystemConfig;
  }
  try {
    const doc = await f.collection('system').doc('config').get();
    if (doc.exists && doc.data()) {
      cachedSystemConfig = normalizeSystemConfig(doc.data() as Partial<SystemConfig>);
    } else {
      cachedSystemConfig = cloneDefaultSystemConfig();
    }
  } catch {
    cachedSystemConfig = normalizeSystemConfig(localSystemConfig);
  }
  systemConfigLastFetched = now;
  return cachedSystemConfig;
}

export type SystemConfigPatch = Omit<
  Partial<SystemConfig>,
  'purge' | 'kalshiRetry' | 'featureFlags' | 'broadcast'
> & {
  purge?: Partial<PurgeConfig>;
  kalshiRetry?: Partial<KalshiRetryPolicy>;
  featureFlags?: Partial<FeatureFlags>;
  broadcast?: Partial<BroadcastConfig>;
};

function buildNextSystemConfig(existing: SystemConfig, config: SystemConfigPatch): SystemConfig {
  return normalizeSystemConfig({
    ...existing,
    ...config,
    last_worker_tick_at: config.last_worker_tick_at ?? existing.last_worker_tick_at,
    purge: mergePurgeConfig(existing.purge, config.purge),
    kalshiRetry: mergeKalshiRetryPolicy(existing.kalshiRetry, config.kalshiRetry),
    featureFlags: mergeFeatureFlags(existing.featureFlags, config.featureFlags),
    broadcast: mergeBroadcastConfig(existing.broadcast, config.broadcast),
  });
}

export async function setSystemConfig(config: SystemConfigPatch): Promise<SystemConfig> {
  const f = getDb();
  if (!f) {
    const existing = await getSystemConfig({ fresh: true });
    const updated = buildNextSystemConfig(existing, config);
    localSystemConfig = updated;
    cachedSystemConfig = updated;
    systemConfigLastFetched = Date.now();
    return updated;
  }

  const ref = f.collection('system').doc('config');
  const updated = await f.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists
      ? normalizeSystemConfig(snap.data() as Partial<SystemConfig>)
      : cloneDefaultSystemConfig();
    const next = buildNextSystemConfig(existing, config);
    tx.set(ref, omitUndefinedDeep(next), { merge: true });
    return next;
  });

  localSystemConfig = updated;
  cachedSystemConfig = updated;
  systemConfigLastFetched = Date.now();

  const verify = await f.collection('system').doc('config').get();
  const written = Number(verify.data()?.tick_interval_seconds);
  if (verify.exists && Number.isFinite(written) && written !== updated.tick_interval_seconds) {
    throw new Error('system_config_persist_mismatch');
  }
  return updated;
}

export function resetSystemConfigCacheForTests(): void {
  cachedSystemConfig = null;
  systemConfigLastFetched = 0;
  localSystemConfig = cloneDefaultSystemConfig();
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

function sumLocalStore(store: Map<string, any[]>): number {
  let n = 0;
  for (const rows of store.values()) n += rows.length;
  return n;
}

async function countCollectionGroupDocs(f: Firestore, name: string): Promise<number | null> {
  try {
    const snap = await f.collectionGroup(name).count().get();
    return Number(snap.data().count) || 0;
  } catch {
    return null;
  }
}

async function countNamedSubcollections(f: Firestore, name: string, userIds: string[]): Promise<number> {
  let total = 0;
  for (const userId of userIds) {
    try {
      const snap = await f.collection('users').doc(userId).collection(name).count().get();
      total += Number(snap.data().count) || 0;
    } catch {
      /* skip user */
    }
  }
  return total;
}

export type PurgeCollectionCounts = {
  audit: number;
  alerts: number;
  trades: number;
};

let purgeCountsCache: { at: number; counts: PurgeCollectionCounts } | null = null;
const PURGE_COUNTS_TTL_MS = 15_000;

export function invalidatePurgeCollectionCountsCache(): void {
  purgeCountsCache = null;
}

/**
 * Document totals for the three purge collections. Uses Firestore count() aggregations
 * (not full scans). 15s cache so Refresh / tab switches do not re-bill immediately.
 */
export async function countPurgeCollections(opts?: { fresh?: boolean }): Promise<PurgeCollectionCounts> {
  if (!opts?.fresh && purgeCountsCache && Date.now() - purgeCountsCache.at < PURGE_COUNTS_TTL_MS) {
    return purgeCountsCache.counts;
  }
  const f = getDb();
  if (!f) {
    const counts = {
      audit: sumLocalStore(localAuditStore),
      alerts: sumLocalStore(localAlertStore),
      trades: sumLocalStore(localTradeStore),
    };
    purgeCountsCache = { at: Date.now(), counts };
    return counts;
  }

  const [auditG, alertsG, tradesG] = await Promise.all([
    countCollectionGroupDocs(f, 'audit'),
    countCollectionGroupDocs(f, 'alerts'),
    countCollectionGroupDocs(f, 'trades'),
  ]);
  const counts: PurgeCollectionCounts = {
    audit: auditG ?? 0,
    alerts: alertsG ?? 0,
    trades: tradesG ?? 0,
  };
  if (auditG == null || alertsG == null || tradesG == null) {
    const users = await getAllUsers();
    const ids = [...new Set([...users.map((u) => u.userId).filter(Boolean), 'system'])];
    if (auditG == null) counts.audit = await countNamedSubcollections(f, 'audit', ids);
    if (alertsG == null) counts.alerts = await countNamedSubcollections(f, 'alerts', ids);
    if (tradesG == null) counts.trades = await countNamedSubcollections(f, 'trades', ids);
  }
  purgeCountsCache = { at: Date.now(), counts };
  return counts;
}

export async function getAllUsers(): Promise<(UserStatusDoc & { config?: any; pushTokens?: string[] })[]> {
  const f = getDb();
  if (!f) {
    return Array.from(localUserStore.values());
  }
  try {
    const snapshot = await f.collection('users').get();
    return snapshot.docs.map((doc: any) => userFromSnapshot(doc));
  } catch {
    return Array.from(localUserStore.values());
  }
}

function sortTradesNewestFirst(trades: TradeRecordDoc[]): TradeRecordDoc[] {
  return [...trades].sort(
    (a, b) => new Date(b.executedAt || 0).getTime() - new Date(a.executedAt || 0).getTime()
  );
}

async function listTradesFromUserCollections(limit: number): Promise<TradeRecordDoc[]> {
  const local: TradeRecordDoc[] = [];
  for (const [ownerId, trades] of localTradeStore.entries()) {
    for (const trade of trades) {
      local.push({ ...trade, userId: trade.userId || ownerId });
    }
  }

  const f = getDb();
  if (!f) {
    return sortTradesNewestFirst(local).slice(0, limit);
  }

  try {
    const users = await f.collection('users').get();
    const all: TradeRecordDoc[] = [];
    for (const userDoc of users.docs) {
      const snap = await userDoc.ref.collection('trades').get();
      for (const doc of snap.docs) {
        const data = doc.data() || {};
        all.push({
          ...data,
          tradeId: doc.id,
          userId: userDoc.id,
        } as TradeRecordDoc);
      }
    }
    return sortTradesNewestFirst(all).slice(0, limit);
  } catch {
    return sortTradesNewestFirst(local).slice(0, limit);
  }
}

/** Every trade across all users — used for admin KPIs / P&L (no silent cap). */
export async function getAllTradesForAdmin(): Promise<TradeRecordDoc[]> {
  const f = getDb();
  if (!f) {
    return listTradesFromUserCollections(1_000_000);
  }
  try {
    const snapshot = await f.collectionGroup('trades').get();
    return snapshot.docs.map((doc: any) => {
      const parentUser = doc.ref.parent.parent?.id;
      const data = doc.data() || {};
      return {
        ...data,
        tradeId: doc.id,
        userId: parentUser || data.userId || 'system',
      } as TradeRecordDoc;
    });
  } catch {
    return listTradesFromUserCollections(1_000_000);
  }
}

export async function getAllGlobalTrades(limit = 100): Promise<TradeRecordDoc[]> {
  const f = getDb();
  if (!f) {
    return listTradesFromUserCollections(limit);
  }
  try {
    const snapshot = await f.collectionGroup('trades').orderBy('executedAt', 'desc').limit(limit).get();
    return snapshot.docs.map((doc: any) => {
      const parentUser = doc.ref.parent.parent?.id;
      const data = doc.data() || {};
      return {
        ...data,
        tradeId: doc.id,
        userId: parentUser || data.userId || 'system',
      } as TradeRecordDoc;
    });
  } catch {
    // Collection-group + orderBy needs a composite index; fall back to per-user reads.
    return listTradesFromUserCollections(limit);
  }
}

export async function getAllSystemAuditLogs(limit = 100): Promise<AuditLogDoc[]> {
  const f = getDb();
  if (!f) {
    const allLogs: AuditLogDoc[] = [];
    for (const logs of localAuditStore.values()) {
      allLogs.push(...logs);
    }
    allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return allLogs.slice(0, limit);
  }
  try {
    const snapshot = await f.collectionGroup('audit').orderBy('timestamp', 'desc').limit(limit).get();
    return snapshot.docs.map((doc: any) => {
      const parentUser = doc.ref.parent.parent?.id;
      const data = doc.data() || {};
      return {
        ...data,
        logId: doc.id,
        userId: parentUser || data.userId || 'system',
      } as AuditLogDoc;
    });
  } catch {
    const allLogs: AuditLogDoc[] = [];
    for (const logs of localAuditStore.values()) {
      allLogs.push(...logs);
    }
    allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return allLogs.slice(0, limit);
  }
}

export async function disarmAllUsers(reason = 'admin_kill_switch'): Promise<{ disarmedCount: number }> {
  const users = await getAllUsers();
  let disarmedCount = 0;
  for (const u of users) {
    if (u.state === 'ARMED' || u.cloudTradingEnabled) {
      await upsertUserDoc(u.userId, {
        state: 'DISARMED',
        cloudTradingEnabled: false,
        lastError: `Disarmed: ${reason}`,
      });
      await writeAuditLog(u.userId, 'KILL_SWITCH', { reason, disarmedAt: new Date().toISOString() });
      disarmedCount++;
    }
  }
  return { disarmedCount };
}


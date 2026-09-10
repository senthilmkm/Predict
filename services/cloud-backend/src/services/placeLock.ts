/**
 * Cross-instance lock so a Home Buy tap and the GCP worker cannot both
 * submit a live order for the same 15m ticker.
 */
import { getFirestoreDb } from './firestore';

export const PLACE_LOCK_STALE_MS = 45_000;

type Holder = { requestId: string; atMs: number };

const localLocks = new Map<string, Holder[]>();
const chains = new Map<string, Promise<void>>();

function lockKey(userId: string, ticker: string): string {
  return `${String(userId || '').trim()}::${String(ticker || '').trim()}`;
}

function tickerDocId(ticker: string): string {
  return encodeURIComponent(String(ticker || '').trim()).slice(0, 700);
}

function prune(holders: Holder[], nowMs: number): Holder[] {
  return holders.filter((h) => nowMs - h.atMs < PLACE_LOCK_STALE_MS);
}

async function withKey<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = chains.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = prev.then(() => gate).catch(() => undefined);
  chains.set(key, next);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    queueMicrotask(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  }
}

export function resetPlaceLocksForTests(): void {
  localLocks.clear();
  chains.clear();
}

function holdersFromDoc(data: any, nowMs: number): Holder[] {
  const raw = data?.holders;
  if (!raw || typeof raw !== 'object') return [];
  const out: Holder[] = [];
  for (const [requestId, at] of Object.entries(raw)) {
    const atMs = typeof at === 'number' ? at : Date.parse(String(at));
    if (!requestId || !Number.isFinite(atMs)) continue;
    if (nowMs - atMs >= PLACE_LOCK_STALE_MS) continue;
    out.push({ requestId, atMs });
  }
  return out;
}

export async function tryAcquirePlaceLock(opts: {
  userId: string;
  ticker: string;
  cap: number;
  requestId: string;
  existingBuys: number;
  nowMs?: number;
}): Promise<{ ok: true } | { ok: false; reason: 'window_locked' | 'max_trades_asset_window' }> {
  const userId = String(opts.userId || '').trim();
  const ticker = String(opts.ticker || '').trim();
  const requestId = String(opts.requestId || '').trim();
  const cap = Math.min(5, Math.max(1, Math.round(Number(opts.cap) || 1)));
  const existing = Math.max(0, Math.round(Number(opts.existingBuys) || 0));
  if (!userId || !ticker || !requestId) {
    return { ok: false, reason: 'window_locked' };
  }
  if (existing >= cap) {
    return { ok: false, reason: 'max_trades_asset_window' };
  }
  const key = lockKey(userId, ticker);
  const nowMs = opts.nowMs ?? Date.now();

  const f = getFirestoreDb();
  if (f) {
    const ref = f.collection('users').doc(userId).collection('placeLocks').doc(tickerDocId(ticker));
    try {
      return await f.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const holders = holdersFromDoc(snap.exists ? snap.data() : {}, nowMs);
        if (holders.some((h) => h.requestId === requestId)) {
          return { ok: true as const };
        }
        if (existing + holders.length >= cap) {
          return { ok: false as const, reason: 'window_locked' as const };
        }
        const next: Record<string, string> = {};
        for (const h of holders) next[h.requestId] = new Date(h.atMs).toISOString();
        next[requestId] = new Date(nowMs).toISOString();
        tx.set(ref, { ticker, holders: next, updatedAt: new Date(nowMs).toISOString() });
        return { ok: true as const };
      });
    } catch {
      return { ok: false, reason: 'window_locked' };
    }
  }

  return withKey(key, () => {
    const holders = prune(localLocks.get(key) || [], nowMs);
    if (holders.some((h) => h.requestId === requestId)) {
      localLocks.set(key, holders);
      return { ok: true as const };
    }
    if (existing + holders.length >= cap) {
      localLocks.set(key, holders);
      return { ok: false as const, reason: 'window_locked' as const };
    }
    holders.push({ requestId, atMs: nowMs });
    localLocks.set(key, holders);
    return { ok: true as const };
  });
}

export async function releasePlaceLock(opts: {
  userId: string;
  ticker: string;
  requestId: string;
}): Promise<void> {
  const userId = String(opts.userId || '').trim();
  const ticker = String(opts.ticker || '').trim();
  const requestId = String(opts.requestId || '').trim();
  if (!userId || !ticker || !requestId) return;

  const f = getFirestoreDb();
  if (f) {
    const ref = f.collection('users').doc(userId).collection('placeLocks').doc(tickerDocId(ticker));
    try {
      await f.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const nowMs = Date.now();
        const holders = holdersFromDoc(snap.exists ? snap.data() : {}, nowMs).filter(
          (h) => h.requestId !== requestId
        );
        const next: Record<string, string> = {};
        for (const h of holders) next[h.requestId] = new Date(h.atMs).toISOString();
        if (Object.keys(next).length) {
          tx.set(ref, { ticker, holders: next, updatedAt: new Date().toISOString() });
        } else {
          tx.delete(ref);
        }
      });
    } catch {
      /* best-effort release */
    }
    return;
  }

  const key = lockKey(userId, ticker);
  await withKey(key, () => {
    const holders = (localLocks.get(key) || []).filter((h) => h.requestId !== requestId);
    if (holders.length) localLocks.set(key, holders);
    else localLocks.delete(key);
  });
}

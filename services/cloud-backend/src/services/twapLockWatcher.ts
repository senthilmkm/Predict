import { twapLockSecondsLeft } from '../../../../packages/trading-core/src/twapLock';
import { getFirestoreDb } from './firestore';

export const TWAP_LOCK_WATCHER_STALE_MS = 8_000;
const WRITE_MIN_MS = 2_000;

export type TwapLockWatcherSnapshot = {
  at: string;
  watching: boolean;
  userCount: number;
  assets: string[];
  secondsLeft: number | null;
};

let memory: TwapLockWatcherSnapshot = idleTwapLockWatcherSnapshot(new Date(0));
let lastWriteMs = 0;
let lastKey = '';

export function idleTwapLockWatcherSnapshot(now = new Date()): TwapLockWatcherSnapshot {
  return {
    at: now.toISOString(),
    watching: false,
    userCount: 0,
    assets: [],
    secondsLeft: null,
  };
}

export function buildTwapLockWatcherSnapshot(opts: {
  now: Date;
  watchUsers: Map<string, string[]>;
  closeByAsset: Record<string, Date | null | undefined>;
}): TwapLockWatcherSnapshot {
  const assets = [...new Set([...opts.watchUsers.values()].flat().map((a) => String(a || '').trim()))]
    .filter(Boolean)
    .sort();
  const userCount = opts.watchUsers.size;
  if (userCount <= 0 || assets.length === 0) {
    return idleTwapLockWatcherSnapshot(opts.now);
  }
  let minLeft: number | null = null;
  for (const asset of assets) {
    const close = opts.closeByAsset[asset];
    if (!close) continue;
    const left = twapLockSecondsLeft(opts.now, close);
    if (minLeft == null || left < minLeft) minLeft = left;
  }
  return {
    at: opts.now.toISOString(),
    watching: true,
    userCount,
    assets,
    secondsLeft: minLeft,
  };
}

export function formatTwapLockWatcherChip(
  snap: TwapLockWatcherSnapshot | null | undefined,
  now = new Date()
): string {
  const at = snap?.at ? Date.parse(snap.at) : NaN;
  const stale = !Number.isFinite(at) || now.getTime() - at > TWAP_LOCK_WATCHER_STALE_MS;
  if (!snap?.watching || stale) return 'TWAP watcher · idle';
  const users = snap.userCount === 1 ? '1 user' : `${Math.max(0, snap.userCount)} users`;
  const assets = (snap.assets || []).filter(Boolean).join(' ');
  const left =
    snap.secondsLeft != null && Number.isFinite(snap.secondsLeft) ? ` · ${Math.max(0, snap.secondsLeft)}s left` : '';
  return `TWAP watcher · ${users}${assets ? ` · ${assets}` : ''}${left}`;
}

function snapshotKey(snap: TwapLockWatcherSnapshot): string {
  return `${snap.watching}|${snap.userCount}|${snap.assets.join(',')}|${snap.secondsLeft ?? ''}`;
}

export function resetTwapLockWatcherMemoryForTests(): void {
  memory = idleTwapLockWatcherSnapshot(new Date(0));
  lastWriteMs = 0;
  lastKey = '';
}

export function peekTwapLockWatcherMemory(): TwapLockWatcherSnapshot {
  return memory;
}

export async function persistTwapLockWatcherSnapshot(snap: TwapLockWatcherSnapshot): Promise<void> {
  const nowMs = Date.now();
  const key = snapshotKey(snap);
  const forceIdle = lastKey.startsWith('true') && !snap.watching;
  if (!forceIdle && key === lastKey && nowMs - lastWriteMs < WRITE_MIN_MS) {
    memory = { ...snap };
    return;
  }
  memory = snap;
  lastKey = key;
  lastWriteMs = nowMs;
  const db = getFirestoreDb();
  if (!db) return;
  try {
    await db.collection('system').doc('twapLockWatcher').set(snap);
  } catch {
    /* memory still holds the snapshot for this instance */
  }
}

export async function getTwapLockWatcherSnapshot(): Promise<TwapLockWatcherSnapshot> {
  const memAt = Date.parse(memory.at);
  if (Number.isFinite(memAt) && Date.now() - memAt < 3_000) {
    return memory;
  }
  const db = getFirestoreDb();
  if (db) {
    try {
      const doc = await db.collection('system').doc('twapLockWatcher').get();
      if (doc.exists && doc.data()) {
        const raw = doc.data() as Partial<TwapLockWatcherSnapshot>;
        const snap: TwapLockWatcherSnapshot = {
          at: String(raw.at || ''),
          watching: raw.watching === true,
          userCount: Number(raw.userCount) || 0,
          assets: Array.isArray(raw.assets) ? raw.assets.map(String) : [],
          secondsLeft: raw.secondsLeft == null ? null : Number(raw.secondsLeft),
        };
        memory = snap;
        return snap;
      }
    } catch {
      /* */
    }
  }
  return memory.at && memory.at !== new Date(0).toISOString() ? memory : idleTwapLockWatcherSnapshot();
}

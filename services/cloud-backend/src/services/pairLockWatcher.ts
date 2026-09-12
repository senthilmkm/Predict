import { goldFadeMinutesLeft } from '../../../../packages/trading-core/src/goldFade';
import { getFirestoreDb } from './firestore';

export const PAIR_LOCK_WATCHER_STALE_MS = 8_000;
const WRITE_MIN_MS = 2_000;

export type PairLockWatcherSnapshot = {
  at: string;
  watching: boolean;
  userCount: number;
  assets: string[];
  minutesLeft: number | null;
};

let memory: PairLockWatcherSnapshot = idlePairLockWatcherSnapshot(new Date(0));
let lastWriteMs = 0;
let lastKey = '';

export function idlePairLockWatcherSnapshot(now = new Date()): PairLockWatcherSnapshot {
  return { at: now.toISOString(), watching: false, userCount: 0, assets: [], minutesLeft: null };
}

export function buildPairLockWatcherSnapshot(opts: {
  now: Date;
  watchUsers: Map<string, string[]>;
  minutesLeftByAsset: Record<string, number | null | undefined>;
}): PairLockWatcherSnapshot {
  const assets = [...new Set([...opts.watchUsers.values()].flat().map((a) => String(a || '').trim()))]
    .filter(Boolean)
    .sort();
  const userCount = opts.watchUsers.size;
  if (userCount <= 0 || assets.length === 0) return idlePairLockWatcherSnapshot(opts.now);
  let minLeft: number | null = null;
  for (const asset of assets) {
    const left = opts.minutesLeftByAsset[asset];
    if (left == null || !Number.isFinite(left)) continue;
    if (minLeft == null || left < minLeft) minLeft = left;
  }
  return {
    at: opts.now.toISOString(),
    watching: true,
    userCount,
    assets,
    minutesLeft: minLeft,
  };
}

export function formatPairLockWatcherChip(
  snap: PairLockWatcherSnapshot | null | undefined,
  now = new Date()
): string {
  const at = snap?.at ? Date.parse(snap.at) : NaN;
  const stale = !Number.isFinite(at) || now.getTime() - at > PAIR_LOCK_WATCHER_STALE_MS;
  if (!snap?.watching || stale) return 'Pair lock watcher · idle';
  const users = snap.userCount === 1 ? '1 user' : `${Math.max(0, snap.userCount)} users`;
  const assets = (snap.assets || []).filter(Boolean).join(' ');
  const left =
    snap.minutesLeft != null && Number.isFinite(snap.minutesLeft)
      ? ` · ${Math.max(0, Math.round(snap.minutesLeft))}m left`
      : '';
  return `Pair lock watcher · ${users}${assets ? ` · ${assets}` : ''}${left}`;
}

function snapshotKey(snap: PairLockWatcherSnapshot): string {
  return `${snap.watching}|${snap.userCount}|${snap.assets.join(',')}|${snap.minutesLeft ?? ''}`;
}

export function resetPairLockWatcherMemoryForTests(): void {
  memory = idlePairLockWatcherSnapshot(new Date(0));
  lastWriteMs = 0;
  lastKey = '';
}

export async function persistPairLockWatcherSnapshot(snap: PairLockWatcherSnapshot): Promise<void> {
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
    await db.collection('system').doc('pairLockWatcher').set(snap);
  } catch {
    /* */
  }
}

export async function getPairLockWatcherSnapshot(): Promise<PairLockWatcherSnapshot> {
  const memAt = Date.parse(memory.at);
  if (Number.isFinite(memAt) && Date.now() - memAt < 3_000) return memory;
  const db = getFirestoreDb();
  if (db) {
    try {
      const doc = await db.collection('system').doc('pairLockWatcher').get();
      if (doc.exists && doc.data()) {
        const raw = doc.data() as Partial<PairLockWatcherSnapshot>;
        const snap: PairLockWatcherSnapshot = {
          at: String(raw.at || ''),
          watching: raw.watching === true,
          userCount: Number(raw.userCount) || 0,
          assets: Array.isArray(raw.assets) ? raw.assets.map(String) : [],
          minutesLeft: raw.minutesLeft == null ? null : Number(raw.minutesLeft),
        };
        memory = snap;
        return snap;
      }
    } catch {
      /* */
    }
  }
  return memory.at && memory.at !== new Date(0).toISOString() ? memory : idlePairLockWatcherSnapshot();
}

export function pairLockMinutesLeftFromLean(lean: {
  minutes_left?: number;
  minutes_remaining?: number;
} | null | undefined): number | null {
  if (!lean) return null;
  const left = goldFadeMinutesLeft(lean);
  return Number.isFinite(left) ? left : null;
}

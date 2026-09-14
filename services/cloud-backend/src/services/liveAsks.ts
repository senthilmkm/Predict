import { getFirestoreDb } from './firestore';
import type { LiveAskByAsset } from './oneSecondMarket';

export const LIVE_ASKS_STALE_MS = 8_000;
/** Serve this process's just-written book without a Firestore round trip. */
export const LIVE_ASKS_LOCAL_FRESH_MS = 1_500;
const WRITE_MIN_MS = 1_000;
const IDLE_WRITE_MIN_MS = 30_000;

export type LiveAsksSnapshot = {
  at: string;
  byAsset: Record<string, LiveAskByAsset>;
};

let memory: LiveAsksSnapshot = idleLiveAsksSnapshot(new Date(0));
let lastWriteMs = 0;
let lastMemoryWriteMs = 0;
let lastKey = '';

export function idleLiveAsksSnapshot(now = new Date()): LiveAsksSnapshot {
  return { at: now.toISOString(), byAsset: {} };
}

export function mergeLiveAsks(
  prev: Record<string, LiveAskByAsset>,
  next: Record<string, LiveAskByAsset>,
  watchAssets: string[]
): Record<string, LiveAskByAsset> {
  const out: Record<string, LiveAskByAsset> = {};
  for (const raw of watchAssets) {
    const asset = String(raw || '').trim();
    if (!asset) continue;
    if (next[asset]) out[asset] = next[asset];
    else if (prev[asset]) out[asset] = prev[asset];
  }
  return out;
}

function snapshotKey(snap: LiveAsksSnapshot): string {
  const keys = Object.keys(snap.byAsset).sort();
  if (keys.length === 0) return 'idle';
  return keys
    .map((asset) => {
      const q = snap.byAsset[asset];
      return `${asset}:${q?.yes_ask ?? ''}:${q?.no_ask ?? ''}`;
    })
    .join('|');
}

export function peekLiveAsksByAsset(): Record<string, LiveAskByAsset> {
  return { ...memory.byAsset };
}

export function resetLiveAsksMemoryForTests(): void {
  memory = idleLiveAsksSnapshot(new Date(0));
  lastWriteMs = 0;
  lastMemoryWriteMs = 0;
  lastKey = '';
}

export async function persistLiveAsksSnapshot(snap: LiveAsksSnapshot): Promise<void> {
  const nowMs = Date.now();
  const key = snapshotKey(snap);
  const watching = key !== 'idle';
  const forceIdle = lastKey !== 'idle' && lastKey !== '' && !watching;
  const minMs = watching ? WRITE_MIN_MS : IDLE_WRITE_MIN_MS;
  memory = { at: snap.at, byAsset: { ...snap.byAsset } };
  lastMemoryWriteMs = nowMs;
  if (!watching && !forceIdle && key === lastKey && nowMs - lastWriteMs < minMs) {
    return;
  }
  lastKey = key;
  lastWriteMs = nowMs;
  const db = getFirestoreDb();
  if (!db) return;
  void db
    .collection('system')
    .doc('liveAsks')
    .set(memory)
    .catch(() => {
      /* keep memory */
    });
}

function parseSnapshot(raw: Partial<LiveAsksSnapshot> | null | undefined): LiveAsksSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const at = String(raw.at || '');
  if (!at) return null;
  const src = raw.byAsset && typeof raw.byAsset === 'object' ? raw.byAsset : {};
  const byAsset: Record<string, LiveAskByAsset> = {};
  for (const [asset, quote] of Object.entries(src)) {
    const key = String(asset || '').trim();
    if (!key || !quote || typeof quote !== 'object') continue;
    const n = (v: unknown) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : undefined;
    };
    const yes_ask = n((quote as LiveAskByAsset).yes_ask);
    const no_ask = n((quote as LiveAskByAsset).no_ask);
    if (yes_ask == null && no_ask == null) continue;
    byAsset[key] = {
      yes_ask,
      no_ask,
      yes_bid: n((quote as LiveAskByAsset).yes_bid),
      no_bid: n((quote as LiveAskByAsset).no_bid),
      ticker: String((quote as LiveAskByAsset).ticker || '').trim() || undefined,
    };
  }
  return { at, byAsset };
}

export async function getLiveAsksSnapshot(): Promise<LiveAsksSnapshot> {
  if (lastMemoryWriteMs && Date.now() - lastMemoryWriteMs < LIVE_ASKS_LOCAL_FRESH_MS) {
    return memory;
  }
  const db = getFirestoreDb();
  if (db) {
    try {
      const doc = await db.collection('system').doc('liveAsks').get();
      if (doc.exists && doc.data()) {
        const snap = parseSnapshot(doc.data() as Partial<LiveAsksSnapshot>);
        if (snap) {
          const remoteAt = Date.parse(snap.at);
          const localAt = Date.parse(memory.at);
          if (
            lastMemoryWriteMs &&
            Number.isFinite(localAt) &&
            Number.isFinite(remoteAt) &&
            localAt >= remoteAt
          ) {
            return memory;
          }
          memory = snap;
          return snap;
        }
      }
    } catch {
      /* */
    }
  }
  return memory.at && memory.at !== new Date(0).toISOString() ? memory : idleLiveAsksSnapshot();
}

export function liveAsksForClient(snap: LiveAsksSnapshot | null | undefined): {
  at: string;
  byAsset: Record<string, LiveAskByAsset>;
} {
  const safe = snap && snap.at ? snap : idleLiveAsksSnapshot();
  return { at: safe.at, byAsset: { ...safe.byAsset } };
}

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
  byTicker?: Record<string, LiveAskByAsset>;
};

let memory: LiveAsksSnapshot = idleLiveAsksSnapshot(new Date(0));
let lastWriteMs = 0;
let lastMemoryWriteMs = 0;
let lastKey = '';

export function idleLiveAsksSnapshot(now = new Date()): LiveAsksSnapshot {
  return { at: now.toISOString(), byAsset: {}, byTicker: {} };
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
  const assetKeys = Object.keys(snap.byAsset).sort();
  const tickerKeys = Object.keys(snap.byTicker || {}).sort();
  if (assetKeys.length === 0 && tickerKeys.length === 0) return 'idle';
  const assets = assetKeys
    .map((asset) => {
      const q = snap.byAsset[asset];
      return `${asset}:${q?.yes_ask ?? ''}:${q?.no_ask ?? ''}:${q?.yes_bid ?? ''}:${q?.no_bid ?? ''}`;
    })
    .join('|');
  const tickers = tickerKeys
    .map((ticker) => {
      const q = snap.byTicker?.[ticker];
      return `t:${ticker}:${q?.yes_bid ?? ''}:${q?.no_bid ?? ''}`;
    })
    .join('|');
  return `${assets}#${tickers}`;
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
  memory = { at: snap.at, byAsset: { ...snap.byAsset }, byTicker: { ...(snap.byTicker || {}) } };
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

function parseQuoteRow(
  quote: LiveAskByAsset,
  requireAsk: boolean
): LiveAskByAsset | null {
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
  };
  const yes_ask = n(quote.yes_ask);
  const no_ask = n(quote.no_ask);
  const yes_bid = n(quote.yes_bid);
  const no_bid = n(quote.no_bid);
  if (requireAsk) {
    if (yes_ask == null && no_ask == null) return null;
  } else if (yes_ask == null && no_ask == null && yes_bid == null && no_bid == null) {
    return null;
  }
  return {
    yes_ask,
    no_ask,
    yes_bid,
    no_bid,
    ticker: String(quote.ticker || '').trim() || undefined,
  };
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
    const row = parseQuoteRow(quote as LiveAskByAsset, true);
    if (row) byAsset[key] = row;
  }
  const tickerSrc = raw.byTicker && typeof raw.byTicker === 'object' ? raw.byTicker : {};
  const byTicker: Record<string, LiveAskByAsset> = {};
  for (const [ticker, quote] of Object.entries(tickerSrc)) {
    const key = String(ticker || '').trim();
    if (!key || !quote || typeof quote !== 'object') continue;
    const row = parseQuoteRow(quote as LiveAskByAsset, false);
    if (row) byTicker[key] = { ...row, ticker: row.ticker || key };
  }
  return { at, byAsset, byTicker };
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

export function peekLiveAsksByTicker(): Record<string, LiveAskByAsset> {
  return { ...(memory.byTicker || {}) };
}

export function liveAsksForClient(snap: LiveAsksSnapshot | null | undefined): {
  at: string;
  byAsset: Record<string, LiveAskByAsset>;
  byTicker: Record<string, LiveAskByAsset>;
} {
  const safe = snap && snap.at ? snap : idleLiveAsksSnapshot();
  return { at: safe.at, byAsset: { ...safe.byAsset }, byTicker: { ...(safe.byTicker || {}) } };
}

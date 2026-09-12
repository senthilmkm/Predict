import { TWAP_LOCK_ASSETS, TwapLockPrint } from '../../../../packages/trading-core/src/twapLock';
import { getCfbApiCredentials, type CfbApiCredentials } from './secretManager';

export type CfbKalshiClient = {
  getCfbIndexValue: (indexId: string) => Promise<{ ok: boolean; http_status: number; data: unknown }>;
};

/** CME CF Real-Time Index ids. Not Pyth. Not Kalshi candles. */
export const CFB_RTI_INDEX: Record<string, string> = {
  BTC: 'BRTI',
  ETH: 'ETHUSD_RTI',
};

const DEFAULT_TICKER_URL = 'https://www.cfbenchmarks.com/api/v1/values';

export type CfbRtiFetch = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function asUtcSec(raw: unknown): number | null {
  if (typeof raw === 'string' && raw.trim() && Number.isNaN(Number(raw))) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  return Math.floor(ms / 1000);
}

function asPrice(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseOnePrint(rec: Record<string, unknown>, fallbackUtcSec?: number): TwapLockPrint | null {
  const price = asPrice(rec.value ?? rec.price ?? rec.last ?? rec.v ?? rec.index);
  if (price == null) return null;
  const utcSec =
    asUtcSec(rec.time ?? rec.timestamp ?? rec.ts ?? rec.t ?? rec.updated ?? rec.serverTime) ??
    (fallbackUtcSec != null && Number.isFinite(fallbackUtcSec) ? Math.floor(fallbackUtcSec) : null);
  if (utcSec == null) return null;
  return { utcSec, price };
}

/** Kalshi `/cfbenchmarks/values` returns ~3600 one-second rows. Oldest first. */
export function parseCfbRtiPrints(raw: unknown): TwapLockPrint[] {
  if (raw == null) return [];
  const bySec = new Map<number, number>();
  const queue: unknown[] = [raw];
  const seen = new Set<unknown>();
  while (queue.length) {
    const cur = queue.shift();
    if (cur == null || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const item of cur) queue.push(item);
      continue;
    }
    if (typeof cur !== 'object') continue;
    const rec = cur as Record<string, unknown>;
    const hit = parseOnePrint(rec);
    if (hit) bySec.set(hit.utcSec, hit.price);
    if (rec.data != null) queue.push(rec.data);
    if (rec.payload != null) queue.push(rec.payload);
    if (rec.ticker != null) queue.push(rec.ticker);
    if (rec.values != null) queue.push(rec.values);
  }
  return [...bySec.entries()].map(([utcSec, price]) => ({ utcSec, price }));
}

export function latestCfbRtiPrint(prints: TwapLockPrint[]): TwapLockPrint | null {
  let best: TwapLockPrint | null = null;
  for (const p of prints || []) {
    if (!best || p.utcSec >= best.utcSec) best = p;
  }
  return best;
}

/** Latest print only. Kalshi history is oldest-first — do not take row 0. */
export function parseCfbRtiPrint(raw: unknown, fallbackUtcSec?: number): TwapLockPrint | null {
  const latest = latestCfbRtiPrint(parseCfbRtiPrints(raw));
  if (latest) return latest;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return parseOnePrint(raw as Record<string, unknown>, fallbackUtcSec);
}

export function cfbBasicAuthHeader(creds: CfbApiCredentials): string {
  const user = creds.username || '';
  const token = Buffer.from(`${user}:${creds.key}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

export class CfbRtiBuffer {
  private readonly byAsset = new Map<string, Map<number, number>>();

  ingest(asset: string, print: TwapLockPrint): void {
    const key = String(asset || '').trim();
    if (!key || !Number.isFinite(print.utcSec) || !Number.isFinite(print.price)) return;
    let map = this.byAsset.get(key);
    if (!map) {
      map = new Map();
      this.byAsset.set(key, map);
    }
    map.set(Math.floor(print.utcSec), print.price);
    if (map.size > 180) {
      const keys = [...map.keys()].sort((a, b) => a - b);
      for (const k of keys.slice(0, keys.length - 120)) map.delete(k);
    }
  }

  prints(asset: string): TwapLockPrint[] {
    const map = this.byAsset.get(String(asset || '').trim());
    if (!map) return [];
    return [...map.entries()].map(([utcSec, price]) => ({ utcSec, price }));
  }

  clear(): void {
    this.byAsset.clear();
  }
}

export const cfbRtiBuffer = new CfbRtiBuffer();

export async function isCfbRtiConfigured(): Promise<boolean> {
  return Boolean(await getCfbApiCredentials());
}

async function fetchCfbRtiRaw(
  asset: string,
  opts?: {
    fetchImpl?: CfbRtiFetch;
    now?: Date;
    apiKey?: string;
    credentials?: CfbApiCredentials | null;
    kalshi?: CfbKalshiClient | null;
  }
): Promise<unknown | null> {
  if (!TWAP_LOCK_ASSETS.includes(asset as (typeof TWAP_LOCK_ASSETS)[number])) return null;
  const id = CFB_RTI_INDEX[asset];
  if (!id) return null;
  const creds =
    opts?.credentials !== undefined
      ? opts.credentials
      : opts?.apiKey != null
        ? { key: String(opts.apiKey).trim() }
        : await getCfbApiCredentials();

  if (creds?.key) {
    const fetchImpl = opts?.fetchImpl || (fetch as unknown as CfbRtiFetch);
    const base = String(process.env.CFB_RTI_URL || DEFAULT_TICKER_URL).replace(/\/$/, '');
    const url = `${base}${base.includes('?') ? '&' : '?'}id=${encodeURIComponent(id)}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (creds.username) {
      headers.Authorization = cfbBasicAuthHeader(creds);
    } else {
      headers.Authorization = `Bearer ${creds.key}`;
      headers['X-API-KEY'] = creds.key;
    }
    try {
      const res = await fetchImpl(url, { headers });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  if (opts?.kalshi) {
    try {
      const got = await opts.kalshi.getCfbIndexValue(id);
      if (!got.ok) return null;
      return got.data;
    } catch {
      return null;
    }
  }
  return null;
}

export async function fetchCfbRtiPrints(
  asset: string,
  opts?: {
    fetchImpl?: CfbRtiFetch;
    now?: Date;
    apiKey?: string;
    credentials?: CfbApiCredentials | null;
    kalshi?: CfbKalshiClient | null;
  }
): Promise<TwapLockPrint[]> {
  const raw = await fetchCfbRtiRaw(asset, opts);
  if (raw == null) return [];
  return parseCfbRtiPrints(raw);
}

export function ingestRecentCfbPrints(
  asset: string,
  prints: TwapLockPrint[],
  now: Date,
  keepSec = 180
): number {
  const minSec = Math.floor(now.getTime() / 1000) - keepSec;
  let n = 0;
  for (const print of prints) {
    if (print.utcSec >= minSec) {
      cfbRtiBuffer.ingest(asset, print);
      n += 1;
    }
  }
  return n;
}

export async function fetchCfbRtiPrint(
  asset: string,
  opts?: {
    fetchImpl?: CfbRtiFetch;
    now?: Date;
    apiKey?: string;
    credentials?: CfbApiCredentials | null;
    kalshi?: CfbKalshiClient | null;
  }
): Promise<TwapLockPrint | null> {
  const raw = await fetchCfbRtiRaw(asset, opts);
  if (raw == null) return null;
  const fallback = Math.floor((opts?.now || new Date()).getTime() / 1000);
  return parseCfbRtiPrint(raw, fallback);
}

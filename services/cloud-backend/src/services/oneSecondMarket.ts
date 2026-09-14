import { AssetKey } from 'trading-core';

export type OneSecondAskQuote = {
  yes_ask?: number;
  no_ask?: number;
  yes_bid?: number;
  no_bid?: number;
};

export type OneSecondMarketSnapshot = {
  now: Date;
  leans: Partial<Record<AssetKey, any>>;
  quotes: Map<string, OneSecondAskQuote>;
};

export function collectWatchAssets(
  ...maps: Array<Map<string, string[]> | undefined | null>
): AssetKey[] {
  const out = new Set<string>();
  for (const map of maps) {
    if (!map) continue;
    for (const assets of map.values()) {
      for (const asset of assets || []) {
        const key = String(asset || '').trim();
        if (key) out.add(key);
      }
    }
  }
  return [...out] as AssetKey[];
}

/** Home Last Signals rows: assets the user has explicitly On. */
export function collectHomeQuoteAssets(
  users: Array<{ config?: { assets_enabled?: Record<string, unknown> } } | null | undefined>
): AssetKey[] {
  const out = new Set<string>();
  for (const user of users) {
    const enabled = user?.config?.assets_enabled;
    if (!enabled || typeof enabled !== 'object') continue;
    for (const [asset, on] of Object.entries(enabled)) {
      if (on !== true) continue;
      const key = String(asset || '').trim();
      if (key) out.add(key);
    }
  }
  return [...out] as AssetKey[];
}

export function unionAssetKeys(
  ...lists: Array<readonly string[] | undefined | null>
): AssetKey[] {
  const out = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const raw of list) {
      const key = String(raw || '').trim();
      if (key) out.add(key);
    }
  }
  return [...out] as AssetKey[];
}

export function uniqueTickersFromLeans(
  leans: Partial<Record<string, { market_ticker?: string }>>
): string[] {
  const out = new Set<string>();
  for (const lean of Object.values(leans)) {
    const ticker = String(lean?.market_ticker || '').trim();
    if (ticker) out.add(ticker);
  }
  return [...out];
}

export type LiveAskByAsset = OneSecondAskQuote & { ticker?: string };

/** Map the shared 1s quote book onto asset keys for Home. */
export function liveAsksByAsset(
  leans: Partial<Record<string, { market_ticker?: string }>>,
  quotes: Map<string, OneSecondAskQuote>
): Record<string, LiveAskByAsset> {
  const out: Record<string, LiveAskByAsset> = {};
  for (const [asset, lean] of Object.entries(leans)) {
    const key = String(asset || '').trim();
    const ticker = String(lean?.market_ticker || '').trim();
    if (!key || !ticker) continue;
    const q = quotes.get(ticker);
    if (!q || (q.yes_ask == null && q.no_ask == null)) continue;
    out[key] = { ...q, ticker };
  }
  return out;
}

export function rememberTickersFromLeans(
  prev: Record<string, string>,
  leans: Partial<Record<string, { market_ticker?: string }>>
): Record<string, string> {
  const out = { ...prev };
  for (const [asset, lean] of Object.entries(leans)) {
    const key = String(asset || '').trim();
    const ticker = String(lean?.market_ticker || '').trim();
    if (key && ticker) out[key] = ticker;
  }
  return out;
}

export function resolveAskTickers(
  assets: readonly string[],
  ...sources: Array<Record<string, string | { ticker?: string } | undefined> | undefined | null>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const asset of assets) {
    const key = String(asset || '').trim();
    if (!key || out[key]) continue;
    for (const src of sources) {
      if (!src) continue;
      const raw = src[key];
      const ticker =
        typeof raw === 'string'
          ? raw.trim()
          : String((raw as { ticker?: string } | undefined)?.ticker || '').trim();
      if (ticker) {
        out[key] = ticker;
        break;
      }
    }
  }
  return out;
}

export function liveAsksFromTickers(
  tickers: Record<string, string>,
  quotes: Map<string, OneSecondAskQuote>
): Record<string, LiveAskByAsset> {
  const leans: Record<string, { market_ticker: string }> = {};
  for (const [asset, ticker] of Object.entries(tickers)) {
    const key = String(asset || '').trim();
    const tkr = String(ticker || '').trim();
    if (key && tkr) leans[key] = { market_ticker: tkr };
  }
  return liveAsksByAsset(leans, quotes);
}

export function quoteFromMarket(raw: any): OneSecondAskQuote {
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
  };
  return {
    yes_ask: n(raw?.yes_ask_dollars ?? raw?.yes_ask),
    no_ask: n(raw?.no_ask_dollars ?? raw?.no_ask),
    yes_bid: n(raw?.yes_bid_dollars ?? raw?.yes_bid),
    no_bid: n(raw?.no_bid_dollars ?? raw?.no_bid),
  };
}

/** Copy lean and stamp the shared 1s ask/bid. Never mutates the snapshot lean. */
export function leanWithSnapshotQuote(
  lean: Record<string, any>,
  quotes: Map<string, OneSecondAskQuote>
): Record<string, any> {
  const next: Record<string, any> = { ...lean };
  const ticker = String(lean?.market_ticker || '').trim();
  const q = ticker ? quotes.get(ticker) : undefined;
  if (!q) return next;
  if (q.yes_ask != null) next.yes_ask = q.yes_ask;
  if (q.no_ask != null) next.no_ask = q.no_ask;
  if (q.yes_bid != null) next.yes_bid = q.yes_bid;
  if (q.no_bid != null) next.no_bid = q.no_bid;
  return next;
}

export function mergeQuoteMaps(
  ...maps: Array<Map<string, OneSecondAskQuote> | undefined | null>
): Map<string, OneSecondAskQuote> {
  const out = new Map<string, OneSecondAskQuote>();
  for (const map of maps) {
    if (!map) continue;
    for (const [ticker, quote] of map) {
      if (ticker) out.set(ticker, quote);
    }
  }
  return out;
}

export async function fetchAskQuotesOnce(
  tickers: string[],
  fetchQuote: (ticker: string) => Promise<any>
): Promise<Map<string, OneSecondAskQuote>> {
  const quotes = new Map<string, OneSecondAskQuote>();
  const uniq = [...new Set(tickers.map((t) => String(t || '').trim()).filter(Boolean))];
  await Promise.all(
    uniq.map(async (ticker) => {
      try {
        const raw = await fetchQuote(ticker);
        quotes.set(ticker, quoteFromMarket(raw));
      } catch {
        /* path keeps the lean ask */
      }
    })
  );
  return quotes;
}

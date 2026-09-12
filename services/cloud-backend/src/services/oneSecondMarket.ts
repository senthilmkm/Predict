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

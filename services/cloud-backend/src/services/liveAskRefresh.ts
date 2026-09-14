import { computeLean } from 'trading-core';
import { getMarketQuote } from '../../../../packages/trading-core/src/lean';
import { isMarketOpen } from './marketHours';
import {
  fetchAskQuotesOnce,
  liveAsksFromTickers,
  rememberTickersFromLeans,
  resolveAskTickers,
} from './oneSecondMarket';
import {
  idleLiveAsksSnapshot,
  liveAsksForClient,
  mergeLiveAsks,
  peekLiveAsksByAsset,
  persistLiveAsksSnapshot,
} from './liveAsks';

let tickerCache: Record<string, string> = {};
let refreshInFlight: Promise<ReturnType<typeof liveAsksForClient>> | null = null;

export function rememberAskTickers(next: Record<string, string>): void {
  tickerCache = { ...tickerCache, ...next };
}

export function rememberAskTickersFromLeans(
  leans: Partial<Record<string, { market_ticker?: string }>>
): void {
  tickerCache = rememberTickersFromLeans(tickerCache, leans);
}

export function peekAskTickers(): Record<string, string> {
  return { ...tickerCache };
}

export function resetLiveAskRefreshForTests(): void {
  tickerCache = {};
  refreshInFlight = null;
}

async function ensureTickers(assets: string[], now: Date): Promise<Record<string, string>> {
  let tickers = resolveAskTickers(assets, tickerCache, peekLiveAsksByAsset());
  const missing = assets.filter((asset) => !tickers[asset] && isMarketOpen(asset, now).open);
  if (!missing.length) return tickers;
  await Promise.all(
    missing.map(async (asset) => {
      try {
        const lean = await computeLean(asset, 0.0, fetch, now);
        const ticker = String(lean?.market_ticker || '').trim();
        if (ticker) tickerCache[asset] = ticker;
      } catch {
        /* keep last ticker */
      }
    })
  );
  return resolveAskTickers(assets, tickerCache, peekLiveAsksByAsset());
}

export async function refreshLiveAskBook(
  assets: string[],
  now = new Date()
): Promise<ReturnType<typeof liveAsksForClient>> {
  if (process.env.NODE_ENV === 'test') {
    const peek = peekLiveAsksByAsset();
    const at = now.toISOString();
    if (!Object.keys(peek).length) {
      await persistLiveAsksSnapshot(idleLiveAsksSnapshot(now));
      return liveAsksForClient({ at, byAsset: {} });
    }
    await persistLiveAsksSnapshot({ at, byAsset: peek });
    return liveAsksForClient({ at, byAsset: peek });
  }
  const wanted = [...new Set(assets.map((a) => String(a || '').trim()).filter(Boolean))];
  const fallback = Object.keys(peekLiveAsksByAsset());
  const quoteAssets = wanted.length ? wanted : fallback;
  const tickers = await ensureTickers(quoteAssets, now);
  const quotes = Object.keys(tickers).length
    ? await fetchAskQuotesOnce(Object.values(tickers), (ticker) =>
        getMarketQuote(ticker, fetch, { skipCache: true })
      )
    : new Map();
  const next = mergeLiveAsks(
    peekLiveAsksByAsset(),
    liveAsksFromTickers(tickers, quotes),
    quoteAssets.length ? quoteAssets : fallback
  );
  for (const [asset, row] of Object.entries(next)) {
    const ticker = String(row?.ticker || '').trim();
    if (ticker) tickerCache[asset] = ticker;
  }
  if (!Object.keys(next).length && !quoteAssets.length) {
    await persistLiveAsksSnapshot(idleLiveAsksSnapshot(now));
  } else {
    await persistLiveAsksSnapshot({ at: now.toISOString(), byAsset: next });
  }
  return liveAsksForClient({ at: now.toISOString(), byAsset: next });
}

/** One Kalshi pull if several /me/quotes and the 1s loop overlap. */
export function refreshLiveAskBookShared(
  assets: string[],
  now = new Date()
): Promise<ReturnType<typeof liveAsksForClient>> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshLiveAskBook(assets, now).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

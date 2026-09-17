import { computeLean } from 'trading-core';
import { getMarketQuote } from '../../../../packages/trading-core/src/lean';
import { cachedLeanTicker, computeLeanOnce, rememberSharedLeans } from './leanSignalCache';
import { isMarketOpen } from './marketHours';
import { readWsAskBid } from './kalshiWsQuotes';
import {
  fetchAskQuotesOnce,
  liveAsksFromTickers,
  mergeLiveAskTickers,
  quotesByTicker,
  rememberTickersFromLeans,
  resolveAskTickers,
  type OneSecondAskQuote,
} from './oneSecondMarket';
import {
  idleLiveAsksSnapshot,
  liveAsksForClient,
  mergeLiveAsks,
  peekLiveAsksByAsset,
  peekLiveAsksByTicker,
  persistLiveAsksSnapshot,
} from './liveAsks';

let tickerCache: Record<string, string> = {};
let extraTickers = new Set<string>();
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

export function dropAskTickersNotIn(assets: readonly string[]): void {
  const keep = new Set(assets.map((a) => String(a || '').trim()).filter(Boolean));
  tickerCache = Object.fromEntries(Object.entries(tickerCache).filter(([asset]) => keep.has(asset)));
}

export function rememberExtraAskTickers(tickers: Iterable<string>): void {
  for (const raw of tickers) {
    const ticker = String(raw || '').trim();
    if (ticker) extraTickers.add(ticker);
  }
}

export function resetExtraAskTickers(): void {
  extraTickers = new Set();
}

export function peekExtraAskTickers(): string[] {
  return [...extraTickers];
}

export function resetLiveAskRefreshForTests(): void {
  tickerCache = {};
  extraTickers = new Set();
  refreshInFlight = null;
}

function quoteFromLean(lean: Record<string, any> | undefined): OneSecondAskQuote | null {
  if (!lean) return null;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
  };
  const next: OneSecondAskQuote = {
    yes_ask: n(lean.yes_ask),
    no_ask: n(lean.no_ask),
    yes_bid: n(lean.yes_bid),
    no_bid: n(lean.no_bid),
  };
  if (
    next.yes_ask == null &&
    next.no_ask == null &&
    next.yes_bid == null &&
    next.no_bid == null
  ) {
    return null;
  }
  return next;
}

/** 1s Home book: cached Cushions-On tickers + WS. No Kalshi REST. */
export async function persistCushionAskBook(
  assets: string[],
  now = new Date(),
  leans?: Partial<Record<string, any>>
): Promise<ReturnType<typeof liveAsksForClient>> {
  const wanted = [...new Set(assets.map((a) => String(a || '').trim()).filter(Boolean))];
  if (leans) rememberAskTickersFromLeans(leans);
  dropAskTickersNotIn(wanted);
  const tickers = resolveAskTickers(wanted, tickerCache, peekLiveAsksByAsset());
  const quotes = new Map<string, OneSecondAskQuote>();
  if (leans) {
    for (const lean of Object.values(leans)) {
      const ticker = String(lean?.market_ticker || '').trim();
      const q = quoteFromLean(lean);
      if (ticker && q) quotes.set(ticker, q);
    }
  }
  for (const ticker of Object.values(tickers)) {
    const ws = readWsAskBid(ticker);
    if (ws) quotes.set(ticker, ws);
  }
  const next = mergeLiveAsks(
    peekLiveAsksByAsset(),
    liveAsksFromTickers(tickers, quotes),
    wanted
  );
  const byTicker = mergeLiveAskTickers(
    peekLiveAsksByTicker(),
    quotesByTicker(quotes),
    Object.values(tickers)
  );
  if (!wanted.length) {
    await persistLiveAsksSnapshot(idleLiveAsksSnapshot(now));
    return liveAsksForClient({ at: now.toISOString(), byAsset: {}, byTicker: {} });
  }
  await persistLiveAsksSnapshot({ at: now.toISOString(), byAsset: next, byTicker });
  return liveAsksForClient({ at: now.toISOString(), byAsset: next, byTicker });
}

async function ensureTickers(assets: string[], now: Date): Promise<Record<string, string>> {
  let tickers = resolveAskTickers(assets, tickerCache, peekLiveAsksByAsset());
  const missing = assets.filter((asset) => !tickers[asset] && isMarketOpen(asset, now).open);
  if (!missing.length) return tickers;
  await Promise.all(
    missing.map(async (asset) => {
      try {
        const cached = cachedLeanTicker(asset);
        if (cached) {
          tickerCache[asset] = cached;
          return;
        }
        const lean = await computeLeanOnce(asset, () => computeLean(asset, 0.0, fetch, now));
        rememberSharedLeans({ [asset]: lean });
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
    const peekTickers = peekLiveAsksByTicker();
    const at = now.toISOString();
    if (!Object.keys(peek).length && !Object.keys(peekTickers).length) {
      await persistLiveAsksSnapshot(idleLiveAsksSnapshot(now));
      return liveAsksForClient({ at, byAsset: {}, byTicker: {} });
    }
    await persistLiveAsksSnapshot({ at, byAsset: peek, byTicker: peekTickers });
    return liveAsksForClient({ at, byAsset: peek, byTicker: peekTickers });
  }
  const wanted = [...new Set(assets.map((a) => String(a || '').trim()).filter(Boolean))];
  const fallback = Object.keys(peekLiveAsksByAsset());
  const quoteAssets = wanted.length ? wanted : fallback;
  const tickers = await ensureTickers(quoteAssets, now);
  const extra = peekExtraAskTickers();
  const quoteTickerList = [...new Set([...Object.values(tickers), ...extra].map((t) => String(t || '').trim()).filter(Boolean))];
  const quotes = quoteTickerList.length
    ? await fetchAskQuotesOnce(quoteTickerList, (ticker) =>
        getMarketQuote(ticker, fetch, { skipCache: true })
      )
    : new Map();
  const next = mergeLiveAsks(
    peekLiveAsksByAsset(),
    liveAsksFromTickers(tickers, quotes),
    quoteAssets.length ? quoteAssets : fallback
  );
  const byTicker = mergeLiveAskTickers(peekLiveAsksByTicker(), quotesByTicker(quotes), extra);
  for (const [asset, row] of Object.entries(next)) {
    const ticker = String(row?.ticker || '').trim();
    if (ticker) tickerCache[asset] = ticker;
  }
  if (!Object.keys(next).length && !Object.keys(byTicker).length && !quoteAssets.length) {
    await persistLiveAsksSnapshot(idleLiveAsksSnapshot(now));
  } else {
    await persistLiveAsksSnapshot({ at: now.toISOString(), byAsset: next, byTicker });
  }
  return liveAsksForClient({ at: now.toISOString(), byAsset: next, byTicker });
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

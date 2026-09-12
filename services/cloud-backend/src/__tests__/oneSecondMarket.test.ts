import {
  collectWatchAssets,
  fetchAskQuotesOnce,
  leanWithSnapshotQuote,
  uniqueTickersFromLeans,
} from '../services/oneSecondMarket';

describe('one-second market snapshot', () => {
  test('unions watch assets across paths and users without duplicates', () => {
    const twap = new Map<string, string[]>([['u1', ['BTC', 'ETH']]]);
    const last = new Map<string, string[]>([
      ['u1', ['Gold']],
      ['u2', ['BTC', 'Gold']],
    ]);
    expect(collectWatchAssets(twap, last, new Map()).sort()).toEqual(['BTC', 'ETH', 'Gold']);
    const cashOut = new Map<string, string[]>([['u3', ['Silver']]]);
    const protect = new Map<string, string[]>([['u1', ['SOL']]]);
    expect(collectWatchAssets(twap, last, cashOut, protect).sort()).toEqual([
      'BTC',
      'ETH',
      'Gold',
      'SOL',
      'Silver',
    ]);
    expect(collectWatchAssets()).toEqual([]);
  });

  test('fetches each ticker once even if many leans share it', async () => {
    const fetchQuote = jest.fn(async (ticker: string) => ({
      yes_ask_dollars: ticker === 'KXBTC15M' ? 0.61 : 0.42,
      no_ask_dollars: 0.39,
      yes_bid_dollars: 0.6,
      no_bid_dollars: 0.38,
    }));
    const quotes = await fetchAskQuotesOnce(['KXBTC15M', 'KXBTC15M', 'KXGOLD15M'], fetchQuote);
    expect(fetchQuote).toHaveBeenCalledTimes(2);
    const btc = leanWithSnapshotQuote(
      { asset: 'BTC', market_ticker: 'KXBTC15M', yes_ask: 0.9, no_ask: 0.1, yes_bid: 0.2 },
      quotes
    );
    expect(btc.yes_ask).toBe(0.61);
    expect(btc.no_ask).toBe(0.39);
    expect(btc.yes_bid).toBe(0.6);
  });

  test('failed quote keeps the lean ask and does not mutate the snapshot lean', async () => {
    const fetchQuote = jest.fn(async () => {
      throw new Error('kalshi down');
    });
    const quotes = await fetchAskQuotesOnce(['KXBTC15M'], fetchQuote);
    const raw = { asset: 'BTC', market_ticker: 'KXBTC15M', yes_ask: 0.77 };
    const next = leanWithSnapshotQuote(raw, quotes);
    expect(next.yes_ask).toBe(0.77);
    expect(next).not.toBe(raw);
    raw.yes_ask = 0.11;
    expect(next.yes_ask).toBe(0.77);
  });

  test('uniqueTickersFromLeans drops empty tickers', () => {
    expect(
      uniqueTickersFromLeans({
        BTC: { market_ticker: 'KXBTC15M' },
        ETH: { market_ticker: ' KXBTC15M ' },
        Gold: {},
      })
    ).toEqual(['KXBTC15M']);
  });
});

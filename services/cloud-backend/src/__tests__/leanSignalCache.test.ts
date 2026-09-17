import {
  cachedLeanNeedsRefresh,
  cachedLeanTicker,
  computeLeanOnce,
  dropSharedLeansNotIn,
  leanFromSharedCache,
  peekSharedLeansForClient,
  refreshCushionLeanSignals,
  rememberSharedLeans,
  resetSharedLeanCacheForTests,
} from '../services/leanSignalCache';
import {
  dropAskTickersNotIn,
  peekAskTickers,
  persistCushionAskBook,
  rememberAskTickers,
  resetLiveAskRefreshForTests,
} from '../services/liveAskRefresh';
import { getLiveAsksSnapshot, resetLiveAsksMemoryForTests } from '../services/liveAsks';

describe('shared lean cache', () => {
  beforeEach(() => resetSharedLeanCacheForTests());

  test('1s lean reuses ticker and refreshes the clock without a new REST lean', () => {
    rememberSharedLeans({
      Gold: {
        market_ticker: 'KXGOLD15M-T',
        close_utc: '2026-09-15T22:15:00.000Z',
        open_utc: '2026-09-15T22:00:00.000Z',
        yes_ask: 0.5,
        no_ask: 0.5,
        phase: 'live',
      },
    });
    expect(cachedLeanTicker('Gold')).toBe('KXGOLD15M-T');
    const now = new Date('2026-09-15T22:05:00.000Z');
    const lean = leanFromSharedCache('Gold', now);
    expect(lean?.market_ticker).toBe('KXGOLD15M-T');
    expect(lean?.minutes_elapsed).toBe(5);
    expect(lean?.minutes_left).toBe(10);
    expect(cachedLeanNeedsRefresh('Gold', now)).toBe(false);
    expect(cachedLeanNeedsRefresh('Gold', new Date('2026-09-15T22:15:00.000Z'))).toBe(true);
  });

  test('client peek includes minutes_elapsed so Home Buy is not stuck too early', () => {
    rememberSharedLeans({
      Gold: {
        market_ticker: 'KXGOLD15M-T',
        close_utc: '2026-09-15T22:15:00.000Z',
        open_utc: '2026-09-15T22:00:00.000Z',
        live: 2650,
        strike: 2640,
        decision: 'YES',
        phase: 'live',
        yes_ask: 0.55,
        no_ask: 0.46,
      },
    });
    const peek = peekSharedLeansForClient(new Date('2026-09-15T22:08:00.000Z'));
    expect(peek.Gold.minutes_elapsed).toBe(8);
    expect(peek.Gold.minutes_left).toBe(7);
    expect(peek.Gold.open_utc).toBe('2026-09-15T22:00:00.000Z');
  });

  test('infers open_utc from close when older cache omitted open', () => {
    rememberSharedLeans({
      Gold: {
        market_ticker: 'KXGOLD15M-T',
        close_utc: '2026-09-15T22:15:00.000Z',
        minutes_elapsed: 0,
        phase: 'live',
      },
    });
    const lean = leanFromSharedCache('Gold', new Date('2026-09-15T22:09:00.000Z'));
    expect(lean?.minutes_elapsed).toBe(9);
    expect(lean?.open_utc).toBe('2026-09-15T22:00:00.000Z');
  });

  test('drops coins that are no longer Cushions On', () => {
    rememberSharedLeans({
      Gold: { market_ticker: 'KXGOLD15M-T' },
      HYPE: { market_ticker: 'KXHYPE15M-T' },
    });
    dropSharedLeansNotIn(['Gold']);
    expect(cachedLeanTicker('Gold')).toBe('KXGOLD15M-T');
    expect(cachedLeanTicker('HYPE')).toBe(null);
    expect(leanFromSharedCache('HYPE')).toBe(null);
  });

  test('1s refresh calls live_data once per coin and does not full computeLean', async () => {
    rememberSharedLeans({
      Gold: {
        market_ticker: 'KXGOLD15M-T',
        event_ticker: 'KXGOLD15M-EVT',
        live: 100,
        strike: 90,
        phase: 'live',
        close_utc: '2026-09-15T22:15:00.000Z',
        open_utc: '2026-09-15T22:00:00.000Z',
        yes_ask: 0.4,
        no_ask: 0.61,
      },
    });
    let computes = 0;
    let spots = 0;
    const now = new Date('2026-09-15T22:05:00.000Z');
    const leans = await refreshCushionLeanSignals(['Gold', 'Gold'], now, {
      computeLeanFn: async () => {
        computes += 1;
        return { market_ticker: 'NOPE' } as any;
      },
      getLiveSpotFn: async () => {
        spots += 1;
        return { price: 110, timeseries: [] };
      },
    });
    expect(computes).toBe(0);
    expect(spots).toBe(1);
    expect(leans.Gold?.live).toBe(110);
    expect(leans.Gold?.decision).toBe('YES');
    expect(leans.Gold?.abs_gap).toBe(20);
  });

  test('computeLeanOnce shares one in-flight call per coin', async () => {
    let runs = 0;
    const run = () =>
      new Promise<number>((resolve) => {
        runs += 1;
        setTimeout(() => resolve(runs), 20);
      });
    const [a, b] = await Promise.all([computeLeanOnce('Gold', run), computeLeanOnce('Gold', run)]);
    expect(runs).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});

describe('cushion ask book', () => {
  beforeEach(() => {
    resetLiveAskRefreshForTests();
    resetLiveAsksMemoryForTests();
  });

  test('drops tickers for coins that are no longer Cushions On', () => {
    rememberAskTickers({ Gold: 'KXGOLD15M-T', HYPE: 'KXHYPE15M-T' });
    dropAskTickersNotIn(['Gold']);
    expect(peekAskTickers()).toEqual({ Gold: 'KXGOLD15M-T' });
  });

  test('1s persist uses cached leans and does not keep Off coins', async () => {
    const now = new Date('2026-09-15T22:05:00.000Z');
    const book = await persistCushionAskBook(
      ['Gold'],
      now,
      {
        Gold: {
          market_ticker: 'KXGOLD15M-T',
          yes_ask: 0.41,
          no_ask: 0.6,
        },
        HYPE: {
          market_ticker: 'KXHYPE15M-T',
          yes_ask: 0.2,
          no_ask: 0.81,
        },
      }
    );
    expect(book.byAsset).toEqual({
      Gold: { yes_ask: 0.41, no_ask: 0.6, ticker: 'KXGOLD15M-T' },
    });
    expect(book.byAsset.HYPE).toBeUndefined();
    expect(peekAskTickers()).toEqual({ Gold: 'KXGOLD15M-T' });
    const snap = await getLiveAsksSnapshot();
    expect(snap.at).toBe(now.toISOString());
    expect(snap.byAsset.Gold.yes_ask).toBe(0.41);
  });

  test('empty Cushions list writes an idle book', async () => {
    rememberAskTickers({ Gold: 'KXGOLD15M-T' });
    const now = new Date('2026-09-15T22:06:00.000Z');
    const book = await persistCushionAskBook([], now, {
      Gold: { market_ticker: 'KXGOLD15M-T', yes_ask: 0.5, no_ask: 0.5 },
    });
    expect(book.byAsset).toEqual({});
    const snap = await getLiveAsksSnapshot();
    expect(snap.byAsset).toEqual({});
  });
});

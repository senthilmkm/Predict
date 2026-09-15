import {
  applyOrderbookDelta,
  applyOrderbookSnapshot,
  bookIsFresh,
  capTickers,
  cloneTickerBook,
  emptyTickerBook,
  KALSHI_WS_STALE_MS,
  markBookUnready,
  readAskBidFromBook,
  readBestBidSizeFromBook,
  wsPriceToCents,
} from '../services/kalshiWsBook';

describe('kalshiWsBook', () => {
  const now = 1_700_000_000_000;

  test('snapshot then delta: best ask/bid/size', () => {
    const book = emptyTickerBook(now);
    applyOrderbookSnapshot(
      book,
      10,
      {
        yes: [
          ['0.4000', 4],
          ['0.4100', 2],
        ],
        no: [['0.5900', 9]],
      },
      now
    );
    expect(readAskBidFromBook(book, now)).toEqual({
      yes_ask: 0.41,
      no_ask: 0.59,
      yes_bid: 0.41,
      no_bid: 0.59,
    });
    expect(readBestBidSizeFromBook(book, 'YES', now)).toBe(2);
    expect(readBestBidSizeFromBook(book, 'NO', now)).toBe(9);
    expect(applyOrderbookDelta(book, 11, { side: 'yes', price_dollars: '0.4000', delta_fp: 3 }, now)).toBe(true);
    expect(readAskBidFromBook(book, now)?.yes_ask).toBe(0.41);
    expect(applyOrderbookDelta(book, 12, { side: 'yes', price_dollars: '0.4000', delta_fp: -7 }, now)).toBe(true);
    expect(readAskBidFromBook(book, now)?.no_ask).toBe(0.59);
  });

  test('seq skip and delta before snapshot fail closed', () => {
    const book = emptyTickerBook(now);
    expect(applyOrderbookDelta(book, 1, { side: 'yes', price: 8, delta: 1 }, now)).toBe(false);
    applyOrderbookSnapshot(book, 5, { yes: [['0.0800', 1]], no: [] }, now);
    expect(applyOrderbookDelta(book, 7, { side: 'yes', price_dollars: '0.0800', delta_fp: 1 }, now)).toBe(false);
    markBookUnready(book, now);
    expect(book.ready).toBe(false);
    applyOrderbookSnapshot(book, 7, { yes: [['0.0800', 2]], no: [] }, now);
    expect(readAskBidFromBook(book, now)?.yes_bid).toBe(0.08);
    expect(readAskBidFromBook(book, now)?.no_ask).toBe(0.92);
  });

  test('stale book is unused; empty side has no ask', () => {
    const book = emptyTickerBook(now);
    applyOrderbookSnapshot(book, 1, { yes: [['0.50', 1]], no: [] }, now);
    expect(bookIsFresh(book, now + KALSHI_WS_STALE_MS)).toBe(true);
    expect(readAskBidFromBook(book, now + KALSHI_WS_STALE_MS + 1)).toBeNull();
    expect(readBestBidSizeFromBook(book, 'NO', now)).toBe(0);
    applyOrderbookSnapshot(book, 2, { yes: [], no: [] }, now);
    expect(readAskBidFromBook(book, now)).toBeNull();
  });

  test('dollars vs cents and YES/NO isolation', () => {
    expect(wsPriceToCents('0.0800')).toBe(8);
    expect(wsPriceToCents(8)).toBe(8);
    const book = emptyTickerBook(now);
    applyOrderbookSnapshot(book, 1, { yes: [[8, 3]], no: [['0.91', 5]] }, now);
    expect(readAskBidFromBook(book, now)).toMatchObject({ yes_ask: 0.09, no_ask: 0.92, yes_bid: 0.08, no_bid: 0.91 });
    applyOrderbookDelta(book, 2, { side: 'no', price: 91, delta: -5 }, now);
    expect(readBestBidSizeFromBook(book, 'NO', now)).toBe(0);
    expect(readBestBidSizeFromBook(book, 'YES', now)).toBe(3);
  });

  test('clone is not torn by later apply', () => {
    const book = emptyTickerBook(now);
    applyOrderbookSnapshot(book, 1, { yes: [['0.40', 10]], no: [['0.60', 4]] }, now);
    const cloned = cloneTickerBook(book);
    applyOrderbookDelta(book, 2, { side: 'yes', price_dollars: '0.40', delta_fp: -10 }, now);
    expect(cloned.yes.get(40)).toBe(10);
    expect(book.yes.has(40)).toBe(false);
    expect(cloned.seq).toBe(1);
    expect(book.seq).toBe(2);
  });

  test('ticker cap is unique and bounded', () => {
    expect(capTickers(['A', 'A', '', 'B'], 1)).toEqual(['A']);
    expect(capTickers(Array.from({ length: 50 }, (_, i) => `T${i}`)).length).toBe(40);
  });
});

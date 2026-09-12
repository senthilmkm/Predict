import { isMarketOpen, getMarketScheduleNotice } from '../src/services/marketHours';
import { SERIES_BY_ASSET } from '../src/services/kalshi/client';

describe('Market Hours Schedule', () => {
  it('allows all 24/7 crypto assets at all times', () => {
    // Saturday afternoon
    const sat = new Date('2026-09-05T16:00:00Z');
    const cryptoAssets = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'BNB', 'AVAX', 'SUI', 'LINK'];
    for (const a of cryptoAssets) {
      expect(isMarketOpen(a, sat).open).toBe(true);
    }
  });

  it('polls WTI, Gold, Silver when Kalshi lists Friday-night and Saturday books', () => {
    const sat = new Date('2026-09-05T18:00:00Z');
    expect(isMarketOpen('WTI', sat).open).toBe(true);
    expect(isMarketOpen('Gold', sat).open).toBe(true);
    expect(isMarketOpen('Silver', sat).open).toBe(true);
    const friEvening = new Date('2026-09-04T21:30:00Z');
    expect(isMarketOpen('WTI', friEvening).open).toBe(true);
    expect(isMarketOpen('Gold', friEvening).open).toBe(true);
  });

  it('opens WTI on Friday before 5:00 PM ET', () => {
    // Friday September 4, 2026 14:00 ET (18:00 UTC in EDT)
    const friAfternoon = new Date('2026-09-04T18:00:00Z');
    const r = isMarketOpen('WTI', friAfternoon);
    expect(r.open).toBe(true);
  });

  it('polls WTI on Sunday afternoon if Kalshi still lists a book', () => {
    const sunAfternoon = new Date('2026-09-06T19:00:00Z');
    expect(isMarketOpen('WTI', sunAfternoon).open).toBe(true);
    const sunEvening = new Date('2026-09-06T22:30:00Z');
    expect(isMarketOpen('WTI', sunEvening).open).toBe(true);
  });

  it('keeps Kalshi 15m commodities open Mon-Thu 5-6 PM ET', () => {
    // Tuesday September 8, 2026 17:15 ET (21:15 UTC) — CME futures halt, Kalshi 15m still live
    const tueAfternoon = new Date('2026-09-08T21:15:00Z');
    for (const a of ['WTI', 'Gold', 'Silver', 'COPPER', 'NG']) {
      expect(isMarketOpen(a, tueAfternoon).open).toBe(true);
    }
  });

  it('maps commodities to the live Kalshi 15m series tickers', () => {
    expect(SERIES_BY_ASSET.WTI).toBe('KXWTI15M');
    expect(SERIES_BY_ASSET.Gold).toBe('KXGOLD15M');
    expect(SERIES_BY_ASSET.Silver).toBe('KXSILVER15M');
    expect(SERIES_BY_ASSET.COPPER).toBe('KXCOPPER15M');
    expect(SERIES_BY_ASSET.NG).toBe('KXNATGAS15M');
  });

  it('generates schedule notice banner for full-day closures', () => {
    const sat = new Date('2026-09-05T18:00:00Z');
    const notice = getMarketScheduleNotice(sat);
    expect(notice).toContain('Stock indices and forex are closed for the weekend');
    expect(notice).toContain('Kalshi commodity 15m');
  });
});

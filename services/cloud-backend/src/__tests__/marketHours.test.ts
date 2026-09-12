import { isMarketOpen } from '../services/marketHours';

describe('GCP Cloud Backend Market Hours', () => {
  it('allows all 24/7 crypto assets', () => {
    const sat = new Date('2026-09-05T16:00:00Z');
    for (const a of ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'BNB', 'AVAX', 'SUI', 'LINK']) {
      expect(isMarketOpen(a, sat).open).toBe(true);
    }
  });

  it('skips stocks and forex on Saturday; commodities still poll', () => {
    const sat = new Date('2026-09-05T18:00:00Z');
    for (const a of ['WTI', 'Gold', 'Silver', 'NG', 'COPPER']) {
      expect(isMarketOpen(a, sat).open).toBe(true);
    }
    for (const a of ['SPX', 'NDX', 'EURUSD', 'GBPUSD', 'USDJPY']) {
      expect(isMarketOpen(a, sat).open).toBe(false);
    }
  });

  it('keeps Kalshi 15m commodities open Mon-Thu 5-6 PM ET', () => {
    const tueAfternoon = new Date('2026-09-08T21:15:00Z');
    for (const a of ['WTI', 'Gold', 'Silver', 'COPPER', 'NG']) {
      expect(isMarketOpen(a, tueAfternoon).open).toBe(true);
    }
  });
});

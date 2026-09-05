import { isMarketOpen } from '../services/marketHours';

describe('GCP Cloud Backend Market Hours', () => {
  it('allows all 24/7 crypto assets', () => {
    const sat = new Date('2026-09-05T16:00:00Z');
    for (const a of ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'BNB', 'AVAX', 'SUI', 'LINK']) {
      expect(isMarketOpen(a, sat).open).toBe(true);
    }
  });

  it('skips Commodities, Stocks, and Forex on Saturday', () => {
    const sat = new Date('2026-09-05T18:00:00Z');
    for (const a of ['WTI', 'Gold', 'Silver', 'NG', 'COPPER', 'SPX', 'NDX', 'EURUSD', 'GBPUSD', 'USDJPY']) {
      expect(isMarketOpen(a, sat).open).toBe(false);
    }
  });
});

import { isMarketOpen } from '../services/marketHours';

describe('GCP Cloud Backend Market Hours', () => {
  it('allows BTC and ETH 24/7', () => {
    const sat = new Date('2026-09-05T16:00:00Z');
    expect(isMarketOpen('BTC', sat).open).toBe(true);
    expect(isMarketOpen('ETH', sat).open).toBe(true);
  });

  it('skips WTI, Gold, Silver on weekends in GCP worker', () => {
    const sat = new Date('2026-09-05T18:00:00Z');
    expect(isMarketOpen('WTI', sat).open).toBe(false);
    expect(isMarketOpen('Gold', sat).open).toBe(false);
    expect(isMarketOpen('Silver', sat).open).toBe(false);
  });
});

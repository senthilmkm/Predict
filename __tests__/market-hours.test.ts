import { isMarketOpen, getMarketScheduleNotice } from '../src/services/marketHours';

describe('Market Hours Schedule', () => {
  it('allows BTC and ETH 24/7 at all times', () => {
    // Saturday afternoon
    const sat = new Date('2026-09-05T16:00:00Z');
    expect(isMarketOpen('BTC', sat).open).toBe(true);
    expect(isMarketOpen('ETH', sat).open).toBe(true);
  });

  it('closes WTI, Gold, Silver on Saturdays', () => {
    // Saturday September 5, 2026 14:00 ET
    const sat = new Date('2026-09-05T18:00:00Z');
    const r = isMarketOpen('WTI', sat);
    expect(r.open).toBe(false);
    expect(r.reason).toBe('Weekend halt');
    expect(r.reopensAt).toBe('Sun 6:00 PM ET');
    expect(isMarketOpen('Gold', sat).open).toBe(false);
    expect(isMarketOpen('Silver', sat).open).toBe(false);
  });

  it('closes WTI on Friday after 5:00 PM ET', () => {
    // Friday September 4, 2026 17:30 ET (21:30 UTC in EDT)
    const friEvening = new Date('2026-09-04T21:30:00Z');
    const r = isMarketOpen('WTI', friEvening);
    expect(r.open).toBe(false);
    expect(r.reason).toBe('Weekend halt');
  });

  it('opens WTI on Friday before 5:00 PM ET', () => {
    // Friday September 4, 2026 14:00 ET (18:00 UTC in EDT)
    const friAfternoon = new Date('2026-09-04T18:00:00Z');
    const r = isMarketOpen('WTI', friAfternoon);
    expect(r.open).toBe(true);
  });

  it('closes WTI on Sunday before 6:00 PM ET and opens after 6:00 PM ET', () => {
    // Sunday September 6, 2026 15:00 ET (19:00 UTC)
    const sunAfternoon = new Date('2026-09-06T19:00:00Z');
    expect(isMarketOpen('WTI', sunAfternoon).open).toBe(false);

    // Sunday September 6, 2026 18:30 ET (22:30 UTC)
    const sunEvening = new Date('2026-09-06T22:30:00Z');
    expect(isMarketOpen('WTI', sunEvening).open).toBe(true);
  });

  it('handles Mon-Thu 5-6 PM ET maintenance halt', () => {
    // Monday September 7, 2026 17:15 ET (21:15 UTC) -> Labor Day in 2026 (Holiday)
    // Tuesday September 8, 2026 17:15 ET (21:15 UTC)
    const tueHalt = new Date('2026-09-08T21:15:00Z');
    const r = isMarketOpen('WTI', tueHalt);
    expect(r.open).toBe(false);
    expect(r.reason).toBe('Daily CME halt');
  });

  it('generates schedule notice banner for full-day closures', () => {
    const sat = new Date('2026-09-05T18:00:00Z');
    const notice = getMarketScheduleNotice(sat);
    expect(notice).toContain('WTI, Gold & Silver markets are closed for the weekend');
    expect(notice).toContain('reopens Sunday 6:00 PM ET');
  });
});

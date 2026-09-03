import {
  decideLean,
  resolveStrike,
  getCurrentOrNext15mMarket,
} from '../src/services/lean/lean';

describe('lean decideLean', () => {
  test('upcoming/ended always SKIP', () => {
    expect(decideLean('upcoming', 100, 90, 5).decision).toBe('SKIP');
    expect(decideLean('ended', 100, 90, 5).decision).toBe('SKIP');
  });

  test('strict cushion — equal gap passes', () => {
    expect(decideLean('live', 100, 93, 7).decision).toBe('YES');
    expect(decideLean('live', 100, 93.1, 7).decision).toBe('SKIP');
    expect(decideLean('live', 90, 100, 7).decision).toBe('NO');
  });
});

describe('resolveStrike', () => {
  test('prefers floor_strike', () => {
    expect(
      resolveStrike(
        {
          event_ticker: 'E',
          market_ticker: 'M',
          open_utc: null,
          close_utc: null,
          floor_strike: 2650,
        },
        {},
        null
      )
    ).toBe(2650);
  });

  test('parses yes_sub_title', () => {
    expect(
      resolveStrike(
        {
          event_ticker: 'E',
          market_ticker: 'M',
          open_utc: null,
          close_utc: null,
          floor_strike: null,
          yes_sub_title: 'Target price: $2,650.50',
        },
        {},
        null
      )
    ).toBe(2650.5);
  });
});

describe('getCurrentOrNext15mMarket', () => {
  test('picks live window', async () => {
    const now = new Date('2026-09-03T00:05:00.000Z');
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        events: [
          {
            event_ticker: 'EV1',
            title: 'Gold',
            markets: [
              {
                ticker: 'M-LIVE',
                open_time: '2026-09-03T00:00:00Z',
                close_time: '2026-09-03T00:15:00Z',
                floor_strike: 2600,
              },
            ],
          },
        ],
      }),
    })) as any;

    const pick = await getCurrentOrNext15mMarket('KXGOLD15M', fetchImpl, now);
    expect(pick?.phase).toBe('live');
    expect(pick?.row.market_ticker).toBe('M-LIVE');
  });
});

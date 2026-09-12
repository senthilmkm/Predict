import { inheritSkipThinBid, resolveSkipThinBid } from '../packages/trading-core/src/skipThinBid';

describe('per-path Skip thin bid', () => {
  test('missing path flag inherits Cash out On; explicit Off stays Off', () => {
    expect(inheritSkipThinBid(undefined, true)).toBe(true);
    expect(inheritSkipThinBid(undefined, false)).toBe(false);
    expect(inheritSkipThinBid(false, true)).toBe(false);
    expect(inheritSkipThinBid(true, false)).toBe(true);
  });

  test('resolve prefers override, then path flag, then Cash out fallback', () => {
    expect(resolveSkipThinBid({ cash_out_skip_thin_bid: true }, 'gold_fade')).toBe(true);
    expect(
      resolveSkipThinBid({ cash_out_skip_thin_bid: true, gold_fade_skip_thin_bid: false }, 'gold_fade')
    ).toBe(false);
    expect(
      resolveSkipThinBid({ cash_out_skip_thin_bid: true, gold_fade_skip_thin_bid: false }, 'gold_fade', true)
    ).toBe(true);
    expect(resolveSkipThinBid({ twap_lock_skip_thin_bid: true }, 'twap_lock', false)).toBe(false);
    expect(resolveSkipThinBid({ last_minute_skip_thin_bid: true }, 'last_minute')).toBe(true);
    expect(resolveSkipThinBid({}, 'cash_out')).toBe(false);
  });
});

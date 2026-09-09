import { formatChange24h, formatChangeWindowLabel, formatUsd } from '../src/util/moneyFormat';

describe('money format', () => {
  test('formats Kalshi-style 24h change', () => {
    expect(formatChange24h(1.18, 0.84)).toBe('+$1.18 (+0.84%)');
    expect(formatChange24h(-1.18, -0.84)).toBe('-$1.18 (-0.84%)');
    expect(formatChange24h(0, 0)).toBe('$0.00 (0.00%)');
    expect(formatChange24h(2.5, null)).toBe('+$2.50');
    expect(formatChange24h(null, 1)).toBe('Collecting…');
    expect(formatChange24h(Number.NaN, 1)).toBe('Collecting…');
  });

  test('labels a partial window until 24h of samples exist', () => {
    expect(formatChangeWindowLabel(null, null)).toBe('Change (24h)');
    expect(formatChangeWindowLabel(24 * 60 * 60 * 1000, 1.18)).toBe('Change (24h)');
    expect(formatChangeWindowLabel(4 * 60 * 60 * 1000, 1.18)).toBe('Change (4h)');
    expect(formatChangeWindowLabel(12 * 60 * 1000, 0.4)).toBe('Change (12m)');
  });

  test('formats portfolio dollars', () => {
    expect(formatUsd(140.48)).toBe('$140.48');
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(Number.NaN)).toBe('—');
  });
});

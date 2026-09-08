import { formatChange24h, formatUsd } from '../src/util/moneyFormat';

describe('money format', () => {
  test('formats Kalshi-style 24h change', () => {
    expect(formatChange24h(1.18, 0.84)).toBe('+$1.18 (+0.84%)');
    expect(formatChange24h(-1.18, -0.84)).toBe('-$1.18 (-0.84%)');
    expect(formatChange24h(0, 0)).toBe('$0.00 (0.00%)');
    expect(formatChange24h(2.5, null)).toBe('+$2.50');
    expect(formatChange24h(null, 1)).toBe('—');
    expect(formatChange24h(Number.NaN, 1)).toBe('—');
  });

  test('formats portfolio dollars', () => {
    expect(formatUsd(140.48)).toBe('$140.48');
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(Number.NaN)).toBe('—');
  });
});

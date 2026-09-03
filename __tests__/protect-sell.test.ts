import {
  buildProtectSellOrder,
  computeProtectSellPnlUsd,
  protectSellMinGapUsd,
  shouldProtectSell,
} from '../src/services/protectSell';

describe('protectSell', () => {
  test('min gap = cushion × ratio', () => {
    expect(protectSellMinGapUsd(50, 1)).toBe(50);
    expect(protectSellMinGapUsd(50, 1.5)).toBe(75);
    expect(protectSellMinGapUsd(0.3, 1)).toBe(0.3);
  });

  test('shouldProtectSell requires opposite lean with enough gap', () => {
    const base = {
      enabled: true,
      heldSide: 'YES' as const,
      cushion: 50,
      gapRatio: 1,
    };
    expect(
      shouldProtectSell({
        ...base,
        lean: { decision: 'YES', abs_gap: 80, phase: 'live' },
      }).sell
    ).toBe(false);
    expect(
      shouldProtectSell({
        ...base,
        lean: { decision: 'NO', abs_gap: 40, phase: 'live' },
      }).sell
    ).toBe(false);
    expect(
      shouldProtectSell({
        ...base,
        lean: { decision: 'NO', abs_gap: 50, phase: 'live' },
      }).sell
    ).toBe(true);
    expect(
      shouldProtectSell({
        ...base,
        enabled: false,
        lean: { decision: 'NO', abs_gap: 90, phase: 'live' },
      }).sell
    ).toBe(false);
  });

  test('grace after fill blocks only when it would otherwise sell', () => {
    const filledAt = '2026-09-03T12:00:00.000Z';
    const nowEarly = new Date('2026-09-03T12:00:20.000Z');
    const nowLater = new Date('2026-09-03T12:00:50.000Z');
    const opts = {
      enabled: true,
      heldSide: 'YES' as const,
      cushion: 175,
      gapRatio: 1,
      filledAt,
      graceSeconds: 45,
      lean: { decision: 'NO' as const, abs_gap: 200, phase: 'live' as const },
    };
    expect(shouldProtectSell({ ...opts, now: nowEarly })).toMatchObject({
      sell: false,
      reason: 'grace_after_fill',
    });
    expect(shouldProtectSell({ ...opts, now: nowLater }).sell).toBe(true);
    expect(
      shouldProtectSell({
        ...opts,
        now: nowEarly,
        lean: { decision: 'YES', abs_gap: 200, phase: 'live' },
      }).reason
    ).toBe('lean_still_with_you');
  });

  test('buildProtectSellOrder YES uses ask below bid', () => {
    const o = buildProtectSellOrder({
      heldSide: 'YES',
      fillCount: 5,
      yesBid: 0.4,
      yesAsk: 0.42,
      slippageUsd: 0.02,
    });
    expect(o.ok).toBe(true);
    expect(o.side).toBe('ask');
    expect(o.price).toBe('0.3800');
    expect(o.count).toBe('5');
  });

  test('buildProtectSellOrder NO uses bid above ask', () => {
    const o = buildProtectSellOrder({
      heldSide: 'NO',
      fillCount: 3,
      yesBid: 0.55,
      yesAsk: 0.58,
      slippageUsd: 0.02,
    });
    expect(o.ok).toBe(true);
    expect(o.side).toBe('bid');
    expect(Number(o.price)).toBeCloseTo(0.6, 4);
    expect(o.economicExit).toBeCloseTo(0.4, 4);
  });

  test('computeProtectSellPnlUsd', () => {
    expect(
      computeProtectSellPnlUsd({
        heldSide: 'YES',
        entryPay: 0.6,
        exitEconomic: 0.4,
        fillCount: 10,
      })
    ).toBe(-2);
    expect(
      computeProtectSellPnlUsd({
        heldSide: 'NO',
        entryPay: 0.4,
        exitEconomic: 0.35,
        fillCount: 10,
      })
    ).toBe(-0.5);
  });
});

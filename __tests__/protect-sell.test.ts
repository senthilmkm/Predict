import {
  buildProtectSellOrder,
  computeProtectSellPnlUsd,
  homeAutoExitWatchNeeded,
  normalizeSellAtPct,
  protectSellMinGapUsd,
  sellAtPctForEntryPath,
  shouldProtectSell,
  shouldSellAtProfitPct,
} from '../src/services/protectSell';

describe('protectSell', () => {
  test('min gap = cushion × ratio', () => {
    expect(protectSellMinGapUsd(50, 1)).toBe(50);
    expect(protectSellMinGapUsd(50, 1.5)).toBe(75);
    expect(protectSellMinGapUsd(0.3, 1)).toBe(0.3);
  });

  test('normalizeSellAtPct: 0 Off, else 5–100 step 5', () => {
    expect(normalizeSellAtPct(0)).toBe(0);
    expect(normalizeSellAtPct(-1)).toBe(0);
    expect(normalizeSellAtPct(undefined)).toBe(0);
    expect(normalizeSellAtPct(3)).toBe(5);
    expect(normalizeSellAtPct(7)).toBe(5);
    expect(normalizeSellAtPct(8)).toBe(10);
    expect(normalizeSellAtPct(100)).toBe(100);
    expect(normalizeSellAtPct(120)).toBe(100);
  });

  test('shouldSellAtProfitPct sells when mark clears entry × (1 + pct/100)', () => {
    const filledAt = '2026-09-03T12:00:00.000Z';
    const now = new Date('2026-09-03T12:01:00.000Z');
    expect(
      shouldSellAtProfitPct({
        sellAtPct: 0,
        entryPay: 0.5,
        heldSide: 'YES',
        yesBid: 0.8,
        filledAt,
        graceSeconds: 0,
        now,
      })
    ).toMatchObject({ sell: false, reason: 'sell_at_off', pct: 0 });
    expect(
      shouldSellAtProfitPct({
        sellAtPct: 20,
        entryPay: 0.5,
        heldSide: 'YES',
        yesBid: 0.59,
        filledAt,
        graceSeconds: 0,
        now,
      })
    ).toMatchObject({ sell: false, reason: 'below_sell_at', need: 0.6, pct: 20 });
    expect(
      shouldSellAtProfitPct({
        sellAtPct: 20,
        entryPay: 0.5,
        heldSide: 'YES',
        yesBid: 0.6,
        filledAt,
        graceSeconds: 0,
        now,
      })
    ).toMatchObject({ sell: true, reason: 'sell_at_profit', pct: 20 });
    expect(
      shouldSellAtProfitPct({
        sellAtPct: 20,
        entryPay: 0.5,
        heldSide: 'YES',
        yesBid: 0.9,
        filledAt,
        graceSeconds: 45,
        now: new Date('2026-09-03T12:00:20.000Z'),
      }).reason
    ).toBe('grace_after_fill');
    expect(
      shouldSellAtProfitPct({
        sellAtPct: 10,
        entryPay: 0.4,
        heldSide: 'NO',
        yesAsk: 0.5,
        filledAt,
        graceSeconds: 0,
        now,
      })
    ).toMatchObject({ sell: true, reason: 'sell_at_profit', mark: 0.5, need: 0.44 });
  });

  test('homeAutoExitWatchNeeded and sellAtPctForEntryPath', () => {
    expect(homeAutoExitWatchNeeded({ protect_sell_enabled: false })).toBe(false);
    expect(homeAutoExitWatchNeeded({ protect_sell_enabled: true })).toBe(true);
    expect(homeAutoExitWatchNeeded({ home_sell_at_pct: 10 })).toBe(true);
    expect(homeAutoExitWatchNeeded({ cushion_lean_sell_at_pct: 15 })).toBe(true);
    expect(sellAtPctForEntryPath('home', { home_sell_at_pct: 20, cushion_lean_sell_at_pct: 10 })).toBe(
      20
    );
    expect(sellAtPctForEntryPath('auto', { home_sell_at_pct: 20, cushion_lean_sell_at_pct: 10 })).toBe(
      10
    );
    expect(sellAtPctForEntryPath('cash_out', { home_sell_at_pct: 20 })).toBe(0);
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

import {
  SMART_BUY_GUESS_MAX,
  SMART_BUY_MIN_EDGE_DEFAULT,
  computeBounce,
  erf,
  evaluateSmartBuy,
  isSmartBuyEnabled,
  normalizeSmartBuyMinEdge,
  normalCdf,
  tickTimeMs,
} from '../packages/trading-core/src/smartBuy';
import { evaluateStaticGate } from '../packages/trading-core/src/gates';
import { defaultAppConfig } from '../packages/trading-core/src/types';

const T0 = 1_800_000_000_000;

function minutePath(values: number[], t0 = T0) {
  return values.map((v, i) => ({ t: t0 + i * 60_000, v }));
}

describe('Smart buy math', () => {
  test('erf and Φ match known values', () => {
    expect(erf(0)).toBeCloseTo(0, 10);
    expect(erf(1)).toBeCloseTo(0.8427007929, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427007929, 6);
    expect(normalCdf(0)).toBeCloseTo(0.5, 10);
    expect(normalCdf(1)).toBeCloseTo(0.841344746, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655254, 6);
    expect(normalCdf(8)).toBe(1);
    expect(normalCdf(-8)).toBe(0);
  });

  test('tickTimeMs treats seconds vs milliseconds', () => {
    expect(tickTimeMs(1_800_000_000)).toBe(1_800_000_000_000);
    expect(tickTimeMs(1_800_000_000_000)).toBe(1_800_000_000_000);
  });

  test('bounce RMS of +$3 per minute is 3', () => {
    const ticks = minutePath([2638, 2641, 2644, 2647, 2650]);
    expect(computeBounce(ticks)).toBeCloseTo(3, 10);
  });

  test('too few returns → no bounce', () => {
    expect(computeBounce(minutePath([2640, 2643]))).toBeNull();
    expect(computeBounce(minutePath([2640, 2643, 2646]))).toBeNull();
  });

  test('worked example: 4 minutes left, bounce 3, gap 10, ask 0.70 → buy', () => {
    const ticks = minutePath([2638, 2641, 2644, 2647, 2650]);
    const d = evaluateSmartBuy({
      live: 2650,
      strike: 2640,
      absGap: 10,
      minutesRemaining: 4,
      ask: 0.7,
      minEdgeUsd: SMART_BUY_MIN_EDGE_DEFAULT,
      timeseries: ticks,
    });
    expect(d.bounce).toBeCloseTo(3, 8);
    expect(d.room_to_move).toBeCloseTo(6, 8);
    expect(d.z).toBeCloseTo(10 / 6, 8);
    expect(d.our_guess).toBe(SMART_BUY_GUESS_MAX);
    expect(d.extra).toBeCloseTo(0.95 - 0.7, 8);
    expect(d.ok).toBe(true);
  });

  test('worked example: 10 minutes left, same gap, ask 0.88 → skip', () => {
    const ticks = minutePath([2638, 2641, 2644, 2647, 2650]);
    const d = evaluateSmartBuy({
      live: 2650,
      strike: 2640,
      absGap: 10,
      minutesRemaining: 10,
      ask: 0.88,
      minEdgeUsd: 0.08,
      timeseries: ticks,
    });
    const room = 3 * Math.sqrt(10);
    const z = 10 / room;
    const guess = Math.min(0.95, Math.max(0.55, normalCdf(z)));
    expect(d.ok).toBe(false);
    expect(d.skip_reason).toBe('smart_buy_edge_too_small');
    expect(d.room_to_move).toBeCloseTo(room, 8);
    expect(d.our_guess).toBeCloseTo(guess, 8);
    expect(d.extra!).toBeLessThan(0.08);
  });

  test('90¢ ticket needs ~98% which the clip never claims → skip', () => {
    const ticks = minutePath([2638, 2641, 2644, 2647, 2650]);
    const d = evaluateSmartBuy({
      live: 2650,
      strike: 2640,
      absGap: 10,
      minutesRemaining: 4,
      ask: 0.9,
      minEdgeUsd: 0.08,
      timeseries: ticks,
    });
    expect(d.ok).toBe(false);
    expect(d.skip_reason).toBe('smart_buy_edge_too_small');
    expect(d.our_guess).toBe(0.95);
    expect(d.extra).toBeCloseTo(0.05, 8);
  });

  test('gap shrinking vs lookback → skip', () => {
    const ticks = minutePath([2662, 2659, 2656, 2653, 2650]);
    const d = evaluateSmartBuy({
      live: 2650,
      strike: 2640,
      absGap: 10,
      minutesRemaining: 4,
      ask: 0.7,
      minEdgeUsd: 0.08,
      timeseries: ticks,
    });
    expect(d.ok).toBe(false);
    expect(d.skip_reason).toBe('smart_buy_gap_dying');
  });

  test('broken path skips instead of guessing', () => {
    expect(
      evaluateSmartBuy({
        live: 2650,
        strike: 2640,
        absGap: 10,
        minutesRemaining: 4,
        ask: 0.7,
        minEdgeUsd: 0.08,
        timeseries: [],
      }).skip_reason
    ).toBe('smart_buy_no_path');
    expect(
      evaluateSmartBuy({
        live: 2650,
        strike: 2640,
        absGap: 10,
        minutesRemaining: 0,
        ask: 0.7,
        minEdgeUsd: 0.08,
        timeseries: minutePath([2638, 2641, 2644, 2647, 2650]),
      }).skip_reason
    ).toBe('smart_buy_no_path');
  });

  test('missing Smart buy flag defaults On; min extra clamps', () => {
    expect(isSmartBuyEnabled(undefined)).toBe(true);
    expect(isSmartBuyEnabled({})).toBe(true);
    expect(isSmartBuyEnabled({ smart_buy_enabled: false })).toBe(false);
    expect(normalizeSmartBuyMinEdge(undefined)).toBe(0.08);
    expect(normalizeSmartBuyMinEdge(0.01)).toBe(0.04);
    expect(normalizeSmartBuyMinEdge(0.99)).toBe(0.15);
    expect(normalizeSmartBuyMinEdge(0.075)).toBe(0.08);
  });
});

describe('Smart buy Auto gate vs Home Buy', () => {
  const ticks = minutePath([2638, 2641, 2644, 2647, 2650]);

  function cfg() {
    const c = defaultAppConfig();
    c.auto_trade_enabled = true;
    c.assets_enabled.Gold = true;
    c.cushions.Gold = 7;
    return c;
  }

  const lean = {
    asset: 'Gold',
    market_ticker: 'KXGOLD15M-A',
    decision: 'YES' as const,
    live: 2650,
    strike: 2640,
    abs_gap: 10,
    minutes_left: 8,
    minutes_elapsed: 5,
    minutes_remaining: 4,
    phase: 'live' as const,
    yes_ask: 0.7,
    timeseries: ticks,
  };

  test('Auto with a good ticket passes; rich ticket skips', () => {
    expect(evaluateStaticGate(lean, cfg()).ok).toBe(true);
    expect(
      evaluateStaticGate({ ...lean, yes_ask: 0.9, minutes_remaining: 4 }, cfg()).skip_reason
    ).toBe('smart_buy_edge_too_small');
  });

  test('Auto Off-path skips; Home Buy tap does not use Smart buy', () => {
    expect(evaluateStaticGate({ ...lean, timeseries: undefined }, cfg()).skip_reason).toBe(
      'smart_buy_no_path'
    );
    expect(
      evaluateStaticGate({ ...lean, timeseries: undefined }, cfg(), { allowWhenAutoTradeOff: true })
        .ok
    ).toBe(true);
  });

  test('Smart buy Off restores cushion-only Auto', () => {
    const c = cfg();
    c.risk.smart_buy_enabled = false;
    expect(evaluateStaticGate({ ...lean, timeseries: undefined, yes_ask: 0.7 }, c).ok).toBe(true);
  });
});

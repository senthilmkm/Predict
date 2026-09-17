import {
  buildOneMinuteBars,
  computeOneMinuteAtr,
  evaluateLateAtrCushion,
  normalizeLastMinuteAtrAskUsd,
  normalizeLastMinuteAtrMult,
  signedLeadUsd,
} from '../packages/trading-core/src/lateAtrCushion';
import { evaluateLastMinuteEnter } from '../packages/trading-core/src/lastMinute';
import { formatSkipReason } from '../packages/trading-core/src/gates';
import { defaultAppConfig } from '../packages/trading-core/src/types';

/** ~`range` high-low each minute for `minutes` bars ending near now. */
function atrTicks(opts: { center: number; range: number; minutes?: number; nowMs?: number }) {
  const minutes = opts.minutes ?? 14;
  const nowMs = opts.nowMs ?? Date.now();
  const ticks: Array<{ t: number; v: number }> = [];
  for (let m = minutes; m >= 0; m--) {
    const t0 = nowMs - m * 60_000;
    const half = opts.range / 2;
    ticks.push({ t: t0 / 1000, v: opts.center });
    ticks.push({ t: (t0 + 20_000) / 1000, v: opts.center + half });
    ticks.push({ t: (t0 + 40_000) / 1000, v: opts.center - half });
    ticks.push({ t: (t0 + 55_000) / 1000, v: opts.center });
  }
  return ticks;
}

describe('late ATR cushion helpers', () => {
  test('normalizers and signed lead', () => {
    expect(normalizeLastMinuteAtrAskUsd(0.88)).toBe(0.88);
    expect(normalizeLastMinuteAtrAskUsd(0.5)).toBe(0.8);
    expect(normalizeLastMinuteAtrMult(1.25)).toBe(1.25);
    expect(normalizeLastMinuteAtrMult(0.5)).toBe(1);
    expect(signedLeadUsd({ decision: 'YES', live: 72.12, strike: 72 })).toBeCloseTo(0.12, 6);
    expect(signedLeadUsd({ decision: 'NO', live: 71.9, strike: 72 })).toBeCloseTo(0.1, 6);
  });

  test('builds 1m ATR from tick buckets', () => {
    const ticks = atrTicks({ center: 72, range: 0.08, minutes: 14 });
    expect(buildOneMinuteBars(ticks).length).toBeGreaterThanOrEqual(14);
    const atr = computeOneMinuteAtr(ticks);
    expect(atr).not.toBeNull();
    expect(atr!).toBeGreaterThan(0.07);
    expect(atr!).toBeLessThan(0.1);
  });

  test('trap skips; wide lead passes; no path allows', () => {
    const ticks = atrTicks({ center: 72.08, range: 0.08, minutes: 14 });
    const thin = evaluateLateAtrCushion({
      enabled: true,
      secondsLeft: 55,
      askUsd: 0.9,
      highAskFloorUsd: 0.88,
      atrMult: 1.25,
      decision: 'YES',
      live: 72.03,
      strike: 72,
      timeseries: ticks,
    });
    expect(thin.active).toBe(true);
    expect(thin.ok).toBe(false);
    expect(thin.skip_reason).toBe('last_minute_atr_thin');

    const wide = evaluateLateAtrCushion({
      enabled: true,
      secondsLeft: 55,
      askUsd: 0.9,
      highAskFloorUsd: 0.88,
      atrMult: 1.25,
      decision: 'YES',
      live: 72.12,
      strike: 72,
      timeseries: ticks,
    });
    expect(wide.ok).toBe(true);

    const noPath = evaluateLateAtrCushion({
      enabled: true,
      secondsLeft: 55,
      askUsd: 0.9,
      highAskFloorUsd: 0.88,
      atrMult: 1.25,
      decision: 'YES',
      live: 72.12,
      strike: 72,
      timeseries: undefined,
    });
    expect(noPath.active).toBe(true);
    expect(noPath.ok).toBe(true);
    expect(formatSkipReason('last_minute_atr_thin')).toBe('lead thinner than 1m noise');
  });

  test('inactive outside final 60s or under ask floor', () => {
    const ticks = atrTicks({ center: 72, range: 0.08 });
    const early = evaluateLateAtrCushion({
      enabled: true,
      secondsLeft: 90,
      askUsd: 0.9,
      highAskFloorUsd: 0.88,
      atrMult: 1.25,
      decision: 'YES',
      live: 72.03,
      strike: 72,
      timeseries: ticks,
    });
    expect(early.active).toBe(false);
    expect(early.ok).toBe(true);

    const cheap = evaluateLateAtrCushion({
      enabled: true,
      secondsLeft: 55,
      askUsd: 0.7,
      highAskFloorUsd: 0.88,
      atrMult: 1.25,
      decision: 'YES',
      live: 72.03,
      strike: 72,
      timeseries: ticks,
    });
    expect(cheap.active).toBe(false);
    expect(cheap.ok).toBe(true);
  });
});

describe('Last-minute enter + Late ATR cushion', () => {
  const close = new Date('2026-09-12T10:15:00.000Z');
  const nowLast = new Date(close.getTime() - 20_000);

  function cfg(over: Record<string, unknown> = {}) {
    const c = defaultAppConfig();
    c.auto_trade_enabled = true;
    c.assets_enabled.Gold = true;
    c.risk.last_minute_enabled = true;
    c.risk.last_minute_side = 'yes';
    c.risk.last_minute_max_ask_usd = 0.96;
    Object.assign(c.risk, over.risk || {});
    return c;
  }

  function lean(over: Record<string, unknown> = {}) {
    const live = Number(over.live ?? 3700);
    return {
      asset: 'Gold' as const,
      market_ticker: 'KXGOLD15M-T',
      decision: 'SKIP' as const,
      live,
      strike: 3690,
      abs_gap: Math.abs(live - 3690),
      minutes_left: 0,
      minutes_elapsed: 14,
      minutes_remaining: 0.3,
      phase: 'live' as const,
      yes_ask: 0.95,
      yes_bid: 0.93,
      no_ask: 0.07,
      no_bid: 0.05,
      close_utc: close.toISOString(),
      timeseries: atrTicks({ center: live, range: 2, minutes: 14 }),
      ...over,
    };
  }

  test('wide lead at high ask still places', () => {
    const gate = evaluateLastMinuteEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLast,
    });
    expect(gate.ok).toBe(true);
  });

  test('thin lead vs ATR skips in final 60s', () => {
    const gate = evaluateLastMinuteEnter({
      lean: lean({
        live: 3690.03,
        strike: 3690,
        abs_gap: 0.03,
        timeseries: atrTicks({ center: 3690.03, range: 0.08, minutes: 14 }),
      }),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLast,
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('last_minute_atr_thin');
  });

  test('no timeseries still places when other gates pass', () => {
    const gate = evaluateLastMinuteEnter({
      lean: lean({ timeseries: undefined }),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLast,
    });
    expect(gate.ok).toBe(true);
  });

  test('Off disables the ATR check', () => {
    const gate = evaluateLastMinuteEnter({
      lean: lean({
        live: 3690.03,
        strike: 3690,
        abs_gap: 0.03,
        timeseries: atrTicks({ center: 3690.03, range: 0.08, minutes: 14 }),
      }),
      cfg: cfg({ risk: { last_minute_atr_cushion_enabled: false } }),
      adminEnabled: true,
      now: nowLast,
    });
    expect(gate.ok).toBe(true);
  });
});

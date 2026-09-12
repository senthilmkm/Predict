import {
  evaluateGoldFadeEnter,
  evaluateGoldFadeExit,
  goldFadeCheapSide,
  goldFadeStopFloorUsd,
  goldFadeTakeTargetUsd,
  isGoldFadeEnterPath,
  isGoldFadeEntryPath,
  normalizeGoldFadeFlattenMinutes,
  normalizeGoldFadeMaxAskUsd,
  normalizeGoldFadeMaxGapUsd,
  normalizeGoldFadeStopUsd,
  normalizeGoldFadeTakeUsd,
  tickerHasOpenFill,
} from '../packages/trading-core/src/goldFade';
import { formatSkipReason } from '../packages/trading-core/src/gates';
import { defaultAppConfig } from '../packages/trading-core/src/types';
import { evaluateCashOutExit } from '../packages/trading-core/src/cashOut';

function cfg(over: Record<string, unknown> = {}) {
  const c = defaultAppConfig();
  c.auto_trade_enabled = true;
  c.cushions.Gold = 7;
  c.assets_enabled.Gold = true;
  c.risk.gold_fade_enabled = true;
  c.risk.gold_fade_max_gap_usd = 3;
  c.risk.gold_fade_max_ask_usd = 0.5;
  c.risk.gold_fade_take_usd = 0.06;
  c.risk.gold_fade_stop_usd = 0.05;
  c.risk.gold_fade_flatten_minutes = 3;
  c.risk.min_minutes_elapsed = 2;
  c.risk.fixed_dollars_per_trade = 5;
  c.risk.max_dollars_per_trade = 5;
  Object.assign(c.risk, over.risk || {});
  return c;
}

function goldLean(over: Record<string, unknown> = {}) {
  return {
    asset: 'Gold' as const,
    market_ticker: 'KXGOLD-T',
    decision: 'NO' as const,
    live: 2648,
    strike: 2650,
    abs_gap: 2,
    minutes_left: 8,
    minutes_elapsed: 3,
    minutes_remaining: 8.2,
    phase: 'live' as const,
    yes_ask: 0.46,
    yes_bid: 0.42,
    no_ask: 0.54,
    no_bid: 0.5,
    ...over,
  };
}

const filledAt = '2026-09-11T15:00:00.000Z';

describe('Gold fade math', () => {
  test('normalizers clamp gap, ask, take, stop, flatten', () => {
    expect(normalizeGoldFadeMaxGapUsd(3)).toBe(3);
    expect(normalizeGoldFadeMaxGapUsd(0)).toBe(1);
    expect(normalizeGoldFadeMaxGapUsd(99)).toBe(6);
    expect(normalizeGoldFadeMaxAskUsd(0.5)).toBe(0.5);
    expect(normalizeGoldFadeMaxAskUsd(0.1)).toBe(0.35);
    expect(normalizeGoldFadeMaxAskUsd(0.9)).toBe(0.55);
    expect(normalizeGoldFadeTakeUsd(0.06)).toBe(0.06);
    expect(normalizeGoldFadeTakeUsd(0.01)).toBe(0.05);
    expect(normalizeGoldFadeStopUsd(0.05)).toBe(0.05);
    expect(normalizeGoldFadeStopUsd(0.01)).toBe(0.03);
    expect(normalizeGoldFadeFlattenMinutes(3)).toBe(3);
    expect(normalizeGoldFadeFlattenMinutes(1)).toBe(2);
    expect(normalizeGoldFadeFlattenMinutes(9)).toBe(5);
    expect(goldFadeTakeTargetUsd(0.46, 0.06)).toBe(0.52);
    expect(goldFadeStopFloorUsd(0.46, 0.05)).toBe(0.41);
  });

  test('cheap side is the lower ask; tie is none', () => {
    expect(goldFadeCheapSide({ yes_ask: 0.46, no_ask: 0.54 })).toBe('YES');
    expect(goldFadeCheapSide({ yes_ask: 0.54, no_ask: 0.46 })).toBe('NO');
    expect(goldFadeCheapSide({ yes_ask: 0.48, no_ask: 0.48 })).toBeNull();
    expect(goldFadeCheapSide({})).toBeNull();
  });

  test('path helpers', () => {
    expect(isGoldFadeEnterPath({ adminEnabled: true, userEnabled: true, asset: 'Gold' })).toBe(true);
    expect(isGoldFadeEnterPath({ adminEnabled: false, userEnabled: true, asset: 'Gold' })).toBe(false);
    expect(isGoldFadeEnterPath({ adminEnabled: true, userEnabled: true, asset: 'BTC' })).toBe(false);
    expect(isGoldFadeEntryPath('gold_fade')).toBe(true);
    expect(isGoldFadeEntryPath('cash_out')).toBe(false);
    expect(tickerHasOpenFill([{ ticker: 'KXGOLD-T', status: 'FILLED', outcome: 'pending', fillCount: 7 }], 'KXGOLD-T')).toBe(
      true
    );
  });
});

describe('Gold fade enter', () => {
  test('gap $2 cheap YES $0.46 buys; admin/user/BTC/gap/ask/spread/late/open skip', () => {
    const ok = evaluateGoldFadeEnter({ lean: goldLean(), cfg: cfg(), adminEnabled: true });
    expect(ok.ok).toBe(true);
    expect(ok.decision).toBe('YES');

    expect(evaluateGoldFadeEnter({ lean: goldLean(), cfg: cfg(), adminEnabled: false }).skip_reason).toBe(
      'gold_fade_admin_off'
    );
    const userOff = cfg();
    userOff.risk.gold_fade_enabled = false;
    expect(evaluateGoldFadeEnter({ lean: goldLean(), cfg: userOff, adminEnabled: true }).skip_reason).toBe(
      'gold_fade_off'
    );
    expect(
      evaluateGoldFadeEnter({
        lean: goldLean({ asset: 'BTC', market_ticker: 'KXBTC-T' }),
        cfg: cfg(),
        adminEnabled: true,
      }).skip_reason
    ).toBe('gold_fade_not_gold');
    expect(evaluateGoldFadeEnter({ lean: goldLean({ abs_gap: 8 }), cfg: cfg(), adminEnabled: true }).skip_reason).toBe(
      'gold_fade_gap_wide'
    );
    expect(
      evaluateGoldFadeEnter({ lean: goldLean({ yes_ask: 0.56, yes_bid: 0.52 }), cfg: cfg(), adminEnabled: true })
        .skip_reason
    ).toBe('gold_fade_ask_rich');
    expect(
      evaluateGoldFadeEnter({
        lean: goldLean({ yes_ask: 0.46, yes_bid: 0.36 }),
        cfg: cfg(),
        adminEnabled: true,
      }).skip_reason
    ).toBe('gold_fade_spread_wide');
    expect(
      evaluateGoldFadeEnter({
        lean: goldLean({ yes_ask: 0.48, no_ask: 0.48, yes_bid: 0.44, no_bid: 0.44 }),
        cfg: cfg(),
        adminEnabled: true,
      }).skip_reason
    ).toBe('gold_fade_no_cheap_side');
    expect(
      evaluateGoldFadeEnter({
        lean: goldLean({ minutes_left: 3, minutes_remaining: 3 }),
        cfg: cfg(),
        adminEnabled: true,
      }).skip_reason
    ).toBe('gold_fade_too_late');
    expect(
      evaluateGoldFadeEnter({
        lean: goldLean(),
        cfg: cfg(),
        adminEnabled: true,
        hasOpenOnTicker: true,
      }).skip_reason
    ).toBe('gold_fade_holding_other_path');
  });

  test('thin bid skips buy only when On and size is known', () => {
    const off = evaluateGoldFadeEnter({
      lean: goldLean(),
      cfg: cfg(),
      adminEnabled: true,
      skipThinBid: false,
      bidSize: 1,
    });
    expect(off.ok).toBe(true);
    const unknown = evaluateGoldFadeEnter({
      lean: goldLean(),
      cfg: cfg(),
      adminEnabled: true,
      skipThinBid: true,
      bidSize: null,
    });
    expect(unknown.ok).toBe(true);
    const thin = evaluateGoldFadeEnter({
      lean: goldLean(),
      cfg: cfg(),
      adminEnabled: true,
      skipThinBid: true,
      bidSize: 1,
    });
    expect(thin.ok).toBe(false);
    expect(thin.skip_reason).toBe('gold_fade_thin_bid');
  });

  test('skip labels', () => {
    expect(formatSkipReason('gold_fade_gap_wide')).toBe('gap too wide to fade');
    expect(formatSkipReason('gold_fade_thin_bid')).toBe('bid too thin');
    expect(formatSkipReason('gold_fade_too_late')).toBe('too little time left');
  });
});

describe('Gold fade exit', () => {
  test('take, stop, thin, flatten, ended dump; grace holds; take beats stop', () => {
    const take = evaluateGoldFadeExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.52, yes_ask: 0.54 },
      fillPayUsd: 0.46,
      takeUsd: 0.06,
      stopUsd: 0.05,
      flattenMinutes: 3,
      lean: { decision: 'YES', abs_gap: 2, phase: 'live', minutes_left: 8 },
      cushion: 7,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-11T15:01:00.000Z'),
    });
    expect(take.kind).toBe('gold_fade_take');
    expect(take.sell).toBe(true);

    const stop = evaluateGoldFadeExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.41, yes_ask: 0.43 },
      fillPayUsd: 0.46,
      takeUsd: 0.06,
      stopUsd: 0.05,
      flattenMinutes: 3,
      lean: { decision: 'YES', abs_gap: 2, phase: 'live', minutes_left: 8 },
      cushion: 7,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-11T15:01:00.000Z'),
    });
    expect(stop.kind).toBe('gold_fade_stop');

    const thin = evaluateGoldFadeExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.47, yes_ask: 0.49 },
      fillPayUsd: 0.46,
      takeUsd: 0.06,
      stopUsd: 0.05,
      flattenMinutes: 3,
      skipThinBid: true,
      bidSize: 1,
      needCount: 10,
      lean: { decision: 'YES', abs_gap: 2, phase: 'live', minutes_left: 8 },
      cushion: 7,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-11T15:01:00.000Z'),
    });
    expect(thin.kind).toBe('gold_fade_thin_bid');

    const flat = evaluateGoldFadeExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.47, yes_ask: 0.49 },
      fillPayUsd: 0.46,
      takeUsd: 0.06,
      stopUsd: 0.05,
      flattenMinutes: 3,
      lean: { decision: 'YES', abs_gap: 2, phase: 'live', minutes_left: 3, minutes_remaining: 3 },
      cushion: 7,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-11T15:01:00.000Z'),
    });
    expect(flat.kind).toBe('gold_fade_time');
    expect(flat.reason).toBe('flatten_minutes');

    const ended = evaluateGoldFadeExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.47, yes_ask: 0.49 },
      fillPayUsd: 0.46,
      takeUsd: 0.06,
      lean: { decision: 'YES', abs_gap: 2, phase: 'ended', minutes_left: 0 },
      cushion: 7,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-11T15:00:20.000Z'),
    });
    expect(ended.kind).toBe('gold_fade_time');
    expect(ended.sell).toBe(true);

    const cashEnded = evaluateCashOutExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.47, yes_ask: 0.49 },
      cashOutBidUsd: 0.88,
      lean: { decision: 'YES', abs_gap: 2, phase: 'ended' },
      cushion: 7,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-11T15:00:20.000Z'),
    });
    expect(cashEnded.sell).toBe(false);

    const grace = evaluateGoldFadeExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.41, yes_ask: 0.43 },
      fillPayUsd: 0.46,
      takeUsd: 0.06,
      stopUsd: 0.05,
      lean: { decision: 'YES', abs_gap: 2, phase: 'live', minutes_left: 8 },
      cushion: 7,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-11T15:00:20.000Z'),
    });
    expect(grace.reason).toBe('grace_after_fill');
    expect(grace.sell).toBe(false);

    const flip = evaluateGoldFadeExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.47, yes_ask: 0.49 },
      fillPayUsd: 0.46,
      takeUsd: 0.06,
      stopUsd: 0.05,
      flattenMinutes: 3,
      lean: { decision: 'NO', abs_gap: 8, phase: 'live', minutes_left: 8 },
      cushion: 7,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-11T15:01:00.000Z'),
    });
    expect(flip.kind).toBe('gold_fade_flip');

    const unknownThin = evaluateGoldFadeExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.47, yes_ask: 0.49 },
      fillPayUsd: 0.46,
      skipThinBid: true,
      bidSize: null,
      needCount: 10,
      lean: { decision: 'YES', abs_gap: 2, phase: 'live', minutes_left: 8 },
      cushion: 7,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-11T15:01:00.000Z'),
    });
    expect(unknownThin.sell).toBe(false);
  });
});

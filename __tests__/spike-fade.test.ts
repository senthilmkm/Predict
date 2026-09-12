import {
  evaluateSpikeFadeEnter,
  evaluateSpikeFadeExit,
  isSpikeFadeEnterPath,
  isSpikeFadeEnterWindow,
  normalizeSpikeFadeAssets,
  normalizeSpikeFadeCheapMaxUsd,
  normalizeSpikeFadeCheapMinUsd,
  normalizeSpikeFadeExpensiveMaxUsd,
  normalizeSpikeFadeExpensiveMinUsd,
  normalizeSpikeFadeFlattenMinutes,
  normalizeSpikeFadeLotCount,
  normalizeSpikeFadeStartMinutes,
  normalizeSpikeFadeStopAskUsd,
  normalizeSpikeFadeTakeAskUsd,
  normalizeSpikeFadeUntilMinutes,
  pickSpikeFadeSide,
  reconcileSpikeFadeBands,
  tickerHasOpenOtherThanSpikeFade,
  tickerHasOpenSpikeFade,
} from '../packages/trading-core/src/spikeFade';
import { formatSkipReason } from '../packages/trading-core/src/gates';
import { defaultAppConfig } from '../packages/trading-core/src/types';
import { PATH_INFO } from '../src/content/pathInfo';

function cfg(over: Record<string, unknown> = {}) {
  const c = defaultAppConfig();
  c.auto_trade_enabled = true;
  c.cushions.Gold = 7;
  c.assets_enabled.Gold = true;
  c.risk.spike_fade_enabled = true;
  c.risk.spike_fade_start_minutes = 2;
  c.risk.spike_fade_until_minutes = 6;
  c.risk.spike_fade_expensive_min_usd = 0.75;
  c.risk.spike_fade_expensive_max_usd = 0.8;
  c.risk.spike_fade_cheap_min_usd = 0.2;
  c.risk.spike_fade_cheap_max_usd = 0.25;
  c.risk.spike_fade_take_ask_usd = 0.42;
  c.risk.spike_fade_stop_ask_usd = 0.1;
  c.risk.spike_fade_flatten_minutes = 3;
  c.risk.spike_fade_lot_count = 1;
  Object.assign(c.risk, over.risk || {});
  return c;
}

function lean(over: Record<string, unknown> = {}) {
  return {
    asset: 'Gold' as const,
    market_ticker: 'KXGOLD15M-T',
    decision: 'YES' as const,
    live: 2650,
    strike: 2648,
    abs_gap: 2,
    minutes_left: 10,
    minutes_elapsed: 4,
    minutes_remaining: 10.2,
    phase: 'live' as const,
    yes_ask: 0.78,
    yes_bid: 0.76,
    no_ask: 0.22,
    no_bid: 0.2,
    ...over,
  };
}

describe('Spike fade path', () => {
  test('normalizers clamp bands, window, take, stop, flatten, lots', () => {
    expect(normalizeSpikeFadeStartMinutes(2)).toBe(2);
    expect(normalizeSpikeFadeStartMinutes(0)).toBe(1);
    expect(normalizeSpikeFadeStartMinutes(9)).toBe(4);
    expect(normalizeSpikeFadeUntilMinutes(6)).toBe(6);
    expect(normalizeSpikeFadeUntilMinutes(1)).toBe(4);
    expect(normalizeSpikeFadeUntilMinutes(20)).toBe(8);
    expect(normalizeSpikeFadeExpensiveMinUsd(0.75)).toBe(0.75);
    expect(normalizeSpikeFadeExpensiveMinUsd(0.1)).toBe(0.7);
    expect(normalizeSpikeFadeExpensiveMaxUsd(0.99)).toBe(0.9);
    expect(normalizeSpikeFadeCheapMinUsd(0.05)).toBe(0.15);
    expect(normalizeSpikeFadeCheapMaxUsd(0.5)).toBe(0.35);
    expect(normalizeSpikeFadeTakeAskUsd(0.42)).toBe(0.42);
    expect(normalizeSpikeFadeTakeAskUsd(0.1)).toBe(0.35);
    expect(normalizeSpikeFadeStopAskUsd(0.1)).toBe(0.1);
    expect(normalizeSpikeFadeStopAskUsd(0.01)).toBe(0.05);
    expect(normalizeSpikeFadeFlattenMinutes(3)).toBe(3);
    expect(normalizeSpikeFadeFlattenMinutes(1)).toBe(2);
    expect(normalizeSpikeFadeLotCount(0)).toBe(1);
    expect(normalizeSpikeFadeLotCount(9)).toBe(5);
    const bands = reconcileSpikeFadeBands({
      expensiveMin: 0.82,
      expensiveMax: 0.76,
      cheapMin: 0.28,
      cheapMax: 0.2,
    });
    expect(bands.expensiveMax).toBeGreaterThanOrEqual(bands.expensiveMin);
    expect(bands.cheapMax).toBeGreaterThanOrEqual(bands.cheapMin);
    expect(normalizeSpikeFadeAssets([])).toEqual([]);
    expect(normalizeSpikeFadeAssets(['Gold', 'NOPE'])).toEqual(['Gold']);
  });

  test('enter window is Start after through Until minute', () => {
    expect(isSpikeFadeEnterWindow({ minutesElapsed: 1, startMinutes: 2, untilMinutes: 6 })).toBe(false);
    expect(isSpikeFadeEnterWindow({ minutesElapsed: 2, startMinutes: 2, untilMinutes: 6 })).toBe(true);
    expect(isSpikeFadeEnterWindow({ minutesElapsed: 6, startMinutes: 2, untilMinutes: 6 })).toBe(true);
    expect(isSpikeFadeEnterWindow({ minutesElapsed: 7, startMinutes: 2, untilMinutes: 6 })).toBe(false);
    expect(isSpikeFadeEnterWindow({ minutesElapsed: 4, startMinutes: 4, untilMinutes: 4 })).toBe(true);
  });

  test('picks the cheap side only when both bands match', () => {
    expect(pickSpikeFadeSide({ yesAsk: 0.78, noAsk: 0.22 })).toEqual({
      ok: true,
      decision: 'NO',
      cheapAsk: 0.22,
    });
    expect(pickSpikeFadeSide({ yesAsk: 0.22, noAsk: 0.78 })).toEqual({
      ok: true,
      decision: 'YES',
      cheapAsk: 0.22,
    });
    expect(pickSpikeFadeSide({ yesAsk: 0.82, noAsk: 0.22 }).ok).toBe(false);
    expect(pickSpikeFadeSide({ yesAsk: 0.78, noAsk: 0.18 }).ok).toBe(false);
    expect(pickSpikeFadeSide({ yesAsk: 0.6, noAsk: 0.4 }).ok).toBe(false);
  });

  test('enter buys cheap NO when YES is expensive in band', () => {
    const enter = evaluateSpikeFadeEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(enter.ok).toBe(true);
    expect(enter.decision).toBe('NO');
  });

  test('sits out outside window, off-band, empty chips, TWAP, Last-minute, other path', () => {
    expect(
      evaluateSpikeFadeEnter({
        lean: lean({ minutes_elapsed: 1 }),
        cfg: cfg(),
        adminEnabled: true,
      }).skip_reason
    ).toBe('spike_fade_outside_window');
    expect(
      evaluateSpikeFadeEnter({
        lean: lean({ yes_ask: 0.82, no_ask: 0.18 }),
        cfg: cfg(),
        adminEnabled: true,
      }).skip_reason
    ).toBe('spike_fade_no_spike');
    expect(
      evaluateSpikeFadeEnter({
        lean: lean(),
        cfg: cfg({ risk: { spike_fade_assets: [] } }),
        adminEnabled: true,
      }).skip_reason
    ).toBe('spike_fade_asset_off');
    expect(
      evaluateSpikeFadeEnter({
        lean: lean({ asset: 'BTC' }),
        cfg: (() => {
          const c = cfg();
          c.assets_enabled.BTC = true;
          c.risk.twap_lock_enabled = true;
          c.risk.twap_lock_assets = ['BTC', 'ETH'];
          return c;
        })(),
        adminEnabled: true,
        twapAdminEnabled: true,
      }).skip_reason
    ).toBe('spike_fade_twap_owns');
    expect(
      evaluateSpikeFadeEnter({
        lean: lean(),
        cfg: cfg(),
        adminEnabled: true,
        lastMinuteOwnsNewBuys: true,
      }).skip_reason
    ).toBe('spike_fade_last_minute_owns');
    expect(
      evaluateSpikeFadeEnter({
        lean: lean(),
        cfg: cfg(),
        adminEnabled: true,
        hasOpenOnTicker: true,
      }).skip_reason
    ).toBe('spike_fade_holding_other_path');
    expect(formatSkipReason('spike_fade_holding')).toMatch(/holding/i);
    expect(formatSkipReason('spike_fade_no_spike')).toMatch(/band/i);
  });

  test('take uses bid, stop uses ask, flatten dumps, grace holds', () => {
    const quotes = { yes_bid: 0.2, yes_ask: 0.22, no_bid: 0.2, no_ask: 0.22 };
    expect(
      evaluateSpikeFadeExit({
        heldSide: 'NO',
        quotes: { ...quotes, no_bid: 0.42 },
        lean: { phase: 'live', minutes_left: 8 },
        filledAt: '2026-09-12T15:00:00.000Z',
        now: new Date('2026-09-12T15:00:08.000Z'),
      })
    ).toMatchObject({ sell: true, kind: 'spike_fade_take' });
    expect(
      evaluateSpikeFadeExit({
        heldSide: 'NO',
        quotes: { ...quotes, no_ask: 0.1 },
        lean: { phase: 'live', minutes_left: 8 },
        filledAt: '2026-09-12T15:00:00.000Z',
        now: new Date('2026-09-12T15:00:08.000Z'),
      })
    ).toMatchObject({ sell: true, kind: 'spike_fade_stop' });
    expect(
      evaluateSpikeFadeExit({
        heldSide: 'NO',
        quotes,
        lean: { phase: 'live', minutes_left: 3 },
        filledAt: '2026-09-12T15:00:00.000Z',
        now: new Date('2026-09-12T15:00:08.000Z'),
      })
    ).toMatchObject({ sell: true, kind: 'spike_fade_flatten' });
    expect(
      evaluateSpikeFadeExit({
        heldSide: 'NO',
        quotes: { ...quotes, no_bid: 0.5 },
        lean: { phase: 'live', minutes_left: 8 },
        filledAt: '2026-09-12T15:00:00.000Z',
        now: new Date('2026-09-12T15:00:02.000Z'),
      })
    ).toMatchObject({ sell: false, reason: 'grace_after_fill' });
  });

  test('open-lot helpers and enter path chips', () => {
    expect(
      isSpikeFadeEnterPath({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        assets: ['Gold'],
      })
    ).toBe(true);
    expect(
      isSpikeFadeEnterPath({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        assets: [],
      })
    ).toBe(false);
    const trades = [
      { ticker: 'KXGOLD15M-T', entryPath: 'spike_fade', dryRun: false, status: 'FILLED', fillCount: 1, outcome: 'pending' },
      { ticker: 'KXGOLD15M-T', entryPath: 'auto', dryRun: false, status: 'FILLED', fillCount: 1, outcome: 'pending' },
    ];
    expect(tickerHasOpenSpikeFade(trades, 'KXGOLD15M-T')).toBe(true);
    expect(tickerHasOpenOtherThanSpikeFade(trades, 'KXGOLD15M-T')).toBe(true);
  });

  test('i-icon copy locks isolation and Gold fade stay separate', () => {
    expect(PATH_INFO.spikeFade.title).toBe('Spike fade');
    expect(PATH_INFO.spikeFade.body).toMatch(/Spike fade asset chips/);
    expect(PATH_INFO.spikeFade.body).toMatch(/Empty chips = no Spike fade buys/);
    expect(PATH_INFO.spikeFade.body).toMatch(/Start after \/ Until minute/);
    expect(PATH_INFO.spikeFade.body).toMatch(/Always buys the cheap side/);
    expect(PATH_INFO.spikeFade.body).toMatch(/Take ask/);
    expect(PATH_INFO.spikeFade.body).toMatch(/Stop ask/);
    expect(PATH_INFO.spikeFade.body).toMatch(/Always dumps/);
    expect(PATH_INFO.spikeFade.body).toMatch(/Gold fade stays Gold-only/);
    expect(PATH_INFO.spikeFade.body).toMatch(/5s grace/);
    expect(PATH_INFO.spikeFade.body).toMatch(/window cap 1/i);
    expect(PATH_INFO.spikeFade.body).toMatch(/Protect skips Spike fade/);
    expect(PATH_INFO.spikeFade.body).toMatch(/Last-minute owns new buys/);
    expect(PATH_INFO.shared.body).toMatch(/Spike fade/);
    expect(PATH_INFO.protect.body).toMatch(/Spike fade/);
  });
});

import {
  assetHasOpenCheapLoopHourly,
  assetHasOpenCheapLoopWeekly,
  cheapLoopCfgForHourly,
  cheapLoopCfgForWeekly,
  cheapLoopCooldownOwnsTicker,
  cheapLoopCooldownWatchText,
  cheapLoopExitsForTicker,
  cheapLoopHoldingWatchText,
  cheapLoopHourlyEventKey,
  cheapLoopHourlyExitsForEvent,
  cheapLoopHourlySeriesTicker,
  evaluateCheapLoopEnter,
  evaluateCheapLoopExit,
  isCheapLoopEnterPath,
  isCheapLoopEnterWindow,
  isCheapLoopHistorySellableTrade,
  isCheapLoopHourlyEventDuration,
  isCheapLoopWeeklyEventDuration,
  normalizeCheapLoopAssets,
  normalizeCheapLoopCheapMaxAskUsd,
  normalizeCheapLoopCycles,
  normalizeCheapLoopHourlyAssets,
  normalizeCheapLoopHourlyCycles,
  normalizeCheapLoopHourlyStartMinutes,
  normalizeCheapLoopWeeklyCycles,
  normalizeCheapLoopLotCount,
  normalizeCheapLoopMinLiveCushionPct,
  cheapLoopMinLiveUsd,
  normalizeCheapLoopMinGapUsd,
  normalizeCheapLoopStartMinutes,
  normalizeCheapLoopStopUsd,
  normalizeCheapLoopTakeUsd,
  pickCheapLoopSide,
  pickSoonestLiveLadderEvent,
  pickUniqueAtmStrike,
  reconcileCheapLoopTakeStop,
  tickerHasOpenCheapLoop,
  tickerHasOpenOtherThanCheapLoop,
  tickerHasOpenOtherThanCheapLoopWeekly,
} from '../packages/trading-core/src/cheapLoop';
import { formatSkipReason } from '../packages/trading-core/src/gates';
import { defaultAppConfig } from '../packages/trading-core/src/types';
import { PATH_INFO } from '../src/content/pathInfo';

function cfg(over: Record<string, unknown> = {}) {
  const c = defaultAppConfig();
  c.auto_trade_enabled = true;
  c.cushions.BTC = 175;
  c.assets_enabled.BTC = true;
  c.risk.cheap_loop_enabled = true;
  c.risk.cheap_loop_start_minutes = 2;
  c.risk.cheap_loop_flatten_minutes = 5;
  c.risk.cheap_loop_cheap_max_ask_usd = 0.4;
  c.risk.cheap_loop_min_gap_usd = 0.1;
  c.risk.cheap_loop_min_live_cushion_pct = 15;
  c.risk.cheap_loop_take_usd = 0.05;
  c.risk.cheap_loop_stop_usd = 0.06;
  c.risk.cheap_loop_min_hold_minutes = 1;
  c.risk.cheap_loop_cooldown_minutes = 2;
  c.risk.cheap_loop_cycles = 2;
  c.risk.cheap_loop_lot_count = 1;
  c.risk.cheap_loop_assets = ['BTC'];
  Object.assign(c.risk, over.risk || {});
  return c;
}

function lean(over: Record<string, unknown> = {}) {
  return {
    asset: 'BTC' as const,
    market_ticker: 'KXBTC15M-T',
    decision: 'YES' as const,
    live: 70000,
    strike: 69900,
    abs_gap: 100,
    minutes_left: 10,
    minutes_elapsed: 4,
    minutes_remaining: 10.2,
    phase: 'live' as const,
    yes_ask: 0.3,
    yes_bid: 0.28,
    no_ask: 0.7,
    no_bid: 0.68,
    ...over,
  };
}

describe('Cheap loop path', () => {
  test('normalizers clamp clocks, bands, lots, empty chips', () => {
    expect(normalizeCheapLoopStartMinutes(2)).toBe(2);
    expect(normalizeCheapLoopStartMinutes(0)).toBe(1);
    expect(normalizeCheapLoopStartMinutes(40)).toBe(20);
    expect(normalizeCheapLoopCheapMaxAskUsd(0.4)).toBe(0.4);
    expect(normalizeCheapLoopCheapMaxAskUsd(0.55)).toBe(0.45);
    expect(normalizeCheapLoopMinGapUsd(0.01)).toBe(0.08);
    expect(normalizeCheapLoopTakeUsd(0.05)).toBe(0.05);
    expect(normalizeCheapLoopTakeUsd(0.01)).toBe(0.03);
    expect(normalizeCheapLoopStopUsd(0.2)).toBe(0.12);
    expect(normalizeCheapLoopCycles(9)).toBe(5);
    expect(normalizeCheapLoopLotCount(0)).toBe(1);
    expect(normalizeCheapLoopAssets(undefined)).toEqual([]);
    expect(normalizeCheapLoopAssets(['BTC', 'HYPE', 'BTC'])).toEqual(['BTC', 'HYPE']);
    expect(reconcileCheapLoopTakeStop({ takeUsd: 0.08, stopUsd: 0.05 })).toEqual({
      takeUsd: 0.04,
      stopUsd: 0.05,
    });
  });

  test('cheap gate: 30/70 buys YES; 49/51 sits; 52/48 sits; equal sits', () => {
    expect(pickCheapLoopSide({ yesAsk: 0.3, noAsk: 0.7, cheapMaxAskUsd: 0.4, minGapUsd: 0.1 })).toEqual({
      ok: true,
      decision: 'YES',
      cheapAsk: 0.3,
    });
    expect(pickCheapLoopSide({ yesAsk: 0.49, noAsk: 0.51, cheapMaxAskUsd: 0.4, minGapUsd: 0.1 }).ok).toBe(
      false
    );
    expect(pickCheapLoopSide({ yesAsk: 0.52, noAsk: 0.48, cheapMaxAskUsd: 0.4, minGapUsd: 0.1 })).toMatchObject({
      ok: false,
      skip_reason: 'cheap_loop_no_favorite',
    });
    expect(pickCheapLoopSide({ yesAsk: 0.4, noAsk: 0.4, cheapMaxAskUsd: 0.4, minGapUsd: 0.1 })).toMatchObject({
      ok: false,
      skip_reason: 'cheap_loop_no_cheap_side',
    });
  });

  test('enter 30/70 YES; window cap does not block; other path blocks', () => {
    const c = cfg();
    const ok = evaluateCheapLoopEnter({
      lean: lean(),
      cfg: c,
      adminEnabled: true,
    });
    expect(ok.ok).toBe(true);
    expect(ok.decision).toBe('YES');

    const capped = evaluateCheapLoopEnter({
      lean: lean(),
      cfg: { ...c, risk: { ...c.risk, max_trades_per_asset_per_window: 1 } },
      adminEnabled: true,
    });
    expect(capped.ok).toBe(true);

    const other = evaluateCheapLoopEnter({
      lean: lean(),
      cfg: c,
      adminEnabled: true,
      hasOpenOnTicker: true,
    });
    expect(other.ok).toBe(false);
    expect(other.skip_reason).toBe('cheap_loop_holding_other_path');
    expect(formatSkipReason('cheap_loop_holding_other_path')).toBe('another path already holding');
  });

  test('Min live % uses that coin’s cushion; 0% turns the floor off', () => {
    const c = cfg();
    expect(cheapLoopMinLiveUsd({ cushionUsd: 175, pct: 15 })).toBe(26.25);
    expect(cheapLoopMinLiveUsd({ cushionUsd: 0.5, pct: 15 })).toBe(0.075);
    expect(cheapLoopMinLiveUsd({ cushionUsd: 0, pct: 15 })).toBe(Number.POSITIVE_INFINITY);
    const thin = evaluateCheapLoopEnter({
      lean: lean({ abs_gap: 10 }),
      cfg: c,
      adminEnabled: true,
    });
    expect(thin.ok).toBe(false);
    expect(thin.skip_reason).toBe('cheap_loop_below_min_live');
    expect(formatSkipReason('cheap_loop_below_min_live')).toBe('live too close to strike');

    const ok = evaluateCheapLoopEnter({
      lean: lean({ abs_gap: 27 }),
      cfg: c,
      adminEnabled: true,
    });
    expect(ok.ok).toBe(true);

    const sol = cfg();
    sol.cushions.SOL = 0.5;
    sol.assets_enabled.SOL = true;
    sol.risk.cheap_loop_assets = ['SOL'];
    const solOk = evaluateCheapLoopEnter({
      lean: lean({ asset: 'SOL', market_ticker: 'KXSOL15M-T', abs_gap: 0.1 }),
      cfg: sol,
      adminEnabled: true,
    });
    expect(solOk.ok).toBe(true);

    const noCushion = evaluateCheapLoopEnter({
      lean: lean({ abs_gap: 100 }),
      cfg: { ...c, cushions: { ...c.cushions, BTC: 0 } },
      adminEnabled: true,
    });
    expect(noCushion.ok).toBe(false);
    expect(noCushion.skip_reason).toBe('cheap_loop_below_min_live');

    const off = evaluateCheapLoopEnter({
      lean: lean({ abs_gap: 1 }),
      cfg: { ...c, risk: { ...c.risk, cheap_loop_min_live_cushion_pct: 0 } },
      adminEnabled: true,
    });
    expect(off.ok).toBe(true);

    expect(normalizeCheapLoopMinLiveCushionPct(15)).toBe(15);
    expect(normalizeCheapLoopMinLiveCushionPct(-4)).toBe(0);
    expect(normalizeCheapLoopMinLiveCushionPct(90)).toBe(50);

    const hourly = cheapLoopCfgForHourly({
      ...cfg(),
      risk: {
        ...cfg().risk,
        cheap_loop_hourly_enabled: true,
        cheap_loop_hourly_assets: ['BTC'],
        cheap_loop_min_live_cushion_pct: 15,
      },
    });
    expect(hourly.risk.cheap_loop_min_live_cushion_pct).toBe(0);
    const atm = evaluateCheapLoopEnter({
      lean: lean({
        market_ticker: 'KXBTCD-26SEP1406-T67099.99',
        abs_gap: 2,
        minutes_elapsed: 12,
        minutes_left: 40,
      }),
      cfg: hourly,
      adminEnabled: true,
      twapAdminEnabled: false,
    });
    expect(atm.ok).toBe(true);
  });

  test('min hold blocks take; dumped ask during min hold holds (Stop Off)', () => {
    const filledAt = new Date('2026-09-14T00:00:00Z');
    const duringHold = new Date(filledAt.getTime() + 20_000);
    const take = evaluateCheapLoopExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.36, yes_ask: 0.38, no_bid: 0.62, no_ask: 0.64 },
      fillUsd: 0.3,
      takeUsd: 0.05,
      stopUsd: 0.06,
      flattenMinutes: 5,
      minHoldMinutes: 1,
      lean: { phase: 'live', minutes_left: 10 },
      filledAt,
      now: duringHold,
    });
    expect(take.sell).toBe(false);

    const dumped = evaluateCheapLoopExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.2, yes_ask: 0.22, no_bid: 0.78, no_ask: 0.8 },
      fillUsd: 0.3,
      takeUsd: 0.05,
      stopUsd: 0.06,
      flattenMinutes: 5,
      minHoldMinutes: 1,
      lean: { phase: 'live', minutes_left: 10 },
      filledAt,
      now: new Date(filledAt.getTime() + 6_000),
    });
    expect(dumped).toMatchObject({ sell: false, kind: 'none', reason: 'cheap_loop_hold' });
  });

  test('flatten and $1 ask beat grace; dumped ask without take holds', () => {
    const filledAt = new Date('2026-09-14T00:00:00Z');
    const now = new Date(filledAt.getTime() + 1_000);
    const flat = evaluateCheapLoopExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.3, yes_ask: 0.32, no_bid: 0.68, no_ask: 0.7 },
      fillUsd: 0.3,
      takeUsd: 0.05,
      stopUsd: 0.06,
      flattenMinutes: 5,
      minHoldMinutes: 1,
      lean: { phase: 'live', minutes_left: 4 },
      filledAt,
      now,
    });
    expect(flat).toMatchObject({ sell: true, kind: 'cheap_loop_flatten' });

    const ceiling = evaluateCheapLoopExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.99, yes_ask: 0.995, no_bid: 0.01, no_ask: 0.02 },
      fillUsd: 0.3,
      takeUsd: 0.05,
      stopUsd: 0.06,
      flattenMinutes: 5,
      minHoldMinutes: 1,
      lean: { phase: 'live', minutes_left: 10 },
      filledAt,
      now,
    });
    expect(ceiling).toMatchObject({ sell: true, kind: 'cheap_loop_flatten' });

    const broken = evaluateCheapLoopExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.2, yes_ask: 0.22, no_bid: 0.78, no_ask: 0.8 },
      fillUsd: 0.3,
      takeUsd: 0.05,
      stopUsd: 0.06,
      flattenMinutes: 5,
      minHoldMinutes: 1,
      lean: { phase: 'live', minutes_left: 10 },
      filledAt,
      now: new Date(filledAt.getTime() + 70_000),
    });
    expect(broken).toMatchObject({ sell: false, kind: 'none', reason: 'cheap_loop_hold' });
  });

  test('take after min hold when bid still at fill + take', () => {
    const filledAt = new Date('2026-09-14T00:00:00Z');
    const res = evaluateCheapLoopExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.35, yes_ask: 0.37, no_bid: 0.63, no_ask: 0.65 },
      fillUsd: 0.3,
      takeUsd: 0.05,
      stopUsd: 0.06,
      flattenMinutes: 5,
      minHoldMinutes: 1,
      lean: { phase: 'live', minutes_left: 10 },
      filledAt,
      now: new Date(filledAt.getTime() + 61_000),
    });
    expect(res).toMatchObject({ sell: true, kind: 'cheap_loop_take' });
  });

  test('cooldown and cycles; same-side re-entry allowed after cooldown', () => {
    expect(isCheapLoopEnterWindow({ minutesElapsed: 4, minutesLeft: 10, startMinutes: 2, flattenMinutes: 5 })).toBe(
      true
    );
    expect(isCheapLoopEnterWindow({ minutesElapsed: 1, minutesLeft: 10, startMinutes: 2, flattenMinutes: 5 })).toBe(
      false
    );
    const c = cfg();
    const cool = evaluateCheapLoopEnter({
      lean: lean(),
      cfg: c,
      adminEnabled: true,
      inCooldown: true,
    });
    expect(cool.skip_reason).toBe('cheap_loop_cooldown');
    const used = evaluateCheapLoopEnter({
      lean: lean(),
      cfg: c,
      adminEnabled: true,
      cyclesUsed: 2,
    });
    expect(used.skip_reason).toBe('cheap_loop_cycles');
    const again = evaluateCheapLoopEnter({
      lean: lean({ yes_ask: 0.32, no_ask: 0.68 }),
      cfg: c,
      adminEnabled: true,
      cyclesUsed: 1,
    });
    expect(again.ok).toBe(true);
    expect(again.decision).toBe('YES');
  });

  test('TWAP owns BTC; last-minute owns; watch copy', () => {
    const c = cfg();
    c.risk.twap_lock_enabled = true;
    c.risk.twap_lock_assets = ['BTC', 'ETH'];
    const twap = evaluateCheapLoopEnter({
      lean: lean(),
      cfg: c,
      adminEnabled: true,
      twapAdminEnabled: true,
    });
    expect(twap.skip_reason).toBe('cheap_loop_twap_owns');
    const lm = evaluateCheapLoopEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
      lastMinuteOwnsNewBuys: true,
    });
    expect(lm.skip_reason).toBe('cheap_loop_last_minute_owns');
    expect(cheapLoopHoldingWatchText(0.05)).toBe('Cheap loop holding · take +5¢');
    expect(cheapLoopCooldownWatchText(80)).toBe('Cheap loop cooldown · 80s');
    expect(isCheapLoopEnterPath({ adminEnabled: true, userEnabled: true, assetEnabled: true, asset: 'BTC', assets: [] })).toBe(
      false
    );
    expect(PATH_INFO.cheapLoop.title).toBe('Cheap loop');
  });

  test('open fill helpers and cooldown owns', () => {
    const open = [
      {
        ticker: 'KXBTC15M-T',
        entryPath: 'cheap_loop',
        dryRun: false,
        status: 'FILLED',
        fillCount: 1,
        outcome: 'pending',
      },
    ];
    expect(tickerHasOpenCheapLoop(open, 'KXBTC15M-T')).toBe(true);
    expect(tickerHasOpenOtherThanCheapLoop(open, 'KXBTC15M-T')).toBe(false);
    expect(
      tickerHasOpenOtherThanCheapLoop(
        [
          {
            ticker: 'KXBTC15M-T',
            entryPath: 'home',
            dryRun: false,
            status: 'FILLED',
            fillCount: 1,
            outcome: 'pending',
          },
        ],
        'KXBTC15M-T'
      )
    ).toBe(true);
    const exited = [
      {
        ticker: 'KXBTC15M-T',
        entryPath: 'cheap_loop',
        outcome: 'exited',
        settledAt: '2026-09-14T00:00:00Z',
      },
    ];
    expect(cheapLoopExitsForTicker(exited, 'KXBTC15M-T')).toBe(1);
    expect(
      cheapLoopCooldownOwnsTicker({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'BTC',
        assets: ['BTC'],
        trades: exited,
        marketTicker: 'KXBTC15M-T',
        cooldownMinutes: 2,
        cycles: 2,
        flattenMinutes: 5,
        lean: { phase: 'live', minutes_left: 10 },
        now: new Date('2026-09-14T00:01:00Z'),
      })
    ).toBe(true);
  });

  test('hourly ATM pick, event cycles, cfg map, one lot per asset', () => {
    expect(pickUniqueAtmStrike({
      live: 67000,
      markets: [
        { ticker: 'KXBTCD-26SEP1406-T66999.99', floor_strike: 66999.99 },
        { ticker: 'KXBTCD-26SEP1406-T67100', floor_strike: 67100 },
      ],
    })).toEqual({
      ok: true,
      ticker: 'KXBTCD-26SEP1406-T66999.99',
      strike: 66999.99,
    });
    expect(
      pickUniqueAtmStrike({
        live: 67050,
        markets: [
          { ticker: 'A-T66900', floor_strike: 66900 },
          { ticker: 'B-T67200', floor_strike: 67200 },
        ],
      }).ok
    ).toBe(false);
    expect(cheapLoopHourlyEventKey('KXBTCD-26SEP1406-T67099.99')).toBe('KXBTCD-26SEP1406');
    expect(cheapLoopHourlySeriesTicker('BTC')).toBe('KXBTCD');
    expect(cheapLoopHourlySeriesTicker('Gold')).toBeNull();
    expect(normalizeCheapLoopHourlyAssets(['BTC', 'Gold', 'HYPE', 'BTC'])).toEqual(['BTC', 'HYPE']);
    expect(normalizeCheapLoopHourlyStartMinutes(10)).toBe(10);
    expect(normalizeCheapLoopHourlyCycles(9)).toBe(9);
    expect(normalizeCheapLoopHourlyCycles(11)).toBe(10);
    const hourly = cheapLoopCfgForHourly({
      ...cfg(),
      risk: {
        ...cfg().risk,
        cheap_loop_hourly_enabled: true,
        cheap_loop_hourly_start_minutes: 10,
        cheap_loop_hourly_assets: ['BTC'],
        twap_lock_enabled: true,
        twap_lock_assets: ['BTC', 'ETH'],
      },
    });
    expect(hourly.risk.cheap_loop_enabled).toBe(true);
    expect(hourly.risk.cheap_loop_start_minutes).toBe(10);
    expect(hourly.risk.cheap_loop_assets).toEqual(['BTC']);
    const twapBlocked = evaluateCheapLoopEnter({
      lean: lean({ market_ticker: 'KXBTCD-26SEP1406-T67099.99', minutes_elapsed: 12, minutes_left: 40 }),
      cfg: hourly,
      adminEnabled: true,
      twapAdminEnabled: false,
      lastMinuteOwnsNewBuys: false,
    });
    expect(twapBlocked.ok).toBe(true);
    const eventTrades = [
      {
        ticker: 'KXBTCD-26SEP1406-T67099.99',
        entryPath: 'cheap_loop_hourly',
        outcome: 'exited',
        settledAt: '2026-09-14T00:00:00Z',
      },
      {
        ticker: 'KXBTCD-26SEP1406-T67199.99',
        entryPath: 'cheap_loop_hourly',
        outcome: 'exited',
        settledAt: '2026-09-14T00:10:00Z',
      },
    ];
    expect(cheapLoopHourlyExitsForEvent(eventTrades, 'KXBTCD-26SEP1406')).toBe(2);
    expect(
      assetHasOpenCheapLoopHourly(
        [
          {
            ticker: 'KXBTCD-26SEP1406-T67099.99',
            asset: 'BTC',
            entryPath: 'cheap_loop_hourly',
            dryRun: false,
            status: 'FILLED',
            fillCount: 1,
            outcome: 'pending',
          },
        ],
        'BTC'
      )
    ).toBe(true);
    expect(PATH_INFO.cheapLoopHourly.title).toBe('Cheap loop hourly');
    const hourly10 = cheapLoopCfgForHourly({
      ...cfg(),
      risk: {
        ...cfg().risk,
        cheap_loop_hourly_enabled: true,
        cheap_loop_hourly_cycles: 10,
        cheap_loop_hourly_start_minutes: 10,
        cheap_loop_hourly_assets: ['BTC'],
      },
    });
    const sixHourly = evaluateCheapLoopEnter({
      lean: lean({ market_ticker: 'KXBTCD-26SEP1406-T67099.99', minutes_elapsed: 12, minutes_left: 40 }),
      cfg: hourly10,
      adminEnabled: true,
      twapAdminEnabled: false,
      lastMinuteOwnsNewBuys: false,
      cyclesUsed: 6,
      cyclesMax: 10,
    });
    expect(sixHourly.ok).toBe(true);
    const sixHourlyDefaultMax = evaluateCheapLoopEnter({
      lean: lean({ market_ticker: 'KXBTCD-26SEP1406-T67099.99', minutes_elapsed: 12, minutes_left: 40 }),
      cfg: hourly10,
      adminEnabled: true,
      twapAdminEnabled: false,
      lastMinuteOwnsNewBuys: false,
      cyclesUsed: 6,
    });
    expect(sixHourlyDefaultMax.ok).toBe(false);
    expect(sixHourlyDefaultMax.skip_reason).toBe('cheap_loop_cycles');
  });

  test('weekly duration filter, cycles 10, one lot per asset, History Sell helper', () => {
    expect(
      isCheapLoopHourlyEventDuration(60 * 60 * 1000)
    ).toBe(true);
    expect(isCheapLoopHourlyEventDuration(24 * 60 * 60 * 1000)).toBe(false);
    expect(isCheapLoopHourlyEventDuration(169 * 60 * 60 * 1000)).toBe(false);
    expect(isCheapLoopWeeklyEventDuration(60 * 60 * 1000)).toBe(false);
    expect(isCheapLoopWeeklyEventDuration(24 * 60 * 60 * 1000)).toBe(false);
    expect(isCheapLoopWeeklyEventDuration(169 * 60 * 60 * 1000)).toBe(true);
    expect(isCheapLoopWeeklyEventDuration(3 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(isCheapLoopWeeklyEventDuration(11 * 24 * 60 * 60 * 1000)).toBe(false);
    const now = new Date('2026-09-14T11:30:00.000Z');
    const hour = {
      eventTicker: 'KXBTCD-26SEP1412',
      openUtc: new Date('2026-09-14T11:00:00.000Z'),
      closeUtc: new Date('2026-09-14T12:00:00.000Z'),
    };
    const day = {
      eventTicker: 'KXBTCD-26SEP1512',
      openUtc: new Date('2026-09-14T11:00:00.000Z'),
      closeUtc: new Date('2026-09-15T12:00:00.000Z'),
    };
    const week = {
      eventTicker: 'KXBTCD-26SEP1817',
      openUtc: new Date('2026-09-11T17:00:00.000Z'),
      closeUtc: new Date('2026-09-18T17:00:00.000Z'),
    };
    expect(pickSoonestLiveLadderEvent([hour, day, week], now, isCheapLoopHourlyEventDuration)?.eventTicker).toBe(
      'KXBTCD-26SEP1412'
    );
    expect(pickSoonestLiveLadderEvent([hour, day, week], now, isCheapLoopWeeklyEventDuration)?.eventTicker).toBe(
      'KXBTCD-26SEP1817'
    );
    expect(normalizeCheapLoopWeeklyCycles(undefined)).toBe(10);
    expect(normalizeCheapLoopWeeklyCycles(20)).toBe(20);
    expect(normalizeCheapLoopWeeklyCycles(21)).toBe(21);
    expect(normalizeCheapLoopWeeklyCycles(51)).toBe(50);
    expect(normalizeCheapLoopHourlyCycles(9)).toBe(9);
    const weekly = cheapLoopCfgForWeekly({
      ...cfg(),
      risk: {
        ...cfg().risk,
        cheap_loop_weekly_enabled: true,
        cheap_loop_weekly_cycles: 10,
        cheap_loop_weekly_assets: ['BTC'],
      },
    });
    expect(weekly.risk.cheap_loop_enabled).toBe(true);
    expect(weekly.risk.cheap_loop_cycles).toBe(10);
    expect(weekly.risk.cheap_loop_min_live_cushion_pct).toBe(0);
    const sixExits = evaluateCheapLoopEnter({
      lean: lean({
        market_ticker: 'KXBTCD-26SEP1817-T67099.99',
        minutes_elapsed: 12,
        minutes_left: 4000,
      }),
      cfg: weekly,
      adminEnabled: true,
      twapAdminEnabled: false,
      cyclesUsed: 6,
      cyclesMax: 50,
    });
    expect(sixExits.ok).toBe(true);
    const tenExits = evaluateCheapLoopEnter({
      lean: lean({
        market_ticker: 'KXBTCD-26SEP1817-T67099.99',
        minutes_elapsed: 12,
        minutes_left: 4000,
      }),
      cfg: weekly,
      adminEnabled: true,
      twapAdminEnabled: false,
      cyclesUsed: 10,
      cyclesMax: 50,
    });
    expect(tenExits.ok).toBe(false);
    expect(tenExits.skip_reason).toBe('cheap_loop_cycles');
    const weekly50 = cheapLoopCfgForWeekly({
      ...cfg(),
      risk: {
        ...cfg().risk,
        cheap_loop_weekly_enabled: true,
        cheap_loop_weekly_cycles: 50,
        cheap_loop_weekly_assets: ['BTC'],
      },
    });
    const twentyOneExits = evaluateCheapLoopEnter({
      lean: lean({
        market_ticker: 'KXBTCD-26SEP1817-T67099.99',
        minutes_elapsed: 12,
        minutes_left: 4000,
      }),
      cfg: weekly50,
      adminEnabled: true,
      twapAdminEnabled: false,
      cyclesUsed: 21,
      cyclesMax: 50,
    });
    expect(twentyOneExits.ok).toBe(true);
    const fiftyExits = evaluateCheapLoopEnter({
      lean: lean({
        market_ticker: 'KXBTCD-26SEP1817-T67099.99',
        minutes_elapsed: 12,
        minutes_left: 4000,
      }),
      cfg: weekly50,
      adminEnabled: true,
      twapAdminEnabled: false,
      cyclesUsed: 50,
      cyclesMax: 50,
    });
    expect(fiftyExits.ok).toBe(false);
    expect(fiftyExits.skip_reason).toBe('cheap_loop_cycles');
    const withoutWeeklyMax = evaluateCheapLoopEnter({
      lean: lean({
        market_ticker: 'KXBTCD-26SEP1817-T67099.99',
        minutes_elapsed: 12,
        minutes_left: 4000,
      }),
      cfg: weekly,
      adminEnabled: true,
      twapAdminEnabled: false,
      cyclesUsed: 6,
    });
    expect(withoutWeeklyMax.ok).toBe(false);
    expect(
      assetHasOpenCheapLoopWeekly(
        [
          {
            ticker: 'KXBTCD-26SEP1817-T67099.99',
            asset: 'BTC',
            entryPath: 'cheap_loop_weekly',
            dryRun: false,
            status: 'FILLED',
            fillCount: 1,
            outcome: 'pending',
          },
        ],
        'BTC'
      )
    ).toBe(true);
    expect(
      tickerHasOpenOtherThanCheapLoopWeekly(
        [
          {
            ticker: 'KXBTCD-26SEP1817-T67099.99',
            entryPath: 'cheap_loop_hourly',
            dryRun: false,
            status: 'FILLED',
            fillCount: 1,
            outcome: 'pending',
          },
        ],
        'KXBTCD-26SEP1817-T67099.99'
      )
    ).toBe(true);
    expect(
      isCheapLoopHistorySellableTrade({
        entryPath: 'cheap_loop_hourly',
        outcome: 'pending',
        fillCount: 1,
      })
    ).toBe(true);
    expect(
      isCheapLoopHistorySellableTrade({
        entry_path: 'cheap_loop_weekly',
        outcome: 'pending',
        fill_count: 1,
      })
    ).toBe(true);
    expect(
      isCheapLoopHistorySellableTrade({
        entryPath: 'cheap_loop',
        outcome: 'pending',
        fillCount: 1,
      })
    ).toBe(false);
    expect(
      isCheapLoopHistorySellableTrade({
        entryPath: 'home',
        outcome: 'pending',
        fillCount: 1,
      })
    ).toBe(false);
    expect(PATH_INFO.cheapLoopWeekly.title).toBe('Cheap loop weekly');
    expect(formatSkipReason('cheap_loop_weekly_no_market')).toBe('no weekly market');
  });
});


import {
  canPairLockHedge,
  evaluatePairLockEnter,
  evaluatePairLockFlatten,
  evaluatePairLockWatch,
  isPairLockEnterPath,
  isPairLockEnterWindow,
  normalizePairLockAssets,
  normalizePairLockFlattenMinutes,
  normalizePairLockLotCount,
  normalizePairLockMinLockUsd,
  normalizePairLockRunnerMaxAskUsd,
  normalizePairLockStartMinutes,
  normalizePairLockUntilMinutes,
  pairLockHedgeAskLimitUsd,
  pairLockLockedUsd,
  pairLockLotsForTicker,
  reconcilePairLockWindow,
  tickerHasOpenOtherThanPairLock,
  tickerHasOpenPairLock,
} from '../packages/trading-core/src/pairLock';
import { formatSkipReason } from '../packages/trading-core/src/gates';
import { defaultAppConfig } from '../packages/trading-core/src/types';
import { PATH_INFO } from '../src/content/pathInfo';

function cfg(over: Record<string, unknown> = {}) {
  const c = defaultAppConfig();
  c.auto_trade_enabled = true;
  c.cushions.Gold = 7;
  c.assets_enabled.Gold = true;
  c.risk.pair_lock_enabled = true;
  c.risk.pair_lock_start_minutes = 2;
  c.risk.pair_lock_until_minutes = 10;
  c.risk.pair_lock_runner_max_ask_usd = 0.6;
  c.risk.pair_lock_min_lock_usd = 0.05;
  c.risk.pair_lock_flatten_minutes = 3;
  c.risk.pair_lock_lot_count = 1;
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
    yes_ask: 0.52,
    yes_bid: 0.5,
    no_ask: 0.48,
    no_bid: 0.46,
    ...over,
  };
}

describe('Pair lock path', () => {
  test('normalizers clamp window, runner max, min lock, flatten, lots', () => {
    expect(normalizePairLockStartMinutes(2)).toBe(2);
    expect(normalizePairLockStartMinutes(0)).toBe(1);
    expect(normalizePairLockStartMinutes(20)).toBe(8);
    expect(normalizePairLockUntilMinutes(10)).toBe(10);
    expect(normalizePairLockUntilMinutes(1)).toBe(6);
    expect(normalizePairLockUntilMinutes(20)).toBe(14);
    expect(normalizePairLockRunnerMaxAskUsd(0.6)).toBe(0.6);
    expect(normalizePairLockRunnerMaxAskUsd(0.2)).toBe(0.4);
    expect(normalizePairLockRunnerMaxAskUsd(0.9)).toBe(0.7);
    expect(normalizePairLockMinLockUsd(0.05)).toBe(0.05);
    expect(normalizePairLockMinLockUsd(0.01)).toBe(0.02);
    expect(normalizePairLockMinLockUsd(0.4)).toBe(0.15);
    expect(normalizePairLockFlattenMinutes(3)).toBe(3);
    expect(normalizePairLockFlattenMinutes(1)).toBe(2);
    expect(normalizePairLockLotCount(0)).toBe(1);
    expect(normalizePairLockLotCount(9)).toBe(5);
    const win = reconcilePairLockWindow({ startMinutes: 8, untilMinutes: 6 });
    expect(win.untilMinutes).toBeGreaterThanOrEqual(win.startMinutes);
    expect(normalizePairLockAssets([])).toEqual([]);
    expect(normalizePairLockAssets(['Gold', 'NOPE'])).toEqual(['Gold']);
  });

  test('enter window is Start after through Until minute', () => {
    expect(isPairLockEnterWindow({ minutesElapsed: 1, startMinutes: 2, untilMinutes: 10 })).toBe(false);
    expect(isPairLockEnterWindow({ minutesElapsed: 2, startMinutes: 2, untilMinutes: 10 })).toBe(true);
    expect(isPairLockEnterWindow({ minutesElapsed: 10, startMinutes: 2, untilMinutes: 10 })).toBe(true);
    expect(isPairLockEnterWindow({ minutesElapsed: 11, startMinutes: 2, untilMinutes: 10 })).toBe(false);
  });

  test('min lock skips 50/50 and allows 52+18', () => {
    expect(pairLockHedgeAskLimitUsd(0.52, 0.05)).toBe(0.43);
    expect(canPairLockHedge({ runnerFillUsd: 0.52, hedgeAskUsd: 0.18, minLockUsd: 0.05 })).toBe(true);
    expect(canPairLockHedge({ runnerFillUsd: 0.52, hedgeAskUsd: 0.48, minLockUsd: 0.05 })).toBe(false);
    expect(canPairLockHedge({ runnerFillUsd: 0.5, hedgeAskUsd: 0.5, minLockUsd: 0.05 })).toBe(false);
    expect(pairLockLockedUsd(0.52, 0.18)).toBe(0.3);
  });

  test('enter buys Auto lean YES when ask is under runner max', () => {
    const enter = evaluatePairLockEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(enter.ok).toBe(true);
    expect(enter.decision).toBe('YES');
  });

  test('sits out outside window, rich ask, empty chips, TWAP, Last-minute, other path', () => {
    expect(
      evaluatePairLockEnter({
        lean: lean({ minutes_elapsed: 1 }),
        cfg: cfg(),
        adminEnabled: true,
      }).skip_reason
    ).toBe('pair_lock_outside_window');
    expect(
      evaluatePairLockEnter({
        lean: lean({ yes_ask: 0.72 }),
        cfg: cfg(),
        adminEnabled: true,
      }).skip_reason
    ).toBe('pair_lock_ask_rich');
    expect(
      evaluatePairLockEnter({
        lean: lean(),
        cfg: cfg({ risk: { pair_lock_assets: [] } }),
        adminEnabled: true,
      }).skip_reason
    ).toBe('pair_lock_asset_off');
    expect(
      evaluatePairLockEnter({
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
    ).toBe('pair_lock_twap_owns');
    expect(
      evaluatePairLockEnter({
        lean: lean(),
        cfg: cfg(),
        adminEnabled: true,
        lastMinuteOwnsNewBuys: true,
      }).skip_reason
    ).toBe('pair_lock_last_minute_owns');
    expect(
      evaluatePairLockEnter({
        lean: lean(),
        cfg: cfg(),
        adminEnabled: true,
        hasOpenOnTicker: true,
      }).skip_reason
    ).toBe('pair_lock_holding_other_path');
    expect(formatSkipReason('pair_lock_holding')).toMatch(/holding/i);
    expect(formatSkipReason('pair_lock_min_lock')).toMatch(/min lock/i);
  });

  test('watcher hedges when opposite ask clears min lock; flatten only if unmatched', () => {
    const lots = {
      runnerSide: 'YES' as const,
      runnerFillUsd: 0.52,
      runnerCount: 1,
      runnerFilledAt: '2026-09-12T15:00:00.000Z',
      hedgeSide: null,
      hedgeFillUsd: null,
      hedgeCount: 0,
      locked: false,
      unmatched: true,
    };
    const hedge = evaluatePairLockWatch({
      lots,
      quotes: { yes_bid: 0.8, yes_ask: 0.82, no_bid: 0.16, no_ask: 0.18 },
      minLockUsd: 0.05,
      flattenMinutes: 3,
      lean: { phase: 'live', minutes_left: 7 },
      filledAt: '2026-09-12T15:00:00.000Z',
      now: new Date('2026-09-12T15:00:08.000Z'),
    });
    expect(hedge.kind).toBe('hedge');
    expect(hedge.hedge?.decision).toBe('NO');
    const flatten = evaluatePairLockFlatten({
      lots,
      quotes: { yes_bid: 0.4, yes_ask: 0.42, no_bid: 0.56, no_ask: 0.58 },
      flattenMinutes: 3,
      lean: { phase: 'live', minutes_left: 3 },
      filledAt: '2026-09-12T15:00:00.000Z',
      now: new Date('2026-09-12T15:00:08.000Z'),
    });
    expect(flatten).toMatchObject({ sell: true, kind: 'pair_lock_flatten' });
    const locked = evaluatePairLockWatch({
      lots: { ...lots, locked: true, unmatched: false, hedgeSide: 'NO', hedgeFillUsd: 0.18, hedgeCount: 1 },
      quotes: { yes_bid: 0.1, yes_ask: 0.12, no_bid: 0.86, no_ask: 0.88 },
      flattenMinutes: 3,
      lean: { phase: 'live', minutes_left: 2 },
      filledAt: '2026-09-12T15:00:00.000Z',
      now: new Date('2026-09-12T15:00:08.000Z'),
    });
    expect(locked.kind).toBe('hold_locked');
    expect(
      evaluatePairLockFlatten({
        lots,
        quotes: { yes_bid: 0.5, yes_ask: 0.52, no_bid: 0.46, no_ask: 0.48 },
        flattenMinutes: 3,
        lean: { phase: 'live', minutes_left: 8 },
        filledAt: '2026-09-12T15:00:00.000Z',
        now: new Date('2026-09-12T15:00:02.000Z'),
      })
    ).toMatchObject({ sell: false, reason: 'grace_after_fill' });
  });

  test('open-lot helpers and enter path chips', () => {
    expect(
      isPairLockEnterPath({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        assets: ['Gold'],
      })
    ).toBe(true);
    expect(
      isPairLockEnterPath({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        assets: [],
      })
    ).toBe(false);
    const trades = [
      {
        ticker: 'KXGOLD15M-T',
        entryPath: 'pair_lock',
        decision: 'YES',
        dryRun: false,
        status: 'FILLED',
        fillCount: 1,
        outcome: 'pending',
        payPrice: 0.52,
        executedAt: '2026-09-12T15:02:00.000Z',
      },
      { ticker: 'KXGOLD15M-T', entryPath: 'auto', dryRun: false, status: 'FILLED', fillCount: 1, outcome: 'pending' },
    ];
    expect(tickerHasOpenPairLock(trades, 'KXGOLD15M-T')).toBe(true);
    expect(tickerHasOpenOtherThanPairLock(trades, 'KXGOLD15M-T')).toBe(true);
    expect(pairLockLotsForTicker(trades, 'KXGOLD15M-T')).toMatchObject({
      runnerSide: 'YES',
      unmatched: true,
      locked: false,
    });
  });

  test('i-icon copy locks isolation and flatten unmatched', () => {
    expect(PATH_INFO.pairLock.title).toBe('Pair lock');
    expect(PATH_INFO.pairLock.body).toMatch(/Pair lock asset chips/);
    expect(PATH_INFO.pairLock.body).toMatch(/Empty chips = no Pair lock buys/);
    expect(PATH_INFO.pairLock.body).toMatch(/Start after \/ Until minute/);
    expect(PATH_INFO.pairLock.body).toMatch(/Min lock/);
    expect(PATH_INFO.pairLock.body).toMatch(/Flatten unmatched/);
    expect(PATH_INFO.pairLock.body).toMatch(/hold both to \$1/);
    expect(PATH_INFO.pairLock.body).toMatch(/5s grace/);
    expect(PATH_INFO.pairLock.body).toMatch(/window cap 1/i);
    expect(PATH_INFO.pairLock.body).toMatch(/Protect skips Pair lock/);
    expect(PATH_INFO.pairLock.body).toMatch(/Last-minute owns new buys/);
    expect(PATH_INFO.shared.body).toMatch(/Pair lock/);
    expect(PATH_INFO.protect.body).toMatch(/Pair lock/);
  });
});

import {
  canPairLockHedge,
  canPairLockStackAsks,
  evaluatePairLockEnter,
  evaluatePairLockFlatten,
  evaluatePairLockStackAdd,
  evaluatePairLockStackRecover,
  evaluatePairLockWatch,
  isPairLockEnterPath,
  isPairLockEntryPath,
  isPairLockLockFirst,
  isPairLockEnterWindow,
  normalizePairLockAddPairs,
  normalizePairLockAssets,
  normalizePairLockFlattenMinutes,
  normalizePairLockLotCount,
  normalizePairLockMinLockUsd,
  normalizePairLockRunnerMaxAskUsd,
  normalizePairLockRunnerStopUsd,
  pairLockRunnerStopAskUsd,
  normalizePairLockStartMinutes,
  normalizePairLockUntilMinutes,
  pairLockHedgeAskLimitUsd,
  pairLockLockedUsd,
  pairLockLotsForTicker,
  normalizePairLockRecoverSeconds,
  pairLockRecoverElapsed,
  canPairLockEvenHedge,
  canPairLockRunnerTake,
  shouldWatchPairLockLots,
  shouldWatchPairLockTicker,
  reconcilePairLockWindow,
  tickerHasOpenOtherThanPairLock,
  tickerHasOpenPairLock,
} from '../packages/trading-core/src/pairLock';
import { firstWindowBuyEntryPath, formatSkipReason, skipReasonForWindowCap } from '../packages/trading-core/src/gates';
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
    expect(normalizePairLockRunnerStopUsd(0.1)).toBe(0.1);
    expect(normalizePairLockRunnerStopUsd(0)).toBe(0);
    expect(normalizePairLockRunnerStopUsd(undefined)).toBe(0.1);
    expect(normalizePairLockRunnerStopUsd(0.4)).toBe(0.2);
    expect(pairLockRunnerStopAskUsd(0.51, 0.1)).toBe(0.41);
    expect(normalizePairLockLotCount(0)).toBe(1);
    expect(normalizePairLockLotCount(9)).toBe(5);
    expect(normalizePairLockAddPairs(0)).toBe(0);
    expect(normalizePairLockAddPairs(3)).toBe(3);
    expect(normalizePairLockAddPairs(9)).toBe(3);
    expect(normalizePairLockAddPairs(-1)).toBe(0);
    expect(isPairLockLockFirst(undefined)).toBe(true);
    expect(isPairLockLockFirst({})).toBe(true);
    expect(isPairLockLockFirst({ pair_lock_lock_first: true })).toBe(true);
    expect(isPairLockLockFirst({ pair_lock_lock_first: false })).toBe(false);
    const win = reconcilePairLockWindow({ startMinutes: 8, untilMinutes: 6 });
    expect(win.untilMinutes).toBeGreaterThanOrEqual(win.startMinutes);
    expect(normalizePairLockAssets(undefined).includes('Gold')).toBe(true);
    expect(normalizePairLockAssets(undefined).includes('HYPE')).toBe(false);
    expect(normalizePairLockAssets(['HYPE'])).toEqual(['HYPE']);
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
    expect(canPairLockStackAsks({ yesAskUsd: 0.61, noAskUsd: 0.38 })).toBe(true);
    expect(canPairLockStackAsks({ yesAskUsd: 0.52, noAskUsd: 0.47 })).toBe(true);
    expect(canPairLockStackAsks({ yesAskUsd: 0.52, noAskUsd: 0.48 })).toBe(false);
    expect(canPairLockStackAsks({ yesAskUsd: 0.61, noAskUsd: 0.39, minLockUsd: 0.05 })).toBe(false);
    expect(pairLockLockedUsd(0.52, 0.18)).toBe(0.3);
  });

  test('enter buys Auto lean YES only when opposite ask already locks min lock', () => {
    expect(
      evaluatePairLockEnter({
        lean: lean(),
        cfg: cfg(),
        adminEnabled: true,
      }).skip_reason
    ).toBe('pair_lock_min_lock');
    const enter = evaluatePairLockEnter({
      lean: lean({ no_ask: 0.18 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(enter.ok).toBe(true);
    expect(enter.decision).toBe('YES');
    expect(Number(enter.count)).toBe(1);
    expect(enter.atomic).toBe(true);
    expect(enter.hedge?.ok).toBe(true);
    expect(enter.hedge?.decision).toBe('NO');
    const cheapRunner = evaluatePairLockEnter({
      lean: lean({ yes_ask: 0.29, no_ask: 0.18 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(cheapRunner.ok).toBe(true);
    expect(Number(cheapRunner.count)).toBe(1);
    const noLean = evaluatePairLockEnter({
      lean: lean({ decision: 'NO', no_ask: 0.52, yes_ask: 0.18 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(noLean.ok).toBe(true);
    expect(noLean.decision).toBe('NO');
  });

  test('Lock first Off buys the runner when the opposite does not yet lock', () => {
    const unlocked = lean({ yes_ask: 0.52, no_ask: 0.48 });
    expect(
      evaluatePairLockEnter({
        lean: unlocked,
        cfg: cfg(),
        adminEnabled: true,
      }).skip_reason
    ).toBe('pair_lock_min_lock');
    const enter = evaluatePairLockEnter({
      lean: unlocked,
      cfg: cfg({ risk: { pair_lock_lock_first: false } }),
      adminEnabled: true,
    });
    expect(enter.ok).toBe(true);
    expect(enter.decision).toBe('YES');
    expect(Number(enter.count)).toBe(1);
    expect(enter.atomic).toBeFalsy();
    expect(enter.hedge).toBeUndefined();
    expect(
      evaluatePairLockEnter({
        lean: lean({ yes_ask: 0.72, no_ask: 0.29 }),
        cfg: cfg({ risk: { pair_lock_lock_first: false } }),
        adminEnabled: true,
      }).skip_reason
    ).toBe('pair_lock_ask_rich');
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
    expect(formatSkipReason('pair_lock_runner_stop')).toMatch(/runner stop/i);
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
    const hedgeNow = evaluatePairLockWatch({
      lots,
      quotes: { yes_bid: 0.8, yes_ask: 0.82, no_bid: 0.16, no_ask: 0.18 },
      minLockUsd: 0.05,
      flattenMinutes: 3,
      lean: { phase: 'live', minutes_left: 7 },
      filledAt: '2026-09-12T15:00:00.000Z',
      now: new Date('2026-09-12T15:00:02.000Z'),
    });
    expect(hedgeNow.kind).toBe('hedge');
    const flatten = evaluatePairLockFlatten({
      lots,
      quotes: { yes_bid: 0.4, yes_ask: 0.48, no_bid: 0.5, no_ask: 0.52 },
      flattenMinutes: 3,
      runnerStopUsd: 0,
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
      matchedCount: 0,
      extraCount: 1,
      extraSide: 'YES',
    });
  });

  test('hedge entry path still locks the pair and flatten holds both sides', () => {
    expect(isPairLockEntryPath('pair_lock_hedge')).toBe(true);
    expect(isPairLockEntryPath('pair-lock-hedge')).toBe(true);
    const trades = [
      {
        ticker: 'KXGOLD15M-T',
        entryPath: 'pair_lock',
        decision: 'YES',
        dryRun: false,
        status: 'FILLED',
        fillCount: 1,
        outcome: 'pending',
        payPrice: 0.59,
        executedAt: '2026-09-12T15:02:00.000Z',
      },
      {
        ticker: 'KXGOLD15M-T',
        entryPath: 'pair_lock_hedge',
        decision: 'NO',
        dryRun: false,
        status: 'FILLED',
        fillCount: 1,
        outcome: 'pending',
        payPrice: 0.36,
        executedAt: '2026-09-12T15:02:08.000Z',
      },
    ];
    const lots = pairLockLotsForTicker(trades, 'KXGOLD15M-T');
    expect(lots).toMatchObject({
      runnerSide: 'YES',
      hedgeSide: 'NO',
      locked: true,
      unmatched: false,
      matchedCount: 1,
      extraCount: 0,
    });
    expect(pairLockLockedUsd(lots.runnerFillUsd, lots.hedgeFillUsd)).toBe(0.05);
    expect(tickerHasOpenOtherThanPairLock(trades, 'KXGOLD15M-T')).toBe(false);
    expect(firstWindowBuyEntryPath(trades, 'KXGOLD15M-T')).toBe('pair_lock');
    expect(
      firstWindowBuyEntryPath(
        [{ ...trades[1], entryPath: 'pair_lock_hedge' }],
        'KXGOLD15M-T'
      )
    ).toBe('pair_lock');
    expect(skipReasonForWindowCap([trades[1]], 'KXGOLD15M-T')).toBe('window_used_by_pair_lock');
    expect(
      evaluatePairLockFlatten({
        lots,
        quotes: { yes_bid: 0.1, yes_ask: 0.12, no_bid: 0.86, no_ask: 0.88 },
        flattenMinutes: 3,
        lean: { phase: 'live', minutes_left: 2 },
        filledAt: '2026-09-12T15:02:00.000Z',
        now: new Date('2026-09-12T15:06:00.000Z'),
      })
    ).toMatchObject({ sell: false, kind: 'none', reason: 'pair_lock_hold_locked' });
    expect(
      evaluatePairLockWatch({
        lots,
        quotes: { yes_bid: 0.1, yes_ask: 0.12, no_bid: 0.86, no_ask: 0.88 },
        flattenMinutes: 3,
        lean: { phase: 'live', minutes_left: 2 },
        filledAt: '2026-09-12T15:02:00.000Z',
        now: new Date('2026-09-12T15:06:00.000Z'),
      })
    ).toMatchObject({ kind: 'hold_locked', reason: 'pair_lock_hold_locked' });
  });

  test('runner stop sells unmatched when ask is fill minus stop and hedge is still rich', () => {
    const lots = {
      runnerSide: 'YES' as const,
      runnerFillUsd: 0.51,
      runnerCount: 1,
      runnerFilledAt: '2026-09-12T15:00:00.000Z',
      hedgeSide: null,
      hedgeFillUsd: null,
      hedgeCount: 0,
      locked: false,
      unmatched: true,
    };
    const now = new Date('2026-09-12T15:00:08.000Z');
    const stop = evaluatePairLockWatch({
      lots,
      quotes: { yes_bid: 0.39, yes_ask: 0.41, no_bid: 0.57, no_ask: 0.59 },
      minLockUsd: 0.05,
      flattenMinutes: 3,
      runnerStopUsd: 0.1,
      lean: { phase: 'live', minutes_left: 8 },
      filledAt: '2026-09-12T15:00:00.000Z',
      now,
    });
    expect(stop).toMatchObject({ kind: 'runner_stop', reason: 'runner_stop' });
    expect(stop.flatten).toMatchObject({ sell: true, kind: 'pair_lock_runner_stop' });
    const stillHedge = evaluatePairLockWatch({
      lots,
      quotes: { yes_bid: 0.39, yes_ask: 0.41, no_bid: 0.16, no_ask: 0.18 },
      minLockUsd: 0.05,
      flattenMinutes: 3,
      runnerStopUsd: 0.1,
      lean: { phase: 'live', minutes_left: 8 },
      filledAt: '2026-09-12T15:00:00.000Z',
      now,
    });
    expect(stillHedge.kind).toBe('hedge');
    expect(
      evaluatePairLockWatch({
        lots,
        quotes: { yes_bid: 0.39, yes_ask: 0.41, no_bid: 0.57, no_ask: 0.59 },
        minLockUsd: 0.05,
        flattenMinutes: 3,
        runnerStopUsd: 0,
        lean: { phase: 'live', minutes_left: 8 },
        filledAt: '2026-09-12T15:00:00.000Z',
        now,
      }).kind
    ).toBe('none');
    expect(
      evaluatePairLockWatch({
        lots,
        quotes: { yes_bid: 0.39, yes_ask: 0.41, no_bid: 0.57, no_ask: 0.59 },
        minLockUsd: 0.05,
        flattenMinutes: 3,
        runnerStopUsd: 0.1,
        lean: { phase: 'live', minutes_left: 8 },
        filledAt: '2026-09-12T15:00:00.000Z',
        now: new Date('2026-09-12T15:00:02.000Z'),
      }).kind
    ).toBe('none');
    expect(
      evaluatePairLockWatch({
        lots: { ...lots, locked: true, unmatched: false, hedgeSide: 'NO', hedgeFillUsd: 0.18, hedgeCount: 1 },
        quotes: { yes_bid: 0.1, yes_ask: 0.12, no_bid: 0.86, no_ask: 0.88 },
        minLockUsd: 0.05,
        flattenMinutes: 3,
        runnerStopUsd: 0.1,
        lean: { phase: 'live', minutes_left: 2 },
        filledAt: '2026-09-12T15:00:00.000Z',
        now,
      }).kind
    ).toBe('hold_locked');
  });

  test('Add new pair stacks both sides then finish vs dump the extra', () => {
    const lockedLots = {
      runnerSide: 'YES' as const,
      runnerFillUsd: 0.52,
      runnerCount: 1,
      runnerFilledAt: '2026-09-12T15:00:00.000Z',
      hedgeSide: 'NO' as const,
      hedgeFillUsd: 0.18,
      hedgeCount: 1,
      locked: true,
      unmatched: false,
      matchedCount: 1,
      extraSide: null,
      extraCount: 0,
      extraFillUsd: null,
      extraFilledAt: null,
    };
    expect(
      evaluatePairLockWatch({
        lots: lockedLots,
        quotes: { yes_bid: 0.52, yes_ask: 0.54, no_bid: 0.18, no_ask: 0.2 },
        minLockUsd: 0.05,
        flattenMinutes: 3,
        addPairs: 0,
        lotCount: 1,
        lean: { phase: 'live', minutes_left: 8 },
        now: new Date('2026-09-12T15:00:20.000Z'),
      }).kind
    ).toBe('hold_locked');
    const stack = evaluatePairLockStackAdd({
      lots: lockedLots,
      quotes: { yes_bid: 0.52, yes_ask: 0.54, no_bid: 0.18, no_ask: 0.2 },
      addPairs: 1,
      lotCount: 1,
      minLockUsd: 0.05,
      flattenMinutes: 3,
      lean: { phase: 'live', minutes_left: 8 },
    });
    expect(stack.ok).toBe(true);
    expect(stack.yes.decision).toBe('YES');
    expect(stack.no.decision).toBe('NO');
    const tightBook = evaluatePairLockStackAdd({
      lots: lockedLots,
      quotes: { yes_bid: 0.55, yes_ask: 0.56, no_bid: 0.37, no_ask: 0.39 },
      addPairs: 1,
      lotCount: 1,
      minLockUsd: 0.05,
      flattenMinutes: 3,
      lean: { phase: 'live', minutes_left: 8 },
    });
    expect(tightBook.ok).toBe(true);
    expect(
      evaluatePairLockStackAdd({
        lots: lockedLots,
        quotes: { yes_bid: 0.6, yes_ask: 0.63, no_bid: 0.37, no_ask: 0.39 },
        addPairs: 1,
        lotCount: 1,
        minLockUsd: 0.05,
        flattenMinutes: 3,
        lean: { phase: 'live', minutes_left: 8 },
      }).ok
    ).toBe(false);
    expect(
      evaluatePairLockWatch({
        lots: lockedLots,
        quotes: { yes_bid: 0.52, yes_ask: 0.54, no_bid: 0.18, no_ask: 0.2 },
        minLockUsd: 0.05,
        flattenMinutes: 3,
        addPairs: 1,
        lotCount: 1,
        lean: { phase: 'live', minutes_left: 8 },
        now: new Date('2026-09-12T15:00:20.000Z'),
      }).kind
    ).toBe('stack');

    const extraLots = {
      ...lockedLots,
      runnerCount: 2,
      unmatched: true,
      extraSide: 'YES' as const,
      extraCount: 1,
      extraFillUsd: 0.54,
      extraFilledAt: '2026-09-12T15:00:21.000Z',
    };
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
        executedAt: '2026-09-12T15:00:00.000Z',
      },
      {
        ticker: 'KXGOLD15M-T',
        entryPath: 'pair_lock_hedge',
        decision: 'NO',
        dryRun: false,
        status: 'FILLED',
        fillCount: 1,
        outcome: 'pending',
        payPrice: 0.18,
        executedAt: '2026-09-12T15:00:08.000Z',
      },
      {
        ticker: 'KXGOLD15M-T',
        entryPath: 'pair_lock',
        decision: 'YES',
        dryRun: false,
        status: 'FILLED',
        fillCount: 1,
        outcome: 'pending',
        payPrice: 0.54,
        executedAt: '2026-09-12T15:00:21.000Z',
      },
    ];
    expect(pairLockLotsForTicker(trades, 'KXGOLD15M-T')).toMatchObject({
      matchedCount: 1,
      extraCount: 1,
      extraSide: 'YES',
      extraFillUsd: 0.54,
      locked: true,
      unmatched: true,
    });
    const finish = evaluatePairLockStackRecover({
      lots: extraLots,
      quotes: { yes_bid: 0.4, yes_ask: 0.54, no_bid: 0.22, no_ask: 0.24 },
    });
    expect(finish.kind).toBe('stack_finish');
    expect(finish.hedge?.decision).toBe('NO');
    const smallLoss = evaluatePairLockStackRecover({
      lots: extraLots,
      quotes: { yes_bid: 0.4, yes_ask: 0.54, no_bid: 0.46, no_ask: 0.48 },
    });
    expect(smallLoss.kind).toBe('stack_finish');
    const dump = evaluatePairLockStackRecover({
      lots: extraLots,
      quotes: { yes_bid: 0.5, yes_ask: 0.54, no_bid: 0.56, no_ask: 0.58 },
    });
    expect(dump.kind).toBe('stack_dump');
    expect(
      shouldWatchPairLockLots({ lots: lockedLots, addPairs: 0, lotCount: 1 })
    ).toBe(false);
    expect(
      shouldWatchPairLockLots({ lots: lockedLots, addPairs: 1, lotCount: 1 })
    ).toBe(true);
    expect(
      shouldWatchPairLockLots({
        lots: { ...lockedLots, matchedCount: 2, runnerCount: 2, hedgeCount: 2 },
        addPairs: 1,
        lotCount: 1,
      })
    ).toBe(false);
    expect(
      shouldWatchPairLockLots({ lots: extraLots, addPairs: 1, lotCount: 1 })
    ).toBe(true);
    expect(
      shouldWatchPairLockTicker({
        lots: lockedLots,
        addPairs: 0,
        lotCount: 1,
        minutesElapsed: 4,
        startMinutes: 2,
        untilMinutes: 10,
      })
    ).toBe(false);
    expect(
      shouldWatchPairLockTicker({
        lots: {
          runnerSide: null,
          runnerFillUsd: null,
          runnerCount: 0,
          runnerFilledAt: null,
          hedgeSide: null,
          hedgeFillUsd: null,
          hedgeCount: 0,
          locked: false,
          unmatched: false,
          matchedCount: 0,
          extraSide: null,
          extraCount: 0,
          extraFillUsd: null,
          extraFilledAt: null,
        },
        addPairs: 1,
        lotCount: 1,
        minutesElapsed: 4,
        startMinutes: 2,
        untilMinutes: 10,
      })
    ).toBe(true);
  });

  test('i-icon copy locks isolation and flatten unmatched', () => {
    expect(PATH_INFO.pairLock.title).toBe('Pair lock');
    expect(PATH_INFO.pairLock.body).toMatch(/Pair lock asset chips/);
    expect(PATH_INFO.pairLock.body).toMatch(/Empty chips = no Pair lock buys/);
    expect(PATH_INFO.pairLock.body).toMatch(/Start after \/ Until minute/);
    expect(PATH_INFO.pairLock.body).toMatch(/Lock first checkbox/);
    expect(PATH_INFO.pairLock.body).toMatch(/Min lock/);
    expect(PATH_INFO.pairLock.body).toMatch(/Flatten unmatched/);
    expect(PATH_INFO.pairLock.body).toMatch(/Runner stop/);
    expect(PATH_INFO.pairLock.body).toMatch(/Add new pair/);
    expect(PATH_INFO.pairLock.body).toMatch(/lock Min lock/);
    expect(PATH_INFO.pairLock.body).toMatch(/on that pulse and every 1s/);
    expect(PATH_INFO.pairLock.body).toMatch(/do not buy the other leg/);
    expect(PATH_INFO.pairLock.body).toMatch(/hold both to \$1/);
    expect(PATH_INFO.pairLock.body).toMatch(/5s grace/);
    expect(PATH_INFO.pairLock.body).toMatch(/window cap 1/i);
    expect(PATH_INFO.pairLock.body).toMatch(/Recover wait/);
    expect(PATH_INFO.pairLock.body).toMatch(/YES and NO IOC together/);
    expect(PATH_INFO.pairLock.body).toMatch(/Protect skips Pair lock/);
    expect(PATH_INFO.pairLock.body).toMatch(/Last-minute owns new buys/);
    expect(PATH_INFO.shared.body).toMatch(/Pair lock/);
    expect(PATH_INFO.protect.body).toMatch(/Pair lock/);
  });

  test('atomic enter + recover wait even hedge / take; no instant dump', () => {
    expect(normalizePairLockRecoverSeconds(20)).toBe(20);
    expect(normalizePairLockRecoverSeconds(5)).toBe(10);
    expect(normalizePairLockRecoverSeconds(99)).toBe(60);
    expect(canPairLockEvenHedge({ runnerFillUsd: 0.55, hedgeAskUsd: 0.44 })).toBe(true);
    expect(canPairLockEvenHedge({ runnerFillUsd: 0.55, hedgeAskUsd: 0.45 })).toBe(false);
    expect(canPairLockEvenHedge({ runnerFillUsd: 0.55, hedgeAskUsd: 0.46 })).toBe(false);
    const t0 = '2026-09-14T21:00:00.000Z';
    const lots = {
      runnerSide: 'YES' as const,
      runnerFillUsd: 0.55,
      runnerCount: 1,
      runnerFilledAt: t0,
      hedgeSide: null,
      hedgeFillUsd: null,
      hedgeCount: 0,
      locked: false,
      unmatched: true,
      matchedCount: 0,
      extraSide: 'YES' as const,
      extraCount: 1,
      extraFillUsd: 0.55,
      extraFilledAt: t0,
      atomicUnmatched: false,
    };
    const leanLive = { phase: 'live' as const, minutes_left: 10, minutes_remaining: 10 };
    expect(
      pairLockRecoverElapsed({ filledAt: t0, recoverSeconds: 20, now: new Date('2026-09-14T21:00:10.000Z') })
    ).toBe(false);
    expect(
      pairLockRecoverElapsed({ filledAt: t0, recoverSeconds: 20, now: new Date('2026-09-14T21:00:21.000Z') })
    ).toBe(true);
    const early = evaluatePairLockWatch({
      lots,
      quotes: { yes_bid: 0.54, yes_ask: 0.55, no_bid: 0.43, no_ask: 0.44 },
      minLockUsd: 0.05,
      flattenMinutes: 3,
      recoverSeconds: 20,
      lean: leanLive,
      filledAt: t0,
      now: new Date('2026-09-14T21:00:10.000Z'),
    });
    expect(early.kind).toBe('none');
    const even = evaluatePairLockWatch({
      lots,
      quotes: { yes_bid: 0.54, yes_ask: 0.55, no_bid: 0.43, no_ask: 0.44 },
      minLockUsd: 0.05,
      flattenMinutes: 3,
      recoverSeconds: 20,
      lean: leanLive,
      filledAt: t0,
      now: new Date('2026-09-14T21:00:21.000Z'),
    });
    expect(even.kind).toBe('hedge');
    expect(even.reason).toBe('pair_lock_even_hedge');
    expect(even.hedge?.decision).toBe('NO');
    const takeLots = { ...lots, runnerFillUsd: 0.52 };
    expect(
      canPairLockRunnerTake({
        lots: takeLots,
        quotes: { yes_bid: 0.54, yes_ask: 0.55, no_bid: 0.48, no_ask: 0.5 },
      })
    ).toBe(true);
    const take = evaluatePairLockWatch({
      lots: takeLots,
      quotes: { yes_bid: 0.54, yes_ask: 0.55, no_bid: 0.48, no_ask: 0.5 },
      minLockUsd: 0.05,
      flattenMinutes: 3,
      recoverSeconds: 20,
      lean: leanLive,
      filledAt: t0,
      now: new Date('2026-09-14T21:00:21.000Z'),
    });
    expect(take.kind).toBe('runner_take');
    const atomicEarly = evaluatePairLockWatch({
      lots: { ...lots, atomicUnmatched: true },
      quotes: { yes_bid: 0.5, yes_ask: 0.55, no_bid: 0.48, no_ask: 0.5 },
      minLockUsd: 0.05,
      flattenMinutes: 3,
      recoverSeconds: 20,
      lean: leanLive,
      filledAt: t0,
      now: new Date('2026-09-14T21:00:01.000Z'),
    });
    expect(atomicEarly.kind).toBe('none');
    expect(atomicEarly.reason).toBe('grace_after_fill');
  });
});

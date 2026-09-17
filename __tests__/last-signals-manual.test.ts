import { defaultAppConfig } from '../src/config/types';
import { isNewerOrSameLiveAsksAt } from '../src/services/cloud/cloudClient';
import {
  formatGapDisplay,
  mergeCloudHomeLean,
  formatLiveAskAgeSec,
  formatLiveAskLine,
  pickLiveAsk,
  formatLastMinuteWatchLine,
  formatStepBuyWatchLine,
  formatSpikeFadeWatchLine,
  formatPairLockWatchLine,
  formatCapLockWatchLine,
  formatCheapLoopWatchLine,
  formatTwapWatchLine,
  heldOpenFillForTicker,
  homeBuySkipReason,
  homeBuyGapBeatsCushion,
  homeStrongBuySides,
  homeSellSides,
  lastSignalExtraLine,
  lastSignalManualKind,
  lastSignalOfferKind,
} from '../src/screens/lastSignalsManual';

describe('last signals manual kind', () => {
  const yesRow = {
    asset: 'BTC',
    decision: 'YES',
    isOpen: true,
    noMarket: false,
    marketTicker: 'KXBTC15M-X',
  };

  test('live ask prefers Cloud 1s watcher even if the snapshot is older than 8s', () => {
    expect(formatLiveAskLine({ yes_ask: 0.42, no_ask: 0.59 })).toBe('YES 42¢ · NO 59¢');
    expect(formatLiveAskLine({ yes_ask: 0.1, no_ask: 0.91 })).toBe('YES 10¢ · NO 91¢');
    expect(formatLiveAskLine({ yes_ask: 0.42, no_ask: 0.59 }, { age: '1s' })).toBe(
      'YES 42¢ · NO 59¢ · 1s'
    );
    expect(formatLiveAskAgeSec(Date.parse('2026-09-13T15:00:03.000Z'), '2026-09-13T15:00:01.000Z')).toBe(
      '2s'
    );
    expect(formatLiveAskLine({ yes_ask: 0.41 })).toBe('YES 41¢');
    expect(formatLiveAskLine(null)).toBe('');
    expect(
      pickLiveAsk({
        nowMs: Date.parse('2026-09-13T15:00:02.000Z'),
        cloudAt: '2026-09-13T15:00:01.000Z',
        cloud: { yes_ask: 0.33, no_ask: 0.68 },
        leanYes: 0.55,
        leanNo: 0.46,
      })
    ).toEqual({ yes_ask: 0.33, no_ask: 0.68, source: 'watcher' });
    expect(
      pickLiveAsk({
        nowMs: Date.parse('2026-09-13T15:00:20.000Z'),
        cloudAt: '2026-09-13T15:00:01.000Z',
        cloud: { yes_ask: 0.33, no_ask: 0.68 },
        leanYes: 0.55,
        leanNo: 0.46,
      })
    ).toEqual({ yes_ask: 0.33, no_ask: 0.68, source: 'watcher' });
    expect(
      pickLiveAsk({
        nowMs: Date.parse('2026-09-13T15:00:20.000Z'),
        cloudAt: '2026-09-13T15:00:01.000Z',
        cloud: {},
        leanYes: 0.55,
        leanNo: 0.46,
      })
    ).toEqual({ yes_ask: 0.55, no_ask: 0.46, source: 'lean' });
    expect(isNewerOrSameLiveAsksAt('2026-09-13T15:00:02.000Z', '2026-09-13T15:00:01.000Z')).toBe(true);
    expect(isNewerOrSameLiveAsksAt('2026-09-13T15:00:01.000Z', '2026-09-13T15:00:02.000Z')).toBe(false);
    expect(isNewerOrSameLiveAsksAt(null, '2026-09-13T15:00:02.000Z')).toBe(false);
  });

  test('Home gap is ▲/▼, or with you / against you when holding', () => {
    expect(
      formatGapDisplay({
        gap: 7.2,
        assetKey: 'Gold',
        live: 3687.2,
        strike: 3680,
        decision: 'YES',
      })
    ).toEqual({ text: '\u25B2 $7.20 (gap)', tone: 'neutral' });
    expect(
      formatGapDisplay({
        gap: 7.2,
        assetKey: 'Gold',
        live: 3672.8,
        strike: 3680,
        decision: 'NO',
      })
    ).toEqual({ text: '\u25BC $7.20 (gap)', tone: 'neutral' });
    expect(
      formatGapDisplay({
        gap: 7.2,
        assetKey: 'Gold',
        live: 3687.2,
        strike: 3680,
        heldSide: 'YES',
      })
    ).toEqual({ text: 'with you $7.20 (gap)', tone: 'with' });
    expect(
      formatGapDisplay({
        gap: 7.2,
        assetKey: 'Gold',
        live: 3672.8,
        strike: 3680,
        decision: 'NO',
        heldSide: 'YES',
      })
    ).toEqual({ text: 'against you $7.20 (gap)', tone: 'against' });
    expect(
      formatGapDisplay({
        gap: 7.2,
        assetKey: 'Gold',
        live: 3672.8,
        strike: 3680,
        heldSide: 'NO',
      })
    ).toEqual({ text: 'with you $7.20 (gap)', tone: 'with' });
  });

  test('Cloud 1s lean updates gap and applies this user cushion to YES/SKIP', () => {
    const next = mergeCloudHomeLean(
      { ok: true, asset: 'Gold', decision: 'SKIP', phase: 'live', live: 3680, strike: 3680, abs_gap: 0 },
      { asset: 'Gold', live: 3687.2, strike: 3680, phase: 'live', market_ticker: 'KXGOLD15M-T' },
      4
    );
    expect(next?.abs_gap).toBe(7.2);
    expect(next?.decision).toBe('YES');
    expect(next?.live).toBe(3687.2);
    const below = mergeCloudHomeLean(next, { live: 3682, strike: 3680, phase: 'live' }, 4);
    expect(below?.abs_gap).toBe(2);
    expect(below?.decision).toBe('SKIP');
  });

  test('Cloud lean keeps minutes_elapsed for Home Buy timing', () => {
    const next = mergeCloudHomeLean(
      { ok: true, asset: 'Gold', decision: 'SKIP', phase: 'live' },
      {
        asset: 'Gold',
        live: 3687,
        strike: 3680,
        phase: 'live',
        minutes_elapsed: 6,
        minutes_left: 9,
        open_utc: '2026-09-15T22:00:00.000Z',
        close_utc: '2026-09-15T22:15:00.000Z',
      },
      4
    );
    expect(next?.minutes_elapsed).toBe(6);
    expect(next?.minutes_left).toBe(9);
    expect((next as { open_utc?: string } | undefined)?.open_utc).toBe('2026-09-15T22:00:00.000Z');
  });

  test('feature off or kill hides buttons', () => {
    expect(lastSignalManualKind({ featureOn: false, killSwitch: false, row: yesRow })).toBe('none');
    expect(lastSignalManualKind({ featureOn: true, killSwitch: true, row: yesRow })).toBe('none');
  });

  test('YES/NO open contract is buy; SKIP is not', () => {
    expect(lastSignalManualKind({ featureOn: true, killSwitch: false, row: yesRow })).toBe('buy');
    expect(
      lastSignalManualKind({
        featureOn: true,
        killSwitch: false,
        row: { ...yesRow, decision: 'SKIP' },
      })
    ).toBe('none');
  });

  test('held fill shows sell not buy', () => {
    expect(
      lastSignalManualKind({
        featureOn: true,
        killSwitch: false,
        row: yesRow,
        held: { side: 'NO' },
      })
    ).toBe('sell');
  });

  test('Home Buy never offers opposite side after one Home leg', () => {
    expect(
      homeStrongBuySides({
        strongBuy: true,
        offerKind: 'buy',
        leanDecision: 'YES',
        openSides: [],
      })
    ).toEqual([]);
    expect(
      homeStrongBuySides({
        strongBuy: false,
        offerKind: 'sell',
        heldSide: 'YES',
        heldEntryPath: 'home',
        openSides: ['YES'],
      })
    ).toEqual([]);
    expect(
      homeStrongBuySides({
        strongBuy: true,
        offerKind: 'sell',
        heldSide: 'NO',
        heldEntryPath: 'home',
        openSides: ['NO'],
      })
    ).toEqual([]);
  });

  test('homeSellSides lists every open Home side', () => {
    expect(
      homeSellSides({
        offerKind: 'sell',
        heldSide: 'YES',
        heldEntryPath: 'home',
        openSides: ['YES', 'NO'],
      })
    ).toEqual(['YES', 'NO']);
    expect(
      homeSellSides({
        offerKind: 'sell',
        heldSide: 'YES',
        heldEntryPath: 'home',
        openSides: ['YES'],
      })
    ).toEqual(['YES']);
    expect(
      homeSellSides({
        offerKind: 'buy',
        openSides: ['YES'],
      })
    ).toEqual([]);
  });

  test('Home Buy skip hides Buy; Sell still offered', () => {
    expect(lastSignalOfferKind('buy', 'ask too rich')).toBe('none');
    expect(lastSignalOfferKind('buy', null)).toBe('buy');
    expect(lastSignalOfferKind('sell', 'ask too rich')).toBe('sell');
  });

  test('heldOpenFillForTicker ignores dry run and misses', () => {
    const ticker = 'KXBTC15M-X';
    expect(
      heldOpenFillForTicker(
        [
          { market_ticker: ticker, dry_run: true, outcome: 'pending', fill_count: 2, side: 'YES', entry_path: 'auto' },
          { market_ticker: ticker, dry_run: false, outcome: 'miss', fill_count: 0, side: 'YES', entry_path: 'auto' },
          { market_ticker: ticker, dry_run: false, outcome: 'pending', fill_count: 3, side: 'NO', entry_path: 'auto' },
        ],
        ticker
      )?.side
    ).toBe('NO');
  });
});

describe('last signal extra line', () => {
  test('Cash out holding hides Home buttons and says so', () => {
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        autoDetail: 'placed YES · 7 @ $0.70',
        autoStatus: 'placed',
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        cashOutHolding: true,
      })
    ).toEqual({ testID: 'skip-reason', text: 'cash out is holding this ticket' });
  });

  test('TWAP lock holding hides Home buttons and says so', () => {
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        autoDetail: 'placed YES · 5 @ $0.95',
        autoStatus: 'placed',
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        twapLockHolding: true,
      })
    ).toEqual({ testID: 'skip-reason', text: 'twap lock is holding this ticket' });
  });

  test('TWAP watching line stays on the row even when Home Buy is showing', () => {
    expect(
      formatTwapWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assets: ['BTC', 'ETH'],
        asset: 'BTC',
        secondsLeft: 42,
      })
    ).toBe('TWAP watching · 42s left');
    expect(
      formatTwapWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assets: ['BTC', 'ETH'],
        asset: 'BTC',
        secondsLeft: 12,
        autoStatus: 'skipped',
        autoDetail: 'skipped · not locked',
      })
    ).toBe('TWAP watching · not locked');
    expect(
      formatTwapWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assets: ['BTC', 'ETH'],
        asset: 'Gold',
        secondsLeft: 12,
      })
    ).toBeNull();
    expect(
      formatTwapWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assets: ['BTC', 'ETH'],
        asset: 'BTC',
        secondsLeft: 400,
      })
    ).toBeNull();
    expect(
      lastSignalExtraLine({
        manualKind: 'buy',
        autoTradeOn: true,
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        tapSkipReason: null,
        twapWatchText: 'TWAP watching · 42s left',
      })
    ).toEqual({ testID: 'skip-reason', text: 'TWAP watching · 42s left' });
    expect(
      formatLastMinuteWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        secondsLeft: 38,
      })
    ).toBe('Last-minute watching · 38s left');
    expect(
      formatLastMinuteWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        secondsLeft: 120,
      })
    ).toBe('Last-minute watching · 120s left');
    expect(
      formatLastMinuteWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        secondsLeft: 160,
      })
    ).toBeNull();
    expect(
      lastSignalExtraLine({
        manualKind: 'buy',
        autoTradeOn: true,
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        tapSkipReason: null,
        lastMinuteWatchText: 'Last-minute watching · 38s left',
      })
    ).toEqual({ testID: 'skip-reason', text: 'Last-minute watching · 38s left' });
    expect(
      formatStepBuyWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 6,
        startMinutes: 5,
        secondsLeft: 400,
      })
    ).toBeNull();
    expect(
      formatStepBuyWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 6,
        startMinutes: 5,
        secondsLeft: 400,
        autoStatus: 'skipped',
        autoDetail: 'skipped · Step buy cushion % not reached',
      })
    ).toBe('Step buy watching · Step buy cushion % not reached');
    expect(
      formatStepBuyWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 6,
        startMinutes: 5,
        secondsLeft: 400,
        autoStatus: 'skipped',
        autoDetail: 'skipped · ask too rich',
      })
    ).toBeNull();
    expect(
      formatStepBuyWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 2,
        startMinutes: 5,
        secondsLeft: 400,
      })
    ).toBeNull();
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        stepBuyHolding: true,
      })
    ).toEqual({ testID: 'skip-reason', text: 'step buy is holding this ticket' });
    expect(
      formatSpikeFadeWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 4,
        startMinutes: 2,
        untilMinutes: 6,
        secondsLeft: 600,
      })
    ).toBeNull();
    expect(
      formatSpikeFadeWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 8,
        startMinutes: 2,
        untilMinutes: 6,
        secondsLeft: 400,
        autoStatus: 'skipped',
        autoDetail: 'skipped · Spike fade outside window',
      })
    ).toBeNull();
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        spikeFadeHolding: true,
      })
    ).toEqual({ testID: 'skip-reason', text: 'spike fade is holding this ticket' });
    expect(
      formatPairLockWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 4,
        startMinutes: 2,
        untilMinutes: 10,
        secondsLeft: 600,
      })
    ).toBeNull();
    expect(
      formatPairLockWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 4,
        startMinutes: 2,
        untilMinutes: 10,
        secondsLeft: 600,
        autoStatus: 'skipped',
        autoDetail: 'skipped · Pair lock min lock not reached',
      })
    ).toBe('Pair lock watching · Pair lock min lock not reached');
    expect(
      formatPairLockWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 4,
        startMinutes: 2,
        untilMinutes: 10,
        secondsLeft: 600,
        autoStatus: 'skipped',
        autoDetail: 'skipped · Kalshi ask is above your Pair lock runner max',
      })
    ).toBe('Pair lock watching · Kalshi ask is above your Pair lock runner max');
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        pairLockHolding: true,
      })
    ).toEqual({ testID: 'skip-reason', text: 'pair lock is holding this ticket' });
    expect(
      formatCapLockWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 0.5,
        minutesRemaining: 14.5,
        windowOpenSeconds: 90,
        allowLater: true,
        secondsLeft: 870,
      })
    ).toBeNull();
    expect(
      formatCapLockWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 0.5,
        minutesRemaining: 14.5,
        windowOpenSeconds: 90,
        allowLater: true,
        secondsLeft: 870,
        autoStatus: 'skipped',
        autoDetail: 'skipped · asks too rich to lock',
      })
    ).toBe('Cap lock · asks too rich to lock');
    expect(
      formatCapLockWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        minutesElapsed: 15,
        minutesRemaining: 0,
        windowOpenSeconds: 90,
        allowLater: true,
        secondsLeft: 1,
        autoStatus: 'skipped',
        autoDetail: 'skipped · window ended',
      })
    ).toBeNull();
    expect(
      formatCapLockWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        secondsLeft: 800,
        holding: true,
        lots: {
          yesCount: 1,
          noCount: 1,
          yesFillUsd: 0.48,
          noFillUsd: 0.48,
          yesFilledAt: '2026-09-15T10:00:00.000Z',
          noFilledAt: '2026-09-15T10:00:01.000Z',
          matchedCount: 1,
          extraSide: null,
          extraCount: 0,
          attempted: true,
          locked: true,
        },
        lockedPnlUsd: -0.04,
      })
    ).toBe('Cap lock holding · locked −$0.04');
    expect(
      formatCheapLoopWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'BTC',
        assets: ['BTC'],
        holding: true,
        takeUsd: 0.05,
      })
    ).toBe('Cheap loop holding · take +5¢');
    expect(
      formatCheapLoopWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'BTC',
        assets: ['BTC'],
        holding: true,
        takeUsd: 0.05,
        livePnlUsd: 0.05,
      })
    ).toBe('Cheap loop holding · take +5¢ · live +$0.05');
    expect(
      formatCheapLoopWatchLine({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'BTC',
        assets: ['BTC'],
        minutesElapsed: 4,
        minutesLeft: 10,
        startMinutes: 2,
        flattenMinutes: 5,
        cooldownSec: 80,
      })
    ).toBe('Cheap loop cooldown · 80s');
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        cheapLoopHolding: true,
      })
    ).toEqual({ testID: 'skip-reason', text: 'cheap loop is holding this ticket' });
  });

  test('Gold fade holding hides Home buttons and says so', () => {
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        autoDetail: 'placed YES · 10 @ $0.46',
        autoStatus: 'placed',
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        goldFadeHolding: true,
      })
    ).toEqual({ testID: 'skip-reason', text: 'gold fade is holding this ticket' });
  });

  test('Buy showing with Auto skip hides Auto and shows nothing if Home would place', () => {
    expect(
      lastSignalExtraLine({
        manualKind: 'buy',
        autoTradeOn: true,
        autoDetail: 'skipped · ask too rich',
        autoStatus: 'skipped',
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        tapSkipReason: null,
      })
    ).toBeNull();
  });

  test('Buy showing with Home skip shows only that skip', () => {
    expect(
      lastSignalExtraLine({
        manualKind: 'buy',
        autoTradeOn: true,
        autoDetail: 'skipped · ask too rich',
        autoStatus: 'skipped',
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        tapSkipReason: 'too little time left',
      })
    ).toEqual({ testID: 'skip-reason', text: 'too little time left' });
  });

  test('Sell showing hides Auto skip', () => {
    expect(
      lastSignalExtraLine({
        manualKind: 'sell',
        autoTradeOn: true,
        autoDetail: 'skipped · ask too rich',
        autoStatus: 'skipped',
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        tapSkipReason: 'ask too rich',
      })
    ).toBeNull();
  });

  test('Sell showing keeps Cloud placed @ line', () => {
    expect(
      lastSignalExtraLine({
        manualKind: 'sell',
        autoTradeOn: true,
        autoDetail: 'placed YES · 5 @ $0.55',
        autoStatus: 'placed',
        decision: 'YES',
        isOpen: true,
        noMarket: false,
      })
    ).toEqual({
      testID: 'trade-action',
      text: 'placed YES · 5 @ $0.55',
      placed: true,
    });
  });

  test('no button shows Auto last action, or the SKIP reason for this phase', () => {
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        autoDetail: 'skipped · ask too rich',
        autoStatus: 'skipped',
        decision: 'YES',
        isOpen: true,
        noMarket: false,
      })
    ).toEqual({
      testID: 'trade-action',
      text: 'skipped · ask too rich',
      placed: false,
      failed: false,
    });
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: false,
        decision: 'SKIP',
        isOpen: true,
        noMarket: false,
        phase: 'live',
      })
    ).toEqual({ testID: 'skip-reason', text: 'below cushion' });
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: false,
        decision: 'SKIP',
        isOpen: true,
        noMarket: false,
        phase: 'upcoming',
      })
    ).toEqual({ testID: 'skip-reason', text: 'next window' });
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: false,
        decision: 'SKIP',
        isOpen: true,
        noMarket: false,
        phase: 'ended',
      })
    ).toEqual({ testID: 'skip-reason', text: 'window ended' });
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        autoDetail: 'Cap lock · window ended',
        autoStatus: 'skipped',
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        phase: 'live',
      })
    ).toBeNull();
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        autoDetail: 'skipped · window ended',
        autoStatus: 'skipped',
        decision: 'SKIP',
        isOpen: true,
        noMarket: false,
        phase: 'ended',
      })
    ).toEqual({ testID: 'skip-reason', text: 'window ended' });
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        autoDetail: 'Pair lock watching · 600s left',
        autoStatus: 'skipped',
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        phase: 'live',
      })
    ).toBeNull();
  });
});

describe('homeBuyGapBeatsCushion', () => {
  test('needs live at least 25% past that coin’s cushion', () => {
    expect(homeBuyGapBeatsCushion({ absGap: 218.75, cushionUsd: 175 })).toBe(true);
    expect(homeBuyGapBeatsCushion({ absGap: 218, cushionUsd: 175 })).toBe(false);
    expect(homeBuyGapBeatsCushion({ absGap: 0.625, cushionUsd: 0.5 })).toBe(true);
    expect(homeBuyGapBeatsCushion({ absGap: 0.5, cushionUsd: 0.5 })).toBe(false);
    expect(homeBuyGapBeatsCushion({ absGap: 400, cushionUsd: 0 })).toBe(false);
  });
});

describe('homeBuySkipReason', () => {
  test('uses Home Buy max ask, not Auto-trade', () => {
    const cfg = defaultAppConfig();
    cfg.risk.max_entry_ask_usd = 0.5;
    cfg.manual_risk = { ...cfg.manual_risk, max_entry_ask_usd: 0.99, min_minutes_elapsed: 0, min_minutes_left: 0 };
    const lean = {
      asset: 'BTC',
      market_ticker: 'KXBTC15M-X',
      decision: 'YES',
      live: 500,
      strike: 100,
      abs_gap: 400,
      minutes_left: 8,
      minutes_elapsed: 5,
      phase: 'live',
      yes_ask: 0.94,
    };
    expect(homeBuySkipReason({ cfg, lean, trades: [] })).toBeNull();
    cfg.manual_risk = { ...cfg.manual_risk, max_entry_ask_usd: 0.5 };
    expect(homeBuySkipReason({ cfg, lean, trades: [] })).toBe('ask too rich');
  });

  test('does not stay too early when minutes_elapsed was stripped but close_utc is known', () => {
    const cfg = defaultAppConfig();
    cfg.manual_risk = {
      ...cfg.manual_risk,
      max_entry_ask_usd: 0.99,
      min_minutes_elapsed: 2,
      min_minutes_left: 0,
    };
    cfg.cushions.Gold = 4;
    const lean = {
      asset: 'Gold',
      market_ticker: 'KXGOLD15M-T',
      decision: 'YES' as const,
      live: 3688,
      strike: 3680,
      abs_gap: 8,
      minutes_left: 7,
      phase: 'live',
      yes_ask: 0.55,
      close_utc: '2026-09-15T22:15:00.000Z',
    };
    expect(
      homeBuySkipReason({
        cfg,
        lean,
        trades: [],
        nowMs: Date.parse('2026-09-15T22:08:00.000Z'),
      })
    ).toBeNull();
    expect(
      homeBuySkipReason({
        cfg,
        lean: { ...lean, close_utc: undefined },
        trades: [],
        nowMs: Date.parse('2026-09-15T22:08:00.000Z'),
      })
    ).toBe('too early in window');
  });
});

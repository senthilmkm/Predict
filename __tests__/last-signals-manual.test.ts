import { defaultAppConfig } from '../src/config/types';
import {
  formatGapDisplay,
  formatLastMinuteWatchLine,
  formatTwapWatchLine,
  heldOpenFillForTicker,
  homeBuySkipReason,
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
          { market_ticker: ticker, dry_run: true, outcome: 'pending', fill_count: 2, side: 'YES' },
          { market_ticker: ticker, dry_run: false, outcome: 'miss', fill_count: 0, side: 'YES' },
          { market_ticker: ticker, dry_run: false, outcome: 'pending', fill_count: 3, side: 'NO' },
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
});

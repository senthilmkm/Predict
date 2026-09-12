import { lastSignalExtraLine } from '../src/screens/lastSignalsManual';
import {
  formatSharedChipOverlapNote,
  formatTickerOverlapLine,
} from '../src/screens/tickerOverlap';
import { skipReasonForWindowCap } from '../packages/trading-core/src/gates';

const goldTicker = 'KXGOLD15M-X';

function trade(partial: Record<string, unknown>) {
  return {
    id: 't1',
    at: new Date().toISOString(),
    asset: 'Gold',
    market_ticker: goldTicker,
    side: 'YES',
    notional_usd: 1,
    fill_count: 2,
    outcome: 'pending',
    dry_run: false,
    ...partial,
  } as any;
}

describe('ticker overlap live line', () => {
  test('holding names sitters still in their window', () => {
    const now = new Date('2026-09-12T20:10:00.000Z');
    const closeUtc = new Date(now.getTime() + 80 * 1000);
    const line = formatTickerOverlapLine({
      asset: 'Gold',
      ticker: goldTicker,
      decision: 'YES',
      trades: [trade({ entry_path: 'spike_fade' })],
      now,
      closeUtc,
      minutesElapsed: 4,
      lastMinuteAdmin: true,
      lastMinuteOn: true,
      lastMinuteAssets: ['Gold'],
      spikeFadeAdmin: true,
      spikeFadeOn: true,
      spikeFadeAssets: ['Gold'],
      pairLockAdmin: true,
      pairLockOn: true,
      pairLockAssets: ['Gold'],
    });
    expect(line).toBe(
      'spike fade is holding this ticket — Last-minute and Pair lock sit out'
    );
  });

  test('after a dump, window owner still names who sits out', () => {
    const now = new Date('2026-09-12T20:14:00.000Z');
    const closeUtc = new Date(now.getTime() + 80 * 1000);
    const line = formatTickerOverlapLine({
      asset: 'Gold',
      ticker: goldTicker,
      decision: 'YES',
      trades: [trade({ entry_path: 'spike_fade', outcome: 'exited' })],
      now,
      closeUtc,
      minutesElapsed: 12,
      lastMinuteAdmin: true,
      lastMinuteOn: true,
      lastMinuteAssets: ['Gold'],
      spikeFadeAdmin: true,
      spikeFadeOn: true,
      spikeFadeAssets: ['Gold'],
      pairLockAdmin: true,
      pairLockOn: true,
      pairLockAssets: ['Gold'],
    });
    expect(line).toBe('Spike fade already filled this window — Last-minute sits out');
  });

  test('TWAP lock owns BTC without listing every path', () => {
    const line = formatTickerOverlapLine({
      asset: 'BTC',
      ticker: 'KXBTC15M-X',
      decision: 'YES',
      trades: [],
      twapAdmin: true,
      twapOn: true,
      twapAssets: ['BTC', 'ETH'],
      lastMinuteAdmin: true,
      lastMinuteOn: true,
      lastMinuteAssets: ['BTC'],
      closeUtc: new Date(Date.now() + 80 * 1000),
      now: new Date(),
    });
    expect(line).toBe('TWAP lock owns BTC');
  });

  test('Last-minute owns new buys names the other 1s paths', () => {
    const now = new Date('2026-09-12T20:14:00.000Z');
    const closeUtc = new Date(now.getTime() + 80 * 1000);
    const line = formatTickerOverlapLine({
      asset: 'Gold',
      ticker: goldTicker,
      decision: 'YES',
      trades: [],
      now,
      closeUtc,
      minutesElapsed: 12,
      lastMinuteAdmin: true,
      lastMinuteOn: true,
      lastMinuteAssets: ['Gold'],
      pairLockAdmin: true,
      pairLockOn: true,
      pairLockAssets: ['Gold'],
      pairLockStartMinutes: 2,
      pairLockUntilMinutes: 14,
    });
    expect(line).toBe('Last-minute owns new buys — Pair lock sits out');
  });

  test('no overlap line when only one path is on', () => {
    expect(
      formatTickerOverlapLine({
        asset: 'Gold',
        ticker: goldTicker,
        trades: [],
        lastMinuteAdmin: true,
        lastMinuteOn: true,
        lastMinuteAssets: ['Gold'],
        closeUtc: new Date(Date.now() + 80 * 1000),
        now: new Date(),
      })
    ).toBeNull();
  });

  test('Sell row keeps placed @ instead of Home is holding', () => {
    expect(
      lastSignalExtraLine({
        manualKind: 'sell',
        autoTradeOn: false,
        autoDetail: 'placed YES · 5 @ $0.55',
        autoStatus: 'placed',
        decision: 'NO',
        isOpen: true,
        noMarket: false,
        overlapText: 'Home is holding this ticket',
      })
    ).toEqual({
      testID: 'trade-action',
      text: 'placed YES · 5 @ $0.55',
      placed: true,
    });
  });

  test('overlapText wins on Last signals', () => {
    expect(
      lastSignalExtraLine({
        manualKind: 'none',
        autoTradeOn: true,
        decision: 'YES',
        isOpen: true,
        noMarket: false,
        spikeFadeHolding: true,
        lastMinuteWatchText: 'Last-minute watching · 80s left',
        overlapText: 'Spike fade already filled this window — Last-minute sits out',
      })
    ).toEqual({
      testID: 'skip-reason',
      text: 'Spike fade already filled this window — Last-minute sits out',
    });
  });

  test('Settings note lists shared chips and stays quiet when none overlap', () => {
    expect(
      formatSharedChipOverlapNote([
        { title: 'Last-minute', assets: ['Gold', 'ETH'] },
        { title: 'Spike fade', assets: ['Gold'] },
      ])
    ).toBe('Gold is also on Last-minute and Spike fade. First fill this window uses the slot.');
    expect(
      formatSharedChipOverlapNote([
        { title: 'Last-minute', assets: ['Gold'] },
        { title: 'Spike fade', assets: ['ETH'] },
      ])
    ).toBeNull();
  });

  test('Cloud window-cap skip names the path that used the slot', () => {
    expect(
      skipReasonForWindowCap(
        [{ market_ticker: goldTicker, fill_count: 2, outcome: 'pending', entry_path: 'spike_fade' }],
        goldTicker
      )
    ).toBe('window_used_by_spike_fade');
  });
});

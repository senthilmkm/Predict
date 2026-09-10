import { heldOpenFillForTicker, lastSignalManualKind } from '../src/screens/lastSignalsManual';

describe('last signals manual kind', () => {
  const yesRow = {
    asset: 'BTC',
    decision: 'YES',
    isOpen: true,
    noMarket: false,
    marketTicker: 'KXBTC15M-X',
  };

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

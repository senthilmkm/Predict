import React from 'react';
import { render, cleanup } from './test-utils';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../../src/platform/storage';
import { resetRuntimeStoreForTests, useRuntimeStore } from '../../src/state/runtimeStore';
import { PathTradesScreen } from '../../src/screens/PathTradesScreen';

beforeEach(() => {
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());
  resetRuntimeStoreForTests();
});

afterEach(() => cleanup());

describe('PathTradesScreen', () => {
  test('lists only that path’s fills', async () => {
    useRuntimeStore.setState({
      trades: [
        {
          id: 'a1',
          at: '2026-09-18T12:00:00.000Z',
          asset: 'BTC',
          market_ticker: 'KXBTC15M-X',
          side: 'YES',
          notional_usd: 5,
          fill_count: 5,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'auto',
          pnl_usd: 0.2,
        },
        {
          id: 'h1',
          at: '2026-09-18T11:00:00.000Z',
          asset: 'ETH',
          market_ticker: 'KXETH15M-X',
          side: 'NO',
          notional_usd: 4,
          fill_count: 4,
          outcome: 'win',
          dry_run: false,
          entry_path: 'home',
          pnl_usd: 1.1,
        },
      ],
    });
    const s = await render(<PathTradesScreen focus="auto" />);
    expect(s.getByTestId('path-trades-count').props.children.join('')).toMatch(/1 Cushion lean trade/);
    expect(s.getByTestId('path-trade-row-a1')).toBeTruthy();
    expect(s.queryByTestId('path-trade-row-h1')).toBeNull();
  });

  test('shared shows empty copy', async () => {
    const s = await render(<PathTradesScreen focus="shared" />);
    expect(s.getByTestId('path-trades-empty').props.children).toMatch(/Shared limits/);
  });
});

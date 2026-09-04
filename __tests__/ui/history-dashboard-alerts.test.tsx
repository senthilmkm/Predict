import React from 'react';
import { fireEvent, render, waitFor, cleanup } from './test-utils';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../../src/platform/storage';
import { useConfigStore } from '../../src/state/configStore';
import { resetRuntimeStoreForTests, useRuntimeStore } from '../../src/state/runtimeStore';
import { defaultAppConfig } from '../../src/config/types';
import { HistoryScreen } from '../../src/screens/HistoryScreen';
import { DashboardScreen } from '../../src/screens/DashboardScreen';
import { AlertsHubScreen } from '../../src/screens/AlertsHubScreen';

beforeEach(() => {
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());
  resetRuntimeStoreForTests();
  useConfigStore.setState({ config: defaultAppConfig(), hydrated: true });
});

afterEach(() => cleanup());

describe('History / Dashboard / AlertsHub', () => {
  test('History segments and filters', async () => {
    const s = await render(<HistoryScreen />);
    expect(s.getByTestId('screen-history')).toBeTruthy();
    expect(s.getByTestId('history-trade-filters')).toBeTruthy();
    await fireEvent.press(s.getByTestId('filter-pending'));
    await fireEvent.press(s.getByTestId('seg-alerts'));
    expect(s.getByTestId('history-alert-filters')).toBeTruthy();
    await fireEvent.press(s.getByTestId('filter-lean_signal'));
    await fireEvent.press(s.getByTestId('filter-order_placed'));
    await fireEvent.press(s.getByTestId('seg-trades'));
  });

  test('Dashboard root', async () => {
    const s = await render(<DashboardScreen />);
    expect(s.getByTestId('screen-dashboard')).toBeTruthy();
  });

  test('Dashboard shows seeded stats / counts', async () => {
    useRuntimeStore.setState({
      stats: {
        wins: 1,
        losses: 2,
        pending: 3,
        misses: 4,
        dry_runs: 0,
        realized_pnl_usd: 5.25,
        win_rate: 0.5,
      },
      alerts: [
        {
          id: 'al1',
          at: '2026-09-03T10:00:00.000Z',
          kind: 'lean_signal',
          title: 't1',
          body: 'b1',
          read: false,
        },
        {
          id: 'al2',
          at: '2026-09-03T10:01:00.000Z',
          kind: 'order_placed',
          title: 't2',
          body: 'b2',
          read: true,
        },
      ],
      unread: 1,
      trades: [
        {
          id: 'tr1',
          at: '2026-09-03T10:05:00.000Z',
          asset: 'BTC',
          market_ticker: 'KXBTC15M-TEST',
          side: 'YES',
          notional_usd: 12.34,
          outcome: 'pending',
          dry_run: false,
        } as any,
      ],
    });

    const s = await render(<DashboardScreen />);

    expect(s.getByText('Today (ET)')).toBeTruthy();
    expect(s.getByText('50%')).toBeTruthy();
    expect(s.getByText('$5.25')).toBeTruthy();
    expect(s.getByText('1W / 2L')).toBeTruthy();
    expect(s.getByText('3')).toBeTruthy(); // pending fills
    expect(s.getByText('4')).toBeTruthy(); // IOC misses
    expect(s.getByText('2')).toBeTruthy(); // alerts logged
    expect(s.getByText('1')).toBeTruthy(); // unread
    expect(s.getByText(/Latest trade: BTC pending/i)).toBeTruthy();
  });

  test('AlertsHub mute matrix collapsible + recent list', async () => {
    const s = await render(<AlertsHubScreen />);
    expect(s.getByTestId('screen-alerts-hub')).toBeTruthy();
    expect(s.getByTestId('alerts-recent-list')).toBeTruthy();
    expect(s.queryByTestId('alert-push-lean_signal')).toBeNull();
    await fireEvent.press(s.getByTestId('btn-toggle-mute-matrix'));
    await fireEvent(s.getByTestId('alert-push-lean_signal'), 'valueChange', false);
    expect(useConfigStore.getState().config.alert_prefs.lean_signal.push).toBe(false);
    await fireEvent.press(s.getByTestId('btn-mark-all-read'));
  });

  test('Mark all read shows spinner then clears unread', async () => {
    const rt = useRuntimeStore.getState().ensure();
    rt.alerts.insert({
      id: 'u1',
      at: new Date().toISOString(),
      kind: 'lean_signal',
      title: 'Gold YES',
      body: 'gap',
      read: false,
    });
    rt.alerts.insert({
      id: 'u2',
      at: new Date().toISOString(),
      kind: 'order_placed',
      title: 'BTC',
      body: 'placed',
      read: false,
    });
    useRuntimeStore.getState().syncFromRuntime();
    expect(useRuntimeStore.getState().unread).toBe(2);

    const s = await render(<AlertsHubScreen />);
    expect(s.getByText(/Unread:\s*2/)).toBeTruthy();

    await fireEvent.press(s.getByTestId('btn-mark-all-read'));
    await waitFor(() => expect(s.getByTestId('mark-all-read-spinner')).toBeTruthy());
    await waitFor(() => expect(useRuntimeStore.getState().unread).toBe(0));
    await waitFor(() => expect(s.queryByTestId('mark-all-read-spinner')).toBeNull());
    expect(s.getByText('Mark all read')).toBeTruthy();
  });

  test('AlertsHub Recent: select all + confirm bulk delete', async () => {
    const alerts = [
      {
        id: 'a1',
        at: '2026-09-03T10:00:00.000Z',
        kind: 'lean_signal',
        title: 't1',
        body: 'b1',
        read: false,
      },
      {
        id: 'a2',
        at: '2026-09-03T10:01:00.000Z',
        kind: 'order_placed',
        title: 't2',
        body: 'b2',
        read: true,
      },
    ];

    const mockDelete = jest.fn(async (ids: string[]) => ids.length);
    useRuntimeStore.setState({
      alerts,
      unread: 1,
      deleteAlertsByIds: mockDelete,
    });

    const s = await render(<AlertsHubScreen />);

    // No selection initially.
    expect(s.queryByTestId('btn-delete-selected-alerts')).toBeNull();

    await fireEvent.press(s.getByTestId('btn-select-all-alerts'));
    expect(s.getByTestId('btn-delete-selected-alerts')).toBeTruthy();

    await fireEvent.press(s.getByTestId('btn-delete-selected-alerts'));
    expect(s.getByTestId('modal-delete-alerts')).toBeTruthy();

    await fireEvent.press(s.getByTestId('btn-confirm-delete-alerts'));

    const calledWith = mockDelete.mock.calls[0][0] as string[];
    expect(calledWith.sort()).toEqual(['a1', 'a2']);
  });
});

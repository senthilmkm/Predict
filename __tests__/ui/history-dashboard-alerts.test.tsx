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
  test('History trade status dot logic (favorable green, border yellow, unfavorable red)', async () => {
    useRuntimeStore.setState({
      refreshCloudSnapshot: async () => {},
      trades: [
        {
          id: 't-win',
          at: '2026-09-03T10:00:00.000Z',
          asset: 'BTC',
          market_ticker: 'KXBTC15M-TEST',
          side: 'YES',
          notional_usd: 10,
          outcome: 'win',
          dry_run: false,
        } as any,
        {
          id: 't-pending-green',
          at: '2026-09-03T10:00:00.000Z',
          asset: 'BTC',
          market_ticker: 'KXBTC15M-TEST',
          side: 'YES',
          notional_usd: 10,
          outcome: 'pending',
          dry_run: false,
        } as any,
      ],
      leans: {
        BTC: {
          asset: 'BTC',
          market_ticker: 'KXBTC15M-TEST',
          decision: 'YES',
          live: 65200,
          strike: 65000,
          abs_gap: 200,
          minutes_left: 10,
          phase: 'live',
          ok: true,
        },
      },
    });

    const s = await render(<HistoryScreen />);
    expect(s.getByTestId('trade-status-dot-t-win-green')).toBeTruthy();
    expect(s.getByTestId('trade-status-dot-t-pending-green-green')).toBeTruthy();
  });

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
    expect(s.getByText('Change (24h)')).toBeTruthy();
    expect(s.getByText('Collecting…')).toBeTruthy();
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
      change24hUsd: 1.18,
      change24hPct: 0.84,
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

    expect(s.getByText('Predict trades today (ET)')).toBeTruthy();
    expect(s.getByText('50%')).toBeTruthy();
    expect(s.getByText('$5.25')).toBeTruthy();
    expect(s.getByText('+$1.18 (+0.84%)')).toBeTruthy();
    expect(s.getByText('Change (24h)')).toBeTruthy();
    expect(s.queryByText(/collecting/i)).toBeNull();
    expect(s.getByText('1W / 2L')).toBeTruthy();
    expect(s.getByText('3')).toBeTruthy(); // pending fills
    expect(s.getByText('4')).toBeTruthy(); // IOC misses
    expect(s.getByText('2')).toBeTruthy(); // alerts logged
    expect(s.getByText('1')).toBeTruthy(); // unread
    expect(s.getByText(/Latest trade: BTC pending/i)).toBeTruthy();
  });

  test('Dashboard Kalshi card uses a shorter window label until 24h exists', async () => {
    useRuntimeStore.setState({
      change24hUsd: 1.18,
      change24hPct: 0.84,
      change24hWindowMs: 4 * 60 * 60 * 1000,
    });
    const s = await render(<DashboardScreen />);
    expect(s.getByText('+$1.18 (+0.84%)')).toBeTruthy();
    expect(s.getByText('Change (4h)')).toBeTruthy();
    expect(s.queryByText('Collecting…')).toBeNull();
  });

  test('AlertsHub mute matrix collapsible + mute all icon toggle + recent list', async () => {
    const s = await render(<AlertsHubScreen />);
    expect(s.getByTestId('screen-alerts-hub')).toBeTruthy();
    expect(s.getByTestId('alerts-recent-list')).toBeTruthy();
    expect(s.getByTestId('btn-toggle-mute-all')).toBeTruthy();

    // Test mute all icon button
    await fireEvent.press(s.getByTestId('btn-toggle-mute-all'));
    expect(useConfigStore.getState().config.alert_prefs.lean_signal.push).toBe(false);
    expect(useConfigStore.getState().config.alert_prefs.order_placed.push).toBe(false);

    // Test unmute all icon button
    await fireEvent.press(s.getByTestId('btn-toggle-mute-all'));
    expect(useConfigStore.getState().config.alert_prefs.lean_signal.push).toBe(true);
    expect(useConfigStore.getState().config.alert_prefs.order_placed.push).toBe(true);

    expect(s.queryByTestId('alert-push-lean_signal')).toBeNull();
    await fireEvent.press(s.getByTestId('btn-toggle-mute-matrix'));
    await fireEvent(s.getByTestId('alert-push-lean_signal'), 'valueChange', false);
    expect(useConfigStore.getState().config.alert_prefs.lean_signal.push).toBe(false);
  });

  test('History Alerts tab then Trades clears unread; Trades-only does not', async () => {
    const rt = useRuntimeStore.getState().ensure();
    rt.alerts.insert({
      id: 'u-hist',
      at: new Date().toISOString(),
      kind: 'order_filled',
      title: 'Order Placed · Gold YES',
      body: '1 ctr',
      read: false,
    });
    useRuntimeStore.getState().syncFromRuntime();
    expect(useRuntimeStore.getState().unread).toBe(1);

    const s = await render(<HistoryScreen />);
    expect(useRuntimeStore.getState().unread).toBe(1);

    await fireEvent.press(s.getByTestId('seg-alerts'));
    expect(useRuntimeStore.getState().unread).toBe(1);

    await fireEvent.press(s.getByTestId('seg-trades'));
    await waitFor(() => expect(useRuntimeStore.getState().unread).toBe(0));
  });

  test('AlertsHub Recent: select all + confirm bulk delete', async () => {
    const rt = useRuntimeStore.getState().ensure();
    rt.alerts.insert({
      id: 'a1',
      at: '2026-09-03T10:00:00.000Z',
      kind: 'lean_signal',
      title: 't1',
      body: 'b1',
      read: false,
    });
    rt.alerts.insert({
      id: 'a2',
      at: '2026-09-03T10:01:00.000Z',
      kind: 'order_placed',
      title: 't2',
      body: 'b2',
      read: true,
    });
    const mockDelete = jest.fn(async (ids: string[]) => ids.length);
    useRuntimeStore.getState().syncFromRuntime();
    useRuntimeStore.setState({
      deleteAlertsByIds: mockDelete,
      refreshCloudSnapshot: async () => {},
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

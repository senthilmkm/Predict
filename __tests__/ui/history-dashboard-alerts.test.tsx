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
    expect(s.getByTestId('trade-status-dot-t-pending-green-green')).toBeTruthy();
    expect(s.queryByTestId('trade-status-dot-t-win-green')).toBeNull();
    await fireEvent.press(s.getByTestId('trade-filter-status'));
    await fireEvent.press(s.getByTestId('trade-filter-status-option-all'));
    expect(s.getByTestId('trade-status-dot-t-win-green')).toBeTruthy();
    expect(s.getByTestId('trade-status-dot-t-pending-green-green')).toBeTruthy();
  });

  test('History segments and filters', async () => {
    const s = await render(<HistoryScreen />);
    expect(s.getByTestId('screen-history')).toBeTruthy();
    expect(s.getByTestId('history-trade-filters')).toBeTruthy();
    expect(s.getByTestId('trade-filter-status')).toBeTruthy();
    expect(s.getByText('Pending ▾')).toBeTruthy();
    await fireEvent.press(s.getByTestId('trade-filter-status'));
    expect(s.getByTestId('trade-filter-status-option-pending')).toBeTruthy();
    await fireEvent.press(s.getByTestId('trade-filter-status-option-pending'));
    await fireEvent.press(s.getByTestId('seg-alerts'));
    expect(s.getByTestId('history-alert-filters')).toBeTruthy();
    await fireEvent.press(s.getByTestId('filter-lean_signal'));
    await fireEvent.press(s.getByTestId('filter-order_placed'));
    await fireEvent.press(s.getByTestId('seg-trades'));
  });

  test('History trade dropdowns AND status, side, and asset', async () => {
    useRuntimeStore.setState({
      refreshCloudSnapshot: async () => {},
      trades: [
        {
          id: 'p-btc',
          at: '2026-09-03T10:00:00.000Z',
          asset: 'BTC',
          market_ticker: 'KXBTC15M-TEST',
          side: 'YES',
          notional_usd: 10,
          outcome: 'pending',
          dry_run: false,
        } as any,
        {
          id: 'p-gold',
          at: '2026-09-03T10:00:00.000Z',
          asset: 'Gold',
          market_ticker: 'KXGOLD15M-TEST',
          side: 'NO',
          notional_usd: 8,
          outcome: 'pending',
          dry_run: false,
        } as any,
        {
          id: 'w-btc',
          at: '2026-09-03T10:00:00.000Z',
          asset: 'BTC',
          market_ticker: 'KXBTC15M-WIN',
          side: 'YES',
          notional_usd: 10,
          outcome: 'win',
          dry_run: false,
        } as any,
      ],
    });

    const s = await render(<HistoryScreen />);
    expect(s.getByTestId('trade-row-p-btc')).toBeTruthy();
    expect(s.getByTestId('trade-row-p-gold')).toBeTruthy();
    expect(s.queryByTestId('trade-row-w-btc')).toBeNull();
    expect(s.getByText(/2 of 3/)).toBeTruthy();

    await fireEvent.press(s.getByTestId('trade-filter-side'));
    await fireEvent.press(s.getByTestId('trade-filter-side-option-YES'));
    expect(s.getByTestId('trade-row-p-btc')).toBeTruthy();
    expect(s.queryByTestId('trade-row-p-gold')).toBeNull();

    await fireEvent.press(s.getByTestId('trade-filter-asset'));
    await fireEvent.press(s.getByTestId('trade-filter-asset-option-Gold'));
    expect(s.queryByTestId('trade-row-p-btc')).toBeNull();
    expect(s.queryByTestId('trade-row-p-gold')).toBeNull();
    expect(s.getByText('No matching trades')).toBeTruthy();

    await fireEvent.press(s.getByTestId('trade-filter-status'));
    await fireEvent.press(s.getByTestId('trade-filter-status-option-all'));
    await fireEvent.press(s.getByTestId('trade-filter-side'));
    await fireEvent.press(s.getByTestId('trade-filter-side-option-all'));
    await fireEvent.press(s.getByTestId('trade-filter-asset'));
    await fireEvent.press(s.getByTestId('trade-filter-asset-option-all'));
    expect(s.getByTestId('trade-row-p-btc')).toBeTruthy();
    expect(s.getByTestId('trade-row-p-gold')).toBeTruthy();
    expect(s.getByTestId('trade-row-w-btc')).toBeTruthy();
  });

  test('History keeps last trades if Cloud snapshot fails', async () => {
    useRuntimeStore.setState({
      refreshCloudSnapshot: async () => {
        throw new Error('firestore_unavailable');
      },
      trades: [
        {
          id: 'keep-me',
          at: '2026-09-03T10:00:00.000Z',
          asset: 'BTC',
          market_ticker: 'KXBTC15M-TEST',
          side: 'YES',
          notional_usd: 10,
          outcome: 'pending',
          dry_run: false,
        } as any,
      ],
    });
    const s = await render(<HistoryScreen />);
    expect(s.getByTestId('trade-row-keep-me')).toBeTruthy();
    s.unmount();
    useRuntimeStore.setState({ refreshCloudSnapshot: async () => {} });
  });

  test('History shows Home/Auto chip and fill price, and omits chip when path is missing', async () => {
    useRuntimeStore.setState({
      refreshCloudSnapshot: async () => {},
      trades: [
        {
          id: 'home-fill',
          at: '2026-09-10T14:00:00.000Z',
          asset: 'BTC',
          market_ticker: 'KXBTC15M-TEST',
          side: 'YES',
          notional_usd: 4.6,
          fill_count: 5,
          fill_price: 0.55,
          pnl_usd: 0.4,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'home',
        },
        {
          id: 'auto-fill',
          at: '2026-09-10T14:01:00.000Z',
          asset: 'ETH',
          market_ticker: 'KXETH15M-TEST',
          side: 'NO',
          notional_usd: 2.2,
          fill_count: 4,
          fill_price: 0.55,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'auto',
        },
        {
          id: 'legacy-fill',
          at: '2026-09-10T14:02:00.000Z',
          asset: 'Gold',
          market_ticker: 'KXGOLD15M-TEST',
          side: 'YES',
          notional_usd: 1,
          fill_count: 2,
          outcome: 'pending',
          dry_run: false,
        },
      ] as any,
    });
    const s = await render(<HistoryScreen />);
    expect(s.getByTestId('trade-path-home-fill').props.children).toBe('Home');
    expect(s.getByTestId('trade-path-auto-fill').props.children).toBe('Auto');
    expect(s.queryByTestId('trade-path-legacy-fill')).toBeNull();
    expect(s.getByText('KXBTC15M-TEST · 5 ctr @ $0.55 · cost $4.60 · P&L $0.40')).toBeTruthy();
    expect(s.queryByText(/Manual/)).toBeNull();
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
    expect(s.queryByTestId('dashboard-asset-pnl')).toBeNull();
    expect(s.queryByTestId('dashboard-trades-paths')).toBeNull();
  });

  test('Dashboard Trades card adds Home / Auto fill counts', async () => {
    const today = new Date().toISOString();
    useRuntimeStore.setState({
      stats: {
        wins: 8,
        losses: 3,
        pending: 0,
        misses: 0,
        dry_runs: 0,
        realized_pnl_usd: 1,
        win_rate: 8 / 11,
      },
      trades: [
        {
          id: 'h1',
          at: today,
          asset: 'BTC',
          market_ticker: 'KXBTC15M-A',
          side: 'YES',
          notional_usd: 2,
          fill_count: 4,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'home',
        },
        {
          id: 'h2',
          at: today,
          asset: 'Gold',
          market_ticker: 'KXGOLD15M-A',
          side: 'YES',
          notional_usd: 2,
          fill_count: 2,
          outcome: 'win',
          dry_run: false,
          entry_path: 'home',
        },
        {
          id: 'h3',
          at: today,
          asset: 'BTC',
          market_ticker: 'KXBTC15M-B',
          side: 'NO',
          notional_usd: 2,
          fill_count: 2,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'home',
        },
        {
          id: 'a1',
          at: today,
          asset: 'ETH',
          market_ticker: 'KXETH15M-A',
          side: 'YES',
          notional_usd: 1,
          fill_count: 2,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'auto',
        },
        {
          id: 'a2',
          at: today,
          asset: 'ETH',
          market_ticker: 'KXETH15M-B',
          side: 'YES',
          notional_usd: 1,
          fill_count: 2,
          outcome: 'win',
          dry_run: false,
          entry_path: 'auto',
        },
        {
          id: 'a3',
          at: today,
          asset: 'WTI',
          market_ticker: 'KXWTI15M-A',
          side: 'YES',
          notional_usd: 1,
          fill_count: 2,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'auto',
        },
        {
          id: 'a4',
          at: today,
          asset: 'Silver',
          market_ticker: 'KXSLVR15M-A',
          side: 'YES',
          notional_usd: 1,
          fill_count: 2,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'auto',
        },
        {
          id: 'a5',
          at: today,
          asset: 'COPPER',
          market_ticker: 'KXHG15M-A',
          side: 'YES',
          notional_usd: 1,
          fill_count: 2,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'auto',
        },
      ] as any,
    });
    const s = await render(<DashboardScreen />);
    expect(s.getByText('8W / 3L')).toBeTruthy();
    expect(s.getByTestId('dashboard-trades-paths').props.children).toBe('Home 3 · Auto 5');
  });

  test('Dashboard by-asset card uses pay price and matches Closed P&L', async () => {
    useRuntimeStore.setState({
      stats: {
        wins: 3,
        losses: 4,
        pending: 0,
        misses: 1,
        dry_runs: 0,
        realized_pnl_usd: -13.37,
        win_rate: 3 / 7,
      },
      assetPnlToday: {
        rows: [
          {
            asset: 'Silver',
            wins: 3,
            losses: 4,
            realized_pnl_usd: -13.37,
            winPayMin: 0.92,
            winPayMax: 0.92,
            lossPayMin: 0.85,
            lossPayMax: 0.92,
          },
          {
            asset: 'BTC',
            wins: 12,
            losses: 0,
            realized_pnl_usd: 7.34,
            winPayMin: 0.73,
            winPayMax: 0.95,
            lossPayMin: null,
            lossPayMax: null,
          },
        ],
        wins: 15,
        losses: 4,
        realized_pnl_usd: -6.03,
        winPnlAvg: 0.47,
        lossPnlAvg: -3.84,
        lossPayMin: 0.85,
        lossPayMax: 0.92,
      },
    });
    const s = await render(<DashboardScreen />);
    expect(s.getByTestId('dashboard-asset-pnl')).toBeTruthy();
    expect(s.getByTestId('dashboard-asset-pnl-Silver')).toBeTruthy();
    expect(s.getByText('Silver')).toBeTruthy();
    expect(s.getByTestId('dashboard-asset-pnl-Silver')).toBeTruthy();
    expect(s.getAllByText('3W / 4L').length).toBeGreaterThan(0);
    expect(s.getByText('-$13.37')).toBeTruthy();
    expect(s.getByText('Won at 92¢ · Lost at 85–92¢')).toBeTruthy();
    expect(s.getByText('+$7.34')).toBeTruthy();
    expect(s.getByTestId('dashboard-asset-pnl-footer').props.children).toContain(
      'Losing tickets cost 85–92¢'
    );
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

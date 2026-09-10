import React from 'react';
import { AppState } from 'react-native';
import { fireEvent, render, waitFor, cleanup } from './test-utils';
import { cancelScheduledPersist } from '../../src/storage/configPersistence';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../../src/platform/storage';
import { useConfigStore } from '../../src/state/configStore';
import { resetRuntimeStoreForTests, useRuntimeStore } from '../../src/state/runtimeStore';
import { defaultAppConfig } from '../../src/config/types';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { heldOpenFillForTicker } from '../../src/screens/lastSignalsManual';

beforeEach(() => {
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());
  resetRuntimeStoreForTests();
  useConfigStore.setState({ config: defaultAppConfig(), hydrated: true });
});

afterEach(() => {
  cancelScheduledPersist();
  cleanup();
});

describe('HomeScreen', () => {
  test('renders brand and controls', async () => {
    const s = await render(<HomeScreen />);
    expect(s.getByTestId('screen-home')).toBeTruthy();
    expect(s.getByTestId('home-brand')).toBeTruthy();
    expect(s.getByText('Predict')).toBeTruthy();
    expect(s.getByTestId('home-predictions-card')).toBeTruthy();
    expect(s.getByTestId('home-cash-block')).toBeTruthy();
    expect(s.getByText('PREDICTIONS')).toBeTruthy();
    expect(s.getByTestId('home-change-24h-label').props.children).toMatch(/Change \(24h\)/);
    expect(s.getByTestId('home-change-24h').props.children).toBe('Collecting…');
    expect(s.getByTestId('home-today-trades')).toBeTruthy();
    expect(s.getByText('Predict trades today')).toBeTruthy();
    expect(s.queryByTestId('home-today-path-buys')).toBeNull();
    expect(s.getByText('Cash')).toBeTruthy();
    expect(s.getByTestId('home-heartbeat')).toBeTruthy();
    expect(s.queryByTestId('btn-kill-switch')).toBeNull();
    expect(s.queryByTestId('btn-toggle-dev-tools')).toBeNull();
    expect(s.queryByTestId('btn-toggle-poller')).toBeNull();
    expect(s.queryByTestId('btn-tick-once')).toBeNull();
    expect(s.getByTestId('support-contact')).toBeTruthy();
    expect(s.getByText(/senthil930@gmail\.com/)).toBeTruthy();
  });

  test('Predictions change shows a dollar value and a shorter window until 24h exists', async () => {
    useRuntimeStore.setState({
      refreshPredictionsBalance: async () => {},
      refreshCloudSnapshot: async () => {},
      change24hUsd: 1.18,
      change24hPct: 0.84,
      change24hWindowMs: 4 * 60 * 60 * 1000,
    });
    const s = await render(<HomeScreen />);
    expect(s.getByTestId('home-change-24h').props.children).toBe('+$1.18 (+0.84%)');
    expect(s.getByTestId('home-change-24h-label').props.children).toBe('Change (4h)');
  });

  test('integration error banner includes support email from config.json', async () => {
    const rt = useRuntimeStore.getState().ensure();
    rt.status.lastError = 'Kalshi auth failed';
    useRuntimeStore.getState().syncFromRuntime();
    const s = await render(<HomeScreen />);
    await waitFor(() => expect(s.getByTestId('home-integration-error')).toBeTruthy());
    expect(s.getByTestId('home-error-support-email')).toBeTruthy();
    expect(s.getAllByText(/senthil930@gmail\.com/).length).toBeGreaterThanOrEqual(1);
  });

  test('auto-trade on explains Cloud Run places orders', async () => {
    useConfigStore.setState({
      config: {
        ...defaultAppConfig(),
        auto_trade_enabled: true,
        execution_mode: 'live',
        live_armed: true,
      },
      hydrated: true,
    });
    const s = await render(<HomeScreen />);
    expect(s.getByText(/places now on Cloud Run/i)).toBeTruthy();
    expect(s.getByText(/this phone never talks to Kalshi/i)).toBeTruthy();
  });

  test('SKIP lean on an open market shows below cushion', async () => {
    useConfigStore.setState({
      config: {
        ...defaultAppConfig(),
        assets_enabled: { BTC: true } as any,
      },
      hydrated: true,
    });
    useRuntimeStore.setState({
      refreshPredictionsBalance: async () => {},
      refreshCloudSnapshot: async () => {},
      leans: {
        BTC: {
          asset: 'BTC',
          market_ticker: 'KXBTC15M-X',
          decision: 'SKIP',
          live: 100,
          strike: 99,
          abs_gap: 1,
          minutes_left: 8,
          phase: 'live',
        },
      } as any,
      leanAt: { BTC: new Date().toISOString() },
    });
    const s = await render(<HomeScreen />);
    expect(s.getByTestId('signal-decision-BTC').props.children).toBe('SKIP');
    expect(s.getByTestId('skip-reason-BTC').props.children).toBe('below cushion');
    expect(s.queryByTestId('signal-time-BTC')).toBeNull();
  });

  test('YES with Auto skip does not show that skip next to Buy', async () => {
    useConfigStore.setState({
      config: {
        ...defaultAppConfig(),
        auto_trade_enabled: true,
        execution_mode: 'live',
        live_armed: true,
        assets_enabled: { BTC: true } as any,
        manual_risk: {
          ...defaultAppConfig().manual_risk,
          max_entry_ask_usd: 0.99,
          min_minutes_elapsed: 0,
          min_minutes_left: 0,
        },
      },
      hydrated: true,
    });
    useRuntimeStore.setState({
      refreshPredictionsBalance: async () => {},
      refreshCloudSnapshot: async () => {},
      lastSignalsManualTrade: true,
      leans: {
        BTC: {
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
        },
      } as any,
      leanAt: { BTC: new Date().toISOString() },
      tradeActions: {
        BTC: {
          status: 'skipped',
          detail: 'skipped · ask too rich',
          at: new Date().toISOString(),
        },
      },
    });
    const s = await render(<HomeScreen />);
    expect(s.getByTestId('signal-decision-BTC').props.children).toBe('YES');
    expect(s.getByTestId('btn-manual-buy-BTC')).toBeTruthy();
    expect(s.queryByTestId('trade-action-BTC')).toBeNull();
    expect(s.queryByTestId('skip-reason-BTC')).toBeNull();
  });

  test('YES with Home Buy skip shows that skip next to Buy, not Auto-trade', async () => {
    useConfigStore.setState({
      config: {
        ...defaultAppConfig(),
        auto_trade_enabled: true,
        execution_mode: 'live',
        live_armed: true,
        assets_enabled: { BTC: true } as any,
        manual_risk: {
          ...defaultAppConfig().manual_risk,
          max_entry_ask_usd: 0.5,
          min_minutes_elapsed: 0,
          min_minutes_left: 0,
        },
      },
      hydrated: true,
    });
    useRuntimeStore.setState({
      refreshPredictionsBalance: async () => {},
      refreshCloudSnapshot: async () => {},
      lastSignalsManualTrade: true,
      leans: {
        BTC: {
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
        },
      } as any,
      leanAt: { BTC: new Date().toISOString() },
      tradeActions: {
        BTC: {
          status: 'skipped',
          detail: 'skipped · too early in window',
          at: new Date().toISOString(),
        },
      },
    });
    const s = await render(<HomeScreen />);
    expect(s.getByTestId('btn-manual-buy-BTC')).toBeTruthy();
    expect(s.getByTestId('skip-reason-BTC').props.children).toBe('ask too rich');
    expect(s.queryByTestId('trade-action-BTC')).toBeNull();
  });

  test('heartbeat stays Live when Cloud ticked recently even if the phone poller clock is 40m old', async () => {
    const rt = useRuntimeStore.getState().ensure();
    rt.status.running = true;
    rt.status.lastTickAt = new Date(Date.now() - 2441 * 1000).toISOString();
    rt.status.lastPulseAt = rt.status.lastTickAt;
    rt.status.cloudLastTickAt = new Date().toISOString();
    useRuntimeStore.getState().syncFromRuntime();
    useConfigStore.setState({
      config: { ...defaultAppConfig(), auto_trade_enabled: true, poll_interval_seconds: 20 },
    });
    const s = await render(<HomeScreen />);
    expect(s.getByText(/Live · cloud 20s/)).toBeTruthy();
    expect(s.queryByText(/Stale · cloud/)).toBeNull();
    const lastTickLabel = String(s.getByTestId('home-last-tick').props.children);
    expect(lastTickLabel).toMatch(/Last tick /);
    expect(lastTickLabel).not.toMatch(/40m ago/);
    expect(lastTickLabel).toMatch(/\d+s ago/);
  });

  test('returning to the foreground refreshes Predictions and Cash', async () => {
    const refreshPredictionsBalance = jest.fn(async () => {});
    const refreshCloudSnapshot = jest.fn(async () => {});
    const listeners: Array<(state: string) => void> = [];
    const addSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
      listeners.push(cb as (state: string) => void);
      return { remove: jest.fn() } as any;
    });
    try {
      useRuntimeStore.setState({ refreshPredictionsBalance, refreshCloudSnapshot });
      await render(<HomeScreen />);
      refreshPredictionsBalance.mockClear();
      refreshCloudSnapshot.mockClear();
      listeners.forEach((cb) => cb('active'));
      expect(refreshPredictionsBalance).toHaveBeenCalled();
      expect(refreshCloudSnapshot).toHaveBeenCalled();
    } finally {
      addSpy.mockRestore();
    }
  });

  test('broadcast banner renders Cloud message', async () => {
    useRuntimeStore.setState({
      refreshPredictionsBalance: async () => {},
      refreshCloudSnapshot: async () => {},
      activeBroadcast: { id: 'system_maintenance', title: 'System maintenance', message: 'Down for a bit.' },
    });
    const s = await render(<HomeScreen />);
    expect(s.getByTestId('home-broadcast-banner')).toBeTruthy();
    expect(s.getByText('Down for a bit.')).toBeTruthy();
  });

  test('YES row shows Buy YES', async () => {
    useConfigStore.setState({
      config: { ...defaultAppConfig(), assets_enabled: { BTC: true } as any },
      hydrated: true,
    });
    useRuntimeStore.setState({
      refreshPredictionsBalance: async () => {},
      refreshCloudSnapshot: async () => {},
      lastSignalsManualTrade: true,
      cloudKillSwitch: false,
      leans: {
        BTC: {
          asset: 'BTC',
          market_ticker: 'KXBTC15M-X',
          decision: 'YES',
          live: 200,
          strike: 100,
          abs_gap: 100,
          minutes_left: 8,
          phase: 'live',
        },
      } as any,
      leanAt: { BTC: new Date().toISOString() },
    });
    const on = await render(<HomeScreen />);
    expect(on.getByTestId('btn-manual-buy-BTC')).toBeTruthy();
    expect(on.getByText('Buy YES')).toBeTruthy();
    expect(on.getByTestId('home-ready-to-buy-label')).toBeTruthy();
  });

  test('feature flag off hides Buy YES', async () => {
    useConfigStore.setState({
      config: { ...defaultAppConfig(), assets_enabled: { BTC: true } as any },
      hydrated: true,
    });
    useRuntimeStore.setState({
      refreshPredictionsBalance: async () => {},
      refreshCloudSnapshot: async () => {},
      lastSignalsManualTrade: false,
      cloudKillSwitch: false,
      leans: {
        BTC: {
          asset: 'BTC',
          market_ticker: 'KXBTC15M-X',
          decision: 'YES',
          live: 200,
          strike: 100,
          abs_gap: 100,
          minutes_left: 8,
          phase: 'live',
        },
      } as any,
      leanAt: { BTC: new Date().toISOString() },
    });
    const off = await render(<HomeScreen />);
    expect(off.queryByTestId('btn-manual-buy-BTC')).toBeNull();
  });

  test('held fill shows Sell YES not Buy', async () => {
    useConfigStore.setState({
      config: { ...defaultAppConfig(), assets_enabled: { BTC: true } as any },
      hydrated: true,
    });
    useRuntimeStore.setState({
      refreshPredictionsBalance: async () => {},
      refreshCloudSnapshot: async () => {},
      lastSignalsManualTrade: true,
      cloudKillSwitch: false,
      leans: {
        BTC: {
          asset: 'BTC',
          market_ticker: 'KXBTC15M-X',
          decision: 'NO',
          live: 90,
          strike: 100,
          abs_gap: 10,
          minutes_left: 8,
          phase: 'live',
        },
      } as any,
      leanAt: { BTC: new Date().toISOString() },
      trades: [
        {
          id: 't1',
          at: new Date().toISOString(),
          asset: 'BTC',
          market_ticker: 'KXBTC15M-X',
          side: 'YES',
          notional_usd: 5,
          fill_count: 4,
          outcome: 'pending',
          dry_run: false,
        },
      ],
    });
    expect(useRuntimeStore.getState().lastSignalsManualTrade).toBe(true);
    expect(heldOpenFillForTicker(useRuntimeStore.getState().trades, 'KXBTC15M-X')?.side).toBe('YES');
    const s = await render(<HomeScreen />);
    await waitFor(() => expect(s.getByTestId('btn-manual-sell-BTC')).toBeTruthy());
    expect(s.getByText('Sell YES')).toBeTruthy();
    expect(s.queryByTestId('btn-manual-buy-BTC')).toBeNull();
    expect(s.queryByTestId('trade-action-BTC')).toBeNull();
  });

  test('path-buy strip shows Home / Auto fills and Sell row keeps placed @', async () => {
    useConfigStore.setState({
      config: { ...defaultAppConfig(), assets_enabled: { BTC: true, Gold: true, ETH: true } as any },
      hydrated: true,
    });
    const today = new Date().toISOString();
    useRuntimeStore.setState({
      refreshPredictionsBalance: async () => {},
      refreshCloudSnapshot: async () => {},
      lastSignalsManualTrade: true,
      cloudKillSwitch: false,
      stats: {
        wins: 1,
        losses: 0,
        pending: 2,
        misses: 0,
        dry_runs: 0,
        realized_pnl_usd: 0.4,
        win_rate: 1,
      },
      leans: {
        BTC: {
          asset: 'BTC',
          market_ticker: 'KXBTC15M-X',
          decision: 'NO',
          live: 90,
          strike: 100,
          abs_gap: 10,
          minutes_left: 8,
          phase: 'live',
        },
      } as any,
      leanAt: { BTC: today },
      tradeActions: {
        BTC: {
          status: 'placed',
          detail: 'placed YES · 5 @ $0.55',
          at: today,
        },
      },
      trades: [
        {
          id: 'h-btc-1',
          at: today,
          asset: 'BTC',
          market_ticker: 'KXBTC15M-X',
          side: 'YES',
          notional_usd: 2.75,
          fill_count: 5,
          fill_price: 0.55,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'home',
        },
        {
          id: 'h-btc-2',
          at: today,
          asset: 'BTC',
          market_ticker: 'KXBTC15M-Y',
          side: 'YES',
          notional_usd: 2.75,
          fill_count: 5,
          fill_price: 0.55,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'home',
        },
        {
          id: 'h-gold',
          at: today,
          asset: 'Gold',
          market_ticker: 'KXGOLD15M-X',
          side: 'YES',
          notional_usd: 1,
          fill_count: 2,
          fill_price: 0.5,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'home',
        },
        {
          id: 'a-eth',
          at: today,
          asset: 'ETH',
          market_ticker: 'KXETH15M-X',
          side: 'NO',
          notional_usd: 1,
          fill_count: 2,
          fill_price: 0.5,
          outcome: 'pending',
          dry_run: false,
          entry_path: 'auto',
        },
        {
          id: 'miss',
          at: today,
          asset: 'WTI',
          market_ticker: 'KXWTI15M-X',
          side: 'YES',
          notional_usd: 0,
          fill_count: 0,
          outcome: 'miss',
          dry_run: false,
          entry_path: 'home',
        },
      ],
    });
    const s = await render(<HomeScreen />);
    expect(s.getByTestId('home-today-path-buys-home').props.children).toBe('Home  BTC 2 · Gold 1');
    expect(s.getByTestId('home-today-path-buys-auto').props.children).toBe('Auto  ETH 1');
    expect(s.queryByText(/Manual/i)).toBeNull();
    await waitFor(() => expect(s.getByTestId('btn-manual-sell-BTC')).toBeTruthy());
    expect(s.getByTestId('trade-action-BTC').props.children).toBe('placed YES · 5 @ $0.55');
  });

  test('manual buy error shows a popup', async () => {
    const Alert = require('react-native').Alert;
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { cloudClient } = require('../../src/services/cloud/cloudClient');
    const placeSpy = jest.spyOn(cloudClient, 'placeManualOrder').mockResolvedValue({
      ok: false,
      error: 'below_cushion',
      message: 'below cushion',
    });
    try {
      useConfigStore.setState({
        config: { ...defaultAppConfig(), assets_enabled: { BTC: true } as any },
        hydrated: true,
      });
      useRuntimeStore.setState({
        refreshPredictionsBalance: async () => {},
        refreshCloudSnapshot: async () => {},
        lastSignalsManualTrade: true,
        leans: {
          BTC: {
            asset: 'BTC',
            market_ticker: 'KXBTC15M-X',
            decision: 'YES',
            live: 200,
            strike: 100,
            abs_gap: 100,
            minutes_left: 8,
            phase: 'live',
          },
        } as any,
        leanAt: { BTC: new Date().toISOString() },
      });
      const s = await render(<HomeScreen />);
      await waitFor(() => expect(s.getByTestId('btn-manual-buy-BTC')).toBeTruthy());
      await fireEvent.press(s.getByTestId('btn-manual-buy-BTC'));
      await waitFor(() => expect(spy).toHaveBeenCalled());
      expect(String(spy.mock.calls[0][0])).toMatch(/Could not place order/i);
      expect(String(spy.mock.calls[0][1])).toMatch(/below cushion/i);
    } finally {
      spy.mockRestore();
      placeSpy.mockRestore();
    }
  });

  test('manual buy success flies a gold message instead of a popup', async () => {
    const Alert = require('react-native').Alert;
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { cloudClient } = require('../../src/services/cloud/cloudClient');
    const placeSpy = jest.spyOn(cloudClient, 'placeManualOrder').mockResolvedValue({
      ok: true,
      filled: true,
      message: 'Bought YES · 8 contracts',
      tradeId: 't1',
    });
    try {
      useConfigStore.setState({
        config: { ...defaultAppConfig(), assets_enabled: { BTC: true } as any },
        hydrated: true,
      });
      useRuntimeStore.setState({
        refreshPredictionsBalance: async () => {},
        refreshCloudSnapshot: async () => {},
        lastSignalsManualTrade: true,
        cloudKillSwitch: false,
        leans: {
          BTC: {
            asset: 'BTC',
            market_ticker: 'KXBTC15M-X',
            decision: 'YES',
            live: 200,
            strike: 100,
            abs_gap: 100,
            minutes_left: 8,
            phase: 'live',
          },
        } as any,
        leanAt: { BTC: new Date().toISOString() },
      });
      const s = await render(<HomeScreen />);
      await waitFor(() => expect(s.getByTestId('btn-manual-buy-BTC')).toBeTruthy());
      await fireEvent.press(s.getByTestId('btn-manual-buy-BTC'));
      await waitFor(() => expect(s.getByTestId('manual-success-fly')).toBeTruthy());
      expect(s.getByTestId('manual-success-fly-text').props.children).toBe('BTC buy success');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      placeSpy.mockRestore();
    }
  });
});

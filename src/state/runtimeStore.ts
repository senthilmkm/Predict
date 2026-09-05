import { create } from 'zustand';
import { AppRuntime, getAppRuntime, resetAppRuntimeForTests, LastTradeAction } from '../runtime/AppRuntime';
import { useConfigStore } from './configStore';
import { DashboardStats, TradeRecord, AlertRecord, statsFromCloudTrades } from '../storage/repos';
import { PredictCloudClient } from '../services/cloud/cloudClient';
import { LeanResult } from '../services/lean/lean';
import { AssetKey } from '../config/types';

const EMPTY_STATS: DashboardStats = {
  wins: 0,
  losses: 0,
  pending: 0,
  misses: 0,
  dry_runs: 0,
  realized_pnl_usd: 0,
  win_rate: null,
};

interface RuntimeState {
  runtime: AppRuntime | null;
  bump: number;
  status: AppRuntime['status'] | null;
  stats: DashboardStats;
  trades: TradeRecord[];
  alerts: AlertRecord[];
  unread: number;
  leans: Partial<Record<AssetKey, LeanResult>>;
  leanAt: Partial<Record<AssetKey, string>>;
  tradeActions: Partial<Record<AssetKey, LastTradeAction>>;
  assetErrors: Partial<Record<AssetKey, string>>;
  predictionsBalanceUsd: number | null;
  cashBalanceUsd: number | null;
  ensure: () => AppRuntime;
  syncFromRuntime: () => void;
  start: () => void;
  stop: () => void;
  tickOnce: () => Promise<void>;
  kill: () => void;
  refresh: () => void;
  refreshPredictionsBalance: () => Promise<void>;
  refreshCashBalance: () => Promise<void>;
  markAllRead: () => void;
  pruneAlerts: () => number;
  deleteAlertsByIds: (ids: string[]) => Promise<number>;
  refreshCloudSnapshot: () => Promise<void>;
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  runtime: null,
  bump: 0,
  status: null,
  stats: EMPTY_STATS,
  trades: [],
  alerts: [],
  unread: 0,
  leans: {},
  leanAt: {},
  tradeActions: {},
  assetErrors: {},
  predictionsBalanceUsd: null,
  cashBalanceUsd: null,
  ensure: () => {
    let rt = get().runtime;
    if (!rt) {
      rt = getAppRuntime(
        () => useConfigStore.getState().snapshot(),
        () => get().syncFromRuntime()
      );
      set({ runtime: rt });
      get().syncFromRuntime();
    }
    return rt;
  },
  syncFromRuntime: () => {
    const rt = get().runtime;
    if (!rt) {
      set({
        bump: get().bump + 1,
        status: null,
        stats: EMPTY_STATS,
        trades: [],
        alerts: [],
        unread: 0,
        leans: {},
        leanAt: {},
        tradeActions: {},
        assetErrors: {},
        predictionsBalanceUsd: null,
        cashBalanceUsd: null,
      });
      return;
    }
    set({
      bump: get().bump + 1,
      status: {
        ...rt.status,
        lastLeans: { ...rt.status.lastLeans },
        lastLeanAt: { ...rt.status.lastLeanAt },
        lastTradeAction: { ...rt.status.lastTradeAction },
        assetErrors: { ...rt.status.assetErrors },
      },
      stats: rt.trades.statsToday(),
      trades: rt.trades.list(100),
      alerts: rt.alerts.list(500),
      unread: rt.alerts.unreadCount(),
      leans: { ...rt.status.lastLeans },
      leanAt: { ...rt.status.lastLeanAt },
      tradeActions: { ...rt.status.lastTradeAction },
      assetErrors: { ...rt.status.assetErrors },
      predictionsBalanceUsd: rt.status.predictionsBalanceUsd,
      cashBalanceUsd: rt.status.cashBalanceUsd,
    });
  },
  start: () => {
    const sec = useConfigStore.getState().config.poll_interval_seconds || 20;
    get().ensure().start(Math.max(10, sec) * 1000);
    get().syncFromRuntime();
  },
  stop: () => {
    get().runtime?.stop();
    get().syncFromRuntime();
  },
  tickOnce: async () => {
    await get().ensure().tick();
    get().syncFromRuntime();
  },
  kill: () => {
    const rt = get().ensure();
    rt.kill();
    useConfigStore.getState().killSwitchDisarm();
    get().syncFromRuntime();
  },
  refresh: () => get().syncFromRuntime(),
  refreshPredictionsBalance: async () => {
    await get().ensure().refreshPredictionsBalance();
    get().syncFromRuntime();
  },
  refreshCashBalance: async () => {
    await get().ensure().refreshCashBalance();
    get().syncFromRuntime();
  },
  markAllRead: () => {
    get().runtime?.alerts.markAllRead();
    get().syncFromRuntime();
  },
  pruneAlerts: () => {
    const rt = get().ensure();
    const removed = rt.pruneAlertsNow();
    get().syncFromRuntime();
    return removed;
  },
  deleteAlertsByIds: async (ids) => {
    const rt = get().ensure();
    const removed = await rt.deleteAlertsByIds(ids);
    get().syncFromRuntime();
    return removed;
  },
  refreshCloudSnapshot: async () => {
    try {
      const client = new PredictCloudClient(async () => null);
      const [tradesRes, statusRes] = await Promise.all([
        client.getTrades(),
        client.getStatus(),
      ]);
      if (tradesRes.ok && Array.isArray(tradesRes.trades)) {
        const stats = statsFromCloudTrades(tradesRes.trades);
        set({ stats });
      }
      if (statusRes.ok && statusRes.systemConfig?.tick_interval_seconds) {
        const seconds = statusRes.systemConfig.tick_interval_seconds;
        useConfigStore.setState((s) => ({
          config: {
            ...s.config,
            poll_interval_seconds: seconds,
          },
        }));
      }
    } catch {
      /* Keep local stats on network error */
    }
  },
}));

export function resetRuntimeStoreForTests() {
  resetAppRuntimeForTests();
  useRuntimeStore.setState({
    runtime: null,
    bump: 0,
    status: null,
    stats: EMPTY_STATS,
    trades: [],
    alerts: [],
    unread: 0,
    leans: {},
    leanAt: {},
    tradeActions: {},
    assetErrors: {},
    predictionsBalanceUsd: null,
    cashBalanceUsd: null,
  });
}

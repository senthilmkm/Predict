import { create } from 'zustand';
import { AppRuntime, getAppRuntime, resetAppRuntimeForTests, LastTradeAction } from '../runtime/AppRuntime';
import { useConfigStore } from './configStore';
import { DashboardStats, TradeRecord, AlertRecord } from '../storage/repos';
import { AssetPnlToday, EMPTY_ASSET_PNL_TODAY, summarizeAssetPnlToday } from '../storage/assetPnlToday';
import { PredictCloudClient, cloudClient, ActiveBroadcast } from '../services/cloud/cloudClient';
import { getUserDisplayName } from '../services/userId';
import { LeanResult } from '../services/lean/lean';
import { updateAppBadgeCount } from '../services/notifications';
import { AssetKey } from '../config/types';

/** Drop overlapping Home/History refreshes — last writer must not apply a stale response. */
let cloudSnapshotGen = 0;
let cloudSnapshotInFlight: Promise<void> | null = null;
let cloudSnapshotQueued = false;

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
  assetPnlToday: AssetPnlToday;
  trades: TradeRecord[];
  alerts: AlertRecord[];
  unread: number;
  leans: Partial<Record<AssetKey, LeanResult>>;
  leanAt: Partial<Record<AssetKey, string>>;
  tradeActions: Partial<Record<AssetKey, LastTradeAction>>;
  assetErrors: Partial<Record<AssetKey, string>>;
  predictionsBalanceUsd: number | null;
  cashBalanceUsd: number | null;
  change24hUsd: number | null;
  change24hPct: number | null;
  change24hWindowMs: number | null;
  lastSignalsManualTrade: boolean;
  cashOutFeatureOn: boolean;
  goldFadeFeatureOn: boolean;
  twapLockFeatureOn: boolean;
  lastMinuteFeatureOn: boolean;
  stepBuyFeatureOn: boolean;
  spikeFadeFeatureOn: boolean;
  pairLockFeatureOn: boolean;
  activeBroadcast: ActiveBroadcast | null;
  cloudKillSwitch: boolean;
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
  assetPnlToday: EMPTY_ASSET_PNL_TODAY,
  trades: [],
  alerts: [],
  unread: 0,
  leans: {},
  leanAt: {},
  tradeActions: {},
  assetErrors: {},
  predictionsBalanceUsd: null,
  cashBalanceUsd: null,
  change24hUsd: null,
  change24hPct: null,
  change24hWindowMs: null,
  lastSignalsManualTrade: true,
  cashOutFeatureOn: false,
  goldFadeFeatureOn: false,
  twapLockFeatureOn: false,
  lastMinuteFeatureOn: false,
  stepBuyFeatureOn: false,
  spikeFadeFeatureOn: false,
  pairLockFeatureOn: false,
  activeBroadcast: null,
  cloudKillSwitch: false,
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
        assetPnlToday: EMPTY_ASSET_PNL_TODAY,
        trades: [],
        alerts: [],
        unread: 0,
        leans: {},
        leanAt: {},
        tradeActions: {},
        assetErrors: {},
        predictionsBalanceUsd: null,
        cashBalanceUsd: null,
        change24hUsd: null,
        change24hPct: null,
        change24hWindowMs: null,
        lastSignalsManualTrade: get().lastSignalsManualTrade,
        cashOutFeatureOn: get().cashOutFeatureOn,
        goldFadeFeatureOn: get().goldFadeFeatureOn,
        twapLockFeatureOn: get().twapLockFeatureOn,
        lastMinuteFeatureOn: get().lastMinuteFeatureOn,
        stepBuyFeatureOn: get().stepBuyFeatureOn,
        spikeFadeFeatureOn: get().spikeFadeFeatureOn,
        pairLockFeatureOn: get().pairLockFeatureOn,
        activeBroadcast: get().activeBroadcast,
        cloudKillSwitch: get().cloudKillSwitch,
      });
      return;
    }
    const unreadCount = rt.alerts.unreadCount();
    void updateAppBadgeCount(unreadCount);

    const localStats = rt.trades.statsToday();
    const hasHydratedTrades = rt.trades.list(1).length > 0;
    const currentStats = get().stats;
    const currentTotal = currentStats.wins + currentStats.losses + currentStats.pending + currentStats.misses;
    // Never keep yesterday's snapshot after hydrate — empty today must show zeros.
    const statsToUse = hasHydratedTrades || currentTotal === 0 ? localStats : currentStats;

    set({
      bump: get().bump + 1,
      status: {
        ...rt.status,
        lastLeans: { ...rt.status.lastLeans },
        lastLeanAt: { ...rt.status.lastLeanAt },
        lastTradeAction: { ...rt.status.lastTradeAction },
        assetErrors: { ...rt.status.assetErrors },
      },
      stats: statsToUse,
      assetPnlToday: summarizeAssetPnlToday(rt.trades.all()),
      trades: rt.trades.list(100),
      alerts: rt.alerts.list(500),
      unread: unreadCount,
      leans: { ...rt.status.lastLeans },
      leanAt: { ...rt.status.lastLeanAt },
      tradeActions: { ...rt.status.lastTradeAction },
      assetErrors: { ...rt.status.assetErrors },
      predictionsBalanceUsd: rt.status.predictionsBalanceUsd,
      cashBalanceUsd: rt.status.cashBalanceUsd,
      change24hUsd: rt.status.change24hUsd,
      change24hPct: rt.status.change24hPct,
      change24hWindowMs: rt.status.change24hWindowMs,
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
  markAllRead: async () => {
    const rt = get().ensure();
    await rt.markAllRead();
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
    if (cloudSnapshotInFlight) {
      cloudSnapshotQueued = true;
      return cloudSnapshotInFlight;
    }
    const gen = ++cloudSnapshotGen;
    cloudSnapshotInFlight = (async () => {
      try {
        const [tradesRes, statusRes, alertsRes] = await Promise.all([
          cloudClient.getTrades(),
          cloudClient.getStatus(),
          cloudClient.getAlerts(),
        ]);
        if (gen !== cloudSnapshotGen) return;

        if (statusRes.ok && statusRes.systemConfig?.tick_interval_seconds) {
          const seconds = statusRes.systemConfig.tick_interval_seconds;
          if (useConfigStore.getState().config.poll_interval_seconds !== seconds) {
            useConfigStore.getState().setPollIntervalSeconds(seconds);
          }
        }

        const localConfig = useConfigStore.getState().config;
        const displayName = await getUserDisplayName();
        if (statusRes.userDoc?.state !== 'KILL_SWITCH') {
          void cloudClient.updateStatus(
            localConfig.auto_trade_enabled,
            localConfig.auto_trade_enabled ? 'ARMED' : 'DISARMED',
            localConfig,
            displayName
          );
        }

        const cloudTrades = tradesRes.ok && Array.isArray(tradesRes.trades) ? tradesRes.trades : [];
        const cloudAlerts = alertsRes.ok && Array.isArray(alertsRes.alerts) ? alertsRes.alerts : [];
        if (gen !== cloudSnapshotGen) return;

        const rt = get().ensure();
        if (statusRes.ok && statusRes.systemConfig) {
          rt.applyKalshiRetryPolicy(statusRes.systemConfig.kalshiRetry);
        }
        if (cloudTrades.length > 0) rt.syncCloudTrades(cloudTrades);
        if (alertsRes.ok) {
          rt.syncCloudAlerts(cloudAlerts);
          await rt.catchUpAlertsInboxAfterCloudSync();
        }
        if (statusRes.ok) {
          rt.syncCloudTradeActions(statusRes.userDoc?.lastTradeAction);
          rt.syncCloudHeartbeat(statusRes.userDoc?.lastTickAt, statusRes.systemConfig?.last_worker_tick_at);
          set({
            lastSignalsManualTrade: statusRes.systemConfig?.featureFlags?.lastSignalsManualTrade !== false,
            cashOutFeatureOn: statusRes.systemConfig?.featureFlags?.cashOut === true,
            goldFadeFeatureOn: statusRes.systemConfig?.featureFlags?.goldFade === true,
            twapLockFeatureOn: statusRes.systemConfig?.featureFlags?.twapLock === true,
            lastMinuteFeatureOn: statusRes.systemConfig?.featureFlags?.lastMinute === true,
            stepBuyFeatureOn: statusRes.systemConfig?.featureFlags?.stepBuy === true,
            spikeFadeFeatureOn: statusRes.systemConfig?.featureFlags?.spikeFade === true,
            pairLockFeatureOn: statusRes.systemConfig?.featureFlags?.pairLock === true,
            activeBroadcast: statusRes.activeBroadcast ?? null,
            cloudKillSwitch: statusRes.userDoc?.state === 'KILL_SWITCH',
          });
        }
        if (gen !== cloudSnapshotGen) return;
        get().syncFromRuntime();
      } catch {
        /* Keep local stats on network error */
      }
    })().finally(() => {
      if (gen !== cloudSnapshotGen) return;
      cloudSnapshotInFlight = null;
      if (cloudSnapshotQueued) {
        cloudSnapshotQueued = false;
        void get().refreshCloudSnapshot();
      }
    });
    return cloudSnapshotInFlight;
  },
}));

export function resetRuntimeStoreForTests() {
  cloudSnapshotGen += 1;
  cloudSnapshotInFlight = null;
  cloudSnapshotQueued = false;
  resetAppRuntimeForTests();
  useRuntimeStore.setState({
    runtime: null,
    bump: 0,
    status: null,
    stats: EMPTY_STATS,
    assetPnlToday: EMPTY_ASSET_PNL_TODAY,
    trades: [],
    alerts: [],
    unread: 0,
    leans: {},
    leanAt: {},
    tradeActions: {},
    assetErrors: {},
    predictionsBalanceUsd: null,
    cashBalanceUsd: null,
    change24hUsd: null,
    change24hPct: null,
    change24hWindowMs: null,
    lastSignalsManualTrade: true,
    cashOutFeatureOn: false,
    goldFadeFeatureOn: false,
    twapLockFeatureOn: false,
    lastMinuteFeatureOn: false,
    stepBuyFeatureOn: false,
    spikeFadeFeatureOn: false,
  pairLockFeatureOn: false,
    activeBroadcast: null,
    cloudKillSwitch: false,
  });
}

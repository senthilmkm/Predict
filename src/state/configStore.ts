import { create } from 'zustand';
import {
  AppConfig,
  AssetKey,
  AlertKind,
  ManualPathRisk,
  RiskConfig,
  defaultAppConfig,
  POLL_INTERVAL_DEFAULT_SEC,
} from '../config/types';
import {
  clampCushion,
  clampPollIntervalSeconds,
  clampAlertRetentionDays,
  normalizeAppConfig,
  normalizeRiskConfig,
  snapshotConfig,
} from '../config/normalize';
import { cloneDefaultRisk } from '../config/riskDefaults';
import { normalizeManualPathRisk } from '../../packages/trading-core/src/pathRisk';
import { loadPersistedConfig, savePersistedConfig, schedulePersistConfig } from '../storage/configPersistence';
import {
  ensureRiskDefaultsOnDevice,
  resetRiskDefaultsFile,
} from '../storage/riskDefaultsPersistence';
import { authenticateForSecrets, hasCredentials } from '../services/credentials';

interface ConfigState {
  config: AppConfig;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setConfig: (partial: Partial<AppConfig>) => void;
  setCushion: (asset: AssetKey, value: number) => void;
  setAssetEnabled: (asset: AssetKey, enabled: boolean) => void;
  setAlertPref: (kind: AlertKind, pref: { enabled?: boolean; push?: boolean }) => void;
  setPollIntervalSeconds: (seconds: number) => void;
  setAlertRetentionDays: (days: number) => void;
  setRiskField: <K extends keyof RiskConfig>(key: K, value: RiskConfig[K]) => void;
  setManualRiskField: <K extends keyof ManualPathRisk>(key: K, value: ManualPathRisk[K]) => void;
  restoreRiskDefaults: () => Promise<void>;
  restoreSharedRiskLimits: () => Promise<void>;
  restoreAutoRiskTab: () => Promise<void>;
  restoreHomeBuyRiskTab: () => Promise<void>;
  setAutoTrade: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  killSwitchDisarm: () => void;
  resetDefaults: () => void;
  snapshot: () => AppConfig;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: defaultAppConfig(),
  hydrated: false,
  hydrate: async () => {
    await ensureRiskDefaultsOnDevice();
    const cfg = await loadPersistedConfig();
    set({ config: cfg, hydrated: true });
  },
  setConfig: (partial) => {
    const config = normalizeAppConfig({ ...get().config, ...partial });
    set({ config });
    schedulePersistConfig(config);
  },
  setCushion: (asset, value) => {
    const config = {
      ...get().config,
      cushions: {
        ...get().config.cushions,
        [asset]: clampCushion(asset, value),
      },
    };
    set({ config });
    schedulePersistConfig(config);
  },
  setAssetEnabled: (asset, enabled) => {
    const config = {
      ...get().config,
      assets_enabled: { ...get().config.assets_enabled, [asset]: enabled },
    };
    set({ config });
    schedulePersistConfig(config);
  },
  setAlertPref: (kind, pref) => {
    const prev = get().config.alert_prefs[kind];
    const config = {
      ...get().config,
      alert_prefs: {
        ...get().config.alert_prefs,
        [kind]: {
          enabled: pref.enabled ?? prev.enabled,
          push: pref.push ?? prev.push,
        },
      },
    };
    set({ config });
    schedulePersistConfig(config);
  },
  setPollIntervalSeconds: (seconds) => {
    const config = normalizeAppConfig({
      ...get().config,
      poll_interval_seconds: clampPollIntervalSeconds(seconds),
    });
    set({ config });
    schedulePersistConfig(config);
    try {
      const { useRuntimeStore } = require('./runtimeStore');
      const rt = useRuntimeStore.getState();
      if (rt.status?.running) {
        rt.start();
      }
    } catch {
      /* ignore circular import in tests */
    }
  },
  setAlertRetentionDays: (days) => {
    const config = normalizeAppConfig({
      ...get().config,
      alert_retention_days: clampAlertRetentionDays(days),
    });
    set({ config });
    schedulePersistConfig(config);
  },
  setRiskField: (key, value) => {
    const config = normalizeAppConfig({
      ...get().config,
      risk: normalizeRiskConfig({ ...get().config.risk, [key]: value }),
    });
    set({ config });
    schedulePersistConfig(config);
  },
  setManualRiskField: (key, value) => {
    const prev = get().config;
    const manual = normalizeManualPathRisk({ ...prev.manual_risk, [key]: value }, prev.risk);
    const config = normalizeAppConfig({
      ...prev,
      manual_risk: manual,
      risk: { ...prev.risk, manual_buy_time_in_force: manual.time_in_force },
    });
    set({ config });
    schedulePersistConfig(config);
  },
  restoreRiskDefaults: async () => {
    const defaults = await resetRiskDefaultsFile();
    const config = normalizeAppConfig({
      ...get().config,
      risk: defaults,
      manual_risk: undefined,
    });
    set({ config });
    void savePersistedConfig(config);
  },
  restoreSharedRiskLimits: async () => {
    const defaults = cloneDefaultRisk();
    const prev = get().config.risk;
    const config = normalizeAppConfig({
      ...get().config,
      risk: {
        ...prev,
        max_open_positions: defaults.max_open_positions,
        max_trades_per_day: defaults.max_trades_per_day,
        max_trades_per_asset_per_window: defaults.max_trades_per_asset_per_window,
        daily_loss_stop_usd: defaults.daily_loss_stop_usd,
      },
    });
    set({ config });
    void savePersistedConfig(config);
  },
  restoreAutoRiskTab: async () => {
    const defaults = cloneDefaultRisk();
    const prev = get().config.risk;
    const config = normalizeAppConfig({
      ...get().config,
      risk: {
        ...defaults,
        max_open_positions: prev.max_open_positions,
        max_trades_per_day: prev.max_trades_per_day,
        max_trades_per_asset_per_window: prev.max_trades_per_asset_per_window,
        daily_loss_stop_usd: prev.daily_loss_stop_usd,
        manual_buy_time_in_force: prev.manual_buy_time_in_force,
      },
    });
    set({ config });
    void savePersistedConfig(config);
  },
  restoreHomeBuyRiskTab: async () => {
    const defaults = cloneDefaultRisk();
    const config = normalizeAppConfig({
      ...get().config,
      manual_risk: normalizeManualPathRisk(undefined, defaults),
    });
    set({ config });
    void savePersistedConfig(config);
  },
  setAutoTrade: async (enabled) => {
    if (enabled) {
      if (!(await hasCredentials())) {
        return { ok: false, error: 'Add Kalshi credentials first' };
      }
      const ok = await authenticateForSecrets('Enable auto-trading');
      if (!ok) return { ok: false, error: 'Cancelled' };
      const config = normalizeAppConfig({
        ...get().config,
        auto_trade_enabled: true,
        execution_mode: 'live',
        live_armed: true,
      });
      set({ config });
      void savePersistedConfig(config);
      return { ok: true };
    }
    const config = normalizeAppConfig({
      ...get().config,
      auto_trade_enabled: false,
      execution_mode: 'off',
      live_armed: false,
    });
    set({ config });
    void savePersistedConfig(config);
    return { ok: true };
  },
  killSwitchDisarm: () => {
    const config = normalizeAppConfig({
      ...get().config,
      auto_trade_enabled: false,
      execution_mode: 'off',
      live_armed: false,
    });
    set({ config });
    void savePersistedConfig(config);
  },
  resetDefaults: () => {
    const config = defaultAppConfig();
    set({ config });
    void savePersistedConfig(config);
  },
  snapshot: () => snapshotConfig(get().config),
}));

export { POLL_INTERVAL_DEFAULT_SEC };

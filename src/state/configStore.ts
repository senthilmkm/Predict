import { create } from 'zustand';
import {
  AppConfig,
  AssetKey,
  AlertKind,
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
  restoreRiskDefaults: () => Promise<void>;
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
  restoreRiskDefaults: async () => {
    const defaults = await resetRiskDefaultsFile();
    const config = normalizeAppConfig({
      ...get().config,
      risk: defaults,
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

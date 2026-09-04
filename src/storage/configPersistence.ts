import { AppConfig } from '../config/types';
import { normalizeAppConfig } from '../config/normalize';
import { getKeyValueStore } from '../platform/storage';
import { cloudClient } from '../services/cloud/cloudClient';

const CONFIG_KEY = 'foresight.config.v1';

export async function loadPersistedConfig(): Promise<AppConfig> {
  const raw = await getKeyValueStore().getItem(CONFIG_KEY);
  if (!raw) return normalizeAppConfig(null);
  try {
    return normalizeAppConfig(JSON.parse(raw));
  } catch {
    return normalizeAppConfig(null);
  }
}

export async function savePersistedConfig(cfg: AppConfig): Promise<void> {
  const normalized = normalizeAppConfig(cfg);
  await getKeyValueStore().setItem(CONFIG_KEY, JSON.stringify(normalized));
  if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
    void cloudClient.updateStatus(
      normalized.auto_trade_enabled,
      normalized.auto_trade_enabled ? 'ARMED' : 'DISARMED',
      normalized
    );
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePersistConfig(cfg: AppConfig, ms = 300): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  // Jest: persist immediately to avoid overlapping act() from delayed timers
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    debounceTimer = null;
    void savePersistedConfig(cfg);
    return;
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void savePersistedConfig(cfg);
  }, ms);
}

export function cancelScheduledPersist(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
}

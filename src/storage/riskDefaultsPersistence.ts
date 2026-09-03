import { RiskConfig } from '../config/types';
import { cloneDefaultRisk, DEFAULT_RISK_CONFIG } from '../config/riskDefaults';
import { normalizeRiskConfig } from '../config/normalize';
import { getKeyValueStore } from '../platform/storage';

const RISK_DEFAULTS_KEY = 'foresight.risk.defaults.v2';
const RISK_DEFAULTS_VERSION = 2;

/** Seed bundled risk defaults into phone storage (re-seeds when key/version bumps). */
export async function ensureRiskDefaultsOnDevice(): Promise<RiskConfig> {
  const store = getKeyValueStore();
  const raw = await store.getItem(RISK_DEFAULTS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Number(parsed?._v) === RISK_DEFAULTS_VERSION || parsed?.max_trades_per_day != null) {
        const { _v, ...rest } = parsed;
        return normalizeRiskConfig(rest);
      }
    } catch {
      /* fall through */
    }
  }
  const seeded = cloneDefaultRisk();
  await store.setItem(
    RISK_DEFAULTS_KEY,
    JSON.stringify({ ...seeded, _v: RISK_DEFAULTS_VERSION })
  );
  return seeded;
}

/** Read phone-local risk defaults (falls back to bundled). */
export async function loadRiskDefaultsFromDevice(): Promise<RiskConfig> {
  return ensureRiskDefaultsOnDevice();
}

/** Overwrite phone-local defaults (rarely needed). */
export async function saveRiskDefaultsToDevice(risk: RiskConfig): Promise<void> {
  const normalized = normalizeRiskConfig(risk);
  await getKeyValueStore().setItem(
    RISK_DEFAULTS_KEY,
    JSON.stringify({ ...normalized, _v: RISK_DEFAULTS_VERSION })
  );
}

/** Reset phone-local defaults back to bundled values. */
export async function resetRiskDefaultsFile(): Promise<RiskConfig> {
  const seeded = cloneDefaultRisk();
  await getKeyValueStore().setItem(
    RISK_DEFAULTS_KEY,
    JSON.stringify({ ...seeded, _v: RISK_DEFAULTS_VERSION })
  );
  return seeded;
}

export { DEFAULT_RISK_CONFIG, RISK_DEFAULTS_KEY };

/**
 * First-launch onboarding — all answers stay on-device (AsyncStorage).
 * Used for UX defaults and dispute/audit export. Never uploaded by the app.
 */
import { Platform } from 'react-native';
import { AssetKey } from '../config/types';
import {
  DISCLAIMER_LONG,
  DISCLAIMER_SHORT,
  DISCLAIMER_VERSION,
} from '../config/disclaimers';
import { getKeyValueStore } from '../platform/storage';

const RECORD_KEY = 'predict.onboarding.record.v1';
const COMPLETED_KEY = 'predict.onboarding.completed.v1';

export type OnboardingIntentMode = 'alerts_only' | 'alerts_and_autotrade';
export type OnboardingExperience = 'new' | 'some' | 'active';
export type OnboardingCapital = 'learning' | 'small' | 'serious';
export type OnboardingNotifStatus =
  | 'granted'
  | 'denied'
  | 'skipped'
  | 'unavailable';

export type OnboardingRecord = {
  id: string;
  schemaVersion: 1;
  startedAt: string;
  /** ISO time when user finished step 5 and reached paywall (or completed flow). */
  completedAt: string | null;
  /** 0-based step index currently shown (0..5). */
  currentStep: number;
  appVersion: string;
  buildNumber: string | null;
  platform: string;
  disclaimerVersion: string;
  disclaimerShort: string;
  disclaimerLong: string;
  riskUnderstoodChecked: boolean;
  riskAcceptedAt: string | null;
  intentMode: OnboardingIntentMode | null;
  assetsOfInterest: AssetKey[];
  experienceLevel: OnboardingExperience | null;
  capitalComfort: OnboardingCapital | null;
  modeChosenAt: string | null;
  notificationsStatus: OnboardingNotifStatus | null;
  notificationsAskedAt: string | null;
  kalshiCredentialsAdded: boolean;
  kalshiSkipped: boolean;
  kalshiStepAt: string | null;
  paywallReachedAt: string | null;
};

function appMeta(): { appVersion: string; buildNumber: string | null } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default;
    const expo = Constants?.expoConfig;
    if (expo?.version) {
      const appVersion = String(expo.version);
      const buildNumber =
        Platform.OS === 'ios'
          ? expo?.ios?.buildNumber != null
            ? String(expo.ios.buildNumber)
            : null
          : expo?.android?.versionCode != null
            ? String(expo.android.versionCode)
            : null;
      return { appVersion, buildNumber };
    }
  } catch {
    /* tests */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const appJson = require('../../app.json');
    const expo = appJson?.expo;
    return {
      appVersion: String(expo?.version || '1.0.0'),
      buildNumber: expo?.ios?.buildNumber != null ? String(expo.ios.buildNumber) : null,
    };
  } catch {
    return { appVersion: '1.0.0', buildNumber: null };
  }
}

function rid(): string {
  return `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyOnboardingRecord(): OnboardingRecord {
  const meta = appMeta();
  return {
    id: rid(),
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    completedAt: null,
    currentStep: 0,
    appVersion: meta.appVersion,
    buildNumber: meta.buildNumber,
    platform: Platform.OS,
    disclaimerVersion: DISCLAIMER_VERSION,
    disclaimerShort: DISCLAIMER_SHORT,
    disclaimerLong: DISCLAIMER_LONG,
    riskUnderstoodChecked: false,
    riskAcceptedAt: null,
    intentMode: null,
    assetsOfInterest: [],
    experienceLevel: null,
    capitalComfort: null,
    modeChosenAt: null,
    notificationsStatus: null,
    notificationsAskedAt: null,
    kalshiCredentialsAdded: false,
    kalshiSkipped: false,
    kalshiStepAt: null,
    paywallReachedAt: null,
  };
}

export async function loadOnboardingRecord(): Promise<OnboardingRecord | null> {
  try {
    const raw = await getKeyValueStore().getItem(RECORD_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OnboardingRecord;
  } catch {
    return null;
  }
}

export async function saveOnboardingRecord(record: OnboardingRecord): Promise<void> {
  await getKeyValueStore().setItem(RECORD_KEY, JSON.stringify(record));
}

export async function isOnboardingCompleted(): Promise<boolean> {
  try {
    const store = getKeyValueStore();
    const flag = await store.getItem(COMPLETED_KEY);
    if (flag === '1') return true;
    const rec = await loadOnboardingRecord();
    if (rec?.completedAt) return true;
    // In-progress wizard (may have already written config) — keep showing onboarding
    if (rec && !rec.completedAt) return false;

    // Legacy installs before onboarding: do not force the wizard again
    const legacyRisk = await store.getItem('predict.autotrade.risk_acceptance.latest.v1');
    const legacyConfig = await store.getItem('foresight.config.v1');
    if (legacyRisk || legacyConfig) {
      await store.setItem(COMPLETED_KEY, '1');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function markOnboardingCompleted(record: OnboardingRecord): Promise<OnboardingRecord> {
  const next: OnboardingRecord = {
    ...record,
    completedAt: record.completedAt || new Date().toISOString(),
    paywallReachedAt: record.paywallReachedAt || new Date().toISOString(),
    currentStep: 5,
  };
  await saveOnboardingRecord(next);
  await getKeyValueStore().setItem(COMPLETED_KEY, '1');
  return next;
}

/** True when onboarding risk checkbox was accepted for the current disclaimer text. */
export async function hasOnboardingRiskAcceptanceForCurrentDisclaimer(): Promise<boolean> {
  const rec = await loadOnboardingRecord();
  if (!rec?.riskUnderstoodChecked || !rec.riskAcceptedAt) return false;
  return rec.disclaimerVersion === DISCLAIMER_VERSION;
}

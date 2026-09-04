/**
 * On-device risk / disclaimer acceptance log (dispute-ready).
 * Sources: onboarding step 2, or Auto-trade enable (Face ID).
 */
import { Platform } from 'react-native';
import { getKeyValueStore } from '../platform/storage';
import { DISCLAIMER_SHORT, DISCLAIMER_VERSION } from '../config/disclaimers';
import { hasOnboardingRiskAcceptanceForCurrentDisclaimer } from './onboarding';

const LATEST_KEY = 'predict.autotrade.risk_acceptance.latest.v1';
const LOG_KEY = 'predict.autotrade.risk_acceptance.log.v1';
const LOG_MAX = 50;

export type RiskAcceptanceSource = 'onboarding' | 'autotrade_enable';

export type AutoTradeRiskAcceptance = {
  id: string;
  acceptedAt: string;
  disclaimerVersion: string;
  disclaimerShort: string;
  appVersion: string;
  buildNumber: string | null;
  platform: string;
  /** User checked “I understand”. */
  understoodChecked: true;
  /**
   * True when this row was written because Auto-trade was armed (Face ID path).
   * Onboarding rows keep this false — they still satisfy “do not re-ask disclaimer”.
   */
  autoTradeEnabled: boolean;
  source: RiskAcceptanceSource;
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
    /* tests / no native constants */
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
  return `ra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function appendAcceptance(
  partial: Omit<
    AutoTradeRiskAcceptance,
    'id' | 'acceptedAt' | 'disclaimerVersion' | 'disclaimerShort' | 'appVersion' | 'buildNumber' | 'platform' | 'understoodChecked'
  > & { understoodChecked?: true }
): Promise<AutoTradeRiskAcceptance> {
  const meta = appMeta();
  const row: AutoTradeRiskAcceptance = {
    id: rid(),
    acceptedAt: new Date().toISOString(),
    disclaimerVersion: DISCLAIMER_VERSION,
    disclaimerShort: DISCLAIMER_SHORT,
    appVersion: meta.appVersion,
    buildNumber: meta.buildNumber,
    platform: Platform.OS,
    understoodChecked: true,
    autoTradeEnabled: partial.autoTradeEnabled,
    source: partial.source,
  };

  const store = getKeyValueStore();
  await store.setItem(LATEST_KEY, JSON.stringify(row));

  let log: AutoTradeRiskAcceptance[] = [];
  try {
    const raw = await store.getItem(LOG_KEY);
    if (raw) log = JSON.parse(raw);
    if (!Array.isArray(log)) log = [];
  } catch {
    log = [];
  }
  log.unshift(row);
  if (log.length > LOG_MAX) log = log.slice(0, LOG_MAX);
  await store.setItem(LOG_KEY, JSON.stringify(log));

  return row;
}

/** Onboarding step 2 — full disclaimer understanding (does not arm Auto-trade). */
export async function recordOnboardingRiskAcceptance(): Promise<AutoTradeRiskAcceptance> {
  return appendAcceptance({ source: 'onboarding', autoTradeEnabled: false });
}

/** After Face ID when turning Auto-trade ON (audit of arming, not a second disclaimer ask). */
export async function recordAutoTradeRiskAcceptance(): Promise<AutoTradeRiskAcceptance> {
  return appendAcceptance({ source: 'autotrade_enable', autoTradeEnabled: true });
}

export async function getLatestAutoTradeRiskAcceptance(): Promise<AutoTradeRiskAcceptance | null> {
  try {
    const raw = await getKeyValueStore().getItem(LATEST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AutoTradeRiskAcceptance;
  } catch {
    return null;
  }
}

export async function listAutoTradeRiskAcceptances(): Promise<AutoTradeRiskAcceptance[]> {
  try {
    const raw = await getKeyValueStore().getItem(LOG_KEY);
    if (!raw) return [];
    const log = JSON.parse(raw);
    return Array.isArray(log) ? log : [];
  } catch {
    return [];
  }
}

/**
 * True if the user already accepted the *current* disclaimer text
 * (onboarding and/or prior risk log). Do not show the Auto-trade risk modal again.
 * If DISCLAIMER_VERSION is bumped, acceptance is required once more.
 */
export async function hasAcceptedCurrentDisclaimer(): Promise<boolean> {
  if (await hasOnboardingRiskAcceptanceForCurrentDisclaimer()) return true;
  const latest = await getLatestAutoTradeRiskAcceptance();
  if (latest?.understoodChecked && latest.disclaimerVersion === DISCLAIMER_VERSION) {
    return true;
  }
  const log = await listAutoTradeRiskAcceptances();
  return log.some(
    (r) => r.understoodChecked && r.disclaimerVersion === DISCLAIMER_VERSION
  );
}

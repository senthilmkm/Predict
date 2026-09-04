import {
  createEmptyOnboardingRecord,
  markOnboardingCompleted,
  saveOnboardingRecord,
  loadOnboardingRecord,
  isOnboardingCompleted,
} from '../src/storage/onboarding';
import {
  hasAcceptedCurrentDisclaimer,
  listAutoTradeRiskAcceptances,
  recordOnboardingRiskAcceptance,
} from '../src/storage/riskAcceptance';
import { DISCLAIMER_VERSION } from '../src/config/disclaimers';
import { MemoryKeyValueStore, getKeyValueStore, setKeyValueStore } from '../src/platform/storage';

describe('onboarding + disclaimer acceptance', () => {
  beforeEach(() => {
    setKeyValueStore(new MemoryKeyValueStore());
  });

  test('persists risk acceptance and marks completed', async () => {
    const rec = createEmptyOnboardingRecord();
    await saveOnboardingRecord(rec);
    expect(await isOnboardingCompleted()).toBe(false);

    await recordOnboardingRiskAcceptance();
    const withRisk = {
      ...rec,
      riskUnderstoodChecked: true,
      riskAcceptedAt: new Date().toISOString(),
      intentMode: 'alerts_only' as const,
      assetsOfInterest: ['Gold' as const],
    };
    await saveOnboardingRecord(withRisk);

    expect(await hasAcceptedCurrentDisclaimer()).toBe(true);
    const log = await listAutoTradeRiskAcceptances();
    expect(log[0].source).toBe('onboarding');
    expect(log[0].autoTradeEnabled).toBe(false);
    expect(log[0].disclaimerVersion).toBe(DISCLAIMER_VERSION);

    await markOnboardingCompleted(withRisk);
    expect(await isOnboardingCompleted()).toBe(true);
    const loaded = await loadOnboardingRecord();
    expect(loaded?.completedAt).toBeTruthy();
    expect(loaded?.paywallReachedAt).toBeTruthy();
  });

  test('in-progress onboarding is not treated as legacy complete', async () => {
    const rec = createEmptyOnboardingRecord();
    await saveOnboardingRecord(rec);
    // Simulate mode step writing config
    await getKeyValueStore().setItem('foresight.config.v1', '{}');
    expect(await isOnboardingCompleted()).toBe(false);
  });
});

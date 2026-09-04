import React, { useState } from 'react';
import { render, waitFor, cleanup } from './test-utils';
import { cancelScheduledPersist } from '../../src/storage/configPersistence';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../../src/platform/storage';
import { useConfigStore } from '../../src/state/configStore';
import { resetRuntimeStoreForTests } from '../../src/state/runtimeStore';
import { useSubscriptionStore } from '../../src/state/subscriptionStore';
import { defaultAppConfig } from '../../src/config/types';
import { PaywallScreen } from '../../src/screens/PaywallScreen';
import { OnboardingScreen } from '../../src/screens/OnboardingScreen';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { PostTrialNextStepsModal } from '../../src/components/PostTrialNextStepsModal';
import {
  createEmptyOnboardingRecord,
  markOnboardingCompleted,
  saveOnboardingRecord,
  isOnboardingCompleted,
} from '../../src/storage/onboarding';


/**
 * Mirrors App.tsx gates: onboarding → paywall → main (Home + post-trial sheet).
 * Keeps navigation/confusion checks without mounting native NavigationContainer.
 */
function AppGateHarness() {
  const entitled = useSubscriptionStore((s) => s.entitled || s.gatingDisabled);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [checked, setChecked] = useState(false);

  React.useEffect(() => {
    void isOnboardingCompleted().then((done) => {
      setOnboardingDone(done);
      setChecked(true);
    });
  }, []);

  if (!checked) return null;

  if (!onboardingDone) {
    return (
      <OnboardingScreen
        onFinished={() => {
          void isOnboardingCompleted().then(setOnboardingDone);
        }}
      />
    );
  }

  if (!entitled) {
    return <PaywallScreen />;
  }

  return (
    <>
      <HomeScreen />
      <PostTrialNextStepsModal onOpenSettings={() => undefined} />
    </>
  );
}

beforeEach(() => {
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());
  resetRuntimeStoreForTests();
  useConfigStore.setState({ config: defaultAppConfig(), hydrated: true });
  useSubscriptionStore.setState({
    ready: true,
    entitled: false,
    gatingDisabled: false,
    busy: false,
    error: null,
    isTrialing: false,
    productId: null,
    expirationAt: null,
    willRenew: false,
    managementUrl: null,
    sdkConfigured: true,
  });
});

afterEach(() => {
  cancelScheduledPersist();
  cleanup();
});

describe('App gate E2E (onboarding → trial → home + next steps)', () => {
  test('new user: onboarding then paywall until entitled', async () => {
    const s = await render(<AppGateHarness />);
    await waitFor(() => expect(s.getByTestId('screen-onboarding')).toBeTruthy());
    expect(s.queryByTestId('screen-home')).toBeNull();
    expect(s.queryByTestId('screen-paywall')).toBeNull();
  });

  test('after onboarding complete + trial: Home + post-trial sheet, not paywall', async () => {
    const rec = await markOnboardingCompleted({
      ...createEmptyOnboardingRecord(),
      intentMode: 'alerts_only',
      riskUnderstoodChecked: true,
      riskAcceptedAt: new Date().toISOString(),
      kalshiSkipped: true,
    });
    await saveOnboardingRecord(rec);
    useSubscriptionStore.setState({ entitled: true, isTrialing: true, ready: true });

    const s = await render(<AppGateHarness />);
    await waitFor(() => expect(s.getByTestId('screen-home')).toBeTruthy());
    expect(s.queryByTestId('screen-paywall')).toBeNull();
    expect(s.queryByTestId('screen-onboarding')).toBeNull();
    await waitFor(() => expect(s.getByTestId('modal-post-trial-next-steps')).toBeTruthy());
    expect(s.getByText(/Next: lean alerts/i)).toBeTruthy();
  });

  test('legacy entitled user without intent: Home without next-steps nag', async () => {
    const store = new MemoryKeyValueStore();
    setKeyValueStore(store);
    await store.setItem('foresight.config.v1', '{}');
    useSubscriptionStore.setState({ entitled: true, ready: true });

    const s = await render(<AppGateHarness />);
    await waitFor(() => expect(s.getByTestId('screen-home')).toBeTruthy());
    expect(s.queryByTestId('modal-post-trial-next-steps')).toBeNull();
  });
});

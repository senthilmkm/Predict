import React from 'react';
import { act, fireEvent, render, waitFor, cleanup } from './test-utils';
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
import { OnboardingScreen } from '../../src/screens/OnboardingScreen';
import {
  isOnboardingCompleted,
  loadOnboardingRecord,
} from '../../src/storage/onboarding';

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
    sdkConfigured: false,
  });
});

afterEach(() => {
  cancelScheduledPersist();
  cleanup();
});

describe('OnboardingScreen flow', () => {
  test('walks Welcome → Risk → Mode → Alerts skip → Kalshi skip → Trial', async () => {
    const onFinished = jest.fn();
    const s = await render(<OnboardingScreen onFinished={onFinished} />);

    await waitFor(() => expect(s.getByTestId('screen-onboarding')).toBeTruthy());
    expect(s.getByTestId('onboarding-step-welcome')).toBeTruthy();

    await fireEvent.press(s.getByTestId('btn-onboarding-next'));
    await waitFor(() => expect(s.getByTestId('onboarding-step-risk')).toBeTruthy());

    // Next disabled until risk accepted
    await fireEvent.press(s.getByTestId('btn-onboarding-next'));
    expect(s.getByTestId('onboarding-step-risk')).toBeTruthy();

    await fireEvent(s.getByTestId('switch-onboarding-risk'), 'valueChange', true);
    await fireEvent.press(s.getByTestId('btn-onboarding-next'));
    await waitFor(() => expect(s.getByTestId('onboarding-step-mode')).toBeTruthy());

    await fireEvent.press(s.getByTestId('chip-mode-alerts'));
    await fireEvent.press(s.getByTestId('btn-onboarding-next'));
    await waitFor(() => expect(s.getByTestId('onboarding-step-notifications')).toBeTruthy());

    await fireEvent.press(s.getByTestId('btn-onboarding-skip-notif'));
    await waitFor(() => expect(s.getByTestId('onboarding-step-kalshi')).toBeTruthy());

    await fireEvent.press(s.getByTestId('btn-onboarding-skip-kalshi'));
    await waitFor(() => expect(s.getByTestId('onboarding-paywall')).toBeTruthy());

    expect(await isOnboardingCompleted()).toBe(true);
    const rec = await loadOnboardingRecord();
    expect(rec?.intentMode).toBe('alerts_only');
    expect(rec?.kalshiSkipped).toBe(true);
    expect(useConfigStore.getState().config.auto_trade_enabled).toBe(false);
    expect(onFinished).not.toHaveBeenCalled();
  });

  test('Back works between steps without losing mode', async () => {
    const s = await render(<OnboardingScreen onFinished={jest.fn()} />);
    await waitFor(() => expect(s.getByTestId('btn-onboarding-next')).toBeTruthy());
    await fireEvent.press(s.getByTestId('btn-onboarding-next'));
    await fireEvent(s.getByTestId('switch-onboarding-risk'), 'valueChange', true);
    await fireEvent.press(s.getByTestId('btn-onboarding-next'));
    await waitFor(() => expect(s.getByTestId('chip-mode-both')).toBeTruthy());
    await fireEvent.press(s.getByTestId('chip-mode-both'));
    await fireEvent.press(s.getByTestId('btn-onboarding-next'));
    await waitFor(() => expect(s.getByTestId('onboarding-step-notifications')).toBeTruthy());
    await fireEvent.press(s.getByTestId('btn-onboarding-back'));
    await waitFor(() => expect(s.getByTestId('onboarding-step-mode')).toBeTruthy());
    const rec = await loadOnboardingRecord();
    expect(rec?.intentMode).toBe('alerts_and_autotrade');
  });

  test('trial unlock calls onFinished once entitled on paywall step', async () => {
    const onFinished = jest.fn();
    const s = await render(<OnboardingScreen onFinished={onFinished} />);
    await waitFor(() => expect(s.getByTestId('btn-onboarding-next')).toBeTruthy());
    await fireEvent.press(s.getByTestId('btn-onboarding-next'));
    await fireEvent(s.getByTestId('switch-onboarding-risk'), 'valueChange', true);
    await fireEvent.press(s.getByTestId('btn-onboarding-next'));
    await fireEvent.press(s.getByTestId('chip-mode-alerts'));
    await fireEvent.press(s.getByTestId('btn-onboarding-next'));
    await fireEvent.press(s.getByTestId('btn-onboarding-skip-notif'));
    await waitFor(() => expect(s.getByTestId('btn-onboarding-skip-kalshi')).toBeTruthy());
    await fireEvent.press(s.getByTestId('btn-onboarding-skip-kalshi'));
    await waitFor(() => expect(s.getByTestId('onboarding-paywall')).toBeTruthy());

    await act(async () => {
      useSubscriptionStore.setState({ entitled: true, ready: true });
    });
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
  });
});

import React from 'react';
import { fireEvent, render, waitFor, cleanup } from './test-utils';
import { cancelScheduledPersist } from '../../src/storage/configPersistence';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../../src/platform/storage';
import { useConfigStore } from '../../src/state/configStore';
import { resetRuntimeStoreForTests, useRuntimeStore } from '../../src/state/runtimeStore';
import { defaultAppConfig } from '../../src/config/types';
import {
  createEmptyOnboardingRecord,
  saveOnboardingRecord,
} from '../../src/storage/onboarding';
import { PostTrialNextStepsModal } from '../../src/components/PostTrialNextStepsModal';
import { isPostTrialNextStepsDismissed } from '../../src/storage/postTrialNextSteps';

beforeEach(() => {
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());
  resetRuntimeStoreForTests();
  useConfigStore.setState({ config: defaultAppConfig(), hydrated: true });
});

afterEach(() => {
  cancelScheduledPersist();
  cleanup();
});

describe('PostTrialNextStepsModal', () => {
  test('shows for alerts_only and starts poller', async () => {
    const rec = {
      ...createEmptyOnboardingRecord(),
      intentMode: 'alerts_only' as const,
      completedAt: new Date().toISOString(),
    };
    await saveOnboardingRecord(rec);

    const onOpenSettings = jest.fn();
    const s = await render(<PostTrialNextStepsModal onOpenSettings={onOpenSettings} />);

    await waitFor(() => expect(s.getByTestId('modal-post-trial-next-steps')).toBeTruthy());
    expect(s.getByTestId('post-trial-headline').props.children).toMatch(/lean alerts/i);

    await fireEvent.press(s.getByTestId('btn-post-trial-action-start_poller'));
    await waitFor(() => expect(useRuntimeStore.getState().status?.running).toBe(true));
    await waitFor(() => expect(s.queryByTestId('modal-post-trial-next-steps')).toBeNull());
    expect(await isPostTrialNextStepsDismissed()).toBe(true);
  });

  test('I will explore dismisses without starting poller', async () => {
    const rec = {
      ...createEmptyOnboardingRecord(),
      intentMode: 'alerts_and_autotrade' as const,
      completedAt: new Date().toISOString(),
    };
    await saveOnboardingRecord(rec);

    const s = await render(<PostTrialNextStepsModal onOpenSettings={jest.fn()} />);
    await waitFor(() => expect(s.getByTestId('modal-post-trial-next-steps')).toBeTruthy());
    await fireEvent.press(s.getByTestId('btn-post-trial-dismiss'));
    await waitFor(() => expect(s.queryByTestId('modal-post-trial-next-steps')).toBeNull());
    expect(await isPostTrialNextStepsDismissed()).toBe(true);
    expect(useRuntimeStore.getState().status?.running).toBeFalsy();
  });

  test('autotrade intent primary CTA opens Settings and dismisses', async () => {
    const rec = {
      ...createEmptyOnboardingRecord(),
      intentMode: 'alerts_and_autotrade' as const,
      completedAt: new Date().toISOString(),
    };
    await saveOnboardingRecord(rec);
    const onOpenSettings = jest.fn();
    const s = await render(<PostTrialNextStepsModal onOpenSettings={onOpenSettings} />);
    await waitFor(() => expect(s.getByTestId('btn-post-trial-action-add_kalshi')).toBeTruthy());
    await fireEvent.press(s.getByTestId('btn-post-trial-action-add_kalshi'));
    await waitFor(() => expect(onOpenSettings).toHaveBeenCalled());
    expect(await isPostTrialNextStepsDismissed()).toBe(true);
    expect(s.queryByTestId('modal-post-trial-next-steps')).toBeNull();
  });
});

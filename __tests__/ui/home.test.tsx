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
import { HomeScreen } from '../../src/screens/HomeScreen';

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

describe('HomeScreen', () => {
  test('renders brand and controls', async () => {
    const s = await render(<HomeScreen />);
    expect(s.getByTestId('screen-home')).toBeTruthy();
    expect(s.getByTestId('home-brand')).toBeTruthy();
    expect(s.getByText('Predict')).toBeTruthy();
    expect(s.getByTestId('home-predictions-card')).toBeTruthy();
    expect(s.getByTestId('home-cash-block')).toBeTruthy();
    expect(s.getByText('PREDICTIONS')).toBeTruthy();
    expect(s.getByText('Cash')).toBeTruthy();
    expect(s.getByTestId('home-heartbeat')).toBeTruthy();
    expect(s.getByTestId('btn-kill-switch')).toBeTruthy();
    expect(s.getByTestId('btn-toggle-poller')).toBeTruthy();
    expect(s.getByTestId('btn-tick-once')).toBeTruthy();
    expect(s.getByTestId('support-contact')).toBeTruthy();
    expect(s.getByText(/senthil930@gmail\.com/)).toBeTruthy();
  });

  test('integration error banner includes support email from config.json', async () => {
    const rt = useRuntimeStore.getState().ensure();
    rt.status.lastError = 'Kalshi auth failed';
    useRuntimeStore.getState().syncFromRuntime();
    const s = await render(<HomeScreen />);
    await waitFor(() => expect(s.getByTestId('home-integration-error')).toBeTruthy());
    expect(s.getByTestId('home-error-support-email')).toBeTruthy();
    expect(s.getAllByText(/senthil930@gmail\.com/).length).toBeGreaterThanOrEqual(1);
  });

  test('kill switch disarms', async () => {
    useConfigStore.setState({
      config: {
        ...defaultAppConfig(),
        auto_trade_enabled: true,
        execution_mode: 'live',
        live_armed: true,
      },
      hydrated: true,
    });
    const s = await render(<HomeScreen />);
    await fireEvent.press(s.getByTestId('btn-kill-switch'));
    await waitFor(() => expect(useConfigStore.getState().config.auto_trade_enabled).toBe(false));
  });
});

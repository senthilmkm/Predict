import React from 'react';
import { fireEvent, render, cleanup } from './test-utils';
import { cancelScheduledPersist } from '../../src/storage/configPersistence';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../../src/platform/storage';
import { useConfigStore } from '../../src/state/configStore';
import { resetRuntimeStoreForTests } from '../../src/state/runtimeStore';
import { defaultAppConfig } from '../../src/config/types';
import { CushionsScreen } from '../../src/screens/CushionsScreen';

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

describe('CushionsScreen', () => {
  test('all assets + nudge + toggle', async () => {
    const s = await render(<CushionsScreen />);
    expect(s.getByTestId('screen-cushions')).toBeTruthy();
    expect(s.getByTestId('reset-cushions-top-btn')).toBeTruthy();
    expect(s.getByTestId('reset-cushions-bottom-btn')).toBeTruthy();
    for (const a of ['WTI', 'Gold', 'Silver', 'BTC', 'ETH', 'DOGE', 'EURUSD', 'XRP', 'COPPER']) {
      expect(s.getByTestId(`cushion-card-${a}`)).toBeTruthy();
      expect(s.getByTestId(`cushion-inc-${a}`)).toBeTruthy();
      expect(s.getByTestId(`cushion-dec-${a}`)).toBeTruthy();
      expect(s.getByTestId(`cushion-enable-${a}`)).toBeTruthy();
    }
    const beforeGold = useConfigStore.getState().config.cushions.Gold;
    await fireEvent.press(s.getByTestId('cushion-inc-Gold'));
    expect(useConfigStore.getState().config.cushions.Gold).toBeGreaterThan(beforeGold);

    await fireEvent(s.getByTestId('cushion-enable-WTI'), 'valueChange', false);
    expect(useConfigStore.getState().config.assets_enabled.WTI).toBe(false);
  });

  test('small-step assets (DOGE, EURUSD, XRP, COPPER) can be increased and decreased via UI', async () => {
    const s = await render(<CushionsScreen />);
    
    // DOGE test (default 0.005, step 0.001)
    const dogeBefore = useConfigStore.getState().config.cushions.DOGE;
    await fireEvent.press(s.getByTestId('cushion-inc-DOGE'));
    expect(useConfigStore.getState().config.cushions.DOGE).toBeCloseTo(dogeBefore + 0.001, 5);
    await fireEvent.press(s.getByTestId('cushion-dec-DOGE'));
    expect(useConfigStore.getState().config.cushions.DOGE).toBeCloseTo(dogeBefore, 5);

    // EURUSD test (default 0.0005, step 0.0001)
    const eurusdBefore = useConfigStore.getState().config.cushions.EURUSD;
    await fireEvent.press(s.getByTestId('cushion-inc-EURUSD'));
    expect(useConfigStore.getState().config.cushions.EURUSD).toBeCloseTo(eurusdBefore + 0.0001, 5);
    await fireEvent.press(s.getByTestId('cushion-dec-EURUSD'));
    expect(useConfigStore.getState().config.cushions.EURUSD).toBeCloseTo(eurusdBefore, 5);

    // XRP test (default 0.01, step 0.002)
    const xrpBefore = useConfigStore.getState().config.cushions.XRP;
    await fireEvent.press(s.getByTestId('cushion-inc-XRP'));
    expect(useConfigStore.getState().config.cushions.XRP).toBeCloseTo(xrpBefore + 0.002, 5);
    await fireEvent.press(s.getByTestId('cushion-dec-XRP'));
    expect(useConfigStore.getState().config.cushions.XRP).toBeCloseTo(xrpBefore, 5);
  });
});


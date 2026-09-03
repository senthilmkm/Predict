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
    for (const a of ['WTI', 'Gold', 'Silver', 'BTC', 'ETH']) {
      expect(s.getByTestId(`cushion-card-${a}`)).toBeTruthy();
      expect(s.getByTestId(`cushion-inc-${a}`)).toBeTruthy();
      expect(s.getByTestId(`cushion-enable-${a}`)).toBeTruthy();
    }
    const before = useConfigStore.getState().config.cushions.Gold;
    await fireEvent.press(s.getByTestId('cushion-inc-Gold'));
    expect(useConfigStore.getState().config.cushions.Gold).toBeGreaterThan(before);
    await fireEvent(s.getByTestId('cushion-enable-WTI'), 'valueChange', false);
    expect(useConfigStore.getState().config.assets_enabled.WTI).toBe(false);
  });
});

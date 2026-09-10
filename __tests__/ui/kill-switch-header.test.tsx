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
import { KillSwitchHeaderButton } from '../../src/components/KillSwitchHeaderButton';

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

describe('KillSwitchHeaderButton', () => {
  test('confirms then shows processing and Disarmed label', async () => {
    const Alert = require('react-native').Alert;
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const disarm = buttons?.find((b: { text?: string }) => b.text === 'Disarm');
      disarm?.onPress?.();
    });
    try {
      useConfigStore.setState({
        config: {
          ...defaultAppConfig(),
          auto_trade_enabled: true,
          execution_mode: 'live',
          live_armed: true,
        },
        hydrated: true,
      });
      useRuntimeStore.getState().ensure();
      const s = await render(<KillSwitchHeaderButton />);
      expect(s.getByTestId('btn-kill-switch')).toBeTruthy();
      expect(s.getByLabelText('Kill switch — disarm now')).toBeTruthy();
      await fireEvent.press(s.getByTestId('btn-kill-switch'));
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0][0])).toMatch(/Turn off Auto-trade/i);
      expect(String(spy.mock.calls[0][1])).toMatch(/Protect money works whenever that switch is On/i);
      expect(String(spy.mock.calls[0][1])).toMatch(/even if Auto-trade \(new buys\) is Off/i);
      await waitFor(() => expect(s.getByTestId('kill-switch-spinner')).toBeTruthy());
      await waitFor(() => expect(useConfigStore.getState().config.auto_trade_enabled).toBe(false));
      await waitFor(() => expect(s.getByLabelText('Disarmed — Auto-trade off')).toBeTruthy());
      await waitFor(() => expect(s.queryByTestId('kill-switch-spinner')).toBeNull());
    } finally {
      spy.mockRestore();
    }
  });

  test('when already off explains already disarmed', async () => {
    const Alert = require('react-native').Alert;
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      const s = await render(<KillSwitchHeaderButton />);
      expect(s.getByLabelText('Disarmed — Auto-trade off')).toBeTruthy();
      await fireEvent.press(s.getByTestId('btn-kill-switch'));
      expect(spy).toHaveBeenCalledWith(
        'Already disarmed',
        expect.stringMatching(/Settings tab.*enable Auto-trade/i)
      );
      expect(String(spy.mock.calls[0][1])).toMatch(/Protect money works whenever that switch is On/i);
    } finally {
      spy.mockRestore();
    }
  });
});

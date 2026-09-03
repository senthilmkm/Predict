import React from 'react';
import { fireEvent, render, waitFor, cleanup } from './test-utils';
import { cancelScheduledPersist } from '../../src/storage/configPersistence';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../../src/platform/storage';
import { useConfigStore } from '../../src/state/configStore';
import { resetRuntimeStoreForTests } from '../../src/state/runtimeStore';
import { defaultAppConfig } from '../../src/config/types';
import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { generateKeyPairSync } from 'crypto';
import { saveCredentials } from '../../src/services/credentials';
import { KalshiClient } from '../../src/services/kalshi/client';

function reset() {
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());
  resetRuntimeStoreForTests();
  useConfigStore.setState({ config: defaultAppConfig(), hydrated: true });
  cancelScheduledPersist();
  cleanup();
}

describe('Settings toggles', () => {
  beforeEach(reset);
  afterEach(reset);

  test('alerts / autotrade / poll / risk restore', async () => {
    await saveCredentials({
      keyId: 'k',
      privateKeyPem: generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      }).privateKey,
      env: 'production',
    });
    const s = await render(<SettingsScreen />);
    expect(s.getByTestId('screen-settings')).toBeTruthy();
    expect(useConfigStore.getState().config.poll_interval_seconds).toBe(15);
    await fireEvent.press(s.getByTestId('toggle-alerts'));
    await waitFor(() => expect(useConfigStore.getState().config.alerts_enabled).toBe(false));
    await fireEvent.press(s.getByTestId('toggle-autotrade'));
    await waitFor(() =>
      expect(useConfigStore.getState().config.auto_trade_enabled).toBe(true)
    );
    expect(useConfigStore.getState().config.execution_mode).toBe('live');
    await fireEvent.press(s.getByTestId('btn-poll-down'));
    await waitFor(() =>
      expect(useConfigStore.getState().config.poll_interval_seconds).toBe(10)
    );

    expect(useConfigStore.getState().config.alert_retention_days).toBe(30);
    await fireEvent.press(s.getByTestId('btn-retention-down'));
    await waitFor(() =>
      expect(useConfigStore.getState().config.alert_retention_days).toBe(25)
    );
    await fireEvent.press(s.getByTestId('btn-prune-alerts'));
    await waitFor(() =>
      expect(String(s.getByTestId('settings-message').props.children)).toMatch(/prune|alert/i)
    );

    expect(s.queryByTestId('risk-field-max_dollars_per_trade')).toBeNull();
    await fireEvent.press(s.getByTestId('btn-toggle-risk'));
    await fireEvent.press(s.getByTestId('risk-up-max_dollars_per_trade'));
    await fireEvent.press(s.getByTestId('risk-up-fixed_dollars_per_trade'));
    expect(useConfigStore.getState().config.risk.fixed_dollars_per_trade).toBeGreaterThan(5);
    await fireEvent.press(s.getByTestId('btn-restore-risk-defaults'));
    await waitFor(() =>
      expect(useConfigStore.getState().config.risk.fixed_dollars_per_trade).toBe(5)
    );
    await waitFor(() =>
      expect(String(s.getByTestId('settings-message').props.children)).toMatch(/risk defaults/i)
    );
    expect(useConfigStore.getState().config.risk.chase_above_ask_usd).toBe(0.02);
    expect(useConfigStore.getState().config.risk.time_in_force).toBe('immediate_or_cancel');
  });
});

describe('Settings credentials', () => {
  beforeEach(reset);
  afterEach(reset);

  test('unlock shows inputs and save works', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const s = await render(<SettingsScreen />);
    await fireEvent.press(s.getByTestId('btn-unlock-creds'));
    await waitFor(() => expect(s.getByTestId('input-key-id')).toBeTruthy());
    await fireEvent.changeText(s.getByTestId('input-key-id'), 'test-key-id');
    await fireEvent.changeText(s.getByTestId('input-pem'), privateKey);
    await fireEvent.press(s.getByTestId('btn-save-creds'));
    await waitFor(() =>
      expect(String(s.getByTestId('settings-message').props.children)).toMatch(/saved/i)
    );
  });

  test('kalshi creds help modal opens and closes', async () => {
    const s = await render(<SettingsScreen />);
    expect(s.queryByTestId('modal-kalshi-creds-help')).toBeNull();
    await fireEvent.press(s.getByTestId('btn-kalshi-creds-help'));
    await waitFor(() => expect(s.getByTestId('modal-kalshi-creds-help')).toBeTruthy());
    await fireEvent.press(s.getByTestId('btn-got-it-kalshi-creds-help'));
    await waitFor(() => expect(s.queryByTestId('modal-kalshi-creds-help')).toBeNull());
  });

  test('risk help modal opens and closes', async () => {
    const s = await render(<SettingsScreen />);
    expect(s.queryByTestId('modal-risk-help')).toBeNull();
    await fireEvent.press(s.getByTestId('btn-risk-help'));
    await waitFor(() => expect(s.getByTestId('modal-risk-help')).toBeTruthy());
    expect(s.getByText('Protect money (early sell)')).toBeTruthy();
    await fireEvent.press(s.getByTestId('btn-got-it-risk-help'));
    await waitFor(() => expect(s.queryByTestId('modal-risk-help')).toBeNull());
  });

  test('protect money toggle appears under Risk', async () => {
    const s = await render(<SettingsScreen />);
    await fireEvent.press(s.getByTestId('btn-toggle-risk'));
    await waitFor(() => expect(s.getByTestId('risk-field-protect_sell_enabled')).toBeTruthy());
    expect(s.getByTestId('risk-toggle-protect_sell_enabled')).toBeTruthy();
    expect(s.getByTestId('risk-value-protect_sell_gap_ratio').props.children).toMatch(/1\.00×/);
    expect(s.getByTestId('risk-value-protect_sell_grace_seconds').props.children).toMatch(/45s/);
  });

  test('test connection shows successful banner', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await saveCredentials({
      keyId: 'k',
      privateKeyPem: privateKey,
      env: 'production',
    });

    const spy = jest.spyOn(KalshiClient.prototype, 'balance').mockResolvedValue({
      ok: true,
      http_status: 200,
      balance_usd: 12.34,
      environment: 'production',
    } as any);

    try {
      const s = await render(<SettingsScreen />);
      await fireEvent.press(s.getByTestId('btn-test-connection'));
      await waitFor(() =>
        expect(String(s.getByTestId('connection-test-result').props.children)).toMatch(
          /Test connection successful/i
        )
      );
      expect(String(s.getByTestId('settings-message').props.children)).toMatch(
        /Test connection successful/i
      );
    } finally {
      spy.mockRestore();
    }
  });

  test('support contact from config.json is rendered', async () => {
    const s = await render(<SettingsScreen />);
    expect(s.getByTestId('support-contact')).toBeTruthy();
    expect(s.getByText(/senthil930@gmail\.com/)).toBeTruthy();
  });
});

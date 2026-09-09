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
  cleanup();
  cancelScheduledPersist();
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());
  resetRuntimeStoreForTests();
  useConfigStore.setState({ config: defaultAppConfig(), hydrated: true });
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
    expect(useConfigStore.getState().config.poll_interval_seconds).toBe(20);
    await fireEvent(s.getByTestId('toggle-alerts'), 'valueChange', false);
    await waitFor(() => expect(useConfigStore.getState().config.alerts_enabled).toBe(false));
    await fireEvent(s.getByTestId('toggle-autotrade'), 'valueChange', true);
    await waitFor(() => expect(s.getByTestId('modal-autotrade-risk')).toBeTruthy());
    await fireEvent(s.getByTestId('switch-autotrade-understand'), 'valueChange', true);
    await fireEvent.press(s.getByTestId('btn-autotrade-risk-continue'));
    await waitFor(() =>
      expect(useConfigStore.getState().config.auto_trade_enabled).toBe(true)
    );
    expect(useConfigStore.getState().config.execution_mode).toBe('live');
    // Turn off then on again — disclaimer already accepted, no modal
    await fireEvent(s.getByTestId('toggle-autotrade'), 'valueChange', false);
    await waitFor(() =>
      expect(useConfigStore.getState().config.auto_trade_enabled).toBe(false)
    );
    await fireEvent(s.getByTestId('toggle-autotrade'), 'valueChange', true);
    await waitFor(() =>
      expect(useConfigStore.getState().config.auto_trade_enabled).toBe(true)
    );
    expect(s.queryByTestId('modal-autotrade-risk')).toBeNull();

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

  test('stored-alert count is not duplicated; account identity sits below Legal', async () => {
    const s = await render(<SettingsScreen />);
    expect(s.queryByText('Stored alerts')).toBeNull();
    expect(s.queryByTestId('alert-stored-count')).toBeNull();
    expect(s.getByTestId('alert-retention-row')).toBeTruthy();
    expect(s.getByTestId('btn-prune-alerts')).toBeTruthy();
    expect(s.getByTestId('account-cloud-identity-card')).toBeTruthy();
    expect(s.getByTestId('settings-disclaimer')).toBeTruthy();
    expect(s.getByTestId('section-faq')).toBeTruthy();
    expect(s.queryByTestId('faq-accordion')).toBeNull();

    const texts: string[] = [];
    const walk = (n: { children?: Array<string | { children?: unknown[] }> }) => {
      for (const child of n.children ?? []) {
        if (typeof child === 'string') texts.push(child);
        else if (child && typeof child === 'object') walk(child as any);
      }
    };
    walk(s.getByTestId('screen-settings'));
    const legalAt = texts.indexOf('Legal');
    const accountAt = texts.indexOf('Account & Cloud Identity');
    const faqAt = texts.indexOf('FAQ');
    const supportAt = texts.indexOf('Support');
    expect(legalAt).toBeGreaterThan(-1);
    expect(accountAt).toBeGreaterThan(legalAt);
    expect(faqAt).toBeGreaterThan(accountAt);
    expect(supportAt).toBeGreaterThan(faqAt);
  });

  test('FAQ accordion expands a disclaimer answer', async () => {
    const s = await render(<SettingsScreen />);
    await fireEvent.press(s.getByTestId('btn-toggle-faq'));
    await waitFor(() => expect(s.getByTestId('faq-accordion')).toBeTruthy());
    expect(s.getByTestId('faq-category-disclaimer')).toBeTruthy();
    expect(s.getByTestId('faq-q-does-it-guarantee')).toBeTruthy();
    expect(s.queryByTestId('faq-a-does-it-guarantee')).toBeNull();
    await fireEvent.press(s.getByTestId('faq-q-does-it-guarantee'));
    await waitFor(() => expect(s.getByTestId('faq-a-does-it-guarantee')).toBeTruthy());
    expect(String(s.getByTestId('faq-a-does-it-guarantee').props.children)).toMatch(
      /does not guarantee profits/i
    );
  });

  test('FAQ what-markets lists live 15m books and no forex', async () => {
    const s = await render(<SettingsScreen />);
    await fireEvent.press(s.getByTestId('btn-toggle-faq'));
    await waitFor(() => expect(s.getByTestId('faq-accordion')).toBeTruthy());
    await fireEvent.press(s.getByTestId('faq-q-what-markets'));
    const a = String(s.getByTestId('faq-a-what-markets').props.children);
    expect(a).toMatch(/BTC, ETH, SOL, DOGE, XRP, BNB/);
    expect(a).toMatch(/S&P 500, Nasdaq 100/);
    expect(a).toMatch(/9:30 AM–4:00 PM ET only/);
    expect(a).toMatch(/no 15-minute forex/i);
    expect(a).not.toMatch(/EUR\/USD/);
    expect(a).not.toMatch(/AVAX/);
  });

  test('5-tap version text unlocks Developer Diagnostics', async () => {
    const s = await render(<SettingsScreen />);
    expect(s.queryByTestId('toggle-poller')).toBeNull();
    expect(s.queryByTestId('btn-tick-once')).toBeNull();

    const ver = s.getByTestId('settings-version-text');
    for (let i = 0; i < 5; i++) {
      await fireEvent.press(ver);
    }

    await waitFor(() => expect(s.getByTestId('toggle-poller')).toBeTruthy());
    expect(s.getByTestId('btn-tick-once')).toBeTruthy();
    expect(String(s.getByTestId('settings-message').props.children)).toMatch(/unlocked/i);
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
    expect(s.getByText('Max trades / asset / 15m window')).toBeTruthy();
    expect(s.queryByText('Max trades / asset / day')).toBeNull();
    await fireEvent.press(s.getByTestId('btn-got-it-risk-help'));
    await waitFor(() => expect(s.queryByTestId('modal-risk-help')).toBeNull());
  });

  test('protect money toggle appears under Risk', async () => {
    const s = await render(<SettingsScreen />);
    await fireEvent.press(s.getByTestId('btn-toggle-risk'));
    await waitFor(() => expect(s.getByTestId('risk-field-protect_sell_enabled')).toBeTruthy());
    expect(s.getByTestId('risk-field-max_trades_per_asset_per_window')).toBeTruthy();
    expect(s.getByTestId('risk-value-max_trades_per_asset_per_window').props.children).toBe('1');
    expect(s.queryByTestId('risk-field-max_trades_per_asset_per_day')).toBeNull();
    expect(s.getByTestId('risk-hint-protect-sell-auto-off').props.children).toBe(
      'Still runs 24/7 on Cloud Run if Auto-trade is Off.'
    );
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

  test('support contact email is shown without config.json hint', async () => {
    const s = await render(<SettingsScreen />);
    expect(s.getByTestId('support-contact')).toBeTruthy();
    expect(s.getByText(/senthil930@gmail\.com/)).toBeTruthy();
    expect(s.queryByText(/Email from config\.json/i)).toBeNull();
  });

  test('Wipe credentials asks Are you sure before Face ID', async () => {
    const Alert = require('react-native').Alert;
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
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
      await fireEvent.press(s.getByTestId('btn-wipe-creds'));
      expect(spy).toHaveBeenCalled();
      const [title, message, buttons] = spy.mock.calls[0];
      expect(title).toMatch(/Wipe credentials/i);
      expect(String(message)).toMatch(/Remove Kalshi API keys/i);
      expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Cancel', 'Wipe']);
    } finally {
      spy.mockRestore();
    }
  });
});

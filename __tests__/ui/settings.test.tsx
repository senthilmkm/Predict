import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fireEvent, render, waitFor, cleanup } from './test-utils';
import { within } from '@testing-library/react-native';
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
import { SettingsMoreScreen } from '../../src/screens/SettingsMoreScreen';
import { RiskScreen } from '../../src/screens/RiskScreen';
import { generateKeyPairSync } from 'crypto';
import { saveCredentials, hasCredentials, clearCredentials } from '../../src/services/credentials';
import { KalshiClient } from '../../src/services/kalshi/client';

function SettingsHost() {
  const [more, setMore] = useState(false);
  const [risk, setRisk] = useState(false);
  return (
    <View testID="settings-host">
      <View
        testID="settings-home-slot"
        // Keep Settings mounted while More/Risk is open (mirrors root stack).
        style={more || risk ? { height: 0, overflow: 'hidden' } : undefined}
        pointerEvents={more || risk ? 'none' : 'auto'}
      >
        <SettingsScreen
          onOpenAccountAndMore={() => setMore(true)}
          onOpenRisk={() => setRisk(true)}
        />
      </View>
      {risk ? (
        <View>
          <Pressable testID="btn-risk-back" onPress={() => setRisk(false)}>
            <Text>Back</Text>
          </Pressable>
          <RiskScreen />
        </View>
      ) : null}
      {more ? (
        <View>
          <Pressable testID="btn-settings-more-back" onPress={() => setMore(false)}>
            <Text>Back</Text>
          </Pressable>
          <SettingsMoreScreen />
        </View>
      ) : null}
    </View>
  );
}

function reset() {
  cleanup();
  cancelScheduledPersist();
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());
  resetRuntimeStoreForTests();
  useConfigStore.setState({ config: defaultAppConfig(), hydrated: true });
  return clearCredentials();
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
    // Show opens the Risk screen via navigation; fields live there.
    expect(s.queryByTestId('risk-group-size')).toBeNull();
    expect(s.queryByTestId('screen-risk')).toBeNull();
  });

  test('daily Settings parks subscription legal identity FAQ one tap away', async () => {
    const s = await render(<SettingsHost />);
    expect(s.queryByText('Stored alerts')).toBeNull();
    expect(s.queryByTestId('alert-stored-count')).toBeNull();
    expect(s.getByTestId('alert-retention-row')).toBeTruthy();
    expect(s.getByTestId('btn-prune-alerts')).toBeTruthy();
    expect(s.getByTestId('btn-open-settings-more')).toBeTruthy();
    expect(s.queryByTestId('subscription-manage-card')).toBeNull();
    expect(s.queryByTestId('account-cloud-identity-card')).toBeNull();
    expect(s.queryByTestId('settings-disclaimer')).toBeNull();
    expect(s.queryByTestId('section-faq')).toBeNull();
    expect(s.queryByTestId('faq-accordion')).toBeNull();
    expect(s.getByTestId('support-contact')).toBeTruthy();
    expect(String(s.getByTestId('alerts-notify-hint').props.children)).toMatch(
      /mute Lean signals on the bell/i
    );

    const homeTexts: string[] = [];
    const walkHome = (n: { children?: Array<string | { children?: unknown[] }> }) => {
      for (const child of n.children ?? []) {
        if (typeof child === 'string') homeTexts.push(child);
        else if (child && typeof child === 'object') walkHome(child as any);
      }
    };
    walkHome(s.getByTestId('screen-settings'));
    const kalshiAt = homeTexts.indexOf('Kalshi credentials');
    const riskAt = homeTexts.indexOf('Risk');
    const alertsAt = homeTexts.indexOf('Alerts');
    expect(kalshiAt).toBeGreaterThan(-1);
    expect(riskAt).toBeGreaterThan(-1);
    expect(alertsAt).toBeGreaterThan(riskAt);
    expect(kalshiAt).toBeGreaterThan(alertsAt);

    await fireEvent.press(s.getByTestId('btn-open-settings-more'));
    await waitFor(() => expect(s.getByTestId('screen-settings-more')).toBeTruthy());
    expect(s.getByTestId('subscription-manage-card')).toBeTruthy();
    expect(s.getByTestId('account-cloud-identity-card')).toBeTruthy();
    expect(s.getByTestId('settings-disclaimer')).toBeTruthy();
    expect(s.getByTestId('section-faq')).toBeTruthy();
    expect(s.getByTestId('faq-accordion')).toBeTruthy();
    expect(
      within(s.getByTestId('screen-settings-more')).queryByTestId('support-contact')
    ).toBeNull();

    const texts: string[] = [];
    const walk = (n: { children?: Array<string | { children?: unknown[] }> }) => {
      for (const child of n.children ?? []) {
        if (typeof child === 'string') texts.push(child);
        else if (child && typeof child === 'object') walk(child as any);
      }
    };
    walk(s.getByTestId('screen-settings-more'));
    const subAt = texts.indexOf('Subscription');
    const accountAt = texts.indexOf('Account & Cloud Identity');
    const legalAt = texts.indexOf('Legal');
    const faqAt = texts.indexOf('FAQ');
    expect(subAt).toBeGreaterThan(-1);
    expect(accountAt).toBeGreaterThan(subAt);
    expect(legalAt).toBeGreaterThan(accountAt);
    expect(faqAt).toBeGreaterThan(legalAt);
  });

  test('FAQ accordion expands a disclaimer answer', async () => {
    const s = await render(<SettingsHost />);
    await fireEvent.press(s.getByTestId('btn-open-settings-more'));
    await waitFor(() => expect(s.getByTestId('faq-accordion')).toBeTruthy());
    expect(s.queryByTestId('btn-toggle-faq')).toBeNull();
    expect(s.getByTestId('faq-category-disclaimer')).toBeTruthy();
    expect(s.getByTestId('faq-q-mute-vs-lean-toggle')).toBeTruthy();
    expect(s.getByTestId('faq-q-does-it-guarantee')).toBeTruthy();
    expect(s.queryByTestId('faq-a-does-it-guarantee')).toBeNull();
    await fireEvent.press(s.getByTestId('faq-q-does-it-guarantee'));
    await waitFor(() => expect(s.getByTestId('faq-a-does-it-guarantee')).toBeTruthy());
    expect(String(s.getByTestId('faq-a-does-it-guarantee').props.children)).toMatch(
      /does not guarantee profits/i
    );
  });

  test('FAQ what-markets lists live 15m books and no forex', async () => {
    const s = await render(<SettingsHost />);
    await fireEvent.press(s.getByTestId('btn-open-settings-more'));
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
    expect(s.getAllByText(/Smart buy/).length).toBeGreaterThan(0);
    expect(s.getAllByText(/Min extra chance/).length).toBeGreaterThan(0);
    expect(s.getByText('Shared vs each tab')).toBeTruthy();
    expect(s.getByText('Max trades / asset / 15m window')).toBeTruthy();
    expect(s.queryByText('Max trades / asset / day')).toBeNull();
    expect(s.getByTestId('help-notify-vs-mute')).toBeTruthy();
    expect(s.queryByText(/from config\.json/i)).toBeNull();
    await fireEvent.press(s.getByTestId('btn-got-it-risk-help'));
    await waitFor(() => expect(s.queryByTestId('modal-risk-help')).toBeNull());
  });

  test('protect money toggle appears under Risk Auto-trade tab', async () => {
    const s = await render(<SettingsHost />);
    await fireEvent.press(s.getByTestId('btn-toggle-risk'));
    await waitFor(() => expect(s.getByTestId('screen-risk')).toBeTruthy());
    expect(s.getByTestId('risk-tab-home')).toBeTruthy();
    expect(s.getByTestId('risk-field-shared-max_trades_per_asset_per_window')).toBeTruthy();
    expect(s.getByTestId('risk-value-shared-max_trades_per_asset_per_window').props.children).toBe('1');
    expect(s.getByTestId('tif-home-immediate_or_cancel')).toBeTruthy();
    expect(s.queryByTestId('risk-toggle-protect_sell_enabled')).toBeNull();
    expect(s.queryByTestId('risk-toggle-smart_buy_enabled')).toBeNull();
    await fireEvent.press(s.getByTestId('risk-tab-auto'));
    await waitFor(() => expect(s.getByTestId('risk-toggle-protect_sell_enabled')).toBeTruthy());
    expect(s.getByTestId('risk-toggle-smart_buy_enabled')).toBeTruthy();
    expect(s.getByTestId('risk-field-auto-smart_buy_enabled')).toBeTruthy();
    expect(s.getByTestId('risk-value-auto-smart_buy_min_edge_usd').props.children).toMatch(/\$0\.08/);
    expect(useConfigStore.getState().config.risk.smart_buy_enabled).toBe(true);
    expect(s.getByTestId('risk-field-auto-protect_sell_enabled')).toBeTruthy();
    expect(s.queryByTestId('risk-field-max_trades_per_asset_per_day')).toBeNull();
    expect(s.getByTestId('risk-value-auto-protect_sell_gap_ratio').props.children).toMatch(/1\.00×/);
    expect(s.getByTestId('risk-value-auto-protect_sell_grace_seconds').props.children).toMatch(/45s/);
    await fireEvent.press(s.getByTestId('tif-auto-good_till_canceled'));
    await waitFor(() =>
      expect(useConfigStore.getState().config.risk.time_in_force).toBe('good_till_canceled')
    );
    expect(useConfigStore.getState().config.manual_risk.time_in_force).toBe('immediate_or_cancel');
    await fireEvent.press(s.getByTestId('risk-tab-home'));
    await waitFor(() => expect(s.getByTestId('risk-up-home-min_minutes_left')).toBeTruthy());
    await fireEvent.press(s.getByTestId('risk-up-home-min_minutes_left'));
    await waitFor(() =>
      expect(useConfigStore.getState().config.manual_risk.min_minutes_left).toBe(3)
    );
    expect(useConfigStore.getState().config.risk.min_minutes_left).toBe(2);
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

  test('Wipe cancel leaves credentials in place', async () => {
    const Alert = require('react-native').Alert;
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const cancel = (buttons || []).find((b: { text: string }) => b.text === 'Cancel');
      cancel?.onPress?.();
    });
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
      expect(await hasCredentials()).toBe(true);
      expect(s.getByTestId('creds-status').props.children).toMatch(/Saved/i);
    } finally {
      spy.mockRestore();
    }
  });

  test('test connection with no keys shows fail line', async () => {
    const Alert = require('react-native').Alert;
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      const s = await render(<SettingsScreen />);
      await fireEvent.press(s.getByTestId('btn-test-connection'));
      await waitFor(() =>
        expect(String(s.getByTestId('connection-test-result').props.children)).toMatch(
          /No credentials/i
        )
      );
    } finally {
      spy.mockRestore();
    }
  });

  test('Risk Show opens the Risk screen; Back returns to Settings', async () => {
    const s = await render(<SettingsHost />);
    await fireEvent.press(s.getByTestId('btn-toggle-risk'));
    await waitFor(() => expect(s.getByTestId('screen-risk')).toBeTruthy());
    expect(s.getByTestId('btn-restore-shared-risk')).toBeTruthy();
    expect(s.getByTestId('btn-restore-risk-tab')).toBeTruthy();
    await fireEvent.press(s.getByTestId('btn-risk-back'));
    await waitFor(() => expect(s.queryByTestId('screen-risk')).toBeNull());
    expect(s.getByTestId('screen-settings')).toBeTruthy();
  });
});

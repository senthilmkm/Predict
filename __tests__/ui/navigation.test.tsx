import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fireEvent, render, cleanup } from './test-utils';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../../src/platform/storage';
import { useConfigStore } from '../../src/state/configStore';
import { resetRuntimeStoreForTests, useRuntimeStore } from '../../src/state/runtimeStore';
import { defaultAppConfig } from '../../src/config/types';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { CushionsScreen } from '../../src/screens/CushionsScreen';
import { HistoryScreen } from '../../src/screens/HistoryScreen';
import { DashboardScreen } from '../../src/screens/DashboardScreen';
import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { AlertsHubScreen } from '../../src/screens/AlertsHubScreen';

function NavHarness() {
  const [tab, setTab] = useState<'Home' | 'Cushions' | 'History' | 'Dashboard' | 'Settings'>(
    'Home'
  );
  const [hub, setHub] = useState(false);
  const unread = useRuntimeStore((s) => s.unread);

  if (hub) {
    return (
      <View testID="nav-hub-open">
        <Pressable testID="nav-back" onPress={() => setHub(false)}>
          <Text>Back</Text>
        </Pressable>
        <AlertsHubScreen />
      </View>
    );
  }

  return (
    <View testID="nav-root">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {(['Home', 'Cushions', 'History', 'Dashboard', 'Settings'] as const).map((name) => (
          <Pressable key={name} testID={`nav-tab-${name}`} onPress={() => setTab(name)}>
            <Text>{name}</Text>
          </Pressable>
        ))}
        <Pressable testID="btn-alerts-bell" onPress={() => setHub(true)}>
          <Text>bell:{unread}</Text>
        </Pressable>
        <Pressable
          testID="btn-export-history"
          onPress={async () => {
            const { exportAndShareHistory } = await import('../../src/services/exportHistory');
            await exportAndShareHistory([], []);
          }}
        >
          <Text>export</Text>
        </Pressable>
      </View>
      {tab === 'Home' && <HomeScreen />}
      {tab === 'Cushions' && <CushionsScreen />}
      {tab === 'History' && <HistoryScreen />}
      {tab === 'Dashboard' && <DashboardScreen />}
      {tab === 'Settings' && <SettingsScreen />}
    </View>
  );
}

beforeEach(() => {
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());
  resetRuntimeStoreForTests();
  useConfigStore.setState({ config: defaultAppConfig(), hydrated: true });
});

afterEach(() => cleanup());

describe('navigation', () => {
  test('tab switches across all screens', async () => {
    const s = await render(<NavHarness />);
    expect(s.getByTestId('screen-home')).toBeTruthy();
    await fireEvent.press(s.getByTestId('nav-tab-Cushions'));
    expect(s.getByTestId('screen-cushions')).toBeTruthy();
    await fireEvent.press(s.getByTestId('nav-tab-History'));
    expect(s.getByTestId('screen-history')).toBeTruthy();
    await fireEvent.press(s.getByTestId('nav-tab-Dashboard'));
    expect(s.getByTestId('screen-dashboard')).toBeTruthy();
    await fireEvent.press(s.getByTestId('nav-tab-Settings'));
    expect(s.getByTestId('screen-settings')).toBeTruthy();
    await fireEvent.press(s.getByTestId('nav-tab-Home'));
    expect(s.getByTestId('screen-home')).toBeTruthy();
  });

  test('bell opens Alerts Hub', async () => {
    const rt = useRuntimeStore.getState().ensure();
    rt.alerts.insert({
      id: 'a1',
      at: new Date().toISOString(),
      kind: 'lean_signal',
      title: 'Gold YES',
      body: 'test',
      read: false,
    });
    useRuntimeStore.getState().refresh();
    const s = await render(<NavHarness />);
    await fireEvent.press(s.getByTestId('btn-alerts-bell'));
    expect(s.getByTestId('screen-alerts-hub')).toBeTruthy();
    await fireEvent.press(s.getByTestId('nav-back'));
    expect(s.getByTestId('screen-home')).toBeTruthy();
  });
});

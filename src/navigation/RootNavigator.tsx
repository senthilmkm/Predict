import React, { useState } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { colors } from '../theme/tokens';
import { HomeScreen } from '../screens/HomeScreen';
import { CushionsScreen } from '../screens/CushionsScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AlertsHubScreen } from '../screens/AlertsHubScreen';
import { useRuntimeStore } from '../state/runtimeStore';
import { exportAndShareHistory } from '../services/exportHistory';
import { withSupportContact } from '../config/appMeta';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    primary: colors.accent,
  },
};

function BellButton({ onPress, count }: { onPress: () => void; count: number }) {
  const label = count > 99 ? '99+' : String(count);
  return (
    <Pressable onPress={onPress} style={{ padding: 6 }} testID="btn-alerts-bell">
      <Text style={{ color: colors.textPrimary, fontSize: 18 }}>🔔</Text>
      {count > 0 ? (
        <View
          testID="badge-unread"
          style={{
            position: 'absolute',
            right: 2,
            top: 2,
            backgroundColor: colors.danger,
            borderRadius: 8,
            minWidth: 16,
            height: 16,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 3,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{label}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ExportButton() {
  const [busy, setBusy] = useState(false);
  const ensure = useRuntimeStore((s) => s.ensure);

  return (
    <Pressable
      testID="btn-export-history"
      style={{ padding: 6, marginRight: 4, minWidth: 28, alignItems: 'center' }}
      disabled={busy}
      onPress={async () => {
        setBusy(true);
        try {
          ensure();
          const rt = useRuntimeStore.getState();
          const result = await exportAndShareHistory(rt.trades, rt.alerts);
          if (!result.ok) {
            Alert.alert('Export failed', withSupportContact(result.error || 'Could not export history'));
          }
        } catch (e: any) {
          Alert.alert('Export failed', withSupportContact(String(e?.message || e)));
        } finally {
          setBusy(false);
        }
      }}
      accessibilityLabel="Export auto-trading history"
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Text style={{ color: colors.textPrimary, fontSize: 17 }}>⇪</Text>
      )}
    </Pressable>
  );
}

function HeaderActions({ navigation }: { navigation: any }) {
  const unread = useRuntimeStore((s) => s.unread);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
      <ExportButton />
      <BellButton count={unread} onPress={() => navigation.navigate('AlertsHub')} />
    </View>
  );
}

function MainTabs({ navigation }: any) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.mute,
        headerRight: () => <HeaderActions navigation={navigation} />,
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Predict' }} />
      <Tab.Screen name="Cushions" component={CushionsScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Stack.Navigator>
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="AlertsHub"
          component={AlertsHubScreen}
          options={{
            title: 'Alerts',
            presentation: 'modal',
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.textPrimary,
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

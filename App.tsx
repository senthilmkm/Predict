import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { PaywallScreen } from './src/screens/PaywallScreen';
import { bindNativeStores } from './src/platform/storage';
import { bindNativeNotifications } from './src/services/notifications';
import { useConfigStore } from './src/state/configStore';
import { useRuntimeStore } from './src/state/runtimeStore';
import { hasPredictAccess, useSubscriptionStore } from './src/state/subscriptionStore';
import { colors } from './src/theme/tokens';

export default function App() {
  const hydrate = useConfigStore((s) => s.hydrate);
  const hydrated = useConfigStore((s) => s.hydrated);
  const ensure = useRuntimeStore((s) => s.ensure);
  const stop = useRuntimeStore((s) => s.stop);
  const hydrateSub = useSubscriptionStore((s) => s.hydrate);
  const subReady = useSubscriptionStore((s) => s.ready);
  const entitled = useSubscriptionStore((s) => hasPredictAccess(s));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await bindNativeStores();
      await bindNativeNotifications();
      await hydrate();
      await hydrateSub();
      const rt = ensure();
      await rt.hydrateHistory();
      useRuntimeStore.getState().syncFromRuntime();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate, hydrateSub, ensure]);

  useEffect(() => {
    if (!subReady) return;
    if (!entitled) {
      // Hard stop trading loop if entitlement lapses or user is on paywall
      stop();
      const cfg = useConfigStore.getState().config;
      if (cfg.auto_trade_enabled) {
        useConfigStore.getState().setConfig({
          auto_trade_enabled: false,
          execution_mode: 'off',
          live_armed: false,
        });
      }
    }
  }, [entitled, subReady, stop]);

  if (!ready || !hydrated || !subReady) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!entitled) {
    return <PaywallScreen />;
  }

  return <RootNavigator />;
}

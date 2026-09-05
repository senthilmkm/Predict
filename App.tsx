import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { PaywallScreen } from './src/screens/PaywallScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { bindNativeStores } from './src/platform/storage';
import { bindNativeNotifications } from './src/services/notifications';
import { useConfigStore } from './src/state/configStore';
import { useRuntimeStore } from './src/state/runtimeStore';
import { hasPredictAccess, useSubscriptionStore } from './src/state/subscriptionStore';
import { isOnboardingCompleted } from './src/storage/onboarding';
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
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

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
      const done = await isOnboardingCompleted();
      if (!cancelled) {
        setOnboardingDone(done);
        setReady(true);
      }
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
      return;
    }
    // Cold start: if Auto-trade or Alerts were left on, resume lean polling
    const cfg = useConfigStore.getState().config;
    if (ready && onboardingDone && (cfg.auto_trade_enabled || cfg.alerts_enabled)) {
      const running = Boolean(useRuntimeStore.getState().status?.running);
      if (!running) useRuntimeStore.getState().start();
    }
  }, [entitled, subReady, stop, ready, onboardingDone]);

  if (!ready || !hydrated || !subReady || onboardingDone == null) {
    return (
      <SafeAreaProvider>
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
      </SafeAreaProvider>
    );
  }

  // First install: full onboarding (includes trial/paywall as last step)
  if (!onboardingDone) {
    return (
      <SafeAreaProvider>
        <OnboardingScreen
          onFinished={() => {
            // Entitled users land in app; others stay until RC entitles (parent re-renders)
            void isOnboardingCompleted().then(setOnboardingDone);
          }}
        />
      </SafeAreaProvider>
    );
  }

  if (!entitled) {
    return (
      <SafeAreaProvider>
        <PaywallScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
}

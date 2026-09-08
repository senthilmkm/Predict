import { useEffect, useRef } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { useConfigStore } from '../state/configStore';
import { useRuntimeStore } from '../state/runtimeStore';
import { notifySystemBanner } from '../services/notifications';

/**
 * When Auto-trade or Alerts are on and the app leaves the foreground:
 * 1) stop the phone poller (Home leans / local settlement pause)
 * 2) fire a local notification (once per background session)
 * Cloud Run keeps placing orders. On return: restart the poller if still enabled.
 */
export function useAutoTradeBackgroundGuard() {
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const pausedForBackground = useRef(false);
  const notifiedThisBackground = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState.current;
      appState.current = next;

      // Pause only on true background. `inactive` (Control Center / Face ID sheet)
      // must not stop the poller mid-session.
      const leaving = prev === 'active' && next === 'background';
      const returning = prev === 'background' && next === 'active';

      const autoOn = useConfigStore.getState().config.auto_trade_enabled;
      const alertsOn = useConfigStore.getState().config.alerts_enabled;
      const pollingEnabled = autoOn || alertsOn;
      const running = Boolean(useRuntimeStore.getState().status?.running);

      if (leaving && pollingEnabled) {
        if (running) {
          useRuntimeStore.getState().stop();
          pausedForBackground.current = true;
        }
        if (!notifiedThisBackground.current) {
          notifiedThisBackground.current = true;
          void notifySystemBanner(
            'Predict — polling paused',
            autoOn
              ? 'Home lean polling paused in the background. Cloud Run still places orders while Auto-trade is On.'
              : 'Alerts are on, but the app is in the background. Home lean polling paused until you reopen Predict.'
          );
        }
      }

      if (returning) {
        notifiedThisBackground.current = false;
        if (pausedForBackground.current) {
          pausedForBackground.current = false;
          const stillAuto = useConfigStore.getState().config.auto_trade_enabled;
          const stillAlerts = useConfigStore.getState().config.alerts_enabled;
          const stillPolling = stillAuto || stillAlerts;
          Alert.alert(
            'Polling was paused',
            stillPolling
              ? 'While Predict was in the background, Home lean polling was stopped. Cloud Run kept trading. Polling will resume now.'
              : 'While Predict was in the background, Home lean polling was stopped.',
            [
              {
                text: 'OK',
                onPress: () => {
                  if (stillPolling) {
                    useRuntimeStore.getState().start();
                  }
                },
              },
            ]
          );
        }
      }
    });

    return () => sub.remove();
  }, []);
}

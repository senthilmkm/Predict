import { useEffect, useRef } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { useConfigStore } from '../state/configStore';
import { useRuntimeStore } from '../state/runtimeStore';
import { notifySystemBanner } from '../services/notifications';

/**
 * When Auto-trade is on and the app leaves the foreground:
 * 1) stop the poller (no silent “still trading” expectation)
 * 2) fire a local notification (once per background session)
 * On return: alert the user and restart the poller if Auto-trade is still enabled.
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
      const running = Boolean(useRuntimeStore.getState().status?.running);

      if (leaving && autoOn) {
        if (running) {
          useRuntimeStore.getState().stop();
          pausedForBackground.current = true;
        }
        if (!notifiedThisBackground.current) {
          notifiedThisBackground.current = true;
          void notifySystemBanner(
            'Predict — polling paused',
            'Auto-trade is on, but the app is in the background. No new leans or trades until you reopen Predict.'
          );
        }
      }

      if (returning) {
        notifiedThisBackground.current = false;
        if (pausedForBackground.current) {
          pausedForBackground.current = false;
          const stillAuto = useConfigStore.getState().config.auto_trade_enabled;
          Alert.alert(
            'Polling was paused',
            stillAuto
              ? 'While Predict was in the background, lean polling and new auto-trades were stopped. Polling will resume now. Keep the app open for Auto-trade.'
              : 'While Predict was in the background, lean polling was stopped. Auto-trade is currently off.',
            [
              {
                text: 'OK',
                onPress: () => {
                  if (stillAuto) {
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

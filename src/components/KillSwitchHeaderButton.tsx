import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { PROTECT_MONEY_RUNS_WHEN_AUTO_TRADE_OFF } from '../config/disclaimers';
import { useConfigStore } from '../state/configStore';
import { useRuntimeStore } from '../state/runtimeStore';

export function KillSwitchHeaderButton() {
  const autoTradeOn = useConfigStore((s) => s.config.auto_trade_enabled);
  const status = useRuntimeStore((s) => s.status);
  const kill = useRuntimeStore((s) => s.kill);
  const [killBusy, setKillBusy] = useState(false);

  const killDisarmed = !autoTradeOn || Boolean(status?.killSwitch);
  const a11yLabel = killBusy
    ? 'Disarming…'
    : killDisarmed
      ? 'Disarmed — Auto-trade off'
      : 'Kill switch — disarm now';

  const runKillSwitch = useCallback(async () => {
    if (killBusy) return;
    setKillBusy(true);
    const started = Date.now();
    try {
      kill();
    } finally {
      const wait = Math.max(0, 320 - (Date.now() - started));
      setTimeout(() => setKillBusy(false), wait);
    }
  }, [kill, killBusy]);

  const requestKillSwitch = useCallback(() => {
    if (killBusy) return;
    if (!autoTradeOn) {
      Alert.alert(
        'Already disarmed',
        'Auto-trade is off on this phone. To turn it back on, open the Settings tab and enable Auto-trade (you may need Face ID).\n\n' +
          PROTECT_MONEY_RUNS_WHEN_AUTO_TRADE_OFF
      );
      return;
    }
    Alert.alert(
      'Turn off Auto-trade now?',
      'This stops new auto-trades right away.\n\n' + PROTECT_MONEY_RUNS_WHEN_AUTO_TRADE_OFF,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disarm',
          style: 'destructive',
          onPress: () => void runKillSwitch(),
        },
      ]
    );
  }, [killBusy, autoTradeOn, runKillSwitch]);

  return (
    <Pressable
      onPress={requestKillSwitch}
      disabled={killBusy}
      testID="btn-kill-switch"
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ busy: killBusy, disabled: killBusy }}
      hitSlop={6}
      style={styles.hit}
    >
      <View
        style={[
          styles.badge,
          killDisarmed ? styles.badgeOff : styles.badgeOn,
          killBusy && styles.badgeBusy,
        ]}
        testID="kill-switch-badge"
      >
        {killBusy ? (
          <ActivityIndicator color="#fff" size="small" testID="kill-switch-spinner" />
        ) : (
          <Text style={[styles.mark, killDisarmed && styles.markOff]} accessibilityElementsHidden>
            !
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    padding: 4,
    marginRight: 6,
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  badgeOn: {
    backgroundColor: '#FF2D2D',
    borderColor: '#FFFFFF',
    shadowColor: '#FF2D2D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 7,
    elevation: 8,
  },
  badgeOff: {
    backgroundColor: '#5A2222',
    borderColor: 'rgba(255,255,255,0.28)',
    shadowOpacity: 0,
    elevation: 0,
  },
  badgeBusy: {
    opacity: 0.85,
  },
  mark: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 20,
    marginTop: -1,
  },
  markOff: {
    color: 'rgba(255,255,255,0.55)',
  },
});

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  KALSHI_API_KEY_HELP_LEAD,
  KALSHI_API_KEY_HELP_STEPS,
  KALSHI_API_KEY_HELP_TIP,
} from '../content/kalshiApiKeyHelp';
import { colors, spacing } from '../theme/tokens';

/** Inline how-to for Kalshi Key ID + PEM (Settings modal + Onboarding). */
export function KalshiApiKeyHelpContent() {
  return (
    <View style={styles.wrap} testID="kalshi-api-key-help">
      <Text style={styles.lead}>{KALSHI_API_KEY_HELP_LEAD}</Text>
      {KALSHI_API_KEY_HELP_STEPS.map((s) => (
        <View key={s.n} style={styles.step}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{s.n}</Text>
          </View>
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>{s.title}</Text>
            <Text style={styles.stepText}>{s.body}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.tip}>{KALSHI_API_KEY_HELP_TIP}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  lead: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 4,
  },
  step: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  badgeText: { color: colors.accent, fontWeight: '800', fontSize: 13 },
  stepBody: { flex: 1 },
  stepTitle: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  stepText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  tip: {
    color: colors.gold,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});

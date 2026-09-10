import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import {
  DISCLAIMER_LONG,
  DISCLAIMER_SHORT,
  DISCLAIMER_TITLE,
} from '../config/disclaimers';
import { recordDisclaimerReaccept } from '../storage/riskAcceptance';

export function DisclaimerReacceptScreen({ onAccepted }: { onAccepted: () => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function accept() {
    if (!checked || busy) return;
    setBusy(true);
    try {
      await recordDisclaimerReaccept();
      onAccepted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root} testID="screen-disclaimer-reaccept">
      <Text style={styles.title}>{DISCLAIMER_TITLE}</Text>
      <Text style={styles.lead}>
        Predict added Home Buy / Sell. Please read this updated warning and confirm before you
        continue.
      </Text>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner}>
        <Text style={styles.short}>{DISCLAIMER_SHORT}</Text>
        <Text style={styles.long}>{DISCLAIMER_LONG}</Text>
      </ScrollView>
      <View style={styles.checkRow}>
        <Switch
          testID="switch-disclaimer-reaccept"
          value={checked}
          onValueChange={setChecked}
          trackColor={{ false: colors.border, true: colors.gold }}
          thumbColor={colors.textPrimary}
        />
        <Text style={styles.checkLabel}>
          I understand — I am responsible for Auto-trade and for Home Buy / Sell taps, including
          possible losses
        </Text>
      </View>
      <Pressable
        testID="btn-disclaimer-reaccept"
        style={[styles.btn, (!checked || busy) && styles.btnOff]}
        onPress={() => void accept()}
        disabled={!checked || busy}
      >
        <Text style={styles.btnText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, paddingTop: 56 },
  title: { color: colors.gold, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  lead: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  scroll: { flex: 1 },
  scrollInner: { paddingBottom: 16 },
  short: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, marginBottom: 16, fontWeight: '600' },
  long: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 12 },
  checkLabel: { color: colors.textPrimary, flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  btn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnOff: { opacity: 0.45 },
  btnText: { color: '#0F1419', fontWeight: '800' },
});

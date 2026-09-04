import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { DISCLAIMER_SHORT } from '../config/disclaimers';

type Props = {
  visible: boolean;
  onCancel: () => void;
  /** Called after user checks “I understand” and taps Continue (Face ID / enable happens next). */
  onAccept: () => void;
};

/**
 * Shown when turning Auto-trade ON *only if* the current disclaimer was never accepted
 * (e.g. legacy installs before onboarding). New users accept once in onboarding.
 * Order when shown: this modal → Face ID (in setAutoTrade) → live orders allowed.
 */
export function AutoTradeRiskAcceptModal({ visible, onCancel, onAccept }: Props) {
  const [understood, setUnderstood] = useState(false);

  function close() {
    setUnderstood(false);
    onCancel();
  }

  function confirm() {
    if (!understood) return;
    setUnderstood(false);
    onAccept();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      testID="modal-autotrade-risk"
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Enable Auto-trade?</Text>
          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={styles.lead}>
              Auto-trade can place real Kalshi orders with your saved credentials when cushions and
              risk gates pass. Keep the app open — iOS will not keep polling in the background.
            </Text>
            <Text style={styles.disclaimer}>{DISCLAIMER_SHORT}</Text>
            <Text style={styles.lead}>
              By continuing you confirm you have read this warning and accept full responsibility for
              any gains or losses.
            </Text>
          </ScrollView>

          <View style={styles.checkRow}>
            <Switch
              testID="switch-autotrade-understand"
              value={understood}
              onValueChange={setUnderstood}
              trackColor={{ false: colors.border, true: colors.gold }}
              thumbColor={colors.textPrimary}
            />
            <Text style={styles.checkLabel}>
              I understand — no profit guarantee, and I am responsible for all trades
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              testID="btn-autotrade-risk-cancel"
              style={[styles.btn, styles.btnSecondary]}
              onPress={close}
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="btn-autotrade-risk-continue"
              style={[styles.btn, styles.btnPrimary, !understood && styles.btnDisabled]}
              disabled={!understood}
              onPress={confirm}
            >
              <Text style={styles.btnPrimaryText}>Continue</Text>
            </Pressable>
          </View>
          <Text style={styles.foot}>Next step: Face ID / biometrics to confirm.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.gold,
    padding: 16,
    maxHeight: '88%',
    gap: 12,
  },
  title: { color: colors.gold, fontSize: 18, fontWeight: '800' },
  body: { maxHeight: 280 },
  lead: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  disclaimer: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
    fontWeight: '600',
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkLabel: { color: colors.textPrimary, fontSize: 13, lineHeight: 18, flex: 1, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnSecondary: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnDisabled: { opacity: 0.45 },
  btnPrimaryText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  btnSecondaryText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  foot: { color: colors.mute, fontSize: 11, textAlign: 'center' },
});

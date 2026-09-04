import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { hasCredentials } from '../services/credentials';
import { loadOnboardingRecord } from '../storage/onboarding';
import {
  buildPostTrialNextStepsPlan,
  isPostTrialNextStepsDismissed,
  markPostTrialNextStepsDismissed,
  PostTrialNextStepsPlan,
  PostTrialStepId,
  shouldShowPostTrialNextSteps,
} from '../storage/postTrialNextSteps';
import { useConfigStore } from '../state/configStore';
import { useRuntimeStore } from '../state/runtimeStore';

type Props = {
  /** Navigate to Settings tab (existing screen — no new flow). */
  onOpenSettings: () => void;
};

/**
 * One-time post-trial checklist. Non-blocking; never re-asks onboarding mode.
 */
export function PostTrialNextStepsModal({ onOpenSettings }: Props) {
  const autoTradeEnabled = useConfigStore((s) => s.config.auto_trade_enabled);
  const pollerRunning = useRuntimeStore((s) => Boolean(s.status?.running));
  const start = useRuntimeStore((s) => s.start);

  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [intent, setIntent] = useState<'alerts_only' | 'alerts_and_autotrade' | null>(null);
  const [hasCreds, setHasCreds] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshCreds = useCallback(async () => {
    setHasCreds(await hasCredentials());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [wasDismissed, rec, creds] = await Promise.all([
        isPostTrialNextStepsDismissed(),
        loadOnboardingRecord(),
        hasCredentials(),
      ]);
      if (cancelled) return;
      setDismissed(wasDismissed);
      setIntent(rec?.intentMode ?? null);
      setHasCreds(creds);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const plan: PostTrialNextStepsPlan | null = useMemo(() => {
    if (!intent) return null;
    return buildPostTrialNextStepsPlan({
      intent,
      hasCredentials: hasCreds,
      pollerRunning,
      autoTradeEnabled,
    });
  }, [intent, hasCreds, pollerRunning, autoTradeEnabled]);

  const visible =
    ready &&
    shouldShowPostTrialNextSteps({
      dismissed,
      intent,
      plan,
    });

  useEffect(() => {
    if (!ready || dismissed || !plan?.allDone) return;
    void (async () => {
      await markPostTrialNextStepsDismissed();
      setDismissed(true);
    })();
  }, [ready, dismissed, plan?.allDone]);

  async function dismiss() {
    await markPostTrialNextStepsDismissed();
    setDismissed(true);
  }

  async function onStepAction(id: PostTrialStepId) {
    if (busy) return;
    setBusy(true);
    try {
      if (id === 'start_poller') {
        if (!pollerRunning) start();
        return;
      }
      if (id === 'add_kalshi' || id === 'enable_autotrade') {
        await markPostTrialNextStepsDismissed();
        setDismissed(true);
        onOpenSettings();
        return;
      }
    } finally {
      setBusy(false);
      void refreshCreds();
    }
  }

  if (!visible || !plan) return null;

  const nextIncomplete = plan.steps.find((s) => !s.done);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => void dismiss()}
      testID="modal-post-trial-next-steps"
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title} testID="post-trial-headline">
            {plan.headline}
          </Text>
          <Text style={styles.subhead}>{plan.subhead}</Text>

          <View style={styles.steps} testID="post-trial-steps">
            {plan.steps.map((step, i) => (
              <View
                key={step.id}
                style={styles.stepRow}
                testID={`post-trial-step-${step.id}`}
              >
                <View style={[styles.badge, step.done && styles.badgeDone]}>
                  <Text style={styles.badgeText}>{step.done ? '✓' : String(i + 1)}</Text>
                </View>
                <View style={styles.stepCopy}>
                  <Text style={[styles.stepTitle, step.done && styles.stepTitleDone]}>
                    {step.title}
                  </Text>
                  <Text style={styles.stepDetail}>{step.detail}</Text>
                </View>
              </View>
            ))}
          </View>

          {nextIncomplete ? (
            <Pressable
              testID={`btn-post-trial-action-${nextIncomplete.id}`}
              style={[styles.cta, busy && styles.ctaDisabled]}
              disabled={busy}
              onPress={() => void onStepAction(nextIncomplete.id)}
            >
              <Text style={styles.ctaText}>
                {nextIncomplete.id === 'start_poller'
                  ? 'Start poller now'
                  : nextIncomplete.id === 'add_kalshi'
                    ? 'Open Settings · Kalshi'
                    : 'Open Settings · Auto-trade'}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            testID="btn-post-trial-dismiss"
            style={styles.secondary}
            onPress={() => void dismiss()}
            disabled={busy}
          >
            <Text style={styles.secondaryText}>I&apos;ll explore</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 12,
  },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  subhead: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  steps: { gap: 12, marginTop: 4 },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  badgeDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  badgeText: { color: colors.textPrimary, fontWeight: '800', fontSize: 12 },
  stepCopy: { flex: 1, gap: 2 },
  stepTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  stepTitleDone: { color: colors.textSecondary },
  stepDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  cta: {
    marginTop: 8,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  secondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 14 },
});

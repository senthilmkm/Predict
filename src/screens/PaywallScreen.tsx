import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../theme/tokens';
import {
  activePromotions,
  getPricingConfig,
  primaryCtaLabel,
} from '../config/pricing';
import { hasPredictAccess, useSubscriptionStore } from '../state/subscriptionStore';
import { SupportContactFooter } from '../components/SupportContactFooter';

type PaywallBodyProps = {
  /** When true, show status for already-subscribed users and Apple manage CTA. */
  manageMode?: boolean;
  onClose?: () => void;
};

export function PaywallBody({ manageMode = false, onClose }: PaywallBodyProps) {
  const pricing = getPricingConfig();
  const sub = pricing.subscription;
  const promo = useMemo(() => activePromotions()[0] || null, []);
  const entitled = useSubscriptionStore((s) => hasPredictAccess(s));
  const busy = useSubscriptionStore((s) => s.busy);
  const error = useSubscriptionStore((s) => s.error);
  const sdkConfigured = useSubscriptionStore((s) => s.sdkConfigured);
  const isTrialing = useSubscriptionStore((s) => s.isTrialing);
  const willRenew = useSubscriptionStore((s) => s.willRenew);
  const managementUrl = useSubscriptionStore((s) => s.managementUrl);
  const purchase = useSubscriptionStore((s) => s.purchase);
  const restore = useSubscriptionStore((s) => s.restore);
  const [localNote, setLocalNote] = useState<string | null>(null);

  const cta = primaryCtaLabel();
  const statusLine = !sub.enabled
    ? 'Gating disabled'
    : entitled
      ? isTrialing
        ? 'Free trial active'
        : willRenew
          ? 'Active · renews monthly'
          : 'Active'
      : 'Not subscribed';

  return (
    <View style={styles.root} testID={manageMode ? 'paywall-manage-modal' : 'screen-paywall'}>
      <ScrollView
        contentContainerStyle={[styles.content, manageMode && styles.contentModal]}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroGlow} />

        {manageMode && onClose ? (
          <View style={styles.modalHeader}>
            <Text style={styles.modalHeaderTitle}>Predict Pro</Text>
            <Pressable
              testID="btn-paywall-close"
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
            >
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.brand}>{pricing.app.name}</Text>
        <Text style={styles.tag}>{pricing.app.tagline}</Text>

        {manageMode ? (
          <View style={styles.statusPill} testID="paywall-status-pill">
            <Text style={styles.statusPillText}>{statusLine}</Text>
          </View>
        ) : null}

        {promo && !entitled ? (
          <View style={styles.promo} testID="paywall-promo">
            <Text style={styles.promoBadge}>{promo.badge}</Text>
            <Text style={styles.promoTitle}>{promo.title}</Text>
            <Text style={styles.promoSub}>{promo.subtitle}</Text>
          </View>
        ) : null}

        <Text style={styles.headline}>
          {manageMode && entitled ? 'Your subscription' : sub.paywall.headline}
        </Text>
        <Text style={styles.subhead}>
          {manageMode && entitled
            ? 'Restore purchases, review plan details, or manage billing in Apple Subscriptions.'
            : sub.paywall.subheadline}
        </Text>

        <View style={styles.priceCard}>
          {sub.freeTrial.enabled && !entitled ? (
            <Text style={styles.trialLabel} testID="paywall-trial-label">
              {sub.freeTrial.label}
            </Text>
          ) : null}
          <View style={styles.priceRow}>
            <Text style={styles.price}>{sub.priceLabel}</Text>
            <Text style={styles.period}>{sub.periodLabel}</Text>
          </View>
          {sub.freeTrial.enabled ? (
            <Text style={styles.trialDetail}>{sub.freeTrial.detail}</Text>
          ) : null}
        </View>

        <View style={styles.features}>
          {sub.features.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Text style={styles.check}>✓</Text>
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {!entitled ? (
          <Pressable
            testID="btn-paywall-subscribe"
            style={[styles.cta, busy && styles.ctaDisabled]}
            disabled={busy}
            onPress={async () => {
              setLocalNote(null);
              const next = await purchase();
              if (next.error) setLocalNote(next.error);
              else if (next.entitled && onClose) onClose();
            }}
          >
            {busy ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.ctaText}>{cta}</Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            testID="btn-paywall-apple-manage"
            style={[styles.ctaSecondary, busy && styles.ctaDisabled]}
            disabled={busy}
            onPress={() => {
              const url = managementUrl || pricing.urls.manageSubscriptionsIOS;
              void Linking.openURL(url);
            }}
          >
            <Text style={styles.ctaSecondaryText}>Manage in Apple Subscriptions</Text>
          </Pressable>
        )}

        <Pressable
          testID="btn-paywall-restore"
          style={styles.restoreBtn}
          disabled={busy}
          onPress={async () => {
            setLocalNote(null);
            const next = await restore();
            if (next.error) setLocalNote(next.error);
            else if (next.entitled) setLocalNote('Purchases restored.');
            else setLocalNote('No active subscription for this Apple ID.');
          }}
        >
          <Text style={styles.restoreText}>Restore Purchases</Text>
        </Pressable>

        {!sdkConfigured ? (
          <Text style={styles.warn} testID="paywall-sdk-warn">
            RevenueCat API key not set yet. Add it in pricing.json before App Store builds.
          </Text>
        ) : null}

        {localNote || error ? (
          <Text style={styles.error} testID="paywall-error">
            {localNote || error}
          </Text>
        ) : null}

        <Text style={styles.footnote}>{sub.paywall.footnote}</Text>
        <Text style={styles.antiAbuse}>{pricing.antiAbuse.note}</Text>

        <View style={styles.legalRow}>
          <Pressable
            testID="link-paywall-privacy"
            onPress={() => void Linking.openURL(pricing.urls.privacy)}
          >
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </Pressable>
          <Text style={styles.legalDot}>·</Text>
          <Pressable
            testID="link-paywall-terms"
            onPress={() => void Linking.openURL(pricing.urls.terms)}
          >
            <Text style={styles.legalLink}>Terms of Use</Text>
          </Pressable>
        </View>

        <SupportContactFooter compact />
      </ScrollView>
    </View>
  );
}

/** Full-screen gate when the user is not entitled. */
export function PaywallScreen() {
  const entitled = useSubscriptionStore((s) => hasPredictAccess(s));
  if (entitled) return null;
  return <PaywallBody />;
}

/** Settings → Predict Pro → Manage */
export function PaywallManageModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <PaywallBody manageMode onClose={onClose} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 56,
    paddingBottom: 40,
    gap: 12,
  },
  contentModal: {
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalHeaderTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeBtnText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  heroGlow: {
    position: 'absolute',
    top: -40,
    alignSelf: 'center',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(61, 184, 160, 0.14)',
  },
  brand: {
    color: colors.gold,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  tag: { color: colors.textSecondary, fontSize: 14, marginBottom: 4 },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(61, 184, 160, 0.16)',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusPillText: { color: colors.accent, fontWeight: '800', fontSize: 12 },
  promo: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: 'rgba(198, 167, 94, 0.12)',
    padding: 14,
    gap: 4,
  },
  promoBadge: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  promoTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  promoSub: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  headline: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 8,
    lineHeight: 36,
  },
  subhead: { color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  priceCard: {
    marginTop: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 6,
  },
  trialLabel: {
    color: colors.accent,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  price: { color: colors.textPrimary, fontSize: 40, fontWeight: '800' },
  period: { color: colors.textSecondary, fontSize: 16, marginBottom: 8 },
  trialDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  features: { gap: 10, marginTop: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  check: {
    color: colors.accent,
    fontWeight: '900',
    fontSize: 15,
    marginTop: 1,
  },
  featureText: { color: colors.textPrimary, fontSize: 15, flex: 1, lineHeight: 21 },
  cta: {
    marginTop: 10,
    backgroundColor: colors.accent,
    borderRadius: 16,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  ctaSecondary: {
    marginTop: 10,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 16,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  ctaSecondaryText: { color: colors.accent, fontSize: 16, fontWeight: '800' },
  ctaDisabled: { opacity: 0.7 },
  ctaText: { color: colors.bg, fontSize: 17, fontWeight: '800' },
  restoreBtn: { alignItems: 'center', paddingVertical: 10 },
  restoreText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  warn: {
    color: colors.warn,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  error: {
    color: colors.loss,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  footnote: {
    color: colors.mute,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 4,
  },
  antiAbuse: {
    color: colors.mute,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 8,
  },
  legalLink: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  legalDot: { color: colors.mute },
});

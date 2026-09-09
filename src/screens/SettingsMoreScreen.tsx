import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { getPricingConfig } from '../config/pricing';
import { FaqAccordion } from '../components/FaqAccordion';
import { TradingDisclaimer } from '../components/TradingDisclaimer';
import { PaywallManageModal } from './PaywallScreen';
import {
  AutoTradeRiskAcceptance,
  getLatestAutoTradeRiskAcceptance,
} from '../storage/riskAcceptance';
import { hasPredictAccess, useSubscriptionStore } from '../state/subscriptionStore';
import { getPersistentUserId, getUserDisplayName } from '../services/userId';

export function SettingsMoreScreen() {
  const pricing = getPricingConfig();
  const subEntitled = useSubscriptionStore((s) => hasPredictAccess(s));
  const subTrialing = useSubscriptionStore((s) => s.isTrialing);
  const subBusy = useSubscriptionStore((s) => s.busy);
  const subProductId = useSubscriptionStore((s) => s.productId);
  const subExpirationAt = useSubscriptionStore((s) => s.expirationAt);
  const subWillRenew = useSubscriptionStore((s) => s.willRenew);
  const refreshSub = useSubscriptionStore((s) => s.refresh);

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lastRiskAcceptance, setLastRiskAcceptance] =
    useState<AutoTradeRiskAcceptance | null>(null);
  const [cloudUserId, setCloudUserId] = useState<string>('');
  const [displayNameState, setDisplayNameState] = useState<string>('');

  useEffect(() => {
    void getPersistentUserId().then(setCloudUserId);
    void getUserDisplayName().then(setDisplayNameState);
    void getLatestAutoTradeRiskAcceptance().then(setLastRiskAcceptance);
  }, []);

  const onRefreshStatus = useCallback(async () => {
    await refreshSub();
    setFeedback('Subscription status refreshed');
  }, [refreshSub]);

  return (
    <View style={styles.root} testID="screen-settings-more">
      <ScrollView contentContainerStyle={styles.content}>
        {feedback ? (
          <Text style={styles.actionFeedback} testID="settings-more-message">
            {feedback}
          </Text>
        ) : null}

        <Text style={styles.section}>Subscription</Text>
        <View style={styles.subCard} testID="subscription-manage-card">
          <View style={styles.subCardHeader}>
            <Text style={styles.slimLabel}>Predict Pro</Text>
            <Pressable
              testID="btn-manage-subscription"
              onPress={() => setPaywallOpen(true)}
              hitSlop={10}
              style={styles.manageLinkBtn}
            >
              <Text style={styles.manageLink}>Manage</Text>
            </Pressable>
          </View>
          <Text style={styles.slimMeta} testID="subscription-status">
            {!pricing.subscription.enabled
              ? 'Gating disabled in pricing.json'
              : subEntitled
                ? subTrialing
                  ? 'Free trial active'
                  : subWillRenew
                    ? 'Active · renews monthly'
                    : 'Active'
                : 'Not subscribed'}
          </Text>
          <Text style={styles.hint}>
            {pricing.subscription.priceLabel}
            {pricing.subscription.periodLabel}
            {pricing.subscription.freeTrial.enabled
              ? ` · ${pricing.subscription.freeTrial.label}`
              : ''}
          </Text>
          {subProductId ? (
            <Text style={styles.hint}>Product: {subProductId}</Text>
          ) : null}
          {subExpirationAt ? (
            <Text style={styles.hint}>
              Renews / ends: {new Date(subExpirationAt).toLocaleString()}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={[styles.slimCard, subBusy && styles.btnDisabled]}
          onPress={() => void onRefreshStatus()}
          testID="btn-refresh-subscription"
          disabled={subBusy}
        >
          <Text style={styles.slimLabel}>Refresh status</Text>
          {subBusy ? (
            <View style={styles.btnBusyRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.slimValue}>Refreshing…</Text>
            </View>
          ) : (
            <Text style={styles.slimValue}>Refresh</Text>
          )}
        </Pressable>
        <Text style={styles.hint}>
          Tap Manage for plan details, Restore Purchases, Privacy Policy, and Terms of Use.
        </Text>

        <Text style={styles.section}>Account & Cloud Identity</Text>
        <View style={styles.subCard} testID="account-cloud-identity-card">
          <Text style={styles.slimLabel}>{displayNameState || 'Apple User'}</Text>
          <Text style={styles.slimMeta} testID="cloud-user-id">
            User ID: {cloudUserId || 'Loading...'}
          </Text>
          <Text style={styles.hint}>
            This persistent User ID matches your account in the Admin Portal for cloud
            synchronization and automated trade execution.
          </Text>
        </View>

        <Text style={styles.section}>Legal</Text>
        <TradingDisclaimer
          variant="long"
          showTitle
          collapsible
          defaultCollapsed
          testID="settings-disclaimer"
        />
        <View style={styles.subCard} testID="risk-acceptance-local">
          <Text style={styles.slimLabel}>Risk disclaimer acceptance (this device)</Text>
          {lastRiskAcceptance ? (
            <>
              <Text style={styles.slimMeta} testID="risk-acceptance-at">
                Last recorded: {new Date(lastRiskAcceptance.acceptedAt).toLocaleString()}
                {lastRiskAcceptance.source ? ` · ${lastRiskAcceptance.source}` : ''}
              </Text>
              <Text style={styles.hint}>
                Disclaimer {lastRiskAcceptance.disclaimerVersion} · app{' '}
                {lastRiskAcceptance.appVersion}
                {lastRiskAcceptance.buildNumber
                  ? ` (${lastRiskAcceptance.buildNumber})`
                  : ''}{' '}
                · stored only on this phone. Same disclaimer is not asked again until the text
                version changes.
              </Text>
            </>
          ) : (
            <Text style={styles.hint} testID="risk-acceptance-none">
              No acceptance recorded yet. First-launch onboarding saves this after you confirm.
            </Text>
          )}
        </View>

        <View style={styles.sectionFaq} testID="section-faq">
          <Text style={styles.sectionNoTop}>FAQ</Text>
        </View>
        <FaqAccordion />
      </ScrollView>

      <PaywallManageModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: 5, paddingBottom: 48 },
  actionFeedback: {
    color: colors.gold,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  slimCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 34,
  },
  subCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  subCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  manageLinkBtn: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  manageLink: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '800',
  },
  slimLabel: { color: colors.textPrimary, fontSize: 13, flex: 1 },
  slimValue: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  slimMeta: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  btnBusyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnDisabled: { opacity: 0.65 },
  section: {
    color: colors.gold,
    fontWeight: '700',
    marginTop: spacing.sm,
    fontSize: 14,
  },
  sectionFaq: {
    marginTop: spacing.sm,
    paddingVertical: 2,
  },
  sectionNoTop: { color: colors.gold, fontWeight: '700', fontSize: 14, marginTop: 0 },
  hint: { color: colors.mute, fontSize: 11, lineHeight: 15 },
});

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';
import { PaywallBody } from './PaywallScreen';
import { KalshiApiKeyHelpContent } from '../components/KalshiApiKeyHelpContent';
import { DISCLAIMER_LONG, DISCLAIMER_SHORT, DISCLAIMER_TITLE } from '../config/disclaimers';
import { AssetKey } from '../config/types';
import { useConfigStore } from '../state/configStore';
import { hasPredictAccess, useSubscriptionStore } from '../state/subscriptionStore';
import {
  assertPemLooksValid,
} from '../services/kalshi/sign';
import { saveCredentials } from '../services/credentials';
import { cloudClient } from '../services/cloud/cloudClient';
import { requestNotificationPermission } from '../services/notifications';
import { recordOnboardingRiskAcceptance } from '../storage/riskAcceptance';
import {
  OnboardingCapital,
  OnboardingExperience,
  OnboardingIntentMode,
  OnboardingRecord,
  createEmptyOnboardingRecord,
  loadOnboardingRecord,
  markOnboardingCompleted,
  saveOnboardingRecord,
} from '../storage/onboarding';

const STEPS = [
  'Welcome',
  'Risk',
  'Your mode',
  'Alerts',
  'Kalshi',
  'Trial',
] as const;

const ALL_ASSETS: AssetKey[] = ['Gold', 'BTC', 'ETH', 'WTI', 'Silver'];

type Props = {
  onFinished: () => void;
};

export function OnboardingScreen({ onFinished }: Props) {
  const setConfig = useConfigStore((s) => s.setConfig);
  const entitled = useSubscriptionStore((s) => hasPredictAccess(s));
  const [record, setRecord] = useState<OnboardingRecord | null>(null);
  const [step, setStep] = useState(0);
  const [riskChecked, setRiskChecked] = useState(false);
  const [intent, setIntent] = useState<OnboardingIntentMode | null>('alerts_only');
  const [assets, setAssets] = useState<AssetKey[]>(['Gold', 'BTC']);
  const [experience, setExperience] = useState<OnboardingExperience | null>(null);
  const [capital, setCapital] = useState<OnboardingCapital | null>(null);
  const [keyId, setKeyId] = useState('');
  const [pem, setPem] = useState('');
  const [kalshiBusy, setKalshiBusy] = useState(false);
  const [kalshiNote, setKalshiNote] = useState<string | null>(null);
  const [notifBusy, setNotifBusy] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let rec = await loadOnboardingRecord();
        if (!rec) {
          rec = createEmptyOnboardingRecord();
          await saveOnboardingRecord(rec);
        }
        if (cancelled) return;
        setRecord(rec);
        setStep(Math.min(Math.max(rec.currentStep || 0, 0), 5));
        setRiskChecked(Boolean(rec.riskUnderstoodChecked));
        setIntent(rec.intentMode || 'alerts_only');
        setAssets(rec.assetsOfInterest?.length ? rec.assetsOfInterest : ['Gold', 'BTC']);
        setExperience(rec.experienceLevel);
        setCapital(rec.capitalComfort);
      } catch (e: any) {
        if (!cancelled) setBootError(String(e?.message || e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Trial/paywall step: leave onboarding as soon as subscription is active
  useEffect(() => {
    if (step === 5 && entitled) onFinished();
  }, [step, entitled, onFinished]);

  const persist = useCallback(async (next: OnboardingRecord) => {
    setRecord(next);
    await saveOnboardingRecord(next);
  }, []);

  const applyModeToConfig = useCallback(
    (_mode: OnboardingIntentMode, picked: AssetKey[]) => {
      const assets_enabled = {
        WTI: false,
        Gold: false,
        Silver: false,
        BTC: false,
        ETH: false,
      } as Record<AssetKey, boolean>;
      for (const a of picked) assets_enabled[a] = true;
      // If nothing selected, keep all on
      if (picked.length === 0) {
        for (const a of ALL_ASSETS) assets_enabled[a] = true;
      }
      setConfig({
        alerts_enabled: true,
        // Intent only — Auto-trade stays OFF until Settings + Face ID
        auto_trade_enabled: false,
        execution_mode: 'off',
        live_armed: false,
        assets_enabled,
      });
    },
    [setConfig]
  );

  async function goNext() {
    if (!record) return;

    if (step === 1) {
      if (!riskChecked) return;
      await recordOnboardingRiskAcceptance();
      const next = {
        ...record,
        riskUnderstoodChecked: true,
        riskAcceptedAt: new Date().toISOString(),
        disclaimerVersion: record.disclaimerVersion,
        currentStep: 2,
      };
      await persist(next);
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!intent || assets.length === 0) return;
      applyModeToConfig(intent, assets);
      const next = {
        ...record,
        intentMode: intent,
        assetsOfInterest: assets,
        experienceLevel: experience,
        capitalComfort: capital,
        modeChosenAt: new Date().toISOString(),
        currentStep: 3,
      };
      await persist(next);
      setStep(3);
      return;
    }

    if (step === 4) {
      // Next without saving credentials = treat as skip path unless already saved
      const next = await markOnboardingCompleted({
        ...record,
        kalshiSkipped: !record.kalshiCredentialsAdded,
        kalshiStepAt: new Date().toISOString(),
        currentStep: 5,
      });
      await persist(next);
      setStep(5);
      return;
    }

    if (step >= 5) {
      onFinished();
      return;
    }

    const nextStep = step + 1;
    await persist({ ...record, currentStep: nextStep });
    setStep(nextStep);
  }

  async function goBack() {
    if (!record || step <= 0) return;
    const nextStep = step - 1;
    await persist({ ...record, currentStep: nextStep });
    setStep(nextStep);
  }

  async function skipNotifications() {
    if (!record) return;
    const next = {
      ...record,
      notificationsStatus: 'skipped' as const,
      notificationsAskedAt: new Date().toISOString(),
      currentStep: 4,
    };
    await persist(next);
    setStep(4);
  }

  async function enableNotifications() {
    if (!record) return;
    setNotifBusy(true);
    try {
      const status = await requestNotificationPermission();
      const mapped =
        status === 'granted'
          ? 'granted'
          : status === 'unavailable'
            ? 'unavailable'
            : 'denied';
      const next = {
        ...record,
        notificationsStatus: mapped as OnboardingRecord['notificationsStatus'],
        notificationsAskedAt: new Date().toISOString(),
        currentStep: 4,
      };
      await persist(next);
      setStep(4);
    } finally {
      setNotifBusy(false);
    }
  }

  async function skipKalshi() {
    if (!record) return;
    const next = await markOnboardingCompleted({
      ...record,
      kalshiSkipped: true,
      kalshiCredentialsAdded: false,
      kalshiStepAt: new Date().toISOString(),
      currentStep: 5,
    });
    await persist(next);
    setStep(5);
  }

  async function saveKalshiAndContinue() {
    if (!record) return;
    setKalshiNote(null);
    setKalshiBusy(true);
    try {
      assertPemLooksValid(pem);
      await saveCredentials({
        keyId: keyId.trim(),
        privateKeyPem: pem.trim(),
        env: 'production',
      });
      await cloudClient.uploadCredentials({
        keyId: keyId.trim(),
        privateKeyPem: pem.trim(),
      });
      const next = await markOnboardingCompleted({
        ...record,
        kalshiCredentialsAdded: true,
        kalshiSkipped: false,
        kalshiStepAt: new Date().toISOString(),
        currentStep: 5,
      });
      await persist(next);
      setStep(5);
    } catch (e: any) {
      setKalshiNote(String(e?.message || e));
    } finally {
      setKalshiBusy(false);
    }
  }

  async function importPem() {
    setKalshiNote(null);
    setKalshiBusy(true);
    try {
      const DocumentPicker = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        type: ['*/*', 'text/plain', 'application/x-pem-file', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const res = await fetch(result.assets[0].uri);
      if (!res.ok) throw new Error('Could not read key file');
      const text = await res.text();
      assertPemLooksValid(text);
      setPem(text);
      setKalshiNote('PEM imported — tap Save & continue');
    } catch (e: any) {
      setKalshiNote(String(e?.message || e));
    } finally {
      setKalshiBusy(false);
    }
  }

  const canNext = useMemo(() => {
    if (step === 1) return riskChecked;
    if (step === 2) return Boolean(intent) && assets.length > 0;
    if (step === 5) return false; // paywall uses its own CTA
    return true;
  }, [step, riskChecked, intent, assets.length]);

  const showBack = step > 0 && step < 5;
  const showNext = step !== 3 && step !== 5; // notif has custom CTAs; paywall has purchase
  const showSkipNotif = step === 3;
  const showSkipKalshi = step === 4;

  if (bootError) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.error}>{bootError}</Text>
      </SafeAreaView>
    );
  }

  if (!record) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']} testID="screen-onboarding">
      <View style={styles.header}>
        <Text style={styles.brand}>Predict</Text>
        <Text style={styles.stepLabel}>
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </Text>
        <View style={styles.dots}>
          {STEPS.map((_, i) => (
            <View
              key={STEPS[i]}
              style={[styles.dot, i === step && styles.dotActive, i < step && styles.dotDone]}
            />
          ))}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 0 ? <WelcomeStep /> : null}
        {step === 1 ? (
          <RiskStep checked={riskChecked} onChecked={setRiskChecked} />
        ) : null}
        {step === 2 ? (
          <ModeStep
            intent={intent}
            onIntent={setIntent}
            assets={assets}
            onToggleAsset={(a) =>
              setAssets((prev) =>
                prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
              )
            }
            experience={experience}
            onExperience={setExperience}
            capital={capital}
            onCapital={setCapital}
          />
        ) : null}
        {step === 3 ? <NotificationsStep /> : null}
        {step === 4 ? (
          <KalshiStep
            keyId={keyId}
            pem={pem}
            onKeyId={setKeyId}
            onPem={setPem}
            onImport={() => void importPem()}
            note={kalshiNote}
            busy={kalshiBusy}
          />
        ) : null}
        {step === 5 ? (
          <View style={styles.paywallWrap} testID="onboarding-paywall">
            <Text style={styles.paywallIntro}>
              Setup saved on this phone. Start your free trial to unlock lean signals.
            </Text>
            <PaywallBody />
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {step === 3 ? (
          <View style={styles.row}>
            {showBack ? (
              <Pressable testID="btn-onboarding-back" style={styles.btnGhost} onPress={() => void goBack()}>
                <Text style={styles.btnGhostText}>Back</Text>
              </Pressable>
            ) : (
              <View style={styles.btnGhostPlaceholder} />
            )}
            <Pressable
              testID="btn-onboarding-skip-notif"
              style={styles.btnSecondary}
              onPress={() => void skipNotifications()}
              disabled={notifBusy}
            >
              <Text style={styles.btnSecondaryText}>Skip</Text>
            </Pressable>
            <Pressable
              testID="btn-onboarding-enable-notif"
              style={[styles.btnPrimary, notifBusy && styles.btnDisabled]}
              disabled={notifBusy}
              onPress={() => void enableNotifications()}
            >
              {notifBusy ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.btnPrimaryText}>Allow</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {step === 4 ? (
          <View style={styles.col}>
            <View style={styles.row}>
              <Pressable testID="btn-onboarding-back" style={styles.btnGhost} onPress={() => void goBack()}>
                <Text style={styles.btnGhostText}>Back</Text>
              </Pressable>
              <Pressable
                testID="btn-onboarding-skip-kalshi"
                style={styles.btnSecondary}
                onPress={() => void skipKalshi()}
                disabled={kalshiBusy}
              >
                <Text style={styles.btnSecondaryText}>Skip for now</Text>
              </Pressable>
            </View>
            <Pressable
              testID="btn-onboarding-save-kalshi"
              style={[
                styles.btnPrimaryWide,
                (kalshiBusy || !keyId.trim() || !pem.trim()) && styles.btnDisabled,
              ]}
              disabled={kalshiBusy || !keyId.trim() || !pem.trim()}
              onPress={() => void saveKalshiAndContinue()}
            >
              {kalshiBusy ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.btnPrimaryText}>Save & continue</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {step !== 3 && step !== 4 && step !== 5 ? (
          <View style={styles.row}>
            {showBack ? (
              <Pressable testID="btn-onboarding-back" style={styles.btnGhost} onPress={() => void goBack()}>
                <Text style={styles.btnGhostText}>Back</Text>
              </Pressable>
            ) : (
              <View style={styles.btnGhostPlaceholder} />
            )}
            {showNext ? (
              <Pressable
                testID="btn-onboarding-next"
                style={[styles.btnPrimary, !canNext && styles.btnDisabled]}
                disabled={!canNext}
                onPress={() => void goNext()}
              >
                <Text style={styles.btnPrimaryText}>{step === 0 ? 'Get started' : 'Next'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {step === 5 ? (
          <Pressable testID="btn-onboarding-back" style={styles.btnGhostAlone} onPress={() => void goBack()}>
            <Text style={styles.btnGhostText}>Back</Text>
          </Pressable>
        ) : null}

        {showSkipNotif || showSkipKalshi ? null : null}
      </View>
    </SafeAreaView>
  );
}

function WelcomeStep() {
  return (
    <View testID="onboarding-step-welcome">
      <Text style={styles.hero}>Trade 15‑minute markets with clearer lean signals</Text>
      <Text style={styles.sub}>
        Predict watches Kalshi-style 15‑minute windows for Gold, BTC, and more — then tells you which
        side the lean favors.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>How it works</Text>
        <HowRow n="1" title="We measure the lean" body="Live price vs strike, with your cushion rules." />
        <HowRow n="2" title="You get a signal" body="On-device alerts when a lean looks actionable." />
        <HowRow
          n="3"
          title="You choose what happens next"
          body="Alerts only — you trade yourself. Or later, Auto-trade can place orders with your Kalshi keys."
        />
      </View>
      <Text style={styles.fine}>
        Nothing here guarantees profit. You stay in control of credentials, risk limits, and whether
        Auto-trade is ever turned on.
      </Text>
    </View>
  );
}

function HowRow({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <View style={styles.howRow}>
      <View style={styles.howBadge}>
        <Text style={styles.howBadgeText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.howTitle}>{title}</Text>
        <Text style={styles.howBody}>{body}</Text>
      </View>
    </View>
  );
}

function RiskStep({
  checked,
  onChecked,
}: {
  checked: boolean;
  onChecked: (v: boolean) => void;
}) {
  return (
    <View testID="onboarding-step-risk">
      <Text style={styles.hero}>{DISCLAIMER_TITLE}</Text>
      <Text style={styles.sub}>{DISCLAIMER_SHORT}</Text>
      <View style={styles.card}>
        <Text style={styles.disclaimerLong}>{DISCLAIMER_LONG}</Text>
      </View>
      <View style={styles.checkRow}>
        <Switch
          testID="switch-onboarding-risk"
          value={checked}
          onValueChange={onChecked}
          trackColor={{ false: colors.border, true: colors.gold }}
          thumbColor={colors.textPrimary}
        />
        <Text style={styles.checkLabel}>
          I understand — no profit guarantee, and I am responsible for all trades (alerts or
          Auto-trade)
        </Text>
      </View>
      <Text style={styles.fine}>
        This acceptance is saved on this phone. We will not ask you to accept this same disclaimer
        again unless the legal text changes.
      </Text>
    </View>
  );
}

function ModeStep({
  intent,
  onIntent,
  assets,
  onToggleAsset,
  experience,
  onExperience,
  capital,
  onCapital,
}: {
  intent: OnboardingIntentMode | null;
  onIntent: (m: OnboardingIntentMode) => void;
  assets: AssetKey[];
  onToggleAsset: (a: AssetKey) => void;
  experience: OnboardingExperience | null;
  onExperience: (e: OnboardingExperience) => void;
  capital: OnboardingCapital | null;
  onCapital: (c: OnboardingCapital) => void;
}) {
  return (
    <View testID="onboarding-step-mode">
      <Text style={styles.hero}>Choose how you want to start</Text>
      <Text style={styles.sub}>
        Pick one path below. You can change this anytime in Settings.
      </Text>

      <Pressable
        testID="chip-mode-alerts"
        style={[styles.modeCard, intent === 'alerts_only' && styles.modeCardOn]}
        onPress={() => onIntent('alerts_only')}
      >
        <View style={styles.modeHeaderRow}>
          <View style={styles.pillBeginner}>
            <Text style={styles.pillBeginnerText}>RECOMMENDED FOR BEGINNERS</Text>
          </View>
          <View style={[styles.radioCircle, intent === 'alerts_only' && styles.radioCircleOn]}>
            {intent === 'alerts_only' ? <Text style={styles.radioCheckText}>✓</Text> : null}
          </View>
        </View>

        <Text style={styles.modeTitle}>Lean signals only</Text>
        <Text style={styles.modeBullet}>• Receive real-time probability lean alerts</Text>
        <Text style={styles.modeBullet}>• You place trades yourself manually in Kalshi</Text>
        <Text style={styles.modeBullet}>• Zero risk of automated order placement</Text>

        {intent === 'alerts_only' ? (
          <View style={styles.selectedBadge}>
            <Text style={styles.selectedBadgeText}>✓ SELECTED PATH</Text>
          </View>
        ) : (
          <Text style={styles.modeTag}>Safest way to learn</Text>
        )}
      </Pressable>

      <Pressable
        testID="chip-mode-both"
        style={[styles.modeCard, intent === 'alerts_and_autotrade' && styles.modeCardOn]}
        onPress={() => onIntent('alerts_and_autotrade')}
      >
        <View style={styles.modeHeaderRow}>
          <View style={styles.pillPro}>
            <Text style={styles.pillProText}>FOR AUTOMATED EXECUTION</Text>
          </View>
          <View style={[styles.radioCircle, intent === 'alerts_and_autotrade' && styles.radioCircleOn]}>
            {intent === 'alerts_and_autotrade' ? <Text style={styles.radioCheckText}>✓</Text> : null}
          </View>
        </View>

        <Text style={styles.modeTitle}>Lean signals + Auto-trade</Text>
        <Text style={styles.modeBullet}>• Real-time probability leans and alerts</Text>
        <Text style={styles.modeBullet}>• Option to place IOC orders automatically on Kalshi</Text>
        <Text style={styles.modeBullet}>• Protected by custom cushions & risk limits</Text>

        {intent === 'alerts_and_autotrade' ? (
          <View style={styles.selectedBadge}>
            <Text style={styles.selectedBadgeText}>✓ SELECTED PATH</Text>
          </View>
        ) : (
          <Text style={styles.modeTag}>Requires Face ID in Settings to arm</Text>
        )}
      </Pressable>

      <View style={styles.compare}>
        <Text style={styles.compareTitle}>Clear difference</Text>
        <Text style={styles.compareLine}>
          · Lean signals = information + alerts. No money moved by the app.
        </Text>
        <Text style={styles.compareLine}>
          · Lean signals + Auto-trade = same signals, and the app may spend your Kalshi cash when
          you explicitly enable Auto-trade later.
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Assets you care about</Text>
      <View style={styles.chipRow}>
        {ALL_ASSETS.map((a) => {
          const on = assets.includes(a);
          return (
            <Pressable
              key={a}
              testID={`chip-asset-${a}`}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => onToggleAsset(a)}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{a}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>Experience (optional)</Text>
      <View style={styles.chipRow}>
        {(
          [
            ['new', 'New to Kalshi'],
            ['some', 'Some trading'],
            ['active', 'Active trader'],
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            testID={`chip-exp-${id}`}
            style={[styles.chip, experience === id && styles.chipOn]}
            onPress={() => onExperience(id)}
          >
            <Text style={[styles.chipText, experience === id && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Capital comfort (optional)</Text>
      <View style={styles.chipRow}>
        {(
          [
            ['learning', 'Learning'],
            ['small', 'Small size'],
            ['serious', 'Serious'],
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            testID={`chip-cap-${id}`}
            style={[styles.chip, capital === id && styles.chipOn]}
            onPress={() => onCapital(id)}
          >
            <Text style={[styles.chipText, capital === id && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function NotificationsStep() {
  return (
    <View testID="onboarding-step-notifications">
      <Text style={styles.hero}>Stay informed</Text>
      <Text style={styles.sub}>
        Allow notifications so Predict can alert you about lean signals, fills, and when polling
        pauses in the background.
      </Text>
      <View style={styles.card}>
        <Text style={styles.howTitle}>You can change this later</Text>
        <Text style={styles.howBody}>
          Skip for now if you prefer. Signal alerts still appear inside the app; push alerts need
          permission.
        </Text>
      </View>
    </View>
  );
}

function KalshiStep({
  keyId,
  pem,
  onKeyId,
  onPem,
  onImport,
  note,
  busy,
}: {
  keyId: string;
  pem: string;
  onKeyId: (v: string) => void;
  onPem: (v: string) => void;
  onImport: () => void;
  note: string | null;
  busy: boolean;
}) {
  return (
    <View testID="onboarding-step-kalshi">
      <Text style={styles.hero}>Connect Kalshi (optional)</Text>
      <Text style={styles.sub}>
        Needed for Auto-trade and live cash balance. Skip if you only want leans for now — add keys
        anytime in Settings.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>How to get your API key & PEM</Text>
        <KalshiApiKeyHelpContent />
      </View>

      <Text style={styles.sectionLabel}>API Key ID</Text>
      <TextInput
        testID="input-onboarding-key-id"
        style={styles.input}
        value={keyId}
        onChangeText={onKeyId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Paste Key ID"
        placeholderTextColor={colors.mute}
        editable={!busy}
      />
      <View style={styles.pemHeader}>
        <Text style={styles.sectionLabel}>Private key (PEM)</Text>
        <Pressable testID="btn-onboarding-import-pem" onPress={onImport} disabled={busy}>
          <Text style={styles.link}>Import file</Text>
        </Pressable>
      </View>
      <TextInput
        testID="input-onboarding-pem"
        style={[styles.input, styles.pemInput]}
        value={pem}
        onChangeText={onPem}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        placeholder="-----BEGIN RSA PRIVATE KEY-----"
        placeholderTextColor={colors.mute}
        editable={!busy}
      />
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: 6 },
  brand: { color: colors.gold, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  stepLabel: { color: colors.textSecondary, fontSize: 13 },
  dots: { flexDirection: 'row', gap: 6, marginTop: 4, marginBottom: 8 },
  dot: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  dotActive: { backgroundColor: colors.accent },
  dotDone: { backgroundColor: colors.accentSoft },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: 24, gap: 12 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  col: { gap: 10 },
  btnGhost: {
    minWidth: 72,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  btnGhostPlaceholder: { minWidth: 72 },
  btnGhostAlone: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' },
  btnGhostText: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  btnSecondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  btnSecondaryText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  btnPrimary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryWide: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: colors.bg, fontWeight: '800', fontSize: 16 },
  btnDisabled: { opacity: 0.45 },
  hero: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
    marginBottom: 8,
  },
  sub: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  cardTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 16 },
  howRow: { flexDirection: 'row', gap: 12 },
  howBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howBadgeText: { color: colors.accent, fontWeight: '800' },
  howTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  howBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 2 },
  fine: { color: colors.mute, fontSize: 12, lineHeight: 18, marginTop: 8 },
  disclaimerLong: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  checkLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  modeCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
    gap: 6,
  },
  modeCardOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  modeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  pillBeginner: {
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  pillBeginnerText: { color: colors.gold, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  pillPro: {
    backgroundColor: 'rgba(74, 144, 226, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(74, 144, 226, 0.3)',
  },
  pillProText: { color: '#4A90E2', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.mute,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  radioCheckText: { color: '#000', fontSize: 12, fontWeight: '900' },
  modeTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 17, marginBottom: 2 },
  modeBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  modeBullet: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  modeTag: { color: colors.mute, fontSize: 12, fontWeight: '600', marginTop: 4 },
  selectedBadge: {
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: colors.accentSoft,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  selectedBadgeText: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  compare: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  compareTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 13 },
  compareLine: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  sectionLabel: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: colors.accent },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 8,
  },
  pemInput: { minHeight: 120, textAlignVertical: 'top' },
  pemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  link: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  note: { color: colors.warn, fontSize: 13, marginTop: 4 },
  error: { color: colors.danger, padding: 24 },
  paywallWrap: { gap: 8 },
  paywallIntro: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
});

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing } from '../theme/tokens';
import {
  ALERT_RETENTION_DEFAULT_DAYS,
  ALERT_RETENTION_MAX_DAYS,
  ALERT_RETENTION_MIN_DAYS,
  modeHint,
  modeLabel,
} from '../config/types';
import { supportContactEmail, withSupportContact } from '../config/appMeta';
import { SupportContactFooter } from '../components/SupportContactFooter';
import { AutoTradeRiskAcceptModal } from '../components/AutoTradeRiskAcceptModal';
import { KalshiApiKeyHelpContent } from '../components/KalshiApiKeyHelpContent';
import {
  hasAcceptedCurrentDisclaimer,
  recordAutoTradeRiskAcceptance,
} from '../storage/riskAcceptance';
import { useConfigStore } from '../state/configStore';
import { useRuntimeStore } from '../state/runtimeStore';
import { cloudClient } from '../services/cloud/cloudClient';
import { useSubscriptionStore } from '../state/subscriptionStore';
import {
  authenticateForSecrets,
  clearCredentials,
  hasCredentials,
  loadCredentials,
  saveCredentials,
} from '../services/credentials';
import { KalshiClient } from '../services/kalshi/client';
import { assertPemLooksValid } from '../services/kalshi/sign';

async function pickPemFromDevice(): Promise<string | null> {
  const DocumentPicker = await import('expo-document-picker');
  const result = await DocumentPicker.getDocumentAsync({
    type: ['*/*', 'text/plain', 'application/x-pem-file', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  const uri = result.assets[0].uri;
  // Document picker copies into app cache; fetch reads file:// URIs without expo-file-system/legacy
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Could not read key file`);
  return await res.text();
}

type BusyKey =
  | 'alerts'
  | 'autotrade'
  | 'prune'
  | 'retention'
  | 'poll'
  | 'poller'
  | 'unlock'
  | 'save'
  | 'import'
  | 'test'
  | 'wipe'
  | null;

const MIN_BUSY_MS =
  typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? 0 : 450;

export function SettingsScreen({
  onOpenAccountAndMore,
  onOpenRisk,
}: {
  onOpenAccountAndMore?: () => void;
  onOpenRisk?: () => void;
} = {}) {
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const setAutoTrade = useConfigStore((s) => s.setAutoTrade);
  const setPollIntervalSeconds = useConfigStore((s) => s.setPollIntervalSeconds);
  const setAlertRetentionDays = useConfigStore((s) => s.setAlertRetentionDays);
  const start = useRuntimeStore((s) => s.start);
  const stop = useRuntimeStore((s) => s.stop);
  const tickOnce = useRuntimeStore((s) => s.tickOnce);
  const status = useRuntimeStore((s) => s.status);
  const refreshSub = useSubscriptionStore((s) => s.refresh);
  const refreshCloudSnapshot = useRuntimeStore((s) => s.refreshCloudSnapshot);
  const refreshPredictionsBalance = useRuntimeStore((s) => s.refreshPredictionsBalance);
  const [refreshing, setRefreshing] = useState(false);
  const [autoTradeRiskOpen, setAutoTradeRiskOpen] = useState(false);

  const [devTaps, setDevTaps] = useState(0);
  const [devUnlocked, setDevUnlocked] = useState(false);
  const [hasCreds, setHasCreds] = useState(false);
  const [keyId, setKeyId] = useState('');
  const [pem, setPem] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refreshCloudSnapshot(),
        refreshPredictionsBalance(),
        refreshSub(),
        hasCredentials().then(setHasCreds),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshCloudSnapshot, refreshPredictionsBalance, refreshSub]);

  const handleVersionPress = () => {
    if (devUnlocked) return;
    const next = devTaps + 1;
    setDevTaps(next);
    if (next >= 5) {
      setDevUnlocked(true);
      setFeedback('Developer diagnostics unlocked');
    }
  };
  /** Shown under Test connection so success/fail is visible without scrolling up. */
  const [connectionTest, setConnectionTest] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [busyKey, setBusyKey] = useState<BusyKey>(null);
  const busyLock = React.useRef(false);
  const [riskHelpOpen, setRiskHelpOpen] = useState(false);
  const [credsHelpOpen, setCredsHelpOpen] = useState(false);

  useEffect(() => {
    void hasCredentials().then(setHasCreds);
  }, []);

  /** Safe against stale Zustand HMR instances missing newer actions. */
  function runPruneAlerts(): number {
    const state = useRuntimeStore.getState();
    if (typeof state.pruneAlerts === 'function') {
      return state.pruneAlerts();
    }
    const rt = state.ensure();
    const removed = rt.pruneAlertsNow();
    state.syncFromRuntime();
    return removed;
  }

  async function withBusy<T>(key: BusyKey, work: () => Promise<T> | T): Promise<T> {
    if (busyLock.current) throw new Error('busy');
    busyLock.current = true;
    setBusyKey(key);
    const started = Date.now();
    try {
      return await work();
    } finally {
      const wait = MIN_BUSY_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      busyLock.current = false;
      setBusyKey(null);
    }
  }

  function note(msg: string) {
    setFeedback(msg);
  }

  async function unlockSecrets() {
    try {
      await withBusy('unlock', async () => {
        const ok = await authenticateForSecrets();
        if (!ok) {
          note('Unlock cancelled');
          return;
        }
        const c = await loadCredentials();
        if (c) {
          setKeyId(c.keyId);
          setPem(c.privateKeyPem);
        }
        setShowSecrets(true);
        note(c ? 'Credentials unlocked' : 'Enter your Kalshi Key ID and PEM');
      });
    } catch {
      /* busy */
    }
  }

  async function saveCreds() {
    try {
      await withBusy('save', async () => {
        assertPemLooksValid(pem);
        await saveCredentials({
          keyId,
          privateKeyPem: pem,
          env: 'production',
        });
        await cloudClient.uploadCredentials({
          keyId: keyId.trim(),
          privateKeyPem: pem.trim(),
        });
        setHasCreds(true);
        setShowSecrets(false);
        setPem('');
        useRuntimeStore.getState().runtime?.clearAuthBlock();
        note('Credentials saved to Secure Store & GCP Secret Manager');
      });
    } catch (e: any) {
      if (String(e?.message) === 'busy') return;
      note(String(e?.message || e));
      setBusyKey(null);
    }
  }

  async function toggleAlerts() {
    try {
      await withBusy('alerts', () => {
        const next = !config.alerts_enabled;
        setConfig({ alerts_enabled: next });
        if (next && !status?.running) {
          start();
        }
        note(next ? 'Alerts turned on' : 'Alerts turned off');
      });
    } catch {
      /* busy */
    }
  }

  async function toggleAutoTrade() {
    const next = !config.auto_trade_enabled;
    if (next) {
      // Skip risk modal if onboarding (or prior) already accepted current disclaimer
      if (await hasAcceptedCurrentDisclaimer()) {
        await confirmAutoTradeAfterRiskAccept();
        return;
      }
      setAutoTradeRiskOpen(true);
      return;
    }
    try {
      await withBusy('autotrade', async () => {
        const r = await setAutoTrade(false);
        if (!r.ok) {
          note(r.error || 'Could not update auto-trade');
          return;
        }
        note('Auto-trade off — alerts only');
      });
    } catch {
      /* busy */
    }
  }

  async function confirmAutoTradeAfterRiskAccept() {
    setAutoTradeRiskOpen(false);
    try {
      await withBusy('autotrade', async () => {
        const r = await setAutoTrade(true);
        if (!r.ok) {
          note(r.error || 'Could not update auto-trade');
          return;
        }
        try {
          // Audit log that Auto-trade was armed (disclaimer already accepted earlier)
          await recordAutoTradeRiskAcceptance();
        } catch {
          /* still enable even if local log fails */
        }
        if (!status?.running) {
          start();
        }
        note('Auto-trade on — Cloud Run places orders');
      });
    } catch {
      /* busy */
    }
  }

  async function bumpPoll(delta: number) {
    try {
      await withBusy('poll', () => {
        const next = config.poll_interval_seconds + delta;
        setPollIntervalSeconds(next);
        if (status?.running) {
          stop();
          start();
        }
        note(`Poll interval set to ${useConfigStore.getState().config.poll_interval_seconds}s`);
      });
    } catch {
      /* busy */
    }
  }

  async function bumpRetention(delta: number) {
    try {
      await withBusy('retention', () => {
        setAlertRetentionDays(config.alert_retention_days + delta);
        const days = useConfigStore.getState().config.alert_retention_days;
        const removed = runPruneAlerts();
        note(
          removed > 0
            ? `Keep history ${days}d · removed ${removed} old alert(s)`
            : `Keep history ${days}d · nothing older to remove`
        );
      });
    } catch {
      /* busy */
    }
  }

  async function pruneNow() {
    try {
      await withBusy('prune', () => {
        const before = useRuntimeStore.getState().alerts.length;
        const removed = runPruneAlerts();
        const after = useRuntimeStore.getState().alerts.length;
        note(
          removed > 0
            ? `Pruned ${removed} alert(s) · ${after} kept (older than ${config.alert_retention_days}d removed)`
            : before === 0
              ? 'No stored alerts to prune'
              : `Checked ${before} alert(s) · none older than ${config.alert_retention_days}d`
        );
      });
    } catch {
      /* busy */
    }
  }

  async function togglePoller() {
    try {
      await withBusy('poller', () => {
        if (status?.running) {
          stop();
          note('Poller stopped');
        } else {
          start();
          note('Poller started');
        }
      });
    } catch {
      /* busy */
    }
  }

  async function importPemFile() {
    try {
      await withBusy('import', async () => {
        const text = await pickPemFromDevice();
        if (text == null) {
          note('Import cancelled');
          return;
        }
        assertPemLooksValid(text);
        setPem(text.trim());
        note('Private key imported from file');
      });
    } catch (e: any) {
      if (String(e?.message) === 'busy') return;
      note(String(e?.message || e));
      setBusyKey(null);
    }
  }

  async function testConnection() {
    try {
      await withBusy('test', async () => {
        const okBio = await authenticateForSecrets('Confirm to test Kalshi connection');
        if (!okBio) {
          note('Connection test cancelled');
          return;
        }
        const c = await loadCredentials();
        if (!c) {
          const msg = 'No credentials saved — add Key ID and PEM first';
          setConnectionTest({ ok: false, text: msg });
          note(msg);
          Alert.alert('Test connection', msg);
          return;
        }
        const client = new KalshiClient(c.keyId, c.privateKeyPem, c.env);
        const bal = await client.balance();
        if (bal.ok) {
          useRuntimeStore.getState().runtime?.clearAuthBlock();
          try {
            await cloudClient.uploadCredentials({
              keyId: c.keyId.trim(),
              privateKeyPem: c.privateKeyPem.trim(),
            });
          } catch {
            /* ignore background upload error */
          }
          const cash =
            bal.balance_usd != null && Number.isFinite(Number(bal.balance_usd))
              ? `$${Number(bal.balance_usd).toFixed(2)}`
              : 'unknown';
          const msg = `Test connection successful · cash ${cash}`;
          setConnectionTest({ ok: true, text: msg });
          note(msg);
          Alert.alert(
            'Test connection successful',
            `Kalshi accepted your API key.\nCash balance: ${cash}`
          );
        } else {
          const msg = `Test connection failed · HTTP ${bal.http_status}`;
          setConnectionTest({ ok: false, text: msg });
          note(withSupportContact(msg));
          Alert.alert('Test connection failed', withSupportContact(msg));
        }
      });
    } catch (e: any) {
      if (String(e?.message) === 'busy') return;
      const msg = withSupportContact(String(e?.message || e));
      setConnectionTest({ ok: false, text: String(e?.message || e) });
      note(msg);
      Alert.alert('Test connection failed', msg);
      setBusyKey(null);
    }
  }

  function requestWipeCreds() {
    if (busyKey != null) return;
    Alert.alert(
      'Wipe credentials?',
      'Remove Kalshi API keys from this phone? You will need to add them again before Auto-trade or balance checks can work.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe',
          style: 'destructive',
          onPress: () => void wipeCreds(),
        },
      ]
    );
  }

  async function wipeCreds() {
    try {
      await withBusy('wipe', async () => {
        const ok = await authenticateForSecrets('Confirm wipe credentials');
        if (!ok) {
          note('Wipe cancelled');
          return;
        }
        await clearCredentials();
        useRuntimeStore.getState().ensure().dropKalshiClient();
        setHasCreds(false);
        setShowSecrets(false);
        setPem('');
        setKeyId('');
        note('Credentials wiped from Secure Store');
      });
    } catch {
      /* busy */
    }
  }

  const anyBusy = busyKey != null;

  return (
    <View style={styles.root} testID="screen-settings">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <View style={styles.statusCard} testID="settings-mode">
          <Text style={styles.statusEyebrow}>Current mode</Text>
          <Text style={styles.statusTitle}>{modeLabel(config)}</Text>
          <Text style={styles.statusHint}>{modeHint(config)}</Text>
        </View>
        {feedback ? (
          <Text style={styles.actionFeedback} testID="settings-message">
            {feedback}
          </Text>
        ) : null}

        <Text style={styles.section}>Auto-trade</Text>
        <View style={styles.controlCard}>
          <View style={styles.controlRow}>
            <View style={styles.controlCopy}>
              <Text style={styles.controlTitle}>Place orders automatically</Text>
              <Text style={styles.controlHint}>
                Real Kalshi orders when cushions and risk gates pass. Face ID required to turn on.
              </Text>
            </View>
            <Switch
              testID="toggle-autotrade"
              value={config.auto_trade_enabled}
              disabled={anyBusy}
              onValueChange={() => void toggleAutoTrade()}
              trackColor={{ false: colors.border, true: colors.gold }}
              thumbColor={colors.textPrimary}
            />
          </View>
          {config.auto_trade_enabled ? (
            <Text style={styles.liveWarn} testID="autotrade-live-warn">
              Auto-trade is active. 24/7 background trading runs securely on GCP Cloud Run.
            </Text>
          ) : (
            <Text style={styles.controlHint}>
              Off = research & alerts only. No automatic buys or sells.
            </Text>
          )}
        </View>

        <View style={styles.collapseHeader}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionInline}>Risk</Text>
            <Pressable
              testID="btn-risk-help"
              style={styles.infoBtn}
              onPress={() => setRiskHelpOpen(true)}
              accessibilityLabel="Settings guide — what do these settings mean"
              hitSlop={8}
            >
              <Text style={styles.infoBtnText}>i</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => onOpenRisk?.()}
            testID="btn-toggle-risk"
            hitSlop={8}
          >
            <Text style={styles.collapseHint}>Show</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>Alerts</Text>
        <View style={styles.controlCard}>
          <View style={styles.controlRow}>
            <View style={styles.controlCopy}>
              <Text style={styles.controlTitle}>Notify on lean signals</Text>
              <Text style={styles.controlHint} testID="alerts-notify-hint">
                Off = no new lean rows and no lock-screen pings (including fills). Money rows still
                collect in Alerts. To hear fills but not leans, leave this On and mute Lean signals
                on the bell.
              </Text>
            </View>
            <Switch
              testID="toggle-alerts"
              value={config.alerts_enabled}
              disabled={anyBusy}
              onValueChange={() => void toggleAlerts()}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.textPrimary}
            />
          </View>
        </View>
        <Text style={styles.alertHistoryLabel}>Alert history</Text>
        <View style={styles.slimCard} testID="alert-retention-row">
          <Text style={styles.slimLabel}>Keep alert history</Text>
          <View style={styles.pollControls}>
            <Pressable
              testID="btn-retention-down"
              style={styles.chip}
              onPress={() => void bumpRetention(-5)}
              disabled={anyBusy || config.alert_retention_days <= ALERT_RETENTION_MIN_DAYS}
            >
              {busyKey === 'retention' ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text style={styles.chipText}>−5</Text>
              )}
            </Pressable>
            <Text style={styles.pollValue} testID="alert-retention-value">
              {config.alert_retention_days}d
            </Text>
            <Pressable
              testID="btn-retention-up"
              style={styles.chip}
              onPress={() => void bumpRetention(5)}
              disabled={anyBusy || config.alert_retention_days >= ALERT_RETENTION_MAX_DAYS}
            >
              {busyKey === 'retention' ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text style={styles.chipText}>+5</Text>
              )}
            </Pressable>
          </View>
        </View>
        <ActionButton
          testID="btn-prune-alerts"
          variant="slim"
          label="Prune older alerts now"
          busyLabel="Pruning old alerts…"
          busy={busyKey === 'prune'}
          disabled={anyBusy && busyKey !== 'prune'}
          onPress={() => void pruneNow()}
        />
        <Text style={styles.hint}>
          Default {ALERT_RETENTION_DEFAULT_DAYS}d · {ALERT_RETENTION_MIN_DAYS}–
          {ALERT_RETENTION_MAX_DAYS}d. Prune removes older alerts on this phone and in Cloud.
        </Text>

        <View style={styles.sectionRow}>
          <Text style={[styles.section, styles.sectionNoTop]}>Kalshi credentials</Text>
          <Pressable
            testID="btn-kalshi-creds-help"
            style={styles.infoBtn}
            onPress={() => setCredsHelpOpen(true)}
            accessibilityLabel="How to get Kalshi API key"
            hitSlop={8}
          >
            <Text style={styles.infoBtnText}>i</Text>
          </Pressable>
        </View>
        <Text style={styles.meta} testID="creds-status">
          {hasCreds ? 'Saved in Secure Store' : 'Not set'}
        </Text>

        {!showSecrets ? (
          <ActionButton
            testID="btn-unlock-creds"
            variant="primary"
            label={hasCreds ? 'Unlock / edit' : 'Add credentials'}
            busyLabel={hasCreds ? 'Unlocking credentials…' : 'Opening credentials…'}
            busy={busyKey === 'unlock'}
            disabled={anyBusy && busyKey !== 'unlock'}
            onPress={() => void unlockSecrets()}
          />
        ) : (
          <View style={styles.secretBox}>
            <Text style={styles.meta}>API Key ID</Text>
            <TextInput
              testID="input-key-id"
              style={styles.input}
              value={keyId}
              onChangeText={setKeyId}
              autoCapitalize="none"
              placeholderTextColor={colors.mute}
              placeholder="key id"
            />
            <View style={styles.pemHeader}>
              <Text style={styles.meta}>Private key PEM</Text>
              <Pressable
                testID="btn-import-pem"
                style={styles.importBtn}
                onPress={() => void importPemFile()}
                disabled={anyBusy}
                accessibilityLabel="Import private key file"
              >
                {busyKey === 'import' ? (
                  <>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={styles.importLabel}>Importing…</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.importIcon}>⇪</Text>
                    <Text style={styles.importLabel}>Import</Text>
                  </>
                )}
              </Pressable>
            </View>
            <TextInput
              testID="input-pem"
              style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
              value={pem}
              onChangeText={setPem}
              multiline
              autoCapitalize="none"
              placeholderTextColor={colors.mute}
              placeholder="-----BEGIN PRIVATE KEY-----"
            />
            <Text style={styles.hint}>Paste PEM or import a .pem / .key file from this phone.</Text>
            <ActionButton
              testID="btn-save-creds"
              variant="primary"
              label="Save to Secure Store"
              busyLabel="Saving credentials…"
              busy={busyKey === 'save'}
              disabled={anyBusy && busyKey !== 'save'}
              onPress={() => void saveCreds()}
            />
            <ActionButton
              testID="btn-cancel-creds"
              variant="secondary"
              label="Cancel"
              busyLabel="Closing…"
              busy={false}
              disabled={anyBusy}
              onPress={() => {
                setShowSecrets(false);
                setPem('');
                note('Credential edit cancelled');
              }}
            />
          </View>
        )}

        <View style={styles.actionRow2Col}>
          <View style={styles.flex1}>
            <ActionButton
              testID="btn-test-connection"
              variant="secondary"
              label="Test connection"
              busyLabel="Testing…"
              busy={busyKey === 'test'}
              disabled={anyBusy && busyKey !== 'test'}
              onPress={() => void testConnection()}
            />
          </View>
          <View style={styles.flex1}>
            <ActionButton
              testID="btn-wipe-creds"
              variant="danger"
              label="Wipe credentials"
              busyLabel="Wiping…"
              busy={busyKey === 'wipe'}
              disabled={anyBusy && busyKey !== 'wipe'}
              onPress={requestWipeCreds}
            />
          </View>
        </View>

        {connectionTest ? (
          <Text
            style={[
              styles.connectionTestResult,
              connectionTest.ok ? styles.connectionTestOk : styles.connectionTestFail,
            ]}
            testID="connection-test-result"
          >
            {connectionTest.text}
          </Text>
        ) : null}

        <Text style={styles.warn}>
          Paste your Kalshi API key ID and private key PEM. Saved credentials enable 24/7 cloud auto-trading on GCP.
        </Text>

        {devUnlocked ? (
          <View style={styles.controlCard} testID="dev-diagnostics-card">
            <Text style={styles.sectionNoTop}>Developer Diagnostics</Text>
            <Row
              testID="toggle-poller"
              label="Live Feed Polling"
              value={status?.running ? 'Active' : 'Paused'}
              busy={busyKey === 'poller'}
              busyLabel={status?.running ? 'Pausing…' : 'Activating…'}
              disabled={anyBusy}
              onPress={() => void togglePoller()}
            />
            <ActionButton
              testID="btn-tick-once"
              variant="slim"
              label="Tick once"
              busyLabel="Ticking once…"
              busy={false}
              disabled={anyBusy}
              onPress={() => void tickOnce()}
            />
          </View>
        ) : null}

        <Pressable
          testID="btn-open-settings-more"
          style={styles.moreRow}
          onPress={() => onOpenAccountAndMore?.()}
          accessibilityLabel="Account and more: subscription, ID, legal, FAQ"
        >
          <View style={styles.moreCopy}>
            <Text style={styles.sectionInline}>Account & more</Text>
            <Text style={styles.hint}>Subscription, ID, legal, FAQ</Text>
          </View>
          <Text style={styles.moreChevron}>›</Text>
        </Pressable>

        <Text style={styles.section}>Support</Text>
        <SupportContactFooter />
        <Pressable
          testID="settings-version-text"
          onPress={handleVersionPress}
          style={styles.versionWrap}
          hitSlop={8}
        >
          <Text style={styles.versionText}>
            Predict v1.0.0 (57.0){devUnlocked ? ' · Dev Mode' : ''}
          </Text>
        </Pressable>
      </ScrollView>

      <KalshiCredsHelpModal visible={credsHelpOpen} onClose={() => setCredsHelpOpen(false)} />
      <RiskHelpModal visible={riskHelpOpen} onClose={() => setRiskHelpOpen(false)} />
      <AutoTradeRiskAcceptModal
        visible={autoTradeRiskOpen}
        onCancel={() => setAutoTradeRiskOpen(false)}
        onAccept={() => void confirmAutoTradeAfterRiskAccept()}
      />
    </View>
  );
}

function RiskHelpModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="modal-risk-help"
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Settings guide</Text>
            <Pressable testID="btn-close-risk-help" onPress={onClose} hitSlop={10}>
              <Text style={styles.modalClose}>Close</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalLead}>
              Plain-English guide to every setting in this app. Settings → Risk → Show opens Shared
              limits (one Kalshi account) plus Home Buy and Auto-trade tabs. If a path fails a limit,
              Last signals shows one skip line for the button you can tap — not two competing skips.
            </Text>
            <Text style={styles.modalLead}>
              Important: Trading involves risk of loss. Predict does not guarantee profits or
              successful trades — whether you use alerts, Auto-trade, Home Buy / Sell taps, or any
              mix. You alone are responsible for trades you place outside this app based on alerts,
              trades Cloud Run places when Auto-trade is On, and trades Cloud Run places when you
              tap Buy or Sell on Home. The app owner is not liable for your losses.
            </Text>

            <Text style={styles.modalSection}>Signal alerts vs Auto-trade</Text>
            <HelpItem title="Signal alerts">
              When On, you get notifications for lean signals. A signal is research only — it is not
              an order by itself. Independent from auto-trade.
            </HelpItem>
            <HelpItem title="Auto-trade">
              When On, the app may place real Kalshi buy orders when cushions and Risk gates pass.
              Turning this On requires Face ID / biometrics. Auto-trading runs 24/7 securely on GCP Cloud Run.
              Independent from alerts — you can trade with alerts muted. Home Buy / Sell taps are a
              separate path and can still place when Auto-trade is Off.
            </HelpItem>
            <HelpItem title="Home Buy / Sell (Last signals)">
              When the Last signals Buy / Sell flag is On, Home shows one Home Buy / Sell block for
              Buy YES / Buy NO and Sell. Buy is a Home tap only and shows only if Home Buy gates
              would pass. Ask too rich and other Home skips hide it. If Auto-trade is On and its
              Risk tab also passes, Cloud can still buy that same lean on the worker tick, as long
              as shared caps allow (max trades / asset / 15m window, max trades / day, max open,
              daily loss). Sell is in that same block if you already hold that 15-minute window. The
              gap line then says “with you” (still on your side) or “against you” (flipped — consider
              Sell). When you are not holding, ▲ / ▼ is live vs strike (not a win/loss color). One
              tap tells Cloud Run to place now. The phone never talks to Kalshi. No confirm sheet.
              Kill Switch hides the buttons. If the Admin flag is Off, buttons disappear and Cloud
              rejects taps.{'\n\n'}
              A tap uses Settings → Risk → Home Buy (size, minutes left/elapsed, max ask, time in
              force, chase). Shared limits apply to both Home Buy and Auto-trade. A Home Buy skip
              stays on the row when Buy is hidden — not Auto-trade’s skip. You can lose the full
              notional. GTC can rest. IOC can miss.
            </HelpItem>
            <HelpItem title="Notify on lean vs mute on the bell" testID="help-notify-vs-mute">
              Settings → Notify on lean signals Off stops new lean rows and all lock-screen pings
              (including fills). Money rows still collect in Alerts. To hear fills but not leans,
              leave Notify On and mute Lean signals on the bell — that keeps the list, just no ping.
            </HelpItem>
            <HelpItem title="Keep alert history / Prune">
              How many days of alerts to keep. “Prune older alerts” deletes rows older than that
              window on this phone and in Cloud (today’s stay).
            </HelpItem>

            <Text style={styles.modalSection}>Polling</Text>
            <HelpItem title="Interval">
              How often the app refreshes prices and checks for trades (minimum 10 seconds). Shorter
              = faster reactions, more battery/network use.
            </HelpItem>

            <Text style={styles.modalSection}>Assets & cushions (Cushions tab)</Text>
            <HelpItem title="Asset on/off">
              Only enabled assets are scanned. Turn an asset off to pause it without changing Risk.
            </HelpItem>
            <HelpItem title="Cushion ($)">
              How far live price must be past the strike before a lean becomes YES or NO. Larger
              cushion = fewer, higher-confidence signals.
            </HelpItem>

            <Text style={styles.modalSection}>Risk — Shared limits</Text>
            <HelpItem title="Shared vs each tab">
              Shared limits (max open, trades/day, 15m window, daily loss) always apply to Home Buy
              and Auto-trade. Size, minutes, max ask, time in force, and chase are per tab. Protect
              money lives only on Auto-trade. Cushions stay on the Cushions tab.
            </HelpItem>

            <Text style={styles.modalSection}>Risk — position size (per tab)</Text>
            <HelpItem title="$ per trade">
              How many dollars you want to spend on each new trade for that tab. Think of it as your
              normal bet size (example: $5). Home Buy and Auto-trade can differ.
            </HelpItem>
            <HelpItem title="Max $ / trade">
              Hard cap for one trade on that tab. The app never spends more than this on a single
              order, even if “$ per trade” is higher.
            </HelpItem>
            <HelpItem title="Min $ / trade">
              Smallest order size allowed on that tab. If the calculated order would be cheaper than
              this (often when contract prices are high), that path skips with “size too small.” Tip:
              keep this lower than “$ per trade” (example: $1 min with $5 per trade).
            </HelpItem>

            <Text style={styles.modalSection}>Risk — how often / how many (shared)</Text>
            <HelpItem title="Max open positions">
              How many unsettled trades you can have at once. “Open” means placed but not finished
              yet (still pending).{'\n\n'}
              Example: set to 1 → after one order is placed, no new orders until that one settles or
              is protect-sold. That is safer and perfectly fine.
            </HelpItem>
            <HelpItem title="Max trades / day">
              Total new trades allowed today across all assets. Stops new buys for the day once this
              number is reached.
            </HelpItem>
            <HelpItem title="Max trades / asset / 15m window">
              How many new buys of the same asset are allowed in one 15-minute contract.{'\n\n'}
              Example: Gold has a new 15-minute market every quarter hour. This number is how many
              Gold buys Cloud Run may place in that one market.{'\n\n'}
              • 1 (default) — one Gold buy, then wait for the next 15-minute market{'\n'}
              • 2 — a second Gold buy is allowed in the same 15-minute market if the lean, cushion,
              time, and max-open rules still pass. Typical use: you already bought, protect-sell
              closed it, and you want one more try{'\n'}
              • 3–5 — more buys in the same 15-minute market. Easy to stack the same side; keep this
              low{'\n\n'}
              Only new buys count. A protect-sell (early exit) does not use a slot.{'\n'}
              A missed IOC (no fill) does not use a slot.{'\n'}
              The next 15-minute contract starts the count at 0 again.{'\n'}
              This does not replace Max trades / day (that is still the daily cap across all assets).
            </HelpItem>
            <HelpItem title="Daily loss stop ($)">
              If today’s locked-in losses reach this dollar amount, the app stops placing new trades
              for the day. A safety brake.
            </HelpItem>

            <Text style={styles.modalSection}>Risk — entry timing & price (per tab)</Text>
            <HelpItem title="Min minutes left (Buy only)">
              Per tab. Enter if the 15‑minute window still has at least this many minutes left for
              that path. Example: 2 means “don’t enter in the last 2 minutes.” If Buy is showing and
              Last signals says “too little time left,” that is the Home Buy tab. Auto-trade’s clock
              is separate. Does not block Protect Sell.
            </HelpItem>
            <HelpItem title="Min minutes elapsed (Buy only)">
              Per tab. Enter after this many whole minutes have already passed in the 15‑minute
              window. Skips the noisy open for that path.{'\n\n'}
              • 0 = allow buys from the window open{'\n'}
              • 2 (default) = wait ~2 minutes{'\n'}
              • 3–5 = stricter — fewer early entries{'\n\n'}
              If Buy is showing and Last signals says “too early in window,” that is the Home Buy
              tab, not Auto-trade.
            </HelpItem>
            <HelpItem title="Max entry ask ($) (Buy limit)">
              Per path. Auto-trade uses the Auto-trade tab; Home Buy uses the Home Buy tab. If the
              ask is above that tab’s cap, that path skips “ask too rich.” With Smart buy On, Auto
              can still skip a cheaper ticket if it is not a good deal vs our guess.
            </HelpItem>
            <HelpItem title="Time in force (Auto-trade)">
              Settings → Risk → Auto-trade. How long a robot buy stays live on Kalshi:{'\n'}
              • IOC — try to fill now; cancel anything not filled{'\n'}
              • FOK — fill all of it now, or cancel everything{'\n'}
              • GTC — leave the order open until filled or you cancel{'\n\n'}
              Protect Sell exits always use IOC.
            </HelpItem>
            <HelpItem title="Time in force (Home Buy)">
              Settings → Risk → Home Buy. How long a tap stays live on Kalshi (IOC / FOK / GTC).
              Default IOC. GTC can rest until the 15-minute window ends. Does not apply to Auto-trade
              or Protect Sell. Sell taps stay IOC.
            </HelpItem>
            <HelpItem title="Chase above ask ($)">
              Tiny extra you’re willing to pay above the current ask (example: $0.02). Each path uses
              its own chase and still caps pay by that path’s max entry ask (max $0.99). Auto-trade
              chase is also used as protect-sell slippage. Home Buy chase is used as Home Sell
              slippage.
            </HelpItem>

            <Text style={styles.modalSection}>Risk — Smart buy (Auto-trade only)</Text>
            <HelpItem title="Smart buy">
              Settings → Risk → Auto-trade only. Home Buy taps ignore this.{'\n\n'}
              When On (default), Auto still uses your cushions, minutes, max ask, and shared caps —
              then also asks: is our guess at least Min extra chance above the Kalshi ticket? The
              guess uses this 15-minute price path, time left, and how jumpy the window has been.
              {'\n\n'}
              When Off, Auto uses cushion and risk only (same as before this setting).{'\n\n'}
              Smart buy does not guarantee profit. It skips more tickets, including some that would
              have won.
            </HelpItem>
            <HelpItem title="Min extra chance ($)">
              How much better our guess must be than the ticket. Example: $0.08 means we buy only if
              we think about 80% and the ask is 72¢ or less.{'\n\n'}
              • $0.08 (default){'\n'}
              • Lower (e.g. $0.04) = Auto buys more often{'\n'}
              • Higher (e.g. $0.12) = pickier{'\n\n'}
              Kalshi sets the ask. You do not type it. This is not chase (chase is extra you pay).
            </HelpItem>

            <Text style={styles.modalSection}>Risk — protect money (early sell)</Text>
            <HelpItem title="Protect money (early sell)">
              When On, if you already hold a trade and the live lean flips strongly against you,
              Cloud Run places an IOC sell to exit early — aiming to protect money instead of waiting
              for the window to settle win/loss.{'\n\n'}
              After the wait-after-fill, this can fire at any remaining time in the 15‑minute window
              — not only in the last minutes.{'\n\n'}
              When Off (default), open trades ride until settlement.{'\n\n'}
              Notice: Early exits are not guaranteed to save capital or prevent loss. Orders may fail, delay, partial-fill, or fill at worse-than-expected prices due to network traffic, exchange latency, order book illiquidity, wide spreads, rapid price gaps, or time decay (theta) near expiry.{'\n\n'}
              Works whenever this switch is On and Kalshi credentials are saved — even if Auto-trade
              (new buys) is Off. Exits run 24/7 on Cloud Run.
            </HelpItem>
            <HelpItem title="Sell when gap ≥ cushion ×">
              How strong the opposite lean must be before selling.{'\n\n'}
              • 1.00× (default) = opposite gap must be at least your asset cushion{'\n'}
              • Higher (e.g. 1.50×) = harder to trigger — wait for a bigger adverse move{'\n'}
              • Lower (e.g. 0.75×) = easier to trigger — exit sooner{'\n\n'}
              Example: BTC cushion $175 and ratio 1.00× → sell a YES hold if lean flips to NO with
              gap ≥ $175 (live ≤ strike − $175).
            </HelpItem>
            <HelpItem title="Wait after fill before sell">
              Short pause after your buy fills before a protect-sell can fire (default 45 seconds).
              Stops Cloud Run from instantly selling on the first noisy tick.{'\n\n'}
              • 0s = sell as soon as the opposite-lean rule hits{'\n'}
              • 45s (default) = recommended{'\n'}
              • Higher = wait longer after entry{'\n\n'}
              This is not “only sell in the last 10 minutes.” After this wait, protect-sell can fire
              at minute 12 or minute 1 — whenever lean is against you with enough gap.
            </HelpItem>

            <Text style={styles.modalSection}>Risk — Cash out (Auto-trade only)</Text>
            <HelpItem title="Cash out">
              Admin must enable this first. Then Settings → Risk → Auto-trade.{'\n\n'}
              Separate path for the assets you check (default Gold). Buys a cheaper ticket (enter % of
              cushion + max ask), then sells when the bid is up by Cash out bid minus max ask from
              what you paid (paid $0.82 → $0.88; paid $0.78 → $0.84), or if the bid falls by Cash out
              stop below the fill (default 5¢), or if the lean fully flips against you. Window end
              settles — no dump.{'\n\n'}
              Home Buy / Sell stay off while Cash out holds that ticker. Protect money skips these lots.
              Smart buy does not apply.
            </HelpItem>
            <HelpItem title="Enter cushion (%)">
              How much of the Cushions-tab dollar gap is required to buy. 60% of Gold $175 is $105.
              Not 100% — a full cushion usually means the ticket is already ~90¢.
            </HelpItem>
            <HelpItem title="Cash out max ask / bid">
              Max ask is the most you will pay. Cash out bid is the sell target if you paid max ask.
              If you paid less, Cloud sells when the bid rises by the same edge (bid − max ask). Bid
              must be above max ask.
            </HelpItem>
            <HelpItem title="Cash out stop">
              If the bid falls this far below what you paid, Cloud sells (default 5¢). Range 3¢–10¢.
              Cuts a full $0 settle loss. You may get fewer $1 window wins.
            </HelpItem>
            <HelpItem title="Skip thin bid">
              Each Cloud path has its own checkbox (default Off), shown only when that path is On.
              Home Buy does not use it. Cash out and Gold fade skip the buy and can sell if you
              already hold; a book timeout does not skip or dump. TWAP lock and Last-minute only
              skip the buy and still hold; an unknown book size fails closed (no buy). See FAQ.
            </HelpItem>
            <HelpItem title="Gold fade">
              Gold only. When the gap is at most Max gap, Cloud buys the cheaper ticket and sells
              the whole lot on take profit, stop, thin bid, flatten minutes, window end, or a full
              cushion flip. Default Off. Admin must enable the block first. Not Cash out.
            </HelpItem>
            <HelpItem title="TWAP lock">
              BTC and ETH only. While On, those coins leave Cash out and normal Auto. Cloud buys
              Yes only when leftover seconds can be $0 and Yes still wins, if the ask is at or
              under Max ask (default $0.96). Then hold to $1. Most windows: no trade. Default Off.
              Admin must enable the block first.
            </HelpItem>
            <HelpItem title="Last-minute">
              Checked Last-minute assets that are also On in Cushions. Empty means no Last-minute
              buys. Watch 1s quotes from Watch start (default 150s). First clip only when Both
              still qualifies (usually last 60–90s), then clip ladder every Ladder wait while the
              favorite ask is at or under Entry ask. Stop with ~10s left or a $1.00 ask. Not a
              lock. Does not pull coins off Cash out or Auto. Window cap 1 still blocks the first
              clip; ladder adds after that first Last-minute fill are extra. Sell if flip is Off
              unless you set it — then only a real opposite-side flip sells those lots and frees
              clip slots. TWAP lock keeps BTC/ETH if that path is On. Hold to settlement when flip
              is Off. Default Off. Admin must enable the block first.
            </HelpItem>

            <HelpItem title="Restore defaults">
              Restore shared limits resets max open, trades/day, 15m window, and daily loss stop.
              Restore Home Buy / Restore Auto-trade resets only that tab (Smart buy, Protect money,
              Cash out, Gold fade, TWAP lock, and Last-minute are on Auto-trade). Cushions and keys stay.
            </HelpItem>

            <Text style={styles.modalSection}>Kalshi credentials</Text>
            <HelpItem title="API key & private key">
              Required for Auto-trade, Home Buy / Sell, protect-sell, and settlement checks. Stored
              in the phone’s Secure Store. Cloud Run also stores the key so it can place. Use Test
              connection after saving. Never share your PEM.
            </HelpItem>

            <Text style={styles.modalTip}>
              Tip: Start with Protect money Off, small $ per trade, and max open positions = 1. Turn
              Protect money On only after you understand early exits can lock in a small loss to
              avoid a full loss.{'\n\n'}
              If something breaks, email support: {supportContactEmail()}
            </Text>
          </ScrollView>
          <Pressable testID="btn-got-it-risk-help" style={styles.modalDone} onPress={onClose}>
            <Text style={styles.modalDoneText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function HelpItem({
  title,
  children,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.helpItem} testID={testID}>
      <Text style={styles.helpItemTitle}>{title}</Text>
      <Text style={styles.helpItemText}>{children}</Text>
    </View>
  );
}

function KalshiCredsHelpModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="modal-kalshi-creds-help"
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>How to get a Kalshi API key</Text>
            <Pressable testID="btn-close-kalshi-creds-help" onPress={onClose} hitSlop={10}>
              <Text style={styles.modalClose}>Close</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
            <KalshiApiKeyHelpContent />
          </ScrollView>
          <Pressable
            testID="btn-got-it-kalshi-creds-help"
            style={styles.modalDone}
            onPress={onClose}
          >
            <Text style={styles.modalDoneText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{n}</Text>
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepText}>{children}</Text>
      </View>
    </View>
  );
}

function ActionButton({
  testID,
  label,
  busyLabel,
  onPress,
  busy,
  disabled,
  variant = 'primary',
}: {
  testID?: string;
  label: string;
  busyLabel: string;
  onPress: () => void;
  busy: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'slim';
}) {
  const base =
    variant === 'slim'
      ? styles.slimBtn
      : variant === 'danger'
        ? [styles.btn, { backgroundColor: colors.danger }]
        : variant === 'secondary'
          ? [styles.btn, { backgroundColor: colors.surfaceElevated }]
          : styles.btn;
  const textStyle =
    variant === 'slim'
      ? styles.slimBtnText
      : variant === 'secondary'
        ? [styles.btnText, { color: colors.textPrimary }]
        : styles.btnText;
  const spinnerColor =
    variant === 'slim' || variant === 'secondary' ? colors.accent : colors.bg;

  return (
    <Pressable
      testID={testID}
      style={[base, (busy || disabled) && styles.btnDisabled]}
      onPress={onPress}
      disabled={busy || disabled}
    >
      {busy ? (
        <View style={styles.btnBusyRow}>
          <ActivityIndicator size="small" color={spinnerColor} />
          <Text style={textStyle}>{busyLabel}</Text>
        </View>
      ) : (
        <Text style={textStyle}>{label}</Text>
      )}
    </Pressable>
  );
}

function Row({
  label,
  value,
  onPress,
  testID,
  busy,
  busyLabel,
  disabled,
}: {
  label: string;
  value: string;
  onPress: () => void;
  testID?: string;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.slimCard, (busy || disabled) && styles.btnDisabled]}
      onPress={onPress}
      testID={testID}
      disabled={busy || disabled}
    >
      <Text style={styles.slimLabel}>{label}</Text>
      {busy ? (
        <View style={styles.btnBusyRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.slimValue}>{busyLabel || 'Working…'}</Text>
        </View>
      ) : (
        <Text style={styles.slimValue}>{value}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: 5, paddingBottom: 48 },
  mode: { color: colors.gold, fontSize: 17, fontWeight: '700', marginBottom: 2 },
  statusCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 4,
    marginBottom: 4,
  },
  statusEyebrow: {
    color: colors.mute,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statusTitle: {
    color: colors.gold,
    fontSize: 17,
    fontWeight: '800',
  },
  statusHint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  controlCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  controlCopy: { flex: 1, gap: 3 },
  controlTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  controlHint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  liveWarn: {
    color: colors.gold,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    backgroundColor: 'rgba(198, 167, 94, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.gold,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  connectionTestResult: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 2,
  },
  connectionTestOk: {
    color: colors.win,
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  connectionTestFail: {
    color: colors.loss,
    backgroundColor: 'rgba(240, 113, 120, 0.12)',
    borderColor: colors.danger,
  },
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
  legalInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  legalInlineLink: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  legalInlineDot: { color: colors.mute, fontSize: 12 },
  slimLabel: { color: colors.textPrimary, fontSize: 13, flex: 1 },
  slimValue: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  slimMeta: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  slimBtn: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  slimBtnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
  btnBusyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnDisabled: { opacity: 0.65 },
  section: {
    color: colors.gold,
    fontWeight: '700',
    marginTop: spacing.sm,
    fontSize: 14,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
  },
  sectionNoTop: { marginTop: 0 },
  infoBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  infoBtnText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 15,
  },
  sectionInline: { color: colors.gold, fontWeight: '700', fontSize: 14 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  collapseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingVertical: 2,
  },
  collapseHint: { color: colors.mute, fontSize: 12, fontWeight: '600' },
  alertHistoryLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  moreRow: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: spacing.sm,
  },
  moreCopy: { flex: 1, gap: 3 },
  moreChevron: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 30,
  },
  helpItem: { marginBottom: 12 },
  helpItemTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: 3 },
  helpItemText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  meta: { color: colors.textSecondary, fontSize: 12 },
  hint: { color: colors.mute, fontSize: 11, lineHeight: 15 },
  riskGroupTitle: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginTop: 10,
    marginBottom: 4,
  },
  riskField: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
  },
  riskFieldStack: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
    minHeight: undefined,
  },
  riskToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  riskHint: {
    color: colors.mute,
    fontSize: 11,
    lineHeight: 15,
  },
  riskLabel: { color: colors.textPrimary, fontSize: 13, flex: 1 },
  tifRow: { flexDirection: 'row', gap: 4 },
  tifChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.surfaceElevated,
  },
  tifChipOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  tifText: { color: colors.textSecondary, fontWeight: '700', fontSize: 11 },
  tifTextOn: { color: colors.bg },
  pollControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pollValue: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 13,
    minWidth: 40,
    textAlign: 'center',
  },
  chip: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 28,
    alignItems: 'center',
  },
  chipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  pemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  importIcon: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  importLabel: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  btnText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    padding: 10,
    marginBottom: 8,
  },
  secretBox: { gap: 4 },
  testMsg: { color: colors.gold, fontSize: 12 },
  warn: { color: colors.warn, fontSize: 11, marginTop: spacing.md, lineHeight: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '88%',
    paddingBottom: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 8,
    gap: 12,
  },
  modalTitle: { color: colors.gold, fontWeight: '800', fontSize: 16, flex: 1 },
  modalClose: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  modalBody: { paddingHorizontal: spacing.md, maxHeight: 420 },
  modalLead: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    marginBottom: 12,
  },
  modalSection: {
    color: colors.gold,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.3,
    marginTop: 8,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  step: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepBadgeText: { color: colors.bg, fontWeight: '800', fontSize: 12 },
  stepBody: { flex: 1 },
  stepTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: 2 },
  stepText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  modalTip: {
    color: colors.warn,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 8,
  },
  modalDone: {
    marginHorizontal: spacing.md,
    marginTop: 8,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalDoneText: { color: colors.bg, fontWeight: '800', fontSize: 14 },
  versionWrap: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  versionText: {
    color: colors.mute,
    fontSize: 11,
    fontWeight: '600',
  },
  flex1: {
    flex: 1,
  },
  actionRow2Col: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});

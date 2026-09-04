import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { AssetKey, modeLabel } from '../config/types';
import { useConfigStore } from '../state/configStore';
import { useRuntimeStore } from '../state/runtimeStore';
import { LastTradeAction } from '../runtime/AppRuntime';
import { SupportContactFooter } from '../components/SupportContactFooter';
import { TradingDisclaimer } from '../components/TradingDisclaimer';
import { supportContactEmail, withSupportContact } from '../config/appMeta';

const ASSET_ORDER: AssetKey[] = ['WTI', 'Gold', 'Silver', 'BTC', 'ETH'];

export function HomeScreen() {
  const config = useConfigStore((s) => s.config);
  const status = useRuntimeStore((s) => s.status);
  const stats = useRuntimeStore((s) => s.stats);
  const leans = useRuntimeStore((s) => s.leans);
  const leanAt = useRuntimeStore((s) => s.leanAt);
  const tradeActions = useRuntimeStore((s) => s.tradeActions);
  const assetErrors = useRuntimeStore((s) => s.assetErrors);
  const bump = useRuntimeStore((s) => s.bump);
  const kill = useRuntimeStore((s) => s.kill);
  const start = useRuntimeStore((s) => s.start);
  const stop = useRuntimeStore((s) => s.stop);
  const tickOnce = useRuntimeStore((s) => s.tickOnce);
  const predictionsBalanceUsd = useRuntimeStore((s) => s.predictionsBalanceUsd);
  const cashBalanceUsd = useRuntimeStore((s) => s.cashBalanceUsd);
  const refreshPredictionsBalance = useRuntimeStore((s) => s.refreshPredictionsBalance);
  const refreshCloudSnapshot = useRuntimeStore((s) => s.refreshCloudSnapshot);
  const alerts = useRuntimeStore((s) => s.alerts);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [killBusy, setKillBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // 1. On Mount: Fetch Cloud Snapshot & Balances
  useEffect(() => {
    void refreshPredictionsBalance();
    void refreshCloudSnapshot();
  }, [refreshPredictionsBalance, refreshCloudSnapshot]);

  // 2. On App Foregrounding / Return
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshCloudSnapshot();
      }
    });
    return () => sub.remove();
  }, [refreshCloudSnapshot]);

  // 3. On `trade_result` Alert Received
  useEffect(() => {
    const latestAlert = alerts[0];
    if (latestAlert && latestAlert.kind === 'trade_result') {
      void refreshCloudSnapshot();
    }
  }, [alerts, refreshCloudSnapshot]);

  // 4. On Manual Pull-to-Refresh
  const onPullToRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshPredictionsBalance(), refreshCloudSnapshot()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshPredictionsBalance, refreshCloudSnapshot]);

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
    if (!config.auto_trade_enabled) {
      Alert.alert(
        'Already disarmed',
        'Auto-trade is off on this phone. To turn it back on, open the Settings tab and enable Auto-trade (you may need Face ID).'
      );
      return;
    }
    Alert.alert('Turn off Auto-trade now?', 'This stops new auto-trades on this phone right away.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disarm',
        style: 'destructive',
        onPress: () => void runKillSwitch(),
      },
    ]);
  }, [killBusy, config.auto_trade_enabled, runKillSwitch]);

  void bump;

  const signalRows = ASSET_ORDER.filter((a) => config.assets_enabled[a]).map((asset) => {
    const lean = leans[asset];
    const at = leanAt[asset];
    const err = assetErrors[asset];
    return {
      asset,
      decision: lean?.decision ?? '—',
      gap: lean?.abs_gap,
      at,
      err,
      trade: tradeActions[asset] as LastTradeAction | undefined,
      priceSource: lean?.price_source,
    };
  });

  const lastTick = status?.lastTickAt;
  const integrationError = status?.lastError;
  const hasAssetErrors = signalRows.some((r) => r.err);
  const autoTradeOn = config.auto_trade_enabled;
  const killDisarmed = !autoTradeOn || Boolean(status?.killSwitch);
  const killLabel = killBusy
    ? 'Disarming…'
    : killDisarmed
      ? 'Disarmed — Auto-trade off'
      : 'Kill switch — disarm now';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="screen-home"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onPullToRefresh()}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
      <View style={styles.heroRow}>
        <View style={styles.heroLeft}>
          <Text style={styles.brand} testID="home-brand">
            Predict
          </Text>
          <Text style={styles.tag}>Prediction trades, with a buffer.</Text>
        </View>
        <View style={styles.heroRight}>
          <PortfolioSummary
            predictionsUsd={predictionsBalanceUsd}
            cashUsd={cashBalanceUsd}
          />
        </View>
      </View>

      <View style={styles.chipRow}>
        <Chip label={modeLabel(config)} accent />
        <HeartbeatChip
          running={Boolean(status?.running)}
          lastPulseAt={status?.lastPulseAt ?? status?.lastTickAt}
          intervalSec={config.poll_interval_seconds}
          nowMs={nowMs}
        />
      </View>

      {integrationError || hasAssetErrors ? (
        <View style={styles.errorBanner} testID="home-integration-error">
          <Text style={styles.errorTitle}>Integration issue</Text>
          <Text style={styles.errorBody} testID="home-integration-error-body">
            {withSupportContact(
              integrationError ||
                signalRows
                  .filter((r) => r.err)
                  .map((r) => `${r.asset}: ${r.err}`)
                  .join('\n')
            )}
          </Text>
          <Text style={styles.errorSupport} testID="home-error-support-email">
            Support: {supportContactEmail()}
          </Text>
        </View>
      ) : null}

      <Pressable
        style={[styles.kill, (killDisarmed || killBusy) && styles.killMuted]}
        onPress={requestKillSwitch}
        disabled={killBusy}
        testID="btn-kill-switch"
        accessibilityState={{ busy: killBusy, disabled: killBusy }}
      >
        {killBusy ? (
          <ActivityIndicator color="#fff" size="small" testID="kill-switch-spinner" />
        ) : null}
        <Text style={styles.killText}>{killLabel}</Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.label}>Today snapshot (ET)</Text>
        {stats.wins + stats.losses + stats.pending + stats.misses === 0 ? (
          <>
            <Text style={styles.value}>No app fills today</Text>
            <Text style={styles.snapHint}>
              This card only counts trades Predict placed on this phone (America/New_York). It does
              not pull Kalshi account history or desktop Command Center trades. Turn on Auto-trade
              and keep the app open to record fills here.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.value}>
              P&L ${stats.realized_pnl_usd.toFixed(2)} · {stats.wins}W / {stats.losses}L · pending{' '}
              {stats.pending}
              {stats.misses > 0 ? ` · miss ${stats.misses}` : ''}
            </Text>
            <Text style={styles.snapHint}>
              Today’s fills only (America/New_York). Pending = filled, not settled yet. Wins/losses
              update after the 15m market resolves.
            </Text>
          </>
        )}
      </View>

      <View style={styles.card} testID="home-last-signals">
        <View style={styles.signalsHeader}>
          <Text style={styles.label}>Last signals</Text>
          <Text style={styles.liveTick} testID="home-last-tick">
            {lastTick
              ? `Last tick ${formatSignalTime(lastTick)} · ${relativeAge(lastTick, nowMs)}`
              : 'Last tick —'}
          </Text>
        </View>
        {signalRows.length === 0 ? (
          <Text style={styles.valueSmall}>—</Text>
        ) : (
          signalRows.map((row) => (
            <View key={row.asset} style={styles.signalRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.signalLeft}>
                  <Text style={styles.signalAsset}>{row.asset}</Text>
                  <Text
                    style={[
                      styles.signalDecision,
                      decisionColor(row.err ? 'ERR' : row.decision),
                    ]}
                    testID={`signal-decision-${row.asset}`}
                  >
                    {row.err ? 'ERR' : row.decision}
                  </Text>
                  {!row.err && row.gap != null ? (
                    <Text style={styles.signalMeta}>gap ${row.gap.toFixed(2)}</Text>
                  ) : null}
                </View>
                {row.err ? (
                  <Text style={styles.signalErr} testID={`signal-err-${row.asset}`}>
                    {row.err}
                  </Text>
                ) : null}
                {autoTradeOn && row.trade ? (
                  <Text
                    style={[
                      styles.tradeAction,
                      row.trade.status === 'placed' && { color: colors.win },
                      row.trade.status === 'failed' && { color: colors.loss },
                      row.trade.status === 'skipped' && { color: colors.warn },
                    ]}
                    testID={`trade-action-${row.asset}`}
                  >
                    {row.trade.detail}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.signalTime} testID={`signal-time-${row.asset}`}>
                {row.at ? `(${formatSignalTime(row.at)} · ${relativeAge(row.at, nowMs)})` : '(—)'}
              </Text>
            </View>
          ))
        )}
        {autoTradeOn ? (
          <Text style={styles.tradeHint}>
            Lean YES/NO alerts are signals only. A real order shows “order placed” here and as an
            Order placed alert.
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={styles.btn}
          testID="btn-toggle-poller"
          onPress={() => (status?.running ? stop() : start())}
        >
          <Text style={styles.btnText}>{status?.running ? 'Stop poller' : 'Start poller'}</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnAlt]}
          testID="btn-tick-once"
          onPress={() => void tickOnce()}
        >
          <Text style={styles.btnText}>Tick once</Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>
        Keep the app open while auto-trading. iOS will not poll every few seconds in background.
      </Text>
      <TradingDisclaimer variant="short" showTitle testID="home-disclaimer" />
      <SupportContactFooter />
    </ScrollView>
  );
}

function formatUsd(valueUsd: number | null): string {
  if (valueUsd == null || !Number.isFinite(valueUsd)) return '—';
  return `$${valueUsd.toFixed(2)}`;
}

function PortfolioSummary({
  predictionsUsd,
  cashUsd,
}: {
  predictionsUsd: number | null;
  cashUsd: number | null;
}) {
  return (
    <View style={styles.portfolioSummary} testID="home-portfolio-summary">
      <View style={styles.predCard} testID="home-predictions-card">
        <Text style={styles.predLabel}>PREDICTIONS</Text>
        <Text style={styles.predValue}>{formatUsd(predictionsUsd)}</Text>
      </View>
      <View style={styles.cashCard} testID="home-cash-block">
        <Text style={styles.cashValue}>{formatUsd(cashUsd)}</Text>
        <Text style={styles.cashLabel}>Cash</Text>
      </View>
    </View>
  );
}

function decisionColor(decision: string): { color: string } {
  if (decision === 'YES' || decision === 'NO') return { color: colors.win };
  if (decision === 'SKIP') return { color: colors.warn };
  if (decision === 'ERR') return { color: colors.loss };
  return { color: colors.accent };
}

function formatSignalTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function relativeAge(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 1) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

function HeartbeatChip({
  running,
  lastPulseAt,
  intervalSec,
  nowMs,
}: {
  running: boolean;
  lastPulseAt: string | null | undefined;
  intervalSec: number;
  nowMs: number;
}) {
  const ageSec =
    lastPulseAt && Number.isFinite(new Date(lastPulseAt).getTime())
      ? Math.max(0, Math.floor((nowMs - new Date(lastPulseAt).getTime()) / 1000))
      : null;
  // Poller pulses during each asset; allow 2+ slow cycles before Stale
  const staleAfter = Math.max(120, intervalSec * 4 + 60);
  const stale = running && ageSec != null && ageSec > staleAfter;
  const pulseOn = running && !stale && nowMs % 1000 < 500;
  const dotColor = !running ? colors.mute : stale ? colors.warn : colors.win;
  const label = !running ? 'Idle' : stale ? 'Stale' : 'Live';
  const ageLabel =
    running && ageSec != null ? (ageSec < 1 ? 'now' : `${ageSec}s`) : running ? '…' : null;

  return (
    <View style={styles.chip} testID="home-heartbeat">
      <View
        style={[
          styles.heartDot,
          {
            backgroundColor: dotColor,
            opacity: running ? (pulseOn ? 1 : 0.35) : 0.45,
          },
        ]}
        testID="home-heartbeat-dot"
      />
      <Text
        style={[
          styles.chipText,
          running && !stale && { color: colors.win },
          stale && { color: colors.warn },
        ]}
      >
        {label}
        {ageLabel ? ` · ${ageLabel}` : ''}
      </Text>
    </View>
  );
}

function Chip({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <View style={[styles.chip, accent && { borderColor: colors.accent }]}>
      <Text style={[styles.chipText, accent && { color: colors.accent }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  brand: { color: colors.gold, fontSize: 28, fontWeight: '700' },
  tag: { color: colors.textSecondary, marginBottom: 4 },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  heroLeft: { flex: 1, minWidth: 100 },
  heroRight: { flexShrink: 0 },
  portfolioSummary: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  predCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surfaceElevated,
    minWidth: 96,
  },
  predLabel: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  predValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  cashCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  cashLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500', marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  heartDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  errorBanner: {
    backgroundColor: '#3a1515',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  errorTitle: { color: colors.danger, fontWeight: '800', fontSize: 13 },
  errorBody: { color: '#ffb4b4', fontSize: 12, lineHeight: 17 },
  errorSupport: { color: colors.accent, fontSize: 12, fontWeight: '700', marginTop: 4 },
  kill: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
  },
  killMuted: { opacity: 0.72 },
  killText: { color: '#fff', fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  signalsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
    flexWrap: 'wrap',
  },
  liveTick: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  label: { color: colors.textSecondary, fontSize: 13 },
  value: { color: colors.textPrimary, fontSize: 18, fontWeight: '600', marginTop: 4 },
  snapHint: { color: colors.mute, fontSize: 11, marginTop: 4, lineHeight: 15 },
  valueSmall: { color: colors.textPrimary, fontSize: 14, marginTop: 4, lineHeight: 20 },
  signalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 8,
  },
  signalLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  signalAsset: { color: colors.textPrimary, fontWeight: '700', width: 52 },
  signalDecision: { color: colors.accent, fontWeight: '800', minWidth: 36 },
  signalMeta: { color: colors.mute, fontSize: 12 },
  signalErr: { color: colors.loss, fontSize: 11, marginTop: 2, marginLeft: 52 },
  tradeAction: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
    marginLeft: 52,
    fontWeight: '600',
  },
  tradeHint: { color: colors.mute, fontSize: 11, lineHeight: 15, marginTop: 2 },
  signalTime: { color: colors.mute, fontSize: 11, textAlign: 'right', maxWidth: '42%' },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  btnAlt: { backgroundColor: colors.surfaceElevated },
  btnText: { color: colors.textPrimary, fontWeight: '700' },
  hint: { color: colors.mute, fontSize: 12, lineHeight: 18 },
});

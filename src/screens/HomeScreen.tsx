import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { AssetKey, AssetRegistry, modeLabel } from '../config/types';
import { useConfigStore } from '../state/configStore';
import { useRuntimeStore } from '../state/runtimeStore';
import { LastTradeAction } from '../runtime/AppRuntime';
import {
  getMarketScheduleNotice,
  getMarketScheduleNoticeDetail,
  getMarketScheduleNoticeLine,
  isMarketOpen,
} from '../services/marketHours';
import { PathInfoIcon } from '../components/PathInfoIcon';
import { SupportContactFooter } from '../components/SupportContactFooter';
import { TradingDisclaimer } from '../components/TradingDisclaimer';
import { ManualSuccessFly } from '../components/ManualSuccessFly';
import { supportContactEmail, withSupportContact } from '../config/appMeta';
import { formatChange24h, formatChangeWindowLabel, formatUsd } from '../util/moneyFormat';
import { cloudClient } from '../services/cloud/cloudClient';
import { formatHomePathBuyLines, summarizeTodayPathBuys } from '../storage/todayPathBuys';
import {
  formatGapDisplay,
  heldOpenFillForTicker,
  homeBuySkipReason,
  formatLastMinuteWatchLine,
  formatTwapWatchLine,
  lastSignalExtraLine,
  lastSignalManualKind,
  lastSignalOfferKind,
  twapWatchSecondsLeft,
} from './lastSignalsManual';

const ASSET_ORDER: AssetKey[] = AssetRegistry.keys;

function windowToHomeLocal(
  root: { measureInWindow?: (cb: (x: number, y: number) => void) => void } | null,
  origin?: { x: number; y: number }
): Promise<{ x: number; y: number }> {
  const fallback = {
    x: Number.isFinite(origin?.x) ? Number(origin!.x) : 24,
    y: Number.isFinite(origin?.y) ? Number(origin!.y) : 220,
  };
  return new Promise((resolve) => {
    if (!origin || !root || typeof root.measureInWindow !== 'function') {
      resolve(fallback);
      return;
    }
    let done = false;
    const finish = (pt: { x: number; y: number }) => {
      if (done) return;
      done = true;
      resolve(pt);
    };
    const t = setTimeout(() => finish(fallback), 16);
    try {
      root.measureInWindow((rx, ry) => {
        clearTimeout(t);
        if (!Number.isFinite(rx) || !Number.isFinite(ry)) {
          finish(fallback);
          return;
        }
        finish({
          x: Math.max(8, origin.x - rx),
          y: Math.max(8, origin.y - ry),
        });
      });
    } catch {
      clearTimeout(t);
      finish(fallback);
    }
  });
}

export function HomeScreen() {
  const config = useConfigStore((s) => s.config);
  const status = useRuntimeStore((s) => s.status);
  const stats = useRuntimeStore((s) => s.stats);
  const leans = useRuntimeStore((s) => s.leans);
  const leanAt = useRuntimeStore((s) => s.leanAt);
  const tradeActions = useRuntimeStore((s) => s.tradeActions);
  const assetErrors = useRuntimeStore((s) => s.assetErrors);
  const bump = useRuntimeStore((s) => s.bump);
  const predictionsBalanceUsd = useRuntimeStore((s) => s.predictionsBalanceUsd);
  const cashBalanceUsd = useRuntimeStore((s) => s.cashBalanceUsd);
  const change24hUsd = useRuntimeStore((s) => s.change24hUsd);
  const change24hPct = useRuntimeStore((s) => s.change24hPct);
  const change24hWindowMs = useRuntimeStore((s) => s.change24hWindowMs);
  const refreshPredictionsBalance = useRuntimeStore((s) => s.refreshPredictionsBalance);
  const refreshCloudSnapshot = useRuntimeStore((s) => s.refreshCloudSnapshot);
  const alerts = useRuntimeStore((s) => s.alerts);
  const trades = useRuntimeStore((s) => s.trades);
  const lastSignalsManualTrade = useRuntimeStore((s) => s.lastSignalsManualTrade);
  const activeBroadcast = useRuntimeStore((s) => s.activeBroadcast);
  const cloudKillSwitch = useRuntimeStore((s) => s.cloudKillSwitch);
  const twapLockFeatureOn = useRuntimeStore((s) => s.twapLockFeatureOn);
  const lastMinuteFeatureOn = useRuntimeStore((s) => s.lastMinuteFeatureOn);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [placing, setPlacing] = useState<Record<string, boolean>>({});
  const [fly, setFly] = useState<{ id: string; text: string; startX: number; startY: number } | null>(
    null
  );
  const placingRef = useRef<Record<string, boolean>>({});
  const mountedRef = useRef(true);
  const homeRootRef = useRef<View>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
      void refreshCloudSnapshot();
    }, 10000);
    return () => clearInterval(id);
  }, [refreshCloudSnapshot]);

  useEffect(() => {
    const twapWatch = twapLockFeatureOn && config.risk.twap_lock_enabled;
    const lastMinuteWatch = lastMinuteFeatureOn && config.risk.last_minute_enabled;
    if (!twapWatch && !lastMinuteWatch) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [
    config.risk.twap_lock_enabled,
    config.risk.last_minute_enabled,
    twapLockFeatureOn,
    lastMinuteFeatureOn,
  ]);

  // 1. On Mount: Fetch Cloud Snapshot & Balances
  useEffect(() => {
    void refreshPredictionsBalance();
    void refreshCloudSnapshot();
  }, [refreshPredictionsBalance, refreshCloudSnapshot]);

  // 2. On App Foregrounding / Return — iOS often cancels the in-flight Kalshi balance call.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshCloudSnapshot();
        void refreshPredictionsBalance();
      }
    });
    return () => {
      sub?.remove?.();
    };
  }, [refreshCloudSnapshot, refreshPredictionsBalance]);

  // 3. On `trade_result` Alert Received
  const latestAlertId = alerts[0]?.id;
  const latestAlertKind = alerts[0]?.kind;
  useEffect(() => {
    if (latestAlertKind === 'trade_result') {
      void refreshCloudSnapshot();
    }
  }, [latestAlertId, latestAlertKind, refreshCloudSnapshot]);

  // 4. On Manual Pull-to-Refresh
  const onPullToRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshPredictionsBalance(), refreshCloudSnapshot()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshPredictionsBalance, refreshCloudSnapshot]);

  const placeManual = useCallback(
    async (
      asset: AssetKey,
      action: 'buy' | 'sell',
      origin?: { x: number; y: number }
    ) => {
      if (useRuntimeStore.getState().lastSignalsManualTrade === false) {
        Alert.alert('Buy / Sell is off', 'Last signals Buy / Sell is turned off.');
        return;
      }
      if (useRuntimeStore.getState().cloudKillSwitch) {
        Alert.alert('Kill switch is on', 'Home Buy / Sell is hidden while Kill Switch is on.');
        return;
      }
      if (placingRef.current[asset]) return;
      placingRef.current[asset] = true;
      setPlacing((prev) => ({ ...prev, [asset]: true }));
      const requestId = `ios_${action}_${asset}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        const res = await cloudClient.placeManualOrder({ asset, action, requestId });
        if (!mountedRef.current) return;
        if (!res.ok) {
          Alert.alert(
            'Could not place order',
            res.message || res.error || 'Order failed. Check your connection and try again.'
          );
          return;
        }
        const start = await windowToHomeLocal(homeRootRef.current, origin);
        if (!mountedRef.current) return;
        setFly({
          id: `${asset}-${action}-${Date.now()}`,
          text: `${asset} ${action} success`,
          startX: start.x,
          startY: start.y,
        });
        void refreshCloudSnapshot();
      } catch (err: any) {
        if (!mountedRef.current) return;
        Alert.alert('Could not place order', String(err?.message || err || 'Order failed.'));
      } finally {
        placingRef.current[asset] = false;
        if (mountedRef.current) {
          setPlacing((prev) => {
            const next = { ...prev };
            delete next[asset];
            return next;
          });
        }
      }
    },
    [refreshCloudSnapshot]
  );

  void bump;

  const signalRows = ASSET_ORDER.filter((a) => config.assets_enabled[a]).map((asset) => {
    const lean = leans[asset];
    const at = leanAt[asset];
    const open = isMarketOpen(asset, new Date(nowMs)).open;
    const rawErr = assetErrors[asset];
    const err = open ? rawErr : undefined;
    const noMarket = open && (lean?.message === 'no_market' || lean?.message === 'strike_tbd' || (!lean && !rawErr));
    return {
      asset,
      decision: !open || noMarket ? 'SKIP' : (lean?.decision ?? '—'),
      gap: open ? lean?.abs_gap : undefined,
      live: open ? lean?.live : undefined,
      strike: open ? lean?.strike : undefined,
      at,
      err,
      trade: open ? (tradeActions[asset] as LastTradeAction | undefined) : undefined,
      priceSource: lean?.price_source,
      isOpen: open,
      noMarket,
      marketTicker: lean?.market_ticker || null,
    };
  });

  const lastTick = status?.cloudLastTickAt ?? status?.lastTickAt ?? status?.lastPulseAt;
  const rawIntegrationError = status?.lastError;
  let integrationError: string | null = null;
  if (rawIntegrationError) {
    const isClosedMarketErr = ASSET_ORDER.some((asset) => {
      const isClosed = !isMarketOpen(asset, new Date(nowMs)).open;
      return isClosed && rawIntegrationError.includes(asset);
    });
    if (!isClosedMarketErr && !rawIntegrationError.includes('Market closed') && !rawIntegrationError.includes('no_market')) {
      integrationError = rawIntegrationError;
    }
  }
  const hasAssetErrors = signalRows.some((r) => r.isOpen && r.err);
  const autoTradeOn = config.auto_trade_enabled;

  const featureOn = lastSignalsManualTrade !== false;
  const decoratedRows = signalRows.map((row) => {
    const held = heldOpenFillForTicker(trades, row.marketTicker);
    const cashOutHeld = held?.entry_path === 'cash_out';
    const goldFadeHeld = held?.entry_path === 'gold_fade';
    const twapLockHeld = held?.entry_path === 'twap_lock';
    const lastMinuteHeld = held?.entry_path === 'last_minute';
    const pathHeld = cashOutHeld || goldFadeHeld || twapLockHeld || lastMinuteHeld;
    const manualKind = pathHeld
      ? 'none'
      : lastSignalManualKind({
          featureOn,
          killSwitch: Boolean(cloudKillSwitch),
          row,
          held: held ? { side: held.side } : null,
        });
    const tapSkipReason =
      manualKind === 'buy'
        ? homeBuySkipReason({ cfg: config, lean: leans[row.asset] as any, trades })
        : null;
    const extraLine = lastSignalExtraLine({
      manualKind,
      autoTradeOn,
      autoDetail: row.trade?.detail,
      autoStatus: row.trade?.status,
      decision: row.decision,
      isOpen: row.isOpen,
      noMarket: row.noMarket,
      err: row.err,
      tapSkipReason,
      phase: (leans[row.asset] as { phase?: string } | undefined)?.phase,
      cashOutHolding: cashOutHeld,
      goldFadeHolding: goldFadeHeld,
      twapLockHolding: twapLockHeld,
      lastMinuteHolding: lastMinuteHeld,
      twapWatchText: formatTwapWatchLine({
        adminEnabled: twapLockFeatureOn,
        userEnabled: Boolean(config.risk.twap_lock_enabled),
        assets: config.risk.twap_lock_assets,
        asset: row.asset,
        secondsLeft: twapWatchSecondsLeft(
          (leans[row.asset] as { close_utc?: string } | undefined)?.close_utc,
          nowMs
        ),
        autoDetail: row.trade?.detail,
        autoStatus: row.trade?.status,
      }),
      lastMinuteWatchText: formatLastMinuteWatchLine({
        adminEnabled: lastMinuteFeatureOn,
        userEnabled: Boolean(config.risk.last_minute_enabled),
        assetEnabled: config.assets_enabled?.[row.asset] !== false,
        asset: row.asset,
        assets: config.risk.last_minute_assets,
        watchSeconds: config.risk.last_minute_watch_seconds,
        secondsLeft: twapWatchSecondsLeft(
          (leans[row.asset] as { close_utc?: string } | undefined)?.close_utc,
          nowMs
        ),
        autoDetail: row.trade?.detail,
        autoStatus: row.trade?.status,
      }),
    });
    const offerKind = lastSignalOfferKind(manualKind, tapSkipReason);
    return { ...row, held, manualKind: offerKind, placing: Boolean(placing[row.asset]), extraLine };
  });
  const actionRows = decoratedRows.filter((r) => r.manualKind === 'buy' || r.manualKind === 'sell');
  const otherRows = decoratedRows.filter((r) => r.manualKind === 'none');
  const todayPathBuyLines = useMemo(
    () => formatHomePathBuyLines(summarizeTodayPathBuys(trades)),
    [trades]
  );
  const scheduleNotice = useMemo(() => {
    const at = new Date(nowMs);
    const line = getMarketScheduleNoticeLine(at);
    if (!line) return null;
    return {
      line,
      detail: getMarketScheduleNoticeDetail(at) || getMarketScheduleNotice(at) || '',
    };
  }, [nowMs]);

  return (
    <View ref={homeRootRef} style={styles.root} collapsable={false}>
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
            change24hUsd={change24hUsd}
            change24hPct={change24hPct}
            change24hWindowMs={change24hWindowMs}
          />
        </View>
      </View>

      <View style={styles.chipRow}>
        <Chip label={modeLabel(config)} accent />
        <HeartbeatChip
          running={Boolean(config.auto_trade_enabled || status?.running)}
          lastPulseAt={status?.cloudLastTickAt ?? status?.lastTickAt ?? status?.lastPulseAt}
          intervalSec={config.poll_interval_seconds}
          nowMs={nowMs}
          onPress={() => void refreshCloudSnapshot()}
        />
      </View>

      {scheduleNotice ? (
        <View style={styles.scheduleBanner} testID="home-market-schedule-banner">
          <Text style={styles.scheduleLine} numberOfLines={1} testID="home-market-schedule-line">
            {scheduleNotice.line}
          </Text>
          <PathInfoIcon
            title="Market Schedule Notice"
            body={scheduleNotice.detail}
            testID="home-market-schedule-info"
          />
        </View>
      ) : null}

      {activeBroadcast?.message ? (
        <View style={styles.scheduleBanner} testID="home-broadcast-banner">
          <Text style={styles.scheduleTitle}>{activeBroadcast.title || 'Notice'}</Text>
          <Text style={styles.scheduleBody}>{activeBroadcast.message}</Text>
        </View>
      ) : null}

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

      <View style={styles.todayCard} testID="home-today-trades">
        <Text style={styles.todayLabel}>Predict trades today</Text>
        {stats.wins + stats.losses + stats.pending + stats.misses === 0 ? (
          <Text style={styles.todayValue}>No Predict fills today</Text>
        ) : (
          <Text
            style={[
              styles.todayValue,
              { color: stats.realized_pnl_usd >= 0 ? colors.win : colors.loss },
            ]}
            testID="home-today-trade-pnl"
          >
            Closed P&L ${stats.realized_pnl_usd.toFixed(2)} · {stats.wins}W / {stats.losses}L ·
            pending {stats.pending}
            {stats.misses > 0 ? ` · miss ${stats.misses}` : ''}
          </Text>
        )}
      </View>
      {todayPathBuyLines.length > 0 ? (
        <View style={styles.pathBuyCard} testID="home-today-path-buys">
          {todayPathBuyLines.map((line) => (
            <Text
              key={line}
              style={styles.pathBuyLine}
              testID={
                line.startsWith('Home') ? 'home-today-path-buys-home' : 'home-today-path-buys-auto'
              }
            >
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.card} testID="home-last-signals">
        <View style={styles.signalsHeader}>
          <Text style={styles.label}>Last signals</Text>
          <Text style={styles.liveTick} testID="home-last-tick">
            {lastTick
              ? `Last tick ${formatSignalTime(lastTick)} · ${relativeAge(lastTick, nowMs)}`
              : 'Last tick —'}
          </Text>
        </View>
        {decoratedRows.length === 0 ? (
          <Text style={styles.valueSmall}>—</Text>
        ) : (
          <>
            {actionRows.length > 0 ? (
              <Text style={styles.signalSection} testID="home-buy-sell-label">
                Home Buy / Sell
              </Text>
            ) : null}
            {actionRows.map((row) => (
              <LastSignalRow
                key={row.asset}
                row={row}
                onPlace={(action, origin) => void placeManual(row.asset, action, origin)}
              />
            ))}
            {otherRows.length > 0 && actionRows.length > 0 ? (
              <Text style={styles.signalSection} testID="home-other-signals-label">
                Other signals
              </Text>
            ) : null}
            {otherRows.map((row) => (
              <LastSignalRow
                key={row.asset}
                row={row}
                onPlace={(action, origin) => void placeManual(row.asset, action, origin)}
              />
            ))}
          </>
        )}
        {featureOn ? (
          <Text style={styles.tradeHint}>
            Lean YES/NO here is a signal. Home Buy / Sell is the Home tap path — Buy YES / Buy NO
            or Sell. A tap places now on Cloud Run (this phone never talks to Kalshi). If Auto-trade
            is On and its Risk tab also passes, Cloud can buy that same lean too, as long as shared
            caps allow (max trades / asset / 15m window, max trades / day, max open, daily loss).
            Ask too rich and other Home skips hide Buy. Kill-Switch and the Last signals Buy / Sell
            flag hide these buttons.
          </Text>
        ) : autoTradeOn ? (
          <Text style={styles.tradeHint}>
            Lean YES/NO here is a signal only. Cloud Run places real orders. This phone never
            sends buy or sell orders.
          </Text>
        ) : null}
      </View>

      <Text style={styles.hint}>
        24/7 background trading runs securely on GCP Cloud Run. Your phone does not need to stay open.
      </Text>
      <TradingDisclaimer
        variant="short"
        showTitle
        collapsible
        defaultCollapsed
        testID="home-disclaimer"
      />
      <SupportContactFooter />
    </ScrollView>
    {fly ? (
      <ManualSuccessFly
        key={fly.id}
        text={fly.text}
        startX={fly.startX}
        startY={fly.startY}
        onDone={() => setFly(null)}
      />
    ) : null}
    </View>
  );
}

function PortfolioSummary({
  predictionsUsd,
  cashUsd,
  change24hUsd,
  change24hPct,
  change24hWindowMs,
}: {
  predictionsUsd: number | null;
  cashUsd: number | null;
  change24hUsd: number | null;
  change24hPct: number | null;
  change24hWindowMs: number | null;
}) {
  const changeColor =
    change24hUsd == null ? colors.mute : change24hUsd >= 0 ? colors.win : colors.loss;
  return (
    <View style={styles.portfolioSummary} testID="home-portfolio-summary">
      <View style={styles.predCard} testID="home-predictions-card">
        <Text style={styles.predLabel}>PREDICTIONS</Text>
        <Text style={styles.predValue}>{formatUsd(predictionsUsd)}</Text>
        <Text style={[styles.predChange, { color: changeColor }]} testID="home-change-24h">
          {formatChange24h(change24hUsd, change24hPct)}
        </Text>
        <Text style={styles.predChangeLabel} testID="home-change-24h-label">
          {formatChangeWindowLabel(change24hWindowMs, change24hUsd)}
        </Text>
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
  onPress,
}: {
  running: boolean;
  lastPulseAt: string | null | undefined;
  intervalSec: number;
  nowMs: number;
  onPress?: () => void;
}) {
  const ageSec =
    lastPulseAt && Number.isFinite(new Date(lastPulseAt).getTime())
      ? Math.max(0, Math.floor((nowMs - new Date(lastPulseAt).getTime()) / 1000))
      : null;
  // Age is Cloud Run last tick when synced. Phone JS freezes on lock; that is not a Cloud outage.
  const staleAfter = Math.max(120, intervalSec * 4 + 60);
  const stale = running && ageSec != null && ageSec > staleAfter;
  const dotColor = !running ? colors.mute : stale ? colors.warn : colors.win;
  const label = !running ? 'Idle' : stale ? `Stale · cloud ${intervalSec}s` : `Live · cloud ${intervalSec}s`;
  const ageLabel = running && ageSec != null ? `${ageSec}s ago` : running ? '…' : null;

  return (
    <Pressable style={styles.chip} testID="home-heartbeat" onPress={onPress} hitSlop={6}>
      <View
        style={[
          styles.heartDot,
          {
            backgroundColor: dotColor,
            opacity: running ? 1 : 0.45,
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
    </Pressable>
  );
}

function Chip({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <View style={[styles.chip, accent && { borderColor: colors.accent }]}>
      <Text style={[styles.chipText, accent && { color: colors.accent }]}>{label}</Text>
    </View>
  );
}

function LastSignalRow({
  row,
  onPlace,
}: {
  row: {
    asset: AssetKey;
    decision: string;
    gap?: number;
    live?: number;
    strike?: number;
    at?: string;
    err?: string;
    trade?: LastTradeAction;
    isOpen: boolean;
    noMarket: boolean;
    manualKind: 'buy' | 'sell' | 'none';
    placing: boolean;
    held?: { side: 'YES' | 'NO'; entry_path?: string | null } | null;
    extraLine?: {
      testID: 'trade-action' | 'skip-reason';
      text: string;
      placed?: boolean;
      failed?: boolean;
    } | null;
  };
  onPlace: (action: 'buy' | 'sell', origin?: { x: number; y: number }) => void;
}) {
  const btnRef = React.useRef<View>(null);
  const actionable = row.manualKind !== 'none';
  const gap = formatGapDisplay({
    gap: row.gap,
    assetKey: row.asset,
    live: row.live,
    strike: row.strike,
    decision: row.decision,
    heldSide: row.held?.side,
  });
  const btnLabel =
    row.placing
      ? 'Placing…'
      : row.manualKind === 'sell'
        ? `Sell ${row.held?.side || 'YES'}`
        : `Buy ${row.decision}`;
  const firePlace = () => {
    const action: 'buy' | 'sell' = row.manualKind === 'sell' ? 'sell' : 'buy';
    const node = btnRef.current as { measureInWindow?: (cb: (...args: number[]) => void) => void } | null;
    let sent = false;
    const send = (origin?: { x: number; y: number }) => {
      if (sent) return;
      sent = true;
      onPlace(action, origin);
    };
    try {
      if (node && typeof node.measureInWindow === 'function') {
        const t = setTimeout(() => send(), 16);
        node.measureInWindow((x, y, _w, h) => {
          clearTimeout(t);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            send();
            return;
          }
          send({ x, y: y + Math.max(0, (h || 0) / 2) });
        });
        return;
      }
    } catch {
      /* test renderer / missing native measure */
    }
    send();
  };
  return (
    <View
      style={[styles.signalRow, actionable && styles.signalRowReady]}
      testID={`signal-row-${row.asset}`}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.signalLeft}>
          <Text style={styles.signalAsset}>{row.asset}</Text>
          {AssetRegistry.get(row.asset)?.category ? (
            <Text style={styles.signalCategoryIcon} testID={`signal-category-icon-${row.asset}`}>
              {AssetRegistry.getCategoryIcon(AssetRegistry.get(row.asset)?.category)}
            </Text>
          ) : null}
          <Text
            style={[
              styles.signalDecision,
              decisionColor(row.err ? 'ERR' : row.decision),
            ]}
            testID={`signal-decision-${row.asset}`}
          >
            {row.err ? 'ERR' : row.decision}
          </Text>
          {!row.err && gap.text ? (
            <Text
              style={[
                styles.signalMeta,
                gap.tone === 'with' && { color: colors.win },
                gap.tone === 'against' && { color: colors.loss },
              ]}
              testID={`signal-gap-${row.asset}`}
            >
              {gap.text}
            </Text>
          ) : null}
        </View>
        {row.err ? (
          <Text style={styles.signalErr} testID={`signal-err-${row.asset}`}>
            {row.err}
          </Text>
        ) : null}
        {row.extraLine ? (
          <Text
            style={[
              styles.tradeAction,
              row.extraLine.placed && { color: colors.win },
              row.extraLine.failed && { color: colors.loss },
              !row.extraLine.placed && !row.extraLine.failed && { color: colors.warn },
            ]}
            testID={
              row.extraLine.testID === 'trade-action'
                ? `trade-action-${row.asset}`
                : `skip-reason-${row.asset}`
            }
          >
            {row.extraLine.text}
          </Text>
        ) : null}
      </View>
      {actionable ? (
        <Pressable
          ref={btnRef}
          collapsable={false}
          style={[
            styles.manualBtn,
            row.manualKind === 'sell' ? styles.manualBtnSell : styles.manualBtnBuy,
            row.placing && styles.manualBtnBusy,
          ]}
          onPress={firePlace}
          disabled={row.placing}
          hitSlop={6}
          testID={`btn-manual-${row.manualKind}-${row.asset}`}
          accessibilityState={{ busy: row.placing, disabled: row.placing }}
        >
          {row.placing ? (
            <ActivityIndicator color="#fff" size="small" testID={`manual-placing-${row.asset}`} />
          ) : null}
          <Text style={styles.manualBtnText}>{btnLabel}</Text>
        </Pressable>
      ) : !row.isOpen ? (
        <Text style={styles.signalTime} testID={`signal-time-${row.asset}`}>
          (Market closed)
        </Text>
      ) : row.noMarket || !row.at ? (
        <Text style={styles.signalTime} testID={`signal-time-${row.asset}`}>
          (No Kalshi 15m contract)
        </Text>
      ) : null}
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
  predChange: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  predChangeLabel: {
    color: colors.mute,
    fontSize: 9,
    fontWeight: '600',
    marginTop: 1,
  },
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
  scheduleBanner: {
    backgroundColor: 'rgba(255, 171, 0, 0.08)',
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scheduleLine: { flex: 1, color: colors.gold, fontWeight: '700', fontSize: 12 },
  scheduleTitle: { color: colors.gold, fontWeight: '800', fontSize: 13 },
  scheduleBody: { color: colors.textPrimary, fontSize: 12, lineHeight: 17 },
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
  todayCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  todayLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  todayValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  pathBuyCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
    marginTop: -8,
  },
  pathBuyLine: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', lineHeight: 16 },
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
  signalRowReady: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  signalSection: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: 6,
  },
  manualBtn: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  manualBtnBuy: { backgroundColor: colors.win },
  manualBtnSell: { backgroundColor: colors.warn },
  manualBtnBusy: { opacity: 0.72 },
  manualBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  signalLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  signalAsset: { color: colors.textPrimary, fontWeight: '700', minWidth: 44 },
  signalCategoryIcon: {
    fontSize: 13,
    marginRight: 2,
  },
  signalDecision: { color: colors.accent, fontWeight: '800', minWidth: 36 },
  signalMeta: { color: colors.mute, fontSize: 12, flexShrink: 1 },
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
  hint: { color: colors.mute, fontSize: 12, lineHeight: 18 },
});

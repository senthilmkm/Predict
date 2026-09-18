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
import { AssetKey, AssetRegistry } from '../config/types';
import { homeStatusPillModel } from './homeStatusPill';
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
import { TradeActionOrb } from '../components/TradeActionOrb';
import { PathFocusId, pathTileById } from '../content/pathCatalog';
import { usePinnedPathsStore } from '../state/pinnedPathsStore';
import { SupportContactFooter } from '../components/SupportContactFooter';
import { TradingDisclaimer } from '../components/TradingDisclaimer';
import { ManualSuccessFly } from '../components/ManualSuccessFly';
import { supportContactEmail, withSupportContact } from '../config/appMeta';
import { formatChange24h, formatChangeWindowLabel, formatUsd } from '../util/moneyFormat';
import { cloudClient } from '../services/cloud/cloudClient';
import {
  formatGapDisplay,
  formatLiveAskAgeSec,
  formatLiveAskLine,
  pickLiveAsk,
  heldOpenFillForTicker,
  homeBuySkipReason,
  homeBuyGapBeatsCushion,
  homeStrongBuySides,
  homeSellSides,
  openHeldSidesForTicker,
  formatLastMinuteWatchLine,
  formatStepBuyWatchLine,
  formatSpikeFadeWatchLine,
  formatPairLockWatchLine,
  formatCapLockWatchLine,
  formatCheapLoopWatchLine,
  formatTwapWatchLine,
  lastSignalExtraLine,
  lastSignalManualKind,
  lastSignalOfferKind,
  twapWatchSecondsLeft,
} from './lastSignalsManual';
import { formatTickerOverlapLine } from './tickerOverlap';
import { isPairLockEntryPath } from '../../packages/trading-core/src/pairLock';
import {
  capLockLockedPnlUsd,
  capLockLotsForTicker,
  isCapLockEntryPath,
} from '../../packages/trading-core/src/capLock';
import { cheapLoopCooldownRemainingSec, cheapLoopLivePnlForTicker, isCheapLoopEntryPath } from '../../packages/trading-core/src/cheapLoop';

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

export function HomeScreen({
  onOpenPinnedPath,
}: {
  onOpenPinnedPath?: (focus: PathFocusId) => void;
} = {}) {
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
  const refreshLiveAsks = useRuntimeStore((s) => s.refreshLiveAsks);
  const liveAsks = useRuntimeStore((s) => s.liveAsks);
  const liveAsksAt = useRuntimeStore((s) => s.liveAsksAt);
  const alerts = useRuntimeStore((s) => s.alerts);
  const trades = useRuntimeStore((s) => s.trades);
  const lastSignalsManualTrade = useRuntimeStore((s) => s.lastSignalsManualTrade);
  const activeBroadcast = useRuntimeStore((s) => s.activeBroadcast);
  const cloudKillSwitch = useRuntimeStore((s) => s.cloudKillSwitch);
  const cashOutFeatureOn = useRuntimeStore((s) => s.cashOutFeatureOn);
  const goldFadeFeatureOn = useRuntimeStore((s) => s.goldFadeFeatureOn);
  const twapLockFeatureOn = useRuntimeStore((s) => s.twapLockFeatureOn);
  const lastMinuteFeatureOn = useRuntimeStore((s) => s.lastMinuteFeatureOn);
  const stepBuyFeatureOn = useRuntimeStore((s) => s.stepBuyFeatureOn);
  const spikeFadeFeatureOn = useRuntimeStore((s) => s.spikeFadeFeatureOn);
  const pairLockFeatureOn = useRuntimeStore((s) => s.pairLockFeatureOn);
  const capLockFeatureOn = useRuntimeStore((s) => s.capLockFeatureOn);
  const bufferRunFeatureOn = useRuntimeStore((s) => s.bufferRunFeatureOn);
  const cheapLoopFeatureOn = useRuntimeStore((s) => s.cheapLoopFeatureOn);
  const pinnedIds = usePinnedPathsStore((s) => s.ids);
  const hydratePins = usePinnedPathsStore((s) => s.hydrate);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [statusOpen, setStatusOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [placing, setPlacing] = useState<Record<string, boolean>>({});
  /** Home Buy fills before Cloud trades refresh — keeps Sell on screen. */
  const [optimisticHomeLegs, setOptimisticHomeLegs] = useState<
    Partial<Record<AssetKey, Array<{ ticker: string; side: 'YES' | 'NO' }>>>
  >({});
  const [fly, setFly] = useState<{
    id: string;
    text: string;
    startX: number;
    startY: number;
    tone?: 'success' | 'error';
  } | null>(null);
  const placingRef = useRef<Record<string, boolean>>({});
  const mountedRef = useRef(true);
  const homeRootRef = useRef<View>(null);

  useEffect(() => {
    mountedRef.current = true;
    void hydratePins();
    return () => {
      mountedRef.current = false;
    };
  }, [hydratePins]);

  // Drop optimistic Home legs once Cloud trades show the same side on that ticker.
  useEffect(() => {
    setOptimisticHomeLegs((prev) => {
      let changed = false;
      const next: typeof prev = { ...prev };
      for (const asset of Object.keys(next) as AssetKey[]) {
        const legs = next[asset];
        if (!legs?.length) continue;
        const kept = legs.filter((leg) => {
          const open = openHeldSidesForTicker(trades, leg.ticker);
          return !open.includes(leg.side);
        });
        if (kept.length !== legs.length) {
          changed = true;
          if (kept.length) next[asset] = kept;
          else delete next[asset];
        }
      }
      return changed ? next : prev;
    });
  }, [trades]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      void refreshCloudSnapshot();
    }, 10000);
    return () => clearInterval(id);
  }, [refreshCloudSnapshot]);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      const started = Date.now();
      if (AppState.currentState === 'active') {
        await refreshLiveAsks();
      }
      if (cancelled) return;
      const wait = Math.max(0, 1000 - (Date.now() - started));
      timeout = setTimeout(() => {
        void loop();
      }, wait);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [refreshLiveAsks]);

  useEffect(() => {
    const twapWatch = twapLockFeatureOn && config.risk.twap_lock_enabled;
    const lastMinuteWatch = lastMinuteFeatureOn && config.risk.last_minute_enabled;
    const stepBuyWatch = stepBuyFeatureOn && config.risk.step_buy_enabled;
    const spikeFadeWatch = spikeFadeFeatureOn && config.risk.spike_fade_enabled;
    const pairLockWatch = pairLockFeatureOn && config.risk.pair_lock_enabled;
    const capLockWatch = capLockFeatureOn && config.risk.cap_lock_enabled;
    const cheapLoopWatch = cheapLoopFeatureOn && config.risk.cheap_loop_enabled;
    if (
      !twapWatch &&
      !lastMinuteWatch &&
      !stepBuyWatch &&
      !spikeFadeWatch &&
      !pairLockWatch &&
      !capLockWatch &&
      !cheapLoopWatch
    )
      return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [
    config.risk.twap_lock_enabled,
    config.risk.last_minute_enabled,
    config.risk.step_buy_enabled,
    config.risk.spike_fade_enabled,
    config.risk.pair_lock_enabled,
    config.risk.cap_lock_enabled,
    config.risk.cheap_loop_enabled,
    twapLockFeatureOn,
    lastMinuteFeatureOn,
    stepBuyFeatureOn,
    spikeFadeFeatureOn,
    pairLockFeatureOn,
    capLockFeatureOn,
    cheapLoopFeatureOn,
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
        void refreshLiveAsks();
      }
    });
    return () => {
      sub?.remove?.();
    };
  }, [refreshCloudSnapshot, refreshPredictionsBalance, refreshLiveAsks]);

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
      await Promise.all([refreshPredictionsBalance(), refreshCloudSnapshot(), refreshLiveAsks()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshPredictionsBalance, refreshCloudSnapshot, refreshLiveAsks]);

  const placeManual = useCallback(
    async (
      asset: AssetKey,
      action: 'buy' | 'sell',
      origin?: { x: number; y: number },
      decision?: 'YES' | 'NO',
      opts?: { skipGates?: boolean }
    ) => {
      if (useRuntimeStore.getState().lastSignalsManualTrade === false) {
        Alert.alert('Buy / Sell is off', 'Last signals Buy / Sell is turned off.');
        return;
      }
      if (useRuntimeStore.getState().cloudKillSwitch) {
        Alert.alert('Kill switch is on', 'Home Buy / Sell is hidden while Kill Switch is on.');
        return;
      }
      const placeKey =
        decision && (action === 'buy' || action === 'sell')
          ? `${asset}:${action}:${decision}${opts?.skipGates ? ':force' : ''}`
          : String(asset);
      // Side-specific lock — Buy/Sell YES must not block the other side.
      if (placingRef.current[placeKey]) return;
      placingRef.current[placeKey] = true;
      setPlacing((prev) => ({ ...prev, [placeKey]: true }));
      const requestId = `ios_${action}_${asset}_${decision || 'lean'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const leanTicker = String(useRuntimeStore.getState().leans?.[asset]?.market_ticker || '').trim();
      try {
        const res = await cloudClient.placeManualOrder({
          asset,
          action,
          requestId,
          ...(decision === 'YES' || decision === 'NO' ? { decision } : {}),
          ...(opts?.skipGates ? { skipGates: true } : {}),
        });
        if (!mountedRef.current) return;
        if (!res.ok) {
          const start = await windowToHomeLocal(homeRootRef.current, origin);
          if (!mountedRef.current) return;
          const detail = String(res.message || res.error || 'Order failed').trim();
          setFly({
            id: `${asset}-${action}-err-${Date.now()}`,
            text: detail.slice(0, 120) || 'Missed',
            startX: start.x,
            startY: start.y,
            tone: 'error',
          });
          return;
        }
        if (action === 'buy' && (decision === 'YES' || decision === 'NO') && leanTicker) {
          setOptimisticHomeLegs((prev) => {
            const cur = prev[asset] || [];
            const next = cur.filter((l) => !(l.ticker === leanTicker && l.side === decision));
            next.push({ ticker: leanTicker, side: decision });
            return { ...prev, [asset]: next };
          });
        }
        if (action === 'sell' && (decision === 'YES' || decision === 'NO') && leanTicker) {
          setOptimisticHomeLegs((prev) => {
            const cur = (prev[asset] || []).filter(
              (l) => !(l.ticker === leanTicker && l.side === decision)
            );
            if (!cur.length) {
              const next = { ...prev };
              delete next[asset];
              return next;
            }
            return { ...prev, [asset]: cur };
          });
        }
        const start = await windowToHomeLocal(homeRootRef.current, origin);
        if (!mountedRef.current) return;
        setFly({
          id: `${asset}-${action}-${decision || ''}-${Date.now()}`,
          text: `${asset} ${decision || action} success`,
          startX: start.x,
          startY: start.y,
        });
        void refreshCloudSnapshot();
      } catch (err: any) {
        if (!mountedRef.current) return;
        const start = await windowToHomeLocal(homeRootRef.current, origin);
        if (!mountedRef.current) return;
        const detail = String(err?.message || err || 'Order failed').trim();
        setFly({
          id: `${asset}-${action}-err-${Date.now()}`,
          text: detail.slice(0, 120) || 'Missed',
          startX: start.x,
          startY: start.y,
          tone: 'error',
        });
      } finally {
        delete placingRef.current[placeKey];
        if (mountedRef.current) {
          setPlacing((prev) => {
            const next = { ...prev };
            delete next[placeKey];
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
      askLine: open
        ? (() => {
            const picked = pickLiveAsk({
              nowMs,
              cloudAt: liveAsksAt,
              cloud: liveAsks[asset],
              leanYes: lean?.yes_ask,
              leanNo: lean?.no_ask,
            });
            return formatLiveAskLine(picked, {
              age: picked?.source === 'watcher' ? formatLiveAskAgeSec(nowMs, liveAsksAt) : undefined,
            });
          })()
        : '',
    };
  });

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
    const ticker = String(row.marketTicker || '').trim();
    const optimisticLegs = (optimisticHomeLegs[row.asset] || []).filter((l) => l.ticker === ticker);
    const optimisticSides = optimisticLegs
      .map((l) => l.side)
      .filter((s): s is 'YES' | 'NO' => s === 'YES' || s === 'NO');
    const effectiveHeld =
      held ||
      (optimisticSides[0]
        ? { side: optimisticSides[0], entry_path: 'home' as const, fill_count: 1, dry_run: false, outcome: 'pending', market_ticker: ticker }
        : null);
    const cashOutHeld = held?.entry_path === 'cash_out';
    const goldFadeHeld = held?.entry_path === 'gold_fade';
    const twapLockHeld = held?.entry_path === 'twap_lock';
    const lastMinuteHeld = held?.entry_path === 'last_minute';
    const stepBuyHeld = held?.entry_path === 'step_buy';
    const spikeFadeHeld = held?.entry_path === 'spike_fade';
    const pairLockHeld = isPairLockEntryPath(held?.entry_path);
    const capLockHeld = isCapLockEntryPath(held?.entry_path);
    const cheapLoopHeld = isCheapLoopEntryPath(held?.entry_path);
    const pathHeld =
      cashOutHeld ||
      goldFadeHeld ||
      twapLockHeld ||
      lastMinuteHeld ||
      stepBuyHeld ||
      spikeFadeHeld ||
      pairLockHeld ||
      capLockHeld ||
      cheapLoopHeld;
    const manualKind = pathHeld
      ? 'none'
      : lastSignalManualKind({
          featureOn,
          killSwitch: Boolean(cloudKillSwitch),
          row,
          held: effectiveHeld ? { side: effectiveHeld.side } : null,
        });
    const tapSkipReason =
      manualKind === 'buy'
        ? homeBuySkipReason({ cfg: config, lean: leans[row.asset] as any, trades })
        : null;
    const leanRow = leans[row.asset] as
      | { phase?: string; close_utc?: string; minutes_elapsed?: number }
      | undefined;
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
      phase: leanRow?.phase,
      overlapText: formatTickerOverlapLine({
        asset: row.asset,
        ticker: row.marketTicker,
        decision: row.decision,
        trades,
        now: new Date(nowMs),
        closeUtc: leanRow?.close_utc,
        minutesElapsed: leanRow?.minutes_elapsed,
        minutesLeft: (leans[row.asset] as { minutes_left?: number } | undefined)?.minutes_left,
        homeOn: featureOn && !cloudKillSwitch,
        autoOn: autoTradeOn,
        cashOutAdmin: cashOutFeatureOn,
        cashOutOn: Boolean(config.risk.cash_out_enabled),
        cashOutAssets: config.risk.cash_out_assets,
        goldFadeAdmin: goldFadeFeatureOn,
        goldFadeOn: Boolean(config.risk.gold_fade_enabled),
        twapAdmin: twapLockFeatureOn,
        twapOn: Boolean(config.risk.twap_lock_enabled),
        twapAssets: config.risk.twap_lock_assets,
        lastMinuteAdmin: lastMinuteFeatureOn,
        lastMinuteOn: Boolean(config.risk.last_minute_enabled),
        lastMinuteAssets: config.risk.last_minute_assets,
        lastMinuteWatchSec: config.risk.last_minute_watch_seconds,
        lastMinuteEnterSec: config.risk.last_minute_enter_seconds,
        lastMinuteStopSec: config.risk.last_minute_stop_seconds,
        stepBuyAdmin: stepBuyFeatureOn,
        stepBuyOn: Boolean(config.risk.step_buy_enabled),
        stepBuyAssets: config.risk.step_buy_assets,
        stepBuyStartMinutes: config.risk.step_buy_start_minutes,
        spikeFadeAdmin: spikeFadeFeatureOn,
        spikeFadeOn: Boolean(config.risk.spike_fade_enabled),
        spikeFadeAssets: config.risk.spike_fade_assets,
        spikeFadeStartMinutes: config.risk.spike_fade_start_minutes,
        spikeFadeUntilMinutes: config.risk.spike_fade_until_minutes,
        pairLockAdmin: pairLockFeatureOn,
        pairLockOn: Boolean(config.risk.pair_lock_enabled),
        pairLockAssets: config.risk.pair_lock_assets,
        pairLockStartMinutes: config.risk.pair_lock_start_minutes,
        pairLockUntilMinutes: config.risk.pair_lock_until_minutes,
        capLockAdmin: capLockFeatureOn,
        capLockOn: Boolean(config.risk.cap_lock_enabled),
        capLockAssets: config.risk.cap_lock_assets,
        capLockWindowOpenSeconds: config.risk.cap_lock_window_open_seconds,
        capLockAllowLater: config.risk.cap_lock_allow_later,
        cheapLoopAdmin: cheapLoopFeatureOn,
        cheapLoopOn: Boolean(config.risk.cheap_loop_enabled),
        cheapLoopAssets: config.risk.cheap_loop_assets,
        cheapLoopStartMinutes: config.risk.cheap_loop_start_minutes,
        cheapLoopFlattenMinutes: config.risk.cheap_loop_flatten_minutes,
        assetEnabled: config.assets_enabled?.[row.asset] !== false,
      }),
      cashOutHolding: cashOutHeld,
      goldFadeHolding: goldFadeHeld,
      twapLockHolding: twapLockHeld,
      lastMinuteHolding: lastMinuteHeld,
      stepBuyHolding: stepBuyHeld,
      spikeFadeHolding: spikeFadeHeld,
      pairLockHolding: pairLockHeld,
      capLockHolding: capLockHeld,
      cheapLoopHolding: cheapLoopHeld,
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
      stepBuyWatchText: formatStepBuyWatchLine({
        adminEnabled: stepBuyFeatureOn,
        userEnabled: Boolean(config.risk.step_buy_enabled),
        assetEnabled: config.assets_enabled?.[row.asset] !== false,
        asset: row.asset,
        assets: config.risk.step_buy_assets,
        secondsLeft: twapWatchSecondsLeft(
          (leans[row.asset] as { close_utc?: string } | undefined)?.close_utc,
          nowMs
        ),
        minutesElapsed: (leans[row.asset] as { minutes_elapsed?: number } | undefined)?.minutes_elapsed,
        startMinutes: config.risk.step_buy_start_minutes,
        holding: stepBuyHeld,
        autoDetail: row.trade?.detail,
        autoStatus: row.trade?.status,
      }),
      spikeFadeWatchText: formatSpikeFadeWatchLine({
        adminEnabled: spikeFadeFeatureOn,
        userEnabled: Boolean(config.risk.spike_fade_enabled),
        assetEnabled: config.assets_enabled?.[row.asset] !== false,
        asset: row.asset,
        assets: config.risk.spike_fade_assets,
        secondsLeft: twapWatchSecondsLeft(
          (leans[row.asset] as { close_utc?: string } | undefined)?.close_utc,
          nowMs
        ),
        minutesElapsed: (leans[row.asset] as { minutes_elapsed?: number } | undefined)?.minutes_elapsed,
        startMinutes: config.risk.spike_fade_start_minutes,
        untilMinutes: config.risk.spike_fade_until_minutes,
        holding: spikeFadeHeld,
        autoDetail: row.trade?.detail,
        autoStatus: row.trade?.status,
      }),
      pairLockWatchText: formatPairLockWatchLine({
        adminEnabled: pairLockFeatureOn,
        userEnabled: Boolean(config.risk.pair_lock_enabled),
        assetEnabled: config.assets_enabled?.[row.asset] !== false,
        asset: row.asset,
        assets: config.risk.pair_lock_assets,
        secondsLeft: twapWatchSecondsLeft(
          (leans[row.asset] as { close_utc?: string } | undefined)?.close_utc,
          nowMs
        ),
        minutesElapsed: (leans[row.asset] as { minutes_elapsed?: number } | undefined)?.minutes_elapsed,
        startMinutes: config.risk.pair_lock_start_minutes,
        untilMinutes: config.risk.pair_lock_until_minutes,
        holding: pairLockHeld,
        autoDetail: row.trade?.detail,
        autoStatus: row.trade?.status,
      }),
      capLockWatchText: formatCapLockWatchLine({
        adminEnabled: capLockFeatureOn,
        userEnabled: Boolean(config.risk.cap_lock_enabled),
        assetEnabled: config.assets_enabled?.[row.asset] !== false,
        asset: row.asset,
        assets: config.risk.cap_lock_assets,
        secondsLeft: twapWatchSecondsLeft(
          (leans[row.asset] as { close_utc?: string } | undefined)?.close_utc,
          nowMs
        ),
        minutesElapsed: (leans[row.asset] as { minutes_elapsed?: number } | undefined)?.minutes_elapsed,
        minutesRemaining: (leans[row.asset] as { minutes_remaining?: number } | undefined)?.minutes_remaining,
        windowOpenSeconds: config.risk.cap_lock_window_open_seconds,
        allowLater: config.risk.cap_lock_allow_later,
        holding: capLockHeld,
        lots: capLockHeld
          ? capLockLotsForTicker(
              trades.map((t) => ({
                ticker: t.market_ticker,
                market_ticker: t.market_ticker,
                entryPath: t.entry_path,
                decision: t.side,
                fillCount: t.fill_count,
                status: t.status,
                outcome: t.outcome,
                payPrice: t.fill_price,
                executedAt: t.at,
              })),
              row.marketTicker
            )
          : null,
        lockedPnlUsd: capLockHeld
          ? capLockLockedPnlUsd({
              yesAskUsd: (leans[row.asset] as { yes_ask?: number | null } | undefined)?.yes_ask,
              noAskUsd: (leans[row.asset] as { no_ask?: number | null } | undefined)?.no_ask,
              yesCount: 1,
              noCount: 1,
            })
          : null,
        autoDetail: row.trade?.detail,
        autoStatus: row.trade?.status,
      }),
      cheapLoopWatchText: formatCheapLoopWatchLine({
        adminEnabled: cheapLoopFeatureOn,
        userEnabled: Boolean(config.risk.cheap_loop_enabled),
        assetEnabled: config.assets_enabled?.[row.asset] !== false,
        asset: row.asset,
        assets: config.risk.cheap_loop_assets,
        minutesElapsed: (leans[row.asset] as { minutes_elapsed?: number } | undefined)?.minutes_elapsed,
        minutesLeft: (leans[row.asset] as { minutes_left?: number } | undefined)?.minutes_left,
        startMinutes: config.risk.cheap_loop_start_minutes,
        flattenMinutes: config.risk.cheap_loop_flatten_minutes,
        takeUsd: config.risk.cheap_loop_take_usd,
        holding: cheapLoopHeld,
        livePnlUsd: cheapLoopHeld
          ? cheapLoopLivePnlForTicker({
              ticker: row.marketTicker,
              heldSide: held?.side,
              fillUsd: held?.fill_price,
              fillCount: held?.fill_count,
              quotes: [
                {
                  market_ticker: (leans[row.asset] as { market_ticker?: string } | undefined)?.market_ticker,
                  yes_bid: (leans[row.asset] as { yes_bid?: number | null } | undefined)?.yes_bid,
                  no_bid: (leans[row.asset] as { no_bid?: number | null } | undefined)?.no_bid,
                },
                liveAsks[row.asset]
                  ? {
                      ticker: liveAsks[row.asset]?.ticker,
                      yes_bid: liveAsks[row.asset]?.yes_bid,
                      no_bid: liveAsks[row.asset]?.no_bid,
                    }
                  : null,
              ],
            })
          : null,
        cooldownSec: cheapLoopCooldownRemainingSec({
          trades,
          marketTicker: row.marketTicker,
          cooldownMinutes: config.risk.cheap_loop_cooldown_minutes,
          now: new Date(nowMs),
        }),
        autoDetail: row.trade?.detail,
        autoStatus: row.trade?.status,
      }),
    });
    const offerKind = lastSignalOfferKind(manualKind, tapSkipReason);
    const strongBuy = homeBuyGapBeatsCushion({
      absGap: row.gap,
      cushionUsd: config.cushions[row.asset],
    });
    const syncedSides = openHeldSidesForTicker(trades, row.marketTicker);
    const openSides = Array.from(new Set([...syncedSides, ...optimisticSides]));
    const pairBuySides = homeStrongBuySides({
      strongBuy,
      offerKind,
      leanDecision: row.decision,
      heldSide: effectiveHeld?.side,
      heldEntryPath: effectiveHeld?.entry_path ?? held?.entry_path,
      openSides,
    });
    const pairSellSides = homeSellSides({
      offerKind,
      heldSide: effectiveHeld?.side,
      heldEntryPath: effectiveHeld?.entry_path ?? held?.entry_path,
      openSides,
    });
    return {
      ...row,
      held: effectiveHeld
        ? { side: effectiveHeld.side, entry_path: effectiveHeld.entry_path ?? held?.entry_path }
        : null,
      manualKind: offerKind,
      placing: Boolean(
        placing[row.asset] ||
          placing[`${row.asset}:buy:YES`] ||
          placing[`${row.asset}:buy:NO`] ||
          placing[`${row.asset}:sell:YES`] ||
          placing[`${row.asset}:sell:NO`] ||
          placing[`${row.asset}:YES`] ||
          placing[`${row.asset}:NO`]
      ),
      placingBuyYes: Boolean(
        placing[`${row.asset}:buy:YES`] ||
          placing[`${row.asset}:YES`] ||
          placing[`${row.asset}:buy:YES:force`]
      ),
      placingBuyNo: Boolean(
        placing[`${row.asset}:buy:NO`] ||
          placing[`${row.asset}:NO`] ||
          placing[`${row.asset}:buy:NO:force`]
      ),
      placingSellYes: Boolean(placing[`${row.asset}:sell:YES`]),
      placingSellNo: Boolean(placing[`${row.asset}:sell:NO`]),
      placingForce: Boolean(
        placing[`${row.asset}:buy:YES:force`] || placing[`${row.asset}:buy:NO:force`]
      ),
      extraLine,
      strongBuy,
      pairBuySides,
      pairSellSides,
    };
  });
  const actionRows = decoratedRows
    .filter((r) => r.isOpen && !r.noMarket && !r.err && Boolean(r.at))
    .slice()
    .sort((a, b) => {
      // Gap clears cushion → top (even if other Home Buy gates failed).
      const aTop = a.strongBuy ? 1 : 0;
      const bTop = b.strongBuy ? 1 : 0;
      if (bTop !== aTop) return bTop - aTop;
      return ASSET_ORDER.indexOf(a.asset) - ASSET_ORDER.indexOf(b.asset);
    });
  const otherRows = decoratedRows.filter(
    (r) => !(r.isOpen && !r.noMarket && !r.err && Boolean(r.at))
  );
  const visiblePinnedPaths = useMemo(() => {
    const flags: Record<string, boolean> = {
      cashOutFeatureOn,
      goldFadeFeatureOn,
      twapLockFeatureOn,
      lastMinuteFeatureOn,
      stepBuyFeatureOn,
      spikeFadeFeatureOn,
      pairLockFeatureOn,
      capLockFeatureOn,
      bufferRunFeatureOn,
      cheapLoopFeatureOn,
    };
    return pinnedIds.filter((id) => {
      const tile = pathTileById(id);
      return !tile.adminFlag || flags[tile.adminFlag];
    });
  }, [
    pinnedIds,
    cashOutFeatureOn,
    goldFadeFeatureOn,
    twapLockFeatureOn,
    lastMinuteFeatureOn,
    stepBuyFeatureOn,
    spikeFadeFeatureOn,
    pairLockFeatureOn,
    capLockFeatureOn,
    bufferRunFeatureOn,
    cheapLoopFeatureOn,
  ]);
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
          <HomeStatusPill
            config={config}
            running={Boolean(config.auto_trade_enabled || status?.running)}
            lastPulseAt={status?.cloudLastTickAt ?? status?.lastTickAt ?? status?.lastPulseAt}
            intervalSec={config.poll_interval_seconds}
            nowMs={nowMs}
            open={statusOpen}
            onPress={() => {
              setNowMs(Date.now());
              setStatusOpen((v) => !v);
              void refreshCloudSnapshot();
            }}
          />
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

      {visiblePinnedPaths.length > 0 ? (
        <View style={styles.pinnedRow} testID="home-pinned-paths">
          <Text style={styles.todayLabel}>Pinned paths</Text>
          <View style={styles.pinnedChips}>
            {visiblePinnedPaths.map((id) => {
              const tile = pathTileById(id);
              return (
                <Pressable
                  key={id}
                  testID={`home-pin-${id}`}
                  style={styles.pinnedChip}
                  onPress={() => onOpenPinnedPath?.(id)}
                  accessibilityLabel={`${tile.title}. Edit path.`}
                >
                  <Text style={styles.pinnedChipText}>{tile.title}</Text>
                  <Text style={styles.pinnedChipDot}> · edit</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.card} testID="home-last-signals">
        <Text style={styles.label}>Last signals</Text>
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
                onPlace={(action, origin, decision, opts) =>
                  void placeManual(row.asset, action, origin, decision, opts)
                }
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
                onPlace={(action, origin, decision, opts) =>
                  void placeManual(row.asset, action, origin, decision, opts)
                }
              />
            ))}
          </>
        )}
        {featureOn ? (
          <Text style={styles.tradeHint}>
            Lean YES/NO here is a signal. Green + = Home Buy when gap clears Enter × cushion
            (darker green when live is at least 25% past that coin’s Cushion). Gray + = place
            anyway (skips Home gates). Orange − = Sell that side. After a Home fill, only Sell
            for that side stays — no opposite Buy. A tap places now on Cloud Run (this phone never
            talks to Kalshi). If Auto-trade is On and its Risk tab also passes, Cloud can buy that
            same lean too, as long as shared caps allow. A miss is under History → Misses.
            Kill-Switch and the Last signals Buy / Sell flag hide these controls.
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
        tone={fly.tone || 'success'}
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

function HomeStatusPill({
  config,
  running,
  lastPulseAt,
  intervalSec,
  nowMs,
  open,
  onPress,
}: {
  config: { auto_trade_enabled: boolean; alerts_enabled: boolean };
  running: boolean;
  lastPulseAt: string | null | undefined;
  intervalSec: number;
  nowMs: number;
  open: boolean;
  onPress: () => void;
}) {
  const model = homeStatusPillModel({
    config,
    running,
    lastPulseAt,
    intervalSec,
    nowMs,
  });
  const dotColor =
    model.tone === 'live' ? colors.win : model.tone === 'stale' ? colors.warn : colors.mute;
  const tickColor =
    model.tone === 'live' ? colors.win : model.tone === 'stale' ? colors.warn : colors.mute;

  return (
    <View style={styles.statusWrap}>
      <Pressable
        style={styles.statusPill}
        testID="home-heartbeat"
        onPress={onPress}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${model.modeLine}. ${model.tickLine}`}
        accessibilityState={{ expanded: open }}
      >
        <View
          style={[
            styles.heartDot,
            {
              backgroundColor: dotColor,
              opacity: model.tone === 'idle' ? 0.45 : 1,
            },
          ]}
          testID="home-heartbeat-dot"
        />
        {model.paused ? (
          <Text style={[styles.statusTick, { color: colors.mute }]}>Paused</Text>
        ) : (
          <>
            {model.showAuto ? (
              <Text style={[styles.statusAuto, { color: tickColor }]}>Auto</Text>
            ) : null}
            {model.showBell ? (
              <Text style={styles.statusBell} testID="home-status-bell">
                🔔
              </Text>
            ) : null}
            {model.tickLabel ? (
              <>
                {(model.showAuto || model.showBell) ? (
                  <Text style={styles.statusDot}>·</Text>
                ) : null}
                <Text style={[styles.statusTick, { color: tickColor }]} testID="home-status-tick">
                  {model.tickLabel}
                </Text>
              </>
            ) : null}
          </>
        )}
      </Pressable>
      {open ? (
        <View style={styles.statusDetail} testID="home-status-detail">
          <Text style={styles.statusDetailMode} testID="home-status-mode">
            {model.modeLine}
          </Text>
          <Text
            style={[
              styles.statusDetailTick,
              model.tone === 'live' && { color: colors.win },
              model.tone === 'stale' && { color: colors.warn },
            ]}
          >
            {model.tickLine}
          </Text>
        </View>
      ) : null}
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
    askLine?: string;
    strongBuy?: boolean;
    pairBuySides?: Array<'YES' | 'NO'>;
    pairSellSides?: Array<'YES' | 'NO'>;
    placingBuyYes?: boolean;
    placingBuyNo?: boolean;
    placingSellYes?: boolean;
    placingSellNo?: boolean;
    placingForce?: boolean;
  };
  onPlace: (
    action: 'buy' | 'sell',
    origin?: { x: number; y: number },
    decision?: 'YES' | 'NO',
    opts?: { skipGates?: boolean }
  ) => void;
}) {
  const buyYesRef = React.useRef<View>(null);
  const buyNoRef = React.useRef<View>(null);
  const sellYesRef = React.useRef<View>(null);
  const sellNoRef = React.useRef<View>(null);
  const pairSellSides = row.pairSellSides || [];
  const showTradeActions = row.isOpen && !row.noMarket && !row.err && Boolean(row.at);
  const gap = formatGapDisplay({
    gap: row.gap,
    assetKey: row.asset,
    live: row.live,
    strike: row.strike,
    decision: row.decision,
    heldSide: row.held?.side,
  });
  /** Green only when lean side clears cushion AND Home Buy gates pass; else gray force. */
  const buyReady = (side: 'YES' | 'NO') =>
    Boolean(row.manualKind === 'buy' && row.strongBuy && row.decision === side);
  const measureAndPlace = (
    action: 'buy' | 'sell',
    decision: 'YES' | 'NO',
    ref: React.RefObject<View | null>,
    opts?: { skipGates?: boolean }
  ) => {
    const node = ref.current as {
      measureInWindow?: (cb: (...args: number[]) => void) => void;
    } | null;
    let sent = false;
    const send = (origin?: { x: number; y: number }) => {
      if (sent) return;
      sent = true;
      onPlace(action, origin, decision, opts);
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
  const fireBuy = (side: 'YES' | 'NO') => {
    const ready = buyReady(side);
    const ref = side === 'YES' ? buyYesRef : buyNoRef;
    measureAndPlace('buy', side, ref, ready ? undefined : { skipGates: true });
  };
  const fireSell = (side: 'YES' | 'NO') => {
    const ref = side === 'YES' ? sellYesRef : sellNoRef;
    measureAndPlace('sell', side, ref);
  };
  const buyBusy = (side: 'YES' | 'NO') =>
    side === 'YES' ? Boolean(row.placingBuyYes) : Boolean(row.placingBuyNo);
  const sellBusy = (side: 'YES' | 'NO') =>
    side === 'YES' ? Boolean(row.placingSellYes) : Boolean(row.placingSellNo);

  const renderBuyOrb = (side: 'YES' | 'NO') => {
    const ready = buyReady(side);
    const busy = buyBusy(side);
    const ref = side === 'YES' ? buyYesRef : buyNoRef;
    return (
      <Pressable
        key={`buy-${side}`}
        ref={ref}
        collapsable={false}
        style={[styles.orbPress, busy && styles.manualBtnBusy]}
        onPress={() => fireBuy(side)}
        disabled={busy}
        hitSlop={6}
        testID={
          ready
            ? side === 'YES'
              ? `btn-manual-buy-${row.asset}`
              : `btn-manual-buy-no-${row.asset}`
            : side === 'YES'
              ? `tap-idle-${row.asset}`
              : `tap-idle-no-${row.asset}`
        }
        accessibilityLabel={
          ready ? `Buy ${side}` : `Force buy ${side} (skip Home gates)`
        }
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
      >
        {({ pressed }) =>
          busy ? (
            <View style={styles.orbBusy}>
              <ActivityIndicator
                color={ready ? colors.win : colors.textSecondary}
                size="small"
                testID={
                  ready ? `manual-placing-${row.asset}` : `force-placing-${row.asset}`
                }
              />
            </View>
          ) : (
            <TradeActionOrb
              tone={ready ? 'buyDeep' : 'idle'}
              glyph="plus"
              size={40}
              pressed={pressed}
              badge={side}
              testID={
                ready
                  ? `buy-orb-${row.asset}`
                  : `buy-orb-idle-${side.toLowerCase()}-${row.asset}`
              }
              iconTestID={
                ready
                  ? side === 'YES'
                    ? `buy-plus-icon-${row.asset}`
                    : `buy-plus-icon-no-${row.asset}`
                  : side === 'YES'
                    ? `idle-plus-icon-${row.asset}`
                    : `idle-plus-icon-no-${row.asset}`
              }
            />
          )
        }
      </Pressable>
    );
  };

  return (
    <View
      style={[styles.signalRow, showTradeActions && styles.signalRowReady]}
      testID={`signal-row-${row.asset}`}
    >
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
        {!row.err && row.askLine ? (
          <Text style={styles.signalAsk} testID={`signal-ask-${row.asset}`}>
            {row.askLine}
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
      {!row.isOpen ? (
        <Text style={styles.signalTime} testID={`signal-time-${row.asset}`}>
          (Market closed)
        </Text>
      ) : row.noMarket || !row.at ? (
        <Text style={styles.signalTime} testID={`signal-time-${row.asset}`}>
          (No Kalshi 15m contract)
        </Text>
      ) : (
        <View style={styles.tradeCols} testID={`btn-manual-pair-${row.asset}`}>
          <View style={styles.tradeCol}>
            <Text style={styles.tradeColLabel}>Buy</Text>
            <View style={styles.tradeColOrbs}>
              {renderBuyOrb('YES')}
              {renderBuyOrb('NO')}
            </View>
          </View>
          <View style={styles.tradeCol}>
            <Text style={styles.tradeColLabel}>Sell</Text>
            <View style={styles.tradeColOrbs}>
              {pairSellSides.length === 0 ? (
                <View style={styles.tradeColEmpty} />
              ) : (
                pairSellSides.map((side) => {
                  const busy = sellBusy(side);
                  const ref = side === 'YES' ? sellYesRef : sellNoRef;
                  return (
                    <Pressable
                      key={`sell-${side}`}
                      ref={ref}
                      collapsable={false}
                      style={[styles.orbPress, busy && styles.manualBtnBusy]}
                      onPress={() => fireSell(side)}
                      disabled={busy}
                      hitSlop={6}
                      testID={`btn-manual-sell-${side.toLowerCase()}-${row.asset}`}
                      accessibilityLabel={`Sell ${side} only`}
                      accessibilityRole="button"
                      accessibilityState={{ busy, disabled: busy }}
                    >
                      {({ pressed }) =>
                        busy ? (
                          <View style={styles.orbBusy}>
                            <ActivityIndicator color={colors.warn} size="small" />
                          </View>
                        ) : (
                          <TradeActionOrb
                            tone="sell"
                            glyph="minus"
                            size={40}
                            pressed={pressed}
                            badge={side}
                            iconTestID={`sell-minus-icon-${side.toLowerCase()}-${row.asset}`}
                          />
                        )
                      }
                    </Pressable>
                  );
                })
              )}
            </View>
          </View>
        </View>
      )}
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
  statusWrap: { alignSelf: 'flex-start', maxWidth: '100%', marginTop: 2 },
  statusPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusAuto: { color: colors.gold, fontSize: 12, fontWeight: '700' },
  statusBell: { fontSize: 11, lineHeight: 14 },
  statusDot: { color: colors.mute, fontSize: 12, fontWeight: '700' },
  statusTick: { fontSize: 12, fontWeight: '700' },
  statusDetail: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surfaceElevated,
    gap: 3,
  },
  statusDetailMode: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  statusDetailTick: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  heartDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
  pinnedRow: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  pinnedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pinnedChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pinnedChipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  pinnedChipDot: { color: colors.mute, fontSize: 12, fontWeight: '600' },
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
  orbPress: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
  },
  orbBusy: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  manualBtnCol: { gap: 10, alignItems: 'center' },
  tradeCols: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tradeCol: { alignItems: 'center', gap: 4, minWidth: 88 },
  tradeColLabel: {
    color: colors.mute,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tradeColOrbs: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tradeColEmpty: { width: 40, height: 40 },
  manualBtnBuy: { backgroundColor: colors.win },
  manualBtnBuyDeep: { backgroundColor: colors.buyDeep },
  manualBtnSell: { backgroundColor: colors.warn },
  manualBtnBusy: { opacity: 0.72 },
  manualBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  signalLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  signalAsset: { color: colors.textPrimary, fontWeight: '700', minWidth: 44 },
  signalDecision: { color: colors.accent, fontWeight: '800', minWidth: 36 },
  signalMeta: { color: colors.mute, fontSize: 12, flexShrink: 1 },
  signalErr: { color: colors.loss, fontSize: 11, marginTop: 2, marginLeft: 52 },
  signalAsk: { color: colors.textSecondary, fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
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

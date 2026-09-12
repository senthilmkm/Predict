import { Router, Request, Response } from 'express';
import {
  AssetKey,
  AssetRegistry,
  computeLean,
  KalshiClient,
  defaultAppConfig,
} from 'trading-core';
import {
  countWindowBuysForTicker,
  evaluateStaticGate,
  formatSkipReason,
  windowBuyCap,
} from '../../../../packages/trading-core/src/gates';
import { isGoodTillCanceled, resolvedPlaceFillCount } from '../../../../packages/trading-core/src/orderFill';
import { LastTradeAction } from '../../../../packages/trading-core/src/types';
import { getCfbApiCredentials, getUserSecret } from '../services/secretManager';
import {
  getEnrolledActiveUsers,
  upsertUserDoc,
  saveTradeRecord,
  getTradeRecords,
  shouldLoadCloudTradeBook,
  writeAuditLog,
  getSystemConfig,
  setSystemConfig,
  TradeRecordDoc,
} from '../services/firestore';
import { runConfiguredPurgeJobs } from '../services/purgeJobs';
import {
  fillCollapseId,
  pruneLeanAlertsSent,
  type LeanAlertsSent,
} from '../services/leanAlerts';
import {
  pendingProtectTradesForMarket,
  protectCollapseId,
  runCloudProtectSells,
} from '../services/cloudProtectSell';
import {
  emitCloudAlert,
  fillAlertId,
  iocMissAlertBody,
  iocMissAlertTitle,
  missAlertId,
  orderPlacedAlertTitle,
  leanAlertSide,
  maybeEmitLeanAlert,
  protectAlertId,
  dailyLossAlertFromPnl,
  persistSettlementAlertIfNeeded,
} from '../services/cloudAlerts';
import { isMarketOpen } from '../services/marketHours';
import { etDateKey } from '../util/time';
import { setActiveKalshiRetryPolicy } from '../../../../packages/trading-core/src/kalshiRetry';
import {
  cloudDailyRealizedPnl,
  createQuoteCache,
  liveCloudTradesToday,
  settlePendingCloudTrades,
} from '../services/settlement';
import { isCloudKalshiPaused, noteTransientKalshiFailure, resetKalshiPauseForTests } from '../services/kalshiPause';
import { tryAcquirePlaceLock, releasePlaceLock } from '../services/placeLock';
import { normalizeFeatureFlags } from '../services/featureFlags';
import {
  evaluateCashOutEnter,
  isCashOutEnterPath,
  normalizeCashOutStopUsd,
  openCashOutAssets,
  tickerHasOpenCashOut,
  tickerHasOpenNonCashOut,
  bestBidSizeOnBook,
  sideAskOf,
  ticketUsd,
} from '../../../../packages/trading-core/src/cashOut';
import {
  evaluateGoldFadeEnter,
  goldFadeCheapSide,
  isGoldFadeEnterPath,
  normalizeGoldFadeFlattenMinutes,
  normalizeGoldFadeMaxGapUsd,
  normalizeGoldFadeStopUsd,
  normalizeGoldFadeTakeUsd,
  openGoldFadeAssets,
  tickerHasOpenFill,
} from '../../../../packages/trading-core/src/goldFade';
import { getMarketOrderbook, getMarketQuote } from '../../../../packages/trading-core/src/lean';
import { pendingCashOutTradesForMarket, runCloudCashOutExits } from '../services/cloudCashOut';
import { pendingGoldFadeTradesForMarket, runCloudGoldFadeExits } from '../services/cloudGoldFade';
import {
  evaluateTwapLockEnter,
  isTwapLockEnterPath,
  isTwapLockLastMinute,
  isTwapLockWatchWindow,
  normalizeTwapLockAssets,
  resolveTwapCloseUtc,
  tickerHasOpenTwapLock,
} from '../../../../packages/trading-core/src/twapLock';
import {
  evaluateLastMinuteEnter,
  isLastMinuteEnterPath,
  isLastMinuteWatchWindow,
  lastMinuteTwapOwns,
  normalizeLastMinuteMaxAskUsd,
  normalizeLastMinuteSide,
  pickLastMinuteSide,
  resolveLastMinuteCloseUtc,
  tickerHasOpenLastMinute,
} from '../../../../packages/trading-core/src/lastMinute';
import { resolveSkipThinBid } from '../../../../packages/trading-core/src/skipThinBid';
import { cfbRtiBuffer, fetchCfbRtiPrints, ingestRecentCfbPrints } from '../services/cfbRti';
import {
  buildTwapLockWatcherSnapshot,
  persistTwapLockWatcherSnapshot,
  resetTwapLockWatcherMemoryForTests,
} from '../services/twapLockWatcher';
import {
  buildLastMinuteWatcherSnapshot,
  persistLastMinuteWatcherSnapshot,
  resetLastMinuteWatcherMemoryForTests,
} from '../services/lastMinuteWatcher';

export const workerRouter = Router();

/** Same-process cache so 20s sub-ticks cannot re-ding before Firestore is re-read. */
const leanAlertMemory = new Map<string, LeanAlertsSent>();
/** Users with an open Cash out lot after the last full tick — bid-watch only these. */
const cashOutWatchUsers = new Map<string, string[]>();
const goldFadeWatchUsers = new Map<string, string[]>();
/** Armed TWAP users with a BTC/ETH window in the last 70s — 1s sample + enter only. */
const twapLockWatchUsers = new Map<string, string[]>();
/** Armed Last-minute users with an enabled asset in the last 70s — 1s sample + enter. */
const lastMinuteWatchUsers = new Map<string, string[]>();

async function cashOutBestBidSize(
  ticker: string,
  side: string,
  enabled: boolean
): Promise<number | null> {
  if (!enabled) return null;
  if (side !== 'YES' && side !== 'NO') return null;
  try {
    const book = await getMarketOrderbook(ticker);
    return bestBidSizeOnBook(side, book);
  } catch {
    return null;
  }
}

function twapWatcherCloseByAsset(
  now: Date,
  leans: Partial<Record<string, { close_utc?: string | Date | null }>>
): Record<string, Date | null | undefined> {
  const out: Record<string, Date | null | undefined> = {};
  for (const asset of new Set([...twapLockWatchUsers.values()].flat())) {
    out[asset] = resolveTwapCloseUtc(leans[asset] || {}, now);
  }
  return out;
}

async function flushTwapLockWatcher(
  now: Date,
  leans: Partial<Record<string, { close_utc?: string | Date | null }>>
): Promise<void> {
  await persistTwapLockWatcherSnapshot(
    buildTwapLockWatcherSnapshot({
      now,
      watchUsers: twapLockWatchUsers,
      closeByAsset: twapWatcherCloseByAsset(now, leans),
    })
  );
}

function lastMinuteWatcherCloseByAsset(
  now: Date,
  leans: Partial<Record<string, { close_utc?: string | Date | null }>>
): Record<string, Date | null | undefined> {
  const out: Record<string, Date | null | undefined> = {};
  for (const asset of new Set([...lastMinuteWatchUsers.values()].flat())) {
    out[asset] = resolveLastMinuteCloseUtc(leans[asset] || {}, now);
  }
  return out;
}

async function flushLastMinuteWatcher(
  now: Date,
  leans: Partial<Record<string, { close_utc?: string | Date | null }>>
): Promise<void> {
  await persistLastMinuteWatcherSnapshot(
    buildLastMinuteWatcherSnapshot({
      now,
      watchUsers: lastMinuteWatchUsers,
      closeByAsset: lastMinuteWatcherCloseByAsset(now, leans),
    })
  );
}

export function resetLeanAlertMemoryForTests(): void {
  leanAlertMemory.clear();
  cashOutWatchUsers.clear();
  goldFadeWatchUsers.clear();
  twapLockWatchUsers.clear();
  lastMinuteWatchUsers.clear();
  resetTwapLockWatcherMemoryForTests();
  resetLastMinuteWatcherMemoryForTests();
}

function loadLeanAlertsSent(userId: string, fromDoc: any): LeanAlertsSent {
  const docSent = pruneLeanAlertsSent(fromDoc?.leanAlertsSent);
  const memSent = pruneLeanAlertsSent(leanAlertMemory.get(userId));
  return { ...docSent, ...memSent };
}

function copyLastTradeActions(fromDoc: any): Partial<Record<string, LastTradeAction>> {
  const raw = fromDoc?.lastTradeAction;
  if (!raw || typeof raw !== 'object') return {};
  const next: Partial<Record<string, LastTradeAction>> = {};
  for (const [asset, action] of Object.entries(raw)) {
    if (!action || typeof action !== 'object') continue;
    const row = action as LastTradeAction;
    if (row.status !== 'placed' && row.status !== 'skipped' && row.status !== 'failed') continue;
    const detail = String(row.detail || '').trim();
    if (!detail) continue;
    next[asset] = { status: row.status, detail, at: String(row.at || '') };
  }
  return next;
}

function skippedTradeAction(reason: string | undefined, at: string): LastTradeAction {
  return { status: 'skipped', detail: `skipped · ${formatSkipReason(reason)}`, at };
}

function lastMinutePickedSide(
  lean: { yes_ask?: number; no_ask?: number },
  cfg: { risk?: { last_minute_side?: unknown; last_minute_max_ask_usd?: unknown } }
): 'YES' | 'NO' {
  const picked = pickLastMinuteSide({
    side: normalizeLastMinuteSide(cfg.risk?.last_minute_side),
    yesAsk: ticketUsd(sideAskOf('YES', lean)),
    noAsk: ticketUsd(sideAskOf('NO', lean)),
    maxAsk: normalizeLastMinuteMaxAskUsd(cfg.risk?.last_minute_max_ask_usd),
  });
  return picked.ok ? picked.decision : 'YES';
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to chunk array for parallel batch execution
function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export { resetKalshiPauseForTests };

async function runOneTick() {
  const now = new Date();
  const sysConfig = await getSystemConfig();
  const featureFlags = normalizeFeatureFlags(sysConfig?.featureFlags);
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return {
      timestamp: now.toISOString(),
      activeUserCount: 0,
      results: [],
      paused: true,
    };
  }

  const activeUsers = await getEnrolledActiveUsers();

  const results: Array<{
    userId: string;
    tradesPlaced: number;
    leansEvaluated: number;
    error?: string;
  }> = [];

  if (activeUsers.length === 0) {
    twapLockWatchUsers.clear();
    lastMinuteWatchUsers.clear();
    await flushTwapLockWatcher(now, {});
    await flushLastMinuteWatcher(now, {});
    return { timestamp: now.toISOString(), activeUserCount: 0, results: [] };
  }

  const assets: AssetKey[] =
    AssetRegistry?.keys ||
    AssetRegistry?.list?.map((a) => a.key) || [
      'BTC',
      'ETH',
      'SOL',
      'DOGE',
      'XRP',
      'BNB',
      'WTI',
      'Gold',
      'Silver',
      'NG',
      'COPPER',
      'SPX',
      'NDX',
    ];

  // 1. DEDUPLICATION: Fetch market prices ONCE per tick for all assets (shared across all users)
  const sharedLeans: Partial<Record<AssetKey, any>> = {};
  await Promise.all(
    assets.map(async (asset) => {
      try {
        const hours = isMarketOpen(asset, now);
        if (!hours.open) {
          return;
        }
        const lean = await computeLean(asset, 0.0, fetch, now);
        sharedLeans[asset] = lean;
      } catch (err: any) {
        noteTransientKalshiFailure(err);
        console.warn(`[TICK_SPOT_FETCH_WARN] Asset ${asset} fetch failed:`, err?.message || err);
      }
    })
  );

  if (isCloudKalshiPaused()) {
    return {
      timestamp: now.toISOString(),
      activeUserCount: activeUsers.length,
      results,
      paused: true,
    };
  }

  // 2. PARALLEL BATCH PROCESSING: Process active users in concurrent batches of 50
  const BATCH_SIZE = 50;
  const userBatches = chunkArray(activeUsers, BATCH_SIZE);
  const quoteCache = createQuoteCache();

  for (const batch of userBatches) {
    if (isCloudKalshiPaused()) break;
    await Promise.all(
      batch.map(async (user) => {
        const userId = user.userId;

        try {
          const cfg = user.config || defaultAppConfig();
          const protectEnabled = Boolean(cfg.risk?.protect_sell_enabled);
          // Alert-only (no keys) skip the trade book. Keys stay loaded after Auto-trade Off so fills settle.
          const loadTradeBook = shouldLoadCloudTradeBook(user);
          const rawTrades = loadTradeBook ? await getTradeRecords(userId) : [];
          const userTrades = loadTradeBook
            ? await settlePendingCloudTrades(userId, rawTrades, now, quoteCache)
            : [];
          const tradesTodayList = liveCloudTradesToday(userTrades, now);
          let openPositions = userTrades.filter(
            (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
          ).length;
          let tradesToday = tradesTodayList.length;
          const dailyPnlUsd = cloudDailyRealizedPnl(tradesTodayList);
          const isLive = cfg.execution_mode === 'live' && user.state === 'ARMED';
          let tradesCount = 0;
          let leansCount = 0;

          const userTokens = [
            ...(user.pushTokens || []),
            ...(user.fcmTokens || []),
          ].filter((t, i, arr) => t && arr.indexOf(t) === i);

          const tickIso = now.toISOString();
          for (const t of userTrades) {
            await persistSettlementAlertIfNeeded({
              userId,
              trade: t,
              now,
              cfg,
              tokens: userTokens,
            });
          }

          if (loadTradeBook && cfg.auto_trade_enabled && user.state === 'ARMED') {
            const loss = dailyLossAlertFromPnl({
              dailyPnlUsd,
              stopUsd: cfg.risk?.daily_loss_stop_usd,
              etDay: etDateKey(now),
            });
            if (loss) {
              await emitCloudAlert({
                userId,
                alertId: loss.alertId,
                kind: 'daily_loss_stop',
                title: loss.title,
                body: loss.body,
                cfg,
                tokens: userTokens,
                collapseId: `dl:${userId}:${etDateKey(now)}`.slice(0, 64),
                at: tickIso,
              });
            }
          }

          let leanAlertsSent = loadLeanAlertsSent(userId, user);
          let leanAlertsDirty = false;
          let cachedSecret: Awaited<ReturnType<typeof getUserSecret>> | undefined;
          const lastTradeAction = copyLastTradeActions(user);

          for (const asset of assets) {
            const lean = sharedLeans[asset];
            if (!lean || !lean.market_ticker) continue;
            leansCount++;

            const userCushion = cfg.cushions?.[asset] ?? 25.0;
            const absGap = Number.isFinite(Number(lean.abs_gap))
              ? Number(lean.abs_gap)
              : Math.abs((lean.live || 0) - (lean.strike || 0));
            const marketTicker = lean.market_ticker;
            const cashOutWanted = isCashOutEnterPath({
              adminEnabled: featureFlags.cashOut,
              userEnabled: Boolean(cfg.risk?.cash_out_enabled),
              assets: cfg.risk?.cash_out_assets,
              asset,
            });
            const goldFadeWanted = isGoldFadeEnterPath({
              adminEnabled: featureFlags.goldFade,
              userEnabled: Boolean(cfg.risk?.gold_fade_enabled),
              asset,
            });
            const goldFadeEnter =
              goldFadeWanted && absGap <= normalizeGoldFadeMaxGapUsd(cfg.risk?.gold_fade_max_gap_usd) + 1e-9;
            const twapClose = resolveTwapCloseUtc(lean, now);
            const twapLockWanted = isTwapLockEnterPath({
              adminEnabled: featureFlags.twapLock,
              userEnabled: Boolean(cfg.risk?.twap_lock_enabled),
              assets: cfg.risk?.twap_lock_assets,
              asset,
            });
            const twapLockEnter = Boolean(twapLockWanted && twapClose && isTwapLockLastMinute(now, twapClose));
            const lastMinuteWanted =
              isLastMinuteEnterPath({
                adminEnabled: featureFlags.lastMinute,
                userEnabled: Boolean(cfg.risk?.last_minute_enabled),
                assetEnabled: cfg.assets_enabled?.[asset] !== false,
                asset,
                assets: cfg.risk?.last_minute_assets,
              }) &&
              !lastMinuteTwapOwns({
                twapAdminEnabled: featureFlags.twapLock,
                twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                twapAssets: cfg.risk?.twap_lock_assets,
                asset,
              });
            const lastMinuteWatching = Boolean(
              lastMinuteWanted && twapClose && isLastMinuteWatchWindow(now, twapClose)
            );
            const cashOutEnter = cashOutWanted && !goldFadeEnter && !twapLockWanted && !lastMinuteWatching;

            if (
              protectEnabled &&
              loadTradeBook &&
              user.state !== 'KILL_SWITCH' &&
              user.kalshiConfigured &&
              pendingProtectTradesForMarket(userTrades, marketTicker, now).length > 0
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = new KalshiClient(
                  secret.keyId,
                  secret.privateKeyPem,
                  'production'
                );
                const protectRes = await runCloudProtectSells({
                  userId,
                  asset,
                  ticker: marketTicker,
                  lean: {
                    decision: lean.decision,
                    abs_gap: absGap,
                    phase: lean.phase,
                    yes_bid: lean.yes_bid,
                    yes_ask: lean.yes_ask,
                  },
                  trades: userTrades,
                  cushion: userCushion,
                  gapRatio: Number(cfg.risk?.protect_sell_gap_ratio ?? 1),
                  graceSeconds: Number(cfg.risk?.protect_sell_grace_seconds ?? 45),
                  slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
                  enabled: true,
                  dryRun: false,
                  now,
                  place: (input) =>
                    client.placeOrder({
                      ticker: input.ticker,
                      side: input.side,
                      count: input.count,
                      price: input.price,
                      time_in_force: input.time_in_force,
                      dry_run: input.dry_run,
                      client_order_id: input.client_order_id,
                    }),
                });
                if (protectRes.exited > 0) {
                  tradesCount += protectRes.exited;
                  openPositions = Math.max(0, openPositions - protectRes.exited);
                  await writeAuditLog(userId, 'TRADE_TRIGGERED', {
                    protectSell: true,
                    asset,
                    ticker: marketTicker,
                    exited: protectRes.exited,
                  });
                }
                for (const alert of protectRes.alerts) {
                  await emitCloudAlert({
                    userId,
                    alertId: protectAlertId(alert.tradeId),
                    kind: 'protect_sell',
                    title: alert.title,
                    body: alert.body,
                    cfg,
                    tokens: userTokens,
                    collapseId: protectCollapseId(userId, alert.tradeId),
                    asset,
                    ticker: marketTicker,
                    tradeId: alert.tradeId,
                    at: now.toISOString(),
                  });
                }
              }
            }

            if (
              loadTradeBook &&
              user.kalshiConfigured &&
              pendingCashOutTradesForMarket(userTrades, marketTicker).length > 0
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
                const cashOutRes = await runCloudCashOutExits({
                  userId,
                  asset,
                  ticker: marketTicker,
                  lean: {
                    decision: lean.decision,
                    abs_gap: absGap,
                    phase: lean.phase,
                    yes_bid: lean.yes_bid,
                    yes_ask: lean.yes_ask,
                    no_bid: lean.no_bid,
                    no_ask: lean.no_ask,
                  },
                  trades: userTrades,
                  cushion: userCushion,
                  cashOutBidUsd: Number(cfg.risk?.cash_out_bid_usd ?? 0.88),
                  cashOutMaxAskUsd: Number(cfg.risk?.cash_out_max_ask_usd ?? 0.82),
                  stopUsd: normalizeCashOutStopUsd(cfg.risk?.cash_out_stop_usd),
                  skipThinBid: resolveSkipThinBid(cfg.risk, 'cash_out'),
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    pendingCashOutTradesForMarket(userTrades, marketTicker)[0]?.decision || lean.decision,
                    resolveSkipThinBid(cfg.risk, 'cash_out')
                  ),
                  graceSeconds: Number(cfg.risk?.protect_sell_grace_seconds ?? 45),
                  slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
                  dryRun: false,
                  now,
                  place: (input) =>
                    client.placeOrder({
                      ticker: input.ticker,
                      side: input.side,
                      count: input.count,
                      price: input.price,
                      time_in_force: input.time_in_force,
                      dry_run: input.dry_run,
                      client_order_id: input.client_order_id,
                    }),
                });
                if (cashOutRes.exited > 0) {
                  tradesCount += cashOutRes.exited;
                  openPositions = Math.max(0, openPositions - cashOutRes.exited);
                  await writeAuditLog(userId, 'TRADE_TRIGGERED', {
                    cashOut: true,
                    asset,
                    ticker: marketTicker,
                    exited: cashOutRes.exited,
                  });
                }
                for (const alert of cashOutRes.alerts) {
                  await emitCloudAlert({
                    userId,
                    alertId: protectAlertId(alert.tradeId),
                    kind: 'protect_sell',
                    title: alert.title,
                    body: alert.body,
                    cfg,
                    tokens: userTokens,
                    collapseId: `cout:${userId}:${alert.tradeId}`.slice(0, 64),
                    asset,
                    ticker: marketTicker,
                    tradeId: alert.tradeId,
                    at: now.toISOString(),
                  });
                }
              }
            }

            if (
              loadTradeBook &&
              user.kalshiConfigured &&
              pendingGoldFadeTradesForMarket(userTrades, marketTicker).length > 0
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
                const heldFade = pendingGoldFadeTradesForMarket(userTrades, marketTicker)[0];
                const fadeSkipThin = resolveSkipThinBid(cfg.risk, 'gold_fade');
                const fadeRes = await runCloudGoldFadeExits({
                  userId,
                  asset,
                  ticker: marketTicker,
                  lean: {
                    decision: lean.decision,
                    abs_gap: absGap,
                    phase: lean.phase,
                    minutes_left: lean.minutes_left,
                    minutes_remaining: lean.minutes_remaining,
                    yes_bid: lean.yes_bid,
                    yes_ask: lean.yes_ask,
                    no_bid: lean.no_bid,
                    no_ask: lean.no_ask,
                  },
                  trades: userTrades,
                  cushion: userCushion,
                  takeUsd: normalizeGoldFadeTakeUsd(cfg.risk?.gold_fade_take_usd),
                  stopUsd: normalizeGoldFadeStopUsd(cfg.risk?.gold_fade_stop_usd),
                  flattenMinutes: normalizeGoldFadeFlattenMinutes(cfg.risk?.gold_fade_flatten_minutes),
                  skipThinBid: fadeSkipThin,
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    heldFade?.decision || lean.decision,
                    fadeSkipThin
                  ),
                  graceSeconds: Number(cfg.risk?.protect_sell_grace_seconds ?? 45),
                  slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
                  dryRun: false,
                  now,
                  place: (input) =>
                    client.placeOrder({
                      ticker: input.ticker,
                      side: input.side,
                      count: input.count,
                      price: input.price,
                      time_in_force: input.time_in_force,
                      dry_run: input.dry_run,
                      client_order_id: input.client_order_id,
                    }),
                });
                if (fadeRes.exited > 0) {
                  tradesCount += fadeRes.exited;
                  openPositions = Math.max(0, openPositions - fadeRes.exited);
                  await writeAuditLog(userId, 'TRADE_TRIGGERED', {
                    goldFade: true,
                    asset,
                    ticker: marketTicker,
                    exited: fadeRes.exited,
                  });
                }
                for (const alert of fadeRes.alerts) {
                  await emitCloudAlert({
                    userId,
                    alertId: protectAlertId(alert.tradeId),
                    kind: 'protect_sell',
                    title: alert.title,
                    body: alert.body,
                    cfg,
                    tokens: userTokens,
                    collapseId: `fade:${userId}:${alert.tradeId}`.slice(0, 64),
                    asset,
                    ticker: marketTicker,
                    tradeId: alert.tradeId,
                    at: now.toISOString(),
                  });
                }
              }
            }

            const leanSide = leanAlertSide(lean);
            if (leanSide) {
              const leanEmit = await maybeEmitLeanAlert({
                userId,
                cfg,
                tokens: userTokens,
                asset,
                ticker: marketTicker,
                decision: leanSide,
                absGap,
                cushion: userCushion,
                minutesLeft: lean.minutes_left ?? '?',
                leanAlertsSent,
                now,
              });
              if (leanEmit.dirty) {
                leanAlertsSent = leanEmit.next;
                leanAlertsDirty = true;
                leanAlertMemory.set(userId, leanAlertsSent);
              }
            }

            if (!cfg.assets_enabled?.[asset]) {
              continue;
            }
            if (!cashOutEnter && !goldFadeEnter && !twapLockWanted && !lastMinuteWatching && absGap < userCushion) {
              delete lastTradeAction[asset];
              continue;
            }
            const windowCap = windowBuyCap(cfg.risk);
            const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
            if (existingBuys >= windowCap) {
              lastTradeAction[asset] = skippedTradeAction('max_trades_asset_window', tickIso);
              continue;
            }
            if (!cashOutEnter && tickerHasOpenCashOut(userTrades, marketTicker)) {
              lastTradeAction[asset] = skippedTradeAction('cash_out_holding', tickIso);
              continue;
            }
            if (!twapLockEnter && tickerHasOpenTwapLock(userTrades, marketTicker)) {
              lastTradeAction[asset] = skippedTradeAction('twap_lock_holding', tickIso);
              continue;
            }
            if (!lastMinuteWatching && tickerHasOpenLastMinute(userTrades, marketTicker)) {
              lastTradeAction[asset] = skippedTradeAction('last_minute_holding', tickIso);
              continue;
            }

            const leanForGate = {
              asset: lean.asset,
              market_ticker: lean.market_ticker,
              decision: lean.decision,
              live: lean.live || 0,
              strike: lean.strike || 0,
              abs_gap: absGap,
              minutes_left: lean.minutes_left || 0,
              minutes_elapsed: lean.minutes_elapsed || 0,
              minutes_remaining: lean.minutes_remaining,
              phase: (lean.phase === 'live' ? 'live' : 'ended') as 'live' | 'ended',
              yes_ask: lean.yes_ask ?? undefined,
              no_ask: lean.no_ask ?? undefined,
              yes_bid: lean.yes_bid ?? undefined,
              no_bid: lean.no_bid ?? undefined,
              timeseries: lean.timeseries,
              close_utc: lean.close_utc,
            };
            const cashOutThin = resolveSkipThinBid(cfg.risk, 'cash_out');
            const fadeThin = resolveSkipThinBid(cfg.risk, 'gold_fade');
            const twapThin = resolveSkipThinBid(cfg.risk, 'twap_lock');
            const lastThin = resolveSkipThinBid(cfg.risk, 'last_minute');
            const fadeSide = goldFadeCheapSide(leanForGate);
            if (twapLockWanted && twapClose && isTwapLockWatchWindow(now, twapClose)) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const twapClient =
                cachedSecret?.privateKeyPem && cachedSecret.keyId
                  ? new KalshiClient(cachedSecret.keyId, cachedSecret.privateKeyPem, 'production')
                  : null;
              const samples = await fetchCfbRtiPrints(asset, { now, kalshi: twapClient });
              ingestRecentCfbPrints(asset, samples, now);
            }
            const gate = twapLockWanted
              ? evaluateTwapLockEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.twapLock,
                  prints: cfbRtiBuffer.prints(asset),
                  now,
                  openPositions,
                  tradesToday,
                  assetTradesInWindow: existingBuys,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenFill(userTrades, marketTicker),
                  skipThinBid: twapThin,
                  bidSize: await cashOutBestBidSize(marketTicker, 'YES', twapThin),
                })
              : lastMinuteWatching
              ? evaluateLastMinuteEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.lastMinute,
                  twapAdminEnabled: featureFlags.twapLock,
                  now,
                  openPositions,
                  tradesToday,
                  assetTradesInWindow: existingBuys,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenFill(userTrades, marketTicker),
                  skipThinBid: lastThin,
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    lastMinutePickedSide(leanForGate, cfg),
                    lastThin
                  ),
                })
              : goldFadeEnter
              ? evaluateGoldFadeEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.goldFade,
                  openPositions,
                  tradesToday,
                  assetTradesInWindow: existingBuys,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenFill(userTrades, marketTicker),
                  skipThinBid: fadeThin,
                  bidSize: await cashOutBestBidSize(marketTicker, fadeSide || lean.decision, fadeThin),
                })
              : cashOutEnter
                ? evaluateCashOutEnter({
                    lean: leanForGate,
                    cfg,
                    adminEnabled: featureFlags.cashOut,
                    openPositions,
                    tradesToday,
                    assetTradesInWindow: existingBuys,
                    dailyPnlUsd,
                    hasOpenNonCashOutOnTicker: tickerHasOpenNonCashOut(userTrades, marketTicker),
                    skipThinBid: cashOutThin,
                    bidSize: await cashOutBestBidSize(marketTicker, lean.decision, cashOutThin),
                  })
                : evaluateStaticGate(leanForGate, cfg, {
                    openPositions,
                    tradesToday,
                    assetTradesInWindow: existingBuys,
                    dailyPnlUsd,
                  });
            const entryPath = twapLockWanted
              ? 'twap_lock'
              : lastMinuteWatching
                ? 'last_minute'
                : goldFadeEnter
                  ? 'gold_fade'
                  : cashOutEnter
                    ? 'cash_out'
                    : 'auto';
            const placeDecision =
              entryPath === 'twap_lock'
                ? 'YES'
                : entryPath === 'last_minute'
                  ? gate.decision || lean.decision
                  : lean.decision;

            if (!cfg.auto_trade_enabled || user.state !== 'ARMED') {
              delete lastTradeAction[asset];
              continue;
            }
            if (!gate.ok || !gate.price || !gate.count) {
              if (
                gate.skip_reason === 'twap_lock_not_last_minute' ||
                gate.skip_reason === 'last_minute_not_last_minute'
              ) {
                delete lastTradeAction[asset];
                continue;
              }
              lastTradeAction[asset] = skippedTradeAction(
                gate.skip_reason || 'notional_too_small',
                tickIso
              );
              continue;
            }

            const secret = await getUserSecret(userId);
            if (!secret || !secret.privateKeyPem || !secret.keyId) {
              lastTradeAction[asset] = skippedTradeAction('no_client', tickIso);
              await upsertUserDoc(userId, { lastError: 'missing_secret_key' });
              continue;
            }

            const placeRequestId = `tick_${userId}_${marketTicker}_${Date.now()}_${Math.random()
              .toString(36)
              .slice(2, 8)}`.slice(0, 64);
            const claimed = await tryAcquirePlaceLock({
              userId,
              ticker: marketTicker,
              cap: windowCap,
              requestId: placeRequestId,
              existingBuys,
            });
            if (!claimed.ok) {
              lastTradeAction[asset] = skippedTradeAction(claimed.reason, tickIso);
              continue;
            }

            const client = new KalshiClient(secret.keyId, secret.privateKeyPem, isLive ? 'production' : 'demo');
            try {
              const placeRes = await client.placeOrder({
                ticker: marketTicker,
                side: gate.side || 'bid',
                count: gate.count,
                price: gate.price,
                time_in_force: gate.time_in_force,
                dry_run: !isLive,
              });

            if (placeRes.ok) {
              tradesCount++;
              const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              const tif = placeRes.payload?.time_in_force || gate.time_in_force;
              const gtcResting = isGoodTillCanceled(tif);
              const { fillCount, filled } = resolvedPlaceFillCount({
                dryRun: Boolean(placeRes.dry_run) || !isLive,
                fillCount: placeRes.fill_count,
                intendedCount: gate.count,
              });
              const payPrice = Number(gate.pay_price ?? 0) || null;
              const accepted = filled || (gtcResting && Boolean(placeRes.order_id));

              const tradeDoc: TradeRecordDoc = {
                tradeId,
                userId,
                ticker: marketTicker,
                asset: lean.asset,
                decision: placeDecision,
                count: filled ? String(fillCount) : String(gate.count || 0),
                price: gate.price,
                notionalUsd: filled && payPrice
                  ? Math.round(fillCount * payPrice * 100) / 100
                  : gate.notional_usd || 0,
                dryRun: !isLive,
                status: filled ? 'FILLED' : accepted ? 'SUBMITTED' : 'CANCELLED',
                leanDiff: absGap,
                liveSpot: lean.live,
                strike: lean.strike,
                executedAt: now.toISOString(),
                orderId: placeRes.order_id ?? null,
                payPrice,
                fillCount: filled ? fillCount : 0,
                outcome: filled || accepted ? 'pending' : 'miss',
                pnlUsd: null,
                entryPath,
              };

              await saveTradeRecord(userId, tradeDoc);
              userTrades.unshift(tradeDoc);
              if (filled && !tradeDoc.dryRun) {
                openPositions += 1;
                tradesToday += 1;
                tradesTodayList.push(tradeDoc);
              }
              await writeAuditLog(userId, 'TRADE_TRIGGERED', {
                tradeId,
                ticker: marketTicker,
                asset: lean.asset,
                decision: placeDecision,
                mode: isLive ? 'live' : 'demo',
              });

              const priceVal = typeof gate.price === 'number' ? gate.price : parseFloat(String(gate.price || 0));
              lastTradeAction[asset] = filled
                ? {
                    status: 'placed',
                    detail: `placed ${placeDecision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
                    at: tickIso,
                  }
                : accepted
                  ? {
                      status: 'placed',
                      detail: `resting ${placeDecision} · waiting for fill`,
                      at: tickIso,
                    }
                : { status: 'failed', detail: 'IOC no fill', at: tickIso };
              if (filled) {
                const fillTitle = orderPlacedAlertTitle({
                  live: isLive,
                  asset,
                  decision: String(placeDecision || ''),
                  entryPath,
                });
                const fillBody = `${gate.count} ctr @ $${priceVal.toFixed(2)} · Cost $${(gate.notional_usd || 0).toFixed(2)}`;
                await emitCloudAlert({
                  userId,
                  alertId: fillAlertId(tradeId),
                  kind: 'order_filled',
                  title: fillTitle,
                  body: fillBody,
                  cfg,
                  tokens: userTokens,
                  collapseId: fillCollapseId(userId, tradeId),
                  asset: lean.asset,
                  ticker: marketTicker,
                  tradeId,
                  decision: lean.decision,
                  at: now.toISOString(),
                });
              } else if (!accepted) {
                await emitCloudAlert({
                  userId,
                  alertId: missAlertId(tradeId),
                  kind: 'ioc_miss',
                  title: iocMissAlertTitle(entryPath),
                  body: iocMissAlertBody({
                    asset,
                    decision: String(placeDecision || ''),
                    entryPath,
                  }),
                  cfg,
                  tokens: userTokens,
                  asset: lean.asset,
                  ticker: marketTicker,
                  tradeId,
                  decision: placeDecision,
                  at: now.toISOString(),
                });
              }
            } else {
              lastTradeAction[asset] = {
                status: 'failed',
                detail: String(placeRes.error || 'order failed'),
                at: tickIso,
              };
            }
            } finally {
              await releasePlaceLock({ userId, ticker: marketTicker, requestId: placeRequestId });
            }
          }

          if (leanAlertsDirty) {
            leanAlertMemory.set(userId, leanAlertsSent);
          }
          const stillOpenCashOut = openCashOutAssets(userTrades);
          if (stillOpenCashOut.length) cashOutWatchUsers.set(userId, stillOpenCashOut);
          else cashOutWatchUsers.delete(userId);
          const stillOpenFade = openGoldFadeAssets(userTrades);
          if (stillOpenFade.length) goldFadeWatchUsers.set(userId, stillOpenFade);
          else goldFadeWatchUsers.delete(userId);
          if (
            featureFlags.twapLock &&
            cfg.auto_trade_enabled &&
            user.state === 'ARMED' &&
            Boolean(cfg.risk?.twap_lock_enabled)
          ) {
            const watchAssets = normalizeTwapLockAssets(cfg.risk?.twap_lock_assets).filter((a) => {
              const row = sharedLeans[a as AssetKey];
              const close = row ? resolveTwapCloseUtc(row, now) : null;
              return Boolean(close && isTwapLockWatchWindow(now, close));
            });
            if (watchAssets.length) twapLockWatchUsers.set(userId, watchAssets);
            else twapLockWatchUsers.delete(userId);
          } else {
            twapLockWatchUsers.delete(userId);
          }
          if (
            featureFlags.lastMinute &&
            cfg.auto_trade_enabled &&
            user.state === 'ARMED' &&
            Boolean(cfg.risk?.last_minute_enabled)
          ) {
            const watchAssets = assets.filter((a) => {
              if (cfg.assets_enabled?.[a] === false) return false;
              if (
                !isLastMinuteEnterPath({
                  adminEnabled: true,
                  userEnabled: true,
                  assetEnabled: true,
                  asset: a,
                  assets: cfg.risk?.last_minute_assets,
                })
              ) {
                return false;
              }
              if (
                lastMinuteTwapOwns({
                  twapAdminEnabled: featureFlags.twapLock,
                  twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                  twapAssets: cfg.risk?.twap_lock_assets,
                  asset: a,
                })
              ) {
                return false;
              }
              const row = sharedLeans[a];
              const close = row ? resolveLastMinuteCloseUtc(row, now) : null;
              return Boolean(close && isLastMinuteWatchWindow(now, close));
            });
            if (watchAssets.length) lastMinuteWatchUsers.set(userId, watchAssets);
            else lastMinuteWatchUsers.delete(userId);
          } else {
            lastMinuteWatchUsers.delete(userId);
          }
          await upsertUserDoc(userId, {
            lastTickAt: now.toISOString(),
            lastError: null,
            lastTradeAction,
            ...(leanAlertsDirty ? { leanAlertsSent } : {}),
          } as any);

          results.push({ userId, tradesPlaced: tradesCount, leansEvaluated: leansCount });
        } catch (err: any) {
          await upsertUserDoc(userId, {
            lastTickAt: now.toISOString(),
            lastError: err?.message || 'tick_exception',
          });
          await writeAuditLog(userId, 'ERROR', { error: err?.message || 'tick_exception' });
          results.push({ userId, tradesPlaced: 0, leansEvaluated: 0, error: err?.message || 'tick_exception' });
          noteTransientKalshiFailure(err);
        }
      })
    );
  }

  await flushTwapLockWatcher(now, sharedLeans);
  await flushLastMinuteWatcher(now, sharedLeans);
  return { timestamp: now.toISOString(), activeUserCount: activeUsers.length, results };
}

/** Last-minute 1s sample + Yes enter only. No exits — hold to $1. */
export async function runTwapLockWatchTick(): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  if (twapLockWatchUsers.size === 0) {
    const now = new Date();
    await flushTwapLockWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const now = new Date();
  const sysConfig = await getSystemConfig();
  const featureFlags = normalizeFeatureFlags(sysConfig?.featureFlags);
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }
  if (!featureFlags.twapLock) {
    twapLockWatchUsers.clear();
    await flushTwapLockWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }

  const watchAssets = [...new Set([...twapLockWatchUsers.values()].flat())] as AssetKey[];
  const platformCreds = await getCfbApiCredentials();
  let sharedKalshi: KalshiClient | null = null;
  if (!platformCreds) {
    for (const userId of twapLockWatchUsers.keys()) {
      const secret = await getUserSecret(userId);
      if (secret?.privateKeyPem && secret.keyId) {
        sharedKalshi = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
        break;
      }
    }
    if (!sharedKalshi) {
      return { timestamp: now.toISOString(), watched: 0 };
    }
  }
  await Promise.all(
    watchAssets.map(async (asset) => {
      const prints = await fetchCfbRtiPrints(asset, { now, kalshi: sharedKalshi, credentials: platformCreds });
      ingestRecentCfbPrints(asset, prints, now);
    })
  );

  const sharedLeans: Partial<Record<AssetKey, any>> = {};
  await Promise.all(
    watchAssets.map(async (asset) => {
      try {
        if (!isMarketOpen(asset, now).open) return;
        sharedLeans[asset] = await computeLean(asset, 0.0, fetch, now);
      } catch (err: any) {
        noteTransientKalshiFailure(err);
      }
    })
  );

  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;

  for (const [userId, assets] of [...twapLockWatchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      twapLockWatchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      if (!cfg.auto_trade_enabled || user.state !== 'ARMED' || !cfg.risk?.twap_lock_enabled) {
        twapLockWatchUsers.delete(userId);
        continue;
      }
      const rawTrades = await getTradeRecords(userId);
      const quoteCache = createQuoteCache();
      const userTrades = await settlePendingCloudTrades(userId, rawTrades, now, quoteCache);
      const tradesTodayList = liveCloudTradesToday(userTrades, now);
      let openPositions = userTrades.filter(
        (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
      ).length;
      let tradesToday = tradesTodayList.length;
      const dailyPnlUsd = cloudDailyRealizedPnl(tradesTodayList);
      const lastTradeAction = copyLastTradeActions(user);
      const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
        (t, i, arr) => t && arr.indexOf(t) === i
      );
      const tickIso = now.toISOString();
      const still: string[] = [];

      for (const asset of assets) {
        const lean = sharedLeans[asset];
        if (!lean?.market_ticker) continue;
        const closeUtc = resolveTwapCloseUtc(lean, now);
        if (!closeUtc || !isTwapLockWatchWindow(now, closeUtc)) continue;
        still.push(asset);
        if (!isTwapLockLastMinute(now, closeUtc)) continue;
        watched += 1;
        const marketTicker = lean.market_ticker;
        const windowCap = windowBuyCap(cfg.risk);
        const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
        if (existingBuys >= windowCap) {
          lastTradeAction[asset] = skippedTradeAction('max_trades_asset_window', tickIso);
          continue;
        }
        let yesAsk = lean.yes_ask;
        try {
          const quote = await getMarketQuote(marketTicker, fetch, { skipCache: true });
          if (quote?.yes_ask_dollars != null) yesAsk = Number(quote.yes_ask_dollars);
        } catch {
          /* keep lean ask */
        }
        const skipThinBid = resolveSkipThinBid(cfg.risk, 'twap_lock');
        const absGap = Number.isFinite(Number(lean.abs_gap))
          ? Number(lean.abs_gap)
          : Math.abs((lean.live || 0) - (lean.strike || 0));
        const leanForGate = {
          asset: lean.asset,
          market_ticker: marketTicker,
          decision: 'YES' as const,
          live: lean.live || 0,
          strike: lean.strike || 0,
          abs_gap: absGap,
          minutes_left: lean.minutes_left || 0,
          minutes_elapsed: lean.minutes_elapsed || 0,
          minutes_remaining: lean.minutes_remaining,
          phase: (lean.phase === 'live' ? 'live' : 'ended') as 'live' | 'ended',
          yes_ask: yesAsk ?? undefined,
          no_ask: lean.no_ask ?? undefined,
          yes_bid: lean.yes_bid ?? undefined,
          no_bid: lean.no_bid ?? undefined,
          timeseries: lean.timeseries,
          close_utc: lean.close_utc,
        };
        const gate = evaluateTwapLockEnter({
          lean: leanForGate,
          cfg,
          adminEnabled: featureFlags.twapLock,
          prints: cfbRtiBuffer.prints(asset),
          now,
          openPositions,
          tradesToday,
          assetTradesInWindow: existingBuys,
          dailyPnlUsd,
          hasOpenOnTicker: tickerHasOpenFill(userTrades, marketTicker),
          skipThinBid,
          bidSize: await cashOutBestBidSize(marketTicker, 'YES', skipThinBid),
        });
        if (!gate.ok || !gate.price || !gate.count) {
          lastTradeAction[asset] = skippedTradeAction(gate.skip_reason || 'twap_lock_feed', tickIso);
          continue;
        }
        const secret = await getUserSecret(userId);
        if (!secret?.privateKeyPem || !secret.keyId) {
          lastTradeAction[asset] = skippedTradeAction('no_client', tickIso);
          continue;
        }
        const placeRequestId = `twap_${userId}_${marketTicker}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`.slice(0, 64);
        const claimed = await tryAcquirePlaceLock({
          userId,
          ticker: marketTicker,
          cap: windowCap,
          requestId: placeRequestId,
          existingBuys,
        });
        if (!claimed.ok) {
          lastTradeAction[asset] = skippedTradeAction(claimed.reason, tickIso);
          continue;
        }
        const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
        try {
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: gate.side || 'bid',
            count: gate.count,
            price: gate.price,
            time_in_force: gate.time_in_force,
            dry_run: false,
          });
          if (!placeRes.ok) {
            lastTradeAction[asset] = {
              status: 'failed',
              detail: String(placeRes.error || 'order failed'),
              at: tickIso,
            };
            continue;
          }
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: gate.count,
          });
          const payPrice = Number(gate.pay_price ?? 0) || null;
          const accepted = filled || Boolean(placeRes.order_id && isGoodTillCanceled(gate.time_in_force));
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: 'YES',
            count: filled ? String(fillCount) : String(gate.count || 0),
            price: gate.price,
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : gate.notional_usd || 0,
            dryRun: false,
            status: filled ? 'FILLED' : accepted ? 'SUBMITTED' : 'CANCELLED',
            leanDiff: absGap,
            liveSpot: lean.live,
            strike: lean.strike,
            executedAt: now.toISOString(),
            orderId: placeRes.order_id ?? null,
            payPrice,
            fillCount: filled ? fillCount : 0,
            outcome: filled || accepted ? 'pending' : 'miss',
            pnlUsd: null,
            entryPath: 'twap_lock',
          };
          await saveTradeRecord(userId, tradeDoc);
          userTrades.unshift(tradeDoc);
          if (filled) {
            openPositions += 1;
            tradesToday += 1;
            tradesTodayList.push(tradeDoc);
          }
          const priceVal =
            typeof gate.price === 'number' ? gate.price : parseFloat(String(gate.price || 0));
          lastTradeAction[asset] = filled
            ? { status: 'placed', detail: `placed YES · ${fillCount} @ $${priceVal.toFixed(2)}`, at: tickIso }
            : accepted
              ? { status: 'placed', detail: 'resting YES · waiting for fill', at: tickIso }
              : { status: 'failed', detail: 'IOC no fill', at: tickIso };
          if (filled) {
            await emitCloudAlert({
              userId,
              alertId: fillAlertId(tradeId),
              kind: 'order_filled',
              title: orderPlacedAlertTitle({
                live: true,
                asset,
                decision: 'YES',
                entryPath: 'twap_lock',
              }),
              body: `${gate.count} ctr @ $${priceVal.toFixed(2)} · Cost $${(gate.notional_usd || 0).toFixed(2)}`,
              cfg,
              tokens: userTokens,
              collapseId: fillCollapseId(userId, tradeId),
              asset: lean.asset,
              ticker: marketTicker,
              tradeId,
              decision: 'YES',
              at: now.toISOString(),
            });
          }
        } finally {
          await releasePlaceLock({ userId, ticker: marketTicker, requestId: placeRequestId });
        }
      }

      if (still.length) twapLockWatchUsers.set(userId, still);
      else twapLockWatchUsers.delete(userId);
      await upsertUserDoc(userId, { lastTradeAction, lastTickAt: now.toISOString() } as any);
    } catch (err: any) {
      noteTransientKalshiFailure(err);
    }
  }

  await flushTwapLockWatcher(now, sharedLeans);
  return { timestamp: now.toISOString(), watched };
}

/** Last-minute 1s sample. No lock math. Hold to settlement. */
export async function runLastMinuteWatchTick(): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  if (lastMinuteWatchUsers.size === 0) {
    const now = new Date();
    await flushLastMinuteWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const now = new Date();
  const sysConfig = await getSystemConfig();
  const featureFlags = normalizeFeatureFlags(sysConfig?.featureFlags);
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }
  if (!featureFlags.lastMinute) {
    lastMinuteWatchUsers.clear();
    await flushLastMinuteWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }

  const watchAssets = [...new Set([...lastMinuteWatchUsers.values()].flat())] as AssetKey[];
  const sharedLeans: Partial<Record<AssetKey, any>> = {};
  await Promise.all(
    watchAssets.map(async (asset) => {
      try {
        if (!isMarketOpen(asset, now).open) return;
        sharedLeans[asset] = await computeLean(asset, 0.0, fetch, now);
      } catch (err: any) {
        noteTransientKalshiFailure(err);
      }
    })
  );

  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;

  for (const [userId, userAssets] of [...lastMinuteWatchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      lastMinuteWatchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      if (!cfg.auto_trade_enabled || user.state !== 'ARMED' || !cfg.risk?.last_minute_enabled) {
        lastMinuteWatchUsers.delete(userId);
        continue;
      }
      const rawTrades = await getTradeRecords(userId);
      const quoteCache = createQuoteCache();
      const userTrades = await settlePendingCloudTrades(userId, rawTrades, now, quoteCache);
      const tradesTodayList = liveCloudTradesToday(userTrades, now);
      let openPositions = userTrades.filter(
        (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
      ).length;
      let tradesToday = tradesTodayList.length;
      const dailyPnlUsd = cloudDailyRealizedPnl(tradesTodayList);
      const lastTradeAction = copyLastTradeActions(user);
      const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
        (t, i, arr) => t && arr.indexOf(t) === i
      );
      const tickIso = now.toISOString();
      const still: string[] = [];

      for (const asset of userAssets) {
        const lean = sharedLeans[asset];
        if (!lean?.market_ticker) continue;
        const closeUtc = resolveLastMinuteCloseUtc(lean, now);
        if (!closeUtc || !isLastMinuteWatchWindow(now, closeUtc)) continue;
        still.push(asset);
        if (
          lastMinuteTwapOwns({
            twapAdminEnabled: featureFlags.twapLock,
            twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
            twapAssets: cfg.risk?.twap_lock_assets,
            asset,
          })
        ) {
          continue;
        }
        if (!isTwapLockLastMinute(now, closeUtc)) continue;
        watched += 1;
        const marketTicker = lean.market_ticker;
        const windowCap = windowBuyCap(cfg.risk);
        const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
        if (existingBuys >= windowCap) {
          lastTradeAction[asset] = skippedTradeAction('max_trades_asset_window', tickIso);
          continue;
        }
        let yesAsk = lean.yes_ask;
        let noAsk = lean.no_ask;
        try {
          const quote = await getMarketQuote(marketTicker, fetch, { skipCache: true });
          if (quote?.yes_ask_dollars != null) yesAsk = Number(quote.yes_ask_dollars);
          if (quote?.no_ask_dollars != null) noAsk = Number(quote.no_ask_dollars);
        } catch {
          /* keep lean ask */
        }
        const skipThinBid = resolveSkipThinBid(cfg.risk, 'last_minute');
        const absGap = Number.isFinite(Number(lean.abs_gap))
          ? Number(lean.abs_gap)
          : Math.abs((lean.live || 0) - (lean.strike || 0));
        const leanForGate = {
          asset: lean.asset,
          market_ticker: marketTicker,
          decision: lean.decision,
          live: lean.live || 0,
          strike: lean.strike || 0,
          abs_gap: absGap,
          minutes_left: lean.minutes_left || 0,
          minutes_elapsed: lean.minutes_elapsed || 0,
          minutes_remaining: lean.minutes_remaining,
          phase: (lean.phase === 'live' ? 'live' : 'ended') as 'live' | 'ended',
          yes_ask: yesAsk ?? undefined,
          no_ask: noAsk ?? undefined,
          yes_bid: lean.yes_bid ?? undefined,
          no_bid: lean.no_bid ?? undefined,
          timeseries: lean.timeseries,
          close_utc: lean.close_utc,
        };
        const pickedSide = lastMinutePickedSide(leanForGate, cfg);
        const gate = evaluateLastMinuteEnter({
          lean: leanForGate,
          cfg,
          adminEnabled: featureFlags.lastMinute,
          twapAdminEnabled: featureFlags.twapLock,
          now,
          openPositions,
          tradesToday,
          assetTradesInWindow: existingBuys,
          dailyPnlUsd,
          hasOpenOnTicker: tickerHasOpenFill(userTrades, marketTicker),
          skipThinBid,
          bidSize: await cashOutBestBidSize(marketTicker, pickedSide, skipThinBid),
        });
        if (!gate.ok || !gate.price || !gate.count) {
          if (gate.skip_reason === 'last_minute_not_last_minute') {
            delete lastTradeAction[asset];
            continue;
          }
          lastTradeAction[asset] = skippedTradeAction(gate.skip_reason || 'notional_too_small', tickIso);
          continue;
        }
        const secret = await getUserSecret(userId);
        if (!secret?.privateKeyPem || !secret.keyId) {
          lastTradeAction[asset] = skippedTradeAction('no_client', tickIso);
          continue;
        }
        const placeRequestId = `lm_${userId}_${marketTicker}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`.slice(0, 64);
        const claimed = await tryAcquirePlaceLock({
          userId,
          ticker: marketTicker,
          cap: windowCap,
          requestId: placeRequestId,
          existingBuys,
        });
        if (!claimed.ok) {
          lastTradeAction[asset] = skippedTradeAction(claimed.reason, tickIso);
          continue;
        }
        const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
        const placeDecision = gate.decision || pickedSide;
        try {
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: gate.side || 'bid',
            count: gate.count,
            price: gate.price,
            time_in_force: gate.time_in_force,
            dry_run: false,
          });
          if (!placeRes.ok) {
            lastTradeAction[asset] = {
              status: 'failed',
              detail: String(placeRes.error || 'order failed'),
              at: tickIso,
            };
            continue;
          }
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: gate.count,
          });
          const payPrice = Number(gate.pay_price ?? 0) || null;
          const accepted = filled || Boolean(placeRes.order_id && isGoodTillCanceled(gate.time_in_force));
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision,
            count: filled ? String(fillCount) : String(gate.count || 0),
            price: gate.price,
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : gate.notional_usd || 0,
            dryRun: false,
            status: filled ? 'FILLED' : accepted ? 'SUBMITTED' : 'CANCELLED',
            leanDiff: absGap,
            liveSpot: lean.live,
            strike: lean.strike,
            executedAt: now.toISOString(),
            orderId: placeRes.order_id ?? null,
            payPrice,
            fillCount: filled ? fillCount : 0,
            outcome: filled || accepted ? 'pending' : 'miss',
            pnlUsd: null,
            entryPath: 'last_minute',
          };
          await saveTradeRecord(userId, tradeDoc);
          userTrades.unshift(tradeDoc);
          if (filled) {
            openPositions += 1;
            tradesToday += 1;
            tradesTodayList.push(tradeDoc);
          }
          const priceVal =
            typeof gate.price === 'number' ? gate.price : parseFloat(String(gate.price || 0));
          lastTradeAction[asset] = filled
            ? {
                status: 'placed',
                detail: `placed ${placeDecision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
                at: tickIso,
              }
            : accepted
              ? { status: 'placed', detail: `resting ${placeDecision} · waiting for fill`, at: tickIso }
              : { status: 'failed', detail: 'IOC no fill', at: tickIso };
          if (filled) {
            await emitCloudAlert({
              userId,
              alertId: fillAlertId(tradeId),
              kind: 'order_filled',
              title: orderPlacedAlertTitle({
                live: true,
                asset,
                decision: String(placeDecision || ''),
                entryPath: 'last_minute',
              }),
              body: `${gate.count} ctr @ $${priceVal.toFixed(2)} · Cost $${(gate.notional_usd || 0).toFixed(2)}`,
              cfg,
              tokens: userTokens,
              collapseId: fillCollapseId(userId, tradeId),
              asset: lean.asset,
              ticker: marketTicker,
              tradeId,
              decision: placeDecision,
              at: now.toISOString(),
            });
          } else if (!accepted) {
            await emitCloudAlert({
              userId,
              alertId: missAlertId(tradeId),
              kind: 'ioc_miss',
              title: iocMissAlertTitle('last_minute'),
              body: iocMissAlertBody({
                asset,
                decision: String(placeDecision || ''),
                entryPath: 'last_minute',
              }),
              cfg,
              tokens: userTokens,
              asset: lean.asset,
              ticker: marketTicker,
              tradeId,
              decision: placeDecision,
              at: now.toISOString(),
            });
          }
        } finally {
          await releasePlaceLock({ userId, ticker: marketTicker, requestId: placeRequestId });
        }
      }

      if (still.length) lastMinuteWatchUsers.set(userId, still);
      else lastMinuteWatchUsers.delete(userId);
      await upsertUserDoc(userId, { lastTradeAction, lastTickAt: now.toISOString() } as any);
    } catch (err: any) {
      noteTransientKalshiFailure(err);
    }
  }

  await flushLastMinuteWatcher(now, sharedLeans);
  return { timestamp: now.toISOString(), watched };
}

/** Quote + exit only for users that already hold a Cash out lot. No new buys. */
export async function runCashOutBidWatchTick(): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  if (cashOutWatchUsers.size === 0 && goldFadeWatchUsers.size === 0) {
    return { timestamp: new Date().toISOString(), watched: 0 };
  }
  const now = new Date();
  const sysConfig = await getSystemConfig();
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }

  const watchAssets = [
    ...new Set([...cashOutWatchUsers.values(), ...goldFadeWatchUsers.values()].flat()),
  ] as AssetKey[];
  const sharedLeans: Partial<Record<AssetKey, any>> = {};
  await Promise.all(
    watchAssets.map(async (asset) => {
      try {
        if (!isMarketOpen(asset, now).open) return;
        sharedLeans[asset] = await computeLean(asset, 0.0, fetch, now);
      } catch (err: any) {
        noteTransientKalshiFailure(err);
      }
    })
  );

  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;

  for (const [userId, assets] of [...cashOutWatchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      cashOutWatchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      const rawTrades = await getTradeRecords(userId);
      const quoteCache = createQuoteCache();
      const userTrades = await settlePendingCloudTrades(userId, rawTrades, now, quoteCache);
      if (cachedHasNoCashOut(userTrades)) {
        cashOutWatchUsers.delete(userId);
        continue;
      }
      if (cachedSecretMissing(user)) continue;
      const secret = await getUserSecret(userId);
      if (!secret?.privateKeyPem || !secret.keyId) continue;
      const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
      for (const asset of assets) {
        const lean = sharedLeans[asset];
        if (!lean?.market_ticker) continue;
        const marketTicker = lean.market_ticker;
        if (pendingCashOutTradesForMarket(userTrades, marketTicker).length === 0) continue;
        watched += 1;
        const absGap = Number.isFinite(Number(lean.abs_gap))
          ? Number(lean.abs_gap)
          : Math.abs((lean.live || 0) - (lean.strike || 0));
        const cashOutRes = await runCloudCashOutExits({
          userId,
          asset,
          ticker: marketTicker,
          lean: {
            decision: lean.decision,
            abs_gap: absGap,
            phase: lean.phase,
            yes_bid: lean.yes_bid,
            yes_ask: lean.yes_ask,
            no_bid: lean.no_bid,
            no_ask: lean.no_ask,
          },
          trades: userTrades,
          cushion: cfg.cushions?.[asset] ?? 25,
          cashOutBidUsd: Number(cfg.risk?.cash_out_bid_usd ?? 0.88),
          cashOutMaxAskUsd: Number(cfg.risk?.cash_out_max_ask_usd ?? 0.82),
          stopUsd: normalizeCashOutStopUsd(cfg.risk?.cash_out_stop_usd),
          skipThinBid: resolveSkipThinBid(cfg.risk, 'cash_out'),
          bidSize: await cashOutBestBidSize(
            marketTicker,
            pendingCashOutTradesForMarket(userTrades, marketTicker)[0]?.decision || lean.decision,
            resolveSkipThinBid(cfg.risk, 'cash_out')
          ),
          graceSeconds: Number(cfg.risk?.protect_sell_grace_seconds ?? 45),
          slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
          dryRun: false,
          now,
          place: (input) =>
            client.placeOrder({
              ticker: input.ticker,
              side: input.side,
              count: input.count,
              price: input.price,
              time_in_force: input.time_in_force,
              dry_run: input.dry_run,
              client_order_id: input.client_order_id,
            }),
        });
        const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
          (t, i, arr) => t && arr.indexOf(t) === i
        );
        for (const alert of cashOutRes.alerts) {
          await emitCloudAlert({
            userId,
            alertId: protectAlertId(alert.tradeId),
            kind: 'protect_sell',
            title: alert.title,
            body: alert.body,
            cfg,
            tokens: userTokens,
            collapseId: `cout:${userId}:${alert.tradeId}`.slice(0, 64),
            asset,
            ticker: marketTicker,
            tradeId: alert.tradeId,
            at: now.toISOString(),
          });
        }
      }
      const still = openCashOutAssets(userTrades);
      if (still.length) cashOutWatchUsers.set(userId, still);
      else cashOutWatchUsers.delete(userId);
    } catch (err: any) {
      noteTransientKalshiFailure(err);
    }
  }

  for (const [userId, assets] of [...goldFadeWatchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      goldFadeWatchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      const rawTrades = await getTradeRecords(userId);
      const quoteCache = createQuoteCache();
      const userTrades = await settlePendingCloudTrades(userId, rawTrades, now, quoteCache);
      if (openGoldFadeAssets(userTrades).length === 0) {
        goldFadeWatchUsers.delete(userId);
        continue;
      }
      if (cachedSecretMissing(user)) continue;
      const secret = await getUserSecret(userId);
      if (!secret?.privateKeyPem || !secret.keyId) continue;
      const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
      const fadeSkipThin = resolveSkipThinBid(cfg.risk, 'gold_fade');
      for (const asset of assets) {
        const lean = sharedLeans[asset];
        if (!lean?.market_ticker) continue;
        const marketTicker = lean.market_ticker;
        const heldFade = pendingGoldFadeTradesForMarket(userTrades, marketTicker)[0];
        if (!heldFade) continue;
        watched += 1;
        const absGap = Number.isFinite(Number(lean.abs_gap))
          ? Number(lean.abs_gap)
          : Math.abs((lean.live || 0) - (lean.strike || 0));
        const fadeRes = await runCloudGoldFadeExits({
          userId,
          asset,
          ticker: marketTicker,
          lean: {
            decision: lean.decision,
            abs_gap: absGap,
            phase: lean.phase,
            minutes_left: lean.minutes_left,
            minutes_remaining: lean.minutes_remaining,
            yes_bid: lean.yes_bid,
            yes_ask: lean.yes_ask,
            no_bid: lean.no_bid,
            no_ask: lean.no_ask,
          },
          trades: userTrades,
          cushion: cfg.cushions?.[asset] ?? 25,
          takeUsd: normalizeGoldFadeTakeUsd(cfg.risk?.gold_fade_take_usd),
          stopUsd: normalizeGoldFadeStopUsd(cfg.risk?.gold_fade_stop_usd),
          flattenMinutes: normalizeGoldFadeFlattenMinutes(cfg.risk?.gold_fade_flatten_minutes),
          skipThinBid: fadeSkipThin,
          bidSize: await cashOutBestBidSize(marketTicker, heldFade.decision || lean.decision, fadeSkipThin),
          graceSeconds: Number(cfg.risk?.protect_sell_grace_seconds ?? 45),
          slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
          dryRun: false,
          now,
          place: (input) =>
            client.placeOrder({
              ticker: input.ticker,
              side: input.side,
              count: input.count,
              price: input.price,
              time_in_force: input.time_in_force,
              dry_run: input.dry_run,
              client_order_id: input.client_order_id,
            }),
        });
        const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
          (t, i, arr) => t && arr.indexOf(t) === i
        );
        for (const alert of fadeRes.alerts) {
          await emitCloudAlert({
            userId,
            alertId: protectAlertId(alert.tradeId),
            kind: 'protect_sell',
            title: alert.title,
            body: alert.body,
            cfg,
            tokens: userTokens,
            collapseId: `fade:${userId}:${alert.tradeId}`.slice(0, 64),
            asset,
            ticker: marketTicker,
            tradeId: alert.tradeId,
            at: now.toISOString(),
          });
        }
      }
      const stillFade = openGoldFadeAssets(userTrades);
      if (stillFade.length) goldFadeWatchUsers.set(userId, stillFade);
      else goldFadeWatchUsers.delete(userId);
    } catch (err: any) {
      noteTransientKalshiFailure(err);
    }
  }

  return { timestamp: now.toISOString(), watched };
}

function cachedHasNoCashOut(trades: TradeRecordDoc[]): boolean {
  return openCashOutAssets(trades).length === 0;
}

function cachedSecretMissing(user: { kalshiConfigured?: boolean }): boolean {
  return !user.kalshiConfigured;
}

// Endpoint triggered every minute by Cloud Scheduler (executes N sub-ticks per minute based on systemConfig)
workerRouter.post('/tick', async (req: Request, res: Response) => {
  const isTest = process.env.NODE_ENV === 'test' || req.query.single === 'true';
  if (process.env.NODE_ENV === 'test') {
    resetKalshiPauseForTests();
  }
  const sysConfig = await getSystemConfig();
  const intervalSec = sysConfig?.tick_interval_seconds || 20;
  const flags = normalizeFeatureFlags(sysConfig?.featureFlags);
  const bidCheckSec = Math.min(flags.cashOutBidCheckSeconds, flags.goldFadeBidCheckSeconds);
  const tickCount = isTest ? 1 : Math.max(1, Math.floor(60 / intervalSec));
  const delayMs = intervalSec * 1000;
  const minuteEndAt = Date.now() + (isTest ? 0 : 58_000);
  let lastResult: any = { activeUserCount: 0, results: [] };

  for (let i = 0; i < tickCount; i++) {
    lastResult = await runOneTick();
    if (lastResult?.paused) break;
    if (isTest) break;
    const lastSubTick = i >= tickCount - 1;
    const endAt = lastSubTick ? minuteEndAt : Date.now() + delayMs;
    if (Date.now() > endAt - 80) continue;
    let nextWatch = Date.now() + bidCheckSec * 1000;
    let nextTwap = Date.now() + 1000;
    while (Date.now() <= endAt - 80) {
      const nextAt = Math.min(nextWatch, nextTwap, endAt);
      await sleepMs(Math.max(0, nextAt - Date.now()));
      if (Date.now() > endAt - 80) break;
      const lastMinuteWatching = twapLockWatchUsers.size > 0 || lastMinuteWatchUsers.size > 0;
      if (lastMinuteWatching && Date.now() + 20 >= nextTwap) {
        if (twapLockWatchUsers.size > 0) {
          const twap = await runTwapLockWatchTick();
          if (twap.paused) break;
        }
        if (lastMinuteWatchUsers.size > 0) {
          const lm = await runLastMinuteWatchTick();
          if (lm.paused) break;
        }
        nextTwap += 1000;
      } else if (!lastMinuteWatching) {
        nextTwap = Date.now() + 1000;
      }
      if (Date.now() + 20 >= nextWatch && Date.now() <= endAt - 80) {
        const watch = await runCashOutBidWatchTick();
        if (watch.paused) break;
        nextWatch += bidCheckSec * 1000;
      }
    }
    if (!lastSubTick) await sleepMs(Math.max(0, endAt - Date.now()));
  }

  // Trading sub-ticks finish first. Purge last so we never delete a fill the tick just wrote.
  const latestConfig = await getSystemConfig({ fresh: true });
  const purgeResult = await runConfiguredPurgeJobs({ config: latestConfig });
  await setSystemConfig({
    last_worker_tick_at: lastResult.timestamp,
    ...(purgeResult.skipped || !purgeResult.ran
      ? {}
      : {
          purge: {
            lastRunAt: lastResult.timestamp,
            lastDeleted: purgeResult.deleted,
          },
        }),
  });

  res.json({
    ok: true,
    status: 'ok',
    timestamp: lastResult.timestamp,
    activeUsersCount: lastResult.activeUserCount,
    activeUserCount: lastResult.activeUserCount,
    results: lastResult.results,
    tickIntervalSeconds: intervalSec,
    subTicksExecuted: tickCount,
    auditPruned: purgeResult.deleted.audit,
    purge: {
      skipped: purgeResult.skipped,
      ran: purgeResult.ran,
      deleted: purgeResult.deleted,
      scannedUsers: purgeResult.scannedUsers,
    },
  });
});

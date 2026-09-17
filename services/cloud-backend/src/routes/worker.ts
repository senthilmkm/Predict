import { Router, Request, Response } from 'express';
import {
  AssetKey,
  AssetRegistry,
  computeHourlyAtmLean,
  computeWeeklyAtmLean,
  computeLean,
  KalshiClient,
  defaultAppConfig,
} from 'trading-core';
import {
  countWindowBuysForTicker,
  evaluateStaticGate,
  formatSkipReason,
  isCushionLeanEnabled,
  skipReasonForWindowCap,
  windowBuyCap,
  type GateResult,
} from '../../../../packages/trading-core/src/gates';
import { isGoodTillCanceled, placeResultShouldPersist, resolvedPlaceFillCount } from '../../../../packages/trading-core/src/orderFill';
import { iocKalshiPrice, refreshIocPayForPlace } from '../../../../packages/trading-core/src/iocPlace';
import { LastTradeAction } from '../../../../packages/trading-core/src/types';
import { getCfbApiCredentials, getUserSecret } from '../services/secretManager';
import { cloudKalshi } from '../services/cloudKalshi';
import { syncKalshiFillsIntoTradeBook } from '../services/syncKalshiFills';
import { setKalshiWsFillsEnabled } from '../services/kalshiWsFills';
import { readWsAskBid, readWsBestBidSize } from '../services/kalshiWsQuotes';
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
import { purgeLastRunPatch, runConfiguredPurgeJobs } from '../services/purgeJobs';
import {
  fillCollapseId,
  pruneLeanAlertsSent,
  type LeanAlertsSent,
} from '../services/leanAlerts';
import {
  openProtectWatchAssets,
  pendingProtectTradesForMarket,
  protectCollapseId,
  homeAutoExitWatchNeeded,
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
import {
  collectHomeQuoteAssets,
  intersectCushionAssets,
  collectWatchAssets,
  leanWithSnapshotQuote,
  liveAsksByAsset,
  liveAsksFromTickers,
  mergeQuoteMaps,
  wsQuotesForTickers,
  rememberTickersFromLeans,
  resolveAskTickers,
  unionAssetKeys,
  uniqueTickersFromLeans,
  type OneSecondAskQuote,
  type OneSecondMarketSnapshot,
} from '../services/oneSecondMarket';
import {
  cachedLeanTickers,
  computeLeanOnce,
  dropSharedLeansNotIn,
  overlayLeanWsBook,
  refreshCushionLeanSignals,
  rememberSharedLeans,
} from '../services/leanSignalCache';
import {
  dropAskTickersNotIn,
  peekAskTickers,
  persistCushionAskBook,
  rememberAskTickers,
  rememberAskTickersFromLeans,
  rememberExtraAskTickers,
  resetExtraAskTickers,
  resetLiveAskRefreshForTests,
} from '../services/liveAskRefresh';
import {
  idleLiveAsksSnapshot,
  mergeLiveAsks,
  peekLiveAsksByAsset,
  persistLiveAsksSnapshot,
} from '../services/liveAsks';
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
  isOpenLiveFill,
} from '../../../../packages/trading-core/src/cashOut';
import {
  evaluateGoldFadeEnter,
  goldFadeCheapSide,
  goldFadeMinutesLeft,
  isGoldFadeEnterPath,
  normalizeGoldFadeFlattenMinutes,
  normalizeGoldFadeMaxGapUsd,
  normalizeGoldFadeStopUsd,
  normalizeGoldFadeTakeUsd,
  openGoldFadeAssets,
  tickerHasOpenFill,
} from '../../../../packages/trading-core/src/goldFade';
import { getMarketOrderbook, getMarketQuote, marketClockFromKalshi } from '../../../../packages/trading-core/src/lean';
import { pendingCashOutTradesForMarket, runCloudCashOutExits } from '../services/cloudCashOut';
import {
  pendingLastMinuteTradesForMarket,
  runCloudLastMinuteFlipExits,
} from '../services/cloudLastMinuteFlip';
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
  isLastMinuteWindow,
  lastMinuteClipsForTicker,
  lastMinuteTimingFromRisk,
  lastMinuteAskUsd,
  lastMinuteTwapOwns,
  normalizeLastMinuteFlipSellUsd,
  normalizeLastMinuteBothGap,
  normalizeLastMinuteBothMinAsk,
  normalizeLastMinuteMaxAskUsd,
  normalizeLastMinuteSide,
  pickLastMinuteSide,
  resolveLastMinuteCloseUtc,
  tickerHasOpenLastMinute,
  tickerHasOpenOtherThanLastMinute,
} from '../../../../packages/trading-core/src/lastMinute';
import {
  evaluateStepBuyEnter,
  isStepBuyEnterPath,
  isStepBuyStartWindow,
  nextStepBuyLotIndex,
  normalizeStepBuyMaxLots,
  normalizeStepBuySellIfThesisDies,
  resolveStepBuyCloseUtc,
  stepBuySecondsLeft,
  stepBuyLotsForTicker,
  stepBuyTwapOwns,
  tickerHasOpenOtherThanStepBuy,
  tickerHasOpenStepBuy,
} from '../../../../packages/trading-core/src/stepBuy';
import {
  evaluateSpikeFadeEnter,
  isSpikeFadeEnterPath,
  isSpikeFadeEnterWindow,
  pickSpikeFadeSide,
  spikeFadeTwapOwns,
  tickerHasOpenOtherThanSpikeFade,
  tickerHasOpenSpikeFade,
} from '../../../../packages/trading-core/src/spikeFade';
import {
  evaluatePairLockEnter,
  evaluatePairLockWatch,
  isPairLockEnterPath,
  isPairLockEnterWindow,
  pairLockLockedUsd,
  pairLockLotsForTicker,
  pairLockTwapOwns,
  shouldWatchPairLockLots,
  shouldWatchPairLockTicker,
  tickerHasOpenOtherThanPairLock,
  tickerHasOpenPairLock,
  type PairLockEnterResult,
  type PairLockStackAddResult,
} from '../../../../packages/trading-core/src/pairLock';
import {
  evaluateCapLockEnter,
  evaluateCapLockSecondLeg,
  isCapLockEnterPath,
  isCapLockEnterWindow,
  capLockFirstMaxPayUsd,
  capLockFitsCap,
  capLockLotsForTicker,
  capLockTwapOwns,
  shouldWatchCapLockLots,
  tickerHasCapLockAttempt,
  tickerHasOpenCapLock,
  tickerHasOpenOtherThanCapLock,
  type CapLockEnterResult,
} from '../../../../packages/trading-core/src/capLock';
import {
  bufferRunTwapOwns,
  evaluateBufferRunEnter,
  isBufferRunEnterPath,
  isBufferRunEnterWindow,
  pickBufferRunSide,
  tickerHasBufferRunAttempt,
  tickerHasOpenBufferRun,
  tickerHasOpenOtherThanBufferRun,
} from '../../../../packages/trading-core/src/bufferRun';
import type { SpotTick } from '../../../../packages/trading-core/src/smartBuy';
import {
  CHEAP_LOOP_HOURLY_CYCLES_MAX,
  CHEAP_LOOP_WEEKLY_CYCLES_MAX,
  assetHasOpenCheapLoopHourly,
  assetHasOpenCheapLoopWeekly,
  cheapLoopCfgForHourly,
  cheapLoopCfgForWeekly,
  cheapLoopActiveStopUsd,
  cheapLoopCooldownOwnsTicker,
  cheapLoopExitsForTicker,
  cheapLoopHourlyEventKey,
  cheapLoopHourlyExitsForEvent,
  cheapLoopTwapOwns,
  cheapLoopWeeklyEventKey,
  cheapLoopWeeklyExitsForEvent,
  evaluateCheapLoopEnter,
  isCheapLoopCooldown,
  isCheapLoopEnterPath,
  isCheapLoopEnterWindow,
  isCheapLoopHourlyCooldown,
  isCheapLoopHourlyEnterPath,
  isCheapLoopWeeklyCooldown,
  isCheapLoopWeeklyEnterPath,
  normalizeCheapLoopCycles,
  normalizeCheapLoopFlattenMinutes,
  normalizeCheapLoopWeeklyFlattenMinutes,
  openCheapLoopHourlyAssets,
  openCheapLoopHourlyTickerForAsset,
  openCheapLoopWeeklyAssets,
  openCheapLoopWeeklyTickerForAsset,
  pickCheapLoopSide,
  tickerHasOpenCheapLoop,
  tickerHasOpenOtherThanCheapLoop,
  tickerHasOpenOtherThanCheapLoopHourly,
  tickerHasOpenOtherThanCheapLoopWeekly,
} from '../../../../packages/trading-core/src/cheapLoop';
import { resolveSkipThinBid } from '../../../../packages/trading-core/src/skipThinBid';
import {
  cfbAssetsDueForIngest,
  cfbRtiBuffer,
  fetchCfbRtiPrints,
  ingestRecentCfbPrints,
  markCfbIngested,
  resetCfbIngestGateForTests,
} from '../services/cfbRti';
import { pumpKalshiWsQuotesFromConfig } from '../services/kalshiWsPump';
import { releaseTick, resetTickGateForTests, tryAcquireTick } from '../services/tickGate';
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
import {
  buildStepBuyWatcherSnapshot,
  persistStepBuyWatcherSnapshot,
  resetStepBuyWatcherMemoryForTests,
} from '../services/stepBuyWatcher';
import {
  buildSpikeFadeWatcherSnapshot,
  persistSpikeFadeWatcherSnapshot,
  resetSpikeFadeWatcherMemoryForTests,
  spikeFadeMinutesLeftFromLean,
} from '../services/spikeFadeWatcher';
import {
  buildPairLockWatcherSnapshot,
  persistPairLockWatcherSnapshot,
  resetPairLockWatcherMemoryForTests,
  pairLockMinutesLeftFromLean,
} from '../services/pairLockWatcher';
import {
  buildCheapLoopWatcherSnapshot,
  persistCheapLoopWatcherSnapshot,
  resetCheapLoopWatcherMemoryForTests,
  cheapLoopMinutesLeftFromLean,
} from '../services/cheapLoopWatcher';
import { runCloudStepBuyStops } from '../services/cloudStepBuy';
import { pendingSpikeFadeTradesForMarket, runCloudSpikeFadeExits } from '../services/cloudSpikeFade';
import { runCloudPairLockFlatten } from '../services/cloudPairLock';
import { runCloudCapLockWatch } from '../services/cloudCapLock';
import {
  pendingCheapLoopHourlyTradesForMarket,
  pendingCheapLoopTradesForMarket,
  pendingCheapLoopWeeklyTradesForMarket,
  runCloudCheapLoopExits,
} from '../services/cloudCheapLoop';
import {
  pendingBufferRunTradesForMarket,
  runCloudBufferRunExits,
} from '../services/cloudBufferRun';

export const workerRouter = Router();

/** Same-process cache so 20s sub-ticks cannot re-ding before Firestore is re-read. */
const leanAlertMemory = new Map<string, LeanAlertsSent>();
/** Users with an open Cash out lot after the last full tick — bid-watch only these. */
const cashOutWatchUsers = new Map<string, string[]>();
const goldFadeWatchUsers = new Map<string, string[]>();
/** Armed TWAP users with a BTC/ETH window in the last 70s — 1s sample + enter only. */
const twapLockWatchUsers = new Map<string, string[]>();
/** Armed Last-minute users with an enabled asset in the watch window — 1s quotes + clip ladder. */
const lastMinuteWatchUsers = new Map<string, string[]>();
const stepBuyWatchUsers = new Map<string, string[]>();
const spikeFadeWatchUsers = new Map<string, string[]>();
const pairLockWatchUsers = new Map<string, string[]>();
const capLockWatchUsers = new Map<string, string[]>();
const capLockRetryKeys = new Set<string>();
const capLockMissAt = new Map<string, number>();
const bufferRunWatchUsers = new Map<string, string[]>();
const cheapLoopWatchUsers = new Map<string, string[]>();
const cheapLoopHourlyWatchUsers = new Map<string, string[]>();
const cheapLoopHourlyQuoteTickers = new Set<string>();
const cheapLoopWeeklyWatchUsers = new Map<string, string[]>();
const cheapLoopWeeklyQuoteTickers = new Set<string>();
/** Home / Auto lots while Protect is On — 1s dump only. */
const protectWatchUsers = new Map<string, string[]>();
/** Enabled Home assets — keep a 1s ask book even when no path is watching. */
let homeQuoteAssets: AssetKey[] = [];
let homeTickerByAsset: Record<string, string> = {};
let lastHomeQuoteAt = 0;
const hourlyClockByTicker = new Map<string, any>();
let pathWatchInFlight: Promise<void> | null = null;
let pathWatchDirty = false;

function oneSecondWatchAssets(): AssetKey[] {
  return collectWatchAssets(
    twapLockWatchUsers,
    lastMinuteWatchUsers,
    stepBuyWatchUsers,
    spikeFadeWatchUsers,
    pairLockWatchUsers,
    capLockWatchUsers,
    bufferRunWatchUsers,
    cheapLoopWatchUsers,
    cheapLoopHourlyWatchUsers,
    cheapLoopWeeklyWatchUsers,
    cashOutWatchUsers,
    goldFadeWatchUsers,
    protectWatchUsers
  );
}

function oneSecondDumpWatching(): boolean {
  return cashOutWatchUsers.size > 0 || goldFadeWatchUsers.size > 0 || protectWatchUsers.size > 0;
}

function applyDumpWatchMaps(
  userId: string,
  opts: {
    trades: TradeRecordDoc[];
    /** Protect flip and/or Sell at % for Home/Auto. */
    homeAutoExitWatch: boolean;
    killSwitch: boolean;
    now: Date;
  }
): void {
  const stillOpenCashOut = openCashOutAssets(opts.trades);
  if (stillOpenCashOut.length) cashOutWatchUsers.set(userId, stillOpenCashOut);
  else cashOutWatchUsers.delete(userId);
  const stillOpenFade = openGoldFadeAssets(opts.trades);
  if (stillOpenFade.length) goldFadeWatchUsers.set(userId, stillOpenFade);
  else goldFadeWatchUsers.delete(userId);
  const stillOpenProtect =
    opts.homeAutoExitWatch && !opts.killSwitch ? openProtectWatchAssets(opts.trades, opts.now) : [];
  if (stillOpenProtect.length) protectWatchUsers.set(userId, stillOpenProtect);
  else protectWatchUsers.delete(userId);
}

/** Re-read open Cash out / Gold fade / Protect / Sell at lots so a mid-tick fill joins the 1s snapshot. */
export async function refreshDumpWatchFromTradeBooks(now = new Date()): Promise<void> {
  const activeUsers = await getEnrolledActiveUsers();
  const seen = new Set<string>();
  await Promise.all(
    activeUsers.map(async (user) => {
      const userId = user.userId;
      seen.add(userId);
      if (!shouldLoadCloudTradeBook(user)) {
        cashOutWatchUsers.delete(userId);
        goldFadeWatchUsers.delete(userId);
        protectWatchUsers.delete(userId);
        return;
      }
      const cfg = user.config || defaultAppConfig();
      const homeAutoExitWatch = homeAutoExitWatchNeeded(cfg.risk);
      const cashOn = Boolean(cfg.risk?.cash_out_enabled);
      const fadeOn = Boolean(cfg.risk?.gold_fade_enabled);
      const already =
        cashOutWatchUsers.has(userId) ||
        goldFadeWatchUsers.has(userId) ||
        protectWatchUsers.has(userId);
      // Skip trade-book reads when nothing can arm dump watch for this user.
      if (!homeAutoExitWatch && !cashOn && !fadeOn && !already) {
        cashOutWatchUsers.delete(userId);
        goldFadeWatchUsers.delete(userId);
        protectWatchUsers.delete(userId);
        return;
      }
      const trades = await getTradeRecords(userId);
      applyDumpWatchMaps(userId, {
        trades,
        homeAutoExitWatch,
        killSwitch: user.state === 'KILL_SWITCH',
        now,
      });
    })
  );
  const staleIds = new Set([
    ...cashOutWatchUsers.keys(),
    ...goldFadeWatchUsers.keys(),
    ...protectWatchUsers.keys(),
  ]);
  for (const userId of staleIds) {
    if (seen.has(userId)) continue;
    cashOutWatchUsers.delete(userId);
    goldFadeWatchUsers.delete(userId);
    protectWatchUsers.delete(userId);
  }
}

export function dumpWatchSnapshotForTests(): {
  cashOut: Record<string, string[]>;
  goldFade: Record<string, string[]>;
  protect: Record<string, string[]>;
} {
  return {
    cashOut: Object.fromEntries(cashOutWatchUsers),
    goldFade: Object.fromEntries(goldFadeWatchUsers),
    protect: Object.fromEntries(protectWatchUsers),
  };
}

function oneSecondPathWatching(): boolean {
  return (
    twapLockWatchUsers.size > 0 ||
    lastMinuteWatchUsers.size > 0 ||
    stepBuyWatchUsers.size > 0 ||
    spikeFadeWatchUsers.size > 0 ||
    pairLockWatchUsers.size > 0 ||
    capLockWatchUsers.size > 0 ||
    bufferRunWatchUsers.size > 0 ||
    cheapLoopWatchUsers.size > 0 ||
    cheapLoopHourlyWatchUsers.size > 0 ||
    cheapLoopWeeklyWatchUsers.size > 0
  );
}

async function ingestCfbPrintsForAssets(watchAssets: AssetKey[], now: Date): Promise<void> {
  const due = cfbAssetsDueForIngest(watchAssets, now.getTime()) as AssetKey[];
  if (!due.length) return;
  const platformCreds = await getCfbApiCredentials();
  let sharedKalshi: KalshiClient | null = null;
  if (!platformCreds) {
    const userIds = [
      ...twapLockWatchUsers.keys(),
      ...lastMinuteWatchUsers.keys(),
      ...stepBuyWatchUsers.keys(),
      ...spikeFadeWatchUsers.keys(),
      ...pairLockWatchUsers.keys(),
      ...capLockWatchUsers.keys(),
      ...bufferRunWatchUsers.keys(),
      ...cheapLoopWatchUsers.keys(),
      ...cheapLoopHourlyWatchUsers.keys(),
      ...cheapLoopWeeklyWatchUsers.keys(),
      ...cashOutWatchUsers.keys(),
      ...goldFadeWatchUsers.keys(),
      ...protectWatchUsers.keys(),
    ];
    for (const userId of userIds) {
      const secret = await getUserSecret(userId);
      if (secret?.privateKeyPem && secret.keyId) {
        sharedKalshi = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
        break;
      }
    }
    if (!sharedKalshi) return;
  }
  await Promise.all(
    due.map(async (asset) => {
      try {
        const prints = await fetchCfbRtiPrints(asset, {
          now,
          kalshi: sharedKalshi,
          credentials: platformCreds,
        });
        ingestRecentCfbPrints(asset, prints, now);
        markCfbIngested(asset, now.getTime());
      } catch (err: any) {
        noteTransientKalshiFailure(err);
      }
    })
  );
}

async function computeWatchLeans(
  watchAssets: AssetKey[],
  now: Date
): Promise<Partial<Record<AssetKey, any>>> {
  const coins = intersectCushionAssets(watchAssets, homeQuoteAssets).filter((asset) =>
    isMarketOpen(asset, now).open
  );
  try {
    return await refreshCushionLeanSignals(coins, now);
  } catch (err: any) {
    noteTransientKalshiFailure(err);
    return {};
  }
}

export async function buildOneSecondMarketSnapshot(
  watchAssets: AssetKey[],
  now: Date,
  existingQuotes?: Map<string, OneSecondAskQuote> | null,
  extraTickers?: string[]
): Promise<OneSecondMarketSnapshot> {
  const coins = intersectCushionAssets(watchAssets, homeQuoteAssets);
  await ingestCfbPrintsForAssets(coins, now);
  const leans = await computeWatchLeans(coins, now);
  const needed = [
    ...uniqueTickersFromLeans(leans),
    ...[...(extraTickers || []), ...cheapLoopHourlyQuoteTickers, ...cheapLoopWeeklyQuoteTickers]
      .map((t) => String(t || '').trim())
      .filter(Boolean),
  ];
  const uniqueNeeded = [...new Set(needed)];
  const missing = uniqueNeeded.filter((ticker) => !existingQuotes?.has(ticker));
  const extra = wsQuotesForTickers(missing);
  const quotes = mergeQuoteMaps(existingQuotes, extra);
  return { now, leans, quotes };
}

function snapshotLeansForAssets(
  snapshot: OneSecondMarketSnapshot | null | undefined,
  watchAssets: AssetKey[]
): Partial<Record<AssetKey, any>> {
  const leans: Partial<Record<AssetKey, any>> = {};
  if (!snapshot) return leans;
  for (const asset of watchAssets) {
    if (snapshot.leans[asset]) leans[asset] = snapshot.leans[asset];
  }
  return leans;
}

async function sharedLeansForWatch(
  watchAssets: AssetKey[],
  now: Date,
  snapshot?: OneSecondMarketSnapshot | null
): Promise<Partial<Record<AssetKey, any>>> {
  if (snapshot) return snapshotLeansForAssets(snapshot, watchAssets);
  return computeWatchLeans(watchAssets, now);
}

async function overlayWatchLean(
  lean: any,
  snapshot?: OneSecondMarketSnapshot | null
): Promise<any> {
  if (snapshot) return leanWithSnapshotQuote(lean, snapshot.quotes);
  const next = { ...lean };
  const ws = readWsAskBid(String(next.market_ticker || ''));
  if (ws) {
    if (ws.yes_ask != null) next.yes_ask = ws.yes_ask;
    if (ws.no_ask != null) next.no_ask = ws.no_ask;
    if (ws.yes_bid != null) next.yes_bid = ws.yes_bid;
    if (ws.no_bid != null) next.no_bid = ws.no_bid;
  }
  return next;
}

async function cashOutBestBidSize(
  ticker: string,
  side: string,
  enabled: boolean
): Promise<number | null> {
  if (!enabled) return null;
  if (side !== 'YES' && side !== 'NO') return null;
  const wsSize = readWsBestBidSize(ticker, side);
  if (wsSize != null) return wsSize;
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

function stepBuyWatcherCloseByAsset(
  now: Date,
  leans: Partial<Record<string, { close_utc?: string | Date | null }>>
): Record<string, Date | null | undefined> {
  const out: Record<string, Date | null | undefined> = {};
  for (const asset of new Set([...stepBuyWatchUsers.values()].flat())) {
    out[asset] = resolveStepBuyCloseUtc(leans[asset] || {}, now);
  }
  return out;
}

async function flushStepBuyWatcher(
  now: Date,
  leans: Partial<Record<string, { close_utc?: string | Date | null }>>
): Promise<void> {
  await persistStepBuyWatcherSnapshot(
    buildStepBuyWatcherSnapshot({
      now,
      watchUsers: stepBuyWatchUsers,
      closeByAsset: stepBuyWatcherCloseByAsset(now, leans),
    })
  );
}

function spikeFadeWatcherMinutesLeft(
  leans: Partial<Record<string, { minutes_left?: number; minutes_remaining?: number }>>
): Record<string, number | null | undefined> {
  const out: Record<string, number | null | undefined> = {};
  for (const asset of new Set([...spikeFadeWatchUsers.values()].flat())) {
    out[asset] = spikeFadeMinutesLeftFromLean(leans[asset]);
  }
  return out;
}

async function flushSpikeFadeWatcher(
  now: Date,
  leans: Partial<Record<string, { minutes_left?: number; minutes_remaining?: number }>>
): Promise<void> {
  await persistSpikeFadeWatcherSnapshot(
    buildSpikeFadeWatcherSnapshot({
      now,
      watchUsers: spikeFadeWatchUsers,
      minutesLeftByAsset: spikeFadeWatcherMinutesLeft(leans),
    })
  );
}

function pairLockWatcherMinutesLeft(
  leans: Partial<Record<string, { minutes_left?: number; minutes_remaining?: number }>>
): Record<string, number | null | undefined> {
  const out: Record<string, number | null | undefined> = {};
  for (const asset of new Set([...pairLockWatchUsers.values()].flat())) {
    out[asset] = pairLockMinutesLeftFromLean(leans[asset]);
  }
  return out;
}

async function flushPairLockWatcher(
  now: Date,
  leans: Partial<Record<string, { minutes_left?: number; minutes_remaining?: number }>>
): Promise<void> {
  await persistPairLockWatcherSnapshot(
    buildPairLockWatcherSnapshot({
      now,
      watchUsers: pairLockWatchUsers,
      minutesLeftByAsset: pairLockWatcherMinutesLeft(leans),
    })
  );
}

function mergedCheapLoopWatchUsers(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [userId, assets] of cheapLoopWatchUsers) {
    out.set(userId, [...assets]);
  }
  for (const [userId, assets] of cheapLoopHourlyWatchUsers) {
    const cur = out.get(userId) || [];
    out.set(userId, [...new Set([...cur, ...assets])]);
  }
  for (const [userId, assets] of cheapLoopWeeklyWatchUsers) {
    const cur = out.get(userId) || [];
    out.set(userId, [...new Set([...cur, ...assets])]);
  }
  return out;
}

function cheapLoopWatcherMinutesLeft(
  leans: Partial<Record<string, { minutes_left?: number; minutes_remaining?: number }>>
): Record<string, number | null | undefined> {
  const out: Record<string, number | null | undefined> = {};
  for (const asset of new Set([...mergedCheapLoopWatchUsers().values()].flat())) {
    out[asset] = cheapLoopMinutesLeftFromLean(leans[asset]);
  }
  return out;
}

async function flushCheapLoopWatcher(
  now: Date,
  leans: Partial<Record<string, { minutes_left?: number; minutes_remaining?: number }>>
): Promise<void> {
  await persistCheapLoopWatcherSnapshot(
    buildCheapLoopWatcherSnapshot({
      now,
      watchUsers: mergedCheapLoopWatchUsers(),
      minutesLeftByAsset: cheapLoopWatcherMinutesLeft(leans),
    })
  );
}

export function setHomeQuoteAssetsForTests(assets: AssetKey[]): void {
  homeQuoteAssets = [...assets];
}

export function resetLeanAlertMemoryForTests(): void {
  leanAlertMemory.clear();
  cashOutWatchUsers.clear();
  goldFadeWatchUsers.clear();
  twapLockWatchUsers.clear();
  lastMinuteWatchUsers.clear();
  stepBuyWatchUsers.clear();
  spikeFadeWatchUsers.clear();
  pairLockWatchUsers.clear();
  capLockWatchUsers.clear();
  capLockRetryKeys.clear();
  capLockMissAt.clear();
  bufferRunWatchUsers.clear();
  cheapLoopWatchUsers.clear();
  cheapLoopHourlyWatchUsers.clear();
  cheapLoopHourlyQuoteTickers.clear();
  cheapLoopWeeklyWatchUsers.clear();
  cheapLoopWeeklyQuoteTickers.clear();
  protectWatchUsers.clear();
  homeQuoteAssets = [];
  homeTickerByAsset = {};
  lastHomeQuoteAt = 0;
  pathWatchInFlight = null;
  pathWatchDirty = false;
  resetLiveAskRefreshForTests();
  resetCfbIngestGateForTests();
  resetTickGateForTests();
  hourlyClockByTicker.clear();
  resetTwapLockWatcherMemoryForTests();
  resetLastMinuteWatcherMemoryForTests();
  resetStepBuyWatcherMemoryForTests();
  resetSpikeFadeWatcherMemoryForTests();
  resetPairLockWatcherMemoryForTests();
  resetCheapLoopWatcherMemoryForTests();
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

function liveIocBuyGate(
  gate: GateResult,
  ticker: string,
  lean: { yes_ask?: number | null; no_ask?: number | null } | null | undefined,
  maxPayUsd: number,
  allowBump: boolean
): GateResult {
  if (!gate.ok) return gate;
  const ws = readWsAskBid(String(ticker || ''));
  const refreshed = refreshIocPayForPlace({
    decision: gate.decision,
    quotedPayUsd: gate.pay_price,
    maxPayUsd,
    quotes: {
      yes_ask: ws?.yes_ask ?? lean?.yes_ask,
      no_ask: ws?.no_ask ?? lean?.no_ask,
    },
    allowBump,
  });
  if (!refreshed.ok) return { ok: false, skip_reason: refreshed.skip_reason };
  const px = iocKalshiPrice({
    decision: gate.decision,
    payUsd: refreshed.payUsd,
    existingSide: gate.side,
    existingPrice: gate.price,
    existingPayUsd: gate.pay_price,
  });
  const count = Math.max(0, Number(gate.count) || 0);
  return {
    ...gate,
    pay_price: refreshed.payUsd,
    price: px.price,
    side: px.side,
    notional_usd: count > 0 ? Math.round(count * refreshed.payUsd * 100) / 100 : gate.notional_usd,
  };
}

function pairLockIocBuyGate(
  gate: GateResult,
  ticker: string,
  lean: { yes_ask?: number | null; no_ask?: number | null } | null | undefined
): GateResult {
  return liveIocBuyGate(gate, ticker, lean, Number(gate.pay_price) || 0, false);
}

function lastMinutePickedSide(
  lean: { yes_ask?: number; no_ask?: number },
  cfg: {
    risk?: {
      last_minute_side?: unknown;
      last_minute_max_ask_usd?: unknown;
      last_minute_both_min_ask?: unknown;
      last_minute_both_gap?: unknown;
    };
  }
): 'YES' | 'NO' {
  const maxAsk = normalizeLastMinuteMaxAskUsd(cfg.risk?.last_minute_max_ask_usd);
  const picked = pickLastMinuteSide({
    side: normalizeLastMinuteSide(cfg.risk?.last_minute_side),
    yesAsk: lastMinuteAskUsd(lean.yes_ask),
    noAsk: lastMinuteAskUsd(lean.no_ask),
    maxAsk,
    bothMinAsk: normalizeLastMinuteBothMinAsk(cfg.risk?.last_minute_both_min_ask, maxAsk),
    bothGap: normalizeLastMinuteBothGap(cfg.risk?.last_minute_both_gap),
  });
  return picked.ok ? picked.decision : 'YES';
}

function spikeFadePickedSide(
  lean: { yes_ask?: number; no_ask?: number },
  cfg: {
    risk?: {
      spike_fade_expensive_min_usd?: unknown;
      spike_fade_expensive_max_usd?: unknown;
      spike_fade_cheap_min_usd?: unknown;
      spike_fade_cheap_max_usd?: unknown;
    };
  }
): 'YES' | 'NO' {
  const picked = pickSpikeFadeSide({
    yesAsk: lean.yes_ask,
    noAsk: lean.no_ask,
    expensiveMin: cfg.risk?.spike_fade_expensive_min_usd,
    expensiveMax: cfg.risk?.spike_fade_expensive_max_usd,
    cheapMin: cfg.risk?.spike_fade_cheap_min_usd,
    cheapMax: cfg.risk?.spike_fade_cheap_max_usd,
  });
  return picked.ok ? picked.decision : 'YES';
}

function cheapLoopPickedSide(
  lean: { yes_ask?: number; no_ask?: number },
  cfg: {
    risk?: {
      cheap_loop_cheap_max_ask_usd?: unknown;
      cheap_loop_min_gap_usd?: unknown;
      cheap_loop_alive_band?: unknown;
    };
  }
): 'YES' | 'NO' {
  const picked = pickCheapLoopSide({
    yesAsk: lean.yes_ask,
    noAsk: lean.no_ask,
    cheapMaxAskUsd: cfg.risk?.cheap_loop_cheap_max_ask_usd,
    minGapUsd: cfg.risk?.cheap_loop_min_gap_usd,
    aliveBand: cfg.risk?.cheap_loop_alive_band !== false,
  });
  return picked.ok ? picked.decision : 'YES';
}

function bufferRunPickedSide(
  lean: { live?: unknown; strike?: unknown; yes_ask?: number; no_ask?: number },
  cfg: {
    risk?: {
      buffer_run_ask_min_usd?: unknown;
      buffer_run_ask_max_usd?: unknown;
      buffer_run_pair_sum_skip?: unknown;
    };
  }
): 'YES' | 'NO' {
  const picked = pickBufferRunSide({
    live: lean.live,
    strike: lean.strike,
    yesAsk: lean.yes_ask,
    noAsk: lean.no_ask,
    askMinUsd: cfg.risk?.buffer_run_ask_min_usd,
    askMaxUsd: cfg.risk?.buffer_run_ask_max_usd,
    pairSumSkip: cfg.risk?.buffer_run_pair_sum_skip,
  });
  return picked.ok ? picked.decision : 'YES';
}

/** Prefer CFB RTI prints for BTC/ETH ATR; fall back to lean timeseries. */
function bufferRunTimeseriesForAsset(
  asset: string,
  leanSeries?: SpotTick[] | null
): SpotTick[] | null {
  if (asset === 'BTC' || asset === 'ETH') {
    const prints = cfbRtiBuffer.prints(asset);
    if (prints.length > 0) {
      return prints.map((p) => ({
        t: p.utcSec > 1e12 ? p.utcSec : p.utcSec * 1000,
        v: p.price,
      }));
    }
  }
  return leanSeries ?? null;
}

async function runLastMinuteFlipIfNeeded(opts: {
  userId: string;
  asset: string;
  marketTicker: string;
  cfg: { risk?: { last_minute_flip_sell_usd?: unknown; chase_above_ask_usd?: unknown } };
  now: Date;
  userTrades: TradeRecordDoc[];
  lean: {
    phase?: string;
    yes_bid?: number | null;
    yes_ask?: number | null;
    no_bid?: number | null;
    no_ask?: number | null;
  };
  userTokens: string[];
  lastTradeAction: Partial<Record<string, LastTradeAction>>;
  tickIso: string;
  secret: { privateKeyPem?: string; keyId?: string } | null | undefined;
}): Promise<number> {
  if (normalizeLastMinuteFlipSellUsd(opts.cfg.risk?.last_minute_flip_sell_usd) <= 0) return 0;
  if (pendingLastMinuteTradesForMarket(opts.userTrades, opts.marketTicker).length === 0) return 0;
  if (!opts.secret?.privateKeyPem || !opts.secret.keyId) return 0;
  const client = cloudKalshi(opts.secret.keyId, opts.secret.privateKeyPem, 'production');
  const flipRes = await runCloudLastMinuteFlipExits({
    userId: opts.userId,
    asset: opts.asset,
    ticker: opts.marketTicker,
    lean: opts.lean,
    trades: opts.userTrades,
    flipSellUsd: opts.cfg.risk?.last_minute_flip_sell_usd,
    slippageUsd: Math.min(0.05, Number(opts.cfg.risk?.chase_above_ask_usd) || 0.02),
    dryRun: false,
    now: opts.now,
    place: (input) => client.placeOrder(input),
  });
  for (const alert of flipRes.alerts) {
    await emitCloudAlert({
      userId: opts.userId,
      alertId: protectAlertId(alert.tradeId),
      kind: 'protect_sell',
      title: alert.title,
      body: alert.body,
      cfg: opts.cfg as never,
      tokens: opts.userTokens,
      collapseId: protectCollapseId(opts.userId, alert.tradeId),
      asset: opts.asset,
      ticker: opts.marketTicker,
      tradeId: alert.tradeId,
      at: opts.now.toISOString(),
    });
  }
  if (flipRes.exited > 0) {
    opts.lastTradeAction[opts.asset] = {
      status: 'placed',
      detail: `Last-minute flip · sold ${flipRes.exited}`,
      at: opts.tickIso,
    };
  }
  return flipRes.exited;
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
  setKalshiWsFillsEnabled(featureFlags.kalshiWsFills);
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
    homeQuoteAssets = [];
    homeTickerByAsset = {};
    twapLockWatchUsers.clear();
    lastMinuteWatchUsers.clear();
    stepBuyWatchUsers.clear();
    spikeFadeWatchUsers.clear();
    pairLockWatchUsers.clear();
    capLockWatchUsers.clear();
    capLockRetryKeys.clear();
    capLockMissAt.clear();
    bufferRunWatchUsers.clear();
    cheapLoopWatchUsers.clear();
    cheapLoopHourlyWatchUsers.clear();
    cheapLoopHourlyQuoteTickers.clear();
    cheapLoopWeeklyWatchUsers.clear();
    cheapLoopWeeklyQuoteTickers.clear();
    resetExtraAskTickers();
    protectWatchUsers.clear();
    await flushTwapLockWatcher(now, {});
    await flushLastMinuteWatcher(now, {});
    await flushStepBuyWatcher(now, {});
    await flushSpikeFadeWatcher(now, {});
    await flushPairLockWatcher(now, {});
    await flushCheapLoopWatcher(now, {});
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
      'HYPE',
      'NEAR',
      'ZEC',
      'WTI',
      'Gold',
      'Silver',
      'NG',
      'COPPER',
      'SPX',
      'NDX',
    ];

  homeQuoteAssets = collectHomeQuoteAssets(activeUsers).filter((asset) =>
    assets.includes(asset)
  ) as AssetKey[];
  lastHomeQuoteAt = now.getTime();
  dropSharedLeansNotIn(homeQuoteAssets);
  dropAskTickersNotIn(homeQuoteAssets);

  // 1. DEDUPLICATION: Kalshi lean REST once per Cushions-On coin (shared across users).
  const sharedLeans: Partial<Record<AssetKey, any>> = {};
  await Promise.all(
    homeQuoteAssets.map(async (asset) => {
      try {
        const hours = isMarketOpen(asset, now);
        if (!hours.open) {
          return;
        }
        const lean = await computeLeanOnce(asset, () => computeLean(asset, 0.0, fetch, now));
        sharedLeans[asset] = overlayLeanWsBook(lean);
      } catch (err: any) {
        noteTransientKalshiFailure(err);
        console.warn(`[TICK_SPOT_FETCH_WARN] Asset ${asset} fetch failed:`, err?.message || err);
      }
    })
  );
  rememberSharedLeans(sharedLeans);

  homeTickerByAsset = rememberTickersFromLeans(homeTickerByAsset, sharedLeans);
  rememberAskTickersFromLeans(sharedLeans);
  await persistCushionAskBook(homeQuoteAssets, now, sharedLeans);

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
  cheapLoopHourlyQuoteTickers.clear();
  cheapLoopWeeklyQuoteTickers.clear();
  resetExtraAskTickers();

  for (const batch of userBatches) {
    if (isCloudKalshiPaused()) break;
    await Promise.all(
      batch.map(async (user) => {
        const userId = user.userId;

        try {
          const cfg = user.config || defaultAppConfig();
          const protectEnabled = Boolean(cfg.risk?.protect_sell_enabled);
          const homeAutoExitWatch = homeAutoExitWatchNeeded(cfg.risk);
          // Alert-only (no keys) skip the trade book. Keys stay loaded after Auto-trade Off so fills settle.
          const loadTradeBook = shouldLoadCloudTradeBook(user);
          let cachedSecret: Awaited<ReturnType<typeof getUserSecret>> | undefined;
          let rawTrades = loadTradeBook ? await getTradeRecords(userId) : [];
          if (loadTradeBook && user.kalshiConfigured && !isCloudKalshiPaused()) {
            try {
              cachedSecret = await getUserSecret(userId);
              if (cachedSecret?.keyId && cachedSecret.privateKeyPem) {
                rawTrades = await syncKalshiFillsIntoTradeBook({
                  userId,
                  client: cloudKalshi(cachedSecret.keyId, cachedSecret.privateKeyPem, 'production'),
                  trades: rawTrades,
                  now,
                });
              }
            } catch {
              cachedSecret = undefined;
            }
          }
          const userTrades = loadTradeBook
            ? await settlePendingCloudTrades(userId, rawTrades, now, quoteCache)
            : [];
          rememberExtraAskTickers(
            userTrades.filter(isOpenLiveFill).map((t) => String(t.ticker || '').trim()).filter(Boolean)
          );
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
            const lastMinuteTimes = lastMinuteTimingFromRisk(cfg.risk);
            let lastMinuteClips = lastMinuteClipsForTicker(userTrades, marketTicker);
            if (
              lastMinuteWanted &&
              lastMinuteClips.count > 0 &&
              loadTradeBook &&
              user.kalshiConfigured &&
              normalizeLastMinuteFlipSellUsd(cfg.risk?.last_minute_flip_sell_usd) > 0
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              await runLastMinuteFlipIfNeeded({
                userId,
                asset,
                marketTicker,
                cfg,
                now,
                userTrades,
                lean: {
                  phase: lean.phase === 'live' ? 'live' : 'ended',
                  yes_bid: lean.yes_bid,
                  yes_ask: lean.yes_ask,
                  no_bid: lean.no_bid,
                  no_ask: lean.no_ask,
                },
                userTokens,
                lastTradeAction,
                tickIso,
                secret: cachedSecret,
              });
              lastMinuteClips = lastMinuteClipsForTicker(userTrades, marketTicker);
            }
            const lastMinuteTick = Boolean(
              lastMinuteWanted &&
                twapClose &&
                (lastMinuteClips.count > 0 ||
                  isLastMinuteWindow(now, twapClose, lastMinuteTimes.enterSec, lastMinuteTimes.stopSec))
            );
            const stepBuyWanted =
              isStepBuyEnterPath({
                adminEnabled: featureFlags.stepBuy,
                userEnabled: Boolean(cfg.risk?.step_buy_enabled),
                assetEnabled: cfg.assets_enabled?.[asset] !== false,
                asset,
                assets: cfg.risk?.step_buy_assets,
              }) &&
              !stepBuyTwapOwns({
                twapAdminEnabled: featureFlags.twapLock,
                twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                twapAssets: cfg.risk?.twap_lock_assets,
                asset,
              });
            let stepBuyLots = stepBuyLotsForTicker(userTrades, marketTicker);
            if (
              stepBuyWanted &&
              stepBuyLots.count > 0 &&
              loadTradeBook &&
              user.kalshiConfigured
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              if (cachedSecret?.privateKeyPem && cachedSecret.keyId) {
                const stopClient = cloudKalshi(
                  cachedSecret.keyId,
                  cachedSecret.privateKeyPem,
                  'production'
                );
                const stopRes = await runCloudStepBuyStops({
                  userId,
                  asset,
                  ticker: marketTicker,
                  lean: {
                    phase: lean.phase === 'live' ? 'live' : 'ended',
                    decision: lean.decision,
                    abs_gap: absGap,
                    yes_bid: lean.yes_bid,
                    yes_ask: lean.yes_ask,
                    no_bid: lean.no_bid,
                    no_ask: lean.no_ask,
                  },
                  trades: userTrades,
                  stopUsd: cfg.risk?.step_buy_stop_usd,
                  cushionUsd: cfg.cushions?.[asset],
                  cushionPct: cfg.risk?.step_buy_cushion_pct,
                  sellIfThesisDies: normalizeStepBuySellIfThesisDies(cfg.risk?.step_buy_sell_if_thesis_dies),
                  slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
                  dryRun: false,
                  now,
                  place: (input) => stopClient.placeOrder(input),
                });
                for (const alert of stopRes.alerts) {
                  await emitCloudAlert({
                    userId,
                    alertId: protectAlertId(alert.tradeId),
                    kind: 'protect_sell',
                    title: alert.title,
                    body: alert.body,
                    cfg: cfg as never,
                    tokens: userTokens,
                    collapseId: protectCollapseId(userId, alert.tradeId),
                    asset,
                    ticker: marketTicker,
                    tradeId: alert.tradeId,
                    at: now.toISOString(),
                  });
                }
                if (stopRes.exited > 0) {
                  lastTradeAction[asset] = {
                    status: 'placed',
                    detail: `${stopRes.alerts[0]?.title || 'Step buy stop'} · sold ${stopRes.exited}`,
                    at: tickIso,
                  };
                  stepBuyLots = stepBuyLotsForTicker(userTrades, marketTicker);
                }
              }
            }
            const capLockWanted =
              isCapLockEnterPath({
                adminEnabled: featureFlags.capLock,
                userEnabled: Boolean(cfg.risk?.cap_lock_enabled),
                assetEnabled: cfg.assets_enabled?.[asset] !== false,
                asset,
                assets: cfg.risk?.cap_lock_assets,
              }) &&
              !capLockTwapOwns({
                twapAdminEnabled: featureFlags.twapLock,
                twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                twapAssets: cfg.risk?.twap_lock_assets,
                asset,
              });
            let capLockLots = capLockLotsForTicker(userTrades, marketTicker);
            const capLockHolding = tickerHasOpenCapLock(userTrades, marketTicker);
            const capLockAttempted = tickerHasCapLockAttempt(userTrades, marketTicker);
            const pairLockWanted =
              isPairLockEnterPath({
                adminEnabled: featureFlags.pairLock,
                userEnabled: Boolean(cfg.risk?.pair_lock_enabled),
                assetEnabled: cfg.assets_enabled?.[asset] !== false,
                asset,
                assets: cfg.risk?.pair_lock_assets,
              }) &&
              !pairLockTwapOwns({
                twapAdminEnabled: featureFlags.twapLock,
                twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                twapAssets: cfg.risk?.twap_lock_assets,
                asset,
              });
            let pairLockLots = pairLockLotsForTicker(userTrades, marketTicker);
            const pairLockHolding = tickerHasOpenPairLock(userTrades, marketTicker);
            const cheapLoopHolding = tickerHasOpenCheapLoop(userTrades, marketTicker);
            const cheapLoopCooldownReserve = cheapLoopCooldownOwnsTicker({
              adminEnabled: featureFlags.cheapLoop,
              userEnabled: Boolean(cfg.risk?.cheap_loop_enabled),
              assetEnabled: cfg.assets_enabled?.[asset] !== false,
              asset,
              assets: cfg.risk?.cheap_loop_assets,
              trades: userTrades,
              marketTicker,
              cooldownMinutes: cfg.risk?.cheap_loop_cooldown_minutes,
              cycles: cfg.risk?.cheap_loop_cycles,
              flattenMinutes: cfg.risk?.cheap_loop_flatten_minutes,
              lean,
              now,
            });
            const bufferRunWanted =
              isBufferRunEnterPath({
                adminEnabled: featureFlags.bufferRun,
                userEnabled: Boolean(cfg.risk?.buffer_run_enabled),
                assetEnabled: cfg.assets_enabled?.[asset] !== false,
                asset,
                assets: cfg.risk?.buffer_run_assets,
              }) &&
              !bufferRunTwapOwns({
                twapAdminEnabled: featureFlags.twapLock,
                twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                twapAssets: cfg.risk?.twap_lock_assets,
                asset,
              });
            const bufferRunHolding = tickerHasOpenBufferRun(userTrades, marketTicker);
            const bufferRunAttempted = tickerHasBufferRunAttempt(userTrades, marketTicker);
            const lastMinuteOwnsNewBuys =
              lastMinuteWanted &&
              Boolean(twapClose) &&
              stepBuyLots.count <= 0 &&
              !tickerHasOpenSpikeFade(userTrades, marketTicker) &&
              !capLockHolding &&
              !pairLockHolding &&
              !cheapLoopHolding &&
              !bufferRunHolding &&
              isLastMinuteWindow(now, twapClose!, lastMinuteTimes.enterSec, lastMinuteTimes.stopSec);
            const stepBuyTick = Boolean(
              stepBuyWanted &&
                twapClose &&
                (stepBuyLots.count > 0 ||
                  (isStepBuyStartWindow({
                    now,
                    minutesElapsed: lean.minutes_elapsed,
                    startMinutes: cfg.risk?.step_buy_start_minutes,
                    closeUtc: twapClose,
                  }) &&
                    !lastMinuteOwnsNewBuys &&
                    !cheapLoopHolding &&
                    !cheapLoopCooldownReserve &&
                    !bufferRunHolding))
            );
            const spikeFadeWanted =
              isSpikeFadeEnterPath({
                adminEnabled: featureFlags.spikeFade,
                userEnabled: Boolean(cfg.risk?.spike_fade_enabled),
                assetEnabled: cfg.assets_enabled?.[asset] !== false,
                asset,
                assets: cfg.risk?.spike_fade_assets,
              }) &&
              !spikeFadeTwapOwns({
                twapAdminEnabled: featureFlags.twapLock,
                twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                twapAssets: cfg.risk?.twap_lock_assets,
                asset,
              });
            const spikeFadeHolding = tickerHasOpenSpikeFade(userTrades, marketTicker);
            const inSpikeEnterWindow = isSpikeFadeEnterWindow({
              minutesElapsed: lean.minutes_elapsed,
              startMinutes: cfg.risk?.spike_fade_start_minutes,
              untilMinutes: cfg.risk?.spike_fade_until_minutes,
            });
            const spikeFadeOwnsSlice = spikeFadeWanted && inSpikeEnterWindow && !spikeFadeHolding;
            const spikeFadeTick = Boolean(
              spikeFadeWanted &&
                twapClose &&
                (spikeFadeHolding ||
                  (inSpikeEnterWindow &&
                    !lastMinuteOwnsNewBuys &&
                    stepBuyLots.count <= 0 &&
                    !capLockHolding &&
                    !pairLockHolding &&
                    !cheapLoopHolding &&
                    !cheapLoopCooldownReserve &&
                    !bufferRunHolding))
            );
            const inCapLockEnterWindow = isCapLockEnterWindow({
              minutesElapsed: lean.minutes_elapsed,
              minutesRemaining: lean.minutes_remaining,
              windowOpenSeconds: cfg.risk?.cap_lock_window_open_seconds,
              allowLater: cfg.risk?.cap_lock_allow_later,
            });
            const capLockOwnsSlice = capLockWanted && inCapLockEnterWindow && !capLockHolding && !capLockAttempted;
            const capLockTick = Boolean(
              capLockWanted &&
                twapClose &&
                (shouldWatchCapLockLots(capLockLots) ||
                  (inCapLockEnterWindow &&
                    !capLockAttempted &&
                    !lastMinuteOwnsNewBuys &&
                    stepBuyLots.count <= 0 &&
                    !spikeFadeHolding &&
                    !spikeFadeTick &&
                    !pairLockHolding &&
                    !cheapLoopHolding &&
                    !cheapLoopCooldownReserve &&
                    !bufferRunHolding))
            );
            const inPairEnterWindow = isPairLockEnterWindow({
              minutesElapsed: lean.minutes_elapsed,
              startMinutes: cfg.risk?.pair_lock_start_minutes,
              untilMinutes: cfg.risk?.pair_lock_until_minutes,
            });
            const pairLockOwnsSlice = pairLockWanted && inPairEnterWindow && !pairLockHolding && !capLockTick;
            const pairLockTick = Boolean(
              pairLockWanted &&
                twapClose &&
                (pairLockHolding ||
                  (inPairEnterWindow &&
                    !lastMinuteOwnsNewBuys &&
                    stepBuyLots.count <= 0 &&
                    !spikeFadeHolding &&
                    !spikeFadeTick &&
                    !capLockTick &&
                    !capLockHolding &&
                    !cheapLoopHolding &&
                    !cheapLoopCooldownReserve &&
                    !bufferRunHolding))
            );
            const cheapLoopWanted =
              isCheapLoopEnterPath({
                adminEnabled: featureFlags.cheapLoop,
                userEnabled: Boolean(cfg.risk?.cheap_loop_enabled),
                assetEnabled: cfg.assets_enabled?.[asset] !== false,
                asset,
                assets: cfg.risk?.cheap_loop_assets,
              }) &&
              !cheapLoopTwapOwns({
                twapAdminEnabled: featureFlags.twapLock,
                twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                twapAssets: cfg.risk?.twap_lock_assets,
                asset,
              });
            const cheapLoopCyclesUsed = cheapLoopExitsForTicker(userTrades, marketTicker);
            const cheapLoopCyclesRemain =
              cheapLoopCyclesUsed < normalizeCheapLoopCycles(cfg.risk?.cheap_loop_cycles);
            const cheapLoopFlatten = normalizeCheapLoopFlattenMinutes(cfg.risk?.cheap_loop_flatten_minutes);
            const inCheapEnterWindow = isCheapLoopEnterWindow({
              minutesElapsed: lean.minutes_elapsed,
              minutesLeft: lean.minutes_left,
              startMinutes: cfg.risk?.cheap_loop_start_minutes,
              flattenMinutes: cheapLoopFlatten,
            });
            const cheapLoopOwnsForAuto = cheapLoopWanted && inCheapEnterWindow && cheapLoopCyclesRemain;
            const cheapLoopTick = Boolean(
              cheapLoopWanted &&
                twapClose &&
                (cheapLoopHolding ||
                  (inCheapEnterWindow &&
                    cheapLoopCyclesRemain &&
                    !cheapLoopCooldownReserve &&
                    !lastMinuteOwnsNewBuys &&
                    stepBuyLots.count <= 0 &&
                    !spikeFadeHolding &&
                    !spikeFadeTick &&
                    !pairLockHolding &&
                    !pairLockTick &&
                    !capLockTick &&
                    !capLockHolding &&
                    !bufferRunHolding))
            );
            const inBufferEnterWindow = isBufferRunEnterWindow({
              minutesElapsed: lean.minutes_elapsed,
              minutesLeft: goldFadeMinutesLeft(lean),
              enterElapsedMinutes: cfg.risk?.buffer_run_enter_elapsed_minutes,
              enterLeftMinutes: cfg.risk?.buffer_run_enter_left_minutes,
              flattenMinutes: cfg.risk?.buffer_run_flatten_minutes,
            });
            const bufferRunOwnsForAuto =
              bufferRunWanted && inBufferEnterWindow && !bufferRunAttempted;
            const bufferRunTick = Boolean(
              bufferRunWanted &&
                twapClose &&
                (bufferRunHolding ||
                  (inBufferEnterWindow &&
                    !bufferRunAttempted &&
                    !lastMinuteOwnsNewBuys &&
                    stepBuyLots.count <= 0 &&
                    !spikeFadeHolding &&
                    !spikeFadeTick &&
                    !pairLockHolding &&
                    !pairLockTick &&
                    !capLockTick &&
                    !capLockHolding &&
                    !cheapLoopHolding &&
                    !cheapLoopTick &&
                    !cheapLoopCooldownReserve))
            );
            const goldFadePath =
              goldFadeEnter &&
              !spikeFadeOwnsSlice &&
              !spikeFadeHolding &&
              !capLockOwnsSlice &&
              !capLockHolding &&
              !pairLockOwnsSlice &&
              !pairLockHolding &&
              !cheapLoopOwnsForAuto &&
              !cheapLoopHolding &&
              !cheapLoopCooldownReserve &&
              !bufferRunOwnsForAuto &&
              !bufferRunHolding;
            const cashOutEnter =
              cashOutWanted &&
              !goldFadePath &&
              !twapLockWanted &&
              !lastMinuteTick &&
              !stepBuyTick &&
              !spikeFadeTick &&
              !spikeFadeOwnsSlice &&
              !capLockTick &&
              !capLockOwnsSlice &&
              !pairLockTick &&
              !pairLockOwnsSlice &&
              !cheapLoopTick &&
              !cheapLoopOwnsForAuto &&
              !cheapLoopCooldownReserve &&
              !bufferRunTick &&
              !bufferRunOwnsForAuto;

            if (
              homeAutoExitWatch &&
              loadTradeBook &&
              user.state !== 'KILL_SWITCH' &&
              user.kalshiConfigured &&
              pendingProtectTradesForMarket(userTrades, marketTicker, now).length > 0
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = cloudKalshi(
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
                  enabled: protectEnabled,
                  homeSellAtPct: cfg.risk?.home_sell_at_pct,
                  cushionLeanSellAtPct: cfg.risk?.cushion_lean_sell_at_pct,
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
                const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
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
                const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
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

            if (
              loadTradeBook &&
              user.kalshiConfigured &&
              pendingSpikeFadeTradesForMarket(userTrades, marketTicker).length > 0
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
                const heldSpike = pendingSpikeFadeTradesForMarket(userTrades, marketTicker)[0];
                const spikeSkipThin = resolveSkipThinBid(cfg.risk, 'spike_fade');
                const spikeRes = await runCloudSpikeFadeExits({
                  userId,
                  asset,
                  ticker: marketTicker,
                  lean: {
                    phase: lean.phase === 'live' ? 'live' : 'ended',
                    minutes_left: lean.minutes_left,
                    minutes_remaining: lean.minutes_remaining,
                    yes_bid: lean.yes_bid,
                    yes_ask: lean.yes_ask,
                    no_bid: lean.no_bid,
                    no_ask: lean.no_ask,
                  },
                  trades: userTrades,
                  takeAskUsd: cfg.risk?.spike_fade_take_ask_usd,
                  stopAskUsd: cfg.risk?.spike_fade_stop_ask_usd,
                  flattenMinutes: cfg.risk?.spike_fade_flatten_minutes,
                  skipThinBid: spikeSkipThin,
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    heldSpike?.decision || lean.decision,
                    spikeSkipThin
                  ),
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
                if (spikeRes.exited > 0) {
                  tradesCount += spikeRes.exited;
                  openPositions = Math.max(0, openPositions - spikeRes.exited);
                  await writeAuditLog(userId, 'TRADE_TRIGGERED', {
                    spikeFade: true,
                    asset,
                    ticker: marketTicker,
                    exited: spikeRes.exited,
                  });
                }
                for (const alert of spikeRes.alerts) {
                  await emitCloudAlert({
                    userId,
                    alertId: protectAlertId(alert.tradeId),
                    kind: 'protect_sell',
                    title: alert.title,
                    body: alert.body,
                    cfg,
                    tokens: userTokens,
                    collapseId: `spk:${userId}:${alert.tradeId}`.slice(0, 64),
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
              pendingCheapLoopTradesForMarket(userTrades, marketTicker).length > 0
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
                const cheapRes = await runCloudCheapLoopExits({
                  userId,
                  asset,
                  ticker: marketTicker,
                  lean: {
                    phase: lean.phase === 'live' ? 'live' : 'ended',
                    minutes_left: lean.minutes_left,
                    minutes_remaining: lean.minutes_remaining,
                    yes_bid: lean.yes_bid,
                    yes_ask: lean.yes_ask,
                    no_bid: lean.no_bid,
                    no_ask: lean.no_ask,
                  },
                  trades: userTrades,
                  takeUsd: cfg.risk?.cheap_loop_take_usd,
                  stopUsd: cheapLoopActiveStopUsd(
                    cfg.risk?.cheap_loop_stop_enabled,
                    cfg.risk?.cheap_loop_stop_usd
                  ),
                  flattenMinutes: cfg.risk?.cheap_loop_flatten_minutes,
                  minHoldMinutes: cfg.risk?.cheap_loop_min_hold_minutes,
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
                if (cheapRes.exited > 0) {
                  tradesCount += cheapRes.exited;
                  openPositions = Math.max(0, openPositions - cheapRes.exited);
                  await writeAuditLog(userId, 'TRADE_TRIGGERED', {
                    cheapLoop: true,
                    asset,
                    ticker: marketTicker,
                    exited: cheapRes.exited,
                  });
                }
                for (const alert of cheapRes.alerts) {
                  await emitCloudAlert({
                    userId,
                    alertId: protectAlertId(alert.tradeId),
                    kind: 'protect_sell',
                    title: alert.title,
                    body: alert.body,
                    cfg,
                    tokens: userTokens,
                    collapseId: `clp:${userId}:${alert.tradeId}`.slice(0, 64),
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
              pendingBufferRunTradesForMarket(userTrades, marketTicker).length > 0
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
                const bufferRes = await runCloudBufferRunExits({
                  userId,
                  asset,
                  ticker: marketTicker,
                  lean: {
                    phase: lean.phase === 'live' ? 'live' : 'ended',
                    minutes_left: lean.minutes_left,
                    minutes_remaining: lean.minutes_remaining,
                    live: lean.live,
                    strike: lean.strike,
                    yes_bid: lean.yes_bid,
                    yes_ask: lean.yes_ask,
                    no_bid: lean.no_bid,
                    no_ask: lean.no_ask,
                  },
                  trades: userTrades,
                  takeUsd: cfg.risk?.buffer_run_take_usd,
                  stopUsd: cfg.risk?.buffer_run_stop_usd,
                  flattenMinutes: cfg.risk?.buffer_run_flatten_minutes,
                  sellAtPct: cfg.risk?.buffer_run_sell_at_pct,
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
                if (bufferRes.exited > 0) {
                  tradesCount += bufferRes.exited;
                  openPositions = Math.max(0, openPositions - bufferRes.exited);
                  await writeAuditLog(userId, 'TRADE_TRIGGERED', {
                    bufferRun: true,
                    asset,
                    ticker: marketTicker,
                    exited: bufferRes.exited,
                  });
                }
                for (const alert of bufferRes.alerts) {
                  await emitCloudAlert({
                    userId,
                    alertId: protectAlertId(alert.tradeId),
                    kind: 'protect_sell',
                    title: alert.title,
                    body: alert.body,
                    cfg,
                    tokens: userTokens,
                    collapseId: `bfr:${userId}:${alert.tradeId}`.slice(0, 64),
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
              shouldWatchCapLockLots(capLockLots)
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = cloudKalshi(secret.keyId, secret.privateKeyPem, isLive ? 'production' : 'demo');
                const retryKey = `${userId}:${marketTicker}`;
                const watchRes = await runCloudCapLockWatch({
                  userId,
                  asset,
                  ticker: marketTicker,
                  lean,
                  trades: userTrades,
                  maxLockLossUsd: cfg.risk?.cap_lock_max_loss_usd,
                  alreadyRetried: capLockRetryKeys.has(retryKey),
                  dryRun: !isLive,
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
                if (watchRes.kind === 'retry_second' && watchRes.secondGate?.price && watchRes.secondGate.count) {
                  capLockRetryKeys.add(retryKey);
                  const second = watchRes.secondGate;
                  const secondSide = second.decision === 'NO' ? 'NO' : 'YES';
                  const secondGate = liveIocBuyGate(
                    {
                      ok: true,
                      decision: secondSide,
                      count: String(second.count),
                      side: second.side === 'ask' ? 'ask' : 'bid',
                      price: String(second.price),
                      pay_price: Number(second.pay_price ?? second.price),
                      time_in_force: 'immediate_or_cancel',
                    },
                    marketTicker,
                    lean,
                    Number(second.pay_price ?? second.price),
                    true
                  );
                  if (secondGate.ok && secondGate.price && secondGate.count) {
                    const placeRes = await client.placeOrder({
                      ticker: marketTicker,
                      side: secondGate.side || 'bid',
                      count: String(secondGate.count),
                      price: String(secondGate.price),
                      time_in_force: 'immediate_or_cancel',
                      dry_run: !isLive,
                    });
                    if (placeResultShouldPersist(placeRes)) {
                      const { fillCount, filled } = resolvedPlaceFillCount({
                        dryRun: Boolean(placeRes.dry_run) || !isLive,
                        fillCount: placeRes.fill_count,
                        intendedCount: secondGate.count,
                      });
                      const tradeDoc: TradeRecordDoc = {
                        tradeId: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                        userId,
                        ticker: marketTicker,
                        asset,
                        decision: secondSide,
                        count: filled ? String(fillCount) : String(secondGate.count || 0),
                        price: String(secondGate.price),
                        notionalUsd: filled
                          ? Math.round(fillCount * (Number(secondGate.pay_price) || 0) * 100) / 100
                          : Number(secondGate.notional_usd) || 0,
                        dryRun: !isLive,
                        status: filled ? 'FILLED' : 'CANCELLED',
                        leanDiff: absGap,
                        liveSpot: lean.live,
                        strike: lean.strike,
                        executedAt: now.toISOString(),
                        orderId: placeRes.order_id ?? null,
                        payPrice: Number(secondGate.pay_price ?? 0) || null,
                        fillCount: filled ? fillCount : 0,
                        outcome: filled ? 'pending' : 'miss',
                        pnlUsd: null,
                        entryPath: 'cap_lock',
                      };
                      await saveTradeRecord(userId, tradeDoc);
                      userTrades.unshift(tradeDoc);
                    }
                  }
                }
                for (const alert of watchRes.alerts) {
                  await emitCloudAlert({
                    userId,
                    alertId: protectAlertId(alert.tradeId),
                    kind: 'protect_sell',
                    title: alert.title,
                    body: alert.body,
                    cfg,
                    tokens: userTokens,
                    collapseId: `clf:${userId}:${alert.tradeId}`.slice(0, 64),
                    asset,
                    ticker: marketTicker,
                    tradeId: alert.tradeId,
                    at: now.toISOString(),
                  });
                }
                if (watchRes.exited > 0 || watchRes.placed > 0) {
                  lastTradeAction[asset] = {
                    status: 'placed',
                    detail: watchRes.exited > 0 ? 'Cap lock flatten unmatched' : 'Cap lock second retry',
                    at: tickIso,
                  };
                  capLockLots = capLockLotsForTicker(userTrades, marketTicker);
                }
              }
            }

            if (
              loadTradeBook &&
              user.kalshiConfigured &&
              shouldWatchPairLockLots({
                lots: pairLockLots,
                addPairs: cfg.risk?.pair_lock_add_pairs,
                lotCount: cfg.risk?.pair_lock_lot_count,
              })
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
                const pairSkipThin = resolveSkipThinBid(cfg.risk, 'pair_lock');
                const quotes = {
                  yes_bid: lean.yes_bid,
                  yes_ask: lean.yes_ask,
                  no_bid: lean.no_bid,
                  no_ask: lean.no_ask,
                };
                const watch = evaluatePairLockWatch({
                  lots: pairLockLots,
                  quotes,
                  minLockUsd: cfg.risk?.pair_lock_min_lock_usd,
                  flattenMinutes: cfg.risk?.pair_lock_flatten_minutes,
                  runnerStopUsd: cfg.risk?.pair_lock_runner_stop_usd,
                  addPairs: cfg.risk?.pair_lock_add_pairs,
                  lotCount: cfg.risk?.pair_lock_lot_count,
                  recoverSeconds: cfg.risk?.pair_lock_recover_seconds,
                  lean: {
                    phase: lean.phase === 'live' ? 'live' : 'ended',
                    minutes_left: lean.minutes_left,
                    minutes_remaining: lean.minutes_remaining,
                  },
                  filledAt: pairLockLots.extraFilledAt ?? pairLockLots.runnerFilledAt,
                  now,
                  skipThinBid: pairSkipThin,
                  hedgeBidSize: await cashOutBestBidSize(
                    marketTicker,
                    (pairLockLots.extraSide || pairLockLots.runnerSide) === 'YES' ? 'NO' : 'YES',
                    pairSkipThin
                  ),
                  flattenBidSize: await cashOutBestBidSize(
                    marketTicker,
                    pairLockLots.extraSide || pairLockLots.runnerSide || lean.decision,
                    pairSkipThin
                  ),
                  yesBidSize: await cashOutBestBidSize(marketTicker, 'YES', pairSkipThin),
                  noBidSize: await cashOutBestBidSize(marketTicker, 'NO', pairSkipThin),
                });
                if (
                  (watch.kind === 'hedge' || watch.kind === 'stack_finish') &&
                  watch.hedge?.ok &&
                  watch.hedge.price &&
                  watch.hedge.count
                ) {
                  const hedgeReq = `plh_${userId}_${marketTicker}_${Date.now()}`.slice(0, 64);
                  const hedgeLock = await tryAcquirePlaceLock({
                    userId,
                    ticker: marketTicker,
                    cap: Math.max(2, windowBuyCap(cfg.risk) + 1),
                    requestId: hedgeReq,
                    existingBuys: 1,
                  });
                  if (hedgeLock.ok) {
                    let hedgeFilled = false;
                    try {
                      const buyHedge = pairLockIocBuyGate(watch.hedge, marketTicker, lean);
                      if (!buyHedge.ok || !buyHedge.price || !buyHedge.count) {
                        lastTradeAction[asset] = skippedTradeAction(buyHedge.skip_reason || 'ask_moved', tickIso);
                      } else {
                      const placeRes = await client.placeOrder({
                        ticker: marketTicker,
                        side: buyHedge.side || 'bid',
                        count: buyHedge.count,
                        price: buyHedge.price,
                        time_in_force: 'immediate_or_cancel',
                        dry_run: false,
                      });
                      const { fillCount, filled } = resolvedPlaceFillCount({
                        dryRun: Boolean(placeRes.dry_run),
                        fillCount: placeRes.fill_count,
                        intendedCount: buyHedge.count,
                      });
                      hedgeFilled = filled;
                      const payPrice = Number(buyHedge.pay_price ?? 0) || null;
                      const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                      const hedgeDecision = watch.hedge.decision === 'NO' ? 'NO' : 'YES';
                      const tradeDoc: TradeRecordDoc = {
                        tradeId,
                        userId,
                        ticker: marketTicker,
                        asset,
                        decision: hedgeDecision,
                        count: filled ? String(fillCount) : String(buyHedge.count || 0),
                        price: String(buyHedge.price),
                        notionalUsd:
                          filled && payPrice
                            ? Math.round(fillCount * payPrice * 100) / 100
                            : buyHedge.notional_usd || 0,
                        dryRun: false,
                        status: filled ? 'FILLED' : 'CANCELLED',
                        leanDiff: absGap,
                        liveSpot: lean.live,
                        strike: lean.strike,
                        executedAt: now.toISOString(),
                        orderId: placeRes.order_id ?? null,
                        payPrice,
                        fillCount: filled ? fillCount : 0,
                        outcome: filled ? 'pending' : 'miss',
                        pnlUsd: null,
                        entryPath: 'pair_lock_hedge',
                      };
                      await saveTradeRecord(userId, tradeDoc);
                      userTrades.unshift(tradeDoc);
                      pairLockLots = pairLockLotsForTicker(userTrades, marketTicker);
                      const priceVal = parseFloat(String(buyHedge.price || 0));
                      lastTradeAction[asset] = filled
                        ? {
                            status: 'placed',
                            detail: `placed Pair lock hedge ${hedgeDecision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
                            at: tickIso,
                          }
                        : { status: 'failed', detail: 'IOC no fill', at: tickIso };
                      if (filled) {
                        tradesCount += 1;
                        const locked = pairLockLockedUsd(
                          pairLockLots.runnerSide === 'YES' ? pairLockLots.runnerFillUsd : pairLockLots.hedgeFillUsd,
                          pairLockLots.runnerSide === 'NO' ? pairLockLots.runnerFillUsd : pairLockLots.hedgeFillUsd
                        );
                        const cents = locked != null ? Math.round(locked * 100) : 0;
                        await emitCloudAlert({
                          userId,
                          alertId: fillAlertId(tradeId),
                          kind: 'order_filled',
                          title: orderPlacedAlertTitle({
                            live: true,
                            asset,
                            decision: hedgeDecision,
                            entryPath: 'pair_lock_hedge',
                          }),
                          body:
                            cents > 0
                              ? `${buyHedge.count} ctr @ $${priceVal.toFixed(2)} · Pair lock locked · +${cents}¢`
                              : `${buyHedge.count} ctr @ $${priceVal.toFixed(2)}`,
                          cfg,
                          tokens: userTokens,
                          collapseId: fillCollapseId(userId, tradeId),
                          asset,
                          ticker: marketTicker,
                          tradeId,
                          decision: hedgeDecision,
                          at: now.toISOString(),
                        });
                      } else {
                        await emitCloudAlert({
                          userId,
                          alertId: missAlertId(tradeId),
                          kind: 'ioc_miss',
                          title: iocMissAlertTitle('pair_lock_hedge'),
                          body: iocMissAlertBody({
                            asset,
                            decision: hedgeDecision,
                            entryPath: 'pair_lock_hedge',
                            price: priceVal,
                            count: buyHedge.count,
                          }),
                          cfg,
                          tokens: userTokens,
                          asset,
                          ticker: marketTicker,
                          tradeId,
                          decision: hedgeDecision,
                          at: now.toISOString(),
                        });
                      }
                      }
                    } finally {
                      await releasePlaceLock({ userId, ticker: marketTicker, requestId: hedgeReq });
                    }
                    if (hedgeFilled) {
                      const stacked = await maybePlacePairLockStackAfterLock({
                        lots: pairLockLots,
                        quotes,
                        addPairs: cfg.risk?.pair_lock_add_pairs,
                        lotCount: cfg.risk?.pair_lock_lot_count,
                        minLockUsd: cfg.risk?.pair_lock_min_lock_usd,
                        flattenMinutes: cfg.risk?.pair_lock_flatten_minutes,
                        runnerStopUsd: cfg.risk?.pair_lock_runner_stop_usd,
                        lean: {
                          phase: lean.phase === 'live' ? 'live' : 'ended',
                          minutes_left: lean.minutes_left,
                          minutes_remaining: lean.minutes_remaining,
                        },
                        now,
                        skipThinBid: pairSkipThin,
                        marketTicker,
                        userId,
                        asset,
                        client,
                        userTrades,
                        cfg,
                        userTokens,
                        tickIso,
                        absGap,
                        liveSpot: lean.live,
                        strike: lean.strike,
                        lastTradeAction,
                        requestPrefix: 'pls_',
                      });
                      pairLockLots = stacked.lots;
                      tradesCount += stacked.filledLegs;
                    }
                  }
                } else if (
                  watch.kind === 'flatten' ||
                  watch.kind === 'thin_bid' ||
                  watch.kind === 'runner_stop' ||
                  watch.kind === 'stack_dump' ||
                  watch.kind === 'atomic_dump' ||
                  watch.kind === 'runner_take'
                ) {
                  const pairRes = await runCloudPairLockFlatten({
                    userId,
                    asset,
                    ticker: marketTicker,
                    lean: {
                      phase: lean.phase === 'live' ? 'live' : 'ended',
                      minutes_left: lean.minutes_left,
                      minutes_remaining: lean.minutes_remaining,
                      yes_bid: lean.yes_bid,
                      yes_ask: lean.yes_ask,
                      no_bid: lean.no_bid,
                      no_ask: lean.no_ask,
                    },
                    trades: userTrades,
                    flattenMinutes: cfg.risk?.pair_lock_flatten_minutes,
                    runnerStopUsd: cfg.risk?.pair_lock_runner_stop_usd,
                    minLockUsd: cfg.risk?.pair_lock_min_lock_usd,
                    skipThinBid: pairSkipThin,
                    bidSize: await cashOutBestBidSize(
                      marketTicker,
                      pairLockLots.extraSide || pairLockLots.runnerSide || lean.decision,
                      pairSkipThin
                    ),
                    slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
                    dryRun: false,
                    now,
                    forceExtra:
                      watch.kind === 'stack_dump' ||
                      watch.kind === 'atomic_dump' ||
                      watch.kind === 'runner_take',
                    place: (input) => client.placeOrder(input),
                  });
                  if (pairRes.exited > 0) {
                    tradesCount += pairRes.exited;
                    openPositions = Math.max(0, openPositions - pairRes.exited);
                    pairLockLots = pairLockLotsForTicker(userTrades, marketTicker);
                    lastTradeAction[asset] = {
                      status: 'placed',
                      detail:
                        watch.kind === 'runner_stop'
                          ? `Pair lock runner stop · sold ${pairRes.exited}`
                          : watch.kind === 'stack_dump'
                            ? `Pair lock add pair dump · sold ${pairRes.exited}`
                            : watch.kind === 'atomic_dump'
                              ? `Pair lock unmatched dump · sold ${pairRes.exited}`
                              : watch.kind === 'runner_take'
                                ? `Pair lock runner take · sold ${pairRes.exited}`
                                : `Pair lock flatten · sold ${pairRes.exited}`,
                      at: tickIso,
                    };
                  }
                  for (const alert of pairRes.alerts) {
                    await emitCloudAlert({
                      userId,
                      alertId: protectAlertId(alert.tradeId),
                      kind: 'protect_sell',
                      title: alert.title,
                      body: alert.body,
                      cfg,
                      tokens: userTokens,
                      collapseId: `plk:${userId}:${alert.tradeId}`.slice(0, 64),
                      asset,
                      ticker: marketTicker,
                      tradeId: alert.tradeId,
                      at: now.toISOString(),
                    });
                  }
                } else if (watch.kind === 'stack' && watch.stack?.ok && watch.stack.yes.ok && watch.stack.no.ok) {
                  const stacked = await placePairLockStackAdd({
                    userId,
                    asset,
                    marketTicker,
                    client,
                    stack: watch.stack,
                    userTrades,
                    cfg,
                    userTokens,
                    now,
                    tickIso,
                    absGap,
                    liveSpot: lean.live,
                    strike: lean.strike,
                    lastTradeAction,
                    requestPrefix: 'pls_',
                  });
                  pairLockLots = pairLockLotsForTicker(userTrades, marketTicker);
                  tradesCount += stacked.filledLegs;
                } else if (
                  watch.kind === 'hold_locked' &&
                  (watch.reason === 'pair_lock_min_lock' || watch.reason === 'pair_lock_too_late')
                ) {
                  lastTradeAction[asset] = skippedTradeAction(watch.reason, tickIso);
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
            if (
              !cashOutEnter &&
              !goldFadePath &&
              !twapLockWanted &&
              !lastMinuteTick &&
              !stepBuyTick &&
              !spikeFadeTick &&
              !capLockTick &&
              !capLockOwnsSlice &&
              !pairLockTick &&
              !pairLockOwnsSlice &&
              !cheapLoopTick &&
              !cheapLoopOwnsForAuto &&
              !bufferRunTick &&
              !bufferRunOwnsForAuto &&
              absGap < userCushion
            ) {
              delete lastTradeAction[asset];
              continue;
            }
            const windowCap = windowBuyCap(cfg.risk);
            const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
            if (
              !(lastMinuteTick && lastMinuteClips.count > 0) &&
              !(stepBuyTick && stepBuyLots.count > 0) &&
              !cheapLoopTick &&
              !capLockTick &&
              !bufferRunTick &&
              existingBuys >= windowCap
            ) {
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
            if (!lastMinuteTick && tickerHasOpenLastMinute(userTrades, marketTicker)) {
              lastTradeAction[asset] = skippedTradeAction('last_minute_holding', tickIso);
              continue;
            }
            if (!stepBuyTick && tickerHasOpenStepBuy(userTrades, marketTicker)) {
              lastTradeAction[asset] = skippedTradeAction('step_buy_holding', tickIso);
              continue;
            }
            if (!spikeFadeTick && tickerHasOpenSpikeFade(userTrades, marketTicker)) {
              lastTradeAction[asset] = skippedTradeAction('spike_fade_holding', tickIso);
              continue;
            }
            if (pairLockHolding) {
              continue;
            }
            if (!cheapLoopTick && cheapLoopHolding) {
              lastTradeAction[asset] = skippedTradeAction('cheap_loop_holding', tickIso);
              continue;
            }
            if (!bufferRunTick && bufferRunHolding) {
              lastTradeAction[asset] = skippedTradeAction('buffer_run_holding', tickIso);
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
              open_utc: lean.open_utc,
              close_utc: lean.close_utc,
            };
            const cashOutThin = resolveSkipThinBid(cfg.risk, 'cash_out');
            const fadeThin = resolveSkipThinBid(cfg.risk, 'gold_fade');
            const twapThin = resolveSkipThinBid(cfg.risk, 'twap_lock');
            const lastThin = resolveSkipThinBid(cfg.risk, 'last_minute');
            const stepThin = resolveSkipThinBid(cfg.risk, 'step_buy');
            const spikeThin = resolveSkipThinBid(cfg.risk, 'spike_fade');
            const pairThin = resolveSkipThinBid(cfg.risk, 'pair_lock');
            const cheapThin = cfg.risk?.cheap_loop_skip_thin_bid === true;
            const bufferThin = cfg.risk?.buffer_run_skip_thin_bid === true;
            const fadeSide = goldFadeCheapSide(leanForGate);
            if (twapLockWanted && twapClose && isTwapLockWatchWindow(now, twapClose)) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const twapClient =
                cachedSecret?.privateKeyPem && cachedSecret.keyId
                  ? cloudKalshi(cachedSecret.keyId, cachedSecret.privateKeyPem, 'production')
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
              : lastMinuteTick &&
                !(stepBuyTick && stepBuyLots.count > 0) &&
                !(spikeFadeTick && spikeFadeHolding)
              ? evaluateLastMinuteEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.lastMinute,
                  twapAdminEnabled: featureFlags.twapLock,
                  now,
                  openPositions,
                  tradesToday,
                  assetTradesInWindow: existingBuys,
                  lastMinuteClips: lastMinuteClips.count,
                  lastClipAt: lastMinuteClips.lastAt,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenOtherThanLastMinute(userTrades, marketTicker),
                  skipThinBid: lastThin,
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    lastMinutePickedSide(leanForGate, cfg),
                    lastThin
                  ),
                })
              : spikeFadeTick && !stepBuyLots.count
              ? evaluateSpikeFadeEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.spikeFade,
                  twapAdminEnabled: featureFlags.twapLock,
                  openPositions,
                  tradesToday,
                  assetTradesInWindow: existingBuys,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenOtherThanSpikeFade(userTrades, marketTicker),
                  lastMinuteOwnsNewBuys,
                  skipThinBid: spikeThin,
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    spikeFadePickedSide(leanForGate, cfg),
                    spikeThin
                  ),
                })
              : stepBuyTick
              ? evaluateStepBuyEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.stepBuy,
                  twapAdminEnabled: featureFlags.twapLock,
                  now,
                  openPositions,
                  tradesToday,
                  assetTradesInWindow: existingBuys,
                  stepBuyLots: stepBuyLots.count,
                  lastLotAt: stepBuyLots.lastAt,
                  lastFill: stepBuyLots.lastFill,
                  heldSide: stepBuyLots.heldSide,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenOtherThanStepBuy(userTrades, marketTicker),
                  lastMinuteOwnsNewBuys,
                  skipThinBid: stepThin,
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    stepBuyLots.heldSide || lean.decision,
                    stepThin
                  ),
                })
              : capLockTick && !shouldWatchCapLockLots(capLockLots)
              ? evaluateCapLockEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.capLock,
                  twapAdminEnabled: featureFlags.twapLock,
                  openPositions,
                  tradesToday,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenOtherThanCapLock(userTrades, marketTicker),
                  alreadyAttempted: capLockAttempted,
                  lastMinuteOwnsNewBuys,
                  pairLockOwns: pairLockHolding,
                  lastMissAtMs: capLockMissAt.get(`${userId}:${marketTicker}`),
                  nowMs: now.getTime(),
                })
              : pairLockTick
              ? evaluatePairLockEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.pairLock,
                  twapAdminEnabled: featureFlags.twapLock,
                  openPositions,
                  tradesToday,
                  assetTradesInWindow: existingBuys,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenOtherThanPairLock(userTrades, marketTicker),
                  lastMinuteOwnsNewBuys,
                  skipThinBid: pairThin,
                  bidSize: await cashOutBestBidSize(marketTicker, lean.decision, pairThin),
                })
              : cheapLoopTick
              ? evaluateCheapLoopEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.cheapLoop,
                  twapAdminEnabled: featureFlags.twapLock,
                  openPositions,
                  tradesToday,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenOtherThanCheapLoop(userTrades, marketTicker),
                  alreadyHolding: cheapLoopHolding,
                  lastMinuteOwnsNewBuys,
                  cyclesUsed: cheapLoopCyclesUsed,
                  inCooldown: isCheapLoopCooldown({
                    trades: userTrades,
                    marketTicker,
                    cooldownMinutes: cfg.risk?.cheap_loop_cooldown_minutes,
                    now,
                  }),
                  skipThinBid: cheapThin,
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    cheapLoopPickedSide(leanForGate, cfg),
                    cheapThin
                  ),
                })
              : bufferRunTick
              ? evaluateBufferRunEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.bufferRun,
                  twapAdminEnabled: featureFlags.twapLock,
                  openPositions,
                  tradesToday,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenOtherThanBufferRun(userTrades, marketTicker),
                  alreadyHolding: bufferRunHolding,
                  alreadyAttempted: bufferRunAttempted,
                  lastMinuteOwnsNewBuys,
                  spikeFadeOwns: spikeFadeTick || spikeFadeHolding || spikeFadeOwnsSlice,
                  stepBuyOwns: stepBuyTick || stepBuyLots.count > 0,
                  pairLockOwns: pairLockTick || pairLockHolding || pairLockOwnsSlice,
                  capLockOwns: capLockTick || capLockHolding || capLockOwnsSlice,
                  cheapLoopOwns:
                    cheapLoopTick ||
                    cheapLoopHolding ||
                    cheapLoopOwnsForAuto ||
                    cheapLoopCooldownReserve,
                  skipThinBid: bufferThin,
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    bufferRunPickedSide(leanForGate, cfg),
                    bufferThin
                  ),
                  timeseries: bufferRunTimeseriesForAsset(asset, lean.timeseries),
                })
              : goldFadePath
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
                : capLockWanted
                  ? { ok: false, skip_reason: 'cap_lock_owns_auto' }
                : bufferRunWanted
                  ? { ok: false, skip_reason: 'buffer_run_owns_auto' }
                : isCushionLeanEnabled(cfg.risk)
                  ? evaluateStaticGate(leanForGate, cfg, {
                      openPositions,
                      tradesToday,
                      assetTradesInWindow: existingBuys,
                      dailyPnlUsd,
                      applyCushionLeanMaxGap: true,
                    })
                  : { ok: false, skip_reason: 'cushion_lean_off' };
            const entryPath = twapLockWanted
              ? 'twap_lock'
              : lastMinuteTick &&
                !(stepBuyTick && stepBuyLots.count > 0) &&
                !(spikeFadeTick && spikeFadeHolding)
                ? 'last_minute'
                : spikeFadeTick && !stepBuyLots.count
                  ? 'spike_fade'
                : stepBuyTick
                  ? 'step_buy'
                : capLockTick && !shouldWatchCapLockLots(capLockLots)
                  ? 'cap_lock'
                : pairLockTick
                  ? 'pair_lock'
                : cheapLoopTick
                  ? 'cheap_loop'
                : bufferRunTick
                  ? 'buffer_run'
                : goldFadePath
                  ? 'gold_fade'
                  : cashOutEnter
                    ? 'cash_out'
                    : 'auto';
            const placeDecision =
              entryPath === 'twap_lock'
                ? 'YES'
                : entryPath === 'last_minute' ||
                    entryPath === 'step_buy' ||
                    entryPath === 'spike_fade' ||
                    entryPath === 'pair_lock' ||
                    entryPath === 'cap_lock' ||
                    entryPath === 'cheap_loop' ||
                    entryPath === 'buffer_run'
                  ? gate.decision || lean.decision
                  : lean.decision;

            if (!cfg.auto_trade_enabled || user.state !== 'ARMED') {
              delete lastTradeAction[asset];
              continue;
            }
            if (!gate.ok || !gate.price || !gate.count) {
              if (gate.skip_reason === 'twap_lock_not_last_minute') {
                delete lastTradeAction[asset];
                continue;
              }
              if (
                gate.skip_reason === 'last_minute_not_last_minute' ||
                gate.skip_reason === 'last_minute_ladder_wait' ||
                gate.skip_reason === 'step_buy_too_early' ||
                gate.skip_reason === 'step_buy_add_wait' ||
                gate.skip_reason === 'step_buy_stop_add' ||
                gate.skip_reason === 'step_buy_add_band' ||
                gate.skip_reason === 'step_buy_no_thesis' ||
                gate.skip_reason === 'step_buy_add_cushion' ||
                gate.skip_reason === 'step_buy_lean_flipped' ||
                gate.skip_reason === 'spike_fade_outside_window' ||
                gate.skip_reason === 'spike_fade_no_spike' ||
                gate.skip_reason === 'spike_fade_cheap_off_band' ||
                gate.skip_reason === 'cheap_loop_outside_window' ||
                gate.skip_reason === 'cheap_loop_too_late' ||
                gate.skip_reason === 'cheap_loop_cooldown' ||
                gate.skip_reason === 'cheap_loop_no_favorite' ||
                gate.skip_reason === 'cheap_loop_no_cheap_side' ||
                gate.skip_reason === 'cheap_loop_ask_rich' ||
                gate.skip_reason === 'cheap_loop_too_cheap' ||
                gate.skip_reason === 'cheap_loop_favorite_rich' ||
                gate.skip_reason === 'cap_lock_too_rich' ||
                gate.skip_reason === 'cap_lock_no_ask' ||
                gate.skip_reason === 'cap_lock_outside_window' ||
                gate.skip_reason === 'cap_lock_attempted' ||
                gate.skip_reason === 'cap_lock_owns_auto' ||
                gate.skip_reason === 'buffer_run_too_early' ||
                gate.skip_reason === 'buffer_run_too_late' ||
                gate.skip_reason === 'buffer_run_no_spot' ||
                gate.skip_reason === 'buffer_run_no_ask' ||
                gate.skip_reason === 'buffer_run_ask_rich' ||
                gate.skip_reason === 'buffer_run_ask_cheap' ||
                gate.skip_reason === 'buffer_run_pair_lock' ||
                gate.skip_reason === 'buffer_run_thin_lead' ||
                gate.skip_reason === 'buffer_run_thin_bid' ||
                gate.skip_reason === 'buffer_run_attempted' ||
                gate.skip_reason === 'buffer_run_holding' ||
                gate.skip_reason === 'buffer_run_holding_other_path' ||
                gate.skip_reason === 'buffer_run_twap_owns' ||
                gate.skip_reason === 'buffer_run_last_minute_owns' ||
                gate.skip_reason === 'buffer_run_spike_owns' ||
                gate.skip_reason === 'buffer_run_step_owns' ||
                gate.skip_reason === 'buffer_run_pair_owns' ||
                gate.skip_reason === 'buffer_run_cap_owns' ||
                gate.skip_reason === 'buffer_run_cheap_owns' ||
                gate.skip_reason === 'buffer_run_owns_auto' ||
                gate.skip_reason === 'buffer_run_admin_off' ||
                gate.skip_reason === 'buffer_run_off' ||
                gate.skip_reason === 'buffer_run_asset_off' ||
                gate.skip_reason === 'window_ended'
              ) {
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
              cap:
                entryPath === 'last_minute' && lastMinuteClips.count > 0
                  ? lastMinuteTimes.maxClips
                  : entryPath === 'step_buy' && stepBuyLots.count > 0
                    ? normalizeStepBuyMaxLots(cfg.risk?.step_buy_max_lots)
                    : entryPath === 'cheap_loop' ||
                        entryPath === 'cap_lock' ||
                        entryPath === 'buffer_run'
                      ? existingBuys + 2
                      : windowCap,
              requestId: placeRequestId,
              existingBuys:
                entryPath === 'last_minute' && lastMinuteClips.count > 0
                  ? lastMinuteClips.count
                  : entryPath === 'step_buy' && stepBuyLots.count > 0
                    ? stepBuyLots.count
                    : existingBuys,
            });
            if (!claimed.ok) {
              lastTradeAction[asset] = skippedTradeAction(claimed.reason, tickIso);
              continue;
            }

            const client = cloudKalshi(secret.keyId, secret.privateKeyPem, isLive ? 'production' : 'demo');
            let pairLockRunnerFilled = false;
            let pairLockAtomicPlaced = false;
            try {
              if (entryPath === 'pair_lock') {
                const freshTrades = await getTradeRecords(userId);
                userTrades.splice(0, userTrades.length, ...freshTrades);
                const freshExisting = countWindowBuysForTicker(userTrades, marketTicker);
                const recheck = evaluatePairLockEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.pairLock,
                  twapAdminEnabled: featureFlags.twapLock,
                  openPositions: userTrades.filter(
                    (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
                  ).length,
                  tradesToday,
                  assetTradesInWindow: freshExisting,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenOtherThanPairLock(userTrades, marketTicker),
                  lastMinuteOwnsNewBuys,
                  skipThinBid: pairThin,
                  bidSize: await cashOutBestBidSize(marketTicker, lean.decision, pairThin),
                });
                if (!recheck.ok || !recheck.price || !recheck.count) {
                  lastTradeAction[asset] = skippedTradeAction(
                    recheck.skip_reason || 'window_locked',
                    tickIso
                  );
                  continue;
                }
              }
              if (entryPath === 'spike_fade') {
                const freshTrades = await getTradeRecords(userId);
                userTrades.splice(0, userTrades.length, ...freshTrades);
                const freshExisting = countWindowBuysForTicker(userTrades, marketTicker);
                const recheck = evaluateSpikeFadeEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.spikeFade,
                  twapAdminEnabled: featureFlags.twapLock,
                  openPositions: userTrades.filter(
                    (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
                  ).length,
                  tradesToday,
                  assetTradesInWindow: freshExisting,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenOtherThanSpikeFade(userTrades, marketTicker),
                  lastMinuteOwnsNewBuys,
                  skipThinBid: spikeThin,
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    spikeFadePickedSide(leanForGate, cfg),
                    spikeThin
                  ),
                });
                if (!recheck.ok || !recheck.price || !recheck.count) {
                  lastTradeAction[asset] = skippedTradeAction(
                    recheck.skip_reason || 'window_locked',
                    tickIso
                  );
                  continue;
                }
              }
              if (entryPath === 'step_buy') {
                const freshTrades = await getTradeRecords(userId);
                userTrades.splice(0, userTrades.length, ...freshTrades);
                stepBuyLots = stepBuyLotsForTicker(userTrades, marketTicker);
                const freshExisting = countWindowBuysForTicker(userTrades, marketTicker);
                const recheck = evaluateStepBuyEnter({
                  lean: leanForGate,
                  cfg,
                  adminEnabled: featureFlags.stepBuy,
                  twapAdminEnabled: featureFlags.twapLock,
                  now,
                  openPositions: userTrades.filter(
                    (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
                  ).length,
                  tradesToday,
                  assetTradesInWindow: freshExisting,
                  stepBuyLots: stepBuyLots.count,
                  lastLotAt: stepBuyLots.lastAt,
                  lastFill: stepBuyLots.lastFill,
                  heldSide: stepBuyLots.heldSide,
                  dailyPnlUsd,
                  hasOpenOnTicker: tickerHasOpenOtherThanStepBuy(userTrades, marketTicker),
                  lastMinuteOwnsNewBuys,
                  skipThinBid: stepThin,
                  bidSize: await cashOutBestBidSize(
                    marketTicker,
                    stepBuyLots.heldSide || lean.decision,
                    stepThin
                  ),
                });
                if (!recheck.ok || !recheck.price || !recheck.count) {
                  lastTradeAction[asset] = skippedTradeAction(
                    recheck.skip_reason || 'window_locked',
                    tickIso
                  );
                  continue;
                }
              }
              if (entryPath === 'cap_lock') {
                const capEnter = gate as CapLockEnterResult;
                const placed = await placeCapLockPair({
                  userId,
                  asset,
                  marketTicker,
                  client,
                  enter: capEnter,
                  userTrades,
                  cfg,
                  userTokens,
                  now,
                  tickIso,
                  absGap,
                  liveSpot: lean.live,
                  strike: lean.strike,
                  lastTradeAction,
                  dryRun: !isLive,
                  live: isLive,
                  lean,
                });
                tradesCount += placed.okLegs;
                for (const doc of placed.filledDocs) {
                  if (doc.dryRun) continue;
                  openPositions += 1;
                  tradesToday += 1;
                  tradesTodayList.push(doc);
                }
                continue;
              }
              const pairEnter = gate as PairLockEnterResult;
              const atomicHedge =
                entryPath === 'pair_lock' &&
                pairEnter.atomic === true &&
                pairEnter.hedge?.ok &&
                Boolean(pairEnter.hedge.price) &&
                Boolean(pairEnter.hedge.count);
              if (atomicHedge && pairEnter.hedge) {
                pairLockAtomicPlaced = true;
                const placed = await placePairLockAtomicFirstPair({
                  userId,
                  asset,
                  marketTicker,
                  client,
                  runner: pairEnter,
                  hedge: pairEnter.hedge,
                  userTrades,
                  cfg,
                  userTokens,
                  now,
                  tickIso,
                  absGap,
                  liveSpot: lean.live,
                  strike: lean.strike,
                  lastTradeAction,
                  dryRun: !isLive,
                  live: isLive,
                });
                pairLockRunnerFilled = placed.runnerFilled;
                tradesCount += placed.okLegs;
                for (const doc of placed.filledDocs) {
                  if (doc.dryRun) continue;
                  openPositions += 1;
                  tradesToday += 1;
                  tradesTodayList.push(doc);
                }
              } else {
              const quotedPay = Number(gate.pay_price) || 0;
              const pairish = entryPath === 'pair_lock';
              const buyGate = liveIocBuyGate(
                gate,
                marketTicker,
                lean,
                pairish
                  ? quotedPay
                  : entryPath === 'buffer_run'
                    ? Number(cfg.risk?.buffer_run_ask_max_usd || quotedPay)
                    : Number(cfg.risk?.max_entry_ask_usd || quotedPay),
                !pairish
              );
              if (!buyGate.ok || !buyGate.price || !buyGate.count) {
                lastTradeAction[asset] = skippedTradeAction(buyGate.skip_reason || 'ask_moved', tickIso);
              } else {
              const placeRes = await client.placeOrder({
                ticker: marketTicker,
                side: buyGate.side || 'bid',
                count: buyGate.count,
                price: buyGate.price,
                time_in_force: buyGate.time_in_force || gate.time_in_force,
                dry_run: !isLive,
              });

            if (placeResultShouldPersist(placeRes)) {
              tradesCount++;
              const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              const tif = placeRes.payload?.time_in_force || buyGate.time_in_force || gate.time_in_force;
              const gtcResting = isGoodTillCanceled(tif);
              const { fillCount, filled } = resolvedPlaceFillCount({
                dryRun: Boolean(placeRes.dry_run) || !isLive,
                fillCount: placeRes.fill_count,
                intendedCount: buyGate.count,
              });
              const payPrice = Number(buyGate.pay_price ?? 0) || null;
              const accepted = filled || (gtcResting && Boolean(placeRes.order_id));

              const tradeDoc: TradeRecordDoc = {
                tradeId,
                userId,
                ticker: marketTicker,
                asset: lean.asset,
                decision: placeDecision,
                count: filled ? String(fillCount) : String(buyGate.count || 0),
                price: buyGate.price,
                notionalUsd: filled && payPrice
                  ? Math.round(fillCount * payPrice * 100) / 100
                  : buyGate.notional_usd || 0,
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
                pairLockAtomic:
                  entryPath === 'pair_lock' && (gate as PairLockEnterResult).atomic === true ? true : undefined,
                stepLotIndex:
                  entryPath === 'step_buy' && filled
                    ? nextStepBuyLotIndex(userTrades, marketTicker)
                    : undefined,
              };

              await saveTradeRecord(userId, tradeDoc);
              userTrades.unshift(tradeDoc);
              if (filled && !tradeDoc.dryRun) {
                openPositions += 1;
                tradesToday += 1;
                tradesTodayList.push(tradeDoc);
                if (entryPath === 'pair_lock') pairLockRunnerFilled = true;
              }
              await writeAuditLog(userId, 'TRADE_TRIGGERED', {
                tradeId,
                ticker: marketTicker,
                asset: lean.asset,
                decision: placeDecision,
                mode: isLive ? 'live' : 'demo',
              });

              const priceVal = typeof buyGate.price === 'number' ? buyGate.price : parseFloat(String(buyGate.price || 0));
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
                const fillBody = `${buyGate.count} ctr @ $${priceVal.toFixed(2)} · Cost $${(buyGate.notional_usd || 0).toFixed(2)}`;
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
                    price: priceVal,
                    count: buyGate.count,
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
              }
              }
            } finally {
              await releasePlaceLock({ userId, ticker: marketTicker, requestId: placeRequestId });
            }
            const pairLockHedge = (gate as PairLockEnterResult).hedge;
            if (
              !pairLockAtomicPlaced &&
              pairLockRunnerFilled &&
              (gate as PairLockEnterResult).atomic &&
              pairLockHedge?.ok &&
              pairLockHedge.price &&
              pairLockHedge.count
            ) {
              const hedgeReq = `plt_${userId}_${marketTicker}_${Date.now()}`.slice(0, 64);
              const hedgeLock = await tryAcquirePlaceLock({
                userId,
                ticker: marketTicker,
                cap: Math.max(2, windowBuyCap(cfg.risk) + 1),
                requestId: hedgeReq,
                existingBuys: 1,
              });
              if (hedgeLock.ok) {
                try {
                  const buyHedge = pairLockIocBuyGate(pairLockHedge, marketTicker, lean);
                  if (!buyHedge.ok || !buyHedge.price || !buyHedge.count) {
                    lastTradeAction[asset] = skippedTradeAction(buyHedge.skip_reason || 'ask_moved', tickIso);
                  } else {
                  const hedgePlace = await client.placeOrder({
                    ticker: marketTicker,
                    side: buyHedge.side || 'bid',
                    count: buyHedge.count,
                    price: buyHedge.price,
                    time_in_force: 'immediate_or_cancel',
                    dry_run: !isLive,
                  });
                  const hedgeFill = resolvedPlaceFillCount({
                    dryRun: Boolean(hedgePlace.dry_run) || !isLive,
                    fillCount: hedgePlace.fill_count,
                    intendedCount: buyHedge.count,
                  });
                  const hedgePay = Number(buyHedge.pay_price ?? 0) || null;
                  const hedgeDecision = buyHedge.decision === 'NO' ? 'NO' : 'YES';
                  const hedgeTradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                  const hedgeDoc: TradeRecordDoc = {
                    tradeId: hedgeTradeId,
                    userId,
                    ticker: marketTicker,
                    asset: lean.asset,
                    decision: hedgeDecision,
                    count: hedgeFill.filled ? String(hedgeFill.fillCount) : String(buyHedge.count || 0),
                    price: String(buyHedge.price),
                    notionalUsd:
                      hedgeFill.filled && hedgePay
                        ? Math.round(hedgeFill.fillCount * hedgePay * 100) / 100
                        : buyHedge.notional_usd || 0,
                    dryRun: !isLive,
                    status: hedgeFill.filled ? 'FILLED' : 'CANCELLED',
                    leanDiff: absGap,
                    liveSpot: lean.live,
                    strike: lean.strike,
                    executedAt: now.toISOString(),
                    orderId: hedgePlace.order_id ?? null,
                    payPrice: hedgePay,
                    fillCount: hedgeFill.filled ? hedgeFill.fillCount : 0,
                    outcome: hedgeFill.filled ? 'pending' : 'miss',
                    pnlUsd: null,
                    entryPath: 'pair_lock_hedge',
                  };
                  await saveTradeRecord(userId, hedgeDoc);
                  userTrades.unshift(hedgeDoc);
                  if (hedgeFill.filled && !hedgeDoc.dryRun) {
                    openPositions += 1;
                    tradesToday += 1;
                    tradesTodayList.push(hedgeDoc);
                    lastTradeAction[asset] = {
                      status: 'placed',
                      detail: `placed Pair lock hedge ${hedgeDecision} · ${hedgeFill.fillCount} @ $${Number(buyHedge.price).toFixed(2)}`,
                      at: tickIso,
                    };
                  }
                  }
                } finally {
                  await releasePlaceLock({ userId, ticker: marketTicker, requestId: hedgeReq });
                }
              }
            }
          }

          if (leanAlertsDirty) {
            leanAlertMemory.set(userId, leanAlertsSent);
          }
          applyDumpWatchMaps(userId, {
            trades: userTrades,
            homeAutoExitWatch: homeAutoExitWatchNeeded(cfg.risk),
            killSwitch: user.state === 'KILL_SWITCH',
            now,
          });
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
              const watchSec = lastMinuteTimingFromRisk(cfg.risk).watchSec;
              return Boolean(close && isLastMinuteWatchWindow(now, close, watchSec));
            });
            if (watchAssets.length) lastMinuteWatchUsers.set(userId, watchAssets);
            else lastMinuteWatchUsers.delete(userId);
          } else {
            lastMinuteWatchUsers.delete(userId);
          }
          if (
            featureFlags.stepBuy &&
            cfg.auto_trade_enabled &&
            user.state === 'ARMED' &&
            Boolean(cfg.risk?.step_buy_enabled)
          ) {
            const watchAssets = assets.filter((a) => {
              if (cfg.assets_enabled?.[a] === false) return false;
              if (
                !isStepBuyEnterPath({
                  adminEnabled: true,
                  userEnabled: true,
                  assetEnabled: true,
                  asset: a,
                  assets: cfg.risk?.step_buy_assets,
                })
              ) {
                return false;
              }
              if (
                stepBuyTwapOwns({
                  twapAdminEnabled: featureFlags.twapLock,
                  twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                  twapAssets: cfg.risk?.twap_lock_assets,
                  asset: a,
                })
              ) {
                return false;
              }
              const row = sharedLeans[a];
              const close = row ? resolveStepBuyCloseUtc(row, now) : null;
              if (!close || stepBuySecondsLeft(now, close) <= 0) return false;
              const ticker = String(row?.market_ticker || '').trim();
              if (ticker && stepBuyLotsForTicker(userTrades, ticker).count > 0) return true;
              return isStepBuyStartWindow({
                now,
                minutesElapsed: row?.minutes_elapsed,
                startMinutes: cfg.risk?.step_buy_start_minutes,
                closeUtc: close,
              });
            });
            if (watchAssets.length) stepBuyWatchUsers.set(userId, watchAssets);
            else stepBuyWatchUsers.delete(userId);
          } else {
            stepBuyWatchUsers.delete(userId);
          }
          if (
            featureFlags.spikeFade &&
            cfg.auto_trade_enabled &&
            user.state === 'ARMED' &&
            Boolean(cfg.risk?.spike_fade_enabled)
          ) {
            const watchAssets = assets.filter((a) => {
              if (cfg.assets_enabled?.[a] === false) return false;
              if (
                !isSpikeFadeEnterPath({
                  adminEnabled: true,
                  userEnabled: true,
                  assetEnabled: true,
                  asset: a,
                  assets: cfg.risk?.spike_fade_assets,
                })
              ) {
                return false;
              }
              if (
                spikeFadeTwapOwns({
                  twapAdminEnabled: featureFlags.twapLock,
                  twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                  twapAssets: cfg.risk?.twap_lock_assets,
                  asset: a,
                })
              ) {
                return false;
              }
              const row = sharedLeans[a];
              const close = row ? resolveTwapCloseUtc(row, now) : null;
              if (!close) return false;
              const ticker = String(row?.market_ticker || '').trim();
              if (ticker && tickerHasOpenSpikeFade(userTrades, ticker)) return true;
              return isSpikeFadeEnterWindow({
                minutesElapsed: row?.minutes_elapsed,
                startMinutes: cfg.risk?.spike_fade_start_minutes,
                untilMinutes: cfg.risk?.spike_fade_until_minutes,
              });
            });
            if (watchAssets.length) spikeFadeWatchUsers.set(userId, watchAssets);
            else spikeFadeWatchUsers.delete(userId);
          } else {
            spikeFadeWatchUsers.delete(userId);
          }
          if (
            featureFlags.pairLock &&
            cfg.auto_trade_enabled &&
            user.state === 'ARMED' &&
            Boolean(cfg.risk?.pair_lock_enabled)
          ) {
            const watchAssets = assets.filter((a) => {
              if (cfg.assets_enabled?.[a] === false) return false;
              if (
                !isPairLockEnterPath({
                  adminEnabled: true,
                  userEnabled: true,
                  assetEnabled: true,
                  asset: a,
                  assets: cfg.risk?.pair_lock_assets,
                })
              ) {
                return false;
              }
              if (
                pairLockTwapOwns({
                  twapAdminEnabled: featureFlags.twapLock,
                  twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                  twapAssets: cfg.risk?.twap_lock_assets,
                  asset: a,
                })
              ) {
                return false;
              }
              const row = sharedLeans[a];
              const close = row ? resolveTwapCloseUtc(row, now) : null;
              if (!close) return false;
              const ticker = String(row?.market_ticker || '').trim();
              return shouldWatchPairLockTicker({
                lots: pairLockLotsForTicker(userTrades, ticker),
                addPairs: cfg.risk?.pair_lock_add_pairs,
                lotCount: cfg.risk?.pair_lock_lot_count,
                minutesElapsed: row?.minutes_elapsed,
                startMinutes: cfg.risk?.pair_lock_start_minutes,
                untilMinutes: cfg.risk?.pair_lock_until_minutes,
              });
            });
            if (watchAssets.length) pairLockWatchUsers.set(userId, watchAssets);
            else pairLockWatchUsers.delete(userId);
          } else {
            pairLockWatchUsers.delete(userId);
          }
          if (
            featureFlags.capLock &&
            cfg.auto_trade_enabled &&
            user.state === 'ARMED' &&
            Boolean(cfg.risk?.cap_lock_enabled)
          ) {
            const watchAssets = assets.filter((a) => {
              if (cfg.assets_enabled?.[a] === false) return false;
              if (
                !isCapLockEnterPath({
                  adminEnabled: true,
                  userEnabled: true,
                  assetEnabled: true,
                  asset: a,
                  assets: cfg.risk?.cap_lock_assets,
                })
              ) {
                return false;
              }
              const row = sharedLeans[a];
              const ticker = String(row?.market_ticker || '').trim();
              if (!ticker) return false;
              return shouldWatchCapLockLots(capLockLotsForTicker(userTrades, ticker));
            });
            if (watchAssets.length) capLockWatchUsers.set(userId, watchAssets);
            else capLockWatchUsers.delete(userId);
          } else {
            capLockWatchUsers.delete(userId);
          }
          {
            const openBuffer = assets.filter((a) => {
              const ticker = String(sharedLeans[a]?.market_ticker || '').trim();
              return ticker ? tickerHasOpenBufferRun(userTrades, ticker) : false;
            });
            const enterBuffer =
              featureFlags.bufferRun &&
              cfg.auto_trade_enabled &&
              user.state === 'ARMED' &&
              Boolean(cfg.risk?.buffer_run_enabled)
                ? assets.filter((a) => {
                    if (cfg.assets_enabled?.[a] === false) return false;
                    if (
                      !isBufferRunEnterPath({
                        adminEnabled: true,
                        userEnabled: true,
                        assetEnabled: true,
                        asset: a,
                        assets: cfg.risk?.buffer_run_assets,
                      })
                    ) {
                      return false;
                    }
                    if (
                      bufferRunTwapOwns({
                        twapAdminEnabled: featureFlags.twapLock,
                        twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                        twapAssets: cfg.risk?.twap_lock_assets,
                        asset: a,
                      })
                    ) {
                      return false;
                    }
                    const row = sharedLeans[a];
                    const close = row ? resolveTwapCloseUtc(row, now) : null;
                    if (!close) return false;
                    const ticker = String(row?.market_ticker || '').trim();
                    if (ticker && tickerHasOpenBufferRun(userTrades, ticker)) return true;
                    return isBufferRunEnterWindow({
                      minutesElapsed: row?.minutes_elapsed,
                      minutesLeft: row?.minutes_left,
                      enterElapsedMinutes: cfg.risk?.buffer_run_enter_elapsed_minutes,
                      enterLeftMinutes: cfg.risk?.buffer_run_enter_left_minutes,
                      flattenMinutes: cfg.risk?.buffer_run_flatten_minutes,
                    });
                  })
                : [];
            const watchAssets = [...new Set([...openBuffer, ...enterBuffer])];
            if (watchAssets.length) bufferRunWatchUsers.set(userId, watchAssets);
            else bufferRunWatchUsers.delete(userId);
          }
          {
            const openCheap = assets.filter((a) => {
              const ticker = String(sharedLeans[a]?.market_ticker || '').trim();
              return ticker ? tickerHasOpenCheapLoop(userTrades, ticker) : false;
            });
            const enterCheap =
              featureFlags.cheapLoop &&
              cfg.auto_trade_enabled &&
              user.state === 'ARMED' &&
              Boolean(cfg.risk?.cheap_loop_enabled)
                ? assets.filter((a) => {
                    if (cfg.assets_enabled?.[a] === false) return false;
                    if (
                      !isCheapLoopEnterPath({
                        adminEnabled: true,
                        userEnabled: true,
                        assetEnabled: true,
                        asset: a,
                        assets: cfg.risk?.cheap_loop_assets,
                      })
                    ) {
                      return false;
                    }
                    if (
                      cheapLoopTwapOwns({
                        twapAdminEnabled: featureFlags.twapLock,
                        twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
                        twapAssets: cfg.risk?.twap_lock_assets,
                        asset: a,
                      })
                    ) {
                      return false;
                    }
                    const row = sharedLeans[a];
                    const close = row ? resolveTwapCloseUtc(row, now) : null;
                    if (!close) return false;
                    const ticker = String(row?.market_ticker || '').trim();
                    if (ticker && tickerHasOpenCheapLoop(userTrades, ticker)) return true;
                    if (
                      ticker &&
                      cheapLoopCooldownOwnsTicker({
                        adminEnabled: true,
                        userEnabled: true,
                        assetEnabled: true,
                        asset: a,
                        assets: cfg.risk?.cheap_loop_assets,
                        trades: userTrades,
                        marketTicker: ticker,
                        cooldownMinutes: cfg.risk?.cheap_loop_cooldown_minutes,
                        cycles: cfg.risk?.cheap_loop_cycles,
                        flattenMinutes: cfg.risk?.cheap_loop_flatten_minutes,
                        lean: row || {},
                        now,
                      })
                    ) {
                      return true;
                    }
                    return isCheapLoopEnterWindow({
                      minutesElapsed: row?.minutes_elapsed,
                      minutesLeft: row?.minutes_left,
                      startMinutes: cfg.risk?.cheap_loop_start_minutes,
                      flattenMinutes: cfg.risk?.cheap_loop_flatten_minutes,
                    });
                  })
                : [];
            const watchAssets = [...new Set([...openCheap, ...enterCheap])];
            if (watchAssets.length) cheapLoopWatchUsers.set(userId, watchAssets);
            else cheapLoopWatchUsers.delete(userId);
          }
          {
            const openHourly = openCheapLoopHourlyAssets(userTrades);
            const enterHourly =
              featureFlags.cheapLoop &&
              cfg.auto_trade_enabled &&
              user.state === 'ARMED' &&
              Boolean(cfg.risk?.cheap_loop_hourly_enabled)
                ? assets.filter((a) =>
                    isCheapLoopHourlyEnterPath({
                      adminEnabled: true,
                      userEnabled: true,
                      assetEnabled: cfg.assets_enabled?.[a] !== false,
                      asset: a,
                      assets: cfg.risk?.cheap_loop_hourly_assets,
                    })
                  )
                : [];
            const hourlyWatch = [...new Set([...openHourly, ...enterHourly])];
            if (hourlyWatch.length) cheapLoopHourlyWatchUsers.set(userId, hourlyWatch);
            else cheapLoopHourlyWatchUsers.delete(userId);
            for (const asset of openHourly) {
              const ticker = openCheapLoopHourlyTickerForAsset(userTrades, asset);
              if (ticker) cheapLoopHourlyQuoteTickers.add(ticker);
            }
          }
          {
            const openWeekly = openCheapLoopWeeklyAssets(userTrades);
            const enterWeekly =
              featureFlags.cheapLoop &&
              cfg.auto_trade_enabled &&
              user.state === 'ARMED' &&
              Boolean(cfg.risk?.cheap_loop_weekly_enabled)
                ? assets.filter((a) =>
                    isCheapLoopWeeklyEnterPath({
                      adminEnabled: true,
                      userEnabled: true,
                      assetEnabled: cfg.assets_enabled?.[a] !== false,
                      asset: a,
                      assets: cfg.risk?.cheap_loop_weekly_assets,
                    })
                  )
                : [];
            const weeklyWatch = [...new Set([...openWeekly, ...enterWeekly])];
            if (weeklyWatch.length) cheapLoopWeeklyWatchUsers.set(userId, weeklyWatch);
            else cheapLoopWeeklyWatchUsers.delete(userId);
            for (const asset of openWeekly) {
              const ticker = openCheapLoopWeeklyTickerForAsset(userTrades, asset);
              if (ticker) cheapLoopWeeklyQuoteTickers.add(ticker);
            }
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
  await flushStepBuyWatcher(now, sharedLeans);
  await flushSpikeFadeWatcher(now, sharedLeans);
  await flushPairLockWatcher(now, sharedLeans);
  await flushCheapLoopWatcher(now, sharedLeans);
  return { timestamp: now.toISOString(), activeUserCount: activeUsers.length, results };
}

/** Last-minute 1s sample + Yes enter only. No exits — hold to $1. */
export async function runTwapLockWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const now = snapshot?.now ?? new Date();
  if (twapLockWatchUsers.size === 0) {
    await flushTwapLockWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
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
  if (!snapshot) {
    const platformCreds = await getCfbApiCredentials();
    let sharedKalshi: KalshiClient | null = null;
    if (!platformCreds) {
      for (const userId of twapLockWatchUsers.keys()) {
        const secret = await getUserSecret(userId);
        if (secret?.privateKeyPem && secret.keyId) {
          sharedKalshi = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
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
  }

  const sharedLeans = await sharedLeansForWatch(watchAssets, now, snapshot);

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
          lastTradeAction[asset] = skippedTradeAction(
            skipReasonForWindowCap(userTrades, marketTicker),
            tickIso
          );
          continue;
        }
        const quoted = await overlayWatchLean(lean, snapshot);
        let yesAsk = quoted.yes_ask;
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
          no_ask: quoted.no_ask ?? undefined,
          yes_bid: quoted.yes_bid ?? undefined,
          no_bid: quoted.no_bid ?? undefined,
          timeseries: lean.timeseries,
          open_utc: lean.open_utc,
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
        const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
        try {
          const recheck = evaluateTwapLockEnter({
            lean: leanForGate,
            cfg,
            adminEnabled: featureFlags.twapLock,
            prints: cfbRtiBuffer.prints(asset),
            now: new Date(),
            openPositions,
            tradesToday,
            assetTradesInWindow: existingBuys,
            dailyPnlUsd,
            hasOpenOnTicker: tickerHasOpenFill(userTrades, marketTicker),
            skipThinBid,
            bidSize: await cashOutBestBidSize(marketTicker, 'YES', skipThinBid),
          });
          if (!recheck.ok || !recheck.price || !recheck.count) {
            lastTradeAction[asset] = skippedTradeAction(recheck.skip_reason || 'twap_lock_feed', tickIso);
            continue;
          }
          const quotedPay = Number(recheck.pay_price) || 0;
          const liveGate = liveIocBuyGate(
            recheck,
            marketTicker,
            lean,
            Number(cfg.risk?.twap_lock_max_ask_usd || quotedPay),
            true
          );
          if (!liveGate.ok || !liveGate.price || !liveGate.count) {
            lastTradeAction[asset] = skippedTradeAction(liveGate.skip_reason || 'ask_moved', tickIso);
            continue;
          }
          const liveCount = String(liveGate.count);
          const livePrice = String(liveGate.price);
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: liveGate.side || 'bid',
            count: liveCount,
            price: livePrice,
            time_in_force: liveGate.time_in_force,
            dry_run: false,
          });
          if (!placeResultShouldPersist(placeRes)) {
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
            intendedCount: liveCount,
          });
          const payPrice = Number(liveGate.pay_price ?? 0) || null;
          const accepted = filled || Boolean(placeRes.order_id && isGoodTillCanceled(liveGate.time_in_force));
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: 'YES',
            count: filled ? String(fillCount) : liveCount,
            price: livePrice,
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : liveGate.notional_usd || 0,
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
            typeof liveGate.price === 'number' ? liveGate.price : parseFloat(String(liveGate.price || 0));
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
              body: `${liveCount} ctr @ $${priceVal.toFixed(2)} · Cost $${(liveGate.notional_usd || 0).toFixed(2)}`,
              cfg,
              tokens: userTokens,
              collapseId: fillCollapseId(userId, tradeId),
              asset: lean.asset,
              ticker: marketTicker,
              tradeId,
              decision: 'YES',
              at: now.toISOString(),
            });
          } else if (!accepted) {
            await emitCloudAlert({
              userId,
              alertId: missAlertId(tradeId),
              kind: 'ioc_miss',
              title: iocMissAlertTitle('twap_lock'),
              body: iocMissAlertBody({
                asset,
                decision: 'YES',
                entryPath: 'twap_lock',
                price: priceVal,
                count: liveCount,
              }),
              cfg,
              tokens: userTokens,
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
export async function runLastMinuteWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const now = snapshot?.now ?? new Date();
  if (lastMinuteWatchUsers.size === 0) {
    await flushLastMinuteWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
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
  const sharedLeans = await sharedLeansForWatch(watchAssets, now, snapshot);

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
        const lastMinuteTimes = lastMinuteTimingFromRisk(cfg.risk);
        if (!closeUtc || !isLastMinuteWatchWindow(now, closeUtc, lastMinuteTimes.watchSec)) continue;
        still.push(asset);
        if (
          lastMinuteTwapOwns({
            twapAdminEnabled: featureFlags.twapLock,
            twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
            twapAssets: cfg.risk?.twap_lock_assets,
            asset,
          })
        ) {
          lastTradeAction[asset] = skippedTradeAction('last_minute_twap_owns', tickIso);
          continue;
        }
        watched += 1;
        const marketTicker = lean.market_ticker;
        const windowCap = windowBuyCap(cfg.risk);
        const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
        let lastMinuteClips = lastMinuteClipsForTicker(userTrades, marketTicker);
        if (lastMinuteClips.count <= 0 && existingBuys >= windowCap) {
          lastTradeAction[asset] = skippedTradeAction(
            skipReasonForWindowCap(userTrades, marketTicker),
            tickIso
          );
          continue;
        }
        const quoted = await overlayWatchLean(lean, snapshot);
        let yesAsk = quoted.yes_ask;
        let noAsk = quoted.no_ask;
        if (
          normalizeLastMinuteFlipSellUsd(cfg.risk?.last_minute_flip_sell_usd) > 0 &&
          pendingLastMinuteTradesForMarket(userTrades, marketTicker).length > 0
        ) {
          const secretForFlip = await getUserSecret(userId);
          await runLastMinuteFlipIfNeeded({
            userId,
            asset,
            marketTicker,
            cfg,
            now,
            userTrades,
            lean: {
              phase: lean.phase === 'live' ? 'live' : 'ended',
              yes_bid: quoted.yes_bid,
              yes_ask: yesAsk,
              no_bid: quoted.no_bid,
              no_ask: noAsk,
            },
            userTokens,
            lastTradeAction,
            tickIso,
            secret: secretForFlip,
          });
          lastMinuteClips = lastMinuteClipsForTicker(userTrades, marketTicker);
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
          yes_bid: quoted.yes_bid ?? undefined,
          no_bid: quoted.no_bid ?? undefined,
          timeseries: lean.timeseries,
          open_utc: lean.open_utc,
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
          lastMinuteClips: lastMinuteClips.count,
          lastClipAt: lastMinuteClips.lastAt,
          dailyPnlUsd,
          hasOpenOnTicker: tickerHasOpenOtherThanLastMinute(userTrades, marketTicker),
          skipThinBid,
          bidSize: await cashOutBestBidSize(marketTicker, pickedSide, skipThinBid),
        });
        if (!gate.ok || !gate.price || !gate.count) {
          if (
            gate.skip_reason === 'last_minute_not_last_minute' ||
            gate.skip_reason === 'last_minute_ladder_wait'
          ) {
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
          cap: lastMinuteClips.count > 0 ? lastMinuteTimes.maxClips : windowCap,
          requestId: placeRequestId,
          existingBuys: lastMinuteClips.count > 0 ? lastMinuteClips.count : existingBuys,
        });
        if (!claimed.ok) {
          lastTradeAction[asset] = skippedTradeAction(claimed.reason, tickIso);
          continue;
        }
        const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
        const placeDecision = gate.decision || pickedSide;
        try {
          const quotedPay = Number(gate.pay_price) || 0;
          const buyGate = liveIocBuyGate(
            gate,
            marketTicker,
            lean,
            Number(cfg.risk?.last_minute_max_ask_usd || quotedPay),
            true
          );
          if (!buyGate.ok || !buyGate.price || !buyGate.count) {
            lastTradeAction[asset] = skippedTradeAction(buyGate.skip_reason || 'ask_moved', tickIso);
            continue;
          }
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: buyGate.side || 'bid',
            count: buyGate.count,
            price: buyGate.price,
            time_in_force: buyGate.time_in_force || gate.time_in_force,
            dry_run: false,
          });
          if (!placeResultShouldPersist(placeRes)) {
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
            intendedCount: buyGate.count,
          });
          const payPrice = Number(buyGate.pay_price ?? 0) || null;
          const accepted = filled || Boolean(placeRes.order_id && isGoodTillCanceled(buyGate.time_in_force || gate.time_in_force));
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision,
            count: filled ? String(fillCount) : String(buyGate.count || 0),
            price: buyGate.price,
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : buyGate.notional_usd || 0,
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
            typeof buyGate.price === 'number' ? buyGate.price : parseFloat(String(buyGate.price || 0));
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
              body: `${buyGate.count} ctr @ $${priceVal.toFixed(2)} · Cost $${(buyGate.notional_usd || 0).toFixed(2)}`,
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
                price: priceVal,
                count: buyGate.count,
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

export async function runStepBuyWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const now = snapshot?.now ?? new Date();
  if (stepBuyWatchUsers.size === 0) {
    await flushStepBuyWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const sysConfig = await getSystemConfig();
  const featureFlags = normalizeFeatureFlags(sysConfig?.featureFlags);
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }
  if (!featureFlags.stepBuy) {
    stepBuyWatchUsers.clear();
    await flushStepBuyWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const watchAssets = [...new Set([...stepBuyWatchUsers.values()].flat())] as AssetKey[];
  const sharedLeans = await sharedLeansForWatch(watchAssets, now, snapshot);
  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;
  for (const [userId, userAssets] of [...stepBuyWatchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      stepBuyWatchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      if (!cfg.auto_trade_enabled || user.state !== 'ARMED' || !cfg.risk?.step_buy_enabled) {
        stepBuyWatchUsers.delete(userId);
        continue;
      }
      const userTrades = await getTradeRecords(userId);
      const tradesTodayList = liveCloudTradesToday(userTrades, now);
      let tradesToday = tradesTodayList.length;
      const dailyPnlUsd = cloudDailyRealizedPnl(tradesTodayList);
      let openPositions = userTrades.filter(
        (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
      ).length;
      const lastTradeAction = copyLastTradeActions(user);
      const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
        (t, i, arr) => t && arr.indexOf(t) === i
      );
      const tickIso = now.toISOString();
      const still: string[] = [];
      for (const asset of userAssets) {
        const lean = sharedLeans[asset];
        if (!lean?.market_ticker) continue;
        const closeUtc = resolveStepBuyCloseUtc(lean, now);
        if (!closeUtc || stepBuySecondsLeft(now, closeUtc) <= 0) continue;
        if (
          stepBuyTwapOwns({
            twapAdminEnabled: featureFlags.twapLock,
            twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
            twapAssets: cfg.risk?.twap_lock_assets,
            asset,
          })
        ) {
          lastTradeAction[asset] = skippedTradeAction('step_buy_twap_owns', tickIso);
          continue;
        }
        still.push(asset);
        watched += 1;
        const quoted = await overlayWatchLean(lean, snapshot);
        const marketTicker = quoted.market_ticker;
        let yesAsk = quoted.yes_ask;
        let noAsk = quoted.no_ask;
        let stepBuyLots = stepBuyLotsForTicker(userTrades, marketTicker);
        if (stepBuyLots.count > 0) {
          const secret = await getUserSecret(userId);
          if (secret?.privateKeyPem && secret.keyId) {
            const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
            const stopRes = await runCloudStepBuyStops({
              userId,
              asset,
              ticker: marketTicker,
              lean: {
                phase: lean.phase === 'live' ? 'live' : 'ended',
                decision: lean.decision,
                abs_gap: Number.isFinite(Number(lean.abs_gap))
                  ? Number(lean.abs_gap)
                  : Math.abs((lean.live || 0) - (lean.strike || 0)),
                yes_bid: quoted.yes_bid,
                yes_ask: yesAsk,
                no_bid: quoted.no_bid,
                no_ask: noAsk,
              },
              trades: userTrades,
              stopUsd: cfg.risk?.step_buy_stop_usd,
              cushionUsd: cfg.cushions?.[asset],
              cushionPct: cfg.risk?.step_buy_cushion_pct,
              sellIfThesisDies: normalizeStepBuySellIfThesisDies(cfg.risk?.step_buy_sell_if_thesis_dies),
              slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
              dryRun: false,
              now,
              place: (input) => client.placeOrder(input),
            });
            for (const alert of stopRes.alerts) {
              await emitCloudAlert({
                userId,
                alertId: protectAlertId(alert.tradeId),
                kind: 'protect_sell',
                title: alert.title,
                body: alert.body,
                cfg: cfg as never,
                tokens: userTokens,
                collapseId: protectCollapseId(userId, alert.tradeId),
                asset,
                ticker: marketTicker,
                tradeId: alert.tradeId,
                at: now.toISOString(),
              });
            }
            if (stopRes.exited > 0) {
              lastTradeAction[asset] = {
                status: 'placed',
                detail: `${stopRes.alerts[0]?.title || 'Step buy stop'} · sold ${stopRes.exited}`,
                at: tickIso,
              };
              stepBuyLots = stepBuyLotsForTicker(userTrades, marketTicker);
            }
          }
        }
        if (
          tickerHasOpenCheapLoop(userTrades, marketTicker) ||
          cheapLoopCooldownOwnsTicker({
            adminEnabled: featureFlags.cheapLoop,
            userEnabled: Boolean(cfg.risk?.cheap_loop_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.cheap_loop_assets,
            trades: userTrades,
            marketTicker,
            cooldownMinutes: cfg.risk?.cheap_loop_cooldown_minutes,
            cycles: cfg.risk?.cheap_loop_cycles,
            flattenMinutes: cfg.risk?.cheap_loop_flatten_minutes,
            lean,
            now,
          })
        ) {
          continue;
        }
        const lastMinuteTimes = lastMinuteTimingFromRisk(cfg.risk);
        const lastMinuteOwnsNewBuys =
          isLastMinuteEnterPath({
            adminEnabled: featureFlags.lastMinute,
            userEnabled: Boolean(cfg.risk?.last_minute_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.last_minute_assets,
          }) &&
          stepBuyLots.count <= 0 &&
          isLastMinuteWindow(now, closeUtc, lastMinuteTimes.enterSec, lastMinuteTimes.stopSec);
        const windowCap = windowBuyCap(cfg.risk);
        const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
        const skipThinBid = resolveSkipThinBid(cfg.risk, 'step_buy');
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
          yes_bid: quoted.yes_bid ?? undefined,
          no_bid: quoted.no_bid ?? undefined,
          timeseries: lean.timeseries,
          open_utc: lean.open_utc,
          close_utc: lean.close_utc,
        };
        const gate = evaluateStepBuyEnter({
          lean: leanForGate,
          cfg,
          adminEnabled: featureFlags.stepBuy,
          twapAdminEnabled: featureFlags.twapLock,
          now,
          openPositions,
          tradesToday,
          assetTradesInWindow: existingBuys,
          stepBuyLots: stepBuyLots.count,
          lastLotAt: stepBuyLots.lastAt,
          lastFill: stepBuyLots.lastFill,
          heldSide: stepBuyLots.heldSide,
          dailyPnlUsd,
          hasOpenOnTicker: tickerHasOpenOtherThanStepBuy(userTrades, marketTicker),
          lastMinuteOwnsNewBuys,
          skipThinBid,
          bidSize: await cashOutBestBidSize(marketTicker, stepBuyLots.heldSide || lean.decision, skipThinBid),
        });
        if (!gate.ok || !gate.price || !gate.count) continue;
        const secret = await getUserSecret(userId);
        if (!secret?.privateKeyPem || !secret.keyId) continue;
        const placeRequestId = `sb_${userId}_${marketTicker}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`.slice(0, 64);
        const claimed = await tryAcquirePlaceLock({
          userId,
          ticker: marketTicker,
          cap: stepBuyLots.count > 0 ? normalizeStepBuyMaxLots(cfg.risk?.step_buy_max_lots) : windowCap,
          requestId: placeRequestId,
          existingBuys: stepBuyLots.count > 0 ? stepBuyLots.count : existingBuys,
        });
        if (!claimed.ok) continue;
        const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
        const placeDecision = gate.decision || lean.decision;
        try {
          const freshTrades = await getTradeRecords(userId);
          userTrades.splice(0, userTrades.length, ...freshTrades);
          stepBuyLots = stepBuyLotsForTicker(userTrades, marketTicker);
          const freshExisting = countWindowBuysForTicker(userTrades, marketTicker);
          const recheck = evaluateStepBuyEnter({
            lean: leanForGate,
            cfg,
            adminEnabled: featureFlags.stepBuy,
            twapAdminEnabled: featureFlags.twapLock,
            now,
            openPositions: userTrades.filter(
              (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
            ).length,
            tradesToday,
            assetTradesInWindow: freshExisting,
            stepBuyLots: stepBuyLots.count,
            lastLotAt: stepBuyLots.lastAt,
            lastFill: stepBuyLots.lastFill,
            heldSide: stepBuyLots.heldSide,
            dailyPnlUsd,
            hasOpenOnTicker: tickerHasOpenOtherThanStepBuy(userTrades, marketTicker),
            lastMinuteOwnsNewBuys:
              lastMinuteOwnsNewBuys && stepBuyLots.count <= 0,
            skipThinBid,
            bidSize: await cashOutBestBidSize(
              marketTicker,
              stepBuyLots.heldSide || lean.decision,
              skipThinBid
            ),
          });
          if (!recheck.ok || !recheck.price || !recheck.count) continue;
          const quotedPay = Number(recheck.pay_price) || 0;
          const buyGate = liveIocBuyGate(
            recheck,
            marketTicker,
            lean,
            Number(cfg.risk?.step_buy_max_ask_usd || quotedPay),
            true
          );
          if (!buyGate.ok || !buyGate.price || !buyGate.count) {
            lastTradeAction[asset] = skippedTradeAction(buyGate.skip_reason || 'ask_moved', tickIso);
            continue;
          }
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: buyGate.side || 'bid',
            count: buyGate.count,
            price: buyGate.price,
            time_in_force: 'immediate_or_cancel',
            dry_run: false,
          });
          if (!placeResultShouldPersist(placeRes)) continue;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: buyGate.count,
          });
          const payPrice = Number(buyGate.pay_price ?? 0) || null;
          const accepted = filled || false;
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision === 'NO' ? 'NO' : 'YES',
            count: filled ? String(fillCount) : String(buyGate.count || 0),
            price: String(buyGate.price),
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : buyGate.notional_usd || 0,
            dryRun: false,
            status: filled ? 'FILLED' : 'CANCELLED',
            leanDiff: absGap,
            liveSpot: lean.live,
            strike: lean.strike,
            executedAt: now.toISOString(),
            orderId: placeRes.order_id ?? null,
            payPrice,
            fillCount: filled ? fillCount : 0,
            outcome: filled ? 'pending' : 'miss',
            pnlUsd: null,
            entryPath: 'step_buy',
            stepLotIndex: filled ? nextStepBuyLotIndex(userTrades, marketTicker) : undefined,
          };
          await saveTradeRecord(userId, tradeDoc);
          userTrades.unshift(tradeDoc);
          if (filled) {
            openPositions += 1;
            tradesToday += 1;
            tradesTodayList.push(tradeDoc);
          }
          const priceVal = typeof buyGate.price === 'number' ? buyGate.price : parseFloat(String(buyGate.price || 0));
          lastTradeAction[asset] = filled
            ? {
                status: 'placed',
                detail: `placed ${placeDecision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
                at: tickIso,
              }
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
                entryPath: 'step_buy',
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
              title: iocMissAlertTitle('step_buy'),
              body: iocMissAlertBody({
                asset,
                decision: String(placeDecision || ''),
                entryPath: 'step_buy',
                price: priceVal,
                count: gate.count,
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
      if (still.length) stepBuyWatchUsers.set(userId, still);
      else stepBuyWatchUsers.delete(userId);
      await upsertUserDoc(userId, { lastTradeAction, lastTickAt: now.toISOString() } as any);
    } catch (err: any) {
      noteTransientKalshiFailure(err);
    }
  }
  await flushStepBuyWatcher(now, sharedLeans);
  return { timestamp: now.toISOString(), watched };
}

export async function runSpikeFadeWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const now = snapshot?.now ?? new Date();
  if (spikeFadeWatchUsers.size === 0) {
    await flushSpikeFadeWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const sysConfig = await getSystemConfig();
  const featureFlags = normalizeFeatureFlags(sysConfig?.featureFlags);
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }
  if (!featureFlags.spikeFade) {
    spikeFadeWatchUsers.clear();
    await flushSpikeFadeWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const watchAssets = [...new Set([...spikeFadeWatchUsers.values()].flat())] as AssetKey[];
  const sharedLeans = await sharedLeansForWatch(watchAssets, now, snapshot);
  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;
  for (const [userId, userAssets] of [...spikeFadeWatchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      spikeFadeWatchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      if (!cfg.auto_trade_enabled || user.state !== 'ARMED' || !cfg.risk?.spike_fade_enabled) {
        spikeFadeWatchUsers.delete(userId);
        continue;
      }
      const userTrades = await getTradeRecords(userId);
      const tradesTodayList = liveCloudTradesToday(userTrades, now);
      let tradesToday = tradesTodayList.length;
      const dailyPnlUsd = cloudDailyRealizedPnl(tradesTodayList);
      let openPositions = userTrades.filter(
        (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
      ).length;
      const lastTradeAction = copyLastTradeActions(user);
      const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
        (t, i, arr) => t && arr.indexOf(t) === i
      );
      const tickIso = now.toISOString();
      const still: string[] = [];
      for (const asset of userAssets) {
        const lean = sharedLeans[asset];
        if (!lean?.market_ticker) continue;
        const closeUtc = resolveTwapCloseUtc(lean, now);
        if (!closeUtc) continue;
        if (
          spikeFadeTwapOwns({
            twapAdminEnabled: featureFlags.twapLock,
            twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
            twapAssets: cfg.risk?.twap_lock_assets,
            asset,
          })
        ) {
          lastTradeAction[asset] = skippedTradeAction('spike_fade_twap_owns', tickIso);
          continue;
        }
        still.push(asset);
        watched += 1;
        const quoted = await overlayWatchLean(lean, snapshot);
        const marketTicker = quoted.market_ticker;
        if (pendingSpikeFadeTradesForMarket(userTrades, marketTicker).length > 0) {
          const secret = await getUserSecret(userId);
          if (secret?.privateKeyPem && secret.keyId) {
            const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
            const heldSpike = pendingSpikeFadeTradesForMarket(userTrades, marketTicker)[0];
            const spikeSkipThin = resolveSkipThinBid(cfg.risk, 'spike_fade');
            const spikeRes = await runCloudSpikeFadeExits({
              userId,
              asset,
              ticker: marketTicker,
              lean: {
                phase: lean.phase === 'live' ? 'live' : 'ended',
                minutes_left: lean.minutes_left,
                minutes_remaining: lean.minutes_remaining,
                yes_bid: quoted.yes_bid,
                yes_ask: quoted.yes_ask,
                no_bid: quoted.no_bid,
                no_ask: quoted.no_ask,
              },
              trades: userTrades,
              takeAskUsd: cfg.risk?.spike_fade_take_ask_usd,
              stopAskUsd: cfg.risk?.spike_fade_stop_ask_usd,
              flattenMinutes: cfg.risk?.spike_fade_flatten_minutes,
              skipThinBid: spikeSkipThin,
              bidSize: await cashOutBestBidSize(
                marketTicker,
                heldSpike?.decision || lean.decision,
                spikeSkipThin
              ),
              slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
              dryRun: false,
              now,
              place: (input) => client.placeOrder(input),
            });
            for (const alert of spikeRes.alerts) {
              await emitCloudAlert({
                userId,
                alertId: protectAlertId(alert.tradeId),
                kind: 'protect_sell',
                title: alert.title,
                body: alert.body,
                cfg: cfg as never,
                tokens: userTokens,
                collapseId: `spk:${userId}:${alert.tradeId}`.slice(0, 64),
                asset,
                ticker: marketTicker,
                tradeId: alert.tradeId,
                at: now.toISOString(),
              });
            }
            if (spikeRes.exited > 0) {
              lastTradeAction[asset] = {
                status: 'placed',
                detail: `Spike fade · sold ${spikeRes.exited}`,
                at: tickIso,
              };
              openPositions = Math.max(0, openPositions - spikeRes.exited);
            }
          }
        }
        if (tickerHasOpenSpikeFade(userTrades, marketTicker)) continue;
        if (
          cheapLoopCooldownOwnsTicker({
            adminEnabled: featureFlags.cheapLoop,
            userEnabled: Boolean(cfg.risk?.cheap_loop_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.cheap_loop_assets,
            trades: userTrades,
            marketTicker,
            cooldownMinutes: cfg.risk?.cheap_loop_cooldown_minutes,
            cycles: cfg.risk?.cheap_loop_cycles,
            flattenMinutes: cfg.risk?.cheap_loop_flatten_minutes,
            lean,
            now,
          })
        ) {
          continue;
        }
        const lastMinuteTimes = lastMinuteTimingFromRisk(cfg.risk);
        const lastMinuteOwnsNewBuys =
          isLastMinuteEnterPath({
            adminEnabled: featureFlags.lastMinute,
            userEnabled: Boolean(cfg.risk?.last_minute_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.last_minute_assets,
          }) &&
          isLastMinuteWindow(now, closeUtc, lastMinuteTimes.enterSec, lastMinuteTimes.stopSec);
        const windowCap = windowBuyCap(cfg.risk);
        const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
        const skipThinBid = resolveSkipThinBid(cfg.risk, 'spike_fade');
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
          yes_ask: quoted.yes_ask ?? undefined,
          no_ask: quoted.no_ask ?? undefined,
          yes_bid: quoted.yes_bid ?? undefined,
          no_bid: quoted.no_bid ?? undefined,
          timeseries: lean.timeseries,
          open_utc: lean.open_utc,
          close_utc: lean.close_utc,
        };
        const gate = evaluateSpikeFadeEnter({
          lean: leanForGate,
          cfg,
          adminEnabled: featureFlags.spikeFade,
          twapAdminEnabled: featureFlags.twapLock,
          openPositions,
          tradesToday,
          assetTradesInWindow: existingBuys,
          dailyPnlUsd,
          hasOpenOnTicker: tickerHasOpenOtherThanSpikeFade(userTrades, marketTicker),
          lastMinuteOwnsNewBuys,
          skipThinBid,
          bidSize: await cashOutBestBidSize(
            marketTicker,
            spikeFadePickedSide(leanForGate, cfg),
            skipThinBid
          ),
        });
        if (!gate.ok || !gate.price || !gate.count) continue;
        const secret = await getUserSecret(userId);
        if (!secret?.privateKeyPem || !secret.keyId) continue;
        const placeRequestId = `sf_${userId}_${marketTicker}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`.slice(0, 64);
        const claimed = await tryAcquirePlaceLock({
          userId,
          ticker: marketTicker,
          cap: windowCap,
          requestId: placeRequestId,
          existingBuys,
        });
        if (!claimed.ok) continue;
        const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
        const placeDecision = gate.decision || lean.decision;
        try {
          const freshTrades = await getTradeRecords(userId);
          userTrades.splice(0, userTrades.length, ...freshTrades);
          const freshExisting = countWindowBuysForTicker(userTrades, marketTicker);
          const recheck = evaluateSpikeFadeEnter({
            lean: leanForGate,
            cfg,
            adminEnabled: featureFlags.spikeFade,
            twapAdminEnabled: featureFlags.twapLock,
            openPositions: userTrades.filter(
              (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
            ).length,
            tradesToday,
            assetTradesInWindow: freshExisting,
            dailyPnlUsd,
            hasOpenOnTicker: tickerHasOpenOtherThanSpikeFade(userTrades, marketTicker),
            lastMinuteOwnsNewBuys,
            skipThinBid,
            bidSize: await cashOutBestBidSize(
              marketTicker,
              spikeFadePickedSide(leanForGate, cfg),
              skipThinBid
            ),
          });
          if (!recheck.ok || !recheck.price || !recheck.count) continue;
          const quotedPay = Number(recheck.pay_price) || 0;
          const buyGate = liveIocBuyGate(
            recheck,
            marketTicker,
            lean,
            Number(cfg.risk?.spike_fade_cheap_max_usd || quotedPay),
            true
          );
          if (!buyGate.ok || !buyGate.price || !buyGate.count) {
            lastTradeAction[asset] = skippedTradeAction(buyGate.skip_reason || 'ask_moved', tickIso);
            continue;
          }
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: buyGate.side || 'bid',
            count: buyGate.count,
            price: buyGate.price,
            time_in_force: 'immediate_or_cancel',
            dry_run: false,
          });
          if (!placeResultShouldPersist(placeRes)) continue;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: buyGate.count,
          });
          const payPrice = Number(buyGate.pay_price ?? 0) || null;
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision === 'NO' ? 'NO' : 'YES',
            count: filled ? String(fillCount) : String(buyGate.count || 0),
            price: String(buyGate.price),
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : buyGate.notional_usd || 0,
            dryRun: false,
            status: filled ? 'FILLED' : 'CANCELLED',
            leanDiff: absGap,
            liveSpot: lean.live,
            strike: lean.strike,
            executedAt: now.toISOString(),
            orderId: placeRes.order_id ?? null,
            payPrice,
            fillCount: filled ? fillCount : 0,
            outcome: filled ? 'pending' : 'miss',
            pnlUsd: null,
            entryPath: 'spike_fade',
          };
          await saveTradeRecord(userId, tradeDoc);
          userTrades.unshift(tradeDoc);
          if (filled) {
            openPositions += 1;
            tradesToday += 1;
            tradesTodayList.push(tradeDoc);
          }
          const priceVal = typeof gate.price === 'number' ? gate.price : parseFloat(String(gate.price || 0));
          lastTradeAction[asset] = filled
            ? {
                status: 'placed',
                detail: `placed ${placeDecision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
                at: tickIso,
              }
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
                entryPath: 'spike_fade',
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
          } else {
            await emitCloudAlert({
              userId,
              alertId: missAlertId(tradeId),
              kind: 'ioc_miss',
              title: iocMissAlertTitle('spike_fade'),
              body: iocMissAlertBody({
                asset,
                decision: String(placeDecision || ''),
                entryPath: 'spike_fade',
                price: priceVal,
                count: gate.count,
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
      if (still.length) spikeFadeWatchUsers.set(userId, still);
      else spikeFadeWatchUsers.delete(userId);
      await upsertUserDoc(userId, { lastTradeAction, lastTickAt: now.toISOString() } as any);
    } catch (err: any) {
      noteTransientKalshiFailure(err);
    }
  }
  await flushSpikeFadeWatcher(now, sharedLeans);
  return { timestamp: now.toISOString(), watched };
}

export async function runBufferRunWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const now = snapshot?.now ?? new Date();
  if (bufferRunWatchUsers.size === 0) {
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const sysConfig = await getSystemConfig();
  const featureFlags = normalizeFeatureFlags(sysConfig?.featureFlags);
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }
  const watchAssets = [...new Set([...bufferRunWatchUsers.values()].flat())] as AssetKey[];
  const sharedLeans = await sharedLeansForWatch(watchAssets, now, snapshot);
  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;
  for (const [userId, userAssets] of [...bufferRunWatchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      bufferRunWatchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      const userTrades = await getTradeRecords(userId);
      const tradesTodayList = liveCloudTradesToday(userTrades, now);
      let tradesToday = tradesTodayList.length;
      const dailyPnlUsd = cloudDailyRealizedPnl(tradesTodayList);
      let openPositions = userTrades.filter(
        (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
      ).length;
      const lastTradeAction = copyLastTradeActions(user);
      const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
        (t, i, arr) => t && arr.indexOf(t) === i
      );
      const tickIso = now.toISOString();
      const still: string[] = [];
      for (const asset of userAssets) {
        const lean = sharedLeans[asset];
        if (!lean?.market_ticker) continue;
        const closeUtc = resolveTwapCloseUtc(lean, now);
        if (!closeUtc) continue;
        still.push(asset);
        watched += 1;
        const quoted = await overlayWatchLean(lean, snapshot);
        const marketTicker = quoted.market_ticker;
        if (pendingBufferRunTradesForMarket(userTrades, marketTicker).length > 0) {
          const secret = await getUserSecret(userId);
          if (secret?.privateKeyPem && secret.keyId) {
            const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
            const bufferRes = await runCloudBufferRunExits({
              userId,
              asset,
              ticker: marketTicker,
              lean: {
                phase: lean.phase === 'live' ? 'live' : 'ended',
                minutes_left: lean.minutes_left,
                minutes_remaining: lean.minutes_remaining,
                live: lean.live,
                strike: lean.strike,
                yes_bid: quoted.yes_bid,
                yes_ask: quoted.yes_ask,
                no_bid: quoted.no_bid,
                no_ask: quoted.no_ask,
              },
              trades: userTrades,
              takeUsd: cfg.risk?.buffer_run_take_usd,
              stopUsd: cfg.risk?.buffer_run_stop_usd,
              flattenMinutes: cfg.risk?.buffer_run_flatten_minutes,
              sellAtPct: cfg.risk?.buffer_run_sell_at_pct,
              slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
              dryRun: false,
              now,
              place: (input) => client.placeOrder(input),
            });
            for (const alert of bufferRes.alerts) {
              await emitCloudAlert({
                userId,
                alertId: protectAlertId(alert.tradeId),
                kind: 'protect_sell',
                title: alert.title,
                body: alert.body,
                cfg: cfg as never,
                tokens: userTokens,
                collapseId: `bfr:${userId}:${alert.tradeId}`.slice(0, 64),
                asset,
                ticker: marketTicker,
                tradeId: alert.tradeId,
                at: now.toISOString(),
              });
            }
            if (bufferRes.exited > 0) {
              lastTradeAction[asset] = {
                status: 'placed',
                detail: `Buffer run · sold ${bufferRes.exited}`,
                at: tickIso,
              };
              openPositions = Math.max(0, openPositions - bufferRes.exited);
            }
          }
        }
        if (
          !featureFlags.bufferRun ||
          !cfg.auto_trade_enabled ||
          user.state !== 'ARMED' ||
          !cfg.risk?.buffer_run_enabled
        ) {
          continue;
        }
        if (tickerHasOpenBufferRun(userTrades, marketTicker)) continue;
        if (tickerHasBufferRunAttempt(userTrades, marketTicker)) continue;
        if (
          bufferRunTwapOwns({
            twapAdminEnabled: featureFlags.twapLock,
            twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
            twapAssets: cfg.risk?.twap_lock_assets,
            asset,
          })
        ) {
          lastTradeAction[asset] = skippedTradeAction('buffer_run_twap_owns', tickIso);
          continue;
        }
        const lastMinuteTimes = lastMinuteTimingFromRisk(cfg.risk);
        const lastMinuteOwnsNewBuys =
          isLastMinuteEnterPath({
            adminEnabled: featureFlags.lastMinute,
            userEnabled: Boolean(cfg.risk?.last_minute_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.last_minute_assets,
          }) &&
          isLastMinuteWindow(now, closeUtc, lastMinuteTimes.enterSec, lastMinuteTimes.stopSec);
        const spikeFadeOwnsWindow =
          isSpikeFadeEnterPath({
            adminEnabled: featureFlags.spikeFade,
            userEnabled: Boolean(cfg.risk?.spike_fade_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.spike_fade_assets,
          }) &&
          isSpikeFadeEnterWindow({
            minutesElapsed: lean.minutes_elapsed,
            startMinutes: cfg.risk?.spike_fade_start_minutes,
            untilMinutes: cfg.risk?.spike_fade_until_minutes,
          });
        const stepBuyOwnsWindow =
          isStepBuyEnterPath({
            adminEnabled: featureFlags.stepBuy,
            userEnabled: Boolean(cfg.risk?.step_buy_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.step_buy_assets,
          }) &&
          isStepBuyStartWindow({
            minutesElapsed: lean.minutes_elapsed,
            startMinutes: cfg.risk?.step_buy_start_minutes,
          });
        const pairLockOwnsWindow =
          isPairLockEnterPath({
            adminEnabled: featureFlags.pairLock,
            userEnabled: Boolean(cfg.risk?.pair_lock_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.pair_lock_assets,
          }) &&
          isPairLockEnterWindow({
            minutesElapsed: lean.minutes_elapsed,
            startMinutes: cfg.risk?.pair_lock_start_minutes,
            untilMinutes: cfg.risk?.pair_lock_until_minutes,
          });
        const capLockOwnsWindow =
          isCapLockEnterPath({
            adminEnabled: featureFlags.capLock,
            userEnabled: Boolean(cfg.risk?.cap_lock_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.cap_lock_assets,
          }) &&
          isCapLockEnterWindow({
            minutesElapsed: lean.minutes_elapsed,
            minutesRemaining: lean.minutes_remaining,
            windowOpenSeconds: cfg.risk?.cap_lock_window_open_seconds,
            allowLater: cfg.risk?.cap_lock_allow_later,
          });
        const cheapLoopOwnsWindow =
          isCheapLoopEnterPath({
            adminEnabled: featureFlags.cheapLoop,
            userEnabled: Boolean(cfg.risk?.cheap_loop_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.cheap_loop_assets,
          }) &&
          isCheapLoopEnterWindow({
            minutesElapsed: lean.minutes_elapsed,
            minutesLeft: goldFadeMinutesLeft(lean),
            startMinutes: cfg.risk?.cheap_loop_start_minutes,
            flattenMinutes: cfg.risk?.cheap_loop_flatten_minutes,
          });
        const skipThinBid = cfg.risk?.buffer_run_skip_thin_bid === true;
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
          yes_ask: quoted.yes_ask ?? undefined,
          no_ask: quoted.no_ask ?? undefined,
          yes_bid: quoted.yes_bid ?? undefined,
          no_bid: quoted.no_bid ?? undefined,
          timeseries: lean.timeseries,
          open_utc: lean.open_utc,
          close_utc: lean.close_utc,
        };
        const gate = evaluateBufferRunEnter({
          lean: leanForGate,
          cfg,
          adminEnabled: featureFlags.bufferRun,
          twapAdminEnabled: featureFlags.twapLock,
          openPositions,
          tradesToday,
          dailyPnlUsd,
          hasOpenOnTicker: tickerHasOpenOtherThanBufferRun(userTrades, marketTicker),
          alreadyHolding: false,
          alreadyAttempted: false,
          lastMinuteOwnsNewBuys,
          spikeFadeOwns: spikeFadeOwnsWindow || tickerHasOpenSpikeFade(userTrades, marketTicker),
          stepBuyOwns: stepBuyOwnsWindow || stepBuyLotsForTicker(userTrades, marketTicker).count > 0,
          pairLockOwns: pairLockOwnsWindow || tickerHasOpenPairLock(userTrades, marketTicker),
          capLockOwns: capLockOwnsWindow || tickerHasOpenCapLock(userTrades, marketTicker),
          cheapLoopOwns: cheapLoopOwnsWindow || tickerHasOpenCheapLoop(userTrades, marketTicker),
          skipThinBid,
          bidSize: await cashOutBestBidSize(
            marketTicker,
            bufferRunPickedSide(leanForGate, cfg),
            skipThinBid
          ),
          timeseries: bufferRunTimeseriesForAsset(asset, lean.timeseries),
        });
        if (!gate.ok || !gate.price || !gate.count) {
          if (
            gate.skip_reason === 'buffer_run_too_early' ||
            gate.skip_reason === 'buffer_run_too_late' ||
            gate.skip_reason === 'buffer_run_thin_lead' ||
            gate.skip_reason === 'buffer_run_ask_rich' ||
            gate.skip_reason === 'buffer_run_ask_cheap' ||
            gate.skip_reason === 'buffer_run_pair_lock' ||
            gate.skip_reason === 'buffer_run_no_ask' ||
            gate.skip_reason === 'buffer_run_no_spot' ||
            gate.skip_reason === 'buffer_run_thin_bid' ||
            gate.skip_reason === 'buffer_run_twap_owns' ||
            gate.skip_reason === 'buffer_run_last_minute_owns' ||
            gate.skip_reason === 'buffer_run_spike_owns' ||
            gate.skip_reason === 'buffer_run_step_owns' ||
            gate.skip_reason === 'buffer_run_pair_owns' ||
            gate.skip_reason === 'buffer_run_cap_owns' ||
            gate.skip_reason === 'buffer_run_cheap_owns' ||
            gate.skip_reason === 'buffer_run_holding_other_path' ||
            gate.skip_reason === 'buffer_run_attempted' ||
            gate.skip_reason === 'window_ended'
          ) {
            continue;
          }
          if (gate.skip_reason) lastTradeAction[asset] = skippedTradeAction(gate.skip_reason, tickIso);
          continue;
        }
        const secret = await getUserSecret(userId);
        if (!secret?.privateKeyPem || !secret.keyId) continue;
        const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
        const placeRequestId = `bfr_${userId}_${marketTicker}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`.slice(0, 64);
        const claimed = await tryAcquirePlaceLock({
          userId,
          ticker: marketTicker,
          cap: existingBuys + 1,
          requestId: placeRequestId,
          existingBuys,
        });
        if (!claimed.ok) continue;
        const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
        const placeDecision = gate.decision || lean.decision;
        try {
          const freshTrades = await getTradeRecords(userId);
          userTrades.splice(0, userTrades.length, ...freshTrades);
          const recheck = evaluateBufferRunEnter({
            lean: leanForGate,
            cfg,
            adminEnabled: featureFlags.bufferRun,
            twapAdminEnabled: featureFlags.twapLock,
            openPositions: userTrades.filter(
              (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
            ).length,
            tradesToday,
            dailyPnlUsd,
            hasOpenOnTicker: tickerHasOpenOtherThanBufferRun(userTrades, marketTicker),
            alreadyHolding: tickerHasOpenBufferRun(userTrades, marketTicker),
            alreadyAttempted: tickerHasBufferRunAttempt(userTrades, marketTicker),
            lastMinuteOwnsNewBuys,
            spikeFadeOwns: spikeFadeOwnsWindow || tickerHasOpenSpikeFade(userTrades, marketTicker),
            stepBuyOwns: stepBuyOwnsWindow || stepBuyLotsForTicker(userTrades, marketTicker).count > 0,
            pairLockOwns: pairLockOwnsWindow || tickerHasOpenPairLock(userTrades, marketTicker),
            capLockOwns: capLockOwnsWindow || tickerHasOpenCapLock(userTrades, marketTicker),
            cheapLoopOwns: cheapLoopOwnsWindow || tickerHasOpenCheapLoop(userTrades, marketTicker),
            skipThinBid,
            bidSize: await cashOutBestBidSize(
              marketTicker,
              bufferRunPickedSide(leanForGate, cfg),
              skipThinBid
            ),
            timeseries: bufferRunTimeseriesForAsset(asset, lean.timeseries),
          });
          if (!recheck.ok || !recheck.price || !recheck.count) continue;
          const quotedPay = Number(recheck.pay_price) || 0;
          const buyGate = liveIocBuyGate(
            recheck,
            marketTicker,
            lean,
            Number(cfg.risk?.buffer_run_ask_max_usd || quotedPay),
            true
          );
          if (!buyGate.ok || !buyGate.price || !buyGate.count) {
            lastTradeAction[asset] = skippedTradeAction(buyGate.skip_reason || 'ask_moved', tickIso);
            continue;
          }
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: buyGate.side || 'bid',
            count: buyGate.count,
            price: buyGate.price,
            time_in_force: 'immediate_or_cancel',
            dry_run: false,
          });
          if (!placeResultShouldPersist(placeRes)) continue;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: buyGate.count,
          });
          const payPrice = Number(buyGate.pay_price ?? 0) || null;
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision === 'NO' ? 'NO' : 'YES',
            count: filled ? String(fillCount) : String(buyGate.count || 0),
            price: String(buyGate.price),
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : buyGate.notional_usd || 0,
            dryRun: false,
            status: filled ? 'FILLED' : 'CANCELLED',
            leanDiff: absGap,
            liveSpot: lean.live,
            strike: lean.strike,
            executedAt: now.toISOString(),
            orderId: placeRes.order_id ?? null,
            payPrice,
            fillCount: filled ? fillCount : 0,
            outcome: filled ? 'pending' : 'miss',
            pnlUsd: null,
            entryPath: 'buffer_run',
          };
          await saveTradeRecord(userId, tradeDoc);
          userTrades.unshift(tradeDoc);
          if (filled && !tradeDoc.dryRun) {
            openPositions += 1;
            tradesToday += 1;
            tradesTodayList.push(tradeDoc);
          }
          const priceVal =
            typeof buyGate.price === 'number' ? buyGate.price : parseFloat(String(buyGate.price || 0));
          lastTradeAction[asset] = filled
            ? {
                status: 'placed',
                detail: `placed ${placeDecision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
                at: tickIso,
              }
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
                entryPath: 'buffer_run',
              }),
              body: `${buyGate.count} ctr @ $${priceVal.toFixed(2)} · Cost $${(buyGate.notional_usd || 0).toFixed(2)}`,
              cfg: cfg as never,
              tokens: userTokens,
              collapseId: fillCollapseId(userId, tradeId),
              asset: lean.asset,
              ticker: marketTicker,
              tradeId,
              decision: String(placeDecision || ''),
              at: now.toISOString(),
            });
          } else {
            await emitCloudAlert({
              userId,
              alertId: missAlertId(tradeId),
              kind: 'ioc_miss',
              title: iocMissAlertTitle('buffer_run'),
              body: iocMissAlertBody({
                asset,
                decision: String(placeDecision || ''),
                entryPath: 'buffer_run',
                price: priceVal,
                count: buyGate.count,
              }),
              cfg: cfg as never,
              tokens: userTokens,
              asset: lean.asset,
              ticker: marketTicker,
              tradeId,
              decision: String(placeDecision || ''),
              at: now.toISOString(),
            });
          }
        } finally {
          await releasePlaceLock({ userId, ticker: marketTicker, requestId: placeRequestId });
        }
      }
      if (still.length) bufferRunWatchUsers.set(userId, still);
      else bufferRunWatchUsers.delete(userId);
      await upsertUserDoc(userId, { lastTradeAction, lastTickAt: now.toISOString() } as any);
    } catch (err: any) {
      noteTransientKalshiFailure(err);
    }
  }
  return { timestamp: now.toISOString(), watched };
}

export async function runCheapLoopWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const now = snapshot?.now ?? new Date();
  if (cheapLoopWatchUsers.size === 0) {
    await flushCheapLoopWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const sysConfig = await getSystemConfig();
  const featureFlags = normalizeFeatureFlags(sysConfig?.featureFlags);
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }
  const watchAssets = [...new Set([...cheapLoopWatchUsers.values()].flat())] as AssetKey[];
  const sharedLeans = await sharedLeansForWatch(watchAssets, now, snapshot);
  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;
  for (const [userId, userAssets] of [...cheapLoopWatchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      cheapLoopWatchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      const userTrades = await getTradeRecords(userId);
      const tradesTodayList = liveCloudTradesToday(userTrades, now);
      let tradesToday = tradesTodayList.length;
      const dailyPnlUsd = cloudDailyRealizedPnl(tradesTodayList);
      let openPositions = userTrades.filter(
        (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
      ).length;
      const lastTradeAction = copyLastTradeActions(user);
      const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
        (t, i, arr) => t && arr.indexOf(t) === i
      );
      const tickIso = now.toISOString();
      const still: string[] = [];
      for (const asset of userAssets) {
        const lean = sharedLeans[asset];
        if (!lean?.market_ticker) continue;
        const closeUtc = resolveTwapCloseUtc(lean, now);
        if (!closeUtc) continue;
        still.push(asset);
        watched += 1;
        const quoted = await overlayWatchLean(lean, snapshot);
        const marketTicker = quoted.market_ticker;
        if (pendingCheapLoopTradesForMarket(userTrades, marketTicker).length > 0) {
          const secret = await getUserSecret(userId);
          if (secret?.privateKeyPem && secret.keyId) {
            const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
            const cheapRes = await runCloudCheapLoopExits({
              userId,
              asset,
              ticker: marketTicker,
              lean: {
                phase: lean.phase === 'live' ? 'live' : 'ended',
                minutes_left: lean.minutes_left,
                minutes_remaining: lean.minutes_remaining,
                yes_bid: quoted.yes_bid,
                yes_ask: quoted.yes_ask,
                no_bid: quoted.no_bid,
                no_ask: quoted.no_ask,
              },
              trades: userTrades,
              takeUsd: cfg.risk?.cheap_loop_take_usd,
              stopUsd: cheapLoopActiveStopUsd(
                cfg.risk?.cheap_loop_stop_enabled,
                cfg.risk?.cheap_loop_stop_usd
              ),
              flattenMinutes: cfg.risk?.cheap_loop_flatten_minutes,
              minHoldMinutes: cfg.risk?.cheap_loop_min_hold_minutes,
              slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
              dryRun: false,
              now,
              place: (input) => client.placeOrder(input),
            });
            for (const alert of cheapRes.alerts) {
              await emitCloudAlert({
                userId,
                alertId: protectAlertId(alert.tradeId),
                kind: 'protect_sell',
                title: alert.title,
                body: alert.body,
                cfg: cfg as never,
                tokens: userTokens,
                collapseId: `clp:${userId}:${alert.tradeId}`.slice(0, 64),
                asset,
                ticker: marketTicker,
                tradeId: alert.tradeId,
                at: now.toISOString(),
              });
            }
            if (cheapRes.exited > 0) {
              lastTradeAction[asset] = {
                status: 'placed',
                detail: `Cheap loop 15m · sold ${cheapRes.exited}`,
                at: tickIso,
              };
              openPositions = Math.max(0, openPositions - cheapRes.exited);
            }
          }
        }
        if (
          Boolean(cfg.risk?.buffer_run_enabled) &&
          pendingBufferRunTradesForMarket(userTrades, marketTicker).length > 0
        ) {
          const secret = await getUserSecret(userId);
          if (secret?.privateKeyPem && secret.keyId) {
            const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
            const bufferRes = await runCloudBufferRunExits({
              userId,
              asset,
              ticker: marketTicker,
              lean: {
                phase: lean.phase === 'live' ? 'live' : 'ended',
                minutes_left: lean.minutes_left,
                minutes_remaining: lean.minutes_remaining,
                live: lean.live,
                strike: lean.strike,
                yes_bid: quoted.yes_bid,
                yes_ask: quoted.yes_ask,
                no_bid: quoted.no_bid,
                no_ask: quoted.no_ask,
              },
              trades: userTrades,
              takeUsd: cfg.risk?.buffer_run_take_usd,
              stopUsd: cfg.risk?.buffer_run_stop_usd,
              flattenMinutes: cfg.risk?.buffer_run_flatten_minutes,
              sellAtPct: cfg.risk?.buffer_run_sell_at_pct,
              slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
              dryRun: false,
              now,
              place: (input) => client.placeOrder(input),
            });
            for (const alert of bufferRes.alerts) {
              await emitCloudAlert({
                userId,
                alertId: protectAlertId(alert.tradeId),
                kind: 'protect_sell',
                title: alert.title,
                body: alert.body,
                cfg: cfg as never,
                tokens: userTokens,
                collapseId: `bfr:${userId}:${alert.tradeId}`.slice(0, 64),
                asset,
                ticker: marketTicker,
                tradeId: alert.tradeId,
                at: now.toISOString(),
              });
            }
            if (bufferRes.exited > 0) {
              lastTradeAction[asset] = {
                status: 'placed',
                detail: `Buffer run · sold ${bufferRes.exited}`,
                at: tickIso,
              };
              openPositions = Math.max(0, openPositions - bufferRes.exited);
            }
          }
        }
        if (!featureFlags.cheapLoop || !cfg.auto_trade_enabled || user.state !== 'ARMED' || !cfg.risk?.cheap_loop_enabled) {
          continue;
        }
        if (tickerHasOpenCheapLoop(userTrades, marketTicker)) continue;
        if (
          cheapLoopTwapOwns({
            twapAdminEnabled: featureFlags.twapLock,
            twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
            twapAssets: cfg.risk?.twap_lock_assets,
            asset,
          })
        ) {
          lastTradeAction[asset] = skippedTradeAction('cheap_loop_twap_owns', tickIso);
          continue;
        }
        const lastMinuteTimes = lastMinuteTimingFromRisk(cfg.risk);
        const lastMinuteOwnsNewBuys =
          isLastMinuteEnterPath({
            adminEnabled: featureFlags.lastMinute,
            userEnabled: Boolean(cfg.risk?.last_minute_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.last_minute_assets,
          }) &&
          isLastMinuteWindow(now, closeUtc, lastMinuteTimes.enterSec, lastMinuteTimes.stopSec);
        const skipThinBid = cfg.risk?.cheap_loop_skip_thin_bid === true;
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
          yes_ask: quoted.yes_ask ?? undefined,
          no_ask: quoted.no_ask ?? undefined,
          yes_bid: quoted.yes_bid ?? undefined,
          no_bid: quoted.no_bid ?? undefined,
          timeseries: lean.timeseries,
          open_utc: lean.open_utc,
          close_utc: lean.close_utc,
        };
        const gate = evaluateCheapLoopEnter({
          lean: leanForGate,
          cfg,
          adminEnabled: featureFlags.cheapLoop,
          twapAdminEnabled: featureFlags.twapLock,
          openPositions,
          tradesToday,
          dailyPnlUsd,
          hasOpenOnTicker: tickerHasOpenOtherThanCheapLoop(userTrades, marketTicker),
          alreadyHolding: false,
          lastMinuteOwnsNewBuys,
          cyclesUsed: cheapLoopExitsForTicker(userTrades, marketTicker),
          inCooldown: isCheapLoopCooldown({
            trades: userTrades,
            marketTicker,
            cooldownMinutes: cfg.risk?.cheap_loop_cooldown_minutes,
            now,
          }),
          skipThinBid,
          bidSize: await cashOutBestBidSize(
            marketTicker,
            cheapLoopPickedSide(leanForGate, cfg),
            skipThinBid
          ),
        });
        if (!gate.ok || !gate.price || !gate.count) {
          if (gate.skip_reason) lastTradeAction[asset] = skippedTradeAction(gate.skip_reason, tickIso);
          continue;
        }
        const secret = await getUserSecret(userId);
        if (!secret?.privateKeyPem || !secret.keyId) continue;
        const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
        const placeRequestId = `cl_${userId}_${marketTicker}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`.slice(0, 64);
        const claimed = await tryAcquirePlaceLock({
          userId,
          ticker: marketTicker,
          cap: existingBuys + 1,
          requestId: placeRequestId,
          existingBuys,
        });
        if (!claimed.ok) continue;
        const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
        const placeDecision = gate.decision || lean.decision;
        try {
          const freshTrades = await getTradeRecords(userId);
          userTrades.splice(0, userTrades.length, ...freshTrades);
          const recheck = evaluateCheapLoopEnter({
            lean: leanForGate,
            cfg,
            adminEnabled: featureFlags.cheapLoop,
            twapAdminEnabled: featureFlags.twapLock,
            openPositions: userTrades.filter(
              (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
            ).length,
            tradesToday,
            dailyPnlUsd,
            hasOpenOnTicker: tickerHasOpenOtherThanCheapLoop(userTrades, marketTicker),
            alreadyHolding: tickerHasOpenCheapLoop(userTrades, marketTicker),
            lastMinuteOwnsNewBuys,
            cyclesUsed: cheapLoopExitsForTicker(userTrades, marketTicker),
            inCooldown: isCheapLoopCooldown({
              trades: userTrades,
              marketTicker,
              cooldownMinutes: cfg.risk?.cheap_loop_cooldown_minutes,
              now,
            }),
            skipThinBid,
            bidSize: await cashOutBestBidSize(
              marketTicker,
              cheapLoopPickedSide(leanForGate, cfg),
              skipThinBid
            ),
          });
          if (!recheck.ok || !recheck.price || !recheck.count) continue;
          const quotedPay = Number(recheck.pay_price) || 0;
          const buyGate = liveIocBuyGate(
            recheck,
            marketTicker,
            lean,
            Number(cfg.risk?.cheap_loop_cheap_max_ask_usd || quotedPay),
            true
          );
          if (!buyGate.ok || !buyGate.price || !buyGate.count) {
            lastTradeAction[asset] = skippedTradeAction(buyGate.skip_reason || 'ask_moved', tickIso);
            continue;
          }
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: buyGate.side || 'bid',
            count: buyGate.count,
            price: buyGate.price,
            time_in_force: 'immediate_or_cancel',
            dry_run: false,
          });
          if (!placeResultShouldPersist(placeRes)) continue;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: buyGate.count,
          });
          const payPrice = Number(buyGate.pay_price ?? 0) || null;
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision === 'NO' ? 'NO' : 'YES',
            count: filled ? String(fillCount) : String(buyGate.count || 0),
            price: String(buyGate.price),
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : buyGate.notional_usd || 0,
            dryRun: false,
            status: filled ? 'FILLED' : 'CANCELLED',
            leanDiff: absGap,
            liveSpot: lean.live,
            strike: lean.strike,
            executedAt: now.toISOString(),
            orderId: placeRes.order_id ?? null,
            payPrice,
            fillCount: filled ? fillCount : 0,
            outcome: filled ? 'pending' : 'miss',
            pnlUsd: null,
            entryPath: 'cheap_loop',
          };
          await saveTradeRecord(userId, tradeDoc);
          userTrades.unshift(tradeDoc);
          if (filled) {
            openPositions += 1;
            tradesToday += 1;
            tradesTodayList.push(tradeDoc);
          }
          const priceVal = typeof gate.price === 'number' ? gate.price : parseFloat(String(gate.price || 0));
          lastTradeAction[asset] = filled
            ? {
                status: 'placed',
                detail: `placed ${placeDecision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
                at: tickIso,
              }
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
                entryPath: 'cheap_loop',
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
          } else {
            await emitCloudAlert({
              userId,
              alertId: missAlertId(tradeId),
              kind: 'ioc_miss',
              title: iocMissAlertTitle('cheap_loop'),
              body: iocMissAlertBody({
                asset,
                decision: String(placeDecision || ''),
                entryPath: 'cheap_loop',
                price: priceVal,
                count: gate.count,
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
      if (still.length) cheapLoopWatchUsers.set(userId, still);
      else cheapLoopWatchUsers.delete(userId);
      await upsertUserDoc(userId, { lastTradeAction, lastTickAt: now.toISOString() } as any);
    } catch (err: any) {
      noteTransientKalshiFailure(err);
    }
  }
  await flushCheapLoopWatcher(now, sharedLeans);
  return { timestamp: now.toISOString(), watched };
}

async function overlayHourlyTickerLean(
  ticker: string,
  now: Date,
  snapshot?: OneSecondMarketSnapshot | null
): Promise<any> {
  const book = readWsAskBid(ticker) || snapshot?.quotes.get(ticker);
  const cachedMarket = hourlyClockByTicker.get(ticker);
  if (snapshot && (book || cachedMarket)) {
    const market = cachedMarket || {};
    const clock = marketClockFromKalshi(market, now);
    const lean = {
      market_ticker: ticker,
      yes_ask: book?.yes_ask ?? (market?.yes_ask_dollars != null ? Number(market.yes_ask_dollars) : undefined),
      no_ask: book?.no_ask ?? (market?.no_ask_dollars != null ? Number(market.no_ask_dollars) : undefined),
      yes_bid: book?.yes_bid ?? (market?.yes_bid_dollars != null ? Number(market.yes_bid_dollars) : undefined),
      no_bid: book?.no_bid ?? (market?.no_bid_dollars != null ? Number(market.no_bid_dollars) : undefined),
      phase: clock.phase,
      minutes_left: clock.minutes_left,
      minutes_remaining: clock.minutes_remaining,
      close_utc: clock.close_utc,
    };
    return leanWithSnapshotQuote(lean, snapshot.quotes);
  }
  const market = await getMarketQuote(ticker, fetch, { skipCache: !snapshot });
  if (market) hourlyClockByTicker.set(ticker, market);
  const clock = marketClockFromKalshi(market, now);
  const lean = {
    market_ticker: ticker,
    yes_ask: market?.yes_ask_dollars != null ? Number(market.yes_ask_dollars) : undefined,
    no_ask: market?.no_ask_dollars != null ? Number(market.no_ask_dollars) : undefined,
    yes_bid: market?.yes_bid_dollars != null ? Number(market.yes_bid_dollars) : undefined,
    no_bid: market?.no_bid_dollars != null ? Number(market.no_bid_dollars) : undefined,
    phase: clock.phase,
    minutes_left: clock.minutes_left,
    minutes_remaining: clock.minutes_remaining,
    close_utc: clock.close_utc,
  };
  return snapshot ? leanWithSnapshotQuote(lean, snapshot.quotes) : lean;
}

export async function runCheapLoopHourlyWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  return runCheapLoopAtmLadderWatchTick('hourly', snapshot);
}

export async function runCheapLoopWeeklyWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  return runCheapLoopAtmLadderWatchTick('weekly', snapshot);
}

async function runCheapLoopAtmLadderWatchTick(
  kind: 'hourly' | 'weekly',
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const weekly = kind === 'weekly';
  const watchUsers = weekly ? cheapLoopWeeklyWatchUsers : cheapLoopHourlyWatchUsers;
  const quoteTickers = weekly ? cheapLoopWeeklyQuoteTickers : cheapLoopHourlyQuoteTickers;
  const entryPath = weekly ? 'cheap_loop_weekly' : 'cheap_loop_hourly';
  const lockPrefix = weekly ? 'clw_' : 'clh_';
  const collapsePrefix = weekly ? 'clw:' : 'clh:';
  const soldLabel = weekly ? 'Cheap loop weekly · sold' : 'Cheap loop hourly · sold';
  const skipNoMarket = weekly ? 'cheap_loop_weekly_no_market' : 'cheap_loop_hourly_no_market';
  const now = snapshot?.now ?? new Date();
  if (watchUsers.size === 0) {
    await flushCheapLoopWatcher(now, snapshot?.leans || {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const sysConfig = await getSystemConfig();
  const featureFlags = normalizeFeatureFlags(sysConfig?.featureFlags);
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }
  const ladderLeanByAsset: Partial<Record<AssetKey, any>> = {};
  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;
  for (const [userId, userAssets] of [...watchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      watchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      const ladderCfg = weekly ? cheapLoopCfgForWeekly(cfg) : cheapLoopCfgForHourly(cfg);
      const userTrades = await getTradeRecords(userId);
      const tradesTodayList = liveCloudTradesToday(userTrades, now);
      let tradesToday = tradesTodayList.length;
      const dailyPnlUsd = cloudDailyRealizedPnl(tradesTodayList);
      let openPositions = userTrades.filter(
        (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
      ).length;
      const lastTradeAction = copyLastTradeActions(user);
      const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
        (t, i, arr) => t && arr.indexOf(t) === i
      );
      const tickIso = now.toISOString();
      const still: string[] = [];
      const enabled = weekly
        ? Boolean(cfg.risk?.cheap_loop_weekly_enabled)
        : Boolean(cfg.risk?.cheap_loop_hourly_enabled);
      const takeUsd = weekly ? cfg.risk?.cheap_loop_weekly_take_usd : cfg.risk?.cheap_loop_hourly_take_usd;
      const flattenMinutes = weekly
        ? normalizeCheapLoopWeeklyFlattenMinutes(cfg.risk?.cheap_loop_weekly_flatten_minutes)
        : cfg.risk?.cheap_loop_hourly_flatten_minutes;
      const minHoldMinutes = weekly
        ? cfg.risk?.cheap_loop_weekly_min_hold_minutes
        : cfg.risk?.cheap_loop_hourly_min_hold_minutes;
      const cooldownMinutes = weekly
        ? cfg.risk?.cheap_loop_weekly_cooldown_minutes
        : cfg.risk?.cheap_loop_hourly_cooldown_minutes;
      const skipThinBid = weekly
        ? cfg.risk?.cheap_loop_weekly_skip_thin_bid === true
        : cfg.risk?.cheap_loop_hourly_skip_thin_bid === true;
      const selectedAssets = weekly ? cfg.risk?.cheap_loop_weekly_assets : cfg.risk?.cheap_loop_hourly_assets;
      for (const asset of userAssets) {
        still.push(asset);
        watched += 1;
        const heldTicker = weekly
          ? openCheapLoopWeeklyTickerForAsset(userTrades, asset)
          : openCheapLoopHourlyTickerForAsset(userTrades, asset);
        const pendingHeld = heldTicker
          ? weekly
            ? pendingCheapLoopWeeklyTradesForMarket(userTrades, heldTicker)
            : pendingCheapLoopHourlyTradesForMarket(userTrades, heldTicker)
          : [];
        if (heldTicker) {
          if (pendingHeld.length > 0) {
            const secret = await getUserSecret(userId);
            if (secret?.privateKeyPem && secret.keyId) {
              const quoted = await overlayHourlyTickerLean(heldTicker, now, snapshot);
              const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
              const cheapRes = await runCloudCheapLoopExits({
                userId,
                asset,
                ticker: heldTicker,
                lean: {
                  phase: quoted.phase === 'live' ? 'live' : 'ended',
                  minutes_left: quoted.minutes_left,
                  minutes_remaining: quoted.minutes_remaining,
                  yes_bid: quoted.yes_bid,
                  yes_ask: quoted.yes_ask,
                  no_bid: quoted.no_bid,
                  no_ask: quoted.no_ask,
                },
                trades: userTrades,
                takeUsd,
                stopUsd: cheapLoopActiveStopUsd(
                  weekly ? cfg.risk?.cheap_loop_weekly_stop_enabled : cfg.risk?.cheap_loop_hourly_stop_enabled,
                  weekly ? cfg.risk?.cheap_loop_weekly_stop_usd : cfg.risk?.cheap_loop_hourly_stop_usd
                ),
                flattenMinutes,
                minHoldMinutes,
                slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
                dryRun: false,
                now,
                hourly: !weekly,
                weekly,
                place: (input) => client.placeOrder(input),
              });
              for (const alert of cheapRes.alerts) {
                await emitCloudAlert({
                  userId,
                  alertId: protectAlertId(alert.tradeId),
                  kind: 'protect_sell',
                  title: alert.title,
                  body: alert.body,
                  cfg: cfg as never,
                  tokens: userTokens,
                  collapseId: `${collapsePrefix}${userId}:${alert.tradeId}`.slice(0, 64),
                  asset,
                  ticker: heldTicker,
                  tradeId: alert.tradeId,
                  at: now.toISOString(),
                });
              }
              if (cheapRes.exited > 0) {
                lastTradeAction[asset] = {
                  status: 'placed',
                  detail: `${soldLabel} ${cheapRes.exited}`,
                  at: tickIso,
                };
                openPositions = Math.max(0, openPositions - cheapRes.exited);
              }
            }
          }
          continue;
        }
        if (!featureFlags.cheapLoop || !cfg.auto_trade_enabled || user.state !== 'ARMED' || !enabled) {
          continue;
        }
        const enterOk = weekly
          ? isCheapLoopWeeklyEnterPath({
              adminEnabled: true,
              userEnabled: true,
              assetEnabled: cfg.assets_enabled?.[asset] !== false,
              asset,
              assets: selectedAssets,
            })
          : isCheapLoopHourlyEnterPath({
              adminEnabled: true,
              userEnabled: true,
              assetEnabled: cfg.assets_enabled?.[asset] !== false,
              asset,
              assets: selectedAssets,
            });
        if (!enterOk) continue;
        const alreadyHolding = weekly
          ? assetHasOpenCheapLoopWeekly(userTrades, asset)
          : assetHasOpenCheapLoopHourly(userTrades, asset);
        if (alreadyHolding) continue;
        if (!ladderLeanByAsset[asset]) {
          try {
            ladderLeanByAsset[asset] = weekly
              ? await computeWeeklyAtmLean(asset, fetch, now)
              : await computeHourlyAtmLean(asset, fetch, now);
          } catch (err: any) {
            noteTransientKalshiFailure(err);
            lastTradeAction[asset] = skippedTradeAction(skipNoMarket, tickIso);
            continue;
          }
        }
        const lean = ladderLeanByAsset[asset];
        if (!lean?.ok || !lean.market_ticker) {
          if (lean?.message) lastTradeAction[asset] = skippedTradeAction(lean.message, tickIso);
          continue;
        }
        const quoted = snapshot ? leanWithSnapshotQuote(lean, snapshot.quotes) : lean;
        const marketTicker = String(quoted.market_ticker || lean.market_ticker).trim();
        if (!marketTicker) continue;
        const eventKey = weekly ? cheapLoopWeeklyEventKey(marketTicker) : cheapLoopHourlyEventKey(marketTicker);
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
          minutes_left: quoted.minutes_left || lean.minutes_left || 0,
          minutes_elapsed: lean.minutes_elapsed || 0,
          minutes_remaining: quoted.minutes_remaining ?? lean.minutes_remaining,
          phase: (quoted.phase === 'live' || lean.phase === 'live' ? 'live' : 'ended') as 'live' | 'ended',
          yes_ask: quoted.yes_ask ?? undefined,
          no_ask: quoted.no_ask ?? undefined,
          yes_bid: quoted.yes_bid ?? undefined,
          no_bid: quoted.no_bid ?? undefined,
          timeseries: lean.timeseries,
          close_utc: quoted.close_utc || lean.close_utc,
        };
        const cyclesUsed = weekly
          ? cheapLoopWeeklyExitsForEvent(userTrades, eventKey)
          : cheapLoopHourlyExitsForEvent(userTrades, eventKey);
        const inCooldown = weekly
          ? isCheapLoopWeeklyCooldown({ trades: userTrades, eventKey, cooldownMinutes, now })
          : isCheapLoopHourlyCooldown({ trades: userTrades, eventKey, cooldownMinutes, now });
        const hasOpenOnTicker = weekly
          ? tickerHasOpenOtherThanCheapLoopWeekly(userTrades, marketTicker)
          : tickerHasOpenOtherThanCheapLoopHourly(userTrades, marketTicker);
        const gate = evaluateCheapLoopEnter({
          lean: leanForGate,
          cfg: ladderCfg,
          adminEnabled: featureFlags.cheapLoop,
          twapAdminEnabled: false,
          openPositions,
          tradesToday,
          dailyPnlUsd,
          hasOpenOnTicker,
          alreadyHolding: false,
          lastMinuteOwnsNewBuys: false,
          cyclesUsed,
          inCooldown,
          skipThinBid,
          cyclesMax: weekly ? CHEAP_LOOP_WEEKLY_CYCLES_MAX : CHEAP_LOOP_HOURLY_CYCLES_MAX,
          bidSize: await cashOutBestBidSize(
            marketTicker,
            cheapLoopPickedSide(leanForGate, ladderCfg),
            skipThinBid
          ),
        });
        if (!gate.ok || !gate.price || !gate.count) {
          if (gate.skip_reason) lastTradeAction[asset] = skippedTradeAction(gate.skip_reason, tickIso);
          continue;
        }
        const secret = await getUserSecret(userId);
        if (!secret?.privateKeyPem || !secret.keyId) continue;
        const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
        const placeRequestId = `${lockPrefix}${userId}_${marketTicker}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`.slice(0, 64);
        const claimed = await tryAcquirePlaceLock({
          userId,
          ticker: marketTicker,
          cap: existingBuys + 1,
          requestId: placeRequestId,
          existingBuys,
        });
        if (!claimed.ok) continue;
        const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
        const placeDecision = gate.decision || 'YES';
        try {
          const freshTrades = await getTradeRecords(userId);
          userTrades.splice(0, userTrades.length, ...freshTrades);
          const recheckHolding = weekly
            ? assetHasOpenCheapLoopWeekly(userTrades, asset)
            : assetHasOpenCheapLoopHourly(userTrades, asset);
          const recheck = evaluateCheapLoopEnter({
            lean: leanForGate,
            cfg: ladderCfg,
            adminEnabled: featureFlags.cheapLoop,
            twapAdminEnabled: false,
            openPositions: userTrades.filter(
              (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
            ).length,
            tradesToday,
            dailyPnlUsd,
            hasOpenOnTicker: weekly
              ? tickerHasOpenOtherThanCheapLoopWeekly(userTrades, marketTicker)
              : tickerHasOpenOtherThanCheapLoopHourly(userTrades, marketTicker),
            alreadyHolding: recheckHolding,
            lastMinuteOwnsNewBuys: false,
            cyclesUsed: weekly
              ? cheapLoopWeeklyExitsForEvent(userTrades, eventKey)
              : cheapLoopHourlyExitsForEvent(userTrades, eventKey),
            inCooldown: weekly
              ? isCheapLoopWeeklyCooldown({ trades: userTrades, eventKey, cooldownMinutes, now })
              : isCheapLoopHourlyCooldown({ trades: userTrades, eventKey, cooldownMinutes, now }),
            skipThinBid,
            cyclesMax: weekly ? CHEAP_LOOP_WEEKLY_CYCLES_MAX : CHEAP_LOOP_HOURLY_CYCLES_MAX,
            bidSize: await cashOutBestBidSize(
              marketTicker,
              cheapLoopPickedSide(leanForGate, ladderCfg),
              skipThinBid
            ),
          });
          if (!recheck.ok || !recheck.price || !recheck.count) continue;
          const quotedPay = Number(recheck.pay_price) || 0;
          const buyGate = liveIocBuyGate(
            recheck,
            marketTicker,
            lean,
            Number(ladderCfg.risk?.cheap_loop_cheap_max_ask_usd || quotedPay),
            true
          );
          if (!buyGate.ok || !buyGate.price || !buyGate.count) {
            lastTradeAction[asset] = skippedTradeAction(buyGate.skip_reason || 'ask_moved', tickIso);
            continue;
          }
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: buyGate.side || 'bid',
            count: buyGate.count,
            price: buyGate.price,
            time_in_force: 'immediate_or_cancel',
            dry_run: false,
          });
          if (!placeResultShouldPersist(placeRes)) continue;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: buyGate.count,
          });
          const payPrice = Number(buyGate.pay_price ?? 0) || null;
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision === 'NO' ? 'NO' : 'YES',
            count: filled ? String(fillCount) : String(buyGate.count || 0),
            price: String(buyGate.price),
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : buyGate.notional_usd || 0,
            dryRun: false,
            status: filled ? 'FILLED' : 'CANCELLED',
            leanDiff: absGap,
            liveSpot: lean.live,
            strike: lean.strike,
            executedAt: now.toISOString(),
            orderId: placeRes.order_id ?? null,
            payPrice,
            fillCount: filled ? fillCount : 0,
            outcome: filled ? 'pending' : 'miss',
            pnlUsd: null,
            entryPath,
          };
          await saveTradeRecord(userId, tradeDoc);
          userTrades.unshift(tradeDoc);
          if (filled) {
            openPositions += 1;
            tradesToday += 1;
            tradesTodayList.push(tradeDoc);
            quoteTickers.add(marketTicker);
          }
          const priceVal = typeof buyGate.price === 'number' ? buyGate.price : parseFloat(String(buyGate.price || 0));
          lastTradeAction[asset] = filled
            ? {
                status: 'placed',
                detail: `placed ${placeDecision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
                at: tickIso,
              }
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
                entryPath,
              }),
              body: `${buyGate.count} ctr @ $${priceVal.toFixed(2)} · Cost $${(buyGate.notional_usd || 0).toFixed(2)}`,
              cfg,
              tokens: userTokens,
              collapseId: fillCollapseId(userId, tradeId),
              asset: lean.asset,
              ticker: marketTicker,
              tradeId,
              decision: placeDecision,
              at: now.toISOString(),
            });
          } else {
            await emitCloudAlert({
              userId,
              alertId: missAlertId(tradeId),
              kind: 'ioc_miss',
              title: iocMissAlertTitle(entryPath),
              body: iocMissAlertBody({
                asset,
                decision: String(placeDecision || ''),
                entryPath,
                price: priceVal,
                count: gate.count,
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
      if (still.length) watchUsers.set(userId, still);
      else watchUsers.delete(userId);
      await upsertUserDoc(userId, { lastTradeAction, lastTickAt: now.toISOString() } as any);
    } catch (err: any) {
      noteTransientKalshiFailure(err);
    }
  }
  await flushCheapLoopWatcher(now, snapshot?.leans || {});
  return { timestamp: now.toISOString(), watched };
}

/** Cap lock: richer ask first. Second size = first fill. 0-fill first burns the window and does not send the second. */
async function placeCapLockPair(opts: {
  userId: string;
  asset: string;
  marketTicker: string;
  client: KalshiClient;
  enter: CapLockEnterResult;
  userTrades: TradeRecordDoc[];
  cfg: Record<string, any>;
  userTokens: string[];
  now: Date;
  tickIso: string;
  absGap: number;
  liveSpot?: number | null;
  strike?: number | null;
  lastTradeAction: Partial<Record<string, LastTradeAction>>;
  dryRun: boolean;
  live: boolean;
  lean: { yes_ask?: number | null; no_ask?: number | null; yes_bid?: number | null; no_bid?: number | null };
}): Promise<{ okLegs: number; filledDocs: TradeRecordDoc[] }> {
  const first = opts.enter.first;
  if (!first?.ok || !first.price || !first.count) {
    opts.lastTradeAction[opts.asset] = skippedTradeAction(opts.enter.skip_reason || 'cap_lock_no_ask', opts.tickIso);
    return { okLegs: 0, filledDocs: [] };
  }
  const firstSide = (opts.enter.firstSide === 'NO' ? 'NO' : 'YES') as 'YES' | 'NO';
  const otherAsk = firstSide === 'YES' ? opts.lean.no_ask : opts.lean.yes_ask;
  const maxFirstPay = capLockFirstMaxPayUsd({
    firstSide,
    firstAskUsd: first.pay_price,
    otherAskUsd: otherAsk,
    count: first.count,
    maxLockLossUsd: opts.cfg?.risk?.cap_lock_max_loss_usd,
  });
  const firstGate = liveIocBuyGate(first, opts.marketTicker, opts.lean as never, maxFirstPay, true);
  if (!firstGate.ok || !firstGate.price || !firstGate.count) {
    opts.lastTradeAction[opts.asset] = skippedTradeAction(firstGate.skip_reason || 'ask_moved', opts.tickIso);
    return { okLegs: 0, filledDocs: [] };
  }
  const firstPay = Number(firstGate.pay_price) || 0;
  const otherPay = Number(otherAsk);
  if (
    !capLockFitsCap({
      yesAskUsd: firstSide === 'YES' ? firstPay : otherPay,
      noAskUsd: firstSide === 'NO' ? firstPay : otherPay,
      count: Number(firstGate.count) || 1,
      maxLockLossUsd: opts.cfg?.risk?.cap_lock_max_loss_usd,
    })
  ) {
    opts.lastTradeAction[opts.asset] = skippedTradeAction('cap_lock_too_rich', opts.tickIso);
    return { okLegs: 0, filledDocs: [] };
  }
  const persistLeg = async (
    gate: GateResult,
    decision: 'YES' | 'NO',
    res: Awaited<ReturnType<KalshiClient['placeOrder']>>
  ): Promise<TradeRecordDoc | null> => {
    if (!placeResultShouldPersist(res)) return null;
    const { fillCount, filled } = resolvedPlaceFillCount({
      dryRun: Boolean(res.dry_run) || opts.dryRun,
      fillCount: res.fill_count,
      intendedCount: gate.count,
    });
    if (!filled) return null;
    const payPrice = Number(gate.pay_price ?? 0) || null;
    const tradeDoc: TradeRecordDoc = {
      tradeId: `trade_${Date.now()}_${decision}_${Math.random().toString(36).slice(2, 7)}`,
      userId: opts.userId,
      ticker: opts.marketTicker,
      asset: opts.asset,
      decision,
      count: filled ? String(fillCount) : String(gate.count || 0),
      price: String(gate.price || ''),
      notionalUsd: filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : gate.notional_usd || 0,
      dryRun: opts.dryRun,
      status: filled ? 'FILLED' : 'CANCELLED',
      leanDiff: opts.absGap,
      liveSpot: opts.liveSpot ?? undefined,
      strike: opts.strike ?? undefined,
      executedAt: opts.now.toISOString(),
      orderId: res.order_id ?? null,
      payPrice,
      fillCount: filled ? fillCount : 0,
      outcome: filled ? 'pending' : 'miss',
      pnlUsd: null,
      entryPath: 'cap_lock',
    };
    await saveTradeRecord(opts.userId, tradeDoc);
    opts.userTrades.unshift(tradeDoc);
    if (!filled) {
      await emitCloudAlert({
        userId: opts.userId,
        alertId: missAlertId(tradeDoc.tradeId),
        kind: 'ioc_miss',
        title: iocMissAlertTitle('cap_lock'),
        body: iocMissAlertBody({
          asset: opts.asset,
          decision,
          entryPath: 'cap_lock',
          price: gate.pay_price,
          count: gate.count,
        }),
        cfg: opts.cfg as never,
        tokens: opts.userTokens,
        collapseId: `clm:${opts.userId}:${tradeDoc.tradeId}`.slice(0, 64),
        asset: opts.asset,
        ticker: opts.marketTicker,
        tradeId: tradeDoc.tradeId,
        at: opts.now.toISOString(),
      });
    }
    return tradeDoc;
  };

  const firstRes = await opts.client.placeOrder({
    ticker: opts.marketTicker,
    side: firstGate.side || 'bid',
    count: String(firstGate.count),
    price: String(firstGate.price),
    time_in_force: 'immediate_or_cancel',
    dry_run: opts.dryRun,
  });
  const firstDoc = await persistLeg(firstGate, firstSide, firstRes);
  const firstFill = firstDoc && firstDoc.outcome === 'pending' ? Number(firstDoc.fillCount) || 0 : 0;
  if (firstFill <= 0) {
    capLockMissAt.set(`${opts.userId}:${opts.marketTicker}`, opts.now.getTime());
    opts.lastTradeAction[opts.asset] = {
      status: 'placed',
      detail: 'Cap lock first miss',
      at: opts.tickIso,
    };
    return { okLegs: firstRes.ok ? 1 : 0, filledDocs: [] };
  }
  const secondAsk = firstSide === 'YES' ? opts.lean.no_ask : opts.lean.yes_ask;
  const second = evaluateCapLockSecondLeg({
    firstSide,
    firstFillUsd: firstDoc?.payPrice,
    firstFillCount: firstFill,
    secondAskUsd: secondAsk,
    maxLockLossUsd: opts.cfg?.risk?.cap_lock_max_loss_usd,
  });
  if (!second.ok || !second.gate.price || !second.gate.count) {
    opts.lastTradeAction[opts.asset] = {
      status: 'placed',
      detail: 'Cap lock unmatched · waiting second',
      at: opts.tickIso,
    };
    return { okLegs: 1, filledDocs: firstDoc && !firstDoc.dryRun ? [firstDoc] : [] };
  }
  const secondSide = firstSide === 'YES' ? 'NO' : 'YES';
  const secondGate = liveIocBuyGate(
    second.gate,
    opts.marketTicker,
    opts.lean as never,
    Number(second.gate.pay_price) || 0,
    true
  );
  if (!secondGate.ok || !secondGate.price || !secondGate.count) {
    opts.lastTradeAction[opts.asset] = {
      status: 'placed',
      detail: 'Cap lock unmatched · waiting second',
      at: opts.tickIso,
    };
    return { okLegs: 1, filledDocs: firstDoc && !firstDoc.dryRun ? [firstDoc] : [] };
  }
  const secondRes = await opts.client.placeOrder({
    ticker: opts.marketTicker,
    side: secondGate.side || 'bid',
    count: String(secondGate.count),
    price: String(secondGate.price),
    time_in_force: 'immediate_or_cancel',
    dry_run: opts.dryRun,
  });
  const secondDoc = await persistLeg(secondGate, secondSide, secondRes);
  const filledDocs = [firstDoc, secondDoc].filter((d): d is TradeRecordDoc => Boolean(d && !d.dryRun && d.outcome === 'pending'));
  opts.lastTradeAction[opts.asset] = {
    status: 'placed',
    detail: filledDocs.length >= 2 ? 'Cap lock locked' : 'Cap lock unmatched · waiting second',
    at: opts.tickIso,
  };
  return { okLegs: (firstRes.ok ? 1 : 0) + (secondRes.ok ? 1 : 0), filledDocs };
}

/** Lock-first first pair: POST YES and NO together. Sequential place waits ~4s for fill confirm, so the second IOC often misses and the filled leg dumps. */
async function placePairLockAtomicFirstPair(opts: {
  userId: string;
  asset: string;
  marketTicker: string;
  client: KalshiClient;
  runner: GateResult;
  hedge: GateResult;
  userTrades: TradeRecordDoc[];
  cfg: Record<string, any>;
  userTokens: string[];
  now: Date;
  tickIso: string;
  absGap: number;
  liveSpot?: number | null;
  strike?: number | null;
  lastTradeAction: Partial<Record<string, LastTradeAction>>;
  dryRun: boolean;
  live: boolean;
}): Promise<{ runnerFilled: boolean; hedgeFilled: boolean; okLegs: number; filledDocs: TradeRecordDoc[] }> {
  const runner = pairLockIocBuyGate(opts.runner, opts.marketTicker, null);
  const hedge = pairLockIocBuyGate(opts.hedge, opts.marketTicker, null);
  if (!runner.ok || !runner.price || !runner.count || !hedge.ok || !hedge.price || !hedge.count) {
    opts.lastTradeAction[opts.asset] = skippedTradeAction(
      (!runner.ok ? runner.skip_reason : hedge.skip_reason) || 'ask_moved',
      opts.tickIso
    );
    return { runnerFilled: false, hedgeFilled: false, okLegs: 0, filledDocs: [] };
  }
  const [runnerRes, hedgeRes] = await Promise.all([
    opts.client.placeOrder({
      ticker: opts.marketTicker,
      side: runner.side || 'bid',
      count: String(runner.count || '1'),
      price: String(runner.price || ''),
      time_in_force: 'immediate_or_cancel',
      dry_run: opts.dryRun,
    }),
    opts.client.placeOrder({
      ticker: opts.marketTicker,
      side: hedge.side || 'bid',
      count: String(hedge.count || '1'),
      price: String(hedge.price || ''),
      time_in_force: 'immediate_or_cancel',
      dry_run: opts.dryRun,
    }),
  ]);
  const legs = [
    { gate: runner, res: runnerRes, decision: (runner.decision === 'NO' ? 'NO' : 'YES') as 'YES' | 'NO', entryPath: 'pair_lock' as const, key: 'runner' as const },
    { gate: hedge, res: hedgeRes, decision: (hedge.decision === 'NO' ? 'NO' : 'YES') as 'YES' | 'NO', entryPath: 'pair_lock_hedge' as const, key: 'hedge' as const },
  ];
  let runnerFilled = false;
  let hedgeFilled = false;
  let okLegs = 0;
  const filledDocs: TradeRecordDoc[] = [];
  for (const leg of legs) {
    if (leg.res.ok) okLegs += 1;
    const { fillCount, filled } = resolvedPlaceFillCount({
      dryRun: Boolean(leg.res.dry_run) || opts.dryRun,
      fillCount: leg.res.fill_count,
      intendedCount: leg.gate.count,
    });
    if (!leg.res.ok && !filled && !leg.res.order_id) {
      opts.lastTradeAction[opts.asset] = {
        status: 'failed',
        detail: String(leg.res.error || 'order failed'),
        at: opts.tickIso,
      };
      continue;
    }
    const payPrice = Number(leg.gate.pay_price ?? 0) || null;
    const tradeId = `trade_${Date.now()}_${leg.key}_${Math.random().toString(36).slice(2, 7)}`;
    const priceVal = parseFloat(String(leg.gate.price || 0));
    const tradeDoc: TradeRecordDoc = {
      tradeId,
      userId: opts.userId,
      ticker: opts.marketTicker,
      asset: opts.asset,
      decision: leg.decision,
      count: filled ? String(fillCount) : String(leg.gate.count || 0),
      price: String(leg.gate.price || ''),
      notionalUsd:
        filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : leg.gate.notional_usd || 0,
      dryRun: opts.dryRun,
      status: filled ? 'FILLED' : 'CANCELLED',
      leanDiff: opts.absGap,
      liveSpot: opts.liveSpot ?? undefined,
      strike: opts.strike ?? undefined,
      executedAt: opts.now.toISOString(),
      orderId: leg.res.order_id ?? null,
      payPrice,
      fillCount: filled ? fillCount : 0,
      outcome: filled ? 'pending' : 'miss',
      pnlUsd: null,
      entryPath: leg.entryPath,
      pairLockAtomic: true,
    };
    await saveTradeRecord(opts.userId, tradeDoc);
    opts.userTrades.unshift(tradeDoc);
    await writeAuditLog(opts.userId, 'TRADE_TRIGGERED', {
      tradeId,
      ticker: opts.marketTicker,
      asset: opts.asset,
      decision: leg.decision,
      mode: opts.live ? 'live' : 'demo',
    });
    if (filled) {
      if (leg.key === 'runner') runnerFilled = true;
      else hedgeFilled = true;
      filledDocs.push(tradeDoc);
      await emitCloudAlert({
        userId: opts.userId,
        alertId: fillAlertId(tradeId),
        kind: 'order_filled',
        title: orderPlacedAlertTitle({
          live: opts.live,
          asset: opts.asset,
          decision: leg.decision,
          entryPath: leg.entryPath,
        }),
        body: `${leg.gate.count} ctr @ $${priceVal.toFixed(2)} · Cost $${(leg.gate.notional_usd || 0).toFixed(2)}`,
        cfg: opts.cfg as never,
        tokens: opts.userTokens,
        collapseId: fillCollapseId(opts.userId, tradeId),
        asset: opts.asset,
        ticker: opts.marketTicker,
        tradeId,
        decision: leg.decision,
        at: opts.now.toISOString(),
      });
    } else {
      await emitCloudAlert({
        userId: opts.userId,
        alertId: missAlertId(tradeId),
        kind: 'ioc_miss',
        title: iocMissAlertTitle(leg.entryPath),
        body: iocMissAlertBody({
          asset: opts.asset,
          decision: leg.decision,
          entryPath: leg.entryPath,
          price: priceVal,
          count: leg.gate.count,
        }),
        cfg: opts.cfg as never,
        tokens: opts.userTokens,
        asset: opts.asset,
        ticker: opts.marketTicker,
        tradeId,
        decision: leg.decision,
        at: opts.now.toISOString(),
      });
    }
  }
  const filledLegs = (runnerFilled ? 1 : 0) + (hedgeFilled ? 1 : 0);
  opts.lastTradeAction[opts.asset] =
    filledLegs > 0
      ? {
          status: 'placed',
          detail:
            filledLegs === 2
              ? `placed Pair lock lock · YES+NO`
              : runnerFilled
                ? `placed Pair lock ${opts.runner.decision || 'YES'} · unmatched`
                : `placed Pair lock hedge ${opts.hedge.decision || 'NO'} · unmatched`,
          at: opts.tickIso,
        }
      : { status: 'failed', detail: 'IOC no fill', at: opts.tickIso };
  return { runnerFilled, hedgeFilled, okLegs, filledDocs };
}

async function placePairLockStackAdd(opts: {
  userId: string;
  asset: string;
  marketTicker: string;
  client: KalshiClient;
  stack: PairLockStackAddResult;
  userTrades: TradeRecordDoc[];
  cfg: Record<string, any>;
  userTokens: string[];
  now: Date;
  tickIso: string;
  absGap: number;
  liveSpot?: number | null;
  strike?: number | null;
  lastTradeAction: Partial<Record<string, LastTradeAction>>;
  requestPrefix: string;
}): Promise<{ filledLegs: number }> {
  const stackReq = `${opts.requestPrefix}${opts.userId}_${opts.marketTicker}_${Date.now()}`.slice(0, 64);
  const existingStackBuys = Math.max(1, countWindowBuysForTicker(opts.userTrades, opts.marketTicker));
  const stackLock = await tryAcquirePlaceLock({
    userId: opts.userId,
    ticker: opts.marketTicker,
    cap: existingStackBuys + 1,
    requestId: stackReq,
    existingBuys: existingStackBuys,
  });
  if (!stackLock.ok) return { filledLegs: 0 };
  try {
    const yesGate = pairLockIocBuyGate(opts.stack.yes, opts.marketTicker, null);
    const noGate = pairLockIocBuyGate(opts.stack.no, opts.marketTicker, null);
    if (!yesGate.ok || !yesGate.price || !yesGate.count || !noGate.ok || !noGate.price || !noGate.count) {
      opts.lastTradeAction[opts.asset] = skippedTradeAction(
        (!yesGate.ok ? yesGate.skip_reason : noGate.skip_reason) || 'ask_moved',
        opts.tickIso
      );
      return { filledLegs: 0 };
    }
    const [yesRes, noRes] = await Promise.all([
      opts.client.placeOrder({
        ticker: opts.marketTicker,
        side: yesGate.side || 'bid',
        count: yesGate.count || opts.stack.count,
        price: yesGate.price || String(opts.stack.yesAsk),
        time_in_force: 'immediate_or_cancel',
        dry_run: false,
      }),
      opts.client.placeOrder({
        ticker: opts.marketTicker,
        side: noGate.side || 'ask',
        count: noGate.count || opts.stack.count,
        price: noGate.price || String(opts.stack.noAsk),
        time_in_force: 'immediate_or_cancel',
        dry_run: false,
      }),
    ]);
    const legs = [
      { gate: yesGate, res: yesRes, decision: 'YES' as const, entryPath: 'pair_lock' as const },
      { gate: noGate, res: noRes, decision: 'NO' as const, entryPath: 'pair_lock_hedge' as const },
    ];
    let filledLegs = 0;
    for (const leg of legs) {
      const { fillCount, filled } = resolvedPlaceFillCount({
        dryRun: Boolean(leg.res.dry_run),
        fillCount: leg.res.fill_count,
        intendedCount: leg.gate.count,
      });
      const payPrice = Number(leg.gate.pay_price ?? 0) || null;
      const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const priceVal = parseFloat(String(leg.gate.price || 0));
      const tradeDoc: TradeRecordDoc = {
        tradeId,
        userId: opts.userId,
        ticker: opts.marketTicker,
        asset: opts.asset,
        decision: leg.decision,
        count: filled ? String(fillCount) : String(leg.gate.count || 0),
        price: String(leg.gate.price || ''),
        notionalUsd:
          filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : leg.gate.notional_usd || 0,
        dryRun: false,
        status: filled ? 'FILLED' : 'CANCELLED',
        leanDiff: opts.absGap,
        liveSpot: opts.liveSpot ?? undefined,
        strike: opts.strike ?? undefined,
        executedAt: opts.now.toISOString(),
        orderId: leg.res.order_id ?? null,
        payPrice,
        fillCount: filled ? fillCount : 0,
        outcome: filled ? 'pending' : 'miss',
        pnlUsd: null,
        entryPath: leg.entryPath,
      };
      await saveTradeRecord(opts.userId, tradeDoc);
      opts.userTrades.unshift(tradeDoc);
      if (filled) {
        filledLegs += 1;
        await emitCloudAlert({
          userId: opts.userId,
          alertId: fillAlertId(tradeId),
          kind: 'order_filled',
          title: orderPlacedAlertTitle({
            live: true,
            asset: opts.asset,
            decision: leg.decision,
            entryPath: leg.entryPath,
          }),
          body: `${leg.gate.count} ctr @ $${priceVal.toFixed(2)} · Pair lock add pair`,
          cfg: opts.cfg as never,
          tokens: opts.userTokens,
          collapseId: fillCollapseId(opts.userId, tradeId),
          asset: opts.asset,
          ticker: opts.marketTicker,
          tradeId,
          decision: leg.decision,
          at: opts.now.toISOString(),
        });
      } else {
        await emitCloudAlert({
          userId: opts.userId,
          alertId: missAlertId(tradeId),
          kind: 'ioc_miss',
          title: iocMissAlertTitle(leg.entryPath),
          body: iocMissAlertBody({
            asset: opts.asset,
            decision: leg.decision,
            entryPath: leg.entryPath,
            price: priceVal,
            count: leg.gate.count,
          }),
          cfg: opts.cfg as never,
          tokens: opts.userTokens,
          asset: opts.asset,
          ticker: opts.marketTicker,
          tradeId,
          decision: leg.decision,
          at: opts.now.toISOString(),
        });
      }
    }
    opts.lastTradeAction[opts.asset] =
      filledLegs > 0
        ? { status: 'placed', detail: 'placed Pair lock add pair', at: opts.tickIso }
        : { status: 'failed', detail: 'IOC no fill', at: opts.tickIso };
    return { filledLegs };
  } finally {
    await releasePlaceLock({ userId: opts.userId, ticker: opts.marketTicker, requestId: stackReq });
  }
}

async function maybePlacePairLockStackAfterLock(opts: {
  lots: ReturnType<typeof pairLockLotsForTicker>;
  quotes: { yes_bid?: number | null; yes_ask?: number | null; no_bid?: number | null; no_ask?: number | null };
  addPairs?: unknown;
  lotCount?: unknown;
  minLockUsd?: unknown;
  flattenMinutes?: unknown;
  runnerStopUsd?: unknown;
  lean: { phase?: string; minutes_left?: number; minutes_remaining?: number };
  now: Date;
  skipThinBid: boolean;
  marketTicker: string;
  userId: string;
  asset: string;
  client: KalshiClient;
  userTrades: TradeRecordDoc[];
  cfg: Record<string, any>;
  userTokens: string[];
  tickIso: string;
  absGap: number;
  liveSpot?: number | null;
  strike?: number | null;
  lastTradeAction: Partial<Record<string, LastTradeAction>>;
  requestPrefix: string;
}): Promise<{ filledLegs: number; lots: ReturnType<typeof pairLockLotsForTicker> }> {
  if (!opts.lots.locked || opts.lots.unmatched) return { filledLegs: 0, lots: opts.lots };
  if (!shouldWatchPairLockLots({ lots: opts.lots, addPairs: opts.addPairs, lotCount: opts.lotCount })) {
    return { filledLegs: 0, lots: opts.lots };
  }
  const yesBidSize = await cashOutBestBidSize(opts.marketTicker, 'YES', opts.skipThinBid);
  const noBidSize = await cashOutBestBidSize(opts.marketTicker, 'NO', opts.skipThinBid);
  const watch = evaluatePairLockWatch({
    lots: opts.lots,
    quotes: opts.quotes,
    minLockUsd: opts.minLockUsd,
    flattenMinutes: opts.flattenMinutes,
    runnerStopUsd: opts.runnerStopUsd,
    addPairs: opts.addPairs,
    lotCount: opts.lotCount,
    recoverSeconds: opts.cfg?.risk?.pair_lock_recover_seconds,
    lean: opts.lean,
    now: opts.now,
    skipThinBid: opts.skipThinBid,
    yesBidSize,
    noBidSize,
  });
  if (!(watch.kind === 'stack' && watch.stack?.ok && watch.stack.yes.ok && watch.stack.no.ok)) {
    if (watch.reason === 'pair_lock_min_lock' || watch.reason === 'pair_lock_too_late') {
      opts.lastTradeAction[opts.asset] = skippedTradeAction(watch.reason, opts.tickIso);
    }
    return { filledLegs: 0, lots: opts.lots };
  }
  const placed = await placePairLockStackAdd({
    userId: opts.userId,
    asset: opts.asset,
    marketTicker: opts.marketTicker,
    client: opts.client,
    stack: watch.stack,
    userTrades: opts.userTrades,
    cfg: opts.cfg,
    userTokens: opts.userTokens,
    now: opts.now,
    tickIso: opts.tickIso,
    absGap: opts.absGap,
    liveSpot: opts.liveSpot,
    strike: opts.strike,
    lastTradeAction: opts.lastTradeAction,
    requestPrefix: opts.requestPrefix,
  });
  return { filledLegs: placed.filledLegs, lots: pairLockLotsForTicker(opts.userTrades, opts.marketTicker) };
}

export async function runCapLockWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const now = snapshot?.now ?? new Date();
  if (capLockWatchUsers.size === 0) {
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const sysConfig = await getSystemConfig();
  const featureFlags = normalizeFeatureFlags(sysConfig?.featureFlags);
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }
  if (!featureFlags.capLock) {
    capLockWatchUsers.clear();
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;
  for (const [userId, userAssets] of [...capLockWatchUsers.entries()]) {
    const user = byId.get(userId);
    const cfg = user?.config || defaultAppConfig();
    if (!user || !cfg.auto_trade_enabled || user.state !== 'ARMED' || !cfg.risk?.cap_lock_enabled) {
      capLockWatchUsers.delete(userId);
      continue;
    }
    const secret = await getUserSecret(userId);
    if (!secret?.privateKeyPem || !secret.keyId) continue;
    const isLive = cfg.execution_mode === 'live' && user.state === 'ARMED';
    const client = cloudKalshi(secret.keyId, secret.privateKeyPem, isLive ? 'production' : 'demo');
    const userTrades = await getTradeRecords(userId);
    const keep: string[] = [];
    for (const asset of userAssets) {
      const row = snapshot?.leans?.[asset];
      const ticker = String(row?.market_ticker || '').trim();
      if (!ticker) continue;
      const lots = capLockLotsForTicker(userTrades, ticker);
      if (!shouldWatchCapLockLots(lots)) continue;
      keep.push(asset);
      watched += 1;
      const retryKey = `${userId}:${ticker}`;
      const watchRes = await runCloudCapLockWatch({
        userId,
        asset,
        ticker,
        lean: {
          yes_bid: row?.yes_bid,
          yes_ask: row?.yes_ask,
          no_bid: row?.no_bid,
          no_ask: row?.no_ask,
          minutes_remaining: row?.minutes_remaining,
          minutes_left: row?.minutes_left,
        },
        trades: userTrades,
        maxLockLossUsd: cfg.risk?.cap_lock_max_loss_usd,
        alreadyRetried: capLockRetryKeys.has(retryKey),
        dryRun: !isLive,
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
      if (watchRes.kind === 'retry_second' && watchRes.secondGate?.price && watchRes.secondGate.count) {
        capLockRetryKeys.add(retryKey);
        const second = watchRes.secondGate;
        const secondSide = second.decision === 'NO' ? 'NO' : 'YES';
        const placeRes = await client.placeOrder({
          ticker,
          side: second.side === 'ask' ? 'ask' : 'bid',
          count: String(second.count),
          price: String(second.price),
          time_in_force: 'immediate_or_cancel',
          dry_run: !isLive,
        });
        if (placeResultShouldPersist(placeRes)) {
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run) || !isLive,
            fillCount: placeRes.fill_count,
            intendedCount: second.count,
          });
          const tradeDoc: TradeRecordDoc = {
            tradeId: `trade_${Date.now()}_cap2_${Math.random().toString(36).slice(2, 7)}`,
            userId,
            ticker,
            asset,
            decision: secondSide,
            count: filled ? String(fillCount) : String(second.count || 0),
            price: String(second.price),
            notionalUsd: filled ? Math.round(fillCount * (Number(second.pay_price) || 0) * 100) / 100 : 0,
            dryRun: !isLive,
            status: filled ? 'FILLED' : 'CANCELLED',
            leanDiff: 0,
            liveSpot: undefined,
            strike: undefined,
            executedAt: now.toISOString(),
            orderId: placeRes.order_id ?? null,
            payPrice: Number(second.pay_price ?? 0) || null,
            fillCount: filled ? fillCount : 0,
            outcome: filled ? 'pending' : 'miss',
            pnlUsd: null,
            entryPath: 'cap_lock',
          };
          await saveTradeRecord(userId, tradeDoc);
          userTrades.unshift(tradeDoc);
        }
      }
    }
    if (keep.length) capLockWatchUsers.set(userId, keep);
    else capLockWatchUsers.delete(userId);
  }
  return { timestamp: now.toISOString(), watched };
}

export async function runPairLockWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const now = snapshot?.now ?? new Date();
  if (pairLockWatchUsers.size === 0) {
    await flushPairLockWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const sysConfig = await getSystemConfig();
  const featureFlags = normalizeFeatureFlags(sysConfig?.featureFlags);
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }
  if (!featureFlags.pairLock) {
    pairLockWatchUsers.clear();
    await flushPairLockWatcher(now, {});
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const watchAssets = [...new Set([...pairLockWatchUsers.values()].flat())] as AssetKey[];
  const sharedLeans = await sharedLeansForWatch(watchAssets, now, snapshot);
  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;
  for (const [userId, userAssets] of [...pairLockWatchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      pairLockWatchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      if (!cfg.auto_trade_enabled || user.state !== 'ARMED' || !cfg.risk?.pair_lock_enabled) {
        pairLockWatchUsers.delete(userId);
        continue;
      }
      const userTrades = await getTradeRecords(userId);
      const tradesTodayList = liveCloudTradesToday(userTrades, now);
      let tradesToday = tradesTodayList.length;
      const dailyPnlUsd = cloudDailyRealizedPnl(tradesTodayList);
      let openPositions = userTrades.filter(
        (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
      ).length;
      const lastTradeAction = copyLastTradeActions(user);
      const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
        (t, i, arr) => t && arr.indexOf(t) === i
      );
      const tickIso = now.toISOString();
      const still: string[] = [];
      for (const asset of userAssets) {
        const lean = sharedLeans[asset];
        if (!lean?.market_ticker) continue;
        const closeUtc = resolveTwapCloseUtc(lean, now);
        if (!closeUtc) continue;
        if (
          pairLockTwapOwns({
            twapAdminEnabled: featureFlags.twapLock,
            twapUserEnabled: Boolean(cfg.risk?.twap_lock_enabled),
            twapAssets: cfg.risk?.twap_lock_assets,
            asset,
          })
        ) {
          lastTradeAction[asset] = skippedTradeAction('pair_lock_twap_owns', tickIso);
          continue;
        }
        still.push(asset);
        watched += 1;
        const quoted = await overlayWatchLean(lean, snapshot);
        const marketTicker = quoted.market_ticker;
        let lots = pairLockLotsForTicker(userTrades, marketTicker);
        const pairSkipThin = resolveSkipThinBid(cfg.risk, 'pair_lock');
        if (
          shouldWatchPairLockLots({
            lots,
            addPairs: cfg.risk?.pair_lock_add_pairs,
            lotCount: cfg.risk?.pair_lock_lot_count,
          })
        ) {
          const secret = await getUserSecret(userId);
          if (secret?.privateKeyPem && secret.keyId) {
            const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
            const watch = evaluatePairLockWatch({
              lots,
              quotes: {
                yes_bid: quoted.yes_bid,
                yes_ask: quoted.yes_ask,
                no_bid: quoted.no_bid,
                no_ask: quoted.no_ask,
              },
              minLockUsd: cfg.risk?.pair_lock_min_lock_usd,
              flattenMinutes: cfg.risk?.pair_lock_flatten_minutes,
              runnerStopUsd: cfg.risk?.pair_lock_runner_stop_usd,
              addPairs: cfg.risk?.pair_lock_add_pairs,
              lotCount: cfg.risk?.pair_lock_lot_count,
              recoverSeconds: cfg.risk?.pair_lock_recover_seconds,
              lean: {
                phase: lean.phase === 'live' ? 'live' : 'ended',
                minutes_left: lean.minutes_left,
                minutes_remaining: lean.minutes_remaining,
              },
              filledAt: lots.extraFilledAt ?? lots.runnerFilledAt,
              now,
              skipThinBid: pairSkipThin,
              hedgeBidSize: await cashOutBestBidSize(
                marketTicker,
                (lots.extraSide || lots.runnerSide) === 'YES' ? 'NO' : 'YES',
                pairSkipThin
              ),
              flattenBidSize: await cashOutBestBidSize(
                marketTicker,
                lots.extraSide || lots.runnerSide || lean.decision,
                pairSkipThin
              ),
              yesBidSize: await cashOutBestBidSize(marketTicker, 'YES', pairSkipThin),
              noBidSize: await cashOutBestBidSize(marketTicker, 'NO', pairSkipThin),
            });
            if (
              (watch.kind === 'hedge' || watch.kind === 'stack_finish') &&
              watch.hedge?.ok &&
              watch.hedge.price &&
              watch.hedge.count
            ) {
              const hedgeReq = `plw_${userId}_${marketTicker}_${Date.now()}`.slice(0, 64);
              const hedgeLock = await tryAcquirePlaceLock({
                userId,
                ticker: marketTicker,
                cap: Math.max(2, windowBuyCap(cfg.risk) + 1),
                requestId: hedgeReq,
                existingBuys: 1,
              });
              if (hedgeLock.ok) {
                let hedgeFilled = false;
                try {
                  const buyHedge = pairLockIocBuyGate(watch.hedge, marketTicker, lean);
                  if (!buyHedge.ok || !buyHedge.price || !buyHedge.count) {
                    lastTradeAction[asset] = skippedTradeAction(buyHedge.skip_reason || 'ask_moved', tickIso);
                  } else {
                  const placeRes = await client.placeOrder({
                    ticker: marketTicker,
                    side: buyHedge.side || 'bid',
                    count: buyHedge.count,
                    price: buyHedge.price,
                    time_in_force: 'immediate_or_cancel',
                    dry_run: false,
                  });
                  const { fillCount, filled } = resolvedPlaceFillCount({
                    dryRun: Boolean(placeRes.dry_run),
                    fillCount: placeRes.fill_count,
                    intendedCount: buyHedge.count,
                  });
                  hedgeFilled = filled;
                  const payPrice = Number(buyHedge.pay_price ?? 0) || null;
                  const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                  const hedgeDecision = watch.hedge.decision === 'NO' ? 'NO' : 'YES';
                  const tradeDoc: TradeRecordDoc = {
                    tradeId,
                    userId,
                    ticker: marketTicker,
                    asset,
                    decision: hedgeDecision,
                    count: filled ? String(fillCount) : String(buyHedge.count || 0),
                    price: String(buyHedge.price),
                    notionalUsd:
                      filled && payPrice
                        ? Math.round(fillCount * payPrice * 100) / 100
                        : buyHedge.notional_usd || 0,
                    dryRun: false,
                    status: filled ? 'FILLED' : 'CANCELLED',
                    leanDiff: Number(lean.abs_gap) || 0,
                    liveSpot: lean.live,
                    strike: lean.strike,
                    executedAt: now.toISOString(),
                    orderId: placeRes.order_id ?? null,
                    payPrice,
                    fillCount: filled ? fillCount : 0,
                    outcome: filled ? 'pending' : 'miss',
                    pnlUsd: null,
                    entryPath: 'pair_lock_hedge',
                  };
                  await saveTradeRecord(userId, tradeDoc);
                  userTrades.unshift(tradeDoc);
                  lots = pairLockLotsForTicker(userTrades, marketTicker);
                  const priceVal = parseFloat(String(buyHedge.price || 0));
                  lastTradeAction[asset] = filled
                    ? {
                        status: 'placed',
                        detail: `placed Pair lock hedge ${hedgeDecision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
                        at: tickIso,
                      }
                    : { status: 'failed', detail: 'IOC no fill', at: tickIso };
                  if (filled) {
                    const locked = pairLockLockedUsd(
                      lots.runnerSide === 'YES' ? lots.runnerFillUsd : lots.hedgeFillUsd,
                      lots.runnerSide === 'NO' ? lots.runnerFillUsd : lots.hedgeFillUsd
                    );
                    const cents = locked != null ? Math.round(locked * 100) : 0;
                    await emitCloudAlert({
                      userId,
                      alertId: fillAlertId(tradeId),
                      kind: 'order_filled',
                      title: orderPlacedAlertTitle({
                        live: true,
                        asset,
                        decision: hedgeDecision,
                        entryPath: 'pair_lock_hedge',
                      }),
                      body:
                        cents > 0
                          ? `${buyHedge.count} ctr @ $${priceVal.toFixed(2)} · Pair lock locked · +${cents}¢`
                          : `${buyHedge.count} ctr @ $${priceVal.toFixed(2)}`,
                      cfg: cfg as never,
                      tokens: userTokens,
                      collapseId: fillCollapseId(userId, tradeId),
                      asset,
                      ticker: marketTicker,
                      tradeId,
                      decision: hedgeDecision,
                      at: now.toISOString(),
                    });
                  } else {
                    await emitCloudAlert({
                      userId,
                      alertId: missAlertId(tradeId),
                      kind: 'ioc_miss',
                      title: iocMissAlertTitle('pair_lock_hedge'),
                      body: iocMissAlertBody({
                        asset,
                        decision: hedgeDecision,
                        entryPath: 'pair_lock_hedge',
                        price: priceVal,
                        count: buyHedge.count,
                      }),
                      cfg: cfg as never,
                      tokens: userTokens,
                      asset,
                      ticker: marketTicker,
                      tradeId,
                      decision: hedgeDecision,
                      at: now.toISOString(),
                    });
                  }
                  }
                } finally {
                  await releasePlaceLock({ userId, ticker: marketTicker, requestId: hedgeReq });
                }
                if (hedgeFilled) {
                  const stacked = await maybePlacePairLockStackAfterLock({
                    lots,
                    quotes: {
                      yes_bid: quoted.yes_bid,
                      yes_ask: quoted.yes_ask,
                      no_bid: quoted.no_bid,
                      no_ask: quoted.no_ask,
                    },
                    addPairs: cfg.risk?.pair_lock_add_pairs,
                    lotCount: cfg.risk?.pair_lock_lot_count,
                    minLockUsd: cfg.risk?.pair_lock_min_lock_usd,
                    flattenMinutes: cfg.risk?.pair_lock_flatten_minutes,
                    runnerStopUsd: cfg.risk?.pair_lock_runner_stop_usd,
                    lean: {
                      phase: lean.phase === 'live' ? 'live' : 'ended',
                      minutes_left: lean.minutes_left,
                      minutes_remaining: lean.minutes_remaining,
                    },
                    now,
                    skipThinBid: pairSkipThin,
                    marketTicker,
                    userId,
                    asset,
                    client,
                    userTrades,
                    cfg,
                    userTokens,
                    tickIso,
                    absGap: Number(lean.abs_gap) || 0,
                    liveSpot: lean.live,
                    strike: lean.strike,
                    lastTradeAction,
                    requestPrefix: 'plws_',
                  });
                  lots = stacked.lots;
                }
              }
            } else if (
              watch.kind === 'flatten' ||
              watch.kind === 'thin_bid' ||
              watch.kind === 'runner_stop' ||
              watch.kind === 'stack_dump' ||
              watch.kind === 'atomic_dump' ||
              watch.kind === 'runner_take'
            ) {
              const pairRes = await runCloudPairLockFlatten({
                userId,
                asset,
                ticker: marketTicker,
                lean: {
                  phase: lean.phase === 'live' ? 'live' : 'ended',
                  minutes_left: lean.minutes_left,
                  minutes_remaining: lean.minutes_remaining,
                  yes_bid: quoted.yes_bid,
                  yes_ask: quoted.yes_ask,
                  no_bid: quoted.no_bid,
                  no_ask: quoted.no_ask,
                },
                trades: userTrades,
                flattenMinutes: cfg.risk?.pair_lock_flatten_minutes,
                runnerStopUsd: cfg.risk?.pair_lock_runner_stop_usd,
                minLockUsd: cfg.risk?.pair_lock_min_lock_usd,
                skipThinBid: pairSkipThin,
                bidSize: await cashOutBestBidSize(
                  marketTicker,
                  lots.extraSide || lots.runnerSide || lean.decision,
                  pairSkipThin
                ),
                slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
                dryRun: false,
                now,
                forceExtra:
                  watch.kind === 'stack_dump' ||
                  watch.kind === 'atomic_dump' ||
                  watch.kind === 'runner_take',
                place: (input) => client.placeOrder(input),
              });
              for (const alert of pairRes.alerts) {
                await emitCloudAlert({
                  userId,
                  alertId: protectAlertId(alert.tradeId),
                  kind: 'protect_sell',
                  title: alert.title,
                  body: alert.body,
                  cfg: cfg as never,
                  tokens: userTokens,
                  collapseId: `plk:${userId}:${alert.tradeId}`.slice(0, 64),
                  asset,
                  ticker: marketTicker,
                  tradeId: alert.tradeId,
                  at: now.toISOString(),
                });
              }
              if (pairRes.exited > 0) {
                lastTradeAction[asset] = {
                  status: 'placed',
                  detail:
                    watch.kind === 'runner_stop'
                      ? `Pair lock runner stop · sold ${pairRes.exited}`
                      : watch.kind === 'stack_dump'
                        ? `Pair lock add pair dump · sold ${pairRes.exited}`
                        : watch.kind === 'atomic_dump'
                          ? `Pair lock unmatched dump · sold ${pairRes.exited}`
                          : watch.kind === 'runner_take'
                            ? `Pair lock runner take · sold ${pairRes.exited}`
                            : `Pair lock flatten · sold ${pairRes.exited}`,
                  at: tickIso,
                };
                openPositions = Math.max(0, openPositions - pairRes.exited);
                lots = pairLockLotsForTicker(userTrades, marketTicker);
              }
            } else if (watch.kind === 'stack' && watch.stack?.ok && watch.stack.yes.ok && watch.stack.no.ok) {
              await placePairLockStackAdd({
                userId,
                asset,
                marketTicker,
                client,
                stack: watch.stack,
                userTrades,
                cfg,
                userTokens,
                now,
                tickIso,
                absGap: Number(lean.abs_gap) || 0,
                liveSpot: lean.live,
                strike: lean.strike,
                lastTradeAction,
                requestPrefix: 'plws_',
              });
              lots = pairLockLotsForTicker(userTrades, marketTicker);
            } else if (
              watch.kind === 'hold_locked' &&
              (watch.reason === 'pair_lock_min_lock' || watch.reason === 'pair_lock_too_late')
            ) {
              lastTradeAction[asset] = skippedTradeAction(watch.reason, tickIso);
            }
          }
        }
        if (tickerHasOpenPairLock(userTrades, marketTicker)) continue;
        if (
          cheapLoopCooldownOwnsTicker({
            adminEnabled: featureFlags.cheapLoop,
            userEnabled: Boolean(cfg.risk?.cheap_loop_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.cheap_loop_assets,
            trades: userTrades,
            marketTicker,
            cooldownMinutes: cfg.risk?.cheap_loop_cooldown_minutes,
            cycles: cfg.risk?.cheap_loop_cycles,
            flattenMinutes: cfg.risk?.cheap_loop_flatten_minutes,
            lean,
            now,
          })
        ) {
          continue;
        }
        const lastMinuteTimes = lastMinuteTimingFromRisk(cfg.risk);
        const lastMinuteOwnsNewBuys =
          isLastMinuteEnterPath({
            adminEnabled: featureFlags.lastMinute,
            userEnabled: Boolean(cfg.risk?.last_minute_enabled),
            assetEnabled: cfg.assets_enabled?.[asset] !== false,
            asset,
            assets: cfg.risk?.last_minute_assets,
          }) &&
          isLastMinuteWindow(now, closeUtc, lastMinuteTimes.enterSec, lastMinuteTimes.stopSec);
        const windowCap = windowBuyCap(cfg.risk);
        const existingBuys = countWindowBuysForTicker(userTrades, marketTicker);
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
          yes_ask: quoted.yes_ask ?? undefined,
          no_ask: quoted.no_ask ?? undefined,
          yes_bid: quoted.yes_bid ?? undefined,
          no_bid: quoted.no_bid ?? undefined,
          timeseries: lean.timeseries,
          open_utc: lean.open_utc,
          close_utc: lean.close_utc,
        };
        const gate = evaluatePairLockEnter({
          lean: leanForGate,
          cfg,
          adminEnabled: featureFlags.pairLock,
          twapAdminEnabled: featureFlags.twapLock,
          openPositions,
          tradesToday,
          assetTradesInWindow: existingBuys,
          dailyPnlUsd,
          hasOpenOnTicker: tickerHasOpenOtherThanPairLock(userTrades, marketTicker),
          lastMinuteOwnsNewBuys,
          skipThinBid: pairSkipThin,
          bidSize: await cashOutBestBidSize(marketTicker, lean.decision, pairSkipThin),
        });
        if (!gate.ok || !gate.price || !gate.count) {
          lastTradeAction[asset] = skippedTradeAction(gate.skip_reason || 'notional_too_small', tickIso);
          continue;
        }
        const secret = await getUserSecret(userId);
        if (!secret?.privateKeyPem || !secret.keyId) continue;
        const placeRequestId = `pl_${userId}_${marketTicker}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`.slice(0, 64);
        const claimed = await tryAcquirePlaceLock({
          userId,
          ticker: marketTicker,
          cap: windowCap,
          requestId: placeRequestId,
          existingBuys,
        });
        if (!claimed.ok) continue;
        const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
        const placeDecision = gate.decision || lean.decision;
        try {
          if (gate.atomic && gate.hedge?.ok && gate.hedge.price && gate.hedge.count) {
            const placed = await placePairLockAtomicFirstPair({
              userId,
              asset,
              marketTicker,
              client,
              runner: gate,
              hedge: gate.hedge,
              userTrades,
              cfg,
              userTokens,
              now,
              tickIso,
              absGap,
              liveSpot: lean.live,
              strike: lean.strike,
              lastTradeAction,
              dryRun: false,
              live: true,
            });
            for (const doc of placed.filledDocs) {
              openPositions += 1;
              tradesToday += 1;
              tradesTodayList.push(doc);
            }
          } else {
          const buyGate = pairLockIocBuyGate(gate, marketTicker, lean);
          if (!buyGate.ok || !buyGate.price || !buyGate.count) {
            lastTradeAction[asset] = skippedTradeAction(buyGate.skip_reason || 'ask_moved', tickIso);
          } else {
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: buyGate.side || 'bid',
            count: buyGate.count,
            price: buyGate.price,
            time_in_force: 'immediate_or_cancel',
            dry_run: false,
          });
          if (!placeResultShouldPersist(placeRes)) continue;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: buyGate.count,
          });
          const payPrice = Number(buyGate.pay_price ?? 0) || null;
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision === 'NO' ? 'NO' : 'YES',
            count: filled ? String(fillCount) : String(buyGate.count || 0),
            price: String(buyGate.price),
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : buyGate.notional_usd || 0,
            dryRun: false,
            status: filled ? 'FILLED' : 'CANCELLED',
            leanDiff: absGap,
            liveSpot: lean.live,
            strike: lean.strike,
            executedAt: now.toISOString(),
            orderId: placeRes.order_id ?? null,
            payPrice,
            fillCount: filled ? fillCount : 0,
            outcome: filled ? 'pending' : 'miss',
            pnlUsd: null,
            entryPath: 'pair_lock',
            pairLockAtomic: gate.atomic === true ? true : undefined,
          };
          await saveTradeRecord(userId, tradeDoc);
          userTrades.unshift(tradeDoc);
          if (filled) {
            openPositions += 1;
            tradesToday += 1;
            tradesTodayList.push(tradeDoc);
          }
          const priceVal = typeof buyGate.price === 'number' ? buyGate.price : parseFloat(String(buyGate.price || 0));
          lastTradeAction[asset] = filled
            ? {
                status: 'placed',
                detail: `placed ${placeDecision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
                at: tickIso,
              }
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
                entryPath: 'pair_lock',
              }),
              body: `${buyGate.count} ctr @ $${priceVal.toFixed(2)} · Cost $${(buyGate.notional_usd || 0).toFixed(2)}`,
              cfg,
              tokens: userTokens,
              collapseId: fillCollapseId(userId, tradeId),
              asset: lean.asset,
              ticker: marketTicker,
              tradeId,
              decision: placeDecision,
              at: now.toISOString(),
            });
          } else {
            await emitCloudAlert({
              userId,
              alertId: missAlertId(tradeId),
              kind: 'ioc_miss',
              title: iocMissAlertTitle('pair_lock'),
              body: iocMissAlertBody({
                asset,
                decision: String(placeDecision || ''),
                entryPath: 'pair_lock',
                price: priceVal,
                count: buyGate.count,
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
          }
          }
        } finally {
          await releasePlaceLock({ userId, ticker: marketTicker, requestId: placeRequestId });
        }
      }
      const keep = still.filter((assetKey) => {
        const row = sharedLeans[assetKey];
        const ticker = String(row?.market_ticker || '').trim();
        return shouldWatchPairLockTicker({
          lots: pairLockLotsForTicker(userTrades, ticker),
          addPairs: cfg.risk?.pair_lock_add_pairs,
          lotCount: cfg.risk?.pair_lock_lot_count,
          minutesElapsed: row?.minutes_elapsed,
          startMinutes: cfg.risk?.pair_lock_start_minutes,
          untilMinutes: cfg.risk?.pair_lock_until_minutes,
        });
      });
      if (keep.length) pairLockWatchUsers.set(userId, keep);
      else pairLockWatchUsers.delete(userId);
      await upsertUserDoc(userId, { lastTradeAction, lastTickAt: now.toISOString() } as any);
    } catch (err: any) {
      noteTransientKalshiFailure(err);
    }
  }
  await flushPairLockWatcher(now, sharedLeans);
  return { timestamp: now.toISOString(), watched };
}

/** Quote + exit only for users that already hold a Cash out lot. No new buys. */
export async function runCashOutBidWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const now = snapshot?.now ?? new Date();
  if (cashOutWatchUsers.size === 0 && goldFadeWatchUsers.size === 0) {
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const sysConfig = await getSystemConfig();
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }

  const watchAssets = [
    ...new Set([...cashOutWatchUsers.values(), ...goldFadeWatchUsers.values()].flat()),
  ] as AssetKey[];
  const sharedLeans = await sharedLeansForWatch(watchAssets, now, snapshot);

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
      const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
      for (const asset of assets) {
        const rawLean = sharedLeans[asset];
        if (!rawLean?.market_ticker) continue;
        const lean = await overlayWatchLean(rawLean, snapshot);
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
      const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
      const fadeSkipThin = resolveSkipThinBid(cfg.risk, 'gold_fade');
      for (const asset of assets) {
        const rawLean = sharedLeans[asset];
        if (!rawLean?.market_ticker) continue;
        const lean = await overlayWatchLean(rawLean, snapshot);
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

export async function runProtectWatchTick(
  snapshot?: OneSecondMarketSnapshot | null
): Promise<{
  timestamp: string;
  watched: number;
  paused?: boolean;
}> {
  const now = snapshot?.now ?? new Date();
  if (protectWatchUsers.size === 0) {
    return { timestamp: now.toISOString(), watched: 0 };
  }
  const sysConfig = await getSystemConfig();
  setActiveKalshiRetryPolicy(sysConfig?.kalshiRetry);
  if (isCloudKalshiPaused()) {
    return { timestamp: now.toISOString(), watched: 0, paused: true };
  }

  const watchAssets = [...new Set([...protectWatchUsers.values()].flat())] as AssetKey[];
  const sharedLeans = await sharedLeansForWatch(watchAssets, now, snapshot);

  const activeUsers = await getEnrolledActiveUsers();
  const byId = new Map(activeUsers.map((u) => [u.userId, u]));
  let watched = 0;

  for (const [userId, assets] of [...protectWatchUsers.entries()]) {
    const user = byId.get(userId);
    if (!user) {
      protectWatchUsers.delete(userId);
      continue;
    }
    try {
      const cfg = user.config || defaultAppConfig();
      if (!homeAutoExitWatchNeeded(cfg.risk) || user.state === 'KILL_SWITCH') {
        protectWatchUsers.delete(userId);
        continue;
      }
      const rawTrades = await getTradeRecords(userId);
      const quoteCache = createQuoteCache();
      const userTrades = await settlePendingCloudTrades(userId, rawTrades, now, quoteCache);
      const stillOpen = openProtectWatchAssets(userTrades, now);
      if (stillOpen.length === 0) {
        protectWatchUsers.delete(userId);
        continue;
      }
      if (cachedSecretMissing(user)) continue;
      const secret = await getUserSecret(userId);
      if (!secret?.privateKeyPem || !secret.keyId) continue;
      const client = cloudKalshi(secret.keyId, secret.privateKeyPem, 'production');
      const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
        (t, i, arr) => t && arr.indexOf(t) === i
      );
      const protectEnabled = Boolean(cfg.risk?.protect_sell_enabled);
      for (const asset of assets) {
        const rawLean = sharedLeans[asset];
        if (!rawLean?.market_ticker) continue;
        const lean = await overlayWatchLean(rawLean, snapshot);
        const marketTicker = lean.market_ticker;
        if (pendingProtectTradesForMarket(userTrades, marketTicker, now).length === 0) continue;
        watched += 1;
        const absGap = Number.isFinite(Number(lean.abs_gap))
          ? Number(lean.abs_gap)
          : Math.abs((lean.live || 0) - (lean.strike || 0));
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
          cushion: cfg.cushions?.[asset] ?? 25,
          gapRatio: Number(cfg.risk?.protect_sell_gap_ratio ?? 1),
          graceSeconds: Number(cfg.risk?.protect_sell_grace_seconds ?? 45),
          slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
          enabled: protectEnabled,
          homeSellAtPct: cfg.risk?.home_sell_at_pct,
          cushionLeanSellAtPct: cfg.risk?.cushion_lean_sell_at_pct,
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
      const still = openProtectWatchAssets(userTrades, now);
      if (still.length) protectWatchUsers.set(userId, still);
      else protectWatchUsers.delete(userId);
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

async function refreshHomeQuoteAssetsIfStale(now: Date): Promise<void> {
  if (homeQuoteAssets.length && now.getTime() - lastHomeQuoteAt < 10_000) return;
  try {
    homeQuoteAssets = collectHomeQuoteAssets(await getEnrolledActiveUsers()) as AssetKey[];
    lastHomeQuoteAt = now.getTime();
    dropSharedLeansNotIn(homeQuoteAssets);
    dropAskTickersNotIn(homeQuoteAssets);
  } catch {
    /* keep last chips */
  }
}

async function runOneSecondPathWatchers(pulseNow: Date): Promise<void> {
  // Always refresh first so Sell at / Protect lots arm 1s even when the map was empty last beat.
  await refreshDumpWatchFromTradeBooks(pulseNow);
  const watchAssets = oneSecondWatchAssets();
  const snap = watchAssets.length ? await buildOneSecondMarketSnapshot(watchAssets, pulseNow) : null;
  if (snap) {
    homeTickerByAsset = rememberTickersFromLeans(homeTickerByAsset, snap.leans);
    rememberAskTickersFromLeans(snap.leans);
  }
  if (isCloudKalshiPaused()) return;
  const places = await Promise.all([
    twapLockWatchUsers.size > 0 ? runTwapLockWatchTick(snap) : null,
    lastMinuteWatchUsers.size > 0 ? runLastMinuteWatchTick(snap) : null,
    stepBuyWatchUsers.size > 0 ? runStepBuyWatchTick(snap) : null,
    spikeFadeWatchUsers.size > 0 ? runSpikeFadeWatchTick(snap) : null,
    pairLockWatchUsers.size > 0 ? runPairLockWatchTick(snap) : null,
    capLockWatchUsers.size > 0 ? runCapLockWatchTick(snap) : null,
    bufferRunWatchUsers.size > 0 ? runBufferRunWatchTick(snap) : null,
    cheapLoopWatchUsers.size > 0 ? runCheapLoopWatchTick(snap) : null,
    cheapLoopHourlyWatchUsers.size > 0 ? runCheapLoopHourlyWatchTick(snap) : null,
    cheapLoopWeeklyWatchUsers.size > 0 ? runCheapLoopWeeklyWatchTick(snap) : null,
  ]);
  if (places.some((row) => row?.paused)) return;
  if (oneSecondDumpWatching()) {
    const dump = await runCashOutBidWatchTick(snap);
    if (dump.paused) return;
    await runProtectWatchTick(snap);
  }
}

/** One watch eval at a time. If a beat arrives while placing, rerun once with the latest book. */
export function kickOneSecondPathWatch(): void {
  pathWatchDirty = true;
  if (pathWatchInFlight) return;
  pathWatchInFlight = (async () => {
    while (pathWatchDirty) {
      pathWatchDirty = false;
      try {
        // Always enter so refreshDumpWatch can arm Sell at / Protect mid-minute.
        await runOneSecondPathWatchers(new Date());
      } catch (err: any) {
        noteTransientKalshiFailure(err);
      }
    }
  })().finally(() => {
    pathWatchInFlight = null;
    if (pathWatchDirty) kickOneSecondPathWatch();
  });
}

/** Always-on 1s Kalshi lean + ask/bid for Cushions-On coins. Does not wait on order HTTP. */
export async function runAlwaysOnOneSecondBeat(now = new Date()): Promise<{
  coins: number;
  tickers: number;
}> {
  if (isCloudKalshiPaused()) return { coins: 0, tickers: 0 };
  await refreshHomeQuoteAssetsIfStale(now);
  const coins = homeQuoteAssets.filter((asset) => isMarketOpen(asset, now).open);
  const tickers = [...new Set([...Object.values(peekAskTickers()), ...cachedLeanTickers()])];
  await pumpKalshiWsQuotesFromConfig(tickers);
  const leans = await refreshCushionLeanSignals(coins, now);
  homeTickerByAsset = rememberTickersFromLeans(homeTickerByAsset, leans);
  rememberAskTickersFromLeans(leans);
  rememberAskTickers(homeTickerByAsset);
  await persistCushionAskBook(coins, now, leans);
  kickOneSecondPathWatch();
  return { coins: coins.length, tickers: tickers.length };
}

/** Quote-only 1s book. Never waits on path ticks or the 20s user loop. */
export async function writeLiveAskBookPulse(now = new Date()): Promise<{ assets: number; tickers: number }> {
  const quoteAssets = intersectCushionAssets(
    unionAssetKeys(oneSecondWatchAssets(), homeQuoteAssets),
    homeQuoteAssets
  );
  rememberAskTickers(homeTickerByAsset);
  const book = await persistCushionAskBook(quoteAssets, now);
  return { assets: quoteAssets.length, tickers: Object.keys(book.byAsset).length };
}

async function runLiveAskBookLoop(untilMs: number, stop: { on: boolean }): Promise<void> {
  while (!stop.on && Date.now() <= untilMs - 80) {
    const started = Date.now();
    try {
      if (!isCloudKalshiPaused()) {
        await writeLiveAskBookPulse(new Date());
      }
    } catch {
      /* next beat */
    }
    if (stop.on) break;
    const wait = Math.max(0, 1000 - (Date.now() - started));
    await sleepMs(wait);
  }
}

// Endpoint triggered every minute by Cloud Scheduler (executes N sub-ticks per minute based on systemConfig)
workerRouter.post('/tick', async (req: Request, res: Response) => {
  const isTest = process.env.NODE_ENV === 'test' || req.query.single === 'true';
  if (process.env.NODE_ENV === 'test') {
    resetKalshiPauseForTests();
  }
  if (!isTest && !tryAcquireTick()) {
    res.status(202).json({
      ok: true,
      status: 'skipped',
      reason: 'tick_in_flight',
      timestamp: new Date().toISOString(),
    });
    return;
  }
  try {
  await runScheduledTickMinute(res, isTest);
  } finally {
    if (!isTest) releaseTick();
  }
});

async function runScheduledTickMinute(res: Response, isTest: boolean): Promise<void> {
  const sysConfig = await getSystemConfig();
  const intervalSec = sysConfig?.tick_interval_seconds || 20;
  const tickCount = isTest ? 1 : Math.max(1, Math.floor(60 / intervalSec));
  const delayMs = intervalSec * 1000;
  const minuteEndAt = Date.now() + (isTest ? 0 : 58_000);
  let lastResult: any = { activeUserCount: 0, results: [] };
  const askStop = { on: false };
  if (!isTest) {
    try {
      homeQuoteAssets = collectHomeQuoteAssets(await getEnrolledActiveUsers()) as AssetKey[];
      lastHomeQuoteAt = Date.now();
      lastHomeQuoteAt = Date.now();
    } catch {
      /* keep last Home chips */
    }
  }
  const askLoop = isTest ? Promise.resolve() : runLiveAskBookLoop(minuteEndAt, askStop);

  try {
  for (let i = 0; i < tickCount; i++) {
    lastResult = await runOneTick();
    if (lastResult?.timestamp) {
      await setSystemConfig({ last_worker_tick_at: lastResult.timestamp });
    }
    if (lastResult?.paused) break;
    if (isTest) break;
    const lastSubTick = i >= tickCount - 1;
    const endAt = lastSubTick ? minuteEndAt : Date.now() + delayMs;
    if (Date.now() > endAt - 80) continue;
    let nextPulse = Date.now() + 1000;
    while (Date.now() <= endAt - 80) {
      await sleepMs(Math.max(0, Math.min(nextPulse, endAt) - Date.now()));
      if (Date.now() > endAt - 80) break;
      if (isCloudKalshiPaused()) break;
      kickOneSecondPathWatch();
      nextPulse += 1000;
    }
    if (!lastSubTick) await sleepMs(Math.max(0, endAt - Date.now()));
  }
  } finally {
    askStop.on = true;
    await askLoop;
  }

  // Trading sub-ticks finish first. Purge last so we never delete a fill the tick just wrote.
  const latestConfig = await getSystemConfig({ fresh: true });
  const purgeResult = await runConfiguredPurgeJobs({ config: latestConfig });
  await setSystemConfig({
    last_worker_tick_at: lastResult.timestamp,
    ...(purgeResult.skipped || !purgeResult.ran
      ? {}
      : {
          purge: purgeLastRunPatch(
            purgeResult.ranJobs,
            purgeResult.deleted,
            lastResult.timestamp || new Date().toISOString()
          ),
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
}

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
  skipReasonForWindowCap,
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
  openProtectWatchAssets,
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
import {
  collectWatchAssets,
  fetchAskQuotesOnce,
  leanWithSnapshotQuote,
  uniqueTickersFromLeans,
  type OneSecondMarketSnapshot,
} from '../services/oneSecondMarket';
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
  tickerHasOpenOtherThanPairLock,
  tickerHasOpenPairLock,
} from '../../../../packages/trading-core/src/pairLock';
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
import { runCloudStepBuyStops } from '../services/cloudStepBuy';
import { pendingSpikeFadeTradesForMarket, runCloudSpikeFadeExits } from '../services/cloudSpikeFade';
import { runCloudPairLockFlatten } from '../services/cloudPairLock';

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
/** Home / Auto lots while Protect is On — 1s dump only. */
const protectWatchUsers = new Map<string, string[]>();

function oneSecondWatchAssets(): AssetKey[] {
  return collectWatchAssets(
    twapLockWatchUsers,
    lastMinuteWatchUsers,
    stepBuyWatchUsers,
    spikeFadeWatchUsers,
    pairLockWatchUsers,
    cashOutWatchUsers,
    goldFadeWatchUsers,
    protectWatchUsers
  );
}

function oneSecondDumpWatching(): boolean {
  return cashOutWatchUsers.size > 0 || goldFadeWatchUsers.size > 0 || protectWatchUsers.size > 0;
}

function oneSecondPathWatching(): boolean {
  return (
    twapLockWatchUsers.size > 0 ||
    lastMinuteWatchUsers.size > 0 ||
    stepBuyWatchUsers.size > 0 ||
    spikeFadeWatchUsers.size > 0 ||
    pairLockWatchUsers.size > 0
  );
}

async function ingestCfbPrintsForAssets(watchAssets: AssetKey[], now: Date): Promise<void> {
  if (!watchAssets.length) return;
  const platformCreds = await getCfbApiCredentials();
  let sharedKalshi: KalshiClient | null = null;
  if (!platformCreds) {
    const userIds = [
      ...twapLockWatchUsers.keys(),
      ...lastMinuteWatchUsers.keys(),
      ...stepBuyWatchUsers.keys(),
      ...spikeFadeWatchUsers.keys(),
      ...pairLockWatchUsers.keys(),
      ...cashOutWatchUsers.keys(),
      ...goldFadeWatchUsers.keys(),
      ...protectWatchUsers.keys(),
    ];
    for (const userId of userIds) {
      const secret = await getUserSecret(userId);
      if (secret?.privateKeyPem && secret.keyId) {
        sharedKalshi = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
        break;
      }
    }
    if (!sharedKalshi) return;
  }
  await Promise.all(
    watchAssets.map(async (asset) => {
      try {
        const prints = await fetchCfbRtiPrints(asset, {
          now,
          kalshi: sharedKalshi,
          credentials: platformCreds,
        });
        ingestRecentCfbPrints(asset, prints, now);
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
  const leans: Partial<Record<AssetKey, any>> = {};
  await Promise.all(
    watchAssets.map(async (asset) => {
      try {
        if (!isMarketOpen(asset, now).open) return;
        leans[asset] = await computeLean(asset, 0.0, fetch, now);
      } catch (err: any) {
        noteTransientKalshiFailure(err);
      }
    })
  );
  return leans;
}

export async function buildOneSecondMarketSnapshot(
  watchAssets: AssetKey[],
  now: Date
): Promise<OneSecondMarketSnapshot> {
  await ingestCfbPrintsForAssets(watchAssets, now);
  const leans = await computeWatchLeans(watchAssets, now);
  const quotes = await fetchAskQuotesOnce(uniqueTickersFromLeans(leans), (ticker) =>
    getMarketQuote(ticker, fetch, { skipCache: true })
  );
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
  try {
    const quote = await getMarketQuote(next.market_ticker, fetch, { skipCache: true });
    if (quote?.yes_ask_dollars != null) next.yes_ask = Number(quote.yes_ask_dollars);
    if (quote?.no_ask_dollars != null) next.no_ask = Number(quote.no_ask_dollars);
    if (quote?.yes_bid_dollars != null) next.yes_bid = Number(quote.yes_bid_dollars);
    if (quote?.no_bid_dollars != null) next.no_bid = Number(quote.no_bid_dollars);
  } catch {
    /* keep lean */
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

export function resetLeanAlertMemoryForTests(): void {
  leanAlertMemory.clear();
  cashOutWatchUsers.clear();
  goldFadeWatchUsers.clear();
  twapLockWatchUsers.clear();
  lastMinuteWatchUsers.clear();
  stepBuyWatchUsers.clear();
  spikeFadeWatchUsers.clear();
  pairLockWatchUsers.clear();
  protectWatchUsers.clear();
  resetTwapLockWatcherMemoryForTests();
  resetLastMinuteWatcherMemoryForTests();
  resetStepBuyWatcherMemoryForTests();
  resetSpikeFadeWatcherMemoryForTests();
  resetPairLockWatcherMemoryForTests();
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
  const client = new KalshiClient(opts.secret.keyId, opts.secret.privateKeyPem, 'production');
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
    stepBuyWatchUsers.clear();
    spikeFadeWatchUsers.clear();
    pairLockWatchUsers.clear();
    protectWatchUsers.clear();
    await flushTwapLockWatcher(now, {});
    await flushLastMinuteWatcher(now, {});
    await flushStepBuyWatcher(now, {});
    await flushSpikeFadeWatcher(now, {});
    await flushPairLockWatcher(now, {});
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
                const stopClient = new KalshiClient(
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
                    yes_bid: lean.yes_bid,
                    yes_ask: lean.yes_ask,
                    no_bid: lean.no_bid,
                    no_ask: lean.no_ask,
                  },
                  trades: userTrades,
                  stopUsd: cfg.risk?.step_buy_stop_usd,
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
                    detail: `Step buy stop · sold ${stopRes.exited}`,
                    at: tickIso,
                  };
                  stepBuyLots = stepBuyLotsForTicker(userTrades, marketTicker);
                }
              }
            }
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
            const lastMinuteOwnsNewBuys =
              lastMinuteWanted &&
              Boolean(twapClose) &&
              stepBuyLots.count <= 0 &&
              !tickerHasOpenSpikeFade(userTrades, marketTicker) &&
              !pairLockHolding &&
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
                    !lastMinuteOwnsNewBuys))
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
                    !pairLockHolding))
            );
            const inPairEnterWindow = isPairLockEnterWindow({
              minutesElapsed: lean.minutes_elapsed,
              startMinutes: cfg.risk?.pair_lock_start_minutes,
              untilMinutes: cfg.risk?.pair_lock_until_minutes,
            });
            const pairLockOwnsSlice = pairLockWanted && inPairEnterWindow && !pairLockHolding;
            const pairLockTick = Boolean(
              pairLockWanted &&
                twapClose &&
                (pairLockHolding ||
                  (inPairEnterWindow &&
                    !lastMinuteOwnsNewBuys &&
                    stepBuyLots.count <= 0 &&
                    !spikeFadeHolding &&
                    !spikeFadeTick))
            );
            const goldFadePath =
              goldFadeEnter &&
              !spikeFadeOwnsSlice &&
              !spikeFadeHolding &&
              !pairLockOwnsSlice &&
              !pairLockHolding;
            const cashOutEnter =
              cashOutWanted &&
              !goldFadePath &&
              !twapLockWanted &&
              !lastMinuteTick &&
              !stepBuyTick &&
              !spikeFadeTick &&
              !spikeFadeOwnsSlice &&
              !pairLockTick &&
              !pairLockOwnsSlice;

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

            if (
              loadTradeBook &&
              user.kalshiConfigured &&
              pendingSpikeFadeTradesForMarket(userTrades, marketTicker).length > 0
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
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
              pairLockLots.unmatched
            ) {
              if (cachedSecret === undefined) cachedSecret = await getUserSecret(userId);
              const secret = cachedSecret;
              if (secret?.privateKeyPem && secret.keyId) {
                const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
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
                  lean: {
                    phase: lean.phase === 'live' ? 'live' : 'ended',
                    minutes_left: lean.minutes_left,
                    minutes_remaining: lean.minutes_remaining,
                  },
                  filledAt: pairLockLots.runnerFilledAt,
                  now,
                  skipThinBid: pairSkipThin,
                  hedgeBidSize: await cashOutBestBidSize(
                    marketTicker,
                    pairLockLots.runnerSide === 'YES' ? 'NO' : 'YES',
                    pairSkipThin
                  ),
                  flattenBidSize: await cashOutBestBidSize(
                    marketTicker,
                    pairLockLots.runnerSide || lean.decision,
                    pairSkipThin
                  ),
                });
                if (watch.kind === 'hedge' && watch.hedge?.ok && watch.hedge.price && watch.hedge.count) {
                  const hedgeReq = `plh_${userId}_${marketTicker}_${Date.now()}`.slice(0, 64);
                  const hedgeLock = await tryAcquirePlaceLock({
                    userId,
                    ticker: marketTicker,
                    cap: Math.max(2, windowBuyCap(cfg.risk) + 1),
                    requestId: hedgeReq,
                    existingBuys: 1,
                  });
                  if (hedgeLock.ok) {
                    try {
                      const placeRes = await client.placeOrder({
                        ticker: marketTicker,
                        side: watch.hedge.side || 'bid',
                        count: watch.hedge.count,
                        price: watch.hedge.price,
                        time_in_force: 'immediate_or_cancel',
                        dry_run: false,
                      });
                      const { fillCount, filled } = resolvedPlaceFillCount({
                        dryRun: Boolean(placeRes.dry_run),
                        fillCount: placeRes.fill_count,
                        intendedCount: watch.hedge.count,
                      });
                      const payPrice = Number(watch.hedge.pay_price ?? 0) || null;
                      const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                      const hedgeDecision = watch.hedge.decision === 'NO' ? 'NO' : 'YES';
                      const tradeDoc: TradeRecordDoc = {
                        tradeId,
                        userId,
                        ticker: marketTicker,
                        asset,
                        decision: hedgeDecision,
                        count: filled ? String(fillCount) : String(watch.hedge.count || 0),
                        price: String(watch.hedge.price),
                        notionalUsd:
                          filled && payPrice
                            ? Math.round(fillCount * payPrice * 100) / 100
                            : watch.hedge.notional_usd || 0,
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
                      };
                      await saveTradeRecord(userId, tradeDoc);
                      userTrades.unshift(tradeDoc);
                      pairLockLots = pairLockLotsForTicker(userTrades, marketTicker);
                      const priceVal = parseFloat(String(watch.hedge.price || 0));
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
                              ? `${watch.hedge.count} ctr @ $${priceVal.toFixed(2)} · Pair lock locked · +${cents}¢`
                              : `${watch.hedge.count} ctr @ $${priceVal.toFixed(2)}`,
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
                          title: iocMissAlertTitle('pair_lock'),
                          body: iocMissAlertBody({
                            asset,
                            decision: hedgeDecision,
                            entryPath: 'pair_lock',
                            price: priceVal,
                            count: watch.hedge.count,
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
                    } finally {
                      await releasePlaceLock({ userId, ticker: marketTicker, requestId: hedgeReq });
                    }
                  }
                } else if (watch.kind === 'flatten' || watch.kind === 'thin_bid') {
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
                    skipThinBid: pairSkipThin,
                    bidSize: await cashOutBestBidSize(
                      marketTicker,
                      pairLockLots.runnerSide || lean.decision,
                      pairSkipThin
                    ),
                    slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
                    dryRun: false,
                    now,
                    place: (input) => client.placeOrder(input),
                  });
                  if (pairRes.exited > 0) {
                    tradesCount += pairRes.exited;
                    openPositions = Math.max(0, openPositions - pairRes.exited);
                    pairLockLots = pairLockLotsForTicker(userTrades, marketTicker);
                    lastTradeAction[asset] = {
                      status: 'placed',
                      detail: `Pair lock flatten · sold ${pairRes.exited}`,
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
              !pairLockTick &&
              !pairLockOwnsSlice &&
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
            const stepThin = resolveSkipThinBid(cfg.risk, 'step_buy');
            const spikeThin = resolveSkipThinBid(cfg.risk, 'spike_fade');
            const pairThin = resolveSkipThinBid(cfg.risk, 'pair_lock');
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
                : evaluateStaticGate(leanForGate, cfg, {
                    openPositions,
                    tradesToday,
                    assetTradesInWindow: existingBuys,
                    dailyPnlUsd,
                  });
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
                : pairLockTick
                  ? 'pair_lock'
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
                    entryPath === 'pair_lock'
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
                gate.skip_reason === 'step_buy_lean_flipped' ||
                gate.skip_reason === 'spike_fade_outside_window' ||
                gate.skip_reason === 'spike_fade_no_spike' ||
                gate.skip_reason === 'spike_fade_cheap_off_band' ||
                gate.skip_reason === 'pair_lock_outside_window' ||
                gate.skip_reason === 'pair_lock_min_lock' ||
                gate.skip_reason === 'pair_lock_no_lean' ||
                gate.skip_reason === 'pair_lock_ask_rich'
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

            const client = new KalshiClient(secret.keyId, secret.privateKeyPem, isLive ? 'production' : 'demo');
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
          const stillOpenProtect =
            protectEnabled && user.state !== 'KILL_SWITCH'
              ? openProtectWatchAssets(userTrades, now)
              : [];
          if (stillOpenProtect.length) protectWatchUsers.set(userId, stillOpenProtect);
          else protectWatchUsers.delete(userId);
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
              if (ticker) {
                const lots = pairLockLotsForTicker(userTrades, ticker);
                if (lots.locked) return false;
                if (lots.unmatched) return true;
              }
              return isPairLockEnterWindow({
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
                count: gate.count,
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
            const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
            const stopRes = await runCloudStepBuyStops({
              userId,
              asset,
              ticker: marketTicker,
              lean: {
                phase: lean.phase === 'live' ? 'live' : 'ended',
                yes_bid: quoted.yes_bid,
                yes_ask: yesAsk,
                no_bid: quoted.no_bid,
                no_ask: noAsk,
              },
              trades: userTrades,
              stopUsd: cfg.risk?.step_buy_stop_usd,
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
                detail: `Step buy stop · sold ${stopRes.exited}`,
                at: tickIso,
              };
              stepBuyLots = stepBuyLotsForTicker(userTrades, marketTicker);
            }
          }
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
        const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
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
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: gate.side || 'bid',
            count: gate.count,
            price: gate.price,
            time_in_force: 'immediate_or_cancel',
            dry_run: false,
          });
          if (!placeRes.ok) continue;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: gate.count,
          });
          const payPrice = Number(gate.pay_price ?? 0) || null;
          const accepted = filled || false;
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision === 'NO' ? 'NO' : 'YES',
            count: filled ? String(fillCount) : String(gate.count || 0),
            price: String(gate.price),
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : gate.notional_usd || 0,
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
            const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
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
        const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
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
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: gate.side || 'bid',
            count: gate.count,
            price: gate.price,
            time_in_force: 'immediate_or_cancel',
            dry_run: false,
          });
          if (!placeRes.ok) continue;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: gate.count,
          });
          const payPrice = Number(gate.pay_price ?? 0) || null;
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision === 'NO' ? 'NO' : 'YES',
            count: filled ? String(fillCount) : String(gate.count || 0),
            price: String(gate.price),
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : gate.notional_usd || 0,
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
        if (lots.unmatched) {
          const secret = await getUserSecret(userId);
          if (secret?.privateKeyPem && secret.keyId) {
            const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
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
              lean: {
                phase: lean.phase === 'live' ? 'live' : 'ended',
                minutes_left: lean.minutes_left,
                minutes_remaining: lean.minutes_remaining,
              },
              filledAt: lots.runnerFilledAt,
              now,
              skipThinBid: pairSkipThin,
              hedgeBidSize: await cashOutBestBidSize(
                marketTicker,
                lots.runnerSide === 'YES' ? 'NO' : 'YES',
                pairSkipThin
              ),
              flattenBidSize: await cashOutBestBidSize(
                marketTicker,
                lots.runnerSide || lean.decision,
                pairSkipThin
              ),
            });
            if (watch.kind === 'hedge' && watch.hedge?.ok && watch.hedge.price && watch.hedge.count) {
              const hedgeReq = `plw_${userId}_${marketTicker}_${Date.now()}`.slice(0, 64);
              const hedgeLock = await tryAcquirePlaceLock({
                userId,
                ticker: marketTicker,
                cap: Math.max(2, windowBuyCap(cfg.risk) + 1),
                requestId: hedgeReq,
                existingBuys: 1,
              });
              if (hedgeLock.ok) {
                try {
                  const placeRes = await client.placeOrder({
                    ticker: marketTicker,
                    side: watch.hedge.side || 'bid',
                    count: watch.hedge.count,
                    price: watch.hedge.price,
                    time_in_force: 'immediate_or_cancel',
                    dry_run: false,
                  });
                  const { fillCount, filled } = resolvedPlaceFillCount({
                    dryRun: Boolean(placeRes.dry_run),
                    fillCount: placeRes.fill_count,
                    intendedCount: watch.hedge.count,
                  });
                  const payPrice = Number(watch.hedge.pay_price ?? 0) || null;
                  const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                  const hedgeDecision = watch.hedge.decision === 'NO' ? 'NO' : 'YES';
                  const tradeDoc: TradeRecordDoc = {
                    tradeId,
                    userId,
                    ticker: marketTicker,
                    asset,
                    decision: hedgeDecision,
                    count: filled ? String(fillCount) : String(watch.hedge.count || 0),
                    price: String(watch.hedge.price),
                    notionalUsd:
                      filled && payPrice
                        ? Math.round(fillCount * payPrice * 100) / 100
                        : watch.hedge.notional_usd || 0,
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
                    entryPath: 'pair_lock',
                  };
                  await saveTradeRecord(userId, tradeDoc);
                  userTrades.unshift(tradeDoc);
                  lots = pairLockLotsForTicker(userTrades, marketTicker);
                  const priceVal = parseFloat(String(watch.hedge.price || 0));
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
                          ? `${watch.hedge.count} ctr @ $${priceVal.toFixed(2)} · Pair lock locked · +${cents}¢`
                          : `${watch.hedge.count} ctr @ $${priceVal.toFixed(2)}`,
                      cfg: cfg as never,
                      tokens: userTokens,
                      collapseId: fillCollapseId(userId, tradeId),
                      asset,
                      ticker: marketTicker,
                      tradeId,
                      decision: hedgeDecision,
                      at: now.toISOString(),
                    });
                  }
                } finally {
                  await releasePlaceLock({ userId, ticker: marketTicker, requestId: hedgeReq });
                }
              }
            } else if (watch.kind === 'flatten' || watch.kind === 'thin_bid') {
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
                skipThinBid: pairSkipThin,
                bidSize: await cashOutBestBidSize(
                  marketTicker,
                  lots.runnerSide || lean.decision,
                  pairSkipThin
                ),
                slippageUsd: Math.min(0.05, Number(cfg.risk?.chase_above_ask_usd) || 0.02),
                dryRun: false,
                now,
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
                  detail: `Pair lock flatten · sold ${pairRes.exited}`,
                  at: tickIso,
                };
                openPositions = Math.max(0, openPositions - pairRes.exited);
                lots = pairLockLotsForTicker(userTrades, marketTicker);
              }
            }
          }
        }
        if (tickerHasOpenPairLock(userTrades, marketTicker)) continue;
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
        if (!gate.ok || !gate.price || !gate.count) continue;
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
        const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
        const placeDecision = gate.decision || lean.decision;
        try {
          const placeRes = await client.placeOrder({
            ticker: marketTicker,
            side: gate.side || 'bid',
            count: gate.count,
            price: gate.price,
            time_in_force: 'immediate_or_cancel',
            dry_run: false,
          });
          if (!placeRes.ok) continue;
          const { fillCount, filled } = resolvedPlaceFillCount({
            dryRun: Boolean(placeRes.dry_run),
            fillCount: placeRes.fill_count,
            intendedCount: gate.count,
          });
          const payPrice = Number(gate.pay_price ?? 0) || null;
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: marketTicker,
            asset: lean.asset,
            decision: placeDecision === 'NO' ? 'NO' : 'YES',
            count: filled ? String(fillCount) : String(gate.count || 0),
            price: String(gate.price),
            notionalUsd:
              filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : gate.notional_usd || 0,
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
                entryPath: 'pair_lock',
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
              title: iocMissAlertTitle('pair_lock'),
              body: iocMissAlertBody({
                asset,
                decision: String(placeDecision || ''),
                entryPath: 'pair_lock',
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
      if (still.length) pairLockWatchUsers.set(userId, still);
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
      const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
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
      const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
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
      if (!Boolean(cfg.risk?.protect_sell_enabled) || user.state === 'KILL_SWITCH') {
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
      const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'production');
      const userTokens = [...(user.pushTokens || []), ...(user.fcmTokens || [])].filter(
        (t, i, arr) => t && arr.indexOf(t) === i
      );
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

// Endpoint triggered every minute by Cloud Scheduler (executes N sub-ticks per minute based on systemConfig)
workerRouter.post('/tick', async (req: Request, res: Response) => {
  const isTest = process.env.NODE_ENV === 'test' || req.query.single === 'true';
  if (process.env.NODE_ENV === 'test') {
    resetKalshiPauseForTests();
  }
  const sysConfig = await getSystemConfig();
  const intervalSec = sysConfig?.tick_interval_seconds || 20;
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
    let nextPulse = Date.now() + 1000;
    while (Date.now() <= endAt - 80) {
      const watching = oneSecondPathWatching() || oneSecondDumpWatching();
      const nextAt = watching ? Math.min(nextPulse, endAt) : endAt;
      await sleepMs(Math.max(0, nextAt - Date.now()));
      if (Date.now() > endAt - 80) break;
      if (!watching) break;
      if (isCloudKalshiPaused()) break;
      const watchAssets = oneSecondWatchAssets();
      const snap = watchAssets.length
        ? await buildOneSecondMarketSnapshot(watchAssets, new Date())
        : null;
      if (isCloudKalshiPaused()) break;
      if (twapLockWatchUsers.size > 0) {
        const twap = await runTwapLockWatchTick(snap);
        if (twap.paused) break;
      }
      if (lastMinuteWatchUsers.size > 0) {
        const lm = await runLastMinuteWatchTick(snap);
        if (lm.paused) break;
      }
      if (stepBuyWatchUsers.size > 0) {
        const sb = await runStepBuyWatchTick(snap);
        if (sb.paused) break;
      }
      if (spikeFadeWatchUsers.size > 0) {
        const sf = await runSpikeFadeWatchTick(snap);
        if (sf.paused) break;
      }
      if (pairLockWatchUsers.size > 0) {
        const pl = await runPairLockWatchTick(snap);
        if (pl.paused) break;
      }
      if (oneSecondDumpWatching()) {
        const dump = await runCashOutBidWatchTick(snap);
        if (dump.paused) break;
        const prot = await runProtectWatchTick(snap);
        if (prot.paused) break;
      }
      nextPulse += 1000;
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

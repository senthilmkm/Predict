import {
  AssetKey,
  AssetRegistry,
  computeLean,
  defaultAppConfig,
  KalshiClient,
  KalshiPlaceResult,
} from 'trading-core';
import {
  countWindowBuysForTicker,
  evaluateStaticGate,
  formatSkipReason,
  windowBuyCap,
} from '../../../../packages/trading-core/src/gates';
import {
  buildProtectSellOrder,
  computeProtectSellPnlUsd,
} from '../../../../packages/trading-core/src/protectSell';
import { setActiveKalshiRetryPolicy } from '../../../../packages/trading-core/src/kalshiRetry';
import { isGoodTillCanceled, resolvedPlaceFillCount } from '../../../../packages/trading-core/src/orderFill';
import { configForHomeBuy } from '../../../../packages/trading-core/src/pathRisk';
import { isMarketOpen } from './marketHours';
import {
  claimProtectSell,
  getSystemConfig,
  getTradeRecords,
  getUserDoc,
  isProtectClaimable,
  saveTradeRecord,
  TradeRecordDoc,
  updateTradeRecord,
  upsertUserDoc,
  writeAuditLog,
} from './firestore';
import { getUserSecret } from './secretManager';
import { tryAcquirePlaceLock, releasePlaceLock } from './placeLock';
import { isCloudKalshiPaused, noteTransientKalshiFailure } from './kalshiPause';
import { economicPayPrice, fillCountOf, liveCloudTradesToday, cloudDailyRealizedPnl } from './settlement';
import { normalizeFeatureFlags } from './featureFlags';
import { isCashOutEntryPath } from '../../../../packages/trading-core/src/cashOut';
import { isGoldFadeEntryPath } from '../../../../packages/trading-core/src/goldFade';
import { isTwapLockEntryPath } from '../../../../packages/trading-core/src/twapLock';
import { isLastMinuteEntryPath } from '../../../../packages/trading-core/src/lastMinute';
import { emitCloudAlert, fillAlertId, orderPlacedAlertTitle } from './cloudAlerts';
import { fillCollapseId } from './leanAlerts';

export type ManualTradeAction = 'buy' | 'sell';

export interface ManualOrderInput {
  userId: string;
  asset: string;
  action: ManualTradeAction;
  requestId?: string;
}

export interface ManualOrderResult {
  ok: boolean;
  httpStatus: number;
  error?: string;
  skip_reason?: string;
  message: string;
  tradeId?: string;
  filled?: boolean;
  ticker?: string;
}

export type PlaceOrderFn = (input: {
  ticker: string;
  side: 'bid' | 'ask';
  count: string;
  price: string;
  time_in_force?: string;
  dry_run?: boolean;
  client_order_id?: string;
}) => Promise<KalshiPlaceResult>;

export interface ManualTradeDeps {
  now?: Date;
  computeLeanFn?: typeof computeLean;
  getUserDocFn?: typeof getUserDoc;
  getTradeRecordsFn?: typeof getTradeRecords;
  getSystemConfigFn?: typeof getSystemConfig;
  getUserSecretFn?: typeof getUserSecret;
  isMarketOpenFn?: typeof isMarketOpen;
  placeOrderFn?: PlaceOrderFn;
}

function newRequestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`.slice(0, 64);
}

function userMessage(skipReason: string | undefined, fallback: string): string {
  const label = formatSkipReason(skipReason);
  if (label && label !== 'gate') return label;
  return fallback;
}

async function auditError(
  userId: string,
  details: Record<string, unknown>
): Promise<void> {
  await writeAuditLog(userId, 'ERROR', details);
}

function heldOpenFill(trades: TradeRecordDoc[], ticker: string, now: Date): TradeRecordDoc | undefined {
  const tkr = String(ticker || '').trim();
  if (!tkr) return undefined;
  return trades.find(
    (t) => String(t.ticker || '').trim() === tkr && isProtectClaimable(t, now) && fillCountOf(t) > 0
  );
}

async function fail(
  userId: string,
  httpStatus: number,
  error: string,
  skip_reason: string | undefined,
  extra: Record<string, unknown>
): Promise<ManualOrderResult> {
  const message = extra.message
    ? String(extra.message)
    : userMessage(skip_reason, error);
  await auditError(userId, {
    source: 'manual_order',
    error,
    skip_reason: skip_reason || null,
    message,
    ...extra,
  });
  return { ok: false, httpStatus, error, skip_reason, message };
}

export async function executeManualOrder(
  input: ManualOrderInput,
  deps: ManualTradeDeps = {}
): Promise<ManualOrderResult> {
  const userId = String(input.userId || '').trim();
  const asset = String(input.asset || '').trim() as AssetKey;
  const action: ManualTradeAction = input.action === 'sell' ? 'sell' : 'buy';
  const requestId = String(input.requestId || '').trim() || newRequestId(`ios_${action}_${asset}`);
  const now = deps.now || new Date();

  if (!userId) {
    return { ok: false, httpStatus: 401, error: 'unauthorized', message: 'Not signed in.' };
  }
  if (!AssetRegistry.get(asset)) {
    return fail(userId, 400, 'unknown_asset', undefined, { asset, action, message: 'Unknown asset.' });
  }

  const getUser = deps.getUserDocFn || getUserDoc;
  const getTrades = deps.getTradeRecordsFn || getTradeRecords;
  const getSys = deps.getSystemConfigFn || getSystemConfig;
  const leanFn = deps.computeLeanFn || computeLean;
  const secretFn = deps.getUserSecretFn || getUserSecret;
  const hoursFn = deps.isMarketOpenFn || isMarketOpen;

  const [user, sys] = await Promise.all([getUser(userId), getSys()]);
  setActiveKalshiRetryPolicy(sys?.kalshiRetry);
  const flags = normalizeFeatureFlags(sys?.featureFlags);

  if (!flags.lastSignalsManualTrade) {
    return fail(userId, 403, 'feature_disabled', 'feature_disabled', {
      asset,
      action,
      message: 'Last signals Buy / Sell is turned off.',
    });
  }
  if (user?.state === 'KILL_SWITCH') {
    return fail(userId, 403, 'kill_switch', 'kill_switch', {
      asset,
      action,
      message: 'Kill Switch is on. Home Buy / Sell is disabled.',
    });
  }
  if (isCloudKalshiPaused()) {
    return fail(userId, 503, 'kalshi_paused', 'kalshi_paused', { asset, action });
  }

  const hours = hoursFn(asset, now);
  if (!hours.open) {
    return fail(userId, 409, 'market_closed', 'market_closed', { asset, action });
  }

  const cfg = configForHomeBuy(user?.config || defaultAppConfig());
  if (!cfg.assets_enabled?.[asset]) {
    return fail(userId, 409, 'asset_disabled', 'asset_disabled', { asset, action });
  }

  let lean: Awaited<ReturnType<typeof computeLean>>;
  try {
    lean = await leanFn(asset, 0, fetch, now);
  } catch (err) {
    noteTransientKalshiFailure(err);
    return fail(userId, 502, 'lean_failed', undefined, {
      asset,
      action,
      message: String((err as any)?.message || err || 'Could not load market quote.'),
    });
  }

  const ticker = String(lean?.market_ticker || '').trim();
  if (!ticker || lean?.message === 'no_market' || lean?.message === 'strike_tbd' || !lean?.ok) {
    return fail(userId, 409, 'no_market', 'skip_decision', {
      asset,
      action,
      message: 'No Kalshi 15m contract.',
    });
  }

  const rawTrades = await getTrades(userId);
  const held = heldOpenFill(rawTrades, ticker, now);

  if (action === 'sell') {
    return executeManualSell({
      userId,
      asset,
      requestId,
      now,
      cfg,
      user,
      lean,
      ticker,
      held,
      secretFn,
      placeOrderFn: deps.placeOrderFn,
    });
  }

  return executeManualBuy({
    userId,
    asset,
    requestId,
    now,
    cfg,
    user,
    lean,
    ticker,
    held,
    rawTrades,
    secretFn,
    placeOrderFn: deps.placeOrderFn,
  });
}

async function executeManualBuy(opts: {
  userId: string;
  asset: AssetKey;
  requestId: string;
  now: Date;
  cfg: ReturnType<typeof defaultAppConfig>;
  user: Awaited<ReturnType<typeof getUserDoc>>;
  lean: Awaited<ReturnType<typeof computeLean>>;
  ticker: string;
  held?: TradeRecordDoc;
  rawTrades: TradeRecordDoc[];
  secretFn: typeof getUserSecret;
  placeOrderFn?: PlaceOrderFn;
}): Promise<ManualOrderResult> {
  const { userId, asset, requestId, now, cfg, user, lean, ticker, held, rawTrades } = opts;
  if (held) {
    if (isCashOutEntryPath(held.entryPath)) {
      return fail(userId, 409, 'cash_out_holding', 'cash_out_holding', { asset, action: 'buy', ticker });
    }
    if (isGoldFadeEntryPath(held.entryPath)) {
      return fail(userId, 409, 'gold_fade_holding', 'gold_fade_holding', { asset, action: 'buy', ticker });
    }
    if (isTwapLockEntryPath(held.entryPath)) {
      return fail(userId, 409, 'twap_lock_holding', 'twap_lock_holding', { asset, action: 'buy', ticker });
    }
    if (isLastMinuteEntryPath(held.entryPath)) {
      return fail(userId, 409, 'last_minute_holding', 'last_minute_holding', { asset, action: 'buy', ticker });
    }
    return fail(userId, 409, 'already_holding', 'already_holding', { asset, action: 'buy', ticker });
  }
  if (lean.decision !== 'YES' && lean.decision !== 'NO') {
    return fail(userId, 409, 'skip_decision', 'skip_decision', { asset, action: 'buy', ticker });
  }

  const tradesTodayList = liveCloudTradesToday(rawTrades, now);
  const openPositions = rawTrades.filter(
    (t) => !t.dryRun && (t.status === 'SUBMITTED' || t.status === 'FILLED')
  ).length;
  const existingBuys = countWindowBuysForTicker(rawTrades, ticker);
  const cap = windowBuyCap(cfg.risk);
  const absGap = Number.isFinite(Number(lean.abs_gap))
    ? Number(lean.abs_gap)
    : Math.abs((lean.live || 0) - (lean.strike || 0));

  const gate = evaluateStaticGate(
    {
      asset,
      market_ticker: ticker,
      decision: lean.decision,
      live: lean.live || 0,
      strike: lean.strike || 0,
      abs_gap: absGap,
      minutes_left: lean.minutes_left || 0,
      minutes_elapsed: lean.minutes_elapsed || 0,
      phase: lean.phase === 'live' ? 'live' : 'ended',
      yes_ask: lean.yes_ask ?? undefined,
      no_ask: lean.no_ask ?? undefined,
    },
    cfg,
    {
      openPositions,
      tradesToday: tradesTodayList.length,
      assetTradesInWindow: existingBuys,
      dailyPnlUsd: cloudDailyRealizedPnl(tradesTodayList),
      allowWhenAutoTradeOff: true,
    }
  );

  if (!gate.ok || !gate.price || !gate.count) {
    return fail(userId, 409, 'gate_skip', gate.skip_reason || 'notional_too_small', {
      asset,
      action: 'buy',
      ticker,
    });
  }

  const secret = await opts.secretFn(userId);
  if (!secret?.privateKeyPem || !secret.keyId) {
    return fail(userId, 409, 'no_client', 'no_client', { asset, action: 'buy', ticker });
  }

  const lock = await tryAcquirePlaceLock({
    userId,
    ticker,
    cap,
    requestId,
    existingBuys,
  });
  if (!lock.ok) {
    return fail(userId, 409, lock.reason, lock.reason, { asset, action: 'buy', ticker });
  }

  const isLive = user?.state !== 'KILL_SWITCH';
  try {
    const place =
      opts.placeOrderFn ||
      ((input) =>
        new KalshiClient(secret.keyId, secret.privateKeyPem, isLive ? 'production' : 'demo').placeOrder(input));
    const placeRes = await place({
      ticker,
      side: gate.side || 'bid',
      count: gate.count,
      price: gate.price,
      time_in_force: gate.time_in_force,
      dry_run: !isLive,
      client_order_id: requestId.slice(0, 64),
    });

    if (!placeRes.ok) {
      const errMsg = String(placeRes.error || 'order failed');
      noteTransientKalshiFailure(errMsg);
      return fail(userId, 502, 'place_failed', undefined, {
        asset,
        action: 'buy',
        ticker,
        message: errMsg,
      });
    }

    const tif = placeRes.payload?.time_in_force || gate.time_in_force;
    const gtcResting = isGoodTillCanceled(tif);
    const { fillCount, filled } = resolvedPlaceFillCount({
      dryRun: Boolean(placeRes.dry_run) || !isLive,
      fillCount: placeRes.fill_count,
      intendedCount: gate.count,
    });
    const accepted = filled || (gtcResting && Boolean(placeRes.order_id));
    const payPrice = Number(gate.pay_price ?? 0) || null;
    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const tradeDoc: TradeRecordDoc = {
      tradeId,
      userId,
      ticker,
      asset,
      decision: lean.decision as 'YES' | 'NO',
      count: filled ? String(fillCount) : String(gate.count || 0),
      price: gate.price,
      notionalUsd:
        filled && payPrice ? Math.round(fillCount * payPrice * 100) / 100 : gate.notional_usd || 0,
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
      entryPath: 'home',
    };
    await saveTradeRecord(userId, tradeDoc);
    await writeAuditLog(userId, 'TRADE_TRIGGERED', {
      source: 'manual_buy',
      tradeId,
      ticker,
      asset,
      decision: lean.decision,
      mode: isLive ? 'live' : 'demo',
      filled,
      accepted,
    });
    const priceVal = parseFloat(String(gate.price || 0));
    await upsertUserDoc(userId, {
      lastTradeAction: {
        ...(user as any)?.lastTradeAction,
        [asset]: filled
          ? {
              status: 'placed',
              detail: `placed ${lean.decision} · ${fillCount} @ $${priceVal.toFixed(2)}`,
              at: now.toISOString(),
            }
          : accepted
            ? {
                status: 'placed',
                detail: `resting ${lean.decision} · waiting for fill`,
                at: now.toISOString(),
              }
            : { status: 'failed', detail: 'IOC no fill', at: now.toISOString() },
      },
    } as any);

    if (filled) {
      const userTokens = [
        ...((user as { pushTokens?: string[] })?.pushTokens || []),
        ...((user as { fcmTokens?: string[] })?.fcmTokens || []),
      ].filter((t, i, arr) => t && arr.indexOf(t) === i);
      await emitCloudAlert({
        userId,
        alertId: fillAlertId(tradeId),
        kind: 'order_filled',
        title: orderPlacedAlertTitle({
          live: isLive,
          asset,
          decision: String(lean.decision || ''),
          entryPath: 'home',
        }),
        body: `${fillCount} ctr @ $${priceVal.toFixed(2)} · Cost $${(tradeDoc.notionalUsd || 0).toFixed(2)}`,
        cfg,
        tokens: userTokens,
        collapseId: fillCollapseId(userId, tradeId),
        asset,
        ticker,
        tradeId,
        decision: lean.decision,
        at: now.toISOString(),
      });
    }

    if (!filled && !accepted) {
      await auditError(userId, {
        source: 'manual_buy',
        error: 'ioc_miss',
        ticker,
        asset,
        message: 'IOC no fill',
      });
      return {
        ok: false,
        httpStatus: 409,
        error: 'ioc_miss',
        message: 'IOC no fill — the order did not take. Try again if the quote is still good.',
        tradeId,
        filled: false,
        ticker,
      };
    }

    return {
      ok: true,
      httpStatus: 200,
      message: filled
        ? `Bought ${lean.decision} · ${fillCount} contracts`
        : `Submitted ${lean.decision} · resting on Kalshi`,
      tradeId,
      filled,
      ticker,
    };
  } catch (err) {
    noteTransientKalshiFailure(err);
    return fail(userId, 502, 'place_failed', undefined, {
      asset,
      action: 'buy',
      ticker,
      message: String((err as any)?.message || err || 'Order failed.'),
    });
  } finally {
    await releasePlaceLock({ userId, ticker, requestId });
  }
}

async function executeManualSell(opts: {
  userId: string;
  asset: AssetKey;
  requestId: string;
  now: Date;
  cfg: ReturnType<typeof defaultAppConfig>;
  user: Awaited<ReturnType<typeof getUserDoc>>;
  lean: Awaited<ReturnType<typeof computeLean>>;
  ticker: string;
  held?: TradeRecordDoc;
  secretFn: typeof getUserSecret;
  placeOrderFn?: PlaceOrderFn;
}): Promise<ManualOrderResult> {
  const { userId, asset, requestId, now, lean, ticker, held } = opts;
  if (!held) {
    return fail(userId, 409, 'no_open_fill', 'no_open_fill', { asset, action: 'sell', ticker });
  }
  if (isCashOutEntryPath(held.entryPath)) {
    return fail(userId, 409, 'cash_out_holding', 'cash_out_holding', { asset, action: 'sell', ticker });
  }
  if (isGoldFadeEntryPath(held.entryPath)) {
    return fail(userId, 409, 'gold_fade_holding', 'gold_fade_holding', { asset, action: 'sell', ticker });
  }
  if (isTwapLockEntryPath(held.entryPath)) {
    return fail(userId, 409, 'twap_lock_holding', 'twap_lock_holding', { asset, action: 'sell', ticker });
  }
  if (isLastMinuteEntryPath(held.entryPath)) {
    return fail(userId, 409, 'last_minute_holding', 'last_minute_holding', { asset, action: 'sell', ticker });
  }

  const order = buildProtectSellOrder({
    heldSide: held.decision,
    fillCount: fillCountOf(held),
    yesBid: lean.yes_bid,
    yesAsk: lean.yes_ask,
    slippageUsd: Math.min(0.05, Number(opts.cfg.risk?.chase_above_ask_usd) || 0.02),
  });
  if (!order.ok || !order.side || !order.price || !order.count) {
    return fail(userId, 409, order.reason || 'quote', undefined, {
      asset,
      action: 'sell',
      ticker,
      message: order.reason === 'bid_unavailable' || order.reason === 'ask_unavailable'
        ? 'No bid/ask to sell against. Try again in a moment.'
        : userMessage(order.reason, 'Could not build sell order.'),
    });
  }

  const secret = await opts.secretFn(userId);
  if (!secret?.privateKeyPem || !secret.keyId) {
    return fail(userId, 409, 'no_client', 'no_client', { asset, action: 'sell', ticker });
  }

  const claimed = await claimProtectSell(userId, held, now);
  if (!claimed) {
    return fail(userId, 409, 'window_locked', 'window_locked', {
      asset,
      action: 'sell',
      ticker,
      message: 'That fill is already exiting. Wait a moment.',
    });
  }

  const isLive = opts.user?.state !== 'KILL_SWITCH';
  try {
    const place =
      opts.placeOrderFn ||
      ((input) =>
        new KalshiClient(secret.keyId, secret.privateKeyPem, isLive ? 'production' : 'demo').placeOrder(input));
    const placeRes = await place({
      ticker,
      side: order.side,
      count: order.count,
      price: order.price,
      time_in_force: 'immediate_or_cancel',
      dry_run: !isLive,
      client_order_id: `msell-${held.tradeId}`.slice(0, 64),
    });
    const exitFills = Number(placeRes.fill_count ?? 0);
    if (!placeRes.ok || !(exitFills > 0)) {
      held.outcome = 'pending';
      held.protectClaimedAt = null;
      await updateTradeRecord(userId, held.tradeId, { outcome: 'pending', protectClaimedAt: null });
      const errMsg = String(placeRes.error || 'IOC no fill');
      noteTransientKalshiFailure(errMsg);
      await auditError(userId, {
        source: 'manual_sell',
        error: 'ioc_miss',
        ticker,
        asset,
        tradeId: held.tradeId,
        message: errMsg,
      });
      return {
        ok: false,
        httpStatus: 409,
        error: 'ioc_miss',
        message: 'Sell did not fill (IOC). Your position is still open.',
        ticker,
      };
    }

    const fillCount = Math.min(fillCountOf(held), Math.floor(exitFills));
    const pnlUsd = computeProtectSellPnlUsd({
      heldSide: held.decision,
      entryPay: economicPayPrice(held),
      exitEconomic: Number(order.economicExit || 0),
      fillCount,
    });
    await updateTradeRecord(userId, held.tradeId, {
      outcome: 'exited',
      status: 'SETTLED',
      pnlUsd,
      settledAt: now.toISOString(),
      protectClaimedAt: null,
      protectExitOrderId: placeRes.order_id ?? null,
    });
    await writeAuditLog(userId, 'TRADE_TRIGGERED', {
      source: 'manual_sell',
      tradeId: held.tradeId,
      ticker,
      asset,
      decision: held.decision,
      pnlUsd,
      filled: true,
    });
    return {
      ok: true,
      httpStatus: 200,
      message: `Sold ${held.decision} · P&L $${pnlUsd.toFixed(2)}`,
      tradeId: held.tradeId,
      filled: true,
      ticker,
    };
  } catch (err) {
    held.outcome = 'pending';
    held.protectClaimedAt = null;
    await updateTradeRecord(userId, held.tradeId, { outcome: 'pending', protectClaimedAt: null });
    noteTransientKalshiFailure(err);
    return fail(userId, 502, 'place_failed', undefined, {
      asset,
      action: 'sell',
      ticker,
      tradeId: held.tradeId,
      message: String((err as any)?.message || err || 'Sell failed.'),
    });
  } finally {
    void requestId;
  }
}

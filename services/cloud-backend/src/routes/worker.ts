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
  windowBuyCap,
} from '../../../../packages/trading-core/src/gates';
import { getUserSecret } from '../services/secretManager';
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
import {
  claimLeanAlert,
  fillCollapseId,
  leanAlertKey,
  leanCollapseId,
  leanPushEnabled,
  pruneLeanAlertsSent,
  type LeanAlertsSent,
} from '../services/leanAlerts';
import {
  pendingProtectTradesForMarket,
  protectCollapseId,
  runCloudProtectSells,
} from '../services/cloudProtectSell';
import {
  alertPersistEnabled,
  emitCloudAlert,
  fillAlertId,
  leanAlertId,
  missAlertId,
  protectAlertId,
  dailyLossAlertFromPnl,
  persistSettlementAlertIfNeeded,
} from '../services/cloudAlerts';
import { isMarketOpen } from '../services/marketHours';
import { etDateKey } from '../util/time';
import {
  cloudDailyRealizedPnl,
  createQuoteCache,
  liveCloudTradesToday,
  settlePendingCloudTrades,
} from '../services/settlement';

export const workerRouter = Router();

/** Same-process cache so 20s sub-ticks cannot re-ding before Firestore is re-read. */
const leanAlertMemory = new Map<string, LeanAlertsSent>();

export function resetLeanAlertMemoryForTests(): void {
  leanAlertMemory.clear();
}

function loadLeanAlertsSent(userId: string, fromDoc: any): LeanAlertsSent {
  const docSent = pruneLeanAlertsSent(fromDoc?.leanAlertsSent);
  const memSent = pruneLeanAlertsSent(leanAlertMemory.get(userId));
  return { ...docSent, ...memSent };
}

// Helper to chunk array for parallel batch execution
function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function runOneTick() {
  const now = new Date();
  const activeUsers = await getEnrolledActiveUsers();

  const results: Array<{
    userId: string;
    tradesPlaced: number;
    leansEvaluated: number;
    error?: string;
  }> = [];

  if (activeUsers.length === 0) {
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
      'AVAX',
      'SUI',
      'LINK',
      'WTI',
      'Gold',
      'Silver',
      'NG',
      'COPPER',
      'SPX',
      'NDX',
      'EURUSD',
      'GBPUSD',
      'USDJPY',
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
        console.warn(`[TICK_SPOT_FETCH_WARN] Asset ${asset} fetch failed:`, err?.message || err);
      }
    })
  );

  // 2. PARALLEL BATCH PROCESSING: Process active users in concurrent batches of 50
  const BATCH_SIZE = 50;
  const userBatches = chunkArray(activeUsers, BATCH_SIZE);
  const quoteCache = createQuoteCache();

  for (const batch of userBatches) {
    await Promise.all(
      batch.map(async (user) => {
        const userId = user.userId;
        const windowClaims = new Map<string, number>();

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

          for (const asset of assets) {
            if (!cfg.assets_enabled?.[asset]) continue;

            const lean = sharedLeans[asset];
            if (!lean || !lean.market_ticker) continue;
            leansCount++;

            const userCushion = cfg.cushions?.[asset] ?? 25.0;
            const absGap = Number.isFinite(Number(lean.abs_gap))
              ? Number(lean.abs_gap)
              : Math.abs((lean.live || 0) - (lean.strike || 0));
            const marketTicker = lean.market_ticker;

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

            if (absGap < userCushion) continue;
            const windowCap = windowBuyCap(cfg.risk);
            const buysOnTicker =
              countWindowBuysForTicker(userTrades, marketTicker) + (windowClaims.get(marketTicker) || 0);
            if (buysOnTicker >= windowCap) continue;

            const assetTradesInWindow = buysOnTicker;

            const gate = evaluateStaticGate(
              {
                asset: lean.asset,
                market_ticker: lean.market_ticker,
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
                tradesToday,
                assetTradesInWindow,
                dailyPnlUsd,
              }
            );

            const wantLean =
              alertPersistEnabled(cfg, 'lean_signal') ||
              (leanPushEnabled(cfg) && userTokens.length > 0);
            if (wantLean && !leanAlertsSent[leanAlertKey(marketTicker, lean.decision)]) {
              const title = `Signal · ${asset} ${lean.decision}`;
              const body = `Gap $${absGap.toFixed(2)} · Cushion $${userCushion} · ${lean.minutes_left ?? '?'}m left`;
              const emitted = await emitCloudAlert({
                userId,
                alertId: leanAlertId(marketTicker, lean.decision),
                kind: 'lean_signal',
                title,
                body,
                cfg,
                tokens: userTokens,
                collapseId: leanCollapseId(userId, leanAlertKey(marketTicker, lean.decision)),
                asset,
                ticker: marketTicker,
                decision: lean.decision,
                at: now.toISOString(),
              });
              if (emitted.persisted || emitted.pushed) {
                const claim = claimLeanAlert(leanAlertsSent, marketTicker, lean.decision, now);
                leanAlertsSent = claim.next;
                leanAlertsDirty = true;
                leanAlertMemory.set(userId, leanAlertsSent);
              }
            }

            if (!cfg.auto_trade_enabled || user.state !== 'ARMED' || !gate.ok || !gate.price || !gate.count) continue;

            const secret = await getUserSecret(userId);
            if (!secret || !secret.privateKeyPem || !secret.keyId) {
              await upsertUserDoc(userId, { lastError: 'missing_secret_key' });
              continue;
            }

            windowClaims.set(marketTicker, (windowClaims.get(marketTicker) || 0) + 1);

            const client = new KalshiClient(secret.keyId, secret.privateKeyPem, isLive ? 'production' : 'demo');
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
              const fillCount = Number(placeRes.fill_count ?? gate.count ?? 0);
              const filled = Number.isFinite(fillCount) && fillCount > 0;
              const payPrice = Number(gate.pay_price ?? 0) || null;

              const tradeDoc: TradeRecordDoc = {
                tradeId,
                userId,
                ticker: marketTicker,
                asset: lean.asset,
                decision: lean.decision,
                count: filled ? String(fillCount) : String(gate.count || 0),
                price: gate.price,
                notionalUsd: filled && payPrice
                  ? Math.round(fillCount * payPrice * 100) / 100
                  : gate.notional_usd || 0,
                dryRun: !isLive,
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
              };

              await saveTradeRecord(userId, tradeDoc);
              userTrades.unshift(tradeDoc);
              if (!filled) {
                windowClaims.set(marketTicker, Math.max(0, (windowClaims.get(marketTicker) || 1) - 1));
              }
              if (filled && !tradeDoc.dryRun) {
                openPositions += 1;
                tradesToday += 1;
                tradesTodayList.push(tradeDoc);
              }
              await writeAuditLog(userId, 'TRADE_TRIGGERED', {
                tradeId,
                ticker: marketTicker,
                asset: lean.asset,
                decision: lean.decision,
                mode: isLive ? 'live' : 'demo',
              });

              const priceVal = typeof gate.price === 'number' ? gate.price : parseFloat(String(gate.price || 0));
              if (filled) {
                const fillTitle = isLive
                  ? `Order Placed · ${asset} ${lean.decision}`
                  : `Dry-Run Order · ${asset} ${lean.decision}`;
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
              } else {
                await emitCloudAlert({
                  userId,
                  alertId: missAlertId(tradeId),
                  kind: 'ioc_miss',
                  title: 'IOC miss',
                  body: `${asset} ${lean.decision} · IOC no fill`,
                  cfg,
                  tokens: userTokens,
                  asset: lean.asset,
                  ticker: marketTicker,
                  tradeId,
                  decision: lean.decision,
                  at: now.toISOString(),
                });
              }
            } else {
              windowClaims.set(marketTicker, Math.max(0, (windowClaims.get(marketTicker) || 1) - 1));
            }
          }

          if (leanAlertsDirty) {
            leanAlertMemory.set(userId, leanAlertsSent);
          }
          await upsertUserDoc(userId, {
            lastTickAt: now.toISOString(),
            lastError: null,
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
        }
      })
    );
  }

  return { timestamp: now.toISOString(), activeUserCount: activeUsers.length, results };
}

// Endpoint triggered every minute by Cloud Scheduler (executes N sub-ticks per minute based on systemConfig)
workerRouter.post('/tick', async (req: Request, res: Response) => {
  const isTest = process.env.NODE_ENV === 'test' || req.query.single === 'true';
  const sysConfig = await getSystemConfig();
  const intervalSec = sysConfig?.tick_interval_seconds || 20;
  const tickCount = isTest ? 1 : Math.max(1, Math.floor(60 / intervalSec));
  const delayMs = intervalSec * 1000;
  let lastResult: any = { activeUserCount: 0, results: [] };

  for (let i = 0; i < tickCount; i++) {
    lastResult = await runOneTick();
    if (i < tickCount - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  await setSystemConfig({ last_worker_tick_at: lastResult.timestamp });

  res.json({
    ok: true,
    status: 'ok',
    timestamp: lastResult.timestamp,
    activeUsersCount: lastResult.activeUserCount,
    activeUserCount: lastResult.activeUserCount,
    results: lastResult.results,
    tickIntervalSeconds: intervalSec,
    subTicksExecuted: tickCount,
  });
});

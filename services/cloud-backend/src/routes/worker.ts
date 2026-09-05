import { Router, Request, Response } from 'express';
import {
  AssetKey,
  computeLean,
  evaluateStaticGate,
  KalshiClient,
  defaultAppConfig,
} from 'trading-core';
import { getUserSecret } from '../services/secretManager';
import {
  getEnrolledActiveUsers,
  upsertUserDoc,
  saveTradeRecord,
  getTradeRecords,
  writeAuditLog,
  TradeRecordDoc,
} from '../services/firestore';
import { sendPushNotification } from '../services/notifications';
import { isMarketOpen } from '../services/marketHours';

export const workerRouter = Router();

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

  const assets: AssetKey[] = ['WTI', 'Gold', 'Silver', 'BTC', 'ETH'];

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

  for (const batch of userBatches) {
    await Promise.all(
      batch.map(async (user) => {
        const userId = user.userId;
        const userClaimedWindows = new Set<string>();

        try {
          const userTrades = await getTradeRecords(userId);
          const existingTickers = new Set(userTrades.map((t) => t.ticker));

          const todayKey = new Date().toISOString().slice(0, 10);
          const tradesTodayList = userTrades.filter((t) => (t.executedAt || '').slice(0, 10) === todayKey);
          const openPositions = userTrades.filter((t) => t.status === 'SUBMITTED' || t.status === 'FILLED').length;
          const tradesToday = tradesTodayList.length;

          const cfg = user.config || defaultAppConfig();
          const isLive = cfg.execution_mode === 'live' && user.state === 'ARMED';
          let tradesCount = 0;
          let leansCount = 0;

          const userTokens = [
            ...(user.pushTokens || []),
            ...(user.fcmTokens || []),
          ].filter((t, i, arr) => t && arr.indexOf(t) === i);

          for (const asset of assets) {
            if (!cfg.assets_enabled?.[asset]) continue;

            const lean = sharedLeans[asset];
            if (!lean || !lean.market_ticker) continue;
            leansCount++;

            const userCushion = cfg.cushions?.[asset] ?? 25.0;
            const absGap = Math.abs((lean.live || 0) - (lean.strike || 0));

            if (absGap < userCushion) continue;

            const marketTicker = lean.market_ticker;
            const windowKey = `${marketTicker}_${lean.window_end || 'window'}`;

            if (existingTickers.has(marketTicker) || userClaimedWindows.has(windowKey)) continue;

            const assetTradesToday = tradesTodayList.filter((t) => t.asset === asset).length;

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
                assetTradesToday,
              }
            );

            if (cfg.alerts_enabled && userTokens.length > 0) {
              const title = `Signal · ${asset} ${lean.decision}`;
              const body = `Gap $${absGap.toFixed(2)} · Cushion $${userCushion} · ${lean.minutes_left ?? '?'}m left`;
              void sendPushNotification(userTokens, title, body, {
                asset,
                ticker: marketTicker,
                type: 'lean_signal',
                source: 'gcp',
              });
            }

            if (!cfg.auto_trade_enabled || user.state !== 'ARMED' || !gate.ok || !gate.price || !gate.count) continue;

            const secret = await getUserSecret(userId);
            if (!secret || !secret.privateKeyPem || !secret.keyId) {
              await upsertUserDoc(userId, { lastError: 'missing_secret_key' });
              continue;
            }

            userClaimedWindows.add(windowKey);

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

              const tradeDoc: TradeRecordDoc = {
                tradeId,
                userId,
                ticker: marketTicker,
                asset: lean.asset,
                decision: lean.decision,
                count: gate.count,
                price: gate.price,
                notionalUsd: gate.notional_usd || 0,
                dryRun: !isLive,
                status: 'SUBMITTED',
                leanDiff: absGap,
                liveSpot: lean.live,
                strike: lean.strike,
                executedAt: now.toISOString(),
              };

              await saveTradeRecord(userId, tradeDoc);
              await writeAuditLog(userId, 'TRADE_TRIGGERED', {
                tradeId,
                ticker: marketTicker,
                asset: lean.asset,
                decision: lean.decision,
                mode: isLive ? 'live' : 'demo',
              });

              if (userTokens.length > 0) {
                const fillTitle = isLive ? `Order Placed · ${asset} ${lean.decision}` : `Dry-Run Order · ${asset} ${lean.decision}`;
                const priceVal = typeof gate.price === 'number' ? gate.price : parseFloat(String(gate.price || 0));
                const fillBody = `${gate.count} ctr @ $${priceVal.toFixed(2)} · Cost $${(gate.notional_usd || 0).toFixed(2)}`;
                void sendPushNotification(userTokens, fillTitle, fillBody, {
                  tradeId,
                  asset: lean.asset,
                  type: 'order_filled',
                  source: 'gcp',
                });
              }
            }
          }

          await upsertUserDoc(userId, {
            lastTickAt: now.toISOString(),
            lastError: null,
          });

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

// Endpoint triggered every minute by Cloud Scheduler (executes 3 x 20s sub-ticks per invocation in production)
workerRouter.post('/tick', async (req: Request, res: Response) => {
  const isTest = process.env.NODE_ENV === 'test' || req.query.single === 'true';
  const tickCount = isTest ? 1 : 3;
  let lastResult: any = { activeUserCount: 0, results: [] };

  for (let i = 0; i < tickCount; i++) {
    lastResult = await runOneTick();
    if (i < tickCount - 1) {
      await new Promise((resolve) => setTimeout(resolve, 20000));
    }
  }

  res.json({
    ok: true,
    status: 'ok',
    timestamp: lastResult.timestamp,
    activeUsersCount: lastResult.activeUserCount,
    activeUserCount: lastResult.activeUserCount,
    results: lastResult.results,
  });
});

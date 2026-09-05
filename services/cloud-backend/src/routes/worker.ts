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
  writeAuditLog,
  TradeRecordDoc,
} from '../services/firestore';
import { sendPushNotification } from '../services/notifications';

export const workerRouter = Router();

// Helper to chunk array for parallel batch execution
function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

// Endpoint triggered every 20 seconds by Cloud Scheduler / Pub/Sub
workerRouter.post('/tick', async (_req: Request, res: Response) => {
  const now = new Date();
  const activeUsers = await getEnrolledActiveUsers();

  const results: Array<{
    userId: string;
    tradesPlaced: number;
    leansEvaluated: number;
    error?: string;
  }> = [];

  if (activeUsers.length === 0) {
    res.json({ ok: true, status: 'ok', activeUserCount: 0, activeUsersCount: 0, results: [] });
    return;
  }

  const assets: AssetKey[] = ['WTI', 'Gold', 'Silver', 'BTC', 'ETH'];

  // 1. DEDUPLICATION: Fetch market prices ONCE per tick for all assets (shared across all users)
  const sharedLeans: Partial<Record<AssetKey, any>> = {};
  await Promise.all(
    assets.map(async (asset) => {
      try {
        // Compute lean with base cushion 0.0 to retrieve raw spot price, strike & market ticker
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
          // Fetch encrypted Kalshi secret
          const secret = await getUserSecret(userId);
          if (!secret || !secret.privateKeyPem || !secret.keyId) {
            await upsertUserDoc(userId, { lastError: 'missing_secret_key' });
            results.push({ userId, tradesPlaced: 0, leansEvaluated: 0, error: 'missing_secret_key' });
            return;
          }

          // Fetch user trade history for window deduplication & risk gate limits
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
            const rawLean = sharedLeans[asset];
            if (!rawLean || !rawLean.ok || !rawLean.market_ticker) continue;

            const userCushion = cfg.cushions?.[asset] ?? 0.3;
            const absGap = rawLean.abs_gap ?? 0;
            leansCount++;

            // Evaluate custom cushion decision for this user
            let decision: 'YES' | 'NO' | 'SKIP' = 'SKIP';
            if (absGap >= userCushion && rawLean.decision && rawLean.decision !== 'SKIP') {
              decision = rawLean.decision;
            }

            if (decision === 'SKIP') continue;

            const marketTicker = rawLean.market_ticker;
            const windowKey = `${userId}:${marketTicker}`;

            // RACE CONDITION GUARD: Prevent duplicate orders in the same 15-minute market window
            if (existingTickers.has(marketTicker) || userClaimedWindows.has(windowKey)) {
              continue;
            }

            const lean = {
              ...rawLean,
              decision,
            };

            const assetTradesToday = tradesTodayList.filter((t) => t.asset === asset).length;

            // Evaluate static risk gates (time left, ask price, max open positions, daily loss stop)
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

            // Signal Push Notification Dispatch (when user requested Signal Alerts)
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

            if (!cfg.auto_trade_enabled || !gate.ok || !gate.price || !gate.count) continue;

            // Lock window key for this user tick
            userClaimedWindows.add(windowKey);

            // Execute Kalshi Order
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

              // Order Filled Push Notification
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

  res.json({
    ok: true,
    status: 'ok',
    timestamp: now.toISOString(),
    activeUsersCount: activeUsers.length,
    activeUserCount: activeUsers.length,
    results,
  });
});

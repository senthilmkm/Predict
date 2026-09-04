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

  for (const user of activeUsers) {
    const userId = user.userId;

    try {
      // 1. Fetch encrypted Kalshi secret
      const secret = await getUserSecret(userId);
      if (!secret || !secret.privateKeyPem || !secret.keyId) {
        await upsertUserDoc(userId, { lastError: 'missing_secret_key' });
        results.push({ userId, tradesPlaced: 0, leansEvaluated: 0, error: 'missing_secret_key' });
        continue;
      }

      // 2. Load user config & risk limits
      const cfg = user.config || defaultAppConfig();
      const assets: AssetKey[] = ['WTI', 'Gold', 'Silver', 'BTC', 'ETH'];

      let tradesCount = 0;
      let leansCount = 0;

      for (const asset of assets) {
        if (!cfg.assets_enabled?.[asset]) continue;
        const cushion = cfg.cushions?.[asset] || 0.3;

        // 3. Compute Lean signal
        const lean = await computeLean(asset, cushion, fetch, now);
        leansCount++;

        if (!lean.ok || lean.decision === 'SKIP' || !lean.market_ticker) continue;

        // 4. Evaluate risk gates
        const gate = evaluateStaticGate(
          {
            asset: lean.asset,
            market_ticker: lean.market_ticker,
            decision: lean.decision,
            live: lean.live || 0,
            strike: lean.strike || 0,
            abs_gap: lean.abs_gap || 0,
            minutes_left: lean.minutes_left || 0,
            minutes_elapsed: lean.minutes_elapsed || 0,
            phase: lean.phase === 'live' ? 'live' : 'ended',
            yes_ask: lean.yes_ask ?? undefined,
            no_ask: lean.no_ask ?? undefined,
          },
          cfg
        );

        if (!gate.ok || !gate.price || !gate.count) continue;

        // 5. Execute Kalshi Order (Dry Run Mode)
        const client = new KalshiClient(secret.keyId, secret.privateKeyPem, 'demo');
        const placeRes = await client.placeOrder({
          ticker: lean.market_ticker,
          side: gate.side || 'bid',
          count: gate.count,
          price: gate.price,
          time_in_force: gate.time_in_force,
          dry_run: true,
        });

        if (placeRes.ok) {
          tradesCount++;
          const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

          const tradeDoc: TradeRecordDoc = {
            tradeId,
            userId,
            ticker: lean.market_ticker,
            asset: lean.asset,
            decision: lean.decision,
            count: gate.count,
            price: gate.price,
            notionalUsd: gate.notional_usd || 0,
            dryRun: true,
            status: 'SUBMITTED',
            leanDiff: lean.abs_gap,
            liveSpot: lean.live,
            strike: lean.strike,
            executedAt: now.toISOString(),
          };

          await saveTradeRecord(userId, tradeDoc);
          await writeAuditLog(userId, 'TRADE_TRIGGERED', {
            tradeId,
            ticker: lean.market_ticker,
            asset: lean.asset,
            decision: lean.decision,
            dryRun: true,
          });

          // 6. Push notification alert
          if (user.fcmTokens && user.fcmTokens.length > 0) {
            await sendPushNotification(
              user.fcmTokens,
              `Predict Cloud: ${lean.asset} ${lean.decision} Signal`,
              `Dry-run order placed for ${lean.market_ticker} at $${gate.price} (gap: ${lean.abs_gap?.toFixed(2)}).`,
              { tradeId, asset: lean.asset }
            );
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
  }

  res.json({
    ok: true,
    timestamp: now.toISOString(),
    activeUserCount: activeUsers.length,
    results,
  });
});

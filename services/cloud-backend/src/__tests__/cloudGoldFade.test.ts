import request from 'supertest';
import { app } from '../index';
import { saveTradeRecord, getTradeRecords, resetSystemConfigCacheForTests } from '../services/firestore';
import { pendingProtectTradesForMarket, runCloudProtectSells } from '../services/cloudProtectSell';
import { pendingGoldFadeTradesForMarket, runCloudGoldFadeExits } from '../services/cloudGoldFade';
import { evaluateGoldFadeEnter } from '../../../../packages/trading-core/src/goldFade';
import { defaultAppConfig } from '../../../../packages/trading-core/src/types';
import { normalizeFeatureFlags } from '../services/featureFlags';

function filledTrade(over: Record<string, unknown> = {}) {
  return {
    tradeId: String(over.tradeId || 'trade_fade_1'),
    userId: String(over.userId || 'user_fade'),
    ticker: String(over.ticker || 'KXGOLD-T'),
    asset: String(over.asset || 'Gold'),
    decision: (over.decision as 'YES' | 'NO') || 'YES',
    count: String(over.count ?? '10'),
    price: String(over.price ?? '0.46'),
    notionalUsd: Number(over.notionalUsd ?? 4.6),
    dryRun: Boolean(over.dryRun),
    status: (over.status as any) || 'FILLED',
    executedAt: String(over.executedAt || '2026-09-11T15:00:00.000Z'),
    orderId: (over.orderId as string | null | undefined) ?? 'ord-fade',
    payPrice: over.payPrice ?? 0.46,
    fillCount: over.fillCount ?? 10,
    pnlUsd: over.pnlUsd ?? null,
    outcome: (over.outcome as string) ?? 'pending',
    protectClaimedAt: (over.protectClaimedAt as string | null | undefined) ?? null,
    protectExitOrderId: (over.protectExitOrderId as string | null | undefined) ?? null,
    entryPath: over.entryPath ?? 'gold_fade',
  } as any;
}

describe('Cloud Gold fade', () => {
  beforeEach(() => {
    resetSystemConfigCacheForTests();
  });

  test('Admin flag defaults Off; Protect skips gold_fade rows', () => {
    expect(normalizeFeatureFlags(null).goldFade).toBe(false);
    expect(normalizeFeatureFlags({ goldFade: true }).goldFade).toBe(true);
    const fade = filledTrade();
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    expect(pendingGoldFadeTradesForMarket([fade, home], 'KXGOLD-T').map((t) => t.tradeId)).toEqual([
      'trade_fade_1',
    ]);
    expect(pendingProtectTradesForMarket([fade, home], 'KXGOLD-T', new Date()).map((t) => t.tradeId)).toEqual([
      'home1',
    ]);
  });

  test('take sells after grace; IOC miss does not close', async () => {
    const userId = 'user_fade_take';
    const trade = filledTrade({ userId });
    await saveTradeRecord(userId, trade);
    const miss = await runCloudGoldFadeExits({
      userId,
      asset: 'Gold',
      ticker: trade.ticker,
      lean: { decision: 'YES', abs_gap: 2, phase: 'live', minutes_left: 8, yes_bid: 0.52, yes_ask: 0.54 },
      trades: [trade],
      cushion: 7,
      takeUsd: 0.06,
      stopUsd: 0.05,
      flattenMinutes: 3,
      graceSeconds: 45,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-11T15:01:00.000Z'),
      place: async () => ({ ok: true, fill_count: 0, order_id: null }),
    });
    expect(miss.exited).toBe(0);
    expect(miss.skipped).toContain('ioc_miss');

    const hit = await runCloudGoldFadeExits({
      userId,
      asset: 'Gold',
      ticker: trade.ticker,
      lean: { decision: 'YES', abs_gap: 2, phase: 'live', minutes_left: 8, yes_bid: 0.52, yes_ask: 0.54 },
      trades: await getTradeRecords(userId),
      cushion: 7,
      takeUsd: 0.06,
      stopUsd: 0.05,
      flattenMinutes: 3,
      graceSeconds: 45,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-11T15:01:05.000Z'),
      place: async () => ({ ok: true, fill_count: 10, order_id: 'ord-take' }),
    });
    expect(hit.exited).toBe(1);
    expect(hit.alerts[0].title).toBe('Gold fade');
  });

  test('window end dumps; stop and flatten titles', async () => {
    const userId = 'user_fade_time';
    const trade = filledTrade({ userId, executedAt: '2026-09-11T15:00:00.000Z' });
    await saveTradeRecord(userId, trade);
    const ended = await runCloudGoldFadeExits({
      userId,
      asset: 'Gold',
      ticker: trade.ticker,
      lean: { decision: 'YES', abs_gap: 2, phase: 'ended', minutes_left: 0, yes_bid: 0.47, yes_ask: 0.49 },
      trades: [trade],
      cushion: 7,
      takeUsd: 0.06,
      stopUsd: 0.05,
      flattenMinutes: 3,
      graceSeconds: 45,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-11T15:00:20.000Z'),
      place: async () => ({ ok: true, fill_count: 10, order_id: 'ord-end' }),
    });
    expect(ended.exited).toBe(1);
    expect(ended.alerts[0].title).toBe('Gold fade time');
  });

  test('Protect does not sell a gold_fade row', async () => {
    const userId = 'user_fade_prot';
    const trade = filledTrade({ userId });
    await saveTradeRecord(userId, trade);
    let placed = 0;
    const res = await runCloudProtectSells({
      userId,
      asset: 'Gold',
      ticker: trade.ticker,
      lean: { decision: 'NO', abs_gap: 20, phase: 'live', yes_bid: 0.4, yes_ask: 0.42 },
      trades: [trade],
      cushion: 7,
      gapRatio: 1,
      graceSeconds: 45,
      slippageUsd: 0.02,
      enabled: true,
      dryRun: false,
      now: new Date('2026-09-11T15:01:00.000Z'),
      place: async () => {
        placed += 1;
        return { ok: true, fill_count: 10, order_id: 'ord-p' };
      },
    });
    expect(res.exited).toBe(0);
    expect(placed).toBe(0);
  });

  test('enter refuses when another path is holding', () => {
    const c = defaultAppConfig();
    c.auto_trade_enabled = true;
    c.cushions.Gold = 7;
    c.risk.gold_fade_enabled = true;
    const gate = evaluateGoldFadeEnter({
      lean: {
        asset: 'Gold',
        market_ticker: 'KXGOLD-T',
        decision: 'NO',
        live: 2648,
        strike: 2650,
        abs_gap: 2,
        minutes_left: 8,
        minutes_elapsed: 3,
        phase: 'live',
        yes_ask: 0.46,
        yes_bid: 0.42,
        no_ask: 0.54,
        no_bid: 0.5,
      },
      cfg: c,
      adminEnabled: true,
      hasOpenOnTicker: true,
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('gold_fade_holding_other_path');
  });

  test('POST /me/status persists Gold fade settings; merge keeps Cash out', async () => {
    const uid = 'user_fade_cfg';
    const on = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: {
          risk: {
            gold_fade_enabled: true,
            gold_fade_max_gap_usd: 3,
            gold_fade_max_ask_usd: 0.5,
            gold_fade_take_usd: 0.06,
            gold_fade_stop_usd: 0.05,
            gold_fade_flatten_minutes: 3,
            cash_out_enabled: true,
          },
        },
      });
    expect(on.status).toBe(200);
    expect(on.body.userDoc.config.risk.gold_fade_enabled).toBe(true);
    expect(on.body.userDoc.config.risk.gold_fade_take_usd).toBe(0.06);
    expect(on.body.userDoc.config.risk.cash_out_enabled).toBe(true);
    const off = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: { risk: { gold_fade_enabled: false } },
      });
    expect(off.body.userDoc.config.risk.gold_fade_enabled).toBe(false);
    expect(off.body.userDoc.config.risk.cash_out_enabled).toBe(true);
  });
});

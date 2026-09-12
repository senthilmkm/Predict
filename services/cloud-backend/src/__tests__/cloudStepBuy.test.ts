import request from 'supertest';
import { app } from '../index';
import { normalizeFeatureFlags } from '../services/featureFlags';
import { pendingProtectTradesForMarket, runCloudProtectSells } from '../services/cloudProtectSell';
import { evaluateStepBuyEnter } from '../../../../packages/trading-core/src/stepBuy';
import { runCloudStepBuyStops } from '../services/cloudStepBuy';
import {
  buildStepBuyWatcherSnapshot,
  formatStepBuyWatcherChip,
} from '../services/stepBuyWatcher';
import { defaultAppConfig } from '../../../../packages/trading-core/src/types';
import { TradeRecordDoc } from '../services/firestore';

function filledTrade(over: Partial<TradeRecordDoc> = {}): TradeRecordDoc {
  return {
    tradeId: over.tradeId || 't1',
    userId: 'u1',
    ticker: over.ticker || 'KXGOLD15M-T',
    asset: over.asset || 'Gold',
    decision: over.decision || 'YES',
    count: '1',
    price: '0.72',
    notionalUsd: 0.72,
    dryRun: false,
    status: 'FILLED',
    leanDiff: 4,
    liveSpot: 3704,
    strike: 3700,
    executedAt: '2026-09-12T10:06:00.000Z',
    orderId: 'ord1',
    payPrice: 0.72,
    fillCount: 1,
    outcome: 'pending',
    pnlUsd: null,
    entryPath: over.entryPath ?? 'step_buy',
    stepLotIndex: over.stepLotIndex ?? 1,
    ...over,
  };
}

describe('Step buy cloud wiring', () => {
  test('Admin flag defaults Off; Protect skips step_buy rows', () => {
    expect(normalizeFeatureFlags(null).stepBuy).toBe(false);
    const sb = filledTrade({ tradeId: 'sb1' });
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    expect(pendingProtectTradesForMarket([sb, home], 'KXGOLD15M-T', new Date()).map((t) => t.tradeId)).toEqual([
      'home1',
    ]);
  });

  test('Protect does not sell a step_buy row', async () => {
    const placed: unknown[] = [];
    const res = await runCloudProtectSells({
      userId: 'u1',
      asset: 'Gold',
      ticker: 'KXGOLD15M-T',
      lean: { decision: 'NO', abs_gap: 40, phase: 'live', yes_bid: 0.9, yes_ask: 0.92 },
      trades: [filledTrade()],
      cushion: 4,
      gapRatio: 1,
      graceSeconds: 0,
      slippageUsd: 0.02,
      enabled: true,
      dryRun: false,
      now: new Date('2026-09-12T10:14:58.000Z'),
      place: async (input) => {
        placed.push(input);
        return { ok: true, fill_count: input.count, order_id: 'x' };
      },
    });
    expect(res.exited).toBe(0);
    expect(placed).toHaveLength(0);
  });

  test('enter refuses when another path is holding', () => {
    const c = defaultAppConfig();
    c.auto_trade_enabled = true;
    c.assets_enabled.Gold = true;
    c.cushions.Gold = 4;
    c.risk.step_buy_enabled = true;
    const close = new Date('2026-09-12T10:15:00.000Z');
    const gate = evaluateStepBuyEnter({
      lean: {
        asset: 'Gold',
        market_ticker: 'KXGOLD15M-T',
        decision: 'YES',
        live: 3704,
        strike: 3700,
        abs_gap: 4,
        minutes_left: 8,
        minutes_elapsed: 7,
        phase: 'live',
        yes_ask: 0.72,
        yes_bid: 0.7,
        no_ask: 0.3,
        close_utc: close.toISOString(),
      },
      cfg: c,
      adminEnabled: true,
      now: new Date(close.getTime() - 8 * 60_000),
      hasOpenOnTicker: true,
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('step_buy_holding_other_path');
  });

  test('lot 1 stop flattens remaining Step buy lots at the bid', async () => {
    const lot1 = filledTrade({ tradeId: 'sb-1', stepLotIndex: 1, payPrice: 0.72 });
    const lot2 = filledTrade({
      tradeId: 'sb-2',
      stepLotIndex: 2,
      payPrice: 0.73,
      executedAt: '2026-09-12T10:08:00.000Z',
    });
    const placed: Array<{ ticker: string; count: string }> = [];
    const res = await runCloudStepBuyStops({
      userId: 'u1',
      asset: 'Gold',
      ticker: 'KXGOLD15M-T',
      lean: { phase: 'live', yes_bid: 0.68, yes_ask: 0.69, no_bid: 0.3, no_ask: 0.32 },
      trades: [lot1, lot2],
      stopUsd: 0.03,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-12T10:14:20.000Z'),
      place: async (input) => {
        placed.push({ ticker: input.ticker, count: input.count });
        return { ok: true, fill_count: input.count, order_id: `x-${placed.length}` };
      },
    });
    expect(res.exited).toBe(2);
    expect(placed).toHaveLength(2);
    expect(res.alerts[0]?.title).toBe('Step buy stop');
    expect(res.alerts[0]?.body).toMatch(/lot 1 flatten/);
  });

  test('POST /me/status persists Step buy settings; merge keeps Last-minute', async () => {
    const uid = 'user_step_buy_cfg';
    const on = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: {
          risk: {
            step_buy_enabled: true,
            step_buy_start_minutes: 6,
            step_buy_cushion_pct: 40,
            step_buy_lot_count: 2,
            step_buy_add_wait_minutes: 2,
            step_buy_add_band_usd: 0.03,
            step_buy_max_lots: 4,
            step_buy_stop_usd: 0.04,
            step_buy_max_ask_usd: 0.78,
            step_buy_assets: ['Gold', 'WTI'],
            step_buy_skip_thin_bid: true,
            last_minute_enabled: true,
            last_minute_skip_thin_bid: false,
          },
        },
      });
    expect(on.status).toBe(200);
    expect(on.body.userDoc.config.risk.step_buy_enabled).toBe(true);
    expect(on.body.userDoc.config.risk.step_buy_start_minutes).toBe(6);
    expect(on.body.userDoc.config.risk.step_buy_cushion_pct).toBe(40);
    expect(on.body.userDoc.config.risk.step_buy_lot_count).toBe(2);
    expect(on.body.userDoc.config.risk.step_buy_add_wait_minutes).toBe(2);
    expect(on.body.userDoc.config.risk.step_buy_add_band_usd).toBe(0.03);
    expect(on.body.userDoc.config.risk.step_buy_max_lots).toBe(4);
    expect(on.body.userDoc.config.risk.step_buy_stop_usd).toBe(0.04);
    expect(on.body.userDoc.config.risk.step_buy_max_ask_usd).toBe(0.78);
    expect(on.body.userDoc.config.risk.step_buy_assets).toEqual(['Gold', 'WTI']);
    expect(on.body.userDoc.config.risk.step_buy_skip_thin_bid).toBe(true);
    expect(on.body.userDoc.config.risk.last_minute_enabled).toBe(true);
    expect(on.body.userDoc.config.risk.last_minute_skip_thin_bid).toBe(false);
    const off = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: { risk: { step_buy_enabled: false } },
      });
    expect(off.body.userDoc.config.risk.step_buy_enabled).toBe(false);
    expect(off.body.userDoc.config.risk.last_minute_enabled).toBe(true);
    expect(off.body.userDoc.config.risk.step_buy_max_ask_usd).toBe(0.78);
  });
});

describe('Step buy watcher chip', () => {
  test('idle when no users; watching lists coins and leftover seconds', () => {
    const now = new Date('2026-09-12T00:40:20.000Z');
    const close = new Date('2026-09-12T00:45:00.000Z');
    expect(formatStepBuyWatcherChip(null, now)).toBe('Step buy watcher · idle');
    const watching = buildStepBuyWatcherSnapshot({
      now,
      watchUsers: new Map([['usr_1', ['Gold', 'WTI']]]),
      closeByAsset: { Gold: close, WTI: close },
    });
    expect(watching.watching).toBe(true);
    expect(watching.userCount).toBe(1);
    expect(watching.assets).toEqual(['Gold', 'WTI']);
    expect(watching.secondsLeft).toBe(280);
    expect(formatStepBuyWatcherChip(watching, now)).toBe(
      'Step buy watcher · 1 user · Gold WTI · 280s left'
    );
    expect(formatStepBuyWatcherChip(watching, new Date(now.getTime() + 20_000))).toBe(
      'Step buy watcher · idle'
    );
  });
});

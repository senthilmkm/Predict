import { normalizeFeatureFlags } from '../services/featureFlags';
import { pendingProtectTradesForMarket } from '../services/cloudProtectSell';
import { pendingBufferRunTradesForMarket } from '../services/cloudBufferRun';
import {
  evaluateBufferRunEnter,
  evaluateBufferRunExit,
  normalizeBufferRunAssets,
} from '../../../../packages/trading-core/src/bufferRun';
import { defaultAppConfig } from '../../../../packages/trading-core/src/types';
import { TradeRecordDoc } from '../services/firestore';
import request from 'supertest';
import { app } from '../index';

function filledTrade(over: Partial<TradeRecordDoc> = {}): TradeRecordDoc {
  return {
    tradeId: over.tradeId || 't1',
    userId: 'u1',
    ticker: over.ticker || 'KXBTC15M-T',
    asset: over.asset || 'BTC',
    decision: over.decision || 'YES',
    count: '1',
    price: '0.50',
    notionalUsd: 0.5,
    dryRun: false,
    status: 'FILLED',
    leanDiff: 80,
    liveSpot: 70080,
    strike: 70000,
    executedAt: '2026-09-13T21:04:00.000Z',
    orderId: 'ord1',
    payPrice: 0.5,
    fillCount: 1,
    outcome: 'pending',
    pnlUsd: null,
    entryPath: over.entryPath ?? 'buffer_run',
    ...over,
  };
}

describe('Buffer run cloud wiring', () => {
  test('Admin flag defaults Off; Protect skips buffer_run rows', () => {
    expect(normalizeFeatureFlags(null).bufferRun).toBe(false);
    const br = filledTrade({ tradeId: 'br1' });
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    expect(
      pendingProtectTradesForMarket([br, home], 'KXBTC15M-T', new Date()).map((t) => t.tradeId)
    ).toEqual(['home1']);
  });

  test('pending filter only returns open buffer_run lots', () => {
    const br = filledTrade({ tradeId: 'br1' });
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    const exited = filledTrade({ tradeId: 'br2', outcome: 'exited', protectExitOrderId: 'x1' });
    expect(pendingBufferRunTradesForMarket([br, home, exited], 'KXBTC15M-T').map((t) => t.tradeId)).toEqual([
      'br1',
    ]);
    expect(normalizeBufferRunAssets([])).toEqual([]);
    expect(normalizeBufferRunAssets(null)).toEqual(['BTC', 'ETH']);
  });

  test('holding another path blocks Buffer run enter', () => {
    const c = defaultAppConfig();
    c.auto_trade_enabled = true;
    c.assets_enabled.BTC = true;
    c.risk.buffer_run_enabled = true;
    c.risk.buffer_run_assets = ['BTC'];
    const gate = evaluateBufferRunEnter({
      lean: {
        asset: 'BTC',
        market_ticker: 'KXBTC15M-T',
        decision: 'YES',
        live: 70100,
        strike: 70000,
        abs_gap: 100,
        minutes_left: 8,
        minutes_elapsed: 5,
        minutes_remaining: 8,
        phase: 'live',
        yes_ask: 0.5,
        no_ask: 0.5,
      },
      cfg: c,
      adminEnabled: true,
      hasOpenOnTicker: true,
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('buffer_run_holding_other_path');
  });

  test('exit path take / lean_flip / flatten', () => {
    const take = evaluateBufferRunExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.65, yes_ask: 0.66, no_bid: 0.34, no_ask: 0.35 },
      fillUsd: 0.5,
      takeUsd: 0.12,
      stopUsd: 0.07,
      flattenMinutes: 3,
      lean: { phase: 'live', minutes_left: 8, live: 70100, strike: 70000 },
      filledAt: '2026-09-13T21:00:00.000Z',
      now: new Date('2026-09-13T21:01:00.000Z'),
    });
    expect(take.kind).toBe('buffer_run_take');

    const flip = evaluateBufferRunExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.5, yes_ask: 0.51, no_bid: 0.49, no_ask: 0.5 },
      fillUsd: 0.5,
      takeUsd: 0.12,
      stopUsd: 0.07,
      flattenMinutes: 3,
      lean: { phase: 'live', minutes_left: 8, live: 69900, strike: 70000 },
      filledAt: '2026-09-13T21:00:00.000Z',
      now: new Date('2026-09-13T21:01:00.000Z'),
    });
    expect(flip.kind).toBe('buffer_run_lean_flip');

    const flatten = evaluateBufferRunExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.5, yes_ask: 0.51, no_bid: 0.49, no_ask: 0.5 },
      fillUsd: 0.5,
      takeUsd: 0.12,
      stopUsd: 0.07,
      flattenMinutes: 3,
      lean: { phase: 'live', minutes_left: 2, live: 70100, strike: 70000 },
      filledAt: '2026-09-13T21:00:00.000Z',
      now: new Date('2026-09-13T21:01:00.000Z'),
    });
    expect(flatten.kind).toBe('buffer_run_flatten');
  });

  test('user config persists Buffer run knobs', async () => {
    const uid = 'user_buffer_run_cfg';
    const on = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: {
          risk: {
            buffer_run_enabled: true,
            buffer_run_ask_min_usd: 0.42,
            buffer_run_ask_max_usd: 0.62,
            buffer_run_take_usd: 0.12,
            buffer_run_stop_usd: 0.07,
            buffer_run_enter_elapsed_minutes: 3,
            buffer_run_enter_left_minutes: 5,
            buffer_run_flatten_minutes: 3,
            buffer_run_assets: ['BTC', 'ETH'],
          },
        },
      });
    expect(on.status).toBe(200);
    expect(on.body.userDoc.config.risk.buffer_run_enabled).toBe(true);
    expect(on.body.userDoc.config.risk.buffer_run_ask_min_usd).toBe(0.42);
    expect(on.body.userDoc.config.risk.buffer_run_ask_max_usd).toBe(0.62);
    expect(on.body.userDoc.config.risk.buffer_run_take_usd).toBe(0.12);
    expect(on.body.userDoc.config.risk.buffer_run_stop_usd).toBe(0.07);
    expect(on.body.userDoc.config.risk.buffer_run_enter_elapsed_minutes).toBe(3);
    expect(on.body.userDoc.config.risk.buffer_run_enter_left_minutes).toBe(5);
    expect(on.body.userDoc.config.risk.buffer_run_flatten_minutes).toBe(3);
    expect(on.body.userDoc.config.risk.buffer_run_assets).toEqual(['BTC', 'ETH']);
  });
});

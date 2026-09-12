import { normalizeFeatureFlags } from '../services/featureFlags';
import { pendingProtectTradesForMarket } from '../services/cloudProtectSell';
import { evaluateSpikeFadeEnter } from '../../../../packages/trading-core/src/spikeFade';
import {
  buildSpikeFadeWatcherSnapshot,
  formatSpikeFadeWatcherChip,
} from '../services/spikeFadeWatcher';
import { defaultAppConfig } from '../../../../packages/trading-core/src/types';
import { TradeRecordDoc } from '../services/firestore';
import request from 'supertest';
import { app } from '../index';

function filledTrade(over: Partial<TradeRecordDoc> = {}): TradeRecordDoc {
  return {
    tradeId: over.tradeId || 't1',
    userId: 'u1',
    ticker: over.ticker || 'KXGOLD15M-T',
    asset: over.asset || 'Gold',
    decision: over.decision || 'NO',
    count: '1',
    price: '0.22',
    notionalUsd: 0.22,
    dryRun: false,
    status: 'FILLED',
    leanDiff: 2,
    liveSpot: 2650,
    strike: 2648,
    executedAt: '2026-09-12T10:04:00.000Z',
    orderId: 'ord1',
    payPrice: 0.22,
    fillCount: 1,
    outcome: 'pending',
    pnlUsd: null,
    entryPath: over.entryPath ?? 'spike_fade',
    ...over,
  };
}

describe('Spike fade cloud wiring', () => {
  test('Admin flag defaults Off; Protect skips spike_fade rows', () => {
    expect(normalizeFeatureFlags(null).spikeFade).toBe(false);
    const sf = filledTrade({ tradeId: 'sf1' });
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    expect(pendingProtectTradesForMarket([sf, home], 'KXGOLD15M-T', new Date()).map((t) => t.tradeId)).toEqual([
      'home1',
    ]);
  });

  test('watcher chip is idle until users are watching', () => {
    const idle = buildSpikeFadeWatcherSnapshot({
      now: new Date('2026-09-12T10:00:00.000Z'),
      watchUsers: new Map(),
      minutesLeftByAsset: {},
    });
    expect(formatSpikeFadeWatcherChip(idle)).toMatch(/idle/);
    const now = new Date();
    const live = buildSpikeFadeWatcherSnapshot({
      now,
      watchUsers: new Map([['u1', ['Gold']]]),
      minutesLeftByAsset: { Gold: 10 },
    });
    expect(formatSpikeFadeWatcherChip(live, now)).toMatch(/1 user/);
    expect(formatSpikeFadeWatcherChip(live, now)).toMatch(/Gold/);
  });

  test('holding another path blocks Spike fade enter', () => {
    const c = defaultAppConfig();
    c.auto_trade_enabled = true;
    c.assets_enabled.Gold = true;
    c.risk.spike_fade_enabled = true;
    const gate = evaluateSpikeFadeEnter({
      lean: {
        asset: 'Gold',
        market_ticker: 'KXGOLD15M-T',
        decision: 'YES',
        live: 2650,
        strike: 2648,
        abs_gap: 2,
        minutes_left: 10,
        minutes_elapsed: 4,
        phase: 'live',
        yes_ask: 0.78,
        no_ask: 0.22,
      },
      cfg: c,
      adminEnabled: true,
      hasOpenOnTicker: true,
    });
    expect(gate.skip_reason).toBe('spike_fade_holding_other_path');
  });

  test('user config persists Spike fade knobs', async () => {
    const uid = 'user_spike_fade_cfg';
    const on = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: {
          risk: {
            spike_fade_enabled: true,
            spike_fade_start_minutes: 3,
            spike_fade_until_minutes: 7,
            spike_fade_expensive_min_usd: 0.76,
            spike_fade_expensive_max_usd: 0.81,
            spike_fade_cheap_min_usd: 0.19,
            spike_fade_cheap_max_usd: 0.24,
            spike_fade_take_ask_usd: 0.4,
            spike_fade_stop_ask_usd: 0.08,
            spike_fade_flatten_minutes: 4,
            spike_fade_lot_count: 2,
            spike_fade_assets: ['Gold', 'WTI'],
            spike_fade_skip_thin_bid: true,
            last_minute_enabled: true,
          },
        },
      });
    expect(on.status).toBe(200);
    expect(on.body.userDoc.config.risk.spike_fade_enabled).toBe(true);
    expect(on.body.userDoc.config.risk.spike_fade_start_minutes).toBe(3);
    expect(on.body.userDoc.config.risk.spike_fade_until_minutes).toBe(7);
    expect(on.body.userDoc.config.risk.spike_fade_expensive_min_usd).toBe(0.76);
    expect(on.body.userDoc.config.risk.spike_fade_expensive_max_usd).toBe(0.81);
    expect(on.body.userDoc.config.risk.spike_fade_cheap_min_usd).toBe(0.19);
    expect(on.body.userDoc.config.risk.spike_fade_cheap_max_usd).toBe(0.24);
    expect(on.body.userDoc.config.risk.spike_fade_take_ask_usd).toBe(0.4);
    expect(on.body.userDoc.config.risk.spike_fade_stop_ask_usd).toBe(0.08);
    expect(on.body.userDoc.config.risk.spike_fade_flatten_minutes).toBe(4);
    expect(on.body.userDoc.config.risk.spike_fade_lot_count).toBe(2);
    expect(on.body.userDoc.config.risk.spike_fade_assets).toEqual(['Gold', 'WTI']);
    expect(on.body.userDoc.config.risk.spike_fade_skip_thin_bid).toBe(true);
    expect(on.body.userDoc.config.risk.last_minute_enabled).toBe(true);
  });
});

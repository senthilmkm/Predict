import { normalizeFeatureFlags } from '../services/featureFlags';
import { pendingProtectTradesForMarket } from '../services/cloudProtectSell';
import { evaluatePairLockEnter } from '../../../../packages/trading-core/src/pairLock';
import {
  buildPairLockWatcherSnapshot,
  formatPairLockWatcherChip,
} from '../services/pairLockWatcher';
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
    decision: over.decision || 'YES',
    count: '1',
    price: '0.52',
    notionalUsd: 0.52,
    dryRun: false,
    status: 'FILLED',
    leanDiff: 2,
    liveSpot: 2650,
    strike: 2648,
    executedAt: '2026-09-12T10:04:00.000Z',
    orderId: 'ord1',
    payPrice: 0.52,
    fillCount: 1,
    outcome: 'pending',
    pnlUsd: null,
    entryPath: over.entryPath ?? 'pair_lock',
    ...over,
  };
}

describe('Pair lock cloud wiring', () => {
  test('Admin flag defaults Off; Protect skips pair_lock rows', () => {
    expect(normalizeFeatureFlags(null).pairLock).toBe(false);
    const pl = filledTrade({ tradeId: 'pl1' });
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    expect(pendingProtectTradesForMarket([pl, home], 'KXGOLD15M-T', new Date()).map((t) => t.tradeId)).toEqual([
      'home1',
    ]);
  });

  test('watcher chip is idle until users are watching', () => {
    const idle = buildPairLockWatcherSnapshot({
      now: new Date('2026-09-12T10:00:00.000Z'),
      watchUsers: new Map(),
      minutesLeftByAsset: {},
    });
    expect(formatPairLockWatcherChip(idle)).toMatch(/idle/);
    const now = new Date();
    const live = buildPairLockWatcherSnapshot({
      now,
      watchUsers: new Map([['u1', ['Gold']]]),
      minutesLeftByAsset: { Gold: 10 },
    });
    expect(formatPairLockWatcherChip(live, now)).toMatch(/1 user/);
    expect(formatPairLockWatcherChip(live, now)).toMatch(/Gold/);
  });

  test('holding another path blocks Pair lock enter', () => {
    const c = defaultAppConfig();
    c.auto_trade_enabled = true;
    c.assets_enabled.Gold = true;
    c.risk.pair_lock_enabled = true;
    const gate = evaluatePairLockEnter({
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
        yes_ask: 0.52,
        no_ask: 0.48,
      },
      cfg: c,
      adminEnabled: true,
      hasOpenOnTicker: true,
    });
    expect(gate.skip_reason).toBe('pair_lock_holding_other_path');
  });

  test('user config persists Pair lock knobs', async () => {
    const uid = 'user_pair_lock_cfg';
    const on = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: {
          risk: {
            pair_lock_enabled: true,
            pair_lock_start_minutes: 3,
            pair_lock_until_minutes: 11,
            pair_lock_runner_max_ask_usd: 0.58,
            pair_lock_min_lock_usd: 0.07,
            pair_lock_flatten_minutes: 4,
            pair_lock_lot_count: 2,
            pair_lock_assets: ['Gold', 'WTI'],
            pair_lock_skip_thin_bid: true,
            last_minute_enabled: true,
          },
        },
      });
    expect(on.status).toBe(200);
    expect(on.body.userDoc.config.risk.pair_lock_enabled).toBe(true);
    expect(on.body.userDoc.config.risk.pair_lock_start_minutes).toBe(3);
    expect(on.body.userDoc.config.risk.pair_lock_until_minutes).toBe(11);
    expect(on.body.userDoc.config.risk.pair_lock_runner_max_ask_usd).toBe(0.58);
    expect(on.body.userDoc.config.risk.pair_lock_min_lock_usd).toBe(0.07);
    expect(on.body.userDoc.config.risk.pair_lock_flatten_minutes).toBe(4);
    expect(on.body.userDoc.config.risk.pair_lock_lot_count).toBe(2);
    expect(on.body.userDoc.config.risk.pair_lock_assets).toEqual(['Gold', 'WTI']);
    expect(on.body.userDoc.config.risk.pair_lock_skip_thin_bid).toBe(true);
    expect(on.body.userDoc.config.risk.last_minute_enabled).toBe(true);
  });
});

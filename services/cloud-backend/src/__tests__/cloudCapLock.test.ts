import { normalizeFeatureFlags } from '../services/featureFlags';
import { pendingProtectTradesForMarket } from '../services/cloudProtectSell';
import { evaluateCapLockEnter, normalizeCapLockAssets } from '../../../../packages/trading-core/src/capLock';
import { ASSETS_CATALOG, defaultAppConfig } from '../../../../packages/trading-core/src/types';
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
    price: '0.50',
    notionalUsd: 0.5,
    dryRun: false,
    status: 'FILLED',
    leanDiff: 0,
    liveSpot: 2650,
    strike: 2650,
    executedAt: '2026-09-15T10:00:00.000Z',
    orderId: 'ord1',
    payPrice: 0.5,
    fillCount: 1,
    outcome: 'pending',
    pnlUsd: null,
    entryPath: over.entryPath ?? 'cap_lock',
    ...over,
  };
}

describe('Cap lock cloud wiring', () => {
  test('Admin flag defaults Off; Protect skips cap_lock rows', () => {
    expect(normalizeFeatureFlags(null).capLock).toBe(false);
    const cl = filledTrade({ tradeId: 'cl1' });
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    expect(pendingProtectTradesForMarket([cl, home], 'KXGOLD15M-T', new Date()).map((t) => t.tradeId)).toEqual([
      'home1',
    ]);
  });

  test('full 15m catalog stays selectable including HYPE', () => {
    const keys = ASSETS_CATALOG.map((a) => a.key);
    expect(keys.includes('HYPE')).toBe(true);
    expect(normalizeCapLockAssets(keys)).toEqual(keys);
    expect(normalizeCapLockAssets([]).length).toBe(0);
  });

  test('holding another path blocks Cap lock enter', () => {
    const c = defaultAppConfig();
    c.auto_trade_enabled = true;
    c.assets_enabled.Gold = true;
    c.risk.cap_lock_enabled = true;
    c.risk.cap_lock_assets = ['Gold'];
    const gate = evaluateCapLockEnter({
      lean: {
        asset: 'Gold',
        market_ticker: 'KXGOLD15M-T',
        decision: 'SKIP' as const,
        live: 2650,
        strike: 2650,
        abs_gap: 0,
        minutes_left: 13,
        minutes_elapsed: 0,
        minutes_remaining: 14.5,
        phase: 'live',
        yes_ask: 0.5,
        no_ask: 0.5,
      },
      cfg: c,
      adminEnabled: true,
      hasOpenOnTicker: true,
    });
    expect(gate.skip_reason).toBe('cap_lock_holding_other_path');
  });

  test('user config persists Cap lock knobs', async () => {
    const uid = 'user_cap_lock_cfg';
    const on = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: {
          risk: {
            cap_lock_enabled: true,
            cap_lock_max_loss_usd: 0.04,
            cap_lock_window_open_seconds: 60,
            cap_lock_allow_later: false,
            cap_lock_lot_count: 2,
            cap_lock_assets: ['Gold', 'HYPE', 'BTC'],
          },
        },
      });
    expect(on.status).toBe(200);
    expect(on.body.userDoc.config.risk.cap_lock_enabled).toBe(true);
    expect(on.body.userDoc.config.risk.cap_lock_max_loss_usd).toBe(0.04);
    expect(on.body.userDoc.config.risk.cap_lock_window_open_seconds).toBe(60);
    expect(on.body.userDoc.config.risk.cap_lock_allow_later).toBe(false);
    expect(on.body.userDoc.config.risk.cap_lock_lot_count).toBe(2);
    expect(on.body.userDoc.config.risk.cap_lock_assets).toEqual(['Gold', 'HYPE', 'BTC']);
  });
});

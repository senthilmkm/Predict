import request from 'supertest';
import { computeLean, defaultAppConfig } from 'trading-core';
import { app } from '../index';
import { upsertUserDoc } from '../services/firestore';

jest.mock('trading-core', () => {
  const actual = jest.requireActual('trading-core');
  return {
    ...actual,
    computeLean: jest.fn(),
  };
});

const leanMock = computeLean as jest.MockedFunction<typeof computeLean>;

function richBnbLean() {
  return {
    ok: true,
    asset: 'BNB',
    market_ticker: 'KXBNB15M-TEST',
    decision: 'YES' as const,
    live: 880,
    strike: 876,
    abs_gap: 4,
    minutes_left: 8,
    minutes_elapsed: 6,
    phase: 'live' as const,
    yes_ask: 1,
    no_ask: 0.01,
  };
}

describe('Cloud lastTradeAction skip reasons', () => {
  beforeEach(() => {
    leanMock.mockReset();
    leanMock.mockImplementation(async (asset: string) => {
      if (asset !== 'BNB') {
        return { ok: false, asset, message: 'no_market' } as any;
      }
      return richBnbLean() as any;
    });
  });

  test('GET /me/status exposes ask too rich after a Cloud skip', async () => {
    const uid = 'user_last_trade_action_ask';
    const cfg = defaultAppConfig();
    cfg.auto_trade_enabled = true;
    cfg.execution_mode = 'live';
    cfg.live_armed = true;
    for (const key of Object.keys(cfg.assets_enabled)) {
      cfg.assets_enabled[key] = key === 'BNB';
    }
    cfg.cushions.BNB = 2.5;
    cfg.risk.max_entry_ask_usd = 0.92;
    cfg.risk.min_minutes_elapsed = 2;
    cfg.risk.min_minutes_left = 1;

    await upsertUserDoc(uid, {
      cloudTradingEnabled: true,
      kalshiConfigured: true,
      state: 'ARMED',
      config: cfg,
    });

    const tick = await request(app).post('/tick');
    expect(tick.status).toBe(200);

    const status = await request(app).get('/me/status').set('Authorization', `Bearer ${uid}`);
    expect(status.status).toBe(200);
    expect(status.body.userDoc.lastTradeAction.BNB).toEqual(
      expect.objectContaining({
        status: 'skipped',
        detail: 'skipped · ask too rich',
      })
    );
  });

  test('below-cushion clears a prior skip so Home does not keep stale amber', async () => {
    const uid = 'user_last_trade_action_clear';
    await upsertUserDoc(uid, {
      cloudTradingEnabled: true,
      kalshiConfigured: true,
      state: 'ARMED',
      lastTradeAction: {
        BNB: { status: 'skipped', detail: 'skipped · ask too rich', at: '2026-09-08T00:00:00.000Z' },
      },
      config: {
        ...defaultAppConfig(),
        auto_trade_enabled: true,
        assets_enabled: { BNB: true },
        cushions: { BNB: 2.5 },
      },
    });

    leanMock.mockImplementation(async (asset: string) => {
      if (asset !== 'BNB') return { ok: false, asset, message: 'no_market' } as any;
      return { ...richBnbLean(), abs_gap: 0.4, yes_ask: 0.5 } as any;
    });

    const tick = await request(app).post('/tick');
    expect(tick.status).toBe(200);

    const status = await request(app).get('/me/status').set('Authorization', `Bearer ${uid}`);
    expect(status.body.userDoc.lastTradeAction?.BNB).toBeUndefined();
  });
});

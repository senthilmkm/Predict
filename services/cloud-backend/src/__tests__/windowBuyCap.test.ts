import {
  countWindowBuysForTicker,
  evaluateStaticGate,
  isCountableWindowBuy,
  windowBuyCap,
} from '../../../../packages/trading-core/src/gates';
import request from 'supertest';
import { app } from '../index';

describe('max trades / asset / 15m window', () => {
  test('windowBuyCap defaults to 1 and ignores the old per-day 100', () => {
    expect(windowBuyCap(undefined)).toBe(1);
    expect(windowBuyCap({})).toBe(1);
    expect(windowBuyCap({ max_trades_per_asset_per_window: 2 })).toBe(2);
    expect(windowBuyCap({ max_trades_per_asset_per_window: 99 })).toBe(5);
    expect(windowBuyCap({ max_trades_per_asset_per_window: 0 })).toBe(1);
    expect(windowBuyCap({ max_trades_per_asset_per_day: 100 } as any)).toBe(1);
  });

  test('countWindowBuysForTicker counts fills and protect-exits, not misses or dry runs', () => {
    const ticker = 'KXBTC15M-WIN';
    const trades = [
      { ticker, dryRun: false, status: 'FILLED', outcome: 'pending', fillCount: 2 },
      { ticker, dryRun: false, status: 'SETTLED', outcome: 'exited', fillCount: 2 },
      { ticker, dryRun: false, status: 'CANCELLED', outcome: 'miss', fillCount: 0 },
      { ticker, dryRun: true, status: 'FILLED', outcome: 'pending', fillCount: 1 },
      { ticker: 'KXETH15M-OTHER', dryRun: false, status: 'FILLED', outcome: 'pending', fillCount: 1 },
    ];
    expect(countWindowBuysForTicker(trades as any, ticker)).toBe(2);
    expect(isCountableWindowBuy(trades[0] as any)).toBe(true);
    expect(isCountableWindowBuy(trades[1] as any)).toBe(true);
    expect(isCountableWindowBuy(trades[2] as any)).toBe(false);
    expect(isCountableWindowBuy(trades[3] as any)).toBe(false);
  });

  test('two sequential claims on the same ticker are serialized by the in-tick counter', () => {
    const ticker = 'KXGOLD15M-A';
    const trades: any[] = [];
    const windowClaims = new Map<string, number>();
    const cap = 2;
    const tryClaim = () => {
      const n = countWindowBuysForTicker(trades, ticker) + (windowClaims.get(ticker) || 0);
      if (n >= cap) return false;
      windowClaims.set(ticker, (windowClaims.get(ticker) || 0) + 1);
      return true;
    };
    expect(tryClaim()).toBe(true);
    expect(tryClaim()).toBe(true);
    expect(tryClaim()).toBe(false);

    windowClaims.set(ticker, Math.max(0, (windowClaims.get(ticker) || 1) - 1));
    expect(tryClaim()).toBe(true);
    expect(tryClaim()).toBe(false);

    trades.push(
      { ticker, dryRun: false, status: 'FILLED', outcome: 'pending', fillCount: 1 },
      { ticker, dryRun: false, status: 'SETTLED', outcome: 'exited', fillCount: 1 }
    );
    windowClaims.clear();
    expect(tryClaim()).toBe(false);
  });

  test('POST /me/status stores window cap and drops the old per-day field', async () => {
    const uid = 'user_window_cap';
    const res = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: {
          auto_trade_enabled: true,
          risk: {
            max_trades_per_asset_per_day: 100,
            max_trades_per_asset_per_window: 3,
            max_trades_per_day: 100,
          },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.userDoc.config.risk.max_trades_per_asset_per_window).toBe(3);
    expect(res.body.userDoc.config.risk.max_trades_per_asset_per_day).toBeUndefined();
  });

  test('POST /me/status with only the old field stores default 1', async () => {
    const uid = 'user_window_cap_legacy';
    const res = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: false,
        state: 'DISARMED',
        config: {
          risk: { max_trades_per_asset_per_day: 100 },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.userDoc.config.risk.max_trades_per_asset_per_window).toBe(1);
    expect(res.body.userDoc.config.risk.max_trades_per_asset_per_day).toBeUndefined();
  });

  test('evaluateStaticGate uses window cap not daily per-asset', () => {
    const cfg: any = {
      auto_trade_enabled: true,
      assets_enabled: { Gold: true },
      cushions: { Gold: 7 },
      risk: {
        max_open_positions: 5,
        max_trades_per_day: 100,
        max_trades_per_asset_per_window: 1,
        daily_loss_stop_usd: 50,
        min_minutes_left: 2,
        min_minutes_elapsed: 2,
        max_entry_ask_usd: 0.9,
        chase_above_ask_usd: 0.02,
        fixed_dollars_per_trade: 5,
        max_dollars_per_trade: 5,
        min_dollars_per_trade: 1,
        time_in_force: 'immediate_or_cancel',
      },
    };
    const lean = {
      asset: 'Gold',
      market_ticker: 'KXGOLD15M-A',
      decision: 'YES' as const,
      live: 2650,
      strike: 2640,
      abs_gap: 10,
      minutes_left: 8,
      minutes_elapsed: 5,
      phase: 'live' as const,
      yes_ask: 0.55,
    };
    expect(evaluateStaticGate(lean, cfg, { assetTradesInWindow: 1 }).skip_reason).toBe(
      'max_trades_asset_window'
    );
  });
});

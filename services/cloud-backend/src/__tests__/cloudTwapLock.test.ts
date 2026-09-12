import request from 'supertest';
import { app } from '../index';
import { normalizeFeatureFlags } from '../services/featureFlags';
import { pendingProtectTradesForMarket, runCloudProtectSells } from '../services/cloudProtectSell';
import { evaluateTwapLockEnter, twapLockBlocksOtherAutoPaths } from '../../../../packages/trading-core/src/twapLock';
import {
  buildTwapLockWatcherSnapshot,
  formatTwapLockWatcherChip,
} from '../services/twapLockWatcher';
import { parseCfbRtiPrint, cfbBasicAuthHeader } from '../services/cfbRti';
import { parseCfbSecretPayload } from '../services/secretManager';
import { defaultAppConfig } from '../../../../packages/trading-core/src/types';
import { TradeRecordDoc } from '../services/firestore';

function filledTrade(over: Partial<TradeRecordDoc> = {}): TradeRecordDoc {
  return {
    tradeId: over.tradeId || 't1',
    userId: 'u1',
    ticker: over.ticker || 'KXBTC15M-T',
    asset: over.asset || 'BTC',
    decision: over.decision || 'YES',
    count: '5',
    price: '0.95',
    notionalUsd: 4.75,
    dryRun: false,
    status: 'FILLED',
    leanDiff: 200,
    liveSpot: 80200,
    strike: 80000,
    executedAt: '2026-09-11T20:14:50.000Z',
    orderId: 'ord1',
    payPrice: 0.95,
    fillCount: 5,
    outcome: 'pending',
    pnlUsd: null,
    entryPath: over.entryPath ?? 'twap_lock',
    ...over,
  };
}

describe('TWAP lock CFB secret wiring', () => {
  test('parses Secret Manager username:key and JSON', () => {
    expect(parseCfbSecretPayload('')).toBeNull();
    expect(parseCfbSecretPayload('UNSET')).toBeNull();
    expect(parseCfbSecretPayload('user1:secret-key')).toEqual({ username: 'user1', key: 'secret-key' });
    expect(parseCfbSecretPayload(JSON.stringify({ username: 'u', key: 'k' }))).toEqual({
      username: 'u',
      key: 'k',
    });
    expect(cfbBasicAuthHeader({ username: 'u', key: 'k' })).toBe(
      `Basic ${Buffer.from('u:k', 'utf8').toString('base64')}`
    );
    expect(parseCfbRtiPrint({ data: { payload: { value: 101, time: 1773000001 } } })).toEqual({
      utcSec: 1773000001,
      price: 101,
    });
    expect(
      parseCfbRtiPrint({
        data: {
          payload: [
            { value: 90, time: 1773000000 },
            { value: 101, time: 1773003600 },
          ],
        },
      })
    ).toEqual({ utcSec: 1773003600, price: 101 });
  });
});

describe('TWAP lock watcher chip', () => {
  test('idle when no users; watching lists coins and leftover seconds', () => {
    const now = new Date('2026-09-12T00:44:20.000Z');
    const close = new Date('2026-09-12T00:45:00.000Z');
    expect(formatTwapLockWatcherChip(null, now)).toBe('TWAP watcher · idle');
    const watching = buildTwapLockWatcherSnapshot({
      now,
      watchUsers: new Map([['usr_1', ['BTC', 'ETH']]]),
      closeByAsset: { BTC: close, ETH: close },
    });
    expect(watching.watching).toBe(true);
    expect(watching.userCount).toBe(1);
    expect(watching.assets).toEqual(['BTC', 'ETH']);
    expect(watching.secondsLeft).toBe(40);
    expect(formatTwapLockWatcherChip(watching, now)).toBe('TWAP watcher · 1 user · BTC ETH · 40s left');
    expect(
      formatTwapLockWatcherChip(watching, new Date(now.getTime() + 20_000))
    ).toBe('TWAP watcher · idle');
  });
});

describe('TWAP lock cloud isolation', () => {
  test('TWAP On reserves BTC/ETH from Cash out and lean Auto; Gold stays free', () => {
    const opts = {
      adminEnabled: true,
      userEnabled: true,
      assets: ['BTC', 'ETH'],
    };
    expect(twapLockBlocksOtherAutoPaths({ ...opts, asset: 'BTC' })).toBe(true);
    expect(twapLockBlocksOtherAutoPaths({ ...opts, asset: 'ETH' })).toBe(true);
    expect(twapLockBlocksOtherAutoPaths({ ...opts, asset: 'Gold' })).toBe(false);
    expect(twapLockBlocksOtherAutoPaths({ ...opts, adminEnabled: false, asset: 'BTC' })).toBe(false);
    expect(twapLockBlocksOtherAutoPaths({ ...opts, userEnabled: false, asset: 'BTC' })).toBe(false);
    expect(twapLockBlocksOtherAutoPaths({ ...opts, assets: ['ETH'], asset: 'BTC' })).toBe(false);
  });

  test('Admin flag defaults Off; Protect skips twap_lock rows', () => {
    expect(normalizeFeatureFlags(null).twapLock).toBe(false);
    const lock = filledTrade({ tradeId: 'twap1' });
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    expect(pendingProtectTradesForMarket([lock, home], 'KXBTC15M-T', new Date()).map((t) => t.tradeId)).toEqual([
      'home1',
    ]);
  });

  test('Protect does not sell a twap_lock row', async () => {
    const placed: unknown[] = [];
    const res = await runCloudProtectSells({
      userId: 'u1',
      asset: 'BTC',
      ticker: 'KXBTC15M-T',
      lean: { decision: 'NO', abs_gap: 400, phase: 'live', yes_bid: 0.9, yes_ask: 0.92 },
      trades: [filledTrade()],
      cushion: 175,
      gapRatio: 1,
      graceSeconds: 0,
      slippageUsd: 0.02,
      enabled: true,
      dryRun: false,
      now: new Date('2026-09-11T20:14:58.000Z'),
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
    c.risk.twap_lock_enabled = true;
    const close = new Date('2026-09-11T20:15:00.000Z');
    const startSec = Math.floor((close.getTime() - 60_000) / 1000);
    const prints = Array.from({ length: 58 }, (_, i) => ({ utcSec: startSec + i, price: 90000 }));
    const gate = evaluateTwapLockEnter({
      lean: {
        asset: 'BTC',
        market_ticker: 'KXBTC15M-T',
        decision: 'YES',
        live: 80200,
        strike: 80000,
        abs_gap: 200,
        minutes_left: 0,
        minutes_elapsed: 14,
        phase: 'live',
        yes_ask: 0.95,
        yes_bid: 0.93,
        close_utc: close.toISOString(),
      },
      cfg: c,
      adminEnabled: true,
      prints,
      now: new Date(close.getTime() - 2000),
      hasOpenOnTicker: true,
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('twap_lock_holding_other_path');
  });

  test('POST /me/status persists TWAP lock settings; merge keeps Gold fade', async () => {
    const uid = 'user_twap_cfg';
    const on = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: {
          risk: {
            twap_lock_enabled: true,
            twap_lock_assets: ['BTC'],
            twap_lock_max_ask_usd: 0.95,
            gold_fade_enabled: true,
          },
        },
      });
    expect(on.status).toBe(200);
    expect(on.body.userDoc.config.risk.twap_lock_enabled).toBe(true);
    expect(on.body.userDoc.config.risk.twap_lock_max_ask_usd).toBe(0.95);
    expect(on.body.userDoc.config.risk.twap_lock_assets).toEqual(['BTC']);
    expect(on.body.userDoc.config.risk.gold_fade_enabled).toBe(true);
    const off = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: { risk: { twap_lock_enabled: false } },
      });
    expect(off.body.userDoc.config.risk.twap_lock_enabled).toBe(false);
    expect(off.body.userDoc.config.risk.gold_fade_enabled).toBe(true);
    expect(off.body.userDoc.config.risk.twap_lock_max_ask_usd).toBe(0.95);
  });
});

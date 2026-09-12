import request from 'supertest';
import { app } from '../index';
import { normalizeFeatureFlags } from '../services/featureFlags';
import { pendingProtectTradesForMarket, runCloudProtectSells } from '../services/cloudProtectSell';
import { evaluateLastMinuteEnter } from '../../../../packages/trading-core/src/lastMinute';
import { runCloudLastMinuteFlipExits } from '../services/cloudLastMinuteFlip';
import {
  buildLastMinuteWatcherSnapshot,
  formatLastMinuteWatcherChip,
} from '../services/lastMinuteWatcher';
import { defaultAppConfig } from '../../../../packages/trading-core/src/types';
import { TradeRecordDoc } from '../services/firestore';

function filledTrade(over: Partial<TradeRecordDoc> = {}): TradeRecordDoc {
  return {
    tradeId: over.tradeId || 't1',
    userId: 'u1',
    ticker: over.ticker || 'KXGOLD15M-T',
    asset: over.asset || 'Gold',
    decision: over.decision || 'YES',
    count: '5',
    price: '0.95',
    notionalUsd: 4.75,
    dryRun: false,
    status: 'FILLED',
    leanDiff: 10,
    liveSpot: 3700,
    strike: 3690,
    executedAt: '2026-09-12T10:14:50.000Z',
    orderId: 'ord1',
    payPrice: 0.95,
    fillCount: 5,
    outcome: 'pending',
    pnlUsd: null,
    entryPath: over.entryPath ?? 'last_minute',
    ...over,
  };
}

describe('Last-minute cloud wiring', () => {
  test('Admin flag defaults Off; Protect skips last_minute rows', () => {
    expect(normalizeFeatureFlags(null).lastMinute).toBe(false);
    const lm = filledTrade({ tradeId: 'lm1' });
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    expect(pendingProtectTradesForMarket([lm, home], 'KXGOLD15M-T', new Date()).map((t) => t.tradeId)).toEqual([
      'home1',
    ]);
  });

  test('Protect does not sell a last_minute row', async () => {
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
    c.risk.last_minute_enabled = true;
    const close = new Date('2026-09-12T10:15:00.000Z');
    const gate = evaluateLastMinuteEnter({
      lean: {
        asset: 'Gold',
        market_ticker: 'KXGOLD15M-T',
        decision: 'YES',
        live: 3700,
        strike: 3690,
        abs_gap: 10,
        minutes_left: 0,
        minutes_elapsed: 14,
        phase: 'live',
        yes_ask: 0.95,
        yes_bid: 0.93,
        no_ask: 0.07,
        close_utc: close.toISOString(),
      },
      cfg: c,
      adminEnabled: true,
      now: new Date(close.getTime() - 20_000),
      hasOpenOnTicker: true,
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('last_minute_holding_other_path');
  });

  test('POST /me/status persists Last-minute settings; merge keeps TWAP', async () => {
    const uid = 'user_last_minute_cfg';
    const on = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: {
          risk: {
            last_minute_enabled: true,
            last_minute_side: 'both',
            last_minute_max_ask_usd: 0.94,
            last_minute_watch_seconds: 160,
            last_minute_enter_seconds: 80,
            last_minute_stop_seconds: 8,
            last_minute_ladder_seconds: 3,
            last_minute_clip_count: 1,
            last_minute_max_clips: 8,
            last_minute_both_min_ask: 0.88,
            last_minute_both_gap: 0.12,
            last_minute_flip_sell_usd: 0.1,
            last_minute_assets: ['Gold', 'WTI'],
            last_minute_skip_thin_bid: true,
            twap_lock_enabled: true,
            twap_lock_skip_thin_bid: false,
          },
        },
      });
    expect(on.status).toBe(200);
    expect(on.body.userDoc.config.risk.last_minute_enabled).toBe(true);
    expect(on.body.userDoc.config.risk.last_minute_side).toBe('both');
    expect(on.body.userDoc.config.risk.last_minute_max_ask_usd).toBe(0.94);
    expect(on.body.userDoc.config.risk.last_minute_watch_seconds).toBe(160);
    expect(on.body.userDoc.config.risk.last_minute_enter_seconds).toBe(80);
    expect(on.body.userDoc.config.risk.last_minute_stop_seconds).toBe(8);
    expect(on.body.userDoc.config.risk.last_minute_ladder_seconds).toBe(3);
    expect(on.body.userDoc.config.risk.last_minute_max_clips).toBe(8);
    expect(on.body.userDoc.config.risk.last_minute_both_min_ask).toBe(0.88);
    expect(on.body.userDoc.config.risk.last_minute_both_gap).toBe(0.12);
    expect(on.body.userDoc.config.risk.last_minute_flip_sell_usd).toBe(0.1);
    expect(on.body.userDoc.config.risk.last_minute_assets).toEqual(['Gold', 'WTI']);
    expect(on.body.userDoc.config.risk.last_minute_skip_thin_bid).toBe(true);
    expect(on.body.userDoc.config.risk.twap_lock_enabled).toBe(true);
    expect(on.body.userDoc.config.risk.twap_lock_skip_thin_bid).toBe(false);
    const off = await request(app)
      .post('/me/status')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        cloudTradingEnabled: true,
        state: 'ARMED',
        config: { risk: { last_minute_enabled: false } },
      });
    expect(off.body.userDoc.config.risk.last_minute_enabled).toBe(false);
    expect(off.body.userDoc.config.risk.twap_lock_enabled).toBe(true);
    expect(off.body.userDoc.config.risk.last_minute_max_ask_usd).toBe(0.94);
  });
});

describe('Last-minute flip sell', () => {
  test('sells a NO lot when YES is 10¢ richer; 1¢ dip does not', async () => {
    const lot = filledTrade({
      tradeId: 'lm-flip-1',
      decision: 'NO',
      fillCount: 1,
      payPrice: 0.96,
      outcome: 'pending',
      status: 'FILLED',
      executedAt: '2026-09-12T10:14:00.000Z',
    });
    const dip = await runCloudLastMinuteFlipExits({
      userId: 'u1',
      asset: 'Gold',
      ticker: 'KXGOLD15M-T',
      lean: { phase: 'live', yes_ask: 0.05, no_ask: 0.95, yes_bid: 0.04, no_bid: 0.94 },
      trades: [lot],
      flipSellUsd: 0.1,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-12T10:14:20.000Z'),
      place: async () => ({ ok: true, fill_count: 1, order_id: 'x' }),
    });
    expect(dip.exited).toBe(0);

    const placed: unknown[] = [];
    const flip = await runCloudLastMinuteFlipExits({
      userId: 'u1',
      asset: 'Gold',
      ticker: 'KXGOLD15M-T',
      lean: { phase: 'live', yes_ask: 0.58, no_ask: 0.42, yes_bid: 0.56, no_bid: 0.4 },
      trades: [{ ...lot, tradeId: 'lm-flip-2' }],
      flipSellUsd: 0.1,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-12T10:14:20.000Z'),
      place: async (input) => {
        placed.push(input);
        return { ok: true, fill_count: 1, order_id: 'flip1' };
      },
    });
    expect(flip.exited).toBe(1);
    expect(placed).toHaveLength(1);
    expect(flip.alerts[0]?.title).toBe('Last-minute flip');
  });
});

describe('Last-minute watcher chip', () => {
  test('idle when no users; watching lists coins and leftover seconds', () => {
    const now = new Date('2026-09-12T00:44:20.000Z');
    const close = new Date('2026-09-12T00:45:00.000Z');
    expect(formatLastMinuteWatcherChip(null, now)).toBe('Last-minute watcher · idle');
    const watching = buildLastMinuteWatcherSnapshot({
      now,
      watchUsers: new Map([['usr_1', ['BTC', 'ETH']]]),
      closeByAsset: { BTC: close, ETH: close },
    });
    expect(watching.watching).toBe(true);
    expect(watching.userCount).toBe(1);
    expect(watching.assets).toEqual(['BTC', 'ETH']);
    expect(watching.secondsLeft).toBe(40);
    expect(formatLastMinuteWatcherChip(watching, now)).toBe(
      'Last-minute watcher · 1 user · BTC ETH · 40s left'
    );
    expect(formatLastMinuteWatcherChip(watching, new Date(now.getTime() + 20_000))).toBe(
      'Last-minute watcher · idle'
    );
  });
});

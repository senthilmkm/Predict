import { normalizeFeatureFlags } from '../services/featureFlags';
import { pendingProtectTradesForMarket } from '../services/cloudProtectSell';
import { evaluateCheapLoopEnter } from '../../../../packages/trading-core/src/cheapLoop';
import {
  pendingCheapLoopHourlyTradesForMarket,
  pendingCheapLoopTradesForMarket,
  pendingCheapLoopWeeklyTradesForMarket,
} from '../services/cloudCheapLoop';
import {
  buildCheapLoopWatcherSnapshot,
  formatCheapLoopWatcherChip,
} from '../services/cheapLoopWatcher';
import { defaultAppConfig } from '../../../../packages/trading-core/src/types';
import { TradeRecordDoc } from '../services/firestore';

function filledTrade(over: Partial<TradeRecordDoc> = {}): TradeRecordDoc {
  return {
    tradeId: over.tradeId || 't1',
    userId: 'u1',
    ticker: over.ticker || 'KXBTC15M-T',
    asset: over.asset || 'BTC',
    decision: over.decision || 'YES',
    count: '1',
    price: '0.30',
    notionalUsd: 0.3,
    dryRun: false,
    status: 'FILLED',
    leanDiff: 100,
    liveSpot: 70000,
    strike: 69900,
    executedAt: '2026-09-13T21:04:00.000Z',
    orderId: 'ord1',
    payPrice: 0.3,
    fillCount: 1,
    outcome: 'pending',
    pnlUsd: null,
    entryPath: over.entryPath ?? 'cheap_loop',
    ...over,
  };
}

describe('Cheap loop cloud wiring', () => {
  test('Admin flag defaults Off; Protect skips cheap_loop rows', () => {
    expect(normalizeFeatureFlags(null).cheapLoop).toBe(false);
    const cl = filledTrade({ tradeId: 'cl1' });
    const hourly = filledTrade({
      tradeId: 'clh1',
      ticker: 'KXBTCD-26SEP1406-T67099.99',
      entryPath: 'cheap_loop_hourly',
    });
    const weekly = filledTrade({
      tradeId: 'clw1',
      ticker: 'KXBTCD-26SEP1817-T67099.99',
      entryPath: 'cheap_loop_weekly',
    });
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    expect(
      pendingProtectTradesForMarket([cl, hourly, weekly, home], 'KXBTC15M-T', new Date()).map((t) => t.tradeId)
    ).toEqual(['home1']);
    expect(
      pendingProtectTradesForMarket(
        [cl, hourly, home],
        'KXBTCD-26SEP1406-T67099.99',
        new Date()
      ).map((t) => t.tradeId)
    ).toEqual([]);
  });

  test('watcher chip is idle until users are watching', () => {
    const idle = buildCheapLoopWatcherSnapshot({
      now: new Date('2026-09-13T21:00:00.000Z'),
      watchUsers: new Map(),
      minutesLeftByAsset: {},
    });
    expect(formatCheapLoopWatcherChip(idle)).toMatch(/idle/);
    const now = new Date();
    const live = buildCheapLoopWatcherSnapshot({
      now,
      watchUsers: new Map([['u1', ['BTC']]]),
      minutesLeftByAsset: { BTC: 10 },
    });
    expect(formatCheapLoopWatcherChip(live, now)).toMatch(/1 user/);
    expect(formatCheapLoopWatcherChip(live, now)).toMatch(/BTC/);
  });

  test('Home tap blocks Cheap loop enter', () => {
    const c = defaultAppConfig();
    c.auto_trade_enabled = true;
    c.assets_enabled.BTC = true;
    c.risk.cheap_loop_enabled = true;
    c.risk.cheap_loop_assets = ['BTC'];
    const gate = evaluateCheapLoopEnter({
      lean: {
        asset: 'BTC',
        market_ticker: 'KXBTC15M-T',
        decision: 'YES',
        live: 70000,
        strike: 69900,
        abs_gap: 100,
        minutes_left: 10,
        minutes_elapsed: 4,
        minutes_remaining: 10,
        phase: 'live',
        yes_ask: 0.3,
        no_ask: 0.7,
      },
      cfg: c,
      adminEnabled: true,
      hasOpenOnTicker: true,
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('cheap_loop_holding_other_path');
  });

  test('hourly pending filter does not mix 15m lots', () => {
    const cl = filledTrade({ tradeId: 'cl1' });
    const hourly = filledTrade({
      tradeId: 'clh1',
      ticker: 'KXBTCD-26SEP1406-T67099.99',
      entryPath: 'cheap_loop_hourly',
    });
    expect(pendingCheapLoopTradesForMarket([cl, hourly], 'KXBTC15M-T').map((t) => t.tradeId)).toEqual(['cl1']);
    expect(
      pendingCheapLoopHourlyTradesForMarket([cl, hourly], 'KXBTCD-26SEP1406-T67099.99').map((t) => t.tradeId)
    ).toEqual(['clh1']);
    expect(pendingCheapLoopHourlyTradesForMarket([cl, hourly], 'KXBTC15M-T')).toEqual([]);
  });

  test('weekly pending filter does not mix 15m or hourly lots', () => {
    const cl = filledTrade({ tradeId: 'cl1' });
    const hourly = filledTrade({
      tradeId: 'clh1',
      ticker: 'KXBTCD-26SEP1406-T67099.99',
      entryPath: 'cheap_loop_hourly',
    });
    const weekly = filledTrade({
      tradeId: 'clw1',
      ticker: 'KXBTCD-26SEP1817-T67099.99',
      entryPath: 'cheap_loop_weekly',
    });
    expect(
      pendingCheapLoopWeeklyTradesForMarket([cl, hourly, weekly], 'KXBTCD-26SEP1817-T67099.99').map(
        (t) => t.tradeId
      )
    ).toEqual(['clw1']);
    expect(pendingCheapLoopWeeklyTradesForMarket([cl, hourly, weekly], 'KXBTC15M-T')).toEqual([]);
    expect(
      pendingProtectTradesForMarket([weekly], 'KXBTCD-26SEP1817-T67099.99', new Date())
    ).toEqual([]);
  });
});

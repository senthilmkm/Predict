import { saveTradeRecord, getTradeRecords, resetSystemConfigCacheForTests } from '../services/firestore';
import { pendingProtectTradesForMarket, runCloudProtectSells } from '../services/cloudProtectSell';
import { pendingCashOutTradesForMarket, runCloudCashOutExits } from '../services/cloudCashOut';
import { evaluateCashOutEnter, tickerHasOpenCashOut, tickerHasOpenNonCashOut } from '../../../../packages/trading-core/src/cashOut';
import { defaultAppConfig } from '../../../../packages/trading-core/src/types';
import { normalizeFeatureFlags } from '../services/featureFlags';

function filledTrade(over: Record<string, unknown> = {}) {
  return {
    tradeId: String(over.tradeId || 'trade_cout_1'),
    userId: String(over.userId || 'user_cout'),
    ticker: String(over.ticker || 'KXGOLD-T'),
    asset: String(over.asset || 'Gold'),
    decision: (over.decision as 'YES' | 'NO') || 'YES',
    count: String(over.count ?? '7'),
    price: String(over.price ?? '0.70'),
    notionalUsd: Number(over.notionalUsd ?? 4.9),
    dryRun: Boolean(over.dryRun),
    status: (over.status as any) || 'FILLED',
    executedAt: String(over.executedAt || '2026-09-10T15:00:00.000Z'),
    orderId: (over.orderId as string | null | undefined) ?? 'ord-cout',
    payPrice: over.payPrice ?? 0.7,
    fillCount: over.fillCount ?? 7,
    pnlUsd: over.pnlUsd ?? null,
    outcome: (over.outcome as string) ?? 'pending',
    protectClaimedAt: (over.protectClaimedAt as string | null | undefined) ?? null,
    protectExitOrderId: (over.protectExitOrderId as string | null | undefined) ?? null,
    entryPath: over.entryPath ?? 'cash_out',
  } as any;
}

describe('Cloud Cash out', () => {
  beforeEach(() => {
    resetSystemConfigCacheForTests();
  });

  test('Admin flag defaults Off; Protect skips cash_out rows', () => {
    expect(normalizeFeatureFlags(null).cashOut).toBe(false);
    const cash = filledTrade();
    const home = filledTrade({ tradeId: 'home1', entryPath: 'home' });
    expect(pendingCashOutTradesForMarket([cash, home], 'KXGOLD-T').map((t) => t.tradeId)).toEqual([
      'trade_cout_1',
    ]);
    expect(pendingProtectTradesForMarket([cash, home], 'KXGOLD-T', new Date()).map((t) => t.tradeId)).toEqual([
      'home1',
    ]);
  });

  test('mix helpers: Home open blocks Cash out; Cash out open blocks Home', () => {
    const home = filledTrade({ entryPath: 'home' });
    const cash = filledTrade({ entryPath: 'cash_out' });
    expect(tickerHasOpenNonCashOut([home], 'KXGOLD-T')).toBe(true);
    expect(tickerHasOpenCashOut([cash], 'KXGOLD-T')).toBe(true);
    expect(tickerHasOpenCashOut([home], 'KXGOLD-T')).toBe(false);
  });

  test('bid target sells after grace; IOC miss does not close the lot', async () => {
    const userId = 'user_cout_bid';
    const trade = filledTrade({ userId, executedAt: '2026-09-10T15:00:00.000Z' });
    await saveTradeRecord(userId, trade);
    const miss = await runCloudCashOutExits({
      userId,
      asset: 'Gold',
      ticker: trade.ticker,
      lean: { decision: 'YES', abs_gap: 120, phase: 'live', yes_bid: 0.9, yes_ask: 0.92 },
      trades: [trade],
      cushion: 175,
      cashOutBidUsd: 0.88,
      graceSeconds: 45,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-10T15:01:00.000Z'),
      place: async () => ({ ok: true, fill_count: 0, order_id: null }),
    });
    expect(miss.exited).toBe(0);
    expect(miss.skipped).toContain('ioc_miss');
    const still = await getTradeRecords(userId);
    expect(still[0].outcome).toBe('pending');

    const hit = await runCloudCashOutExits({
      userId,
      asset: 'Gold',
      ticker: trade.ticker,
      lean: { decision: 'YES', abs_gap: 120, phase: 'live', yes_bid: 0.9, yes_ask: 0.92 },
      trades: still,
      cushion: 175,
      cashOutBidUsd: 0.88,
      graceSeconds: 45,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-10T15:01:05.000Z'),
      place: async () => ({ ok: true, fill_count: 7, order_id: 'ord-exit' }),
    });
    expect(hit.exited).toBe(1);
    expect(hit.alerts[0].title).toBe('Cash out');
    const closed = await getTradeRecords(userId);
    expect(closed[0].outcome).toBe('exited');
    expect(closed[0].protectExitOrderId).toBe('ord-exit');
    expect(closed[0].exitPayPrice).toBeCloseTo(0.88, 4);
  });

  test('cheaper fill sells at fill + edge, not the $0.88 setting', async () => {
    const userId = 'user_cout_fill_edge';
    const trade = filledTrade({
      userId,
      executedAt: '2026-09-10T15:00:00.000Z',
      payPrice: 0.78,
      price: '0.78',
    });
    await saveTradeRecord(userId, trade);
    const tooSoon = await runCloudCashOutExits({
      userId,
      asset: 'Gold',
      ticker: trade.ticker,
      lean: { decision: 'YES', abs_gap: 120, phase: 'live', yes_bid: 0.83, yes_ask: 0.85 },
      trades: [trade],
      cushion: 175,
      cashOutBidUsd: 0.88,
      cashOutMaxAskUsd: 0.82,
      graceSeconds: 45,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-10T15:01:00.000Z'),
      place: async () => ({ ok: true, fill_count: 7, order_id: 'should-not' }),
    });
    expect(tooSoon.exited).toBe(0);
    expect(tooSoon.placed).toBe(0);

    const hit = await runCloudCashOutExits({
      userId,
      asset: 'Gold',
      ticker: trade.ticker,
      lean: { decision: 'YES', abs_gap: 120, phase: 'live', yes_bid: 0.84, yes_ask: 0.86 },
      trades: await getTradeRecords(userId),
      cushion: 175,
      cashOutBidUsd: 0.88,
      cashOutMaxAskUsd: 0.82,
      graceSeconds: 45,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-10T15:01:05.000Z'),
      place: async () => ({ ok: true, fill_count: 7, order_id: 'ord-edge' }),
    });
    expect(hit.exited).toBe(1);
    expect(hit.alerts[0].title).toBe('Cash out');
    const closed = await getTradeRecords(userId);
    expect(closed[0].outcome).toBe('exited');
    expect(closed[0].exitPayPrice).toBeCloseTo(0.82, 4);
  });

  test('claim lock: two overlapping sells, only one places', async () => {
    const userId = 'user_cout_race';
    const trade = filledTrade({ userId, tradeId: 'race1' });
    await saveTradeRecord(userId, trade);
    let places = 0;
    const place = async () => {
      places += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, fill_count: 7, order_id: `ord-${places}` };
    };
    const opts = {
      userId,
      asset: 'Gold',
      ticker: trade.ticker,
      lean: { decision: 'YES', abs_gap: 120, phase: 'live' as const, yes_bid: 0.9, yes_ask: 0.92 },
      trades: [trade],
      cushion: 175,
      cashOutBidUsd: 0.88,
      graceSeconds: 45,
      slippageUsd: 0.02,
      dryRun: false,
      now: new Date('2026-09-10T15:01:00.000Z'),
      place,
    };
    const [a, b] = await Promise.all([runCloudCashOutExits(opts), runCloudCashOutExits({ ...opts })]);
    const exited = a.exited + b.exited;
    expect(exited).toBe(1);
    expect(places).toBe(1);
  });

  test('Protect does not sell a cash_out row even when On', async () => {
    const userId = 'user_cout_prot';
    const trade = filledTrade({ userId });
    await saveTradeRecord(userId, trade);
    let placed = 0;
    const res = await runCloudProtectSells({
      userId,
      asset: 'Gold',
      ticker: trade.ticker,
      lean: { decision: 'NO', abs_gap: 200, phase: 'live', yes_bid: 0.4, yes_ask: 0.42 },
      trades: [trade],
      cushion: 175,
      gapRatio: 1,
      graceSeconds: 45,
      slippageUsd: 0.02,
      enabled: true,
      dryRun: false,
      now: new Date('2026-09-10T15:01:00.000Z'),
      place: async () => {
        placed += 1;
        return { ok: true, fill_count: 7, order_id: 'ord-p' };
      },
    });
    expect(res.exited).toBe(0);
    expect(placed).toBe(0);
  });

  test('enter refuses when Home is already holding the ticker', () => {
    const cfg = defaultAppConfig();
    cfg.auto_trade_enabled = true;
    cfg.cushions.Gold = 175;
    cfg.risk.cash_out_enabled = true;
    cfg.risk.cash_out_assets = ['Gold'];
    const gate = evaluateCashOutEnter({
      lean: {
        asset: 'Gold',
        market_ticker: 'KXGOLD-T',
        decision: 'YES',
        live: 2650,
        strike: 2545,
        abs_gap: 105,
        minutes_left: 8,
        minutes_elapsed: 3,
        phase: 'live',
        yes_ask: 0.7,
        yes_bid: 0.66,
      },
      cfg,
      adminEnabled: true,
      hasOpenNonCashOutOnTicker: true,
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('cash_out_holding_other_path');
  });
});

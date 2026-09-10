import request from 'supertest';
import { getMarketQuote } from 'trading-core';
import { app } from '../index';
import { saveTradeRecord, getTradeRecords, updateTradeRecord } from '../services/firestore';
import {
  applyMarketResult,
  cloudDailyRealizedPnl,
  createQuoteCache,
  liveCloudTradesToday,
  needsSettlement,
  settlePendingCloudTrades,
} from '../services/settlement';
import { etDateKey } from '../util/time';

jest.mock('trading-core', () => {
  const actual = jest.requireActual('trading-core');
  return {
    ...actual,
    getMarketQuote: jest.fn(async (ticker: string) => {
      if (String(ticker).includes('DONE')) return { result: 'yes', status: 'finalized' };
      if (String(ticker).includes('LOSE')) return { result: 'no', status: 'finalized' };
      return { status: 'open' };
    }),
  };
});

const quoteMock = getMarketQuote as jest.MockedFunction<typeof getMarketQuote>;

function filledTrade(over: Record<string, unknown> = {}) {
  return {
    tradeId: String(over.tradeId || 'trade_1'),
    userId: String(over.userId || 'user_wire'),
    ticker: String(over.ticker || 'KXBTC15M-DONE'),
    asset: String(over.asset || 'BTC'),
    decision: (over.decision as 'YES' | 'NO') || 'YES',
    count: String(over.count ?? '10'),
    price: String(over.price ?? '0.60'),
    notionalUsd: Number(over.notionalUsd ?? 6),
    dryRun: Boolean(over.dryRun),
    status: (over.status as any) || 'FILLED',
    executedAt: String(over.executedAt || new Date(Date.now() - 5 * 60_000).toISOString()),
    orderId: over.orderId ?? 'ord-1',
    payPrice: over.payPrice ?? 0.6,
    fillCount: over.fillCount ?? 10,
    pnlUsd: over.pnlUsd ?? null,
    outcome: over.outcome ?? 'pending',
    settledAt: over.settledAt,
    entryPath: over.entryPath,
  };
}

describe('Cloud trade book ↔ /me/trades', () => {
  const userId = 'user_wire_e2e';

  beforeEach(() => {
    quoteMock.mockClear();
  });

  test('GET /me/trades returns settlement fields the iOS mapper needs', async () => {
    await saveTradeRecord(
      userId,
      filledTrade({
        tradeId: 'trade_fields',
        userId,
        status: 'SETTLED',
        pnlUsd: 4,
        outcome: 'win',
        settledAt: new Date().toISOString(),
        entryPath: 'home',
      }) as any
    );

    const res = await request(app).get('/me/trades').set('Authorization', `Bearer ${userId}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const row = res.body.trades.find((t: any) => t.tradeId === 'trade_fields');
    expect(row).toBeTruthy();
    expect(row.orderId).toBe('ord-1');
    expect(row.payPrice).toBe(0.6);
    expect(row.fillCount).toBe(10);
    expect(row.pnlUsd).toBe(4);
    expect(row.outcome).toBe('win');
    expect(row.status).toBe('SETTLED');
    expect(row.entryPath).toBe('home');
  });

  test('worker settlement writes pnl and GET reflects it', async () => {
    const uid = 'user_wire_settle';
    await saveTradeRecord(uid, filledTrade({ tradeId: 't_settle', userId: uid }) as any);
    const before = await getTradeRecords(uid);
    const after = await settlePendingCloudTrades(uid, before, new Date());
    const settled = after.find((t) => t.tradeId === 't_settle');
    expect(settled?.status).toBe('SETTLED');
    expect(settled?.outcome).toBe('win');
    expect(settled?.pnlUsd).toBe(4);

    const res = await request(app).get('/me/trades').set('Authorization', `Bearer ${uid}`);
    const row = res.body.trades.find((t: any) => t.tradeId === 't_settle');
    expect(row.status).toBe('SETTLED');
    expect(row.pnlUsd).toBe(4);
  });

  test('protect-sell exits are never overwritten by market settlement', () => {
    const now = new Date();
    expect(needsSettlement(filledTrade({ outcome: 'exited', pnlUsd: -1.5 }) as any, now)).toBe(false);
    expect(needsSettlement(filledTrade({ outcome: 'exiting' }) as any, now)).toBe(false);
    expect(applyMarketResult(filledTrade({ outcome: 'exited', pnlUsd: -1.5 }) as any, { result: 'yes' })).toBeNull();
    expect(applyMarketResult(filledTrade({ outcome: 'exiting' }) as any, { result: 'no' })).toBeNull();
    expect(cloudDailyRealizedPnl([filledTrade({ outcome: 'exited', pnlUsd: -1.5, status: 'SETTLED' }) as any])).toBe(-1.5);
  });

  test('open markets stay pending; dry-run and young fills are skipped', () => {
    const now = new Date();
    expect(needsSettlement(filledTrade({ ticker: 'KXBTC15M-OPEN' }) as any, now)).toBe(true);
    expect(needsSettlement(filledTrade({ dryRun: true }) as any, now)).toBe(false);
    expect(
      needsSettlement(
        filledTrade({ executedAt: new Date(now.getTime() - 10_000).toISOString() }) as any,
        now
      )
    ).toBe(false);
    expect(applyMarketResult(filledTrade() as any, { result: undefined })).toBeNull();
  });

  test('quote cache fetches each ticker once across many users', async () => {
    const cache = createQuoteCache(quoteMock as any);
    await Promise.all([
      cache.get('KXBTC15M-DONE'),
      cache.get('KXBTC15M-DONE'),
      cache.get('KXETH15M-LOSE'),
    ]);
    expect(quoteMock).toHaveBeenCalledTimes(2);
  });

  test('today ET filter + daily realized P&L ignore UTC date and dry runs', () => {
    const now = new Date('2026-09-08T01:30:00.000Z'); // 9:30pm ET Sep 7
    expect(etDateKey(now)).toBe('2026-09-07');
    const today = liveCloudTradesToday(
      [
        filledTrade({
          tradeId: 'et-today',
          executedAt: '2026-09-08T01:10:00.000Z',
          status: 'SETTLED',
          outcome: 'win',
          pnlUsd: 4,
        }) as any,
        filledTrade({
          tradeId: 'utc-tomorrow-but-et-today-dry',
          executedAt: '2026-09-08T01:10:00.000Z',
          dryRun: true,
          status: 'SETTLED',
          pnlUsd: 9,
        }) as any,
        filledTrade({
          tradeId: 'yesterday-et',
          executedAt: '2026-09-07T03:00:00.000Z',
          status: 'SETTLED',
          pnlUsd: 3,
        }) as any,
      ],
      now
    );
    expect(today.map((t) => t.tradeId)).toEqual(['et-today']);
    expect(cloudDailyRealizedPnl(today)).toBe(4);
  });

  test('NO win uses economic payPrice not the YES quote', () => {
    const patch = applyMarketResult(
      filledTrade({
        decision: 'NO',
        price: '0.60',
        payPrice: 0.4,
        fillCount: 5,
        ticker: 'KXBTC15M-LOSE',
      }) as any,
      { result: 'no' }
    );
    expect(patch?.outcome).toBe('win');
    expect(patch?.pnlUsd).toBe(3);
  });

  test('updateTradeRecord merge keeps orderId', async () => {
    const uid = 'user_wire_merge';
    await saveTradeRecord(uid, filledTrade({ tradeId: 't_merge', userId: uid }) as any);
    await updateTradeRecord(uid, 't_merge', { status: 'SETTLED', pnlUsd: 1.5, outcome: 'win' });
    const rows = await getTradeRecords(uid);
    const row = rows.find((t) => t.tradeId === 't_merge');
    expect(row?.orderId).toBe('ord-1');
    expect(row?.pnlUsd).toBe(1.5);
  });
});

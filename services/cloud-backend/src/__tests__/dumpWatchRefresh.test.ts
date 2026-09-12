import { saveTradeRecord, upsertUserDoc } from '../services/firestore';
import {
  dumpWatchSnapshotForTests,
  refreshDumpWatchFromTradeBooks,
  resetLeanAlertMemoryForTests,
} from '../routes/worker';

function filledTrade(over: Record<string, unknown> = {}) {
  return {
    tradeId: String(over.tradeId || `trade_${over.userId || 'dump'}`),
    userId: String(over.userId || 'user_dump'),
    ticker: String(over.ticker || 'KXBTC15M-DUMP'),
    asset: String(over.asset || 'BTC'),
    decision: 'YES' as const,
    count: '10',
    price: '0.60',
    notionalUsd: 6,
    dryRun: false,
    status: 'FILLED',
    executedAt: '2026-09-07T15:00:00.000Z',
    orderId: 'ord-dump',
    payPrice: 0.6,
    fillCount: 10,
    pnlUsd: null,
    outcome: 'pending',
    entryPath: over.entryPath ?? 'home',
  } as any;
}

describe('refresh dump watch from trade book', () => {
  const now = new Date('2026-09-07T15:01:00.000Z');

  beforeEach(() => {
    resetLeanAlertMemoryForTests();
  });

  test('Home fill with Protect On joins the 1s dump list without a main tick', async () => {
    const userId = 'user_dump_home_midtick';
    await upsertUserDoc(userId, {
      userId,
      kalshiConfigured: true,
      state: 'ARMED',
      config: { alerts_enabled: false, risk: { protect_sell_enabled: true } },
    } as any);
    expect(dumpWatchSnapshotForTests().protect).toEqual({});
    await saveTradeRecord(userId, filledTrade({ userId, asset: 'BTC', entryPath: 'home' }));
    await refreshDumpWatchFromTradeBooks(now);
    expect(dumpWatchSnapshotForTests().protect[userId]).toEqual(['BTC']);
  });

  test('Protect Off and Kill Switch drop Home lots; Cash out still arms', async () => {
    const offId = 'user_dump_protect_off';
    const killId = 'user_dump_protect_kill';
    const cashId = 'user_dump_cash_out';
    await upsertUserDoc(offId, {
      userId: offId,
      kalshiConfigured: true,
      state: 'ARMED',
      config: { alerts_enabled: false, risk: { protect_sell_enabled: false } },
    } as any);
    await upsertUserDoc(killId, {
      userId: killId,
      kalshiConfigured: true,
      state: 'KILL_SWITCH',
      config: { alerts_enabled: false, risk: { protect_sell_enabled: true } },
    } as any);
    await upsertUserDoc(cashId, {
      userId: cashId,
      kalshiConfigured: true,
      state: 'ARMED',
      config: { alerts_enabled: false, risk: { protect_sell_enabled: true } },
    } as any);
    await saveTradeRecord(offId, filledTrade({ userId: offId, tradeId: 't_off', entryPath: 'home' }));
    await saveTradeRecord(killId, filledTrade({ userId: killId, tradeId: 't_kill', entryPath: 'home' }));
    await saveTradeRecord(
      cashId,
      filledTrade({ userId: cashId, tradeId: 't_cash', asset: 'ETH', entryPath: 'cash_out' })
    );
    await refreshDumpWatchFromTradeBooks(now);
    const snap = dumpWatchSnapshotForTests();
    expect(snap.protect[offId]).toBeUndefined();
    expect(snap.protect[killId]).toBeUndefined();
    expect(snap.protect[cashId]).toBeUndefined();
    expect(snap.cashOut[cashId]).toEqual(['ETH']);
  });

  test('TWAP / Last-minute lots never enter Protect watch', async () => {
    const userId = 'user_dump_path_skip';
    await upsertUserDoc(userId, {
      userId,
      kalshiConfigured: true,
      state: 'ARMED',
      config: { alerts_enabled: false, risk: { protect_sell_enabled: true } },
    } as any);
    await saveTradeRecord(
      userId,
      filledTrade({ userId, tradeId: 't_twap', asset: 'BTC', entryPath: 'twap_lock' })
    );
    await saveTradeRecord(
      userId,
      filledTrade({ userId, tradeId: 't_lm', asset: 'ETH', entryPath: 'last_minute' })
    );
    await refreshDumpWatchFromTradeBooks(now);
    expect(dumpWatchSnapshotForTests().protect[userId]).toBeUndefined();
  });
});

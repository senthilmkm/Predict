import {
  saveTradeRecord,
  getTradeRecords,
  getEnrolledActiveUsers,
  shouldLoadCloudTradeBook,
  upsertUserDoc,
  PROTECT_CLAIM_STALE_MS,
} from '../services/firestore';
import {
  evaluateCloudProtectSell,
  pendingProtectTradesForMarket,
  protectCollapseId,
  protectPushEnabled,
  runCloudProtectSells,
} from '../services/cloudProtectSell';
import { needsSettlement } from '../services/settlement';

function filledTrade(over: Record<string, unknown> = {}) {
  return {
    tradeId: String(over.tradeId || 'trade_prot_1'),
    userId: String(over.userId || 'user_prot'),
    ticker: String(over.ticker || 'KXBTC15M-PROT'),
    asset: String(over.asset || 'BTC'),
    decision: (over.decision as 'YES' | 'NO') || 'YES',
    count: String(over.count ?? '10'),
    price: String(over.price ?? '0.60'),
    notionalUsd: Number(over.notionalUsd ?? 6),
    dryRun: Boolean(over.dryRun),
    status: (over.status as any) || 'FILLED',
    executedAt: String(over.executedAt || '2026-09-07T15:00:00.000Z'),
    orderId: (over.orderId as string | null | undefined) ?? 'ord-entry',
    payPrice: over.payPrice ?? 0.6,
    fillCount: over.fillCount ?? 10,
    pnlUsd: over.pnlUsd ?? null,
    outcome: (over.outcome as string) ?? 'pending',
    protectClaimedAt: (over.protectClaimedAt as string | null | undefined) ?? null,
    protectExitOrderId: (over.protectExitOrderId as string | null | undefined) ?? null,
  } as any;
}

const oppositeLean = {
  decision: 'NO',
  abs_gap: 200,
  phase: 'live',
  yes_bid: 0.4,
  yes_ask: 0.42,
};

function runOpts(over: Record<string, unknown> = {}) {
  const userId = String(over.userId || 'user_prot');
  const trade = (over.trade as any) || filledTrade({ userId });
  return {
    userId,
    asset: 'BTC',
    ticker: trade.ticker,
    lean: (over.lean as any) || oppositeLean,
    trades: (over.trades as any) || [trade],
    cushion: 175,
    gapRatio: 1,
    graceSeconds: 45,
    slippageUsd: 0.02,
    enabled: true,
    dryRun: false,
    now: (over.now as Date) || new Date('2026-09-07T15:01:00.000Z'),
    place: (over.place as any) || (async () => ({ ok: true, fill_count: 10, order_id: 'ord-exit' })),
  };
}

describe('cloud protect-sell', () => {
  test('grace after fill blocks; after 45s opposite lean with enough gap sells', () => {
    const trade = filledTrade({ executedAt: '2026-09-07T15:00:00.000Z' });
    const early = evaluateCloudProtectSell({
      trade,
      lean: oppositeLean,
      cushion: 175,
      gapRatio: 1,
      graceSeconds: 45,
      enabled: true,
      now: new Date('2026-09-07T15:00:20.000Z'),
    });
    expect(early).toMatchObject({ sell: false, reason: 'grace_after_fill' });
    const later = evaluateCloudProtectSell({
      trade,
      lean: oppositeLean,
      cushion: 175,
      gapRatio: 1,
      graceSeconds: 45,
      enabled: true,
      now: new Date('2026-09-07T15:00:50.000Z'),
    });
    expect(later.sell).toBe(true);
  });

  test('same-side lean, small gap, ended window, and kill-off do not sell', () => {
    const trade = filledTrade();
    const now = new Date('2026-09-07T15:01:00.000Z');
    expect(
      evaluateCloudProtectSell({
        trade,
        lean: { decision: 'YES', abs_gap: 200, phase: 'live' },
        cushion: 175,
        gapRatio: 1,
        graceSeconds: 0,
        enabled: true,
        now,
      }).reason
    ).toBe('lean_still_with_you');
    expect(
      evaluateCloudProtectSell({
        trade,
        lean: { decision: 'NO', abs_gap: 100, phase: 'live' },
        cushion: 175,
        gapRatio: 1,
        graceSeconds: 0,
        enabled: true,
        now,
      }).reason
    ).toBe('gap_too_small');
    expect(
      evaluateCloudProtectSell({
        trade,
        lean: { decision: 'NO', abs_gap: 200, phase: 'ended' },
        cushion: 175,
        gapRatio: 1,
        graceSeconds: 0,
        enabled: true,
        now,
      }).reason
    ).toBe('window_ended');
    expect(
      evaluateCloudProtectSell({
        trade,
        lean: oppositeLean,
        cushion: 175,
        gapRatio: 1,
        graceSeconds: 0,
        enabled: false,
        now,
      }).reason
    ).toBe('protect_off');
  });

  test('ratio 0.5 can sell below the entry cushion', () => {
    const res = evaluateCloudProtectSell({
      trade: filledTrade(),
      lean: { decision: 'NO', abs_gap: 90, phase: 'live' },
      cushion: 175,
      gapRatio: 0.5,
      graceSeconds: 0,
      enabled: true,
      now: new Date('2026-09-07T15:01:00.000Z'),
    });
    expect(res.minGap).toBe(87.5);
    expect(res.sell).toBe(true);
  });

  test('YES P&L = count × (exit ask − entry); keeps entry order id', async () => {
    const userId = 'user_prot_yes_pnl';
    const trade = filledTrade({
      userId,
      tradeId: 't_yes',
      decision: 'YES',
      payPrice: 0.6,
      fillCount: 10,
    });
    await saveTradeRecord(userId, trade as any);
    const places: any[] = [];
    const res = await runCloudProtectSells(
      runOpts({
        userId,
        trade,
        trades: [trade],
        now: new Date('2026-09-07T15:01:00.000Z'),
        place: async (input: any) => {
          places.push(input);
          return { ok: true, fill_count: 10, order_id: 'ord-exit' };
        },
      })
    );
    expect(res.exited).toBe(1);
    expect(res.placed).toBe(1);
    expect(places[0].side).toBe('ask');
    expect(places[0].price).toBe('0.3800');
    expect(places[0].time_in_force).toBe('immediate_or_cancel');
    expect(places[0].client_order_id).toContain('t_yes');
    const stored = (await getTradeRecords(userId)).find((t) => t.tradeId === 't_yes');
    expect(stored?.outcome).toBe('exited');
    expect(stored?.pnlUsd).toBe(-2.2);
    expect(stored?.orderId).toBe('ord-entry');
    expect(stored?.protectExitOrderId).toBe('ord-exit');
    expect(needsSettlement(stored as any)).toBe(false);
    expect(res.alerts).toHaveLength(1);
    expect(res.alerts[0].title).toBe('Protect sell');
  });

  test('NO cover uses bid above ask and economic exit 1 − limit', async () => {
    const userId = 'user_prot_no_pnl';
    const trade = filledTrade({
      userId,
      tradeId: 't_no',
      decision: 'NO',
      payPrice: 0.4,
      fillCount: 10,
      price: '0.60',
    });
    await saveTradeRecord(userId, trade as any);
    const places: any[] = [];
    const res = await runCloudProtectSells(
      runOpts({
        userId,
        trade,
        trades: [trade],
        now: new Date('2026-09-07T15:01:00.000Z'),
        lean: {
          decision: 'YES',
          abs_gap: 200,
          phase: 'live',
          yes_bid: 0.4,
          yes_ask: 0.42,
        },
        place: async (input: any) => {
          places.push(input);
          return { ok: true, fill_count: 10, order_id: 'ord-exit-no' };
        },
      })
    );
    expect(places[0].side).toBe('bid');
    expect(Number(places[0].price)).toBeCloseTo(0.44, 4);
    expect(res.exited).toBe(1);
    const stored = (await getTradeRecords(userId)).find((t) => t.tradeId === 't_no');
    // exitEconomic = 1 - 0.44 = 0.56; pnl = 10 * (0.56 - 0.40) = 1.60
    expect(stored?.pnlUsd).toBe(1.6);
  });

  test('IOC miss reverts to pending and retries next tick', async () => {
    const userId = 'user_prot_miss';
    const trade = filledTrade({ userId, tradeId: 't_miss' });
    await saveTradeRecord(userId, trade as any);
    const first = await runCloudProtectSells(
      runOpts({
        userId,
        trade,
        trades: [trade],
        place: async () => ({ ok: true, fill_count: 0, order_id: null }),
      })
    );
    expect(first.exited).toBe(0);
    expect(first.skipped).toContain('ioc_miss');
    const afterMiss = (await getTradeRecords(userId)).find((t) => t.tradeId === 't_miss');
    expect(afterMiss?.outcome).toBe('pending');

    const second = await runCloudProtectSells(
      runOpts({
        userId,
        trade: afterMiss,
        trades: [afterMiss],
        place: async () => ({ ok: true, fill_count: 10, order_id: 'ord-retry' }),
      })
    );
    expect(second.exited).toBe(1);
    expect((await getTradeRecords(userId)).find((t) => t.tradeId === 't_miss')?.outcome).toBe('exited');
  });

  test('two concurrent ticks only place one exit', async () => {
    const userId = 'user_prot_race';
    const trade = filledTrade({ userId, tradeId: 't_race' });
    await saveTradeRecord(userId, trade as any);
    const copyA = { ...trade };
    const copyB = { ...trade };
    let places = 0;
    const place = async () => {
      places += 1;
      return { ok: true, fill_count: 10, order_id: `ord-${places}` };
    };
    const [a, b] = await Promise.all([
      runCloudProtectSells(runOpts({ userId, trade: copyA, trades: [copyA], place })),
      runCloudProtectSells(runOpts({ userId, trade: copyB, trades: [copyB], place })),
    ]);
    expect(a.exited + b.exited).toBe(1);
    expect(places).toBe(1);
    expect((a.skipped.includes('claim_lost') ? 1 : 0) + (b.skipped.includes('claim_lost') ? 1 : 0)).toBe(1);
  });

  test('already exited trade is not a candidate and never places again', async () => {
    const userId = 'user_prot_done';
    const trade = filledTrade({
      userId,
      tradeId: 't_done',
      outcome: 'exited',
      pnlUsd: -1,
      status: 'SETTLED',
      protectExitOrderId: 'ord-exit',
    });
    await saveTradeRecord(userId, trade as any);
    expect(pendingProtectTradesForMarket([trade as any], trade.ticker)).toHaveLength(0);
    const res = await runCloudProtectSells(
      runOpts({
        userId,
        trade,
        trades: [trade],
        place: async () => {
          throw new Error('must_not_place');
        },
      })
    );
    expect(res.exited).toBe(0);
    expect(res.placed).toBe(0);
  });

  test('stale exiting claim can retry; fresh claim cannot', async () => {
    const now = new Date('2026-09-07T15:01:00.000Z');
    const fresh = filledTrade({
      outcome: 'exiting',
      protectClaimedAt: new Date(now.getTime() - 5_000).toISOString(),
    });
    const stale = filledTrade({
      tradeId: 't_stale',
      outcome: 'exiting',
      protectClaimedAt: new Date(now.getTime() - PROTECT_CLAIM_STALE_MS - 1).toISOString(),
    });
    expect(pendingProtectTradesForMarket([fresh as any], fresh.ticker, now)).toHaveLength(0);
    expect(pendingProtectTradesForMarket([stale as any], stale.ticker, now)).toHaveLength(1);
  });

  test('dry-run fills are never protect-sold', () => {
    const trade = filledTrade({ dryRun: true });
    expect(pendingProtectTradesForMarket([trade as any], trade.ticker)).toHaveLength(0);
  });

  test('place exception reverts claim so the next tick can retry', async () => {
    const userId = 'user_prot_boom';
    const trade = filledTrade({ userId, tradeId: 't_boom' });
    await saveTradeRecord(userId, trade as any);
    const first = await runCloudProtectSells(
      runOpts({
        userId,
        trade,
        trades: [trade],
        place: async () => {
          throw new Error('kalshi_down');
        },
      })
    );
    expect(first.skipped).toContain('place_exception');
    expect((await getTradeRecords(userId)).find((t) => t.tradeId === 't_boom')?.outcome).toBe('pending');
  });

  test('disarmed Kalshi users stay on the worker for settlement; kill-switch does not', async () => {
    expect(shouldLoadCloudTradeBook({ kalshiConfigured: true, state: 'DISARMED' })).toBe(true);
    expect(shouldLoadCloudTradeBook({ kalshiConfigured: true, state: 'ARMED' })).toBe(true);
    expect(shouldLoadCloudTradeBook({ kalshiConfigured: true, state: 'KILL_SWITCH' })).toBe(false);
    expect(shouldLoadCloudTradeBook({ kalshiConfigured: false, state: 'DISARMED' })).toBe(false);

    await upsertUserDoc('user_prot_only', {
      userId: 'user_prot_only',
      cloudTradingEnabled: false,
      kalshiConfigured: true,
      state: 'DISARMED',
      config: { alerts_enabled: false, risk: { protect_sell_enabled: true } },
    } as any);
    await upsertUserDoc('user_disarmed_settle', {
      userId: 'user_disarmed_settle',
      cloudTradingEnabled: false,
      kalshiConfigured: true,
      state: 'DISARMED',
      config: { alerts_enabled: false, auto_trade_enabled: false, risk: { protect_sell_enabled: false } },
    } as any);
    await upsertUserDoc('user_prot_kill', {
      userId: 'user_prot_kill',
      cloudTradingEnabled: false,
      kalshiConfigured: true,
      state: 'KILL_SWITCH',
      config: { alerts_enabled: false, risk: { protect_sell_enabled: true } },
    } as any);
    const users = await getEnrolledActiveUsers();
    expect(users.some((u) => u.userId === 'user_prot_only')).toBe(true);
    expect(users.some((u) => u.userId === 'user_disarmed_settle')).toBe(true);
    expect(users.some((u) => u.userId === 'user_prot_kill')).toBe(false);
  });

  test('push is one collapse id per trade and respects mute', () => {
    expect(protectCollapseId('usr_a', 'trade_1')).toBe('prot:usr_a:trade_1');
    expect(protectCollapseId('usr_' + 'x'.repeat(80), 'trade_' + 'z'.repeat(80)).length).toBeLessThanOrEqual(64);
    expect(protectPushEnabled({ alerts_enabled: true })).toBe(true);
    expect(protectPushEnabled({ alerts_enabled: false })).toBe(false);
    expect(
      protectPushEnabled({
        alerts_enabled: true,
        alert_prefs: { protect_sell: { enabled: true, push: false } },
      })
    ).toBe(false);
  });

  test('successful exit emits exactly one alert payload (no ding on miss)', async () => {
    const userId = 'user_prot_ding';
    const trade = filledTrade({ userId, tradeId: 't_ding' });
    await saveTradeRecord(userId, trade as any);
    const miss = await runCloudProtectSells(
      runOpts({
        userId,
        trade,
        trades: [trade],
        place: async () => ({ ok: false, fill_count: 0 }),
      })
    );
    expect(miss.alerts).toHaveLength(0);
    const stored = (await getTradeRecords(userId)).find((t) => t.tradeId === 't_ding');
    const hit = await runCloudProtectSells(
      runOpts({
        userId,
        trade: stored,
        trades: [stored],
        place: async () => ({ ok: true, fill_count: 10, order_id: 'ord-ding' }),
      })
    );
    expect(hit.alerts).toHaveLength(1);
    const again = await runCloudProtectSells(
      runOpts({
        userId,
        trade: (await getTradeRecords(userId)).find((t) => t.tradeId === 't_ding'),
        trades: await getTradeRecords(userId),
        place: async () => ({ ok: true, fill_count: 10, order_id: 'ord-dup' }),
      })
    );
    expect(again.exited).toBe(0);
    expect(again.alerts).toHaveLength(0);
  });
});

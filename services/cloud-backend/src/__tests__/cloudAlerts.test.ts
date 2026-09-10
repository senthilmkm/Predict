import request from 'supertest';
import { app } from '../index';
import {
  alertPersistEnabled,
  alertPushEnabled,
  dailyLossAlertFromPnl,
  dailyLossAlertId,
  emitCloudAlert,
  fillAlertId,
  leanAlertId,
  leanAlertSide,
  missAlertId,
  maybeEmitLeanAlert,
  persistSettlementAlertIfNeeded,
  protectAlertId,
  settleAlertId,
  settlementAlertFromTrade,
} from '../services/cloudAlerts';
import { getAlertRecords, getTradeRecords, saveAlertRecord, saveTradeRecord } from '../services/firestore';
import { settlePendingCloudTrades } from '../services/settlement';
import { getMarketQuote } from 'trading-core';

jest.mock('trading-core', () => {
  const actual = jest.requireActual('trading-core');
  return {
    ...actual,
    getMarketQuote: jest.fn(async () => ({ result: 'yes', status: 'finalized' })),
  };
});

const quoteMock = getMarketQuote as jest.MockedFunction<typeof getMarketQuote>;

describe('cloud alerts persist + mute + settlement', () => {
  beforeEach(() => {
    quoteMock.mockClear();
  });

  test('ids are stable so retries cannot fork History', () => {
    expect(leanAlertId('KXGOLD15M-A', 'yes')).toBe('lean:KXGOLD15M-A:YES');
    expect(fillAlertId('trade_1')).toBe('fill:trade_1');
    expect(missAlertId('trade_1')).toBe('miss:trade_1');
    expect(protectAlertId('trade_1')).toBe('protect:trade_1');
    expect(settleAlertId('trade_1')).toBe('settle:trade_1');
    expect(dailyLossAlertId('2026-09-08')).toBe('dailyloss:2026-09-08');
    expect(leanAlertSide({ phase: 'ended', decision: 'SKIP' })).toBeNull();
    expect(leanAlertSide({ phase: 'live', decision: 'SKIP' })).toBeNull();
    expect(leanAlertSide({ phase: 'live', decision: 'NO' })).toBe('NO');
    expect(leanAlertSide({ phase: 'upcoming', decision: 'YES' })).toBeNull();
  });

  test('SKIP leans never persist and below-cushion does not write both sides', async () => {
    const uid = 'user_lean_skip';
    const now = new Date('2026-09-08T22:00:00.000Z');
    const skip = await maybeEmitLeanAlert({
      userId: uid,
      cfg: { alerts_enabled: true },
      tokens: ['ExponentPushToken[test]'],
      asset: 'BTC',
      ticker: 'KXBTC15M-SKIP',
      decision: 'SKIP',
      absGap: 1,
      cushion: 7,
      minutesLeft: 0,
      leanAlertsSent: {},
      now,
    });
    expect(skip).toEqual({ next: {}, dirty: false, persisted: false, pushed: false });
    expect(await getAlertRecords(uid)).toEqual([]);

    const yes = await maybeEmitLeanAlert({
      userId: uid,
      cfg: { alerts_enabled: true },
      tokens: [],
      asset: 'Gold',
      ticker: 'KXGOLD15M-FLIP',
      decision: 'YES',
      absGap: 0.13,
      cushion: 7.25,
      minutesLeft: 14,
      leanAlertsSent: {},
      now,
    });
    expect(yes.persisted).toBe(false);
    const no = await maybeEmitLeanAlert({
      userId: uid,
      cfg: { alerts_enabled: true },
      tokens: [],
      asset: 'Gold',
      ticker: 'KXGOLD15M-FLIP',
      decision: 'NO',
      absGap: 0.02,
      cushion: 7.25,
      minutesLeft: 13,
      leanAlertsSent: yes.next,
      now,
    });
    expect(no.persisted).toBe(false);
    expect(await getAlertRecords(uid)).toEqual([]);
  });

  test('0m-left YES/NO leans never persist even if gap clears cushion', async () => {
    const uid = 'user_lean_expired';
    const now = new Date('2026-09-08T22:00:00.000Z');
    const expired = await maybeEmitLeanAlert({
      userId: uid,
      cfg: { alerts_enabled: true },
      tokens: ['ExponentPushToken[test]'],
      asset: 'Gold',
      ticker: 'KXGOLD15M-26SEP082100-00',
      decision: 'YES',
      absGap: 8.69,
      cushion: 7.25,
      minutesLeft: 0,
      leanAlertsSent: {},
      now,
    });
    expect(expired).toEqual({ next: {}, dirty: false, persisted: false, pushed: false });
    expect(await getAlertRecords(uid)).toEqual([]);

    const live = await maybeEmitLeanAlert({
      userId: uid,
      cfg: { alerts_enabled: true },
      tokens: [],
      asset: 'Gold',
      ticker: 'KXGOLD15M-26SEP082115-15',
      decision: 'NO',
      absGap: 9.15,
      cushion: 7.25,
      minutesLeft: 13,
      leanAlertsSent: {},
      now,
    });
    expect(live.persisted).toBe(true);
    expect((await getAlertRecords(uid)).map((a) => a.alertId)).toEqual([
      'lean:KXGOLD15M-26SEP082115-15:NO',
    ]);

    await saveAlertRecord(uid, {
      alertId: 'lean:KXGOLD15M-26SEP082100-00:YES',
      userId: uid,
      kind: 'lean_signal',
      title: 'Signal · Gold YES',
      body: 'Gap $8.69 · Cushion $7.25 · 0m left',
      at: '2026-09-08T21:59:00.000Z',
      source: 'gcp',
      decision: 'YES',
    });
    const listed = await request(app).get('/me/alerts').set('Authorization', `Bearer ${uid}`);
    expect(listed.body.alerts.map((a: any) => a.alertId)).toEqual([
      'lean:KXGOLD15M-26SEP082115-15:NO',
    ]);
  });

  test('mute still persists; Alerts Off still persists money events', () => {
    const muted = {
      alerts_enabled: true,
      alert_prefs: {
        lean_signal: { enabled: true, push: false },
        order_filled: { enabled: true, push: false },
      },
    };
    expect(alertPersistEnabled(muted, 'lean_signal')).toBe(true);
    expect(alertPushEnabled(muted, 'lean_signal')).toBe(false);
    expect(alertPersistEnabled(muted, 'order_filled')).toBe(true);
    expect(alertPushEnabled(muted, 'order_filled')).toBe(false);

    const off = { alerts_enabled: false };
    expect(alertPersistEnabled(off, 'lean_signal')).toBe(false);
    expect(alertPersistEnabled(off, 'order_filled')).toBe(true);
    expect(alertPersistEnabled(off, 'trade_result')).toBe(true);
    expect(alertPersistEnabled(off, 'protect_sell')).toBe(true);
    expect(alertPersistEnabled(off, 'ioc_miss')).toBe(true);
    expect(alertPersistEnabled(off, 'daily_loss_stop')).toBe(true);
  });

  test('saveAlertRecord is idempotent by alertId', async () => {
    const uid = 'user_alert_idemp';
    const doc = {
      alertId: leanAlertId('KX-1', 'YES'),
      userId: uid,
      kind: 'lean_signal',
      title: 'Signal · Gold YES',
      body: 'Gap $10.00',
      at: '2026-09-08T20:00:00.000Z',
      source: 'gcp' as const,
    };
    expect(await saveAlertRecord(uid, doc)).toBe('created');
    expect(await saveAlertRecord(uid, { ...doc, body: 'should not replace' })).toBe('exists');
    const rows = await getAlertRecords(uid);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe('Gap $10.00');
  });

  test('muted lean writes Firestore and never calls Expo', async () => {
    const uid = 'user_alert_mute';
    const order: string[] = [];
    const cfg = {
      alerts_enabled: true,
      alert_prefs: { lean_signal: { enabled: true, push: false } },
    };
    const res = await emitCloudAlert({
      userId: uid,
      alertId: leanAlertId('KX-MUTE', 'YES'),
      kind: 'lean_signal',
      title: 'Signal · Gold YES',
      body: 'Gap $8.00 · Cushion $7 · 10m left',
      cfg,
      tokens: ['ExponentPushToken[test]'],
      sendPush: async () => {
        order.push('push');
        return { successCount: 1, failureCount: 0 };
      },
    });
    expect(res).toEqual({ persisted: true, pushed: false });
    expect(order).toEqual([]);
    const rows = await getAlertRecords(uid);
    expect(rows).toHaveLength(1);
    expect(rows[0].alertId).toBe('lean:KX-MUTE:YES');
  });

  test('write finishes before Expo is invoked', async () => {
    const uid = 'user_alert_order';
    const order: string[] = [];
    let pushDone!: () => void;
    const pushed = new Promise<void>((resolve) => {
      pushDone = resolve;
    });
    await emitCloudAlert({
      userId: uid,
      alertId: fillAlertId('t_order'),
      kind: 'order_filled',
      title: 'Order Placed · Gold YES',
      body: '1 ctr @ $0.55 · Cost $0.55',
      cfg: { alerts_enabled: true },
      tokens: ['ExponentPushToken[test]'],
      sendPush: async () => {
        const existing = await getAlertRecords(uid);
        order.push(existing.some((a) => a.alertId === 'fill:t_order') ? 'saved-then-push' : 'push-first');
        pushDone();
        return { successCount: 1, failureCount: 0 };
      },
    });
    await pushed;
    expect(order).toEqual(['saved-then-push']);
  });

  test('GET /me/alerts returns persisted rows for that user only', async () => {
    const uid = 'user_alert_get';
    const other = 'user_alert_other';
    await saveAlertRecord(uid, {
      alertId: 'fill:mine',
      userId: uid,
      kind: 'order_filled',
      title: 'Order Placed · BTC YES',
      body: '1 ctr',
      at: '2026-09-08T21:00:00.000Z',
      source: 'gcp',
    });
    await saveAlertRecord(other, {
      alertId: 'fill:theirs',
      userId: other,
      kind: 'order_filled',
      title: 'Order Placed · ETH YES',
      body: '2 ctr',
      at: '2026-09-08T21:01:00.000Z',
      source: 'gcp',
    });

    const res = await request(app).get('/me/alerts').set('Authorization', `Bearer ${uid}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.alerts.map((a: any) => a.alertId)).toEqual(['fill:mine']);

    await saveAlertRecord(uid, {
      alertId: 'lean:KX-1:SKIP',
      userId: uid,
      kind: 'lean_signal',
      title: 'Signal · BTC SKIP',
      body: 'Gap $1.00 · Cushion $7 · 0m left',
      at: '2026-09-08T21:02:00.000Z',
      source: 'gcp',
      decision: 'SKIP',
    });
    await saveAlertRecord(uid, {
      alertId: 'lean:KX-2:YES',
      userId: uid,
      kind: 'lean_signal',
      title: 'Signal · Gold YES',
      body: 'Gap $0.13 · Cushion $7.25 · 14m left',
      at: '2026-09-08T21:03:00.000Z',
      source: 'gcp',
      decision: 'YES',
    });
    const afterSkip = await request(app).get('/me/alerts').set('Authorization', `Bearer ${uid}`);
    expect(afterSkip.body.alerts.map((a: any) => a.alertId)).toEqual(['fill:mine']);

    const src = require('fs').readFileSync(require('path').join(__dirname, '../services/firestore.ts'), 'utf8');
    expect(src).toContain("orderBy('at', 'desc')");
    expect(src).toContain('col.limit(400).get()');
    expect(src).not.toMatch(/catch \{\s*return sortAlertsDesc\(localAlertStore/);
    const api = require('fs').readFileSync(require('path').join(__dirname, '../routes/api.ts'), 'utf8');
    expect(api).toContain('Number.isFinite(raw) ? raw : 400');
    expect(api).toContain("/me/alerts/dismiss");
    expect(api).toContain("/me/alerts/prune");
  });

  test('POST /me/alerts/dismiss hides rows and the same alertId does not reappear', async () => {
    const uid = 'user_alert_dismiss';
    await saveAlertRecord(uid, {
      alertId: 'fill:gone',
      userId: uid,
      kind: 'order_filled',
      title: 'Order Placed · BTC YES',
      body: '1 ctr',
      at: '2026-09-08T21:00:00.000Z',
      source: 'gcp',
    });
    const gone = await request(app)
      .post('/me/alerts/dismiss')
      .set('Authorization', `Bearer ${uid}`)
      .send({ ids: ['fill:gone'] });
    expect(gone.status).toBe(200);
    expect(gone.body).toEqual({ ok: true, dismissed: 1 });

    const listed = await request(app).get('/me/alerts').set('Authorization', `Bearer ${uid}`);
    expect(listed.body.alerts.map((a: any) => a.alertId)).toEqual([]);

    expect(
      await saveAlertRecord(uid, {
        alertId: 'fill:gone',
        userId: uid,
        kind: 'order_filled',
        title: 'Order Placed · BTC YES',
        body: 'retry should not resurrect',
        at: '2026-09-08T21:01:00.000Z',
        source: 'gcp',
      })
    ).toBe('exists');
    const after = await request(app).get('/me/alerts').set('Authorization', `Bearer ${uid}`);
    expect(after.body.alerts).toEqual([]);
  });

  test('POST /me/alerts/prune hides rows older than the retention window', async () => {
    const uid = 'user_alert_prune';
    const nowMs = Date.now();
    const oldAt = new Date(nowMs - 40 * 24 * 60 * 60 * 1000).toISOString();
    const freshAt = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();
    await saveAlertRecord(uid, {
      alertId: 'fill:old',
      userId: uid,
      kind: 'order_filled',
      title: 'Order Placed · BTC YES',
      body: 'old',
      at: oldAt,
      source: 'gcp',
    });
    await saveAlertRecord(uid, {
      alertId: 'fill:fresh',
      userId: uid,
      kind: 'order_filled',
      title: 'Order Placed · ETH YES',
      body: 'fresh',
      at: freshAt,
      source: 'gcp',
    });
    const pruned = await request(app)
      .post('/me/alerts/prune')
      .set('Authorization', `Bearer ${uid}`)
      .send({ olderThanDays: 30 });
    expect(pruned.status).toBe(200);
    expect(pruned.body).toEqual({ ok: true, dismissed: 1 });
    const listed = await request(app).get('/me/alerts').set('Authorization', `Bearer ${uid}`);
    expect(listed.body.alerts.map((a: any) => a.alertId)).toEqual(['fill:fresh']);
    expect(
      await saveAlertRecord(uid, {
        alertId: 'fill:old',
        userId: uid,
        kind: 'order_filled',
        title: 'Order Placed · BTC YES',
        body: 'should not resurrect',
        at: oldAt,
        source: 'gcp',
      })
    ).toBe('exists');
  });

  test('this-tick settlement produces Trade won with exact phone wording and cents', async () => {
    const now = new Date('2026-09-08T22:00:00.000Z');
    const nowIso = now.toISOString();
    const uid = 'user_alert_settle';
    await saveTradeRecord(uid, {
      tradeId: 't_win',
      userId: uid,
      ticker: 'KXBTC15M-DONE',
      asset: 'BTC',
      decision: 'YES',
      count: '10',
      price: '0.60',
      notionalUsd: 6,
      dryRun: false,
      status: 'FILLED',
      executedAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
      payPrice: 0.6,
      fillCount: 10,
      outcome: 'pending',
      pnlUsd: null,
    });
    const after = await settlePendingCloudTrades(uid, await getTradeRecords(uid), now);
    const won = after.find((t) => t.tradeId === 't_win');
    expect(won?.outcome).toBe('win');
    expect(won?.pnlUsd).toBe(4);
    expect(won?.settledAt).toBe(nowIso);

    const alert = settlementAlertFromTrade(won!, now);
    expect(alert).toEqual({
      alertId: 'settle:t_win',
      title: 'Trade won',
      body: 'BTC YES · P&L $4.00 · KXBTC15M-DONE',
      pnlUsd: 4,
    });
    expect(settlementAlertFromTrade(won!, new Date('2026-09-08T22:00:01.000Z'))).not.toBeNull();
    // Failed alert write is still eligible days later until stamped.
    expect(settlementAlertFromTrade(won!, new Date('2026-09-09T01:00:00.000Z'))).not.toBeNull();
    expect(
      settlementAlertFromTrade({ ...won!, settlementAlertAt: nowIso } as any, new Date('2026-09-09T01:00:00.000Z'))
    ).toBeNull();

    const emitted = await emitCloudAlert({
      userId: uid,
      alertId: alert!.alertId,
      kind: 'trade_result',
      title: alert!.title,
      body: alert!.body,
      cfg: { alerts_enabled: true, alert_prefs: { trade_result: { enabled: true, push: false } } },
      tokens: ['ExponentPushToken[test]'],
      sendPush: async () => ({ successCount: 1, failureCount: 0 }),
    });
    expect(emitted).toEqual({ persisted: true, pushed: false });
    const listed = await request(app).get('/me/alerts').set('Authorization', `Bearer ${uid}`);
    expect(listed.body.alerts.some((a: any) => a.alertId === 'settle:t_win')).toBe(true);
  });

  test('Trade won persists then stamps so a later tick does not re-push', async () => {
    const now = new Date('2026-09-08T22:00:00.000Z');
    const later = new Date('2026-09-09T12:00:00.000Z');
    const uid = 'user_alert_stamp';
    const trade = {
      tradeId: 't_stamp',
      userId: uid,
      ticker: 'KXBTC15M-DONE',
      asset: 'BTC',
      decision: 'YES' as const,
      count: '10',
      price: '0.60',
      notionalUsd: 6,
      dryRun: false,
      status: 'SETTLED' as const,
      executedAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
      settledAt: now.toISOString(),
      payPrice: 0.6,
      fillCount: 10,
      outcome: 'win' as const,
      pnlUsd: 4,
      settlementAlertAt: null as string | null,
    };
    await saveTradeRecord(uid, trade);
    let pushes = 0;
    const send = async () => {
      pushes += 1;
      return { successCount: 1, failureCount: 0 };
    };
    const cfg = { alerts_enabled: true };
    const first = await persistSettlementAlertIfNeeded({
      userId: uid,
      trade,
      now,
      cfg,
      tokens: ['ExponentPushToken[test]'],
      sendPush: send,
    });
    const stored = (await getTradeRecords(uid)).find((t) => t.tradeId === 't_stamp');
    expect(first).toEqual({ persisted: true, pushed: true });
    expect(stored?.settlementAlertAt).toBe(now.toISOString());
    expect(trade.settlementAlertAt).toBe(now.toISOString());

    const second = await persistSettlementAlertIfNeeded({
      userId: uid,
      trade: stored!,
      now: later,
      cfg,
      tokens: ['ExponentPushToken[test]'],
      sendPush: send,
    });
    expect(second).toEqual({ persisted: false, pushed: false });
    expect(pushes).toBe(1);
    expect((await getAlertRecords(uid)).map((a) => a.alertId)).toEqual(['settle:t_stamp']);
  });

  test('worker stamps Trade won and still skips Protect on KILL_SWITCH', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../routes/worker.ts'), 'utf8');
    expect(src).toContain('persistSettlementAlertIfNeeded');
    expect(src).toMatch(/user\.state !== 'KILL_SWITCH'/);
    expect(src).not.toContain('SETTLEMENT_ALERT_LOOKBACK');
    const leanAt = src.indexOf('maybeEmitLeanAlert');
    const cushionAt = src.indexOf('absGap < userCushion');
    const capAt = src.indexOf('existingBuys >= windowCap');
    expect(leanAt).toBeGreaterThan(0);
    expect(leanAt).toBeLessThan(cushionAt);
    expect(src).toContain('leanAlertSide');
    expect(cushionAt).toBeLessThan(capAt);
  });

  test('lean persist retries after a fill and below-cushion rows do not push', async () => {
    const uid = 'user_lean_edges';
    const now = new Date('2026-09-08T22:00:00.000Z');
    const cfg = { alerts_enabled: true };
    let pushes = 0;
    const send = async () => {
      pushes += 1;
      return { successCount: 1, failureCount: 0 };
    };
    const below = await maybeEmitLeanAlert({
      userId: uid,
      cfg,
      tokens: ['ExponentPushToken[test]'],
      asset: 'Gold',
      ticker: 'KXGOLD15M-A',
      decision: 'YES',
      absGap: 3,
      cushion: 7,
      minutesLeft: 10,
      leanAlertsSent: {},
      now,
      sendPush: send,
    });
    expect(below.persisted).toBe(false);
    expect(below.pushed).toBe(false);
    expect(pushes).toBe(0);

    const afterFill = await maybeEmitLeanAlert({
      userId: uid + '_fill',
      cfg,
      tokens: ['ExponentPushToken[test]'],
      asset: 'Gold',
      ticker: 'KXGOLD15M-B',
      decision: 'YES',
      absGap: 10,
      cushion: 7,
      minutesLeft: 8,
      leanAlertsSent: {},
      now,
      sendPush: send,
    });
    expect(afterFill.persisted).toBe(true);
    expect(afterFill.pushed).toBe(true);
    expect(pushes).toBe(1);
    const retry = await maybeEmitLeanAlert({
      userId: uid + '_fill',
      cfg,
      tokens: ['ExponentPushToken[test]'],
      asset: 'Gold',
      ticker: 'KXGOLD15M-B',
      decision: 'YES',
      absGap: 10,
      cushion: 7,
      minutesLeft: 7,
      leanAlertsSent: afterFill.next,
      now,
      sendPush: send,
    });
    expect(retry.dirty).toBe(false);
    expect(pushes).toBe(1);
    expect((await getAlertRecords(uid)).map((a) => a.alertId)).toEqual([]);
    expect((await getAlertRecords(uid + '_fill')).map((a) => a.alertId)).toEqual(['lean:KXGOLD15M-B:YES']);
  });

  test('daily loss stop matches the buy gate and does not re-push', async () => {
    expect(
      dailyLossAlertFromPnl({ dailyPnlUsd: -49.99, stopUsd: 50, etDay: '2026-09-08' })
    ).toBeNull();
    expect(
      dailyLossAlertFromPnl({ dailyPnlUsd: -50, stopUsd: 50, etDay: '2026-09-08' })
    ).toEqual({
      alertId: 'dailyloss:2026-09-08',
      title: 'Daily loss stop',
      body: 'New buys paused · realized P&L $-50.00 today (stop $50.00)',
      dailyPnlUsd: -50,
      stopUsd: 50,
    });

    const uid = 'user_alert_dailyloss';
    let pushes = 0;
    const cfg = { alerts_enabled: true };
    const send = async () => {
      pushes += 1;
      return { successCount: 1, failureCount: 0 };
    };
    const first = await emitCloudAlert({
      userId: uid,
      alertId: 'dailyloss:2026-09-08',
      kind: 'daily_loss_stop',
      title: 'Daily loss stop',
      body: 'New buys paused · realized P&L $-50.00 today (stop $50.00)',
      cfg,
      tokens: ['ExponentPushToken[test]'],
      sendPush: send,
    });
    const second = await emitCloudAlert({
      userId: uid,
      alertId: 'dailyloss:2026-09-08',
      kind: 'daily_loss_stop',
      title: 'Daily loss stop',
      body: 'New buys paused · realized P&L $-55.00 today (stop $50.00)',
      cfg,
      tokens: ['ExponentPushToken[test]'],
      sendPush: send,
    });
    expect(first).toEqual({ persisted: true, pushed: true });
    expect(second).toEqual({ persisted: true, pushed: false });
    expect(pushes).toBe(1);
    expect((await getAlertRecords(uid)).map((a) => a.alertId)).toEqual(['dailyloss:2026-09-08']);
  });
});

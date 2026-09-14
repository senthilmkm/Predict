import request from 'supertest';
import { app } from '../index';
import { resetLeanAlertMemoryForTests, writeLiveAskBookPulse } from '../routes/worker';
import {
  getLiveAsksSnapshot,
  idleLiveAsksSnapshot,
  mergeLiveAsks,
  persistLiveAsksSnapshot,
  resetLiveAsksMemoryForTests,
} from '../services/liveAsks';

describe('live 1s asks', () => {
  beforeEach(() => {
    resetLiveAsksMemoryForTests();
    resetLeanAlertMemoryForTests();
  });

  test('merge keeps last quote when this second missed and drops off-watch assets', () => {
    expect(
      mergeLiveAsks(
        { BTC: { yes_ask: 0.4, no_ask: 0.61, ticker: 'KXBTC15M' }, ETH: { yes_ask: 0.5 } },
        { BTC: { yes_ask: 0.41, no_ask: 0.6, ticker: 'KXBTC15M' } },
        ['BTC', 'SOL']
      )
    ).toEqual({
      BTC: { yes_ask: 0.41, no_ask: 0.6, ticker: 'KXBTC15M' },
    });
    expect(
      mergeLiveAsks(
        { BTC: { yes_ask: 0.4, no_ask: 0.61 } },
        {},
        ['BTC']
      )
    ).toEqual({ BTC: { yes_ask: 0.4, no_ask: 0.61 } });
  });

  test('GET /me/quotes and /me/status expose the watcher book', async () => {
    await persistLiveAsksSnapshot({
      at: '2020-01-01T00:00:00.000Z',
      byAsset: { BTC: { yes_ask: 0.42, no_ask: 0.59, ticker: 'KXBTC15M' } },
    });
    const fromMemory = await getLiveAsksSnapshot();
    expect(fromMemory.byAsset.BTC.yes_ask).toBe(0.42);
    const quotes = await request(app).get('/me/quotes').set('Authorization', 'Bearer usr_asks');
    expect(quotes.status).toBe(200);
    expect(quotes.body.ok).toBe(true);
    expect(quotes.body.asks.BTC).toEqual({
      yes_ask: 0.42,
      no_ask: 0.59,
      ticker: 'KXBTC15M',
    });
    expect(quotes.body.lastTradeAction).toBeUndefined();
    const status = await request(app).get('/me/status').set('Authorization', 'Bearer usr_asks');
    expect(status.status).toBe(200);
    expect(status.body.liveAsks.byAsset.BTC.yes_ask).toBe(0.42);
    await persistLiveAsksSnapshot(idleLiveAsksSnapshot(new Date('2026-09-13T15:00:02.000Z')));
    const idle = await request(app).get('/me/quotes').set('Authorization', 'Bearer usr_asks');
    expect(idle.body.asks).toEqual({});
  });

  test('ask pulse heartbeats at so Home age does not freeze on last print', async () => {
    await persistLiveAsksSnapshot({
      at: '2020-01-01T00:00:00.000Z',
      byAsset: { BTC: { yes_ask: 0.4, no_ask: 0.61, ticker: 'KXBTC15M' } },
    });
    await writeLiveAskBookPulse(new Date('2026-09-13T17:42:00.000Z'));
    const snap = await getLiveAsksSnapshot();
    expect(snap.at).toBe('2026-09-13T17:42:00.000Z');
    expect(snap.byAsset.BTC).toEqual({ yes_ask: 0.4, no_ask: 0.61, ticker: 'KXBTC15M' });
  });
});

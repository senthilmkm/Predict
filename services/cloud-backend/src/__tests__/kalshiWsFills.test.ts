import { EventEmitter } from 'events';
import forge from 'node-forge';
import type { KalshiClient } from 'trading-core';
import type { KalshiOrderFields } from '../../../../packages/trading-core/src/orderFill';
import {
  confirmPlaceFillWsOrRest,
  kalshiWsFillDisagreeCount,
  kalshiWsFillOpenSocketsForTests,
  resetKalshiWsFillsForTests,
  setKalshiWsFillsEnabled,
} from '../services/kalshiWsFills';
import type { KalshiWsSocket } from '../services/kalshiWsQuotes';

function testPem(): string {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  return forge.pki.privateKeyToPem(keys.privateKey);
}

function fakeClient(rest: KalshiOrderFields, pem: string): KalshiClient {
  return {
    credentials: { keyId: 'k', privateKeyPem: pem, env: 'production' },
    restConfirmPlaceFill: jest.fn(async () => rest),
  } as unknown as KalshiClient;
}

function mockOpen(payload: unknown | null, construct: { n: number }) {
  return (): KalshiWsSocket => {
    construct.n += 1;
    const sock = new EventEmitter() as EventEmitter & KalshiWsSocket;
    sock.readyState = 1;
    sock.send = jest.fn();
    sock.close = jest.fn(() => {
      sock.emit('close');
    });
    queueMicrotask(() => {
      sock.emit('open');
      if (payload) sock.emit('message', JSON.stringify(payload));
    });
    return sock;
  };
}

describe('kalshiWsFills', () => {
  const pem = testPem();
  const initial: KalshiOrderFields = {
    order_id: 'ord-1',
    fill_count: '0',
    remaining_count: '5',
    average_fill_price: null,
    status: 'resting',
  };

  beforeEach(() => {
    resetKalshiWsFillsForTests();
  });

  afterEach(() => {
    expect(kalshiWsFillOpenSocketsForTests()).toBe(0);
  });

  test('flag Off never opens a fill socket', async () => {
    const construct = { n: 0 };
    const rest: KalshiOrderFields = { ...initial, fill_count: '5', remaining_count: '0', status: 'executed' };
    const client = fakeClient(rest, pem);
    const got = await confirmPlaceFillWsOrRest(client, initial, mockOpen(null, construct));
    expect(construct.n).toBe(0);
    expect(got.fill_count).toBe('5');
    expect(client.restConfirmPlaceFill).toHaveBeenCalled();
  });

  test('WS silence uses REST; disagree REST wins', async () => {
    setKalshiWsFillsEnabled(true);
    const construct = { n: 0 };
    const rest: KalshiOrderFields = { ...initial, fill_count: '5', remaining_count: '0', status: 'executed' };
    const client = fakeClient(rest, pem);
    const silent = await confirmPlaceFillWsOrRest(client, initial, mockOpen(null, construct));
    expect(silent.fill_count).toBe('5');
    expect(kalshiWsFillDisagreeCount()).toBe(0);

    const disagree = await confirmPlaceFillWsOrRest(
      client,
      initial,
      mockOpen(
        { type: 'fill', msg: { order_id: 'ord-1', fill_count: '2', remaining_count: '0', status: 'executed' } },
        construct
      )
    );
    expect(disagree.fill_count).toBe('5');
    expect(kalshiWsFillDisagreeCount()).toBe(1);
    expect(construct.n).toBeGreaterThan(0);
  });

  test('user_orders count is order size, not a fill', async () => {
    setKalshiWsFillsEnabled(true);
    const construct = { n: 0 };
    const rest: KalshiOrderFields = { ...initial, fill_count: '0', remaining_count: '0', status: 'canceled' };
    const client = fakeClient(rest, pem);
    const got = await confirmPlaceFillWsOrRest(
      client,
      initial,
      mockOpen({ type: 'user_order', msg: { order_id: 'ord-1', count: '5', remaining_count: '0', status: 'canceled' } }, construct)
    );
    expect(got.fill_count).toBe('0');
    expect(kalshiWsFillDisagreeCount()).toBe(0);
  });

  test('matching WS fill keeps REST count', async () => {
    setKalshiWsFillsEnabled(true);
    const construct = { n: 0 };
    const rest: KalshiOrderFields = { ...initial, fill_count: '5', remaining_count: '0', status: 'executed' };
    const client = fakeClient(rest, pem);
    const got = await confirmPlaceFillWsOrRest(
      client,
      initial,
      mockOpen(
        { type: 'user_order', msg: { order_id: 'ord-1', fill_count: '5', remaining_count: '0', status: 'executed' } },
        construct
      )
    );
    expect(got.fill_count).toBe('5');
    expect(kalshiWsFillDisagreeCount()).toBe(0);
  });
});

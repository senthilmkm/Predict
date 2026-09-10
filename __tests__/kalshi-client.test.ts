import { generateKeyPairSync } from 'crypto';
import { signKalshiRequest, assertPemLooksValid } from '../src/services/kalshi/sign';
import { KalshiClient } from '../src/services/kalshi/client';

describe('Kalshi sign', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  test('assertPemLooksValid accepts generated key', () => {
    expect(() => assertPemLooksValid(privateKey)).not.toThrow();
  });

  test('assertPemLooksValid rejects garbage', () => {
    expect(() => assertPemLooksValid('not-a-key')).toThrow(/invalid_pem/);
  });

  test('signKalshiRequest returns stable-length base64', () => {
    const sig = signKalshiRequest(privateKey, '1710000000000', 'GET', '/trade-api/v2/portfolio/balance');
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(100);
    // base64 charset
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test('different timestamps produce different signatures', () => {
    const a = signKalshiRequest(privateKey, '1', 'GET', '/trade-api/v2/portfolio/balance');
    const b = signKalshiRequest(privateKey, '2', 'GET', '/trade-api/v2/portfolio/balance');
    expect(a).not.toEqual(b);
  });
});

describe('KalshiClient', () => {
  test('balance parses cents and breakdown', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 200,
      json: async () => ({
        balance: 12345,
        balance_breakdown: [
          { exchange_index: 0, balance: 10000 },
          { exchange_index: 2, balance: 2345 },
        ],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const client = new KalshiClient('key', generatePem(), 'production', fetchImpl);
    const bal = await client.balance();
    expect(bal.ok).toBe(true);
    expect(bal.balance_cents).toBe(12345);
    expect(bal.balance_usd).toBe(123.45);
    expect(bal.balance_by_exchange_index?.[0]).toBe(10000);
    expect(bal.balance_by_exchange_index?.[2]).toBe(2345);
  });

  test('balance prefers balance_dollars and parses position portfolio_value', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 200,
      json: async () => ({
        balance: 15762,
        balance_dollars: '157.6200',
        portfolio_value: 999, // open positions only (cents)
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const client = new KalshiClient('key', generatePem(), 'production', fetchImpl);
    const bal = await client.balance();
    expect(bal.ok).toBe(true);
    expect(bal.balance_usd).toBe(157.62);
    expect(bal.portfolio_value_usd).toBe(9.99);
  });

  test('placeOrder dry_run never calls fetch', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const client = new KalshiClient('key', generatePem(), 'production', fetchImpl);
    const res = await client.placeOrder({
      ticker: 'KXGOLD15M-TEST',
      side: 'bid',
      count: '1.00',
      price: '0.0100',
      dry_run: true,
    });
    expect(res.ok).toBe(true);
    expect(res.dry_run).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.payload.ticker).toBe('KXGOLD15M-TEST');
  });

  test('placeOrder live posts and maps order fields', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 201,
      json: async () => ({
        order_id: 'ord-1',
        fill_count: '1.00',
        remaining_count: '0',
        average_fill_price: '0.50',
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const client = new KalshiClient('key', generatePem(), 'production', fetchImpl);
    const res = await client.placeOrder({
      ticker: 'KXGOLD15M-TEST',
      side: 'bid',
      count: '2.00',
      price: '0.5000',
      dry_run: false,
      exchange_index: 0,
    });
    expect(res.ok).toBe(true);
    expect(res.order_id).toBe('ord-1');
    expect(res.fill_count).toBe('1.00');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.exchange_index).toBe(0);
    expect(body.time_in_force).toBe('immediate_or_cancel');
  });

  test('placeOrder unwraps nested order and does not poll when already filled', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 201,
      json: async () => ({
        order: {
          order_id: 'ord-nested',
          fill_count: '4.00',
          remaining_count: '0',
          status: 'executed',
        },
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const client = new KalshiClient('key', generatePem(), 'production', fetchImpl);
    const res = await client.placeOrder({
      ticker: 'KXGOLD15M-TEST',
      side: 'bid',
      count: '4.00',
      price: '0.5000',
      dry_run: false,
    });
    expect(res.ok).toBe(true);
    expect(res.order_id).toBe('ord-nested');
    expect(res.fill_count).toBe('4.00');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('placeOrder waits and GETs the order when IOC fill_count starts at 0', async () => {
    let gets = 0;
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST') {
        return {
          status: 201,
          json: async () => ({
            order: {
              order_id: 'ord-late',
              fill_count: '0',
              remaining_count: '8',
              status: 'resting',
            },
          }),
          text: async () => '',
        };
      }
      gets += 1;
      return {
        status: 200,
        json: async () => ({
          order: {
            order_id: 'ord-late',
            fill_count: gets >= 2 ? '8.00' : '0',
            remaining_count: gets >= 2 ? '0' : '8',
            status: gets >= 2 ? 'executed' : 'resting',
          },
        }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;

    const client = new KalshiClient('key', generatePem(), 'production', fetchImpl);
    const res = await client.placeOrder({
      ticker: 'KXGOLD15M-TEST',
      side: 'bid',
      count: '8.00',
      price: '0.5000',
      dry_run: false,
    });
    expect(res.ok).toBe(true);
    expect(res.order_id).toBe('ord-late');
    expect(res.fill_count).toBe('8.00');
    expect(gets).toBeGreaterThanOrEqual(2);
    expect(String((fetchImpl as jest.Mock).mock.calls[1][0])).toMatch(/\/portfolio\/orders\/ord-late/);
  });

  test('smokeTestDryRun fails on bad asset', async () => {
    const client = new KalshiClient('key', generatePem(), 'production', jest.fn() as any);
    const res = await client.smokeTestDryRun('XYZ');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('bad_asset');
  });
});

function generatePem(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}

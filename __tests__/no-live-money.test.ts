/**
 * Safety: unit / UI / mocked e2e suites must never spend real money.
 * Live Kalshi placement is only allowed via explicit scripts
 * (`verify:kalshi:live-smoke`, `e2e:live-smoke`) — not `npm test`.
 */
import { KalshiClient } from '../src/services/kalshi/client';
import { generateKeyPairSync } from 'crypto';

function pem(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}

describe('no real-money in automated tests', () => {
  test('dry_run placeOrder never hits the network', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('network_should_not_be_called');
    }) as unknown as typeof fetch;
    const client = new KalshiClient('key', pem(), 'production', fetchImpl);
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
  });

  test('smokeTestDryRun places only with dry_run=true', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (String(url).includes('/markets?')) {
        return {
          status: 200,
          json: async () => ({
            markets: [{ ticker: 'KXGOLD15M-TEST', exchange_index: 0 }],
          }),
          text: async () => '',
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const client = new KalshiClient('key', pem(), 'production', fetchImpl);
    const res = await client.smokeTestDryRun('Gold');
    expect(res.ok).toBe(true);
    expect(res.place?.dry_run).toBe(true);
    // Only market discovery — no live order POST
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl as jest.Mock).mock.calls[0][0])).toContain('/markets?');
  });

  test('npm test scripts do not include live-smoke', () => {
    const pkg = require('../package.json');
    expect(String(pkg.scripts.test)).not.toMatch(/live-smoke/);
    expect(String(pkg.scripts['test:unit'])).not.toMatch(/live-smoke/);
    expect(String(pkg.scripts['test:ui'])).not.toMatch(/live-smoke/);
  });
});

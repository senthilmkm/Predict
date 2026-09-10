import { generateKeyPairSync } from 'crypto';
import { AppRuntime } from '../src/runtime/AppRuntime';
import { defaultAppConfig } from '../src/config/types';
import { MemoryKeyValueStore, setKeyValueStore, setSecureStore } from '../src/platform/storage';
import { clearCredentials, saveCredentials } from '../src/services/credentials';
import { persistPortfolioSamples } from '../src/storage/portfolioPersistence';

function pem(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}

function balanceFetch(balanceDollars: string, portfolioValueCents: number) {
  return jest.fn(async (url: string) => {
    if (String(url).includes('/portfolio/balance')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          balance_dollars: balanceDollars,
          portfolio_value: portfolioValueCents,
        }),
        text: async () => '',
      };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  }) as any;
}

describe('Home Predictions / Cash cards', () => {
  beforeEach(async () => {
    setKeyValueStore(new MemoryKeyValueStore());
    setSecureStore(new MemoryKeyValueStore());
    await clearCredentials();
  });

  test('hydrateHistory paints last saved Predictions and Cash before Kalshi answers', async () => {
    await persistPortfolioSamples([
      {
        at: new Date(Date.now() - 60_000).toISOString(),
        predictionsUsd: 140.48,
        cashUsd: 101.18,
      },
    ]);
    const rt = new AppRuntime({
      getConfig: () => defaultAppConfig(),
      fetchImpl: jest.fn(async () => {
        throw new Error('Kalshi should not be called during hydrate');
      }) as any,
    });
    await rt.hydrateHistory();
    expect(rt.status.predictionsBalanceUsd).toBe(140.48);
    expect(rt.status.cashBalanceUsd).toBe(101.18);
  });

  test('a missing-credentials refresh keeps last known totals instead of blanking the cards', async () => {
    await saveCredentials({ keyId: 'k', privateKeyPem: pem(), env: 'production' });
    const rt = new AppRuntime({
      getConfig: () => defaultAppConfig(),
      fetchImpl: balanceFetch('101.18', 3930),
    });
    await rt.refreshPredictionsBalance();
    expect(rt.status.predictionsBalanceUsd).toBe(140.48);
    expect(rt.status.cashBalanceUsd).toBe(101.18);

    await clearCredentials();
    rt.dropKalshiClient();
    await rt.refreshPredictionsBalance();
    expect(rt.status.predictionsBalanceUsd).toBe(140.48);
    expect(rt.status.cashBalanceUsd).toBe(101.18);
  });

  test('pull-to-refresh starts a new balance fetch if the previous one is hung', async () => {
    await saveCredentials({ keyId: 'k', privateKeyPem: pem(), env: 'production' });
    let balanceCalls = 0;
    let firstSeen!: () => void;
    const sawFirst = new Promise<void>((resolve) => {
      firstSeen = resolve;
    });
    const fetchImpl = jest.fn(async (url: string) => {
      if (String(url).includes('/portfolio/balance')) {
        balanceCalls += 1;
        if (balanceCalls === 1) {
          firstSeen();
          return await new Promise(() => {});
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ balance_dollars: '80.00', portfolio_value: 2000 }),
          text: async () => '',
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }) as any;

    const rt = new AppRuntime({ getConfig: () => defaultAppConfig(), fetchImpl });
    const hung = rt.refreshPredictionsBalance();
    await sawFirst;
    await rt.refreshPredictionsBalance();
    expect(rt.status.cashBalanceUsd).toBe(80);
    expect(rt.status.predictionsBalanceUsd).toBe(100);
    void hung;
  });

  test('refreshClient keeps an existing client when SecureStore is empty', async () => {
    await saveCredentials({ keyId: 'k', privateKeyPem: pem(), env: 'production' });
    const rt = new AppRuntime({
      getConfig: () => defaultAppConfig(),
      fetchImpl: balanceFetch('50.00', 0),
    });
    await rt.refreshPredictionsBalance();
    expect(rt.engine.getClient()).toBeTruthy();

    await clearCredentials();
    expect(await rt.refreshClient()).toBe(true);
    expect(rt.engine.getClient()).toBeTruthy();
  });
});

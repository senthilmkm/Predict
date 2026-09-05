import {
  humanizeQuietError,
  isAuthError,
  isCanceledNetworkError,
  isQuietIntegrationError,
  isRateLimitError,
} from '../src/util/httpErrors';
import { MemoryKeyValueStore, setKeyValueStore, setSecureStore } from '../src/platform/storage';
import { saveCredentials } from '../src/services/credentials';
import { defaultAppConfig } from '../src/config/types';
import { AppRuntime } from '../src/runtime/AppRuntime';
import { setNotifyImpl } from '../src/services/notifications';

describe('httpErrors quiet classification', () => {
  test('detects 429 / rate limit', () => {
    expect(isRateLimitError('http_429')).toBe(true);
    expect(isRateLimitError('BTC: rate limited · backing off 30s')).toBe(true);
    expect(isRateLimitError('HTTP 429')).toBe(true);
    expect(isQuietIntegrationError('price/lean failed · http_429')).toBe(true);
  });

  test('detects 401 / auth', () => {
    expect(isAuthError('http_401')).toBe(true);
    expect(isAuthError('HTTP 401')).toBe(true);
    expect(isAuthError('unauthorized')).toBe(true);
    expect(isQuietIntegrationError('order failed · HTTP 401')).toBe(true);
  });

  test('detects iOS screen lock FetchRequestCanceledException', () => {
    const err = 'ETH: price/lean failed · fetch failed: FetchRequestCanceledException: Fetch request has been canceled (at Expo/NativeResponse.swift:63)';
    expect(isCanceledNetworkError(err)).toBe(true);
    expect(isQuietIntegrationError(err)).toBe(true);
  });

  test('humanize messages', () => {
    expect(humanizeQuietError('http_429')).toMatch(/rate limit/i);
    expect(humanizeQuietError('http_401')).toMatch(/auth failed/i);
    expect(humanizeQuietError('FetchRequestCanceledException')).toMatch(/app backgrounded/i);
  });
});

describe('AppRuntime does not Expo-push 401/429', () => {
  beforeEach(() => {
    setKeyValueStore(new MemoryKeyValueStore());
    setSecureStore(new MemoryKeyValueStore());
  });

  test('lean http_429 records connection issue without push', async () => {
    const pushes: string[] = [];
    setNotifyImpl(async (p) => {
      pushes.push(`${p.kind}:${p.title}`);
    });

    const { generateKeyPairSync } = await import('crypto');
    const pem = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;
    await saveCredentials({ keyId: 'k', privateKeyPem: pem, env: 'production' });

    const cfg = {
      ...defaultAppConfig(),
      auto_trade_enabled: false,
      assets_enabled: {
        WTI: true,
        Gold: false,
        Silver: false,
        BTC: false,
        ETH: false,
      },
    };

    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    }));

    const rt = new AppRuntime({
      getConfig: () => cfg,
      fetchImpl: fetchImpl as any,
    });

    await rt.tick();

    expect(rt.status.lastError).toMatch(/rate limit/i);
    expect(pushes).toHaveLength(0);
    const errs = rt.alerts.list(10).filter((a) => a.kind === 'error');
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].title).toMatch(/connection/i);
  });

  test('lean http_401 records connection issue without push', async () => {
    const pushes: string[] = [];
    setNotifyImpl(async (p) => {
      pushes.push(`${p.kind}:${p.title}`);
    });

    const cfg = {
      ...defaultAppConfig(),
      auto_trade_enabled: false,
      assets_enabled: {
        WTI: true,
        Gold: false,
        Silver: false,
        BTC: false,
        ETH: false,
      },
    };

    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    }));

    const rt = new AppRuntime({
      getConfig: () => cfg,
      fetchImpl: fetchImpl as any,
    });

    await rt.tick();

    expect(rt.status.lastError).toMatch(/auth failed/i);
    expect(pushes).toHaveLength(0);
  });

  test('unexpected integration error still pushes', async () => {
    const pushes: string[] = [];
    setNotifyImpl(async (p) => {
      pushes.push(`${p.kind}:${p.title}`);
    });

    const cfg = {
      ...defaultAppConfig(),
      auto_trade_enabled: false,
      assets_enabled: {
        WTI: true,
        Gold: false,
        Silver: false,
        BTC: false,
        ETH: false,
      },
    };

    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    }));

    const rt = new AppRuntime({
      getConfig: () => cfg,
      fetchImpl: fetchImpl as any,
    });

    await rt.tick();

    expect(rt.status.lastError).toMatch(/http_500|price\/lean/i);
    expect(pushes.some((p) => p.startsWith('error:'))).toBe(true);
  });
});

import fs from 'fs';
import path from 'path';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../src/platform/storage';
import { saveCredentials } from '../src/services/credentials';
import { savePersistedConfig, loadPersistedConfig } from '../src/storage/configPersistence';
import { defaultAppConfig } from '../src/config/types';
import { normalizeAppConfig } from '../src/config/normalize';
import { AppRuntime } from '../src/runtime/AppRuntime';
import { setNotifyImpl } from '../src/services/notifications';
import { shouldPushAlert } from '../src/config/normalize';

function loadDotEnv(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

describe('persistence + credentials', () => {
  beforeEach(() => {
    setKeyValueStore(new MemoryKeyValueStore());
    setSecureStore(new MemoryKeyValueStore());
  });

  test('config round-trip', async () => {
    const cfg = normalizeAppConfig({
      ...defaultAppConfig(),
      auto_trade_enabled: true,
      execution_mode: 'live',
      poll_interval_seconds: 20,
      cushions: { ...defaultAppConfig().cushions, Gold: 8 },
    });
    await savePersistedConfig(cfg);
    const loaded = await loadPersistedConfig();
    expect(loaded.execution_mode).toBe('live');
    expect(loaded.auto_trade_enabled).toBe(true);
    expect(loaded.poll_interval_seconds).toBe(20);
    expect(loaded.cushions.Gold).toBe(8);
  });

  test('credentials save/load', async () => {
    await saveCredentials({
      keyId: 'abc',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
      env: 'production',
    });
    const { loadCredentials } = await import('../src/services/credentials');
    const c = await loadCredentials();
    expect(c?.keyId).toBe('abc');
  });
});

describe('mute matrix notifications', () => {
  test('muted kind does not notify', async () => {
    const calls: string[] = [];
    setNotifyImpl(async (p) => {
      calls.push(p.kind);
    });
    const cfg = defaultAppConfig();
    cfg.alert_prefs.lean_signal.push = false;
    expect(shouldPushAlert(cfg, 'lean_signal')).toBe(false);
    const { maybeNotify } = await import('../src/services/notifications');
    const sent = await maybeNotify(cfg, 'lean_signal', 't', 'b');
    expect(sent).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('AppRuntime auto-trade e2e (mocked lean + place)', () => {
  beforeEach(() => {
    setKeyValueStore(new MemoryKeyValueStore());
    setSecureStore(new MemoryKeyValueStore());
  });

  test('tick records lean alert + pending trade when gap clears cushion', async () => {
    const { generateKeyPairSync } = await import('crypto');
    const pem = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;
    await saveCredentials({ keyId: 'k', privateKeyPem: pem, env: 'production' });

    const now = new Date('2026-09-03T00:05:00.000Z');
    const fetchImpl = jest.fn(async (url: string, init?: any) => {
      const u = String(url);
      if (u.includes('/portfolio/orders') || (init?.method === 'POST' && u.includes('orders'))) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ order_id: 'ord-1', fill_count: '1.00' }),
          text: async () => '',
        };
      }
      if (u.includes('/events?')) {
        return {
          ok: true,
          json: async () => ({
            events: [
              {
                event_ticker: 'KXGOLD15M-EV',
                markets: [
                  {
                    ticker: 'KXGOLD15M-TEST',
                    open_time: '2026-09-03T00:00:00Z',
                    close_time: '2026-09-03T00:15:00Z',
                    floor_strike: 2600,
                  },
                ],
              },
            ],
          }),
        };
      }
      if (u.includes('/markets/')) {
        return {
          ok: true,
          json: async () => ({
            market: {
              floor_strike: 2600,
              yes_ask_dollars: '0.55',
              no_ask_dollars: '0.48',
            },
          }),
        };
      }
      if (u.includes('/live_data/')) {
        return {
          ok: true,
          json: async () => ({
            live_data: { details: { timeseries: [{ t: now.getTime(), v: 2610 }] } },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }) as any;

    const cfg = normalizeAppConfig({
      ...defaultAppConfig(),
      alerts_enabled: true,
      auto_trade_enabled: true,
      execution_mode: 'live',
      assets_enabled: {
        WTI: false,
        Gold: true,
        Silver: false,
        BTC: false,
        ETH: false,
      },
      cushions: { ...defaultAppConfig().cushions, Gold: 7 },
    });

    const RealDate = Date;
    global.Date = class extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0) super(now.toISOString());
        else super(...(args as [any]));
      }
      static now() {
        return now.getTime();
      }
    } as any;

    const notified: string[] = [];
    setNotifyImpl(async (p) => {
      notified.push(p.kind);
    });

    const rt = new AppRuntime({
      getConfig: () => cfg,
      fetchImpl,
    });

    await rt.tick();

    global.Date = RealDate;

    expect(rt.status.lastLeans.Gold?.decision).toBe('YES');
    expect(rt.alerts.list().length).toBeGreaterThan(0);
    expect(rt.trades.list().some((t) => t.outcome === 'pending' && !t.dry_run)).toBe(true);
    expect(notified).toContain('lean_signal');
    expect(notified).toContain('order_filled');
  });
});

describe('optional live credential path present', () => {
  test('robinhood .env has kalshi keys when available', () => {
    const envPath = path.resolve(
      'C:/Users/senth/OneDrive/Documents/RobinhoodTradingMCP/.env'
    );
    if (!fs.existsSync(envPath)) return;
    const env = loadDotEnv(envPath);
    expect(env.KALSHI_API_KEY_ID).toBeTruthy();
    expect(env.KALSHI_PRIVATE_KEY_PATH).toBeTruthy();
  });
});

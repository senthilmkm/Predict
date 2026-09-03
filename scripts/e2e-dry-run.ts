/**
 * End-to-end using Command Center Kalshi keys (.env) + configs.
 * Default: alerts-only lean tick (no orders). Pass --live-smoke for tiny IOC.
 */
import fs from 'fs';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../src/platform/storage';
import { saveCredentials } from '../src/services/credentials';
import { mergePredictTabConfig } from '../src/services/predictTabMerge';
import { AppRuntime } from '../src/runtime/AppRuntime';
import { setNotifyImpl } from '../src/services/notifications';
import { KalshiClient } from '../src/services/kalshi/client';
import { assertPemLooksValid } from '../src/services/kalshi/sign';
import { computeLean } from '../src/services/lean/lean';
import { normalizeAppConfig } from '../src/config/normalize';

const REPO = 'C:/Users/senth/OneDrive/Documents/RobinhoodTradingMCP';

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

function readJson(filePath: string): any {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

async function main() {
  const liveSmoke = process.argv.includes('--live-smoke');
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());

  const env = loadDotEnv(`${REPO}/.env`);
  const keyId = env.KALSHI_API_KEY_ID;
  const pemPath = env.KALSHI_PRIVATE_KEY_PATH;
  if (!keyId || !pemPath || !fs.existsSync(pemPath)) {
    console.log(JSON.stringify({ ok: false, error: 'missing_kalshi_keys' }, null, 2));
    process.exit(1);
  }
  const pem = fs.readFileSync(pemPath, 'utf8');
  assertPemLooksValid(pem);
  const predict = readJson(`${REPO}/.monitor-state/predict/config.json`);
  const kalshi = readJson(`${REPO}/.monitor-state/kalshi/config.json`);
  let cfg = mergePredictTabConfig(predict, kalshi);

  cfg = normalizeAppConfig({
    ...cfg,
    assets_enabled: { WTI: true, Gold: true, Silver: true, BTC: true, ETH: true },
    alerts_enabled: true,
    auto_trade_enabled: liveSmoke,
    execution_mode: liveSmoke ? 'live' : 'off',
  });

  await saveCredentials({
    keyId,
    privateKeyPem: pem,
    env: (env.KALSHI_API_ENV || 'production').toLowerCase() === 'demo' ? 'demo' : 'production',
  });

  const client = new KalshiClient(keyId, pem, 'production');
  const balance = await client.balance();
  const leanGold = await computeLean('Gold', cfg.cushions.Gold);

  const notifications: string[] = [];
  setNotifyImpl(async (p) => notifications.push(`${p.kind}:${p.title}`));

  const rt = new AppRuntime({ getConfig: () => cfg });
  await rt.refreshClient();
  await rt.tick();

  let smoke: unknown = null;
  if (liveSmoke) {
    smoke = await client.smokeTestDryRun('Gold');
    const m = (smoke as any)?.market;
    if (m) {
      smoke = {
        dry: smoke,
        live: await client.placeOrder({
          ticker: m.ticker,
          side: 'bid',
          count: '1.00',
          price: '0.0100',
          exchange_index: m.exchange_index != null ? Number(m.exchange_index) : 0,
          dry_run: false,
          client_order_id: `fs-e2e-${Date.now()}`,
        }),
      };
    }
  }

  const out = {
    ok: Boolean(balance.ok),
    source: 'Command Center (.env + predict/kalshi config.json)',
    key_id_suffix: keyId.slice(-4),
    balance_usd: balance.balance_usd,
    foresight_mode: cfg.auto_trade_enabled ? 'auto-trade' : 'alerts-only',
    poll_interval_seconds: cfg.poll_interval_seconds,
    lean_gold: {
      ok: leanGold.ok,
      phase: leanGold.phase,
      decision: leanGold.decision,
      gap: leanGold.abs_gap,
      ticker: leanGold.market_ticker,
    },
    runtime: {
      error: rt.status.lastError,
      trades: rt.trades.list(10).map((t) => ({
        asset: t.asset,
        outcome: t.outcome,
      })),
      alerts: rt.alerts.list(10).map((a) => a.title),
      notifications,
    },
    live_smoke: smoke,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

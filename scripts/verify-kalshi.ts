/**
 * Live Kalshi API connectivity check using the TS client.
 * Loads credentials from RobinhoodTradingMCP/.env — dry-run only by default.
 *
 *   npx tsx scripts/verify-kalshi.ts
 *   npx tsx scripts/verify-kalshi.ts --live-smoke   # tiny $0.01 IOC (may spend ~1¢)
 */
import fs from 'fs';
import path from 'path';
import { KalshiClient, KalshiEnv } from '../src/services/kalshi/client';

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

function findEnv(): { env: Record<string, string>; path: string | null } {
  const candidates = [
    path.resolve(__dirname, '../../../RobinhoodTradingMCP/.env'),
    path.resolve('C:/Users/senth/OneDrive/Documents/RobinhoodTradingMCP/.env'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { env: loadDotEnv(c), path: c };
  }
  return { env: {}, path: null };
}

async function main() {
  const liveSmoke = process.argv.includes('--live-smoke');
  const { env, path: envPath } = findEnv();
  const keyId = env.KALSHI_API_KEY_ID || process.env.KALSHI_API_KEY_ID;
  const pemPath = env.KALSHI_PRIVATE_KEY_PATH || process.env.KALSHI_PRIVATE_KEY_PATH;
  const apiEnv = (
    env.KALSHI_API_ENV ||
    process.env.KALSHI_API_ENV ||
    'production'
  ).toLowerCase() as KalshiEnv | string;

  if (!keyId || !pemPath || !fs.existsSync(pemPath)) {
    console.log(
      JSON.stringify({ ok: false, error: 'missing_credentials', envPath, pemPath }, null, 2)
    );
    process.exit(1);
  }

  const pem = fs.readFileSync(pemPath, 'utf8');
  const client = new KalshiClient(
    keyId,
    pem,
    apiEnv === 'demo' ? 'demo' : 'production'
  );

  const balance = await client.balance();
  const assets = ['Gold', 'WTI', 'Silver', 'BTC', 'ETH'] as const;
  const smoke: Record<string, unknown> = {};
  for (const a of assets) {
    const r = await client.smokeTestDryRun(a);
    smoke[a] = {
      ok: r.ok,
      error: r.error ?? null,
      ticker: r.market?.ticker ?? null,
      exchange_index: r.market?.exchange_index ?? null,
      dry_run_payload: r.place?.payload ?? null,
    };
  }

  let live: unknown = null;
  if (liveSmoke) {
    const gold = await client.smokeTestDryRun('Gold');
    if (gold.market) {
      live = await client.placeOrder({
        ticker: gold.market.ticker,
        side: 'bid',
        count: '1.00',
        price: '0.0100',
        exchange_index:
          gold.market.exchange_index != null
            ? Number(gold.market.exchange_index)
            : 0,
        dry_run: false,
        client_order_id: `fs-verify-${Date.now()}`,
      });
    } else {
      live = { ok: false, error: 'no_open_market' };
    }
  }

  const allSmokeOk = assets.every((a) => (smoke[a] as { ok: boolean }).ok);
  const out = {
    ok: Boolean(balance.ok) && allSmokeOk,
    env: apiEnv,
    envPath,
    balance: {
      ok: balance.ok,
      http_status: balance.http_status,
      balance_usd: balance.balance_usd,
      shards: balance.balance_by_exchange_index,
    },
    smoke_dry_run: smoke,
    live_smoke: live,
    note: liveSmoke
      ? 'live-smoke: tiny IOC @ $0.01 — usually no fill; 201 = place path OK'
      : 'dry-run only; pass --live-smoke for tiny real IOC',
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

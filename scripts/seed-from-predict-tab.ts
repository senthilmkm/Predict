/**
 * Load Kalshi keys + cushions from Command Center Predict / Kalshi tab sources
 * (.env + .monitor-state/predict/config.json + kalshi/config.json).
 *
 *   npx tsx scripts/seed-from-predict-tab.ts
 */
import fs from 'fs';
import {
  MemoryKeyValueStore,
  setKeyValueStore,
  setSecureStore,
} from '../src/platform/storage';
import { saveCredentials, loadCredentials } from '../src/services/credentials';
import { mergePredictTabConfig } from '../src/services/predictTabMerge';
import { savePersistedConfig } from '../src/storage/configPersistence';
import { KalshiClient } from '../src/services/kalshi/client';
import { assertPemLooksValid } from '../src/services/kalshi/sign';

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
  setKeyValueStore(new MemoryKeyValueStore());
  setSecureStore(new MemoryKeyValueStore());

  const env = loadDotEnv(`${REPO}/.env`);
  const keyId = env.KALSHI_API_KEY_ID;
  const pemPath = env.KALSHI_PRIVATE_KEY_PATH;
  const apiEnv = env.KALSHI_API_ENV || 'production';
  if (!keyId || !pemPath || !fs.existsSync(pemPath)) {
    console.log(JSON.stringify({ ok: false, error: 'missing_predict_tab_credentials' }, null, 2));
    process.exit(1);
  }
  const pem = fs.readFileSync(pemPath, 'utf8');
  assertPemLooksValid(pem);

  const predict = readJson(`${REPO}/.monitor-state/predict/config.json`);
  const kalshi = readJson(`${REPO}/.monitor-state/kalshi/config.json`);

  const cfg = mergePredictTabConfig(predict, kalshi);
  await saveCredentials({
    keyId,
    privateKeyPem: pem,
    env: apiEnv.toLowerCase() === 'demo' ? 'demo' : 'production',
  });
  await savePersistedConfig(cfg);

  const stored = await loadCredentials();
  const client = new KalshiClient(stored!.keyId, stored!.privateKeyPem, stored!.env);
  const bal = await client.balance();

  // Public (non-secret) snapshot for app defaults / UI tests
  const publicPath = `${__dirname}/../src/generated/predict-tab-public.json`;
  fs.mkdirSync(`${__dirname}/../src/generated`, { recursive: true });
  fs.writeFileSync(
    publicPath,
    JSON.stringify(
      {
        source: 'Command Center Predict + Kalshi tabs',
        updated_at: new Date().toISOString(),
        key_id_suffix: keyId.slice(-4),
        api_env: apiEnv,
        cushions: cfg.cushions,
        risk: cfg.risk,
        assets_enabled: cfg.assets_enabled,
        desktop_execution_mode: kalshi.execution_mode,
        desktop_trade_enabled: kalshi.kalshi_trade_enabled,
        foresight_execution_mode: cfg.execution_mode,
        max_entry_ask_usd: kalshi.max_entry_ask_usd ?? 0.9,
        min_minutes_left: kalshi.min_minutes_left ?? 2,
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        ok: bal.ok,
        key_id_suffix: keyId.slice(-4),
        pem_path: pemPath,
        balance_usd: bal.balance_usd,
        foresight_config: {
          execution_mode: cfg.execution_mode,
          auto_trade_enabled: cfg.auto_trade_enabled,
          cushions: cfg.cushions,
          risk: cfg.risk,
        },
        public_snapshot: publicPath,
        note: 'Credentials + cushions loaded from Command Center .env / config. Enable Auto-trade in app Settings (Face ID) to place orders.',
      },
      null,
      2
    )
  );
  process.exit(bal.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

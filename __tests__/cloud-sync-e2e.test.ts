import { AppRuntime } from '../src/runtime/AppRuntime';
import { defaultAppConfig } from '../src/config/types';
import { MemoryTradeRepo, cloudTradesToRecords } from '../src/storage/repos';
import { MemoryKeyValueStore, setKeyValueStore, setSecureStore } from '../src/platform/storage';
import { persistPortfolioSamples } from '../src/storage/portfolioPersistence';
import { PORTFOLIO_LOOKBACK_MS } from '../src/services/portfolioChange';
import { resetRuntimeStoreForTests, useRuntimeStore } from '../src/state/runtimeStore';
import { useConfigStore } from '../src/state/configStore';

describe('iOS ↔ Cloud trade wiring', () => {
  beforeEach(() => {
    setKeyValueStore(new MemoryKeyValueStore());
    setSecureStore(new MemoryKeyValueStore());
    resetRuntimeStoreForTests();
    useConfigStore.setState({ config: defaultAppConfig(), hydrated: true });
  });

  test('GET /me/trades payload maps orderId, payPrice, pnl and does not invent wins', () => {
    const rows = cloudTradesToRecords([
      {
        tradeId: 'trade_cloud_1',
        ticker: 'KXBTC15M-WIN',
        asset: 'BTC',
        decision: 'YES',
        count: '10',
        price: '0.60',
        payPrice: 0.6,
        fillCount: 10,
        notionalUsd: 6,
        dryRun: false,
        status: 'SETTLED',
        pnlUsd: 4,
        outcome: 'win',
        orderId: 'ord-kalshi-1',
        executedAt: new Date().toISOString(),
      },
      {
        tradeId: 'trade_cloud_2',
        ticker: 'KXETH15M-OPEN',
        asset: 'ETH',
        decision: 'NO',
        count: '5',
        price: '0.55',
        payPrice: 0.45,
        fillCount: 5,
        status: 'FILLED',
        orderId: 'ord-kalshi-2',
        executedAt: new Date().toISOString(),
      },
    ]);
    expect(rows[0].order_id).toBe('ord-kalshi-1');
    expect(rows[0].fill_price).toBe(0.6);
    expect(rows[0].pnl_usd).toBe(4);
    expect(rows[0].outcome).toBe('win');
    expect(rows[1].fill_price).toBe(0.45);
    expect(rows[1].outcome).toBe('pending');
    expect(rows[1].pnl_usd).toBeNull();
  });

  test('cloud sync + local settle record merge to one today P&L', () => {
    const rt = new AppRuntime({ getConfig: () => defaultAppConfig() });
    const at = new Date().toISOString();
    rt.trades.insert({
      id: 'local-1',
      at,
      asset: 'BTC',
      market_ticker: 'KXBTC15M-WIN',
      side: 'YES',
      notional_usd: 6,
      fill_price: 0.6,
      fill_count: 10,
      pnl_usd: 4,
      outcome: 'win',
      dry_run: false,
      order_id: 'ord-kalshi-1',
    });
    rt.syncCloudTrades([
      {
        tradeId: 'trade_cloud_1',
        ticker: 'KXBTC15M-WIN',
        asset: 'BTC',
        decision: 'YES',
        payPrice: 0.6,
        fillCount: 10,
        status: 'FILLED',
        outcome: 'pending',
        orderId: 'ord-kalshi-1',
        executedAt: new Date(Date.parse(at) + 4000).toISOString(),
      },
      {
        tradeId: 'trade_cloud_1',
        ticker: 'KXBTC15M-WIN',
        asset: 'BTC',
        decision: 'YES',
        payPrice: 0.6,
        fillCount: 10,
        status: 'SETTLED',
        pnlUsd: 4,
        outcome: 'win',
        orderId: 'ord-kalshi-1',
        executedAt: new Date(Date.parse(at) + 4000).toISOString(),
      },
    ]);
    expect(rt.trades.list()).toHaveLength(1);
    expect(rt.trades.statsToday().realized_pnl_usd).toBe(4);
    expect(rt.trades.statsToday().wins).toBe(1);
  });

  test('malformed cloud rows do not crash sync or inflate P&L', () => {
    const repo = new MemoryTradeRepo();
    const rows = cloudTradesToRecords([
      null,
      {},
      { tradeId: 'x', status: 'SETTLED', executedAt: 'not-a-date' },
      { tradeId: 'y', status: 'FILLED', count: 'nope', price: 'abc', executedAt: new Date().toISOString() },
    ] as any);
    expect(rows).toHaveLength(3);
    for (const r of rows) repo.upsert(r);
    expect(Number.isFinite(repo.statsToday().realized_pnl_usd)).toBe(true);
    expect(repo.statsToday().realized_pnl_usd).toBe(0);
  });

  test('runtime store shows today zeros after hydrate with only old trades', () => {
    const rt = useRuntimeStore.getState().ensure();
    rt.trades.insert({
      id: 'old',
      at: '2026-09-01T12:00:00.000Z',
      asset: 'BTC',
      market_ticker: 'KXBTC15M-OLD',
      side: 'YES',
      notional_usd: 5,
      fill_price: 0.5,
      fill_count: 10,
      pnl_usd: 8.85,
      outcome: 'win',
      dry_run: false,
    });
    useRuntimeStore.getState().syncFromRuntime();
    expect(useRuntimeStore.getState().stats.realized_pnl_usd).toBe(0);
    expect(useRuntimeStore.getState().stats.wins).toBe(0);
  });

  test('Change (24h) hydrates from stored samples after balance exists', async () => {
    const now = Date.now();
    await persistPortfolioSamples([
      {
        at: new Date(now - PORTFOLIO_LOOKBACK_MS).toISOString(),
        predictionsUsd: 139.3,
        cashUsd: 100,
      },
    ]);
    const fetchImpl = jest.fn(async (url: string) => {
      if (String(url).includes('/portfolio/balance')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ balance_dollars: '101.18', portfolio_value: 3930 }),
          text: async () => '',
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }) as any;

    const { generateKeyPairSync } = await import('crypto');
    const pem = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;
    const { saveCredentials } = await import('../src/services/credentials');
    await saveCredentials({ keyId: 'k', privateKeyPem: pem, env: 'production' });

    const rt = new AppRuntime({ getConfig: () => defaultAppConfig(), fetchImpl });
    await rt.hydrateHistory();
    await rt.refreshPredictionsBalance();
    expect(rt.status.predictionsBalanceUsd).toBe(140.48);
    expect(rt.status.change24hUsd).toBe(1.18);
    expect(rt.status.change24hPct).toBe(0.85);
  });
});

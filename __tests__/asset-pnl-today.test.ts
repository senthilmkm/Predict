import { MemoryTradeRepo, TradeRecord, cloudTradesToRecords, statsFromCloudTrades } from '../src/storage/repos';
import {
  classifyClosedPnl,
  formatDayPayFooter,
  formatPayRange,
  resolvePayUsd,
  summarizeAssetPnlToday,
} from '../src/storage/assetPnlToday';

const NOW = new Date('2026-09-09T21:00:00.000Z');
const TODAY = '2026-09-09T16:00:00.000Z';
const YESTERDAY = '2026-09-08T16:00:00.000Z';

function rec(over: Partial<TradeRecord>): TradeRecord {
  return {
    id: over.id || `t-${Math.random().toString(16).slice(2)}`,
    at: over.at || TODAY,
    asset: over.asset || 'BTC',
    market_ticker: over.market_ticker || 'KXBTC15M-X',
    side: over.side || 'YES',
    notional_usd: over.notional_usd ?? 4.6,
    fill_price: over.fill_price ?? 0.92,
    fill_count: over.fill_count ?? 5,
    pnl_usd: over.pnl_usd ?? 0.4,
    outcome: over.outcome || 'win',
    dry_run: over.dry_run ?? false,
    order_id: over.order_id ?? null,
  };
}

describe('resolvePayUsd', () => {
  test('uses dollars and converts cents; rejects junk', () => {
    expect(resolvePayUsd(0.92)).toBe(0.92);
    expect(resolvePayUsd(92)).toBe(0.92);
    expect(resolvePayUsd(0)).toBeNull();
    expect(resolvePayUsd(-0.1)).toBeNull();
    expect(resolvePayUsd(1.5)).toBeNull();
    expect(resolvePayUsd('nope')).toBeNull();
  });
});

describe('summarizeAssetPnlToday', () => {
  test('matches Closed P&L and ignores misses, dry-run, and yesterday', () => {
    const trades = [
      rec({ id: 's1', asset: 'Silver', outcome: 'loss', pnl_usd: -4.6, fill_price: 0.92 }),
      rec({ id: 's2', asset: 'Silver', outcome: 'loss', pnl_usd: -4.25, fill_price: 0.85 }),
      rec({ id: 's3', asset: 'Silver', outcome: 'loss', pnl_usd: -4.6, fill_price: 0.92 }),
      rec({ id: 's4', asset: 'Silver', outcome: 'loss', pnl_usd: -0.92, fill_price: 0.92 }),
      rec({ id: 's5', asset: 'Silver', outcome: 'win', pnl_usd: 0.4, fill_price: 0.92 }),
      rec({ id: 's6', asset: 'Silver', outcome: 'win', pnl_usd: 0.4, fill_price: 0.92 }),
      rec({ id: 's7', asset: 'Silver', outcome: 'win', pnl_usd: 0.2, fill_price: 0.92 }),
      rec({ id: 'g1', asset: 'Gold', outcome: 'loss', pnl_usd: -4.35, fill_price: 0.87 }),
      rec({ id: 'g2', asset: 'Gold', outcome: 'loss', pnl_usd: -4.3, fill_price: 0.86 }),
      rec({ id: 'g3', asset: 'Gold', outcome: 'win', pnl_usd: 0.45, fill_price: 0.91 }),
      rec({ id: 'g4', asset: 'Gold', outcome: 'win', pnl_usd: 0.45, fill_price: 0.91 }),
      rec({ id: 'g5', asset: 'Gold', outcome: 'win', pnl_usd: 0.7, fill_price: 0.86 }),
      rec({ id: 'g6', asset: 'Gold', outcome: 'win', pnl_usd: 0.45, fill_price: 0.91 }),
      rec({ id: 'b1', asset: 'BTC', outcome: 'win', pnl_usd: 7.34, fill_price: 0.88 }),
      rec({ id: 'c1', asset: 'COPPER', outcome: 'win', pnl_usd: 5.74, fill_price: 0.91 }),
      rec({ id: 'e1', asset: 'ETH', outcome: 'win', pnl_usd: 1.6, fill_price: 0.89 }),
      rec({ id: 'w1', asset: 'WTI', outcome: 'win', pnl_usd: 1.65, fill_price: 0.92 }),
      rec({ id: 'miss', asset: 'COPPER', outcome: 'miss', pnl_usd: 0, fill_price: 0.92 }),
      rec({ id: 'dry', asset: 'Gold', outcome: 'win', pnl_usd: 9, dry_run: true }),
      rec({ id: 'old', asset: 'Silver', at: YESTERDAY, outcome: 'loss', pnl_usd: -20, fill_price: 0.9 }),
    ];

    const repo = new MemoryTradeRepo();
    for (const t of trades) repo.insert(t);
    const stats = repo.statsToday(NOW);
    const summary = summarizeAssetPnlToday(repo.all(), NOW);

    expect(summary.wins).toBe(stats.wins);
    expect(summary.losses).toBe(stats.losses);
    expect(summary.realized_pnl_usd).toBe(stats.realized_pnl_usd);
    expect(summary.realized_pnl_usd).toBe(-3.64);
    expect(summary.wins).toBe(11);
    expect(summary.losses).toBe(6);

    expect(summary.rows.map((r) => r.asset)).toEqual(['Silver', 'Gold', 'ETH', 'WTI', 'COPPER', 'BTC']);
    expect(summary.rows[0]).toMatchObject({ asset: 'Silver', wins: 3, losses: 4, realized_pnl_usd: -13.37 });
    expect(summary.rows[1]).toMatchObject({ asset: 'Gold', wins: 4, losses: 2, realized_pnl_usd: -6.6 });
    expect(formatPayRange(summary.rows[0].lossPayMin, summary.rows[0].lossPayMax)).toBe('$0.85–$0.92');
    expect(formatPayRange(summary.rows[1].lossPayMin, summary.rows[1].lossPayMax)).toBe('$0.86–$0.87');
    expect(formatPayRange(summary.lossPayMin, summary.lossPayMax)).toBe('$0.85–$0.92');
    expect(formatDayPayFooter(summary)).toContain('Losses paid $0.85–$0.92');
  });

  test('protect-sell exited uses P&L sign; payPrice wins over opposite-side quote', () => {
    const cloud = [
      {
        tradeId: 'ex1',
        executedAt: TODAY,
        asset: 'Gold',
        decision: 'NO',
        price: 0.13,
        payPrice: 0.87,
        count: 5,
        notionalUsd: 4.35,
        pnlUsd: -4.35,
        outcome: 'exited',
        dryRun: false,
      },
      {
        tradeId: 'ex2',
        executedAt: TODAY,
        asset: 'Gold',
        decision: 'YES',
        price: 0.91,
        payPrice: 0.91,
        count: 5,
        notionalUsd: 4.55,
        pnlUsd: 0.45,
        outcome: 'exited',
        dryRun: false,
      },
    ];
    const records = cloudTradesToRecords(cloud);
    expect(records[0].fill_price).toBe(0.87);
    expect(classifyClosedPnl(records[0])).toBe('loss');
    expect(classifyClosedPnl(records[1])).toBe('win');

    const summary = summarizeAssetPnlToday(records, NOW);
    const stats = statsFromCloudTrades(cloud, NOW);
    expect(summary.wins).toBe(stats.wins);
    expect(summary.losses).toBe(stats.losses);
    expect(summary.realized_pnl_usd).toBe(stats.realized_pnl_usd);
    expect(summary.rows[0].asset).toBe('Gold');
    expect(summary.rows[0].losses).toBe(1);
    expect(summary.rows[0].wins).toBe(1);
    expect(summary.lossPayMin).toBe(0.87);
    expect(summary.lossPayMax).toBe(0.87);
  });

  test('empty today is empty, not yesterday leftovers', () => {
    const summary = summarizeAssetPnlToday(
      [rec({ at: YESTERDAY, asset: 'BTC', outcome: 'win', pnl_usd: 5 })],
      NOW
    );
    expect(summary.rows).toEqual([]);
    expect(summary.realized_pnl_usd).toBe(0);
    expect(formatDayPayFooter(summary)).toBeNull();
  });
});

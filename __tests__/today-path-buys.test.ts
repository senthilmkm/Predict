import { TradeRecord } from '../src/storage/repos';
import {
  formatDashboardPathBuys,
  formatHomePathBuyLines,
  summarizeTodayPathBuys,
} from '../src/storage/todayPathBuys';
import { entryPathChipLabel, formatHistoryTradeSubline } from '../src/history/tradeDisplay';

const NOW = new Date('2026-09-10T18:00:00.000Z');
const TODAY = '2026-09-10T16:00:00.000Z';
const YESTERDAY = '2026-09-09T16:00:00.000Z';

function rec(over: Partial<TradeRecord>): TradeRecord {
  return {
    id: over.id || `t-${Math.random().toString(16).slice(2)}`,
    at: over.at || TODAY,
    asset: over.asset || 'BTC',
    market_ticker: over.market_ticker || 'KXBTC15M-X',
    side: over.side || 'YES',
    notional_usd: over.notional_usd ?? 4.6,
    fill_price: over.fill_price ?? 0.55,
    fill_count: over.fill_count ?? 5,
    pnl_usd: over.pnl_usd ?? null,
    outcome: over.outcome || 'pending',
    dry_run: over.dry_run ?? false,
    order_id: over.order_id ?? null,
    entry_path: over.entry_path,
  };
}

describe('summarizeTodayPathBuys', () => {
  test('splits filled Home vs Auto buys by asset and hides zeros / unknown / non-buys', () => {
    const summary = summarizeTodayPathBuys(
      [
        rec({ id: 'h1', asset: 'BTC', entry_path: 'home' }),
        rec({ id: 'h2', asset: 'BTC', entry_path: 'home' }),
        rec({ id: 'h3', asset: 'Gold', entry_path: 'home' }),
        rec({ id: 'a1', asset: 'ETH', entry_path: 'auto' }),
        rec({ id: 'legacy', asset: 'WTI', entry_path: null }),
        rec({ id: 'miss', asset: 'BTC', entry_path: 'home', outcome: 'miss', fill_count: 0 }),
        rec({ id: 'dry', asset: 'Gold', entry_path: 'auto', dry_run: true }),
        rec({ id: 'old', asset: 'BTC', entry_path: 'home', at: YESTERDAY }),
        rec({ id: 'exited-home', asset: 'Gold', entry_path: 'home', outcome: 'exited', fill_count: 3 }),
      ],
      NOW
    );

    expect(summary.home).toEqual([
      { asset: 'BTC', count: 2 },
      { asset: 'Gold', count: 2 },
    ]);
    expect(summary.auto).toEqual([{ asset: 'ETH', count: 1 }]);
    expect(summary.homeTotal).toBe(4);
    expect(summary.autoTotal).toBe(1);
    expect(formatHomePathBuyLines(summary)).toEqual(['Home  BTC 2 · Gold 2', 'Auto  ETH 1']);
    expect(formatDashboardPathBuys(summary)).toBe('Home 4 · Auto 1');
  });

  test('hides a path at 0 and the whole strip when none count', () => {
    const autoOnly = summarizeTodayPathBuys([rec({ asset: 'ETH', entry_path: 'auto' })], NOW);
    expect(formatHomePathBuyLines(autoOnly)).toEqual(['Auto  ETH 1']);
    expect(formatDashboardPathBuys(autoOnly)).toBe('Auto 1');

    const empty = summarizeTodayPathBuys(
      [
        rec({ entry_path: 'home', outcome: 'miss', fill_count: 0 }),
        rec({ entry_path: undefined as any }),
      ],
      NOW
    );
    expect(formatHomePathBuyLines(empty)).toEqual([]);
    expect(formatDashboardPathBuys(empty)).toBeNull();
  });

  test('maps manual_buy / worker aliases and never labels Manual', () => {
    const summary = summarizeTodayPathBuys(
      [
        rec({ id: 'm', asset: 'BTC', entry_path: 'manual_buy' as any }),
        rec({ id: 'w', asset: 'ETH', entry_path: 'worker' as any }),
      ],
      NOW
    );
    expect(formatHomePathBuyLines(summary)).toEqual(['Home  BTC 1', 'Auto  ETH 1']);
    expect(formatHomePathBuyLines(summary).join(' ')).not.toMatch(/Manual/i);
  });
});

describe('history trade display', () => {
  test('chip is Home / Auto or omitted', () => {
    expect(entryPathChipLabel('home')).toBe('Home');
    expect(entryPathChipLabel('auto')).toBe('Auto');
    expect(entryPathChipLabel('manual_buy')).toBe('Home');
    expect(entryPathChipLabel(null)).toBeNull();
    expect(entryPathChipLabel(undefined)).toBeNull();
  });

  test('subline shows contracts at fill price then cost', () => {
    expect(
      formatHistoryTradeSubline({
        market_ticker: 'KXBTC15M-X',
        fill_count: 5,
        fill_price: 0.55,
        notional_usd: 4.6,
        pnl_usd: 0.4,
      })
    ).toBe('KXBTC15M-X · 5 ctr @ $0.55 · cost $4.60 · P&L $0.40');
    expect(
      formatHistoryTradeSubline({
        market_ticker: 'KXETH15M-X',
        fill_count: 2,
        notional_usd: 1.1,
      })
    ).toBe('KXETH15M-X · 2 ctr · cost $1.10');
  });
});

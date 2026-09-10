import { filterAlerts, filterTrades, tradeAssetFilterOptions } from '../src/history/filters';
import { AlertRecord, MemoryTradeRepo, TradeRecord } from '../src/storage/repos';
import {
  computeTradePnlUsd,
  inferFillCount,
  isReadyToSettle,
  settleFromMarket,
  settlePendingTrades,
} from '../src/services/settlement';
import { KalshiClient } from '../src/services/kalshi/client';

function alert(over: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: over.id || 'a1',
    at: over.at || '2026-09-03T12:00:00.000Z',
    kind: over.kind || 'lean_signal',
    title: over.title || 't',
    body: over.body || 'b',
    read: over.read ?? false,
  };
}

function trade(over: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: over.id || 't1',
    at: over.at || '2026-09-03T10:00:00.000Z',
    asset: over.asset || 'BTC',
    market_ticker: over.market_ticker || 'KXBTC15M-TEST',
    side: over.side || 'YES',
    notional_usd: over.notional_usd ?? 5,
    fill_price: over.fill_price ?? 0.5,
    fill_count: over.fill_count ?? 10,
    pnl_usd: over.pnl_usd ?? null,
    outcome: over.outcome || 'pending',
    dry_run: over.dry_run ?? false,
    order_id: over.order_id ?? 'ord-1',
  };
}

describe('History filters', () => {
  const alerts: AlertRecord[] = [
    alert({ id: '1', kind: 'lean_signal', read: false }),
    alert({ id: '2', kind: 'order_placed', read: true }),
    alert({ id: '3', kind: 'ioc_miss', read: false }),
    alert({ id: '4', kind: 'trade_result', read: true }),
    alert({ id: '5', kind: 'error', read: false }),
    alert({ id: '6', kind: 'order_filled', read: true }),
    alert({ id: '7', kind: 'daily_loss_stop', read: false }),
    alert({ id: '8', kind: 'protect_sell', read: true }),
  ];

  const trades: TradeRecord[] = [
    trade({ id: 'p1', outcome: 'pending', side: 'YES', asset: 'BTC' }),
    trade({ id: 'p2', outcome: 'pending', side: 'NO', asset: 'Gold' }),
    trade({ id: 'w1', outcome: 'win', side: 'YES', asset: 'BTC', pnl_usd: 2 }),
    trade({ id: 'l1', outcome: 'loss', side: 'NO', asset: 'ETH', pnl_usd: -3 }),
    trade({ id: 'm1', outcome: 'miss', side: 'YES', asset: 'WTI', fill_count: 0 }),
    trade({ id: 'e1', outcome: 'exited', side: 'YES', asset: 'BTC', pnl_usd: -1 }),
  ];

  test('alert filters cover every kind + unread', () => {
    expect(filterAlerts(alerts, 'all')).toHaveLength(8);
    expect(filterAlerts(alerts, 'unread').map((a) => a.id)).toEqual(['1', '3', '5', '7']);
    expect(filterAlerts(alerts, 'lean_signal').map((a) => a.id)).toEqual(['1']);
    expect(filterAlerts(alerts, 'order_placed').map((a) => a.id)).toEqual(['2']);
    expect(filterAlerts(alerts, 'order_filled').map((a) => a.id)).toEqual(['6']);
    expect(filterAlerts(alerts, 'ioc_miss').map((a) => a.id)).toEqual(['3']);
    expect(filterAlerts(alerts, 'trade_result').map((a) => a.id)).toEqual(['4']);
    expect(filterAlerts(alerts, 'protect_sell').map((a) => a.id)).toEqual(['8']);
    expect(filterAlerts(alerts, 'daily_loss_stop').map((a) => a.id)).toEqual(['7']);
    expect(filterAlerts(alerts, 'error').map((a) => a.id)).toEqual(['5']);
  });

  test('trade filters by outcome, side, asset', () => {
    expect(filterTrades(trades, { status: 'all', side: 'all', asset: 'all' })).toHaveLength(6);
    expect(filterTrades(trades, { status: 'pending' }).map((t) => t.id).sort()).toEqual(['p1', 'p2']);
    expect(filterTrades(trades, { status: 'win' }).map((t) => t.id)).toEqual(['w1']);
    expect(filterTrades(trades, { status: 'loss' }).map((t) => t.id)).toEqual(['l1']);
    expect(filterTrades(trades, { status: 'miss' }).map((t) => t.id)).toEqual(['m1']);
    expect(filterTrades(trades, { status: 'exited' }).map((t) => t.id)).toEqual(['e1']);
    expect(filterTrades(trades, { status: 'all', side: 'YES' }).map((t) => t.id).sort()).toEqual([
      'e1',
      'm1',
      'p1',
      'w1',
    ]);
    expect(filterTrades(trades, { status: 'all', side: 'NO' }).map((t) => t.id).sort()).toEqual(['l1', 'p2']);
    expect(filterTrades(trades, { status: 'all', asset: 'BTC' }).map((t) => t.id).sort()).toEqual([
      'e1',
      'p1',
      'w1',
    ]);
    expect(filterTrades(trades, { status: 'all', asset: 'Gold' }).map((t) => t.id)).toEqual(['p2']);
    expect(filterTrades(trades, { status: 'all', asset: 'ETH' }).map((t) => t.id)).toEqual(['l1']);
    expect(filterTrades(trades, { status: 'all', asset: 'WTI' }).map((t) => t.id)).toEqual(['m1']);
    expect(filterTrades(trades, { status: 'all', asset: 'Silver' })).toHaveLength(0);
  });

  test('trade filters AND across status, side, and asset', () => {
    expect(
      filterTrades(trades, { status: 'pending', side: 'YES', asset: 'BTC' }).map((t) => t.id)
    ).toEqual(['p1']);
    expect(filterTrades(trades, { status: 'pending', side: 'YES', asset: 'Gold' })).toHaveLength(0);
    expect(filterTrades(trades, { status: 'win', side: 'NO', asset: 'all' })).toHaveLength(0);
    expect(filterTrades(trades, { status: 'pending', side: 'NO', asset: 'Gold' }).map((t) => t.id)).toEqual([
      'p2',
    ]);
  });

  test('trade filters default to pending and ignore bad input', () => {
    expect(filterTrades(trades, null).map((t) => t.id).sort()).toEqual(['p1', 'p2']);
    expect(filterTrades(trades, { status: 'bogus' as any }).map((t) => t.id).sort()).toEqual(['p1', 'p2']);
    expect(filterTrades(null as any, { status: 'all' })).toEqual([]);
    expect(filterTrades(undefined, { status: 'all' })).toEqual([]);
    expect(
      filterTrades([null as any, trades[0], { id: 'x' } as any], { status: 'pending', side: 'all', asset: 'all' }).map(
        (t) => t.id
      )
    ).toEqual(['p1']);
  });

  test('asset dropdown lists All, catalog keys, and extra trade assets', () => {
    const opts = tradeAssetFilterOptions([
      trade({ id: 'p1', asset: 'BTC' }),
      trade({ id: 'z1', asset: 'ZZZTEST' }),
    ]);
    expect(opts[0]).toEqual({ id: 'all', label: 'All' });
    expect(opts.map((o) => o.id)).toEqual(expect.arrayContaining(['BTC', 'Gold', 'NG', 'ZZZTEST']));
    expect(opts.filter((o) => o.id === 'ZZZTEST')).toHaveLength(1);
  });
});

describe('settlement', () => {
  test('PnL win/loss math', () => {
    expect(
      computeTradePnlUsd({ side: 'YES', payPrice: 0.6, fillCount: 10, marketResult: 'yes' })
    ).toBe(4);
    expect(
      computeTradePnlUsd({ side: 'YES', payPrice: 0.6, fillCount: 10, marketResult: 'no' })
    ).toBe(-6);
    expect(
      computeTradePnlUsd({ side: 'NO', payPrice: 0.4, fillCount: 5, marketResult: 'no' })
    ).toBe(3);
  });

  test('settleFromMarket maps result to outcome', () => {
    const t = trade({ side: 'YES', fill_price: 0.5, fill_count: 4 });
    expect(settleFromMarket(t, { result: 'yes' })).toEqual({ outcome: 'win', pnl_usd: 2 });
    expect(settleFromMarket(t, { result: 'no' })).toEqual({ outcome: 'loss', pnl_usd: -2 });
    expect(settleFromMarket(t, { status: 'open' })).toBeNull();
  });

  test('inferFillCount falls back from notional/pay', () => {
    expect(inferFillCount(trade({ fill_count: null, fill_price: 0.5, notional_usd: 5 }))).toBe(10);
    expect(inferFillCount(trade({ fill_count: 0 }))).toBe(0);
  });

  test('isReadyToSettle after 90s', () => {
    const now = new Date('2026-09-03T12:02:00.000Z');
    expect(
      isReadyToSettle(trade({ at: '2026-09-03T12:01:00.000Z' }), now)
    ).toBe(false);
    expect(
      isReadyToSettle(trade({ at: '2026-09-03T12:00:00.000Z' }), now)
    ).toBe(true);
  });

  test('settlePendingTrades updates repo via getMarket', async () => {
    const repo = new MemoryTradeRepo();
    repo.insert(
      trade({
        id: 'old',
        at: '2026-09-03T10:00:00.000Z',
        outcome: 'pending',
        side: 'YES',
        fill_price: 0.5,
        fill_count: 2,
        market_ticker: 'KXBTC15M-DONE',
      })
    );
    const client = {
      getMarket: async (ticker: string) =>
        ticker === 'KXBTC15M-DONE' ? { status: 'finalized', result: 'yes' } : null,
    } as unknown as KalshiClient;

    const r = await settlePendingTrades(repo, client, new Date('2026-09-03T12:00:00.000Z'));
    expect(r.settled).toBe(1);
    expect(repo.list()[0].outcome).toBe('win');
    expect(repo.list()[0].pnl_usd).toBe(1);
    expect(repo.pendingFilled()).toHaveLength(0);
  });
});

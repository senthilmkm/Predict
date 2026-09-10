import { MemoryTradeRepo, TradeRecord, cloudTradesToRecords, isSameTradeRecord } from '../src/storage/repos';

function trade(over: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: over.id || 'local-1',
    at: over.at || '2026-09-07T14:00:00.000Z',
    asset: over.asset || 'BTC',
    market_ticker: over.market_ticker || 'KXBTC15M-TEST',
    side: over.side || 'YES',
    notional_usd: over.notional_usd ?? 5,
    fill_price: over.fill_price ?? 0.5,
    fill_count: over.fill_count ?? 10,
    pnl_usd: over.pnl_usd ?? 5,
    outcome: over.outcome || 'win',
    dry_run: over.dry_run ?? false,
    order_id: over.order_id === undefined ? 'ord-kalshi-1' : over.order_id,
    entry_path: over.entry_path,
  };
}

describe('trade dedupe', () => {
  test('matches on Kalshi order_id even when ids and timestamps differ', () => {
    expect(
      isSameTradeRecord(
        trade({ id: 'local-1', at: '2026-09-07T14:00:00.000Z', order_id: 'ord-1' }),
        trade({ id: 'trade_cloud', at: '2026-09-07T14:00:08.000Z', order_id: 'ord-1' })
      )
    ).toBe(true);
  });

  test('different Kalshi order ids never merge even on the same ticker', () => {
    expect(
      isSameTradeRecord(
        trade({ id: 'a', order_id: 'ord-1', at: '2026-09-07T14:00:00.000Z' }),
        trade({ id: 'b', order_id: 'ord-2', at: '2026-09-07T14:00:01.000Z' })
      )
    ).toBe(false);
  });

  test('opposite sides on the same ticker are different trades', () => {
    expect(
      isSameTradeRecord(
        trade({ id: 'a', order_id: null, side: 'YES' }),
        trade({ id: 'b', order_id: null, side: 'NO' })
      )
    ).toBe(false);
  });

  test('same ticker more than 3 minutes apart does not merge', () => {
    expect(
      isSameTradeRecord(
        trade({ id: 'a', order_id: null, at: '2026-09-07T14:00:00.000Z' }),
        trade({ id: 'b', order_id: null, at: '2026-09-07T14:04:00.000Z' })
      )
    ).toBe(false);
  });

  test('matches same ticker+side within 3 minutes', () => {
    expect(
      isSameTradeRecord(
        trade({ id: 'a', order_id: null, at: '2026-09-07T14:00:00.000Z' }),
        trade({ id: 'b', order_id: 'other', at: '2026-09-07T14:02:00.000Z' })
      )
    ).toBe(true);
  });

  test('upsert keeps local settled P&L when cloud row is still pending', () => {
    const repo = new MemoryTradeRepo();
    repo.insert(trade({ id: 'local-1', pnl_usd: 5, outcome: 'win', order_id: 'ord-1' }));
    repo.upsert(
      trade({
        id: 'trade_cloud',
        order_id: 'ord-1',
        at: '2026-09-07T14:00:09.000Z',
        outcome: 'pending',
        pnl_usd: null,
        fill_count: 1,
      })
    );
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0].id).toBe('local-1');
    expect(repo.list()[0].outcome).toBe('win');
    expect(repo.list()[0].pnl_usd).toBe(5);
    expect(repo.list()[0].fill_count).toBe(10);
  });

  test('upsert keeps Home/Auto path when a later patch omits it', () => {
    const repo = new MemoryTradeRepo();
    repo.insert(trade({ id: 'local-1', entry_path: 'home', outcome: 'pending', pnl_usd: null }));
    repo.upsert(
      trade({
        id: 'trade_cloud',
        order_id: 'ord-kalshi-1',
        outcome: 'exited',
        pnl_usd: -1,
        entry_path: undefined,
      })
    );
    expect(repo.list()[0].entry_path).toBe('home');
    expect(repo.list()[0].outcome).toBe('exited');
  });

  test('statsToday does not double-count a cloud+local pair', () => {
    const repo = new MemoryTradeRepo();
    const at = new Date().toISOString();
    repo.insert(trade({ id: 'local-1', at, pnl_usd: 4, outcome: 'win', order_id: 'ord-9' }));
    repo.upsert(
      trade({ id: 'cloud-1', at, pnl_usd: 4, outcome: 'win', order_id: 'ord-9' })
    );
    expect(repo.statsToday().realized_pnl_usd).toBe(4);
    expect(repo.statsToday().wins).toBe(1);
  });
});

describe('cloudTradesToRecords', () => {
  test('uses economic payPrice and does not invent a win without pnl', () => {
    const [row] = cloudTradesToRecords([
      {
        tradeId: 't1',
        ticker: 'KXBTC15M-TEST',
        asset: 'BTC',
        decision: 'NO',
        price: '0.60',
        payPrice: 0.4,
        count: '5',
        status: 'SETTLED',
        executedAt: '2026-09-07T14:00:00.000Z',
        orderId: 'ord-2',
      },
    ]);
    expect(row.fill_price).toBe(0.4);
    expect(row.fill_count).toBe(5);
    expect(row.outcome).toBe('pending');
    expect(row.order_id).toBe('ord-2');
  });

  test('maps settled pnl to win/loss', () => {
    const [win] = cloudTradesToRecords([
      {
        tradeId: 't2',
        ticker: 'KXBTC15M-TEST',
        decision: 'YES',
        payPrice: 0.6,
        count: '10',
        status: 'SETTLED',
        pnlUsd: 4,
        outcome: 'win',
        executedAt: '2026-09-07T14:00:00.000Z',
      },
    ]);
    expect(win.outcome).toBe('win');
    expect(win.pnl_usd).toBe(4);
  });
});

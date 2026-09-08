import { MemoryTradeRepo, TradeRecord } from '../src/storage/repos';

function trade(over: Partial<TradeRecord>): TradeRecord {
  return {
    id: over.id || 't',
    at: over.at || new Date().toISOString(),
    asset: over.asset || 'BTC',
    market_ticker: over.market_ticker || 'KXBTC15M-X',
    side: over.side || 'YES',
    notional_usd: over.notional_usd ?? 5,
    fill_price: 0.5,
    fill_count: 10,
    pnl_usd: over.pnl_usd ?? 0,
    outcome: over.outcome || 'win',
    dry_run: over.dry_run ?? false,
    order_id: over.order_id ?? null,
  };
}

describe('daily loss stop input is ET-today only', () => {
  test('lifetime profit does not hide a losing today', () => {
    const repo = new MemoryTradeRepo();
    repo.insert(
      trade({
        id: 'old',
        at: '2026-09-01T15:00:00.000Z',
        outcome: 'win',
        pnl_usd: 80,
      })
    );
    repo.insert(
      trade({
        id: 'today-loss',
        at: new Date().toISOString(),
        outcome: 'loss',
        pnl_usd: -50,
      })
    );
    expect(repo.stats().realized_pnl_usd).toBe(30);
    expect(repo.statsToday().realized_pnl_usd).toBe(-50);
    expect(repo.statsToday().losses).toBe(1);
    expect(repo.statsToday().wins).toBe(0);
  });

  test('new ET day with no fills is zero, not yesterday leftover', () => {
    const repo = new MemoryTradeRepo();
    repo.insert(
      trade({
        id: 'yest',
        at: '2026-09-01T15:00:00.000Z',
        outcome: 'win',
        pnl_usd: 8.85,
      })
    );
    const s = repo.statsToday(new Date('2026-09-07T17:00:00.000Z'));
    expect(s.realized_pnl_usd).toBe(0);
    expect(s.wins + s.losses + s.pending).toBe(0);
  });

  test('pending fills do not add dollars', () => {
    const repo = new MemoryTradeRepo();
    repo.insert(
      trade({
        id: 'p',
        at: new Date().toISOString(),
        outcome: 'pending',
        pnl_usd: null,
        fill_count: 4,
      })
    );
    expect(repo.statsToday().realized_pnl_usd).toBe(0);
    expect(repo.statsToday().pending).toBe(1);
  });
});

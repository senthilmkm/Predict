import {
  computeOverviewTradeMetrics,
  isLiveFilledTrade,
  workerHealthStatus,
  parseTradeStreamQuery,
  buildTradeStreamResult,
  tradeMatchesFilters,
  tradeStreamEntryLabel,
  tradeStreamSellPriceUsd,
} from '../services/adminMetrics';
import { TradeRecordDoc } from '../services/firestore';

function trade(partial: Partial<TradeRecordDoc> & Pick<TradeRecordDoc, 'tradeId' | 'status'>): TradeRecordDoc {
  return {
    userId: 'u1',
    ticker: 'KXGOLD15M',
    asset: 'Gold',
    decision: 'YES',
    count: '1',
    price: '0.50',
    notionalUsd: 5,
    dryRun: false,
    executedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('admin overview metrics', () => {
  test('volume and filled ignore IOC misses and dry-runs', () => {
    const now = Date.now();
    const rows = [
      trade({ tradeId: 'a', status: 'FILLED', fillCount: 2, notionalUsd: 3 }),
      trade({ tradeId: 'b', status: 'SETTLED', fillCount: 1, notionalUsd: 4, outcome: 'win' }),
      trade({
        tradeId: 'c',
        status: 'CANCELLED',
        fillCount: 0,
        outcome: 'miss',
        notionalUsd: 99,
      }),
      trade({ tradeId: 'd', status: 'FILLED', dryRun: true, fillCount: 1, notionalUsd: 50 }),
      trade({ tradeId: 'e', status: 'CANCELLED', fillCount: 2, notionalUsd: 1.1 }),
    ];
    const m = computeOverviewTradeMetrics(rows, now);
    expect(m.trades24hCount).toBe(4);
    expect(m.filled24hCount).toBe(3);
    expect(m.missed24hCount).toBe(1);
    expect(m.volumeUsd24h).toBe(8.1);
    expect(isLiveFilledTrade(rows[2])).toBe(false);
    expect(isLiveFilledTrade(rows[4])).toBe(true);
  });

  test('worker health uses stale timeout', () => {
    expect(workerHealthStatus(undefined, 120)).toBe('IDLE');
    expect(workerHealthStatus(new Date().toISOString(), 120)).toBe('ACTIVE');
    expect(workerHealthStatus(new Date(Date.now() - 200_000).toISOString(), 120)).toBe('STALE');
  });

  test('trade stream filters and realized P&L use the full match set', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    const rows = [
      trade({
        tradeId: 'gold-open',
        status: 'FILLED',
        asset: 'Gold',
        userId: 'usr_aaa',
        executedAt: '2026-09-08T11:00:00.000Z',
      }),
      trade({
        tradeId: 'btc-win',
        status: 'SETTLED',
        asset: 'BTC',
        userId: 'usr_aaa',
        outcome: 'win',
        pnlUsd: 4.35,
        executedAt: '2026-09-08T11:30:00.000Z',
      }),
      trade({
        tradeId: 'eth-loss',
        status: 'SETTLED',
        asset: 'ETH',
        userId: 'usr_bbb',
        outcome: 'loss',
        pnlUsd: -1.1,
        executedAt: '2026-09-07T18:00:00.000Z',
      }),
      trade({
        tradeId: 'btc-dry',
        status: 'SETTLED',
        asset: 'BTC',
        userId: 'usr_aaa',
        outcome: 'win',
        pnlUsd: 99,
        dryRun: true,
        executedAt: '2026-09-08T11:45:00.000Z',
      }),
    ];

    const btc = buildTradeStreamResult(rows, { asset: 'BTC' }, 200);
    expect(btc.matchedCount).toBe(2);
    expect(btc.totalPnlUsd).toBe(4.35);

    const userSearch = buildTradeStreamResult(rows, { userId: 'BBB' }, 200);
    expect(userSearch.matchedCount).toBe(1);
    expect(userSearch.trades[0].tradeId).toBe('eth-loss');
    expect(userSearch.totalPnlUsd).toBe(-1.1);

    const settled = buildTradeStreamResult(rows, { status: 'SETTLED' }, 200);
    expect(settled.matchedCount).toBe(3);
    expect(settled.totalPnlUsd).toBe(3.25);

    const day = buildTradeStreamResult(
      rows,
      { fromMs: Date.parse('2026-09-08T00:00:00.000Z'), toMs: Date.parse('2026-09-08T23:59:59.999Z') },
      200
    );
    expect(day.matchedCount).toBe(3);
    expect(day.totalPnlUsd).toBe(4.35);

    const truncated = buildTradeStreamResult(rows, {}, 1);
    expect(truncated.truncated).toBe(true);
    expect(truncated.displayedCount).toBe(1);
    expect(truncated.matchedCount).toBe(4);
    expect(truncated.totalPnlUsd).toBe(3.25);
    expect(truncated.trades[0].executedAt >= rows[1].executedAt).toBe(true);

    expect(tradeMatchesFilters(rows[0], { asset: 'Gold' })).toBe(true);
    expect(now.toISOString()).toContain('2026-09-08');
  });

  test('trade stream entry path labels and filter', () => {
    expect(tradeStreamEntryLabel('home')).toBe('Home');
    expect(tradeStreamEntryLabel('manual_buy')).toBe('Home');
    expect(tradeStreamEntryLabel('auto')).toBe('Auto');
    expect(tradeStreamEntryLabel('cash_out')).toBe('Cash out');
    expect(tradeStreamEntryLabel('gold_fade')).toBe('Gold fade');
    expect(tradeStreamEntryLabel('twap_lock')).toBe('TWAP lock');
    expect(tradeStreamEntryLabel('last_minute')).toBe('Last-minute');
    expect(tradeStreamEntryLabel('step_buy')).toBe('Step buy');
    expect(tradeStreamEntryLabel(undefined)).toBe('—');
    expect(tradeStreamEntryLabel('other')).toBe('—');

    const rows = [
      trade({ tradeId: 'h', status: 'FILLED', entryPath: 'home' }),
      trade({ tradeId: 'a', status: 'FILLED', entryPath: 'auto' }),
      trade({ tradeId: 'c', status: 'FILLED', entryPath: 'cash_out' }),
      trade({ tradeId: 'legacy', status: 'FILLED' }),
    ];
    const cash = buildTradeStreamResult(rows, { entryPath: 'cash_out' }, 200);
    expect(cash.matchedCount).toBe(1);
    expect(cash.trades[0].tradeId).toBe('c');
    expect(tradeMatchesFilters(rows[3], { entryPath: 'home' })).toBe(false);
  });

  test('cash out sell price uses stored exit, else derives from P&L', () => {
    expect(
      tradeStreamSellPriceUsd(
        trade({
          tradeId: 'stored',
          status: 'SETTLED',
          entryPath: 'cash_out',
          outcome: 'exited',
          exitPayPrice: 0.86,
          payPrice: 0.82,
          fillCount: 6,
          pnlUsd: 0.24,
        })
      )
    ).toBe(0.86);
    expect(
      tradeStreamSellPriceUsd(
        trade({
          tradeId: 'derived',
          status: 'SETTLED',
          entryPath: 'cash_out',
          outcome: 'exited',
          payPrice: 0.82,
          fillCount: 6,
          pnlUsd: 0.24,
        })
      )
    ).toBe(0.86);
    expect(
      tradeStreamSellPriceUsd(
        trade({
          tradeId: 'open',
          status: 'FILLED',
          entryPath: 'cash_out',
          payPrice: 0.82,
          fillCount: 6,
        })
      )
    ).toBeNull();
    expect(
      tradeStreamSellPriceUsd(
        trade({
          tradeId: 'home',
          status: 'SETTLED',
          entryPath: 'home',
          outcome: 'win',
          payPrice: 0.82,
          fillCount: 6,
          pnlUsd: 1.08,
        })
      )
    ).toBeNull();
  });

  test('parseTradeStreamQuery clamps limit and date-only bounds', () => {
    const q = parseTradeStreamQuery({
      asset: 'BTC',
      status: 'all',
      userId: ' usr_x ',
      entryPath: 'cash_out',
      from: '2026-09-01',
      to: '2026-09-08',
      limit: '9999',
    });
    expect(q.asset).toBe('BTC');
    expect(q.status).toBeUndefined();
    expect(q.entryPath).toBe('cash_out');
    expect(q.userId).toBe('usr_x');
    expect(q.fromMs).toBe(Date.parse('2026-09-01T00:00:00.000Z'));
    expect(q.toMs).toBe(Date.parse('2026-09-08T23:59:59.999Z'));
    expect(q.limit).toBe(500);
  });
});

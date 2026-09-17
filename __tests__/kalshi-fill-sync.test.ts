import {
  assetKeyFromMarketTicker,
  parseKalshiFills,
  planKalshiFillSync,
} from '../packages/trading-core/src/kalshiFillSync';

describe('Kalshi fill sync', () => {
  test('parseKalshiFills reads buy YES/NO and skips empty count', () => {
    const fills = parseKalshiFills({
      fills: [
        {
          fill_id: 'f1',
          order_id: 'ord-yes',
          ticker: 'KXBTC15M-A',
          side: 'yes',
          action: 'buy',
          count: '1',
          yes_price: '0.52',
          created_time: '2026-09-15T12:00:00Z',
        },
        {
          fill_id: 'f2',
          order_id: 'ord-no',
          ticker: 'KXBTC15M-A',
          side: 'no',
          action: 'buy',
          count: 1,
          yes_price: 0.48,
          created_time: '2026-09-15T12:00:01Z',
        },
        {
          fill_id: 'f3',
          order_id: 'ord-sell',
          ticker: 'KXBTC15M-A',
          side: 'yes',
          action: 'sell',
          count: 1,
          yes_price: 0.6,
        },
        { fill_id: 'f4', ticker: 'KXBTC15M-A', count: 0 },
      ],
    });
    expect(fills.filter((f) => f.action === 'buy').map((f) => f.orderId)).toEqual(['ord-yes', 'ord-no']);
    expect(fills.find((f) => f.orderId === 'ord-no')?.side).toBe('NO');
  });

  test('planKalshiFillSync creates missing Pair lock legs and upgrades a miss with the same order id', () => {
    const fills = parseKalshiFills({
      fills: [
        {
          order_id: 'ord-yes',
          ticker: 'KXBTC15M-A',
          side: 'yes',
          action: 'buy',
          count: 1,
          yes_price: 0.52,
          created_time: '2026-09-15T12:00:00Z',
        },
        {
          order_id: 'ord-no',
          ticker: 'KXBTC15M-A',
          side: 'no',
          action: 'buy',
          count: 1,
          yes_price: 0.47,
          created_time: '2026-09-15T12:00:01Z',
        },
        {
          order_id: 'ord-miss',
          ticker: 'KXETH15M-B',
          side: 'yes',
          action: 'buy',
          count: 2,
          yes_price: 0.4,
        },
      ],
    });
    const plan = planKalshiFillSync({
      fills,
      existing: [
        {
          tradeId: 't_miss',
          orderId: 'ord-miss',
          ticker: 'KXETH15M-B',
          decision: 'YES',
          fillCount: 0,
          outcome: 'miss',
          status: 'CANCELLED',
          entryPath: 'auto',
        },
      ],
      nowIso: '2026-09-15T12:01:00Z',
    });
    expect(plan.create).toHaveLength(2);
    expect(plan.create.map((c) => c.entryPath).sort()).toEqual(['pair_lock', 'pair_lock_hedge']);
    expect(plan.create.find((c) => c.decision === 'NO')?.payPrice).toBe(0.53);
    expect(plan.upgrade).toEqual([
      expect.objectContaining({
        tradeId: 't_miss',
        fillCount: 2,
        payPrice: 0.4,
        orderId: 'ord-miss',
      }),
    ]);
  });

  test('assetKeyFromMarketTicker maps 15m and hourly series', () => {
    expect(assetKeyFromMarketTicker('KXBTC15M-26SEP15-T111')).toBe('BTC');
    expect(assetKeyFromMarketTicker('KXBTCD-26SEP1406-T67099.99')).toBe('BTC');
    expect(assetKeyFromMarketTicker('KXETHD-26SEP1817-T4500')).toBe('ETH');
  });
});

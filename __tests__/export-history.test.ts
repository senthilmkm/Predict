import { buildHistoryWorkbook } from '../src/services/exportHistory';

describe('exportHistory', () => {
  test('builds xlsx workbook bytes', () => {
    const bytes = buildHistoryWorkbook(
      [
        {
          id: '1',
          at: '2026-09-03T12:00:00.000Z',
          asset: 'Gold',
          market_ticker: 'KXGOLD15M-TEST',
          side: 'YES',
          notional_usd: 5,
          outcome: 'pending',
          dry_run: false,
          order_id: 'o1',
        },
      ],
      [
        {
          id: 'a1',
          at: '2026-09-03T12:00:01.000Z',
          kind: 'lean_signal',
          title: 'Gold YES',
          body: 'gap',
          read: false,
        },
      ]
    );
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});

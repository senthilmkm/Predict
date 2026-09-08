import { etDateKey, isEtToday } from '../util/time';
import { computeTradePnlUsd, economicPayPrice, fillCountOf } from '../services/settlement';

describe('ET day key', () => {
  test('uses America/New_York not UTC slice', () => {
    // 1:30am UTC on Sep 8 = 9:30pm ET on Sep 7
    const lateEt = new Date('2026-09-08T01:30:00.000Z');
    expect(etDateKey(lateEt)).toBe('2026-09-07');
    expect(lateEt.toISOString().slice(0, 10)).toBe('2026-09-08');
    expect(isEtToday('2026-09-08T01:10:00.000Z', lateEt)).toBe(true);
  });
});

describe('cloud settlement math', () => {
  test('matches phone win/loss formula', () => {
    expect(
      computeTradePnlUsd({ side: 'YES', payPrice: 0.6, fillCount: 10, marketResult: 'yes' })
    ).toBe(4);
    expect(
      computeTradePnlUsd({ side: 'NO', payPrice: 0.4, fillCount: 5, marketResult: 'no' })
    ).toBe(3);
  });

  test('prefers economic payPrice over YES-contract quote', () => {
    expect(
      economicPayPrice({
        tradeId: 't',
        userId: 'u',
        ticker: 'X',
        asset: 'BTC',
        decision: 'NO',
        count: '5',
        price: '0.60',
        notionalUsd: 2,
        dryRun: false,
        status: 'FILLED',
        executedAt: new Date().toISOString(),
        payPrice: 0.4,
        fillCount: 5,
      })
    ).toBe(0.4);
    expect(
      fillCountOf({
        tradeId: 't',
        userId: 'u',
        ticker: 'X',
        asset: 'BTC',
        decision: 'YES',
        count: '10',
        price: '0.50',
        notionalUsd: 5,
        dryRun: false,
        status: 'FILLED',
        executedAt: new Date().toISOString(),
        fillCount: 10,
      })
    ).toBe(10);
  });
});

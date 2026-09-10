import {
  extractKalshiOrderFields,
  isGoodTillCanceled,
  placeFillLooksComplete,
  resolvedPlaceFillCount,
} from '../packages/trading-core/src/orderFill';

describe('Kalshi order fill confirm helpers', () => {
  test('reads nested order payloads', () => {
    const fields = extractKalshiOrderFields({
      order: {
        order_id: 'ord-nested',
        fill_count: '0',
        remaining_count: '8',
        status: 'resting',
      },
    });
    expect(fields.order_id).toBe('ord-nested');
    expect(fields.fill_count).toBe('0');
    expect(placeFillLooksComplete(fields)).toBe(false);
  });

  test('complete fill does not need a follow-up GET', () => {
    const fields = extractKalshiOrderFields({
      order_id: 'ord-1',
      fill_count: '5.00',
      remaining_count: '0',
      status: 'executed',
    });
    expect(placeFillLooksComplete(fields)).toBe(true);
  });

  test('live zero fill is a miss, not the intended count', () => {
    expect(
      resolvedPlaceFillCount({ dryRun: false, fillCount: '0', intendedCount: '8' })
    ).toEqual({ fillCount: 0, filled: false });
    expect(
      resolvedPlaceFillCount({ dryRun: false, fillCount: null, intendedCount: '8' })
    ).toEqual({ fillCount: 0, filled: false });
  });

  test('dry-run uses intended count', () => {
    expect(
      resolvedPlaceFillCount({ dryRun: true, fillCount: null, intendedCount: '8' })
    ).toEqual({ fillCount: 8, filled: true });
  });

  test('GTC tif detection', () => {
    expect(isGoodTillCanceled('good_till_canceled')).toBe(true);
    expect(isGoodTillCanceled('immediate_or_cancel')).toBe(false);
  });
});

import {
  cfbAssetsDueForIngest,
  CFB_INGEST_MIN_MS,
  markCfbIngested,
  resetCfbIngestGateForTests,
} from '../services/cfbRti';
import { isTickHeld, releaseTick, resetTickGateForTests, tryAcquireTick } from '../services/tickGate';

describe('tick gate', () => {
  beforeEach(() => resetTickGateForTests());

  test('overlapping /tick does not start a second minute', () => {
    expect(tryAcquireTick()).toBe(true);
    expect(isTickHeld()).toBe(true);
    expect(tryAcquireTick()).toBe(false);
    releaseTick();
    expect(tryAcquireTick()).toBe(true);
  });
});

describe('CFB ingest gate', () => {
  beforeEach(() => resetCfbIngestGateForTests());

  test('same coin is not due again until the min interval', () => {
    const t0 = 1_000_000;
    expect(cfbAssetsDueForIngest(['BTC', 'ETH', 'Gold'], t0)).toEqual(['BTC', 'ETH', 'Gold']);
    markCfbIngested('BTC', t0);
    expect(cfbAssetsDueForIngest(['BTC', 'ETH'], t0 + 1_000)).toEqual(['ETH']);
    expect(cfbAssetsDueForIngest(['BTC'], t0 + CFB_INGEST_MIN_MS)).toEqual(['BTC']);
  });
});

import {
  DEFAULT_MAINTENANCE_MESSAGE,
  mergeBroadcastConfig,
  normalizeBroadcastConfig,
  resolveActiveBroadcast,
} from '../services/broadcast';
import { mergeFeatureFlags, normalizeFeatureFlags } from '../services/featureFlags';
import {
  normalizeSystemConfig,
  resetSystemConfigCacheForTests,
} from '../services/firestore';
import { resetPlaceLocksForTests, tryAcquirePlaceLock, releasePlaceLock } from '../services/placeLock';

describe('feature flags', () => {
  test('defaults lastSignalsManualTrade on', () => {
    expect(normalizeFeatureFlags(null).lastSignalsManualTrade).toBe(true);
    expect(normalizeFeatureFlags({}).lastSignalsManualTrade).toBe(true);
    expect(normalizeFeatureFlags({ lastSignalsManualTrade: false }).lastSignalsManualTrade).toBe(false);
    expect(normalizeFeatureFlags(null).cashOut).toBe(false);
    expect(normalizeFeatureFlags(null).goldFade).toBe(false);
    expect(normalizeFeatureFlags(null).twapLock).toBe(false);
    expect(normalizeFeatureFlags(null).lastMinute).toBe(false);
    expect(normalizeFeatureFlags(null).stepBuy).toBe(false);
    expect(normalizeFeatureFlags({}).cashOutBidCheckSeconds).toBe(3);
    expect(normalizeFeatureFlags({ cashOut: true, cashOutBidCheckSeconds: 1 }).cashOut).toBe(true);
    expect(normalizeFeatureFlags({ cashOutBidCheckSeconds: 1 }).cashOutBidCheckSeconds).toBe(2);
    expect(normalizeFeatureFlags({ goldFade: true, goldFadeBidCheckSeconds: 1 }).goldFade).toBe(true);
    expect(normalizeFeatureFlags({ goldFadeBidCheckSeconds: 1 }).goldFadeBidCheckSeconds).toBe(2);
    expect(normalizeFeatureFlags({ twapLock: true }).twapLock).toBe(true);
    expect(normalizeFeatureFlags({ lastMinute: true }).lastMinute).toBe(true);
    expect(normalizeFeatureFlags({ stepBuy: true }).stepBuy).toBe(true);
    const keepCash = mergeFeatureFlags(
      { cashOut: true },
      { goldFade: true, twapLock: true, lastMinute: true, stepBuy: true }
    );
    expect(keepCash.cashOut).toBe(true);
    expect(keepCash.goldFade).toBe(true);
    expect(keepCash.twapLock).toBe(true);
    expect(keepCash.lastMinute).toBe(true);
    expect(keepCash.stepBuy).toBe(true);
  });

  test('merge does not flip unspecified flags off', () => {
    const merged = mergeFeatureFlags({ lastSignalsManualTrade: false }, {});
    expect(merged.lastSignalsManualTrade).toBe(false);
    expect(mergeFeatureFlags({ lastSignalsManualTrade: false }, { lastSignalsManualTrade: true }).lastSignalsManualTrade).toBe(
      true
    );
  });
});

describe('broadcast', () => {
  test('defaults include System maintenance hidden', () => {
    const cfg = normalizeBroadcastConfig(null);
    expect(cfg.templates[0].id).toBe('system_maintenance');
    expect(cfg.templates[0].show).toBe(false);
    expect(cfg.templates[0].message).toBe(DEFAULT_MAINTENANCE_MESSAGE);
    expect(resolveActiveBroadcast(cfg)).toBeNull();
  });

  test('show checkbox and until time', () => {
    const shown = normalizeBroadcastConfig({
      templates: [
        {
          id: 'system_maintenance',
          title: 'System maintenance',
          message: 'Down for a bit.',
          show: true,
          showUntil: '2099-01-01T00:00:00.000Z',
        },
      ],
    });
    const active = resolveActiveBroadcast(shown, Date.parse('2026-09-10T12:00:00.000Z'));
    expect(active?.message).toBe('Down for a bit.');

    const expired = resolveActiveBroadcast(shown, Date.parse('2099-01-02T00:00:00.000Z'));
    expect(expired).toBeNull();

    const hidden = mergeBroadcastConfig(shown, {
      templates: [{ id: 'system_maintenance', show: false } as any],
    });
    expect(resolveActiveBroadcast(hidden)).toBeNull();
  });

  test('invalid until is treated as no end', () => {
    const cfg = normalizeBroadcastConfig({
      templates: [{ id: 'system_maintenance', show: true, showUntil: 'not-a-date', message: 'Hi' } as any],
    });
    expect(cfg.templates[0].showUntil).toBeNull();
    expect(resolveActiveBroadcast(cfg)?.message).toBe('Hi');
  });
});

describe('systemConfig nested merge', () => {
  beforeEach(() => {
    resetSystemConfigCacheForTests();
  });

  test('normalize keeps tick/purge/retry when flags+broadcast present', () => {
    const cfg = normalizeSystemConfig({
      tick_interval_seconds: 15,
      featureFlags: {
        lastSignalsManualTrade: false,
        cashOut: false,
        cashOutBidCheckSeconds: 3,
        goldFade: false,
        goldFadeBidCheckSeconds: 3,
        twapLock: false,
        lastMinute: false,
        stepBuy: false,
      },
      broadcast: { templates: [{ id: 'system_maintenance', show: true, message: 'Hi' } as any] },
    });
    expect(cfg.tick_interval_seconds).toBe(15);
    expect(cfg.purge?.audit.enabled).toBe(true);
    expect(cfg.kalshiRetry?.maxRetries).toBeGreaterThanOrEqual(0);
    expect(cfg.featureFlags?.lastSignalsManualTrade).toBe(false);
    expect(resolveActiveBroadcast(cfg.broadcast)?.message).toBe('Hi');
  });
});

describe('place lock races', () => {
  beforeEach(() => {
    resetPlaceLocksForTests();
  });

  test('existingBuys at cap refuses without taking a slot', async () => {
    const first = await tryAcquirePlaceLock({
      userId: 'u1',
      ticker: 'T1',
      cap: 1,
      requestId: 'a',
      existingBuys: 1,
    });
    expect(first).toEqual({ ok: false, reason: 'max_trades_asset_window' });
    const second = await tryAcquirePlaceLock({
      userId: 'u1',
      ticker: 'T1',
      cap: 1,
      requestId: 'b',
      existingBuys: 0,
    });
    expect(second.ok).toBe(true);
    await releasePlaceLock({ userId: 'u1', ticker: 'T1', requestId: 'b' });
  });

  test('same requestId is idempotent', async () => {
    const a = await tryAcquirePlaceLock({
      userId: 'u1',
      ticker: 'T2',
      cap: 1,
      requestId: 'same',
      existingBuys: 0,
    });
    const b = await tryAcquirePlaceLock({
      userId: 'u1',
      ticker: 'T2',
      cap: 1,
      requestId: 'same',
      existingBuys: 0,
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    await releasePlaceLock({ userId: 'u1', ticker: 'T2', requestId: 'same' });
  });
});

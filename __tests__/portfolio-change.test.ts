import {
  computeChange24h,
  findBaselineSample,
  latestPortfolioSample,
  prunePortfolioSamples,
  recordPortfolioSample,
  PORTFOLIO_LOOKBACK_MS,
  PORTFOLIO_MAX_SAMPLES,
  PORTFOLIO_SAMPLE_INTERVAL_MS,
} from '../src/services/portfolioChange';
import { loadPortfolioSamples, persistPortfolioSamples } from '../src/storage/portfolioPersistence';
import { MemoryKeyValueStore, setKeyValueStore } from '../src/platform/storage';

describe('portfolio 24h change', () => {
  const t0 = Date.parse('2026-09-07T17:00:00.000Z');

  test('returns null without a sample near T-24h', () => {
    const samples = recordPortfolioSample([], {
      at: new Date(t0).toISOString(),
      predictionsUsd: 140.48,
      cashUsd: 100,
    }, t0);
    expect(computeChange24h(samples, 141.66, t0)).toBeNull();
  });

  test('matches Kalshi-style delta vs sample from 24h ago', () => {
    const ago = t0 - PORTFOLIO_LOOKBACK_MS;
    const samples = [
      { at: new Date(ago).toISOString(), predictionsUsd: 139.3, cashUsd: 100 },
      { at: new Date(t0).toISOString(), predictionsUsd: 140.48, cashUsd: 101 },
    ];
    expect(computeChange24h(samples, 140.48, t0)).toEqual({
      usd: 1.18,
      pct: 0.85,
      windowMs: PORTFOLIO_LOOKBACK_MS,
      complete: true,
    });
  });

  test('prefers last sample at or before T-24h', () => {
    const target = t0 - PORTFOLIO_LOOKBACK_MS;
    const samples = [
      { at: new Date(target - 10 * 60 * 1000).toISOString(), predictionsUsd: 100, cashUsd: 80 },
      { at: new Date(target - 60 * 1000).toISOString(), predictionsUsd: 110, cashUsd: 80 },
      { at: new Date(target + 5 * 60 * 1000).toISOString(), predictionsUsd: 200, cashUsd: 80 },
    ];
    expect(findBaselineSample(samples, target)?.predictionsUsd).toBe(110);
  });

  test('skips duplicate samples inside the interval unless value moved', () => {
    const a = { at: new Date(t0).toISOString(), predictionsUsd: 100, cashUsd: 90 };
    const b = {
      at: new Date(t0 + PORTFOLIO_SAMPLE_INTERVAL_MS / 2).toISOString(),
      predictionsUsd: 100,
      cashUsd: 90,
    };
    const c = {
      at: new Date(t0 + PORTFOLIO_SAMPLE_INTERVAL_MS / 2).toISOString(),
      predictionsUsd: 108,
      cashUsd: 90,
    };
    expect(recordPortfolioSample([a], b, t0 + PORTFOLIO_SAMPLE_INTERVAL_MS).length).toBe(1);
    expect(recordPortfolioSample([a], c, t0 + PORTFOLIO_SAMPLE_INTERVAL_MS).length).toBe(2);
  });

  test('returns null for current balance missing or non-finite', () => {
    const ago = t0 - PORTFOLIO_LOOKBACK_MS;
    const samples = [{ at: new Date(ago).toISOString(), predictionsUsd: 100, cashUsd: 80 }];
    expect(computeChange24h(samples, null, t0)).toBeNull();
    expect(computeChange24h(samples, Number.NaN, t0)).toBeNull();
  });

  test('pct is null when baseline is zero (no fake percent)', () => {
    const ago = t0 - PORTFOLIO_LOOKBACK_MS;
    const samples = [{ at: new Date(ago).toISOString(), predictionsUsd: 0, cashUsd: 0 }];
    expect(computeChange24h(samples, 10, t0)).toEqual({
      usd: 10,
      pct: null,
      windowMs: PORTFOLIO_LOOKBACK_MS,
      complete: true,
    });
  });

  test('negative 24h change', () => {
    const ago = t0 - PORTFOLIO_LOOKBACK_MS;
    const samples = [{ at: new Date(ago).toISOString(), predictionsUsd: 200, cashUsd: 100 }];
    expect(computeChange24h(samples, 180, t0)).toEqual({
      usd: -20,
      pct: -10,
      windowMs: PORTFOLIO_LOOKBACK_MS,
      complete: true,
    });
  });

  test('falls back to the oldest sample when T-24h is missing', () => {
    const ago = t0 - 4 * 60 * 60 * 1000;
    const samples = [{ at: new Date(ago).toISOString(), predictionsUsd: 139.3, cashUsd: 100 }];
    expect(computeChange24h(samples, 140.48, t0)).toEqual({
      usd: 1.18,
      pct: 0.85,
      windowMs: 4 * 60 * 60 * 1000,
      complete: false,
    });
  });

  test('latestPortfolioSample picks the newest by time', () => {
    const older = { at: new Date(t0 - 60_000).toISOString(), predictionsUsd: 100, cashUsd: 40 };
    const newer = { at: new Date(t0).toISOString(), predictionsUsd: 110, cashUsd: 50 };
    expect(latestPortfolioSample([newer, older])).toEqual(newer);
    expect(latestPortfolioSample([])).toBeNull();
  });

  test('caps sample ring so storage stays bounded', () => {
    const flood = Array.from({ length: PORTFOLIO_MAX_SAMPLES + 50 }, (_, i) => ({
      at: new Date(t0 - i * 60_000).toISOString(),
      predictionsUsd: 100 + i,
      cashUsd: 90,
    }));
    const pruned = prunePortfolioSamples(flood, t0);
    expect(pruned.length).toBe(PORTFOLIO_MAX_SAMPLES);
    expect(pruned.some((s) => s.predictionsUsd === 100)).toBe(true);
    expect(pruned.some((s) => s.predictionsUsd === 100 + PORTFOLIO_MAX_SAMPLES + 49)).toBe(false);
  });

  test('persists and reloads samples', async () => {
    setKeyValueStore(new MemoryKeyValueStore());
    const rows = [{ at: new Date().toISOString(), predictionsUsd: 99.5, cashUsd: 40 }];
    await persistPortfolioSamples(rows);
    expect(await loadPortfolioSamples()).toEqual(rows);
  });
});

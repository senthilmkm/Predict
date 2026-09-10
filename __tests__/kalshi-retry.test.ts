import {
  DEFAULT_KALSHI_RETRY_POLICY,
  isTimeoutLikeError,
  isTransientKalshiError,
  mergeKalshiRetryPolicy,
  nextImmediateRetryWaitMs,
  normalizeKalshiRetryPolicy,
  parseHttpCodeList,
  resetKalshiRetryPolicyForTests,
  setActiveKalshiRetryPolicy,
  timeoutRetryWaitMs,
} from '../packages/trading-core/src/kalshiRetry';

describe('Kalshi retry policy', () => {
  beforeEach(() => {
    resetKalshiRetryPolicyForTests();
  });

  test('defaults cover 5xx/408, timeouts, 2 retries, 2s interval, 60s pause', () => {
    const p = normalizeKalshiRetryPolicy(null);
    expect(p.httpCodes).toEqual([408, 500, 502, 503, 504]);
    expect(p.includeTimeouts).toBe(true);
    expect(p.maxRetries).toBe(2);
    expect(p.retryIntervalSeconds).toBe(2);
    expect(p.pauseSeconds).toBe(60);
  });

  test('parses comma HTTP lists and strips 401/403', () => {
    expect(parseHttpCodeList('408, 503, 401, 403, 500')).toEqual([408, 500, 503]);
  });

  test('nested merge keeps pause when only codes change', () => {
    const merged = mergeKalshiRetryPolicy(DEFAULT_KALSHI_RETRY_POLICY, {
      httpCodes: [503],
      maxRetries: 1,
    });
    expect(merged.httpCodes).toEqual([503]);
    expect(merged.maxRetries).toBe(1);
    expect(merged.pauseSeconds).toBe(60);
    expect(merged.includeTimeouts).toBe(true);
  });

  test('503 is transient; 401 is not; timeout is when enabled', () => {
    const p = normalizeKalshiRetryPolicy(null);
    expect(isTransientKalshiError('http_503', 503, p)).toBe(true);
    expect(isTransientKalshiError('http_401', 401, p)).toBe(false);
    expect(isTransientKalshiError('lean_fetch_timeout', null, p)).toBe(true);
    expect(isTimeoutLikeError('FetchRequestCanceledException')).toBe(false);
    expect(
      isTransientKalshiError('lean_fetch_timeout', null, { ...p, includeTimeouts: false })
    ).toBe(false);
  });

  test('GET 503 retries maxRetries times then stops; POST never retries', () => {
    const p = normalizeKalshiRetryPolicy({ maxRetries: 2 });
    expect(nextImmediateRetryWaitMs({ status: 503, attempt: 0, method: 'GET', policy: p })).toBe(1);
    expect(nextImmediateRetryWaitMs({ status: 503, attempt: 1, method: 'GET', policy: p })).toBe(1);
    expect(nextImmediateRetryWaitMs({ status: 503, attempt: 2, method: 'GET', policy: p })).toBeNull();
    expect(nextImmediateRetryWaitMs({ status: 503, attempt: 0, method: 'POST', policy: p })).toBeNull();
  });

  test('429 stays on the legacy path unless 429 is in the Admin list', () => {
    const p = normalizeKalshiRetryPolicy(null);
    expect(nextImmediateRetryWaitMs({ status: 429, attempt: 0, method: 'GET', policy: p })).toBe(1);
    expect(nextImmediateRetryWaitMs({ status: 429, attempt: 2, method: 'GET', policy: p })).toBeNull();
    const with429 = normalizeKalshiRetryPolicy({ httpCodes: [429, 503], maxRetries: 1 });
    expect(nextImmediateRetryWaitMs({ status: 429, attempt: 0, method: 'GET', policy: with429 })).toBe(1);
    expect(nextImmediateRetryWaitMs({ status: 429, attempt: 1, method: 'GET', policy: with429 })).toBeNull();
  });

  test('timeout retries follow includeTimeouts + maxRetries', () => {
    const p = normalizeKalshiRetryPolicy({ maxRetries: 1, includeTimeouts: true });
    expect(timeoutRetryWaitMs(0, p)).toBe(1);
    expect(timeoutRetryWaitMs(1, p)).toBeNull();
    expect(timeoutRetryWaitMs(0, { ...p, includeTimeouts: false })).toBeNull();
  });

  test('setActiveKalshiRetryPolicy is what lean/client reads', () => {
    setActiveKalshiRetryPolicy({ httpCodes: [502], maxRetries: 0, pauseSeconds: 90 });
    const p = normalizeKalshiRetryPolicy({ httpCodes: [502], maxRetries: 0, pauseSeconds: 90 });
    expect(p.pauseSeconds).toBe(90);
    expect(nextImmediateRetryWaitMs({ status: 502, attempt: 0, method: 'GET' })).toBeNull();
  });
});

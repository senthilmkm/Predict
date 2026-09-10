/**
 * Admin-editable Kalshi HTTP retry + pause policy.
 * Immediate GET retries first; if those fail, phone and Cloud pause polling.
 */

export interface KalshiRetryPolicy {
  /** HTTP statuses that use this policy (401/403 are stripped). */
  httpCodes: number[];
  /** Treat fetch timeouts / ETIMEDOUT as the same class as 408. */
  includeTimeouts: boolean;
  /** Extra GET attempts after the first failure (0 = fail once, then pause). */
  maxRetries: number;
  /** Wait between those extra GET attempts. */
  retryIntervalSeconds: number;
  /** After retries are exhausted, skip Kalshi polling for this many seconds. */
  pauseSeconds: number;
}

export const DEFAULT_KALSHI_RETRY_POLICY: KalshiRetryPolicy = {
  httpCodes: [408, 500, 502, 503, 504],
  includeTimeouts: true,
  maxRetries: 2,
  retryIntervalSeconds: 2,
  pauseSeconds: 60,
};

const AUTH_CODES = new Set([401, 403]);

let activePolicy: KalshiRetryPolicy = { ...DEFAULT_KALSHI_RETRY_POLICY, httpCodes: [...DEFAULT_KALSHI_RETRY_POLICY.httpCodes] };

function isTestEnv(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function parseHttpCodeList(raw: unknown): number[] {
  const parts = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/[,\s]+/)
        .filter(Boolean);
  const codes: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 400 || n > 599) continue;
    if (AUTH_CODES.has(n) || seen.has(n)) continue;
    seen.add(n);
    codes.push(n);
  }
  codes.sort((a, b) => a - b);
  return codes;
}

export function normalizeKalshiRetryPolicy(raw?: Partial<KalshiRetryPolicy> | null): KalshiRetryPolicy {
  const d = DEFAULT_KALSHI_RETRY_POLICY;
  const codes = parseHttpCodeList(raw?.httpCodes ?? d.httpCodes);
  return {
    httpCodes: codes.length ? codes : [...d.httpCodes],
    includeTimeouts: raw?.includeTimeouts === false ? false : true,
    maxRetries: clampInt(raw?.maxRetries, 0, 5, d.maxRetries),
    retryIntervalSeconds: clampInt(raw?.retryIntervalSeconds, 0, 30, d.retryIntervalSeconds),
    pauseSeconds: clampInt(raw?.pauseSeconds, 10, 300, d.pauseSeconds),
  };
}

export function mergeKalshiRetryPolicy(
  existing: KalshiRetryPolicy | undefined,
  patch: Partial<KalshiRetryPolicy> | undefined
): KalshiRetryPolicy {
  const base = normalizeKalshiRetryPolicy(existing);
  if (!patch) return base;
  return normalizeKalshiRetryPolicy({ ...base, ...patch });
}

export function getActiveKalshiRetryPolicy(): KalshiRetryPolicy {
  return activePolicy;
}

export function setActiveKalshiRetryPolicy(policy: KalshiRetryPolicy | Partial<KalshiRetryPolicy> | null | undefined): KalshiRetryPolicy {
  activePolicy = normalizeKalshiRetryPolicy(policy);
  return activePolicy;
}

export function resetKalshiRetryPolicyForTests(): void {
  activePolicy = normalizeKalshiRetryPolicy(DEFAULT_KALSHI_RETRY_POLICY);
}

export function shouldRetryHttpStatus(status: number, policy: KalshiRetryPolicy = activePolicy): boolean {
  if (!Number.isFinite(status) || AUTH_CODES.has(status)) return false;
  return policy.httpCodes.includes(status);
}

export function isTimeoutLikeError(message: string): boolean {
  const raw = String(message || '');
  if (/FetchRequestCanceledException|canceled|cancelled/i.test(raw) && !/timeout/i.test(raw)) {
    return false;
  }
  return /timeout|ETIMEDOUT|ECONNRESET|socket hang up|lean_fetch_timeout|balance_timeout|http[_\s-]?408/i.test(
    raw
  );
}

export function httpStatusFromKalshiError(message: string, status?: number | null): number | null {
  if (status != null && Number.isFinite(status) && status >= 100) return Number(status);
  const m = String(message || '').match(/http[_\s-]?(\d{3})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function isTransientKalshiError(
  message: string,
  status?: number | null,
  policy: KalshiRetryPolicy = activePolicy
): boolean {
  const code = httpStatusFromKalshiError(message, status);
  if (code != null && AUTH_CODES.has(code)) return false;
  if (code != null && policy.httpCodes.includes(code)) return true;
  if (policy.includeTimeouts && isTimeoutLikeError(message)) return true;
  return false;
}

export function retryDelayMs(policy: KalshiRetryPolicy = activePolicy): number {
  if (isTestEnv()) return 1;
  return Math.max(0, policy.retryIntervalSeconds) * 1000;
}

export function pauseMs(policy: KalshiRetryPolicy = activePolicy): number {
  return Math.max(10, policy.pauseSeconds) * 1000;
}

/**
 * Wait before another GET of the same URL, or null if retries are exhausted.
 * POST/place is never immediately retried (could double-fill). 429 stays on the
 * legacy 2-retry path unless 429 is in the Admin HTTP-code list.
 */
export function nextImmediateRetryWaitMs(opts: {
  status: number;
  attempt: number;
  method?: string;
  policy?: KalshiRetryPolicy;
  retryAfterMs?: number | null;
}): number | null {
  const method = String(opts.method || 'GET').toUpperCase();
  if (method !== 'GET') return null;
  const policy = opts.policy || activePolicy;
  const inPolicy = shouldRetryHttpStatus(opts.status, policy);
  const legacy429 = opts.status === 429 && !inPolicy;
  if (!inPolicy && !legacy429) return null;
  const maxExtra = inPolicy ? policy.maxRetries : 2;
  if (opts.attempt >= maxExtra) return null;
  if (legacy429) {
    const base = (isTestEnv() ? 1 : 2500) * (opts.attempt + 1);
    if (opts.retryAfterMs != null && opts.retryAfterMs > 0) {
      return Math.min(30_000, opts.retryAfterMs);
    }
    return base;
  }
  return retryDelayMs(policy);
}

export function timeoutRetryWaitMs(attempt: number, policy: KalshiRetryPolicy = activePolicy): number | null {
  if (!policy.includeTimeouts) return null;
  if (attempt >= policy.maxRetries) return null;
  return retryDelayMs(policy);
}

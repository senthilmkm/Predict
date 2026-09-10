import {
  getActiveKalshiRetryPolicy,
  isTransientKalshiError,
  pauseMs,
} from '../../../../packages/trading-core/src/kalshiRetry';

/** Skip signed + public Kalshi calls after timeouts/5xx exhaust immediate retries. */
let kalshiPauseUntilMs = 0;

export function resetKalshiPauseForTests(): void {
  kalshiPauseUntilMs = 0;
}

export function isCloudKalshiPaused(nowMs = Date.now()): boolean {
  return nowMs < kalshiPauseUntilMs;
}

export function cloudKalshiPauseUntilMs(): number {
  return kalshiPauseUntilMs;
}

export function noteTransientKalshiFailure(err: unknown): void {
  const message = String((err as any)?.message || err || '');
  const policy = getActiveKalshiRetryPolicy();
  if (!isTransientKalshiError(message, null, policy)) return;
  kalshiPauseUntilMs = Math.max(kalshiPauseUntilMs, Date.now() + pauseMs(policy));
}

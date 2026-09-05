/**
 * Classify Kalshi / lean HTTP errors so the poller can show a Home banner
 * without spamming Expo push notifications for expected auth / rate-limit noise.
 */

export function isRateLimitError(message: string): boolean {
  return /http[_\s-]?429|\brate[\s_-]*limit/i.test(String(message || ''));
}

export function isAuthError(message: string): boolean {
  return /http[_\s-]?401|\bunauthorized\b|auth(entication|orization)?\s*(failed|error|denied)?|invalid.*(api\s*)?(key|token|signature)|signature.*(invalid|fail)/i.test(
    String(message || '')
  );
}

export function isForbiddenError(message: string): boolean {
  return /http[_\s-]?403|\bforbidden\b/i.test(String(message || ''));
}

export function isCanceledNetworkError(message: string): boolean {
  return /FetchRequestCanceledException|canceled|cancelled|abort|network.*failed|socket.*closed/i.test(
    String(message || '')
  );
}

/** Errors that belong on Home / Alerts Hub, but must not fire Expo OS pushes. */
export function isQuietIntegrationError(message: string): boolean {
  return (
    isRateLimitError(message) ||
    isAuthError(message) ||
    isForbiddenError(message) ||
    isCanceledNetworkError(message)
  );
}

export function humanizeQuietError(message: string): string {
  if (isCanceledNetworkError(message)) {
    return 'Network request paused (app backgrounded)';
  }
  if (isRateLimitError(message)) {
    return 'Kalshi rate limit — pausing requests briefly';
  }
  if (isAuthError(message)) {
    return 'Kalshi auth failed (401) — check API key in Settings';
  }
  if (isForbiddenError(message)) {
    return 'Kalshi access denied (403) — check API key permissions';
  }
  return String(message || '').trim();
}

export function httpStatusFromMessage(message: string): number | null {
  const m = String(message || '').match(/http[_\s-]?(\d{3})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

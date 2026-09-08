/** One audible lean per user per 15m contract per side. Survives Cloud Run ticks. */

export const LEAN_ALERT_MAX_AGE_MS = 45 * 60 * 1000;

export type LeanAlertsSent = Record<string, string>;

export function leanAlertKey(ticker: string, decision: string): string {
  return `${String(ticker || '').trim()}:${String(decision || '').toUpperCase()}`;
}

export function pruneLeanAlertsSent(
  sent: LeanAlertsSent | null | undefined,
  now = new Date(),
  maxAgeMs = LEAN_ALERT_MAX_AGE_MS
): LeanAlertsSent {
  const out: LeanAlertsSent = {};
  if (!sent || typeof sent !== 'object') return out;
  const nowMs = now.getTime();
  for (const [key, iso] of Object.entries(sent)) {
    if (!key || typeof iso !== 'string') continue;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) continue;
    if (nowMs - t <= maxAgeMs) out[key] = iso;
  }
  return out;
}

export function claimLeanAlert(
  sent: LeanAlertsSent | null | undefined,
  ticker: string,
  decision: string,
  now = new Date()
): { send: boolean; next: LeanAlertsSent; key: string } {
  const key = leanAlertKey(ticker, decision);
  const next = pruneLeanAlertsSent(sent, now);
  const side = String(decision || '').toUpperCase();
  if (!String(ticker || '').trim() || (side !== 'YES' && side !== 'NO')) {
    return { send: false, next, key };
  }
  if (next[key]) {
    return { send: false, next, key };
  }
  next[key] = now.toISOString();
  return { send: true, next, key };
}

/** Below-cushion leans persist in History but must not ding. */
export function leanAlertPushTokens(absGap: number, cushion: number, tokens: string[]): string[] {
  if (!(Number(absGap) >= Number(cushion))) return [];
  return Array.isArray(tokens) ? tokens.filter(Boolean) : [];
}

export function leanPushEnabled(cfg: any): boolean {
  if (!cfg || cfg.alerts_enabled === false) return false;
  const pref = cfg.alert_prefs?.lean_signal;
  if (pref && (pref.enabled === false || pref.push === false)) return false;
  return true;
}

export function fillPushEnabled(cfg: any): boolean {
  if (!cfg || cfg.alerts_enabled === false) return false;
  const pref = cfg.alert_prefs?.order_filled;
  if (pref && (pref.enabled === false || pref.push === false)) return false;
  return true;
}

function shortHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/** APNs collapse-id must stay <= 64 bytes so retries replace, not stack. */
export function leanCollapseId(userId: string, key: string): string {
  const raw = `lean:${userId}:${key}`;
  if (raw.length <= 64) return raw;
  return `lean:${shortHash(raw)}`.slice(0, 64);
}

export function fillCollapseId(userId: string, tradeId: string): string {
  const raw = `fill:${userId}:${tradeId}`;
  if (raw.length <= 64) return raw;
  return `fill:${shortHash(raw)}`.slice(0, 64);
}

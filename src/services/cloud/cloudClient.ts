import { UserStatusDoc } from '../../../packages/trading-core/src';

const CLOUD_BASE_URL = process.env.EXPO_PUBLIC_CLOUD_API_URL || 'https://predict-cloud-api-428463178740.us-east1.run.app';

export interface KalshiUploadInput {
  keyId: string;
  privateKeyPem: string;
}

export interface SystemConfig {
  tick_interval_seconds: number;
  stale_timeout_seconds: number;
  batch_size: number;
  last_worker_tick_at?: string;
  kalshiRetry?: {
    httpCodes: number[];
    includeTimeouts: boolean;
    maxRetries: number;
    retryIntervalSeconds: number;
    pauseSeconds: number;
  };
  featureFlags?: {
    lastSignalsManualTrade?: boolean;
    cashOut?: boolean;
    cashOutBidCheckSeconds?: number;
    goldFade?: boolean;
    goldFadeBidCheckSeconds?: number;
    twapLock?: boolean;
    lastMinute?: boolean;
    stepBuy?: boolean;
    spikeFade?: boolean;
    pairLock?: boolean;
    cheapLoop?: boolean;
  };
  broadcast?: {
    templates?: Array<{
      id: string;
      title: string;
      message: string;
      show: boolean;
      showUntil: string | null;
    }>;
  };
}

export interface ActiveBroadcast {
  id: string;
  title: string;
  message: string;
}

export type LiveAskQuote = {
  yes_ask?: number;
  no_ask?: number;
  yes_bid?: number;
  no_bid?: number;
  ticker?: string;
};

export type LiveAsksPayload = {
  at: string | null;
  byAsset: Record<string, LiveAskQuote>;
  byTicker: Record<string, LiveAskQuote>;
};

export interface CloudStatusResult {
  ok: boolean;
  userDoc?: UserStatusDoc & { config?: any };
  systemConfig?: SystemConfig;
  activeBroadcast?: ActiveBroadcast | null;
  liveAsks?: LiveAsksPayload;
  leans?: Record<string, Record<string, unknown>>;
  error?: string;
}

function parseCloudLeans(raw: unknown): Record<string, Record<string, unknown>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [asset, row] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(asset || '').trim();
    if (!key || !row || typeof row !== 'object' || Array.isArray(row)) continue;
    out[key] = row as Record<string, unknown>;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseLiveAskQuote(quote: LiveAskQuote, requireAsk: boolean): LiveAskQuote | null {
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
  };
  const yes_ask = n(quote.yes_ask);
  const no_ask = n(quote.no_ask);
  const yes_bid = n(quote.yes_bid);
  const no_bid = n(quote.no_bid);
  if (requireAsk) {
    if (yes_ask == null && no_ask == null) return null;
  } else if (yes_ask == null && no_ask == null && yes_bid == null && no_bid == null) {
    return null;
  }
  return {
    yes_ask,
    no_ask,
    yes_bid,
    no_bid,
    ticker: typeof quote.ticker === 'string' && quote.ticker.trim() ? quote.ticker.trim() : undefined,
  };
}

export function parseLiveAsksPayload(raw: any): LiveAsksPayload {
  const at = typeof raw?.at === 'string' && raw.at ? raw.at : null;
  const src =
    raw?.byAsset && typeof raw.byAsset === 'object'
      ? raw.byAsset
      : raw?.asks && typeof raw.asks === 'object'
        ? raw.asks
        : {};
  const byAsset: Record<string, LiveAskQuote> = {};
  for (const [asset, quote] of Object.entries(src)) {
    const key = String(asset || '').trim();
    if (!key || !quote || typeof quote !== 'object') continue;
    const row = parseLiveAskQuote(quote as LiveAskQuote, true);
    if (row) byAsset[key] = row;
  }
  const byTicker: Record<string, LiveAskQuote> = {};
  const tickerSrc = raw?.byTicker && typeof raw.byTicker === 'object' ? raw.byTicker : {};
  for (const [ticker, quote] of Object.entries(tickerSrc)) {
    const key = String(ticker || '').trim();
    if (!key || !quote || typeof quote !== 'object') continue;
    const row = parseLiveAskQuote(quote as LiveAskQuote, false);
    if (row) byTicker[key] = { ...row, ticker: row.ticker || key };
  }
  return { at, byAsset, byTicker };
}

/** Status snapshot must not replace a newer 1s /me/quotes book. */
export function isNewerOrSameLiveAsksAt(
  incomingAt: string | null | undefined,
  currentAt: string | null | undefined
): boolean {
  if (!incomingAt) return false;
  if (!currentAt) return true;
  const next = Date.parse(incomingAt);
  const prev = Date.parse(currentAt);
  if (!Number.isFinite(next)) return false;
  if (!Number.isFinite(prev)) return true;
  return next >= prev;
}

export class PredictCloudClient {
  constructor(private readonly getAuthToken: () => Promise<string | null>) {}

  /** Avoid hung History/Home pull-to-refresh when Cloud never answers. */
  private static readonly FETCH_TIMEOUT_MS = 20_000;

  private async fetchWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
    const token = await this.getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const parentSignal = options.signal;
    let onParentAbort: (() => void) | null = null;
    if (ctrl && parentSignal) {
      if (parentSignal.aborted) {
        ctrl.abort();
      } else {
        onParentAbort = () => ctrl.abort();
        parentSignal.addEventListener('abort', onParentAbort);
      }
    }
    const timer =
      ctrl != null
        ? setTimeout(() => {
            try {
              ctrl.abort();
            } catch {
              /* */
            }
          }, PredictCloudClient.FETCH_TIMEOUT_MS)
        : null;
    try {
      return await fetch(`${CLOUD_BASE_URL}${path}`, {
        ...options,
        headers,
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (parentSignal && onParentAbort) {
        try {
          parentSignal.removeEventListener('abort', onParentAbort);
        } catch {
          /* */
        }
      }
    }
  }

  async uploadCredentials(input: KalshiUploadInput): Promise<{ ok: boolean; message?: string; error?: string }> {
    try {
      const res = await this.fetchWithAuth('/me/kalshi/credentials', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'upload_failed' };
      return { ok: true, message: data.message };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async wipeCredentials(): Promise<{ ok: boolean; message?: string; error?: string }> {
    try {
      const res = await this.fetchWithAuth('/me/kalshi/credentials', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'wipe_failed' };
      return { ok: true, message: data.message };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async triggerKillSwitch(): Promise<{ ok: boolean; state?: string; error?: string }> {
    try {
      const res = await this.fetchWithAuth('/me/execution/kill', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'kill_failed' };
      return { ok: true, state: data.state };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async getStatus(): Promise<CloudStatusResult> {
    try {
      const res = await this.fetchWithAuth('/me/status', { method: 'GET' });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'status_failed' };
      return {
        ok: true,
        userDoc: data.userDoc,
        systemConfig: data.systemConfig,
        activeBroadcast: data.activeBroadcast ?? null,
        liveAsks: data.liveAsks ? parseLiveAsksPayload(data.liveAsks) : undefined,
        leans: parseCloudLeans(data.leans),
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async getLiveAsks(): Promise<{
    ok: boolean;
    liveAsks?: LiveAsksPayload;
    lastTradeAction?: UserStatusDoc['lastTradeAction'];
    leans?: Record<string, Record<string, unknown>>;
    error?: string;
  }> {
    try {
      const res = await this.fetchWithAuth('/me/quotes', { method: 'GET' });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'quotes_failed' };
      return {
        ok: true,
        liveAsks: parseLiveAsksPayload(data),
        ...(data.lastTradeAction && typeof data.lastTradeAction === 'object'
          ? { lastTradeAction: data.lastTradeAction }
          : {}),
        leans: parseCloudLeans(data.leans),
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async updateStatus(
    cloudTradingEnabled: boolean,
    state: 'ARMED' | 'DISARMED',
    config?: any,
    displayName?: string
  ): Promise<CloudStatusResult> {
    try {
      const { getUserDisplayName } = require('../userId');
      const name = displayName || (await getUserDisplayName()) || undefined;
      const deviceName = `${require('react-native').Platform.OS} Device`;
      const res = await this.fetchWithAuth('/me/status', {
        method: 'POST',
        body: JSON.stringify({ cloudTradingEnabled, state, config, displayName: name, deviceName }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'update_failed' };
      return {
        ok: true,
        userDoc: data.userDoc,
        systemConfig: data.systemConfig,
        activeBroadcast: data.activeBroadcast ?? null,
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async registerPushToken(pushToken: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.fetchWithAuth('/me/push-token', {
        method: 'POST',
        body: JSON.stringify({ pushToken }),
      });
      const data = await res.json();
      return { ok: res.ok, error: data.error };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async recordDisclaimerAcceptance(
    disclaimerVersion: string,
    source: 'onboarding' | 'autotrade_enable' = 'onboarding'
  ): Promise<{ ok: boolean; disclaimerAccepted?: boolean; error?: string }> {
    try {
      const res = await this.fetchWithAuth('/me/disclaimer', {
        method: 'POST',
        body: JSON.stringify({ disclaimerVersion, source }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'disclaimer_log_failed' };
      return { ok: true, disclaimerAccepted: data.disclaimerAccepted };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async recordOnboardingChoice(onboardingRecord: any): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.fetchWithAuth('/me/onboarding', {
        method: 'POST',
        body: JSON.stringify({ onboardingRecord }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'onboarding_sync_failed' };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async getTrades(): Promise<{ ok: boolean; trades?: any[]; error?: string }> {
    try {
      const res = await this.fetchWithAuth('/me/trades', { method: 'GET' });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'trades_fetch_failed' };
      return { ok: true, trades: data.trades || [] };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async getAlerts(): Promise<{ ok: boolean; alerts?: any[]; error?: string }> {
    try {
      const res = await this.fetchWithAuth('/me/alerts?limit=400', { method: 'GET' });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'alerts_fetch_failed' };
      return { ok: true, alerts: Array.isArray(data.alerts) ? data.alerts : [] };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async pruneAlerts(
    olderThanDays: number
  ): Promise<{ ok: boolean; dismissed?: number; error?: string }> {
    const days = Math.max(1, Math.min(365, Math.round(Number(olderThanDays) || 30)));
    try {
      const res = await this.fetchWithAuth('/me/alerts/prune', {
        method: 'POST',
        body: JSON.stringify({ olderThanDays: days }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'alerts_prune_failed' };
      return { ok: true, dismissed: Number(data.dismissed || 0) };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async dismissAlerts(ids: string[]): Promise<{ ok: boolean; dismissed?: number; error?: string }> {
    const alertIds = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (alertIds.length === 0) return { ok: true, dismissed: 0 };
    try {
      const res = await this.fetchWithAuth('/me/alerts/dismiss', {
        method: 'POST',
        body: JSON.stringify({ ids: alertIds }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'alerts_dismiss_failed' };
      return { ok: true, dismissed: Number(data.dismissed || 0) };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async placeManualOrder(input: {
    asset: string;
    action: 'buy' | 'sell';
    requestId: string;
    tradeId?: string;
    decision?: 'YES' | 'NO';
  }): Promise<{
    ok: boolean;
    message?: string;
    error?: string;
    skip_reason?: string;
    tradeId?: string;
    filled?: boolean;
  }> {
    try {
      const res = await this.fetchWithAuth('/me/orders/manual', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        return {
          ok: false,
          error: data.error || 'place_failed',
          skip_reason: data.skip_reason,
          message: data.message || data.error || 'Could not place order',
        };
      }
      return {
        ok: true,
        message: data.message,
        tradeId: data.tradeId,
        filled: data.filled,
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error', message: e?.message || 'Network error' };
    }
  }
}

import { getPersistentUserId } from '../userId';

export const cloudClient = new PredictCloudClient(async () => {
  return await getPersistentUserId();
});


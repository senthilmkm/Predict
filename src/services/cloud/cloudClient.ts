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

export interface CloudStatusResult {
  ok: boolean;
  userDoc?: UserStatusDoc & { config?: any };
  systemConfig?: SystemConfig;
  activeBroadcast?: ActiveBroadcast | null;
  error?: string;
}

export class PredictCloudClient {
  constructor(private readonly getAuthToken: () => Promise<string | null>) {}

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
    return fetch(`${CLOUD_BASE_URL}${path}`, {
      ...options,
      headers,
    });
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


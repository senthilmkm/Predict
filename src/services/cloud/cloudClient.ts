import { UserStatusDoc } from '../../../packages/trading-core/src';

const CLOUD_BASE_URL = process.env.EXPO_PUBLIC_CLOUD_API_URL || 'https://predict-cloud-api-prod.run.app';

export interface KalshiUploadInput {
  keyId: string;
  privateKeyPem: string;
}

export interface CloudStatusResult {
  ok: boolean;
  userDoc?: UserStatusDoc & { config?: any };
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
      return { ok: true, userDoc: data.userDoc };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network_error' };
    }
  }

  async updateStatus(
    cloudTradingEnabled: boolean,
    state: 'ARMED' | 'DISARMED',
    config?: any
  ): Promise<CloudStatusResult> {
    try {
      const res = await this.fetchWithAuth('/me/status', {
        method: 'POST',
        body: JSON.stringify({ cloudTradingEnabled, state, config }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'update_failed' };
      return { ok: true, userDoc: data.userDoc };
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
}

export const cloudClient = new PredictCloudClient(async () => 'default_user');


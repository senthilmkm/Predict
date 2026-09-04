import { signKalshiRequest } from './sign';
import { ASSETS_CATALOG } from './types';

export type KalshiEnv = 'production' | 'demo';

export function kalshiBaseUrl(env: KalshiEnv): string {
  if (env === 'demo') return 'https://external-api.demo.kalshi.co/trade-api/v2';
  return 'https://external-api.kalshi.com/trade-api/v2';
}

export interface PlaceOrderInput {
  ticker: string;
  side: 'bid' | 'ask';
  count: string;
  price: string;
  time_in_force?: string;
  client_order_id?: string;
  exchange_index?: number;
  dry_run?: boolean;
}

export interface KalshiBalanceResult {
  ok: boolean;
  http_status: number;
  balance_cents?: number;
  balance_usd?: number | null;
  portfolio_value_usd?: number | null;
  balance_by_exchange_index?: Record<number, number>;
  environment: KalshiEnv;
  error?: unknown;
  raw?: unknown;
}

export interface KalshiPlaceResult {
  ok: boolean;
  http_status: number;
  dry_run: boolean;
  payload: Record<string, unknown>;
  response?: unknown;
  error?: string | null;
  order_id?: string | null;
  fill_count?: string | null;
  remaining_count?: string | null;
  average_fill_price?: string | null;
}

export class KalshiClient {
  constructor(
    private readonly keyId: string,
    private readonly privateKeyPem: string,
    private readonly env: KalshiEnv = 'production',
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  get base(): string {
    return kalshiBaseUrl(this.env);
  }

  private headers(method: string, urlPath: string): Record<string, string> {
    const timestamp = String(Date.now());
    const pathOnly = urlPath.split('?', 1)[0];
    const fullPath = new URL(this.base + pathOnly).pathname;
    return {
      'KALSHI-ACCESS-KEY': this.keyId,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      'KALSHI-ACCESS-SIGNATURE': signKalshiRequest(
        this.privateKeyPem,
        timestamp,
        method,
        fullPath
      ),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    attempt = 0
  ): Promise<{ status: number; data: any }> {
    const url = this.base + path;
    const headers = this.headers(method, path);
    const init: RequestInit = { method: method.toUpperCase(), headers };
    if (method.toUpperCase() === 'POST') {
      init.body = JSON.stringify(body ?? {});
    }
    const res = await this.fetchImpl(url, init);
    let data: any;
    try {
      data = await res.json();
    } catch {
      data = { raw: await res.text().catch(() => '') };
    }
    if (res.status === 429 && attempt < 2 && method.toUpperCase() === 'GET') {
      const waitMs = 2500 * (attempt + 1);
      await new Promise((r) => setTimeout(r, waitMs));
      return this.request(method, path, body, attempt + 1);
    }
    return { status: res.status, data };
  }

  async balance(): Promise<KalshiBalanceResult> {
    const { status, data } = await this.request('GET', '/portfolio/balance');
    if (status !== 200) {
      return {
        ok: false,
        http_status: status,
        environment: this.env,
        error: data,
      };
    }
    const balCents = data?.balance;
    let usd: number | null = null;
    try {
      if (data?.balance_dollars != null && String(data.balance_dollars).trim() !== '') {
        usd = Math.round(Number(data.balance_dollars) * 100) / 100;
      } else if (balCents != null) {
        usd = Math.round((Number(balCents) / 100) * 100) / 100;
      }
    } catch {
      usd = null;
    }
    const positionsCents = data?.portfolio_value ?? data?.portfolio_value_cents ?? null;
    let positionsUsd: number | null = null;
    try {
      if (positionsCents != null && Number.isFinite(Number(positionsCents))) {
        positionsUsd = Math.round((Number(positionsCents) / 100) * 100) / 100;
      }
    } catch {
      positionsUsd = null;
    }
    const breakdown: Record<number, number> = {};
    try {
      for (const row of data?.balance_breakdown || []) {
        breakdown[Number(row.exchange_index)] = Number(row.balance || 0);
      }
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      http_status: status,
      balance_cents: balCents,
      balance_usd: usd,
      portfolio_value_usd: positionsUsd,
      balance_by_exchange_index: breakdown,
      environment: this.env,
      raw: data,
    };
  }

  async placeOrder(input: PlaceOrderInput): Promise<KalshiPlaceResult> {
    const payload: Record<string, unknown> = {
      ticker: input.ticker,
      side: input.side,
      count: input.count,
      price: input.price,
      time_in_force: input.time_in_force || 'immediate_or_cancel',
      self_trade_prevention_type: 'taker_at_cross',
    };
    if (input.client_order_id) payload.client_order_id = input.client_order_id;
    if (input.exchange_index != null) payload.exchange_index = input.exchange_index;

    if (input.dry_run) {
      return {
        ok: true,
        http_status: 0,
        dry_run: true,
        payload,
        error: null,
      };
    }

    const { status, data } = await this.request(
      'POST',
      '/portfolio/events/orders',
      payload
    );
    const ok = status === 200 || status === 201;
    const errCode =
      data && typeof data === 'object' && data.error && typeof data.error === 'object'
        ? data.error.code
        : null;
    return {
      ok,
      http_status: status,
      dry_run: false,
      payload,
      response: data,
      error: errCode,
      order_id: data?.order_id ?? null,
      fill_count: data?.fill_count ?? null,
      remaining_count: data?.remaining_count ?? null,
      average_fill_price: data?.average_fill_price ?? null,
    };
  }
}

export const SERIES_BY_ASSET: Record<string, string> = ASSETS_CATALOG.reduce((acc, asset) => {
  acc[asset.key] = asset.seriesTicker;
  return acc;
}, {} as Record<string, string>);

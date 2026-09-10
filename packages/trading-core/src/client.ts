import { signKalshiRequest } from './sign';
import { getActiveKalshiRetryPolicy, nextImmediateRetryWaitMs } from './kalshiRetry';
import { ASSETS_CATALOG } from './types';
import {
  extractKalshiOrderFields,
  KalshiOrderFields,
  orderFillIsTerminal,
  placeFillConfirmWaitMsList,
  placeFillLooksComplete,
  preferOrderFields,
  sleepMs,
} from './orderFill';

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
  order_status?: string | null;
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
    const waitMs = nextImmediateRetryWaitMs({
      status: res.status,
      attempt,
      method,
      policy: getActiveKalshiRetryPolicy(),
    });
    if (waitMs != null) {
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
    let fields = extractKalshiOrderFields(data);
    if (ok && fields.order_id && !placeFillLooksComplete(fields)) {
      fields = await this.confirmPlaceFill(fields);
    }
    return {
      ok,
      http_status: status,
      dry_run: false,
      payload,
      response: data,
      error: errCode,
      order_id: fields.order_id,
      fill_count: fields.fill_count,
      remaining_count: fields.remaining_count,
      average_fill_price: fields.average_fill_price,
      order_status: fields.status,
    };
  }

  async getOrder(orderId: string): Promise<{ ok: boolean; http_status: number; fields: KalshiOrderFields }> {
    const id = String(orderId || '').trim();
    if (!id) {
      return {
        ok: false,
        http_status: 0,
        fields: extractKalshiOrderFields(null),
      };
    }
    const { status, data } = await this.request('GET', `/portfolio/orders/${encodeURIComponent(id)}`);
    return {
      ok: status === 200,
      http_status: status,
      fields: extractKalshiOrderFields(data),
    };
  }

  private async confirmPlaceFill(initial: KalshiOrderFields): Promise<KalshiOrderFields> {
    let fields = initial;
    const orderId = fields.order_id;
    if (!orderId) return fields;
    for (const waitMs of placeFillConfirmWaitMsList()) {
      await sleepMs(waitMs);
      try {
        const got = await this.getOrder(orderId);
        if (got.ok) {
          fields = preferOrderFields(fields, got.fields);
          if (placeFillLooksComplete(fields) || orderFillIsTerminal(fields)) break;
        }
      } catch {
        /* keep polling — GET can 404 before the order is visible */
      }
    }
    return fields;
  }
}

export const SERIES_BY_ASSET: Record<string, string> = ASSETS_CATALOG.reduce((acc, asset) => {
  acc[asset.key] = asset.seriesTicker;
  return acc;
}, {} as Record<string, string>);

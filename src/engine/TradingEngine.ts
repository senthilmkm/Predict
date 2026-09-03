import { AppConfig } from '../config/types';
import { KalshiClient, KalshiPlaceResult } from '../services/kalshi/client';
import { AsyncMutex, WindowLockRegistry } from './concurrency';
import { evaluateStaticGate, LeanSignal } from './gates';

export interface TradeIntentRecord {
  at: string;
  event: string;
  asset?: string;
  market_ticker?: string;
  dry_run?: boolean;
  skip_reason?: string;
  order_id?: string | null;
  fill_count?: string | null;
  payload?: unknown;
}

export class TradingEngine {
  readonly mutex = new AsyncMutex();
  readonly windows = new WindowLockRegistry();
  readonly intents: TradeIntentRecord[] = [];

  constructor(private client: KalshiClient | null = null) {}

  setClient(client: KalshiClient | null): void {
    this.client = client;
  }

  getClient(): KalshiClient | null {
    return this.client;
  }

  async tryPlaceFromLean(
    lean: LeanSignal,
    cfg: AppConfig,
    opts?: {
      openPositions?: number;
      dailyPnlUsd?: number;
      tradesToday?: number;
      assetTradesToday?: number;
    }
  ): Promise<{ ok: boolean; placed?: KalshiPlaceResult; gate: ReturnType<typeof evaluateStaticGate> }> {
    return this.mutex.runExclusive(async () => {
      const gate = evaluateStaticGate(lean, cfg, opts);
      if (!gate.ok) {
        this.intents.push({
          at: new Date().toISOString(),
          event: 'skip',
          asset: lean.asset,
          market_ticker: lean.market_ticker,
          skip_reason: gate.skip_reason,
        });
        return { ok: false, gate };
      }

      const clientOrderId = `fs-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      if (!this.windows.tryClaim(gate.market_ticker!, clientOrderId)) {
        this.intents.push({
          at: new Date().toISOString(),
          event: 'skip',
          asset: lean.asset,
          market_ticker: gate.market_ticker,
          skip_reason: 'window_locked',
        });
        return { ok: false, gate: { ...gate, ok: false, skip_reason: 'window_locked' } };
      }

      try {
        if (!this.client) {
          this.windows.release(gate.market_ticker!);
          return { ok: false, gate: { ...gate, ok: false, skip_reason: 'no_client' } };
        }

        const placed = await this.client.placeOrder({
          ticker: gate.market_ticker!,
          side: gate.side!,
          count: gate.count!,
          price: gate.price!,
          client_order_id: clientOrderId,
          time_in_force: gate.time_in_force || cfg.risk.time_in_force,
          dry_run: false,
        });

        this.intents.push({
          at: new Date().toISOString(),
          event: placed.ok ? 'filled_or_posted' : 'place_failed',
          asset: lean.asset,
          market_ticker: gate.market_ticker,
          dry_run: false,
          order_id: placed.order_id,
          fill_count: placed.fill_count,
          payload: placed.payload,
        });

        if (!placed.ok) {
          this.windows.release(gate.market_ticker!);
        }
        return { ok: placed.ok, placed, gate };
      } catch (e) {
        this.windows.release(gate.market_ticker!);
        throw e;
      }
    });
  }

  /** IOC exit for protect-sell — does not claim the entry window lock. */
  async tryProtectExit(input: {
    ticker: string;
    side: 'bid' | 'ask';
    count: string;
    price: string;
    time_in_force?: string;
  }): Promise<KalshiPlaceResult> {
    return this.mutex.runExclusive(async () => {
      if (!this.client) {
        return {
          ok: false,
          http_status: 0,
          dry_run: false,
          payload: {},
          error: 'no_client',
        };
      }
      const clientOrderId = `fs-exit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const placed = await this.client.placeOrder({
        ticker: input.ticker,
        side: input.side,
        count: input.count,
        price: input.price,
        client_order_id: clientOrderId,
        time_in_force: input.time_in_force || 'immediate_or_cancel',
        dry_run: false,
      });
      this.intents.push({
        at: new Date().toISOString(),
        event: placed.ok ? 'protect_exit' : 'protect_exit_failed',
        market_ticker: input.ticker,
        dry_run: false,
        order_id: placed.order_id,
        fill_count: placed.fill_count,
        payload: placed.payload,
      });
      return placed;
    });
  }
}
import { AppConfig, AssetKey } from '../config/types';
import { snapshotConfig } from '../config/normalize';
import { TradingEngine } from '../engine/TradingEngine';
import { LeanSignal } from '../engine/gates';
import { KalshiClient } from '../services/kalshi/client';
import { loadCredentials } from '../services/credentials';
import { computeLean, LeanResult } from '../services/lean/lean';
import { isMarketOpen } from '../services/marketHours';
import { maybeNotify } from '../services/notifications';
import { MemoryAlertRepo, MemoryTradeRepo, TradeRecord, AlertRecord } from '../storage/repos';
import { hydrateRepos, persistRepos } from '../storage/historyPersistence';
import { settlePendingTrades, inferFillCount } from '../services/settlement';
import {
  buildProtectSellOrder,
  computeProtectSellPnlUsd,
  pendingTradesForMarket,
  shouldProtectSell,
} from '../services/protectSell';
import { withSupportContact } from '../config/appMeta';
import {
  humanizeQuietError,
  isAuthError,
  isCanceledNetworkError,
  isQuietIntegrationError,
  isRateLimitError,
} from '../util/httpErrors';
import { etDateKey } from '../util/time';

function rid(): string {
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** @deprecated use etDateKey from util/time */
export { etDateKey };

export type TradeActionStatus = 'placed' | 'skipped' | 'failed' | 'idle';

export interface LastTradeAction {
  status: TradeActionStatus;
  /** Short human label, e.g. "placed YES · 2 @ $0.62" or "skipped · ask too rich" */
  detail: string;
  at: string;
}

export interface RuntimeStatus {
  running: boolean;
  lastTickAt: string | null;
  /** Updated at the start of every tick so heartbeat stays Live during long polls */
  lastPulseAt: string | null;
  lastLeans: Partial<Record<AssetKey, LeanResult>>;
  lastLeanAt: Partial<Record<AssetKey, string>>;
  /** Per-asset last auto-trade attempt (Home clarifies signal vs order) */
  lastTradeAction: Partial<Record<AssetKey, LastTradeAction>>;
  /** Per-asset integration / price / place errors from latest tick */
  assetErrors: Partial<Record<AssetKey, string>>;
  /** Latest human-readable integration error (shown on Home) */
  lastError: string | null;
  killSwitch: boolean;
  /** Kalshi predictions portfolio total (USD). */
  predictionsBalanceUsd: number | null;
  /** Kalshi available cash (USD). */
  cashBalanceUsd: number | null;
}

export function formatSkipReason(reason: string | undefined): string {
  switch (reason) {
    case 'auto_trade_off':
      return 'auto-trade off';
    case 'asset_disabled':
      return 'asset off';
    case 'window_ended':
      return 'window ended';
    case 'skip_decision':
      return 'SKIP signal';
    case 'minutes_left':
      return 'too little time left';
    case 'minutes_elapsed':
      return 'too early in window';
    case 'below_cushion':
      return 'below cushion';
    case 'max_open':
      return 'max open positions';
    case 'daily_loss_stop':
      return 'daily loss stop';
    case 'max_trades_day':
      return 'max trades/day';
    case 'max_trades_asset_day':
      return 'max trades/asset/day';
    case 'ask_too_rich':
      return 'ask too rich';
    case 'notional_too_small':
      return 'size too small';
    case 'window_locked':
      return 'already traded this window';
    case 'no_client':
      return 'no Kalshi credentials';
    default:
      return reason || 'gate';
  }
}

/**
 * Foreground trading/alert loop. UI never places orders — only this runtime does.
 */
export class AppRuntime {
  readonly trades = new MemoryTradeRepo();
  readonly alerts = new MemoryAlertRepo();
  readonly engine = new TradingEngine(null);
  readonly status: RuntimeStatus = {
    running: false,
    lastTickAt: null,
    lastPulseAt: null,
    lastLeans: {},
    lastLeanAt: {},
    lastTradeAction: {},
    assetErrors: {},
    lastError: null,
    killSwitch: false,
    predictionsBalanceUsd: null,
    cashBalanceUsd: null,
  };

  private timer: ReturnType<typeof setInterval> | null = null;
  private getConfig: () => AppConfig;
  private onChange?: () => void;
  private fetchImpl: typeof fetch;
  private alertedWindows = new Set<string>();
  private lastErrorAlertKey: string | null = null;
  /** Prevents overlapping ticks (each lean pass can take longer than the poll interval). */
  private tickInFlight = false;
  /** Skip authenticated Kalshi calls until this time after HTTP 429. */
  private rateLimitUntilMs = 0;
  /** Skip signed Kalshi calls after HTTP 401/403 until user fixes keys (or cooldown ends). */
  private authBlockedUntilMs = 0;
  private balanceInFlight: Promise<void> | null = null;
  private lastBalanceFetchMs = 0;

  constructor(opts: {
    getConfig: () => AppConfig;
    onChange?: () => void;
    fetchImpl?: typeof fetch;
  }) {
    this.getConfig = opts.getConfig;
    this.onChange = opts.onChange;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  kill(): void {
    this.status.killSwitch = true;
    const cfg = this.getConfig();
    void this.pushAlert(cfg, 'error', 'Kill switch', 'Auto-trade disarmed');
    this.onChange?.();
  }

  clearKill(): void {
    this.status.killSwitch = false;
    this.onChange?.();
  }

  /** Refresh Predictions total (cash + open positions) after settlement / trade_result. */
  async refreshPredictionsBalance(): Promise<void> {
    await this.refreshKalshiBalances({ force: true });
  }

  /** Refresh Cash after a fill / order_filled. */
  async refreshCashBalance(): Promise<void> {
    await this.refreshKalshiBalances({ force: true });
  }

  /** Clear auth cooldown after Settings reconnect / successful signed call. */
  clearAuthBlock(): void {
    this.authBlockedUntilMs = 0;
  }

  /** Single Kalshi /portfolio/balance fetch → updates Cash + Predictions cards. */
  private async refreshKalshiBalances(opts?: { force?: boolean }): Promise<void> {
    const now = Date.now();
    if (now < this.rateLimitUntilMs) return;
    if (now < this.authBlockedUntilMs) return;
    if (this.balanceInFlight) return this.balanceInFlight;
    // Coalesce frequent pull/settle/fill refreshes (still allow force within ~3s via in-flight share)
    if (!opts?.force && now - this.lastBalanceFetchMs < 8_000 && this.status.cashBalanceUsd != null) {
      return;
    }

    this.balanceInFlight = (async () => {
      const hasClient = await this.refreshClient();
      if (!hasClient) {
        this.status.predictionsBalanceUsd = null;
        this.status.cashBalanceUsd = null;
        this.onChange?.();
        return;
      }
      const client = this.engine.getClient();
      if (!client) return;
      try {
        const bal = await client.balance();
        if (bal.ok) {
          const cash =
            bal.balance_usd != null && Number.isFinite(Number(bal.balance_usd))
              ? Number(bal.balance_usd)
              : null;
          const positions =
            bal.portfolio_value_usd != null && Number.isFinite(Number(bal.portfolio_value_usd))
              ? Number(bal.portfolio_value_usd)
              : 0;
          this.status.cashBalanceUsd = cash;
          this.status.predictionsBalanceUsd =
            cash != null ? Math.round((cash + positions) * 100) / 100 : null;
          this.lastBalanceFetchMs = Date.now();
          this.authBlockedUntilMs = 0;
        } else if (bal.http_status === 429) {
          this.rateLimitUntilMs = Date.now() + 30_000;
          this.status.lastError = humanizeQuietError('http_429');
        } else if (bal.http_status === 401 || bal.http_status === 403) {
          this.authBlockedUntilMs = Date.now() + 5 * 60_000;
          this.status.lastError = humanizeQuietError(`http_${bal.http_status}`);
        }
      } catch {
        /* keep last known balances */
      }
      this.onChange?.();
    })().finally(() => {
      this.balanceInFlight = null;
    });

    return this.balanceInFlight;
  }

  async refreshClient(): Promise<boolean> {
    const creds = await loadCredentials();
    if (!creds) {
      this.engine.setClient(null);
      return false;
    }
    this.engine.setClient(
      new KalshiClient(creds.keyId, creds.privateKeyPem, creds.env, this.fetchImpl)
    );
    return true;
  }

  async hydrateHistory(): Promise<void> {
    const days = this.getConfig().alert_retention_days ?? 30;
    await hydrateRepos(this.trades, this.alerts, days);
    // Prevent double-entry on the same 15m window after restart
    for (const t of this.trades.pendingFilled()) {
      this.engine.windows.claimExisting(
        t.market_ticker,
        t.order_id || t.id || 'hydrated'
      );
    }
    this.onChange?.();
  }

  private async persistHistory(): Promise<void> {
    const days = this.getConfig().alert_retention_days ?? 30;
    await persistRepos(this.trades, this.alerts, days);
  }

  /** Apply retention now; returns how many alerts were removed. */
  pruneAlertsNow(): number {
    const days = this.getConfig().alert_retention_days ?? 30;
    const removed = this.alerts.pruneOlderThanDays(days);
    void this.persistHistory();
    this.onChange?.();
    return removed;
  }

  /** Delete alerts by ids and persist the updated history immediately. */
  async deleteAlertsByIds(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const removed = this.alerts.deleteByIds(ids);
    await this.persistHistory();
    this.onChange?.();
    return removed;
  }

  /** Mark all alerts as read and persist to storage immediately. */
  async markAllRead(): Promise<void> {
    this.alerts.markAllRead();
    await this.persistHistory();
    this.onChange?.();
  }

  start(intervalMs = 20000): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const ms = Math.max(10000, Number(intervalMs) || 20000);
    this.status.running = true;
    this.status.lastPulseAt = new Date().toISOString();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), ms);
    this.onChange?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.running = false;
    this.onChange?.();
  }

  private tradesTodayCounts(): { total: number; byAsset: Partial<Record<AssetKey, number>> } {
    const today = etDateKey();
    const byAsset: Partial<Record<AssetKey, number>> = {};
    let total = 0;
    for (const t of this.trades.list(500)) {
      if (t.dry_run) continue;
      if (etDateKey(new Date(t.at)) !== today) continue;
      total += 1;
      const a = t.asset as AssetKey;
      byAsset[a] = (byAsset[a] || 0) + 1;
    }
    return { total, byAsset };
  }

  private noteAssetError(asset: AssetKey, message: string, tickErrors: string[]) {
    this.status.assetErrors[asset] = message;
    tickErrors.push(`${asset}: ${message}`);
  }

  /**
   * Log integration errors to Alerts Hub.
   * 401 / 403 / 429 stay on-device (Home banner + history) — never Expo push spam.
   */
  private async maybeAlertIntegrationError(cfg: AppConfig, message: string) {
    if (!message || isCanceledNetworkError(message)) return;
    const quiet = isQuietIntegrationError(message);
    const display = quiet ? humanizeQuietError(message) : message;
    if (this.lastErrorAlertKey === display) return;
    this.lastErrorAlertKey = display;
    const title = quiet ? 'Connection issue' : 'Integration error';
    const body = quiet ? display : withSupportContact(display);
    this.recordAlert('error', title, body);
    if (quiet) return;
    await maybeNotify(cfg, 'error', title, body);
  }

  /** Order / runtime failures: push only for unexpected errors (not 401/429). */
  private async maybeAlertHardError(
    cfg: AppConfig,
    title: string,
    detail: string
  ): Promise<void> {
    if (!detail || isCanceledNetworkError(detail)) return;
    const quiet = isQuietIntegrationError(detail);
    const display = quiet ? humanizeQuietError(detail) : detail;
    const body = quiet ? display : withSupportContact(display);
    this.recordAlert('error', quiet ? 'Connection issue' : title, body);
    if (quiet) return;
    await maybeNotify(cfg, 'error', title, body);
  }

  /** Keep Home heartbeat Live during long multi-asset ticks. */
  private pulseHeartbeat(): void {
    this.status.lastPulseAt = new Date().toISOString();
    this.onChange?.();
  }

  async tick(): Promise<void> {
    // Skip if previous tick still running — overlapping ticks pile up network work
    // and make lastPulseAt look "stale" even though the poller is busy.
    if (this.tickInFlight) return;
    this.tickInFlight = true;

    const tickErrors: string[] = [];
    const tickAssetErrors: Partial<Record<AssetKey, string>> = {};
    this.status.assetErrors = tickAssetErrors;
    this.pulseHeartbeat();

    try {
      if (Date.now() < this.rateLimitUntilMs) {
        // Stay Live via pulse, but don't hammer Kalshi while rate-limited
        this.status.lastError = humanizeQuietError('http_429');
        return;
      }

      const cfg = snapshotConfig(this.getConfig());
      const authBlocked = Date.now() < this.authBlockedUntilMs;
      const hasClient = !authBlocked && (await this.refreshClient());
      const assets = (Object.keys(cfg.assets_enabled) as AssetKey[]).filter(
        (a) => cfg.assets_enabled[a]
      );

      if (authBlocked) {
        this.status.lastError = humanizeQuietError('http_401');
      }

      if (cfg.auto_trade_enabled && !hasClient) {
        tickErrors.push(
          authBlocked
            ? 'Auto-trade paused · Kalshi auth failed (401) — check API key in Settings'
            : 'Auto-trade on but Kalshi credentials missing'
        );
      }

      // Settle first so max-open and History filters reflect Kalshi results this tick
      if (hasClient) {
        try {
          await this.settleOpenTrades(cfg);
          this.pulseHeartbeat();
        } catch {
          /* settlement best-effort */
        }
      }

      const dailyPnl = this.trades.stats().realized_pnl_usd;
      const dayCounts = this.tradesTodayCounts();
      const tickAt = new Date().toISOString();
      let openPositions = this.trades.pendingFilled().length;

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        if (Date.now() < this.rateLimitUntilMs) break;
        // Stagger assets slightly so 5 series don't burst the public API at once
        if (i > 0) {
          const staggerMs =
            typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? 0 : 350;
          if (staggerMs > 0) await new Promise((r) => setTimeout(r, staggerMs));
        }
        let lean: LeanResult;
        try {
          lean = await computeLean(asset, cfg.cushions[asset], this.fetchImpl);
        } catch (e: any) {
          const raw = String(e?.message || e);
          if (raw.includes('http_429') || isRateLimitError(raw)) {
            this.rateLimitUntilMs = Date.now() + 30_000;
            this.noteAssetError(asset, 'rate limited · backing off 30s', tickErrors);
            break;
          }
          if (isCanceledNetworkError(raw)) {
            // Screen locked / app backgrounded — iOS canceled in-flight HTTP request. Ignore quietly.
            this.pulseHeartbeat();
            continue;
          }
          if (isQuietIntegrationError(raw)) {
            // Public lean/spot 401 must NOT block signed Kalshi trading for 5m.
            this.noteAssetError(asset, humanizeQuietError(raw), tickErrors);
            this.pulseHeartbeat();
            continue;
          }
          const msg = `price/lean failed · ${raw}`;
          this.noteAssetError(asset, msg, tickErrors);
          if (cfg.auto_trade_enabled) {
            this.status.lastTradeAction[asset] = {
              status: 'idle',
              detail: 'no order · lean failed this tick',
              at: tickAt,
            };
          }
          this.pulseHeartbeat();
          continue;
        }
        // Each asset does several HTTP calls; pulse so Live doesn't flip to Stale mid-tick
        this.pulseHeartbeat();

        this.status.lastLeans[asset] = lean;
        this.status.lastLeanAt[asset] = tickAt;

        const open = isMarketOpen(asset, new Date()).open;
        if (!open || lean.message?.includes('Market closed')) {
          // Closed market is normal scheduled operation, not an error
          delete this.status.assetErrors[asset];
          continue;
        }

        if (!lean.ok) {
          const msg = lean.message
            ? `lean unavailable · ${lean.message}`
            : 'lean unavailable';
          // Soft market states stay on the row only; escalate real integration issues
          if (lean.message !== 'no_market' && lean.message !== 'strike_tbd') {
            this.status.assetErrors[asset] = msg;
            tickErrors.push(`${asset}: ${msg}`);
          }
          if (cfg.auto_trade_enabled) {
            this.status.lastTradeAction[asset] = {
              status: 'idle',
              detail: `no order · ${lean.message || 'lean unavailable'}`,
              at: tickAt,
            };
          }
          continue;
        }
        if (!lean.market_ticker) {
          if (open) {
            this.noteAssetError(asset, 'no market ticker', tickErrors);
          }
          if (cfg.auto_trade_enabled) {
            this.status.lastTradeAction[asset] = {
              status: 'idle',
              detail: 'no order · no market ticker',
              at: tickAt,
            };
          }
          continue;
        }
        if (lean.live == null || !Number.isFinite(lean.live)) {
          this.noteAssetError(asset, 'live price missing', tickErrors);
          if (cfg.auto_trade_enabled) {
            this.status.lastTradeAction[asset] = {
              status: 'idle',
              detail: 'no order · live price missing',
              at: tickAt,
            };
          }
          continue;
        }

        // Clear prior asset error on success path for this asset
        delete this.status.assetErrors[asset];

        // Protect-sell can run even when auto-trade (new buys) is off
        if (
          cfg.risk.protect_sell_enabled &&
          hasClient &&
          !this.status.killSwitch &&
          lean.market_ticker
        ) {
          try {
            await this.tryProtectSellsForAsset(asset, lean, cfg, tickAt);
          } catch (e: any) {
            const msg = `protect sell failed · ${String(e?.message || e)}`;
            this.noteAssetError(asset, msg, tickErrors);
          }
        }

        if (cfg.alerts_enabled && (lean.decision === 'YES' || lean.decision === 'NO')) {
          const key = `${lean.market_ticker}:${lean.decision}`;
          if (!this.alertedWindows.has(key)) {
            this.alertedWindows.add(key);
            const title = `Signal · ${asset} ${lean.decision}`;
            const body = `Gap $${(lean.abs_gap ?? 0).toFixed(2)} · cushion $${cfg.cushions[asset]} · ${lean.minutes_left ?? '?'}m left · not an order`;
            this.recordAlert('lean_signal', title, body);
            // Re-snapshot config for mute-matrix changes mid-tick.
            await maybeNotify(snapshotConfig(this.getConfig()), 'lean_signal', title, body);
          }
        }

        if (this.status.killSwitch) {
          this.status.lastTradeAction[asset] = {
            status: 'skipped',
            detail: 'skipped · kill switch',
            at: tickAt,
          };
          continue;
        }
        if (!cfg.auto_trade_enabled) continue;

        const signal: LeanSignal = {
          asset,
          market_ticker: lean.market_ticker,
          decision: lean.decision,
          live: lean.live ?? 0,
          strike: lean.strike ?? 0,
          abs_gap: lean.abs_gap ?? 0,
          minutes_left: lean.minutes_left ?? 0,
          minutes_elapsed: lean.minutes_elapsed ?? 0,
          phase: lean.phase === 'live' ? 'live' : 'ended',
          yes_ask: lean.yes_ask ?? undefined,
          no_ask: lean.no_ask ?? undefined,
        };

        let result: Awaited<ReturnType<TradingEngine['tryPlaceFromLean']>>;
        try {
          result = await this.engine.tryPlaceFromLean(signal, cfg, {
            openPositions,
            dailyPnlUsd: dailyPnl,
            tradesToday: dayCounts.total,
            assetTradesToday: dayCounts.byAsset[asset] || 0,
          });
        } catch (e: any) {
          const msg = `place failed · ${String(e?.message || e)}`;
          this.noteAssetError(asset, msg, tickErrors);
          this.status.lastTradeAction[asset] = {
            status: 'failed',
            detail: msg,
            at: tickAt,
          };
          continue;
        }

        if (!result.ok) {
          const reason = formatSkipReason(result.gate.skip_reason);
          this.status.lastTradeAction[asset] = {
            status: 'skipped',
            detail: `no order · ${reason}`,
            at: tickAt,
          };
          if (result.gate.skip_reason === 'no_client') {
            this.noteAssetError(asset, 'no Kalshi client (add credentials)', tickErrors);
          }
          continue;
        }

        if (result.placed && !result.placed.ok) {
          const detail =
            result.placed.error ||
            `HTTP ${result.placed.http_status}` ||
            'order rejected';
          this.noteAssetError(asset, `order failed · ${detail}`, tickErrors);
          this.status.lastTradeAction[asset] = {
            status: 'failed',
            detail: `order failed · ${detail}`,
            at: tickAt,
          };
          if (result.placed.http_status === 429) {
            this.rateLimitUntilMs = Date.now() + 30_000;
          } else if (result.placed.http_status === 401 || result.placed.http_status === 403) {
            this.authBlockedUntilMs = Date.now() + 5 * 60_000;
          }
          await this.maybeAlertHardError(cfg, `${asset} order failed`, String(detail));
          continue;
        }

        if (result.ok && result.placed) {
          const fillCount = Number(result.placed.fill_count ?? 0);
          const isMiss = !(fillCount > 0);
          const avgFillPrice =
            result.placed.average_fill_price != null
              ? Number(result.placed.average_fill_price)
              : null;
          // Record actual average fill pricing (matches Kalshi UI cost); fall back to planned gate pay price.
          const recordedFillPrice =
            avgFillPrice != null && Number.isFinite(avgFillPrice) && avgFillPrice > 0
              ? avgFillPrice
              : (result.gate.pay_price ?? null);
          const recordedNotionalUsd = isMiss
            ? 0
            : Math.round(fillCount * (recordedFillPrice ?? 0) * 100) / 100;
          const trade: TradeRecord = {
            id: rid(),
            at: new Date().toISOString(),
            asset,
            market_ticker: lean.market_ticker,
            side: (result.gate.decision as 'YES' | 'NO') || 'YES',
            notional_usd: recordedNotionalUsd,
            fill_price: recordedFillPrice,
            fill_count: fillCount,
            pnl_usd: null,
            outcome: isMiss ? 'miss' : 'pending',
            dry_run: false,
            order_id: result.placed.order_id ?? null,
            config_snapshot_json: JSON.stringify(result.gate.config_snapshot ?? {}),
          };
          this.trades.insert(trade);
          if (!isMiss) {
            dayCounts.total += 1;
            dayCounts.byAsset[asset] = (dayCounts.byAsset[asset] || 0) + 1;
            // Live count so later assets in this tick respect max_open_positions
            openPositions += 1;
          }
          if (isMiss) {
            const body = `${asset} ${trade.side} · IOC no fill`;
            this.status.lastTradeAction[asset] = {
              status: 'skipped',
              detail: `no fill · IOC miss`,
              at: tickAt,
            };
            this.recordAlert('ioc_miss', 'IOC miss', body);
            await maybeNotify(cfg, 'ioc_miss', 'IOC miss', body);
          } else {
            const body = `${asset} ${trade.side} · ${fillCount} ctr @ $${Number(trade.fill_price ?? 0).toFixed(2)} · cost $${trade.notional_usd.toFixed(2)}`;
            this.status.lastTradeAction[asset] = {
              status: 'placed',
              detail: `filled · ${trade.side} ${fillCount} ctr · $${trade.notional_usd.toFixed(2)}`,
              at: tickAt,
            };
            this.recordAlert('order_filled', 'Order filled', body);
            await maybeNotify(
              snapshotConfig(this.getConfig()),
              'order_filled',
              'Order filled',
              body
            );
            // Cash changes on fill
            await this.refreshCashBalance();
          }
        }
      }

      this.status.lastTickAt = tickAt;
      if (tickErrors.length > 0) {
        const quietOnly = tickErrors.every((e) => isQuietIntegrationError(e));
        const rateLimited = tickErrors.some((e) => isRateLimitError(e));
        const authFailed = tickErrors.some((e) => isAuthError(e));
        if (rateLimited) {
          this.status.lastError = humanizeQuietError('http_429');
        } else if (authFailed) {
          this.status.lastError = humanizeQuietError('http_401');
        } else if (quietOnly) {
          this.status.lastError = humanizeQuietError(tickErrors[0]);
        } else {
          this.status.lastError = tickErrors.slice(0, 3).join(' · ');
        }
        // Always log once; Expo push only for non-quiet errors
        await this.maybeAlertIntegrationError(cfg, this.status.lastError);
      } else if (!authBlocked) {
        this.status.lastError = null;
        this.lastErrorAlertKey = null;
      }
      await this.persistHistory();
    } catch (e: any) {
      this.status.lastError = String(e?.message || e);
      const cfg = this.getConfig();
      await this.maybeAlertHardError(cfg, 'Runtime error', this.status.lastError);
      await this.persistHistory();
    } finally {
      this.tickInFlight = false;
      this.pulseHeartbeat();
    }
  }

  private async tryProtectSellsForAsset(
    asset: AssetKey,
    lean: LeanResult,
    cfg: AppConfig,
    tickAt: string
  ): Promise<void> {
    const market = lean.market_ticker!;
    const held = pendingTradesForMarket(this.trades.list(200), market);
    if (!held.length) return;

    for (const trade of held) {
      const evalRes = shouldProtectSell({
        enabled: cfg.risk.protect_sell_enabled,
        heldSide: trade.side,
        lean,
        cushion: cfg.cushions[asset],
        gapRatio: cfg.risk.protect_sell_gap_ratio,
        filledAt: trade.at,
        graceSeconds: cfg.risk.protect_sell_grace_seconds,
      });
      if (!evalRes.sell) {
        if (evalRes.reason === 'grace_after_fill') {
          this.status.lastTradeAction[asset] = {
            status: 'skipped',
            detail: `protect wait · ${cfg.risk.protect_sell_grace_seconds}s after fill`,
            at: tickAt,
          };
        }
        continue;
      }

      const order = buildProtectSellOrder({
        heldSide: trade.side,
        fillCount: inferFillCount(trade),
        yesBid: lean.yes_bid,
        yesAsk: lean.yes_ask,
        slippageUsd: Math.min(0.05, Number(cfg.risk.chase_above_ask_usd) || 0.02),
      });
      if (!order.ok || !order.side || !order.price || !order.count) {
        this.status.lastTradeAction[asset] = {
          status: 'skipped',
          detail: `no protect sell · ${order.reason || 'quote'}`,
          at: tickAt,
        };
        continue;
      }

      const placed = await this.engine.tryProtectExit({
        ticker: market,
        side: order.side,
        count: order.count,
        price: order.price,
        time_in_force: 'immediate_or_cancel',
      });

      const exitFills = Number(placed.fill_count ?? 0);
      if (!placed.ok || !(exitFills > 0)) {
        this.status.lastTradeAction[asset] = {
          status: 'skipped',
          detail: 'protect sell · no fill (will retry)',
          at: tickAt,
        };
        continue;
      }

      const pnl = computeProtectSellPnlUsd({
        heldSide: trade.side,
        entryPay: Number(trade.fill_price || 0),
        exitEconomic: Number(order.economicExit || 0),
        fillCount: Math.min(inferFillCount(trade), exitFills),
      });
      this.trades.update(trade.id, {
        outcome: 'exited',
        pnl_usd: pnl,
        order_id: placed.order_id ?? trade.order_id,
      });

      const body = `${asset} ${trade.side} · early sell · P&L $${pnl.toFixed(2)} · gap $${evalRes.leanGap.toFixed(2)} (need ≥$${evalRes.minGap.toFixed(2)})`;
      this.status.lastTradeAction[asset] = {
        status: 'placed',
        detail: `protect sell · ${trade.side} exited · $${pnl.toFixed(2)}`,
        at: tickAt,
      };
      this.recordAlert('protect_sell', 'Protect sell', body);
      await maybeNotify(cfg, 'protect_sell', 'Protect sell', body);
      // Exit fill returns cash → refresh Cash card
      await this.refreshCashBalance();
    }
  }

  private async settleOpenTrades(cfg: AppConfig): Promise<number> {
    const client = this.engine.getClient();
    if (!client) return 0;
    const { details } = await settlePendingTrades(this.trades, client);
    for (const d of details) {
      const t = this.trades.list(200).find((x) => x.id === d.id);
      const title = d.outcome === 'win' ? 'Trade won' : 'Trade lost';
      const body = t
        ? `${t.asset} ${t.side} · P&L $${d.pnl_usd.toFixed(2)} · ${t.market_ticker}`
        : `P&L $${d.pnl_usd.toFixed(2)}`;
      this.recordAlert('trade_result', title, body);
      await maybeNotify(cfg, 'trade_result', title, body);
    }
    if (details.length > 0) {
      // Today snapshot (wins/losses/P&L) + Predictions total after settlement
      this.onChange?.();
      await this.refreshPredictionsBalance();
    }
    return details.length;
  }

  recordAlert(kind: string, title: string, body: string, source?: string) {
    const row: AlertRecord = {
      id: rid(),
      at: new Date().toISOString(),
      kind,
      title,
      body,
      read: false,
      source: source || 'local',
    };
    const inserted = this.alerts.insert(row);
    if (!inserted) return;
    void this.persistHistory();
    this.onChange?.();
  }

  private pushAlert(cfg: AppConfig, kind: any, title: string, body: string) {
    this.recordAlert(kind, title, body);
    void maybeNotify(cfg, kind, title, body);
  }
}

let singleton: AppRuntime | null = null;

export function getAppRuntime(
  getConfig: () => AppConfig,
  onChange?: () => void
): AppRuntime {
  if (!singleton) {
    singleton = new AppRuntime({ getConfig, onChange });
  }
  return singleton;
}

export function resetAppRuntimeForTests(): void {
  singleton?.stop();
  singleton = null;
}

import { AppConfig, AssetKey } from '../config/types';
import { snapshotConfig } from '../config/normalize';
import { TradingEngine } from '../engine/TradingEngine';
import { formatSkipReason, isCountableWindowBuy } from '../../packages/trading-core/src/gates';
import { LastTradeAction as CloudLastTradeAction } from '../../packages/trading-core/src/types';
import { KalshiClient } from '../services/kalshi/client';
import { loadCredentials } from '../services/credentials';
import { computeLean, LeanResult } from '../services/lean/lean';
import { isMarketOpen } from '../services/marketHours';
import { maybeNotify } from '../services/notifications';
import { cloudClient } from '../services/cloud/cloudClient';
import { MemoryAlertRepo, MemoryTradeRepo, TradeRecord, AlertRecord, cloudTradesToRecords, cloudAlertsToRecords } from '../storage/repos';
import { hydrateRepos, persistRepos } from '../storage/historyPersistence';
import { loadPortfolioSamples, persistPortfolioSamples } from '../storage/portfolioPersistence';
import { settlePendingTrades, inferFillCount, computeTradePnlUsd } from '../services/settlement';
import {
  PortfolioSample,
  computeChange24h,
  recordPortfolioSample,
} from '../services/portfolioChange';
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
  /** Predictions total now minus a stored sample from ~24h ago. Null until enough history. */
  change24hUsd: number | null;
  change24hPct: number | null;
  /** Age of the baseline sample. Null until a change can be shown. */
  change24hWindowMs: number | null;
}

export { formatSkipReason };

/**
 * Foreground lean/settlement/alert loop. This phone never places orders —
 * Cloud Run owns Auto-trade buys and Protect money sells.
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
    change24hUsd: null,
    change24hPct: null,
    change24hWindowMs: null,
  };

  private portfolioSamples: PortfolioSample[] = [];

  private timer: ReturnType<typeof setInterval> | null = null;
  private getConfig: () => AppConfig;
  private onChange?: () => void;
  private fetchImpl: typeof fetch;
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
    if (!opts?.force && now < this.rateLimitUntilMs) return;
    if (!opts?.force && now < this.authBlockedUntilMs) return;
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
        this.status.change24hUsd = null;
        this.status.change24hPct = null;
        this.status.change24hWindowMs = null;
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
          if (this.status.predictionsBalanceUsd != null) {
            this.portfolioSamples = recordPortfolioSample(this.portfolioSamples, {
              at: new Date().toISOString(),
              predictionsUsd: this.status.predictionsBalanceUsd,
              cashUsd: cash,
            });
            void persistPortfolioSamples(this.portfolioSamples);
          }
          this.applyChange24h();
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

  syncCloudTrades(cloudTrades: any[]): void {
    if (!Array.isArray(cloudTrades) || cloudTrades.length === 0) return;
    const records = cloudTradesToRecords(cloudTrades);
    for (const r of records) {
      this.trades.upsert(r);
    }
    void this.persistHistory();
    this.onChange?.();
  }

  syncCloudAlerts(cloudAlerts: any[]): void {
    if (!Array.isArray(cloudAlerts)) return;
    let inserted = 0;
    for (const r of cloudAlertsToRecords(cloudAlerts)) {
      if (this.alerts.insert(r)) inserted += 1;
    }
    const dropped = this.alerts.dropInvalidLeans();
    if (inserted === 0 && dropped === 0) return;
    void this.persistHistory();
    this.onChange?.();
  }

  /** Cloud Run owns skip/place reasons. Phone Last signals only displays them. */
  syncCloudTradeActions(actions: Partial<Record<string, CloudLastTradeAction>> | undefined): void {
    if (this.status.killSwitch) return;
    if (actions == null || typeof actions !== 'object') return;
    const next: Partial<Record<AssetKey, LastTradeAction>> = {};
    for (const [asset, action] of Object.entries(actions)) {
      if (!action || typeof action !== 'object') continue;
      const status = action.status;
      if (status !== 'placed' && status !== 'skipped' && status !== 'failed') continue;
      const detail = String(action.detail || '').trim();
      if (!detail) continue;
      next[asset] = { status, detail, at: String(action.at || '') };
    }
    const prev = this.status.lastTradeAction;
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    const same =
      prevKeys.length === nextKeys.length &&
      nextKeys.every((asset) => {
        const a = prev[asset];
        const b = next[asset];
        return !!a && !!b && a.status === b.status && a.detail === b.detail && a.at === b.at;
      });
    if (same) return;
    this.status.lastTradeAction = next;
    this.onChange?.();
  }

  async hydrateHistory(): Promise<void> {
    const days = this.getConfig().alert_retention_days ?? 30;
    await hydrateRepos(this.trades, this.alerts, days);
    // Recalculate/normalize fill prices and pnl_usd for existing hydrated trades
    for (const t of this.trades.list(200)) {
      if (t.fill_price != null && Number.isFinite(t.fill_price)) {
        const normPay = t.fill_price > 1 ? t.fill_price / 100 : t.fill_price;
        if (normPay > 0 && (t.outcome === 'win' || t.outcome === 'loss')) {
          const fillCount = inferFillCount(t);
          const correctPnl = computeTradePnlUsd({
            side: t.side,
            payPrice: normPay,
            fillCount,
            marketResult:
              t.outcome === 'win'
                ? t.side === 'YES'
                  ? 'yes'
                  : 'no'
                : t.side === 'YES'
                  ? 'no'
                  : 'yes',
          });
          if (t.pnl_usd !== correctPnl || t.fill_price !== normPay) {
            this.trades.update(t.id, { pnl_usd: correctPnl, fill_price: normPay });
          }
        }
      }
    }
    // Count actual buys per 15m ticker so a second buy can use remaining window cap
    this.engine.windows.clear();
    for (const t of this.trades.list(200)) {
      if (!isCountableWindowBuy(t) || !t.market_ticker) continue;
      this.engine.windows.claimExisting(t.market_ticker, t.order_id || t.id || 'hydrated');
    }
    this.portfolioSamples = await loadPortfolioSamples();
    this.applyChange24h();
    this.onChange?.();
  }

  private applyChange24h(): void {
    const ch = computeChange24h(this.portfolioSamples, this.status.predictionsBalanceUsd);
    this.status.change24hUsd = ch?.usd ?? null;
    this.status.change24hPct = ch?.pct ?? null;
    this.status.change24hWindowMs = ch?.windowMs ?? null;
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
    // Same window on Cloud so GET /me/alerts cannot restore pruned rows.
    void cloudClient.pruneAlerts(days);
    return removed;
  }

  /** Delete alerts by ids and persist the updated history immediately. */
  async deleteAlertsByIds(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const removed = this.alerts.deleteByIds(ids);
    await this.persistHistory();
    this.onChange?.();
    // Cloud still has the rows; dismiss so the next GET /me/alerts cannot restore them.
    void cloudClient.dismissAlerts(ids);
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

  private lastOnChangeMs = 0;

  /** Keep Home heartbeat Live during long multi-asset ticks without spamming UI re-renders. */
  private pulseHeartbeat(forceNotify = false): void {
    this.status.lastPulseAt = new Date().toISOString();
    const now = Date.now();
    if (forceNotify || now - this.lastOnChangeMs >= 1500) {
      this.lastOnChangeMs = now;
      this.onChange?.();
    }
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
          await this.settleOpenTrades();
          this.pulseHeartbeat();
        } catch {
          /* settlement best-effort */
        }
      }

      const tickAt = new Date().toISOString();

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
          continue;
        }
        if (!lean.market_ticker) {
          if (open) {
            this.noteAssetError(asset, 'no market ticker', tickErrors);
          }
          continue;
        }
        if (lean.live == null || !Number.isFinite(lean.live)) {
          this.noteAssetError(asset, 'live price missing', tickErrors);
          continue;
        }

        // Clear prior asset error on success path for this asset
        delete this.status.assetErrors[asset];

        // Buys, sells, skip reasons, and trading History are owned by Cloud Run.
        // Home shows lastLeans locally; lastTradeAction arrives via syncCloudTradeActions.

        if (this.status.killSwitch) {
          this.status.lastTradeAction[asset] = {
            status: 'skipped',
            detail: 'skipped · kill switch',
            at: tickAt,
          };
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
      await this.pullCloudAlerts();
    } catch (e: any) {
      this.status.lastError = String(e?.message || e);
      const cfg = this.getConfig();
      await this.maybeAlertHardError(cfg, 'Runtime error', this.status.lastError);
      await this.persistHistory();
    } finally {
      this.tickInFlight = false;
      this.pulseHeartbeat(true);
    }
  }

  /** Pull Cloud History + skip reasons after a Home tick. */
  private async pullCloudAlerts(): Promise<void> {
    try {
      const [alertsRes, statusRes] = await Promise.all([
        cloudClient.getAlerts(),
        cloudClient.getStatus(),
      ]);
      if (alertsRes.ok && Array.isArray(alertsRes.alerts)) {
        this.syncCloudAlerts(alertsRes.alerts);
      }
      if (statusRes.ok) {
        this.syncCloudTradeActions(statusRes.userDoc?.lastTradeAction);
      }
    } catch {
      /* keep local History */
    }
  }

  /** Update local fill outcomes from Kalshi. Trade won/lost History is Cloud-owned. */
  private async settleOpenTrades(): Promise<number> {
    const client = this.engine.getClient();
    if (!client) return 0;
    const { details } = await settlePendingTrades(this.trades, client);
    if (details.length > 0) {
      // Today snapshot (wins/losses/P&L) + Predictions total after settlement
      this.onChange?.();
      await this.refreshPredictionsBalance();
    }
    return details.length;
  }

  recordAlert(kind: string, title: string, body: string, source?: string, id?: string) {
    const row: AlertRecord = {
      id: String(id || '').trim() || rid(),
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

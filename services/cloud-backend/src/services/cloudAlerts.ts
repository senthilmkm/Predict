import { CloudAlertDoc, TradeRecordDoc, saveAlertRecord } from './firestore';
import { fillPushEnabled, leanPushEnabled } from './leanAlerts';
import { protectPushEnabled } from './cloudProtectSell';
import { sendPushNotification } from './notifications';

const MONEY_KINDS = new Set([
  'order_filled',
  'ioc_miss',
  'protect_sell',
  'trade_result',
  'daily_loss_stop',
]);

export function leanAlertId(ticker: string, decision: string): string {
  return `lean:${String(ticker || '').trim()}:${String(decision || '').toUpperCase()}`;
}

export function fillAlertId(tradeId: string): string {
  return `fill:${String(tradeId || '').trim()}`;
}

export function missAlertId(tradeId: string): string {
  return `miss:${String(tradeId || '').trim()}`;
}

export function protectAlertId(tradeId: string): string {
  return `protect:${String(tradeId || '').trim()}`;
}

export function settleAlertId(tradeId: string): string {
  return `settle:${String(tradeId || '').trim()}`;
}

export function dailyLossAlertId(etDay: string): string {
  return `dailyloss:${String(etDay || '').trim()}`;
}

/** One row per America/New_York day. Trigger matches the buy gate: pnl ≤ −|stop|. */
export function dailyLossAlertFromPnl(opts: {
  dailyPnlUsd: number;
  stopUsd: number;
  etDay: string;
}): { alertId: string; title: string; body: string; dailyPnlUsd: number; stopUsd: number } | null {
  const dailyPnlUsd = Math.round(Number(opts.dailyPnlUsd) * 100) / 100;
  const stopUsd = Math.round(Math.abs(Number(opts.stopUsd)) * 100) / 100;
  const day = String(opts.etDay || '').trim();
  if (!day || !Number.isFinite(dailyPnlUsd) || !Number.isFinite(stopUsd) || stopUsd <= 0) {
    return null;
  }
  if (dailyPnlUsd > -stopUsd) return null;
  return {
    alertId: dailyLossAlertId(day),
    title: 'Daily loss stop',
    body: `New buys paused · realized P&L $${dailyPnlUsd.toFixed(2)} today (stop $${stopUsd.toFixed(2)})`,
    dailyPnlUsd,
    stopUsd,
  };
}

/** Retry window so a failed alert write after settlement is not lost forever. */
export const SETTLEMENT_ALERT_LOOKBACK_MS = 2 * 60 * 60 * 1000;

/** Same title/body as a phone Trade won/lost row. alertId is idempotent. */
export function settlementAlertFromTrade(
  trade: TradeRecordDoc,
  now: Date
): { alertId: string; title: string; body: string; pnlUsd: number } | null {
  if (!trade || trade.dryRun) return null;
  if (trade.outcome !== 'win' && trade.outcome !== 'loss') return null;
  const settledAt = new Date(String(trade.settledAt || '')).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(settledAt) || !Number.isFinite(nowMs)) return null;
  if (nowMs - settledAt > SETTLEMENT_ALERT_LOOKBACK_MS) return null;
  if (settledAt > nowMs + 60_000) return null;
  const pnlUsd = Math.round(Number(trade.pnlUsd || 0) * 100) / 100;
  if (!Number.isFinite(pnlUsd)) return null;
  const title = trade.outcome === 'win' ? 'Trade won' : 'Trade lost';
  const body = `${trade.asset} ${trade.decision} · P&L $${pnlUsd.toFixed(2)} · ${trade.ticker}`;
  return { alertId: settleAlertId(trade.tradeId), title, body, pnlUsd };
}

export function alertKindEnabled(cfg: any, kind: string): boolean {
  const pref = cfg?.alert_prefs?.[kind];
  if (pref && pref.enabled === false) return false;
  return true;
}

/** Mute (push: false) still persists. Money events persist even if Alerts is Off. */
export function alertPersistEnabled(cfg: any, kind: string): boolean {
  if (MONEY_KINDS.has(kind)) return true;
  if (cfg?.alerts_enabled === false) return false;
  return alertKindEnabled(cfg, kind);
}

export function alertPushEnabled(cfg: any, kind: string): boolean {
  if (kind === 'lean_signal') return leanPushEnabled(cfg);
  if (kind === 'order_filled') return fillPushEnabled(cfg);
  if (kind === 'protect_sell') return protectPushEnabled(cfg);
  if (!cfg || cfg.alerts_enabled === false) return false;
  const pref = cfg.alert_prefs?.[kind];
  if (pref && (pref.enabled === false || pref.push === false)) return false;
  return true;
}

export async function emitCloudAlert(opts: {
  userId: string;
  alertId: string;
  kind: string;
  title: string;
  body: string;
  cfg: any;
  tokens: string[];
  collapseId?: string;
  asset?: string;
  ticker?: string;
  tradeId?: string;
  decision?: string;
  at?: string;
  sendPush?: typeof sendPushNotification;
}): Promise<{ persisted: boolean; pushed: boolean }> {
  const persist = alertPersistEnabled(opts.cfg, opts.kind);
  const push = alertPushEnabled(opts.cfg, opts.kind) && Array.isArray(opts.tokens) && opts.tokens.length > 0;
  if (!persist && !push) return { persisted: false, pushed: false };

  const alertId = String(opts.alertId || '').trim();
  if (!alertId) return { persisted: false, pushed: false };

  let persisted = false;
  if (persist) {
    const doc: CloudAlertDoc = {
      alertId,
      userId: opts.userId,
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
      at: opts.at || new Date().toISOString(),
      source: 'gcp',
      asset: opts.asset,
      ticker: opts.ticker,
      tradeId: opts.tradeId,
      decision: opts.decision,
    };
    const saved = await saveAlertRecord(opts.userId, doc);
    persisted = saved === 'created' || saved === 'exists';
    // Retry of the same alertId must not ding again.
    if (saved !== 'created') {
      return { persisted, pushed: false };
    }
  }

  if (push) {
    const send = opts.sendPush || sendPushNotification;
    // Write has already finished. Do not await Expo — a slow push must not stall the tick.
    void send(
      opts.tokens,
      opts.title,
      opts.body,
      {
        alertId,
        kind: opts.kind,
        type: opts.kind,
        source: 'gcp',
        ...(opts.asset ? { asset: opts.asset } : {}),
        ...(opts.ticker ? { ticker: opts.ticker } : {}),
        ...(opts.tradeId ? { tradeId: opts.tradeId } : {}),
        ...(opts.decision ? { decision: opts.decision } : {}),
      },
      opts.collapseId ? { collapseId: opts.collapseId } : undefined
    );
    return { persisted, pushed: true };
  }

  return { persisted, pushed: false };
}

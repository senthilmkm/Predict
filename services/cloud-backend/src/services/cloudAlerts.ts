import { parseTradeEntryPath } from '../../../../packages/trading-core/src/cashOut';
import { CloudAlertDoc, TradeRecordDoc, saveAlertRecord, updateTradeRecord } from './firestore';
import {
  claimLeanAlert,
  fillPushEnabled,
  leanAlertKey,
  leanAlertPushTokens,
  leanCollapseId,
  leanPushEnabled,
  type LeanAlertsSent,
} from './leanAlerts';
import { protectPushEnabled } from './cloudProtectSell';
import { sendPushNotification } from './notifications';

export function orderPlacedPathTag(
  raw: unknown
): 'Home' | 'Auto' | 'Cash out' | 'Gold fade' | 'TWAP lock' | 'Last-minute' | null {
  const parsed = parseTradeEntryPath(raw);
  if (parsed === 'home') return 'Home';
  if (parsed === 'auto') return 'Auto';
  if (parsed === 'cash_out') return 'Cash out';
  if (parsed === 'gold_fade') return 'Gold fade';
  if (parsed === 'twap_lock') return 'TWAP lock';
  if (parsed === 'last_minute') return 'Last-minute';
  return null;
}

export function pathTaggedAlertTitle(base: string, entryPath?: unknown): string {
  const tag = orderPlacedPathTag(entryPath);
  return tag ? `${base} · ${tag}` : base;
}

export function orderPlacedAlertTitle(opts: {
  live: boolean;
  asset: string;
  decision: string;
  entryPath?: unknown;
}): string {
  const prefix = opts.live ? 'Order Placed' : 'Dry-Run Order';
  const tag = orderPlacedPathTag(opts.entryPath);
  const rest = `${opts.asset} ${opts.decision}`.trim();
  return tag ? `${prefix} · ${tag} · ${rest}` : `${prefix} · ${rest}`;
}

export function iocMissAlertTitle(entryPath?: unknown): string {
  return pathTaggedAlertTitle('IOC miss', entryPath);
}

export function iocMissAlertBody(opts: { asset: string; decision: string; entryPath?: unknown }): string {
  const tag = orderPlacedPathTag(opts.entryPath);
  const rest = `${opts.asset} ${opts.decision} · IOC no fill`.trim();
  return tag ? `${tag} · ${rest}` : rest;
}

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

/** History/push leans are live YES/NO only — never SKIP or a derived side. */
export function leanAlertSide(lean: {
  decision?: string;
  phase?: string;
}): 'YES' | 'NO' | null {
  if (String(lean.phase || '') !== 'live') return null;
  const decision = String(lean.decision || '').toUpperCase();
  if (decision === 'YES' || decision === 'NO') return decision;
  return null;
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

/** Same title/body as a phone Trade won/lost row. Retry until settlementAlertAt is stamped. */
export function settlementAlertFromTrade(
  trade: TradeRecordDoc,
  now: Date
): { alertId: string; title: string; body: string; pnlUsd: number } | null {
  if (!trade || trade.dryRun) return null;
  if (trade.outcome !== 'win' && trade.outcome !== 'loss') return null;
  if (String(trade.settlementAlertAt || '').trim()) return null;
  const settledAt = new Date(String(trade.settledAt || '')).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(settledAt) || !Number.isFinite(nowMs)) return null;
  if (settledAt > nowMs + 60_000) return null;
  const pnlUsd = Math.round(Number(trade.pnlUsd || 0) * 100) / 100;
  if (!Number.isFinite(pnlUsd)) return null;
  const title = pathTaggedAlertTitle(
    trade.outcome === 'win' ? 'Trade won' : 'Trade lost',
    trade.entryPath
  );
  const tag = orderPlacedPathTag(trade.entryPath);
  const body = `${tag ? `${tag} · ` : ''}${trade.asset} ${trade.decision} · P&L $${pnlUsd.toFixed(2)} · ${trade.ticker}`;
  return { alertId: settleAlertId(trade.tradeId), title, body, pnlUsd };
}

/** Persist Trade won/lost, then stamp the trade so later ticks do not re-emit. */
export async function persistSettlementAlertIfNeeded(opts: {
  userId: string;
  trade: TradeRecordDoc;
  now: Date;
  cfg: any;
  tokens: string[];
  sendPush?: typeof sendPushNotification;
}): Promise<{ persisted: boolean; pushed: boolean }> {
  const settled = settlementAlertFromTrade(opts.trade, opts.now);
  if (!settled) return { persisted: false, pushed: false };
  const emitted = await emitCloudAlert({
    userId: opts.userId,
    alertId: settled.alertId,
    kind: 'trade_result',
    title: settled.title,
    body: settled.body,
    cfg: opts.cfg,
    tokens: opts.tokens,
    asset: opts.trade.asset,
    ticker: opts.trade.ticker,
    tradeId: opts.trade.tradeId,
    decision: opts.trade.decision,
    at: opts.now.toISOString(),
    sendPush: opts.sendPush,
  });
  if (emitted.persisted) {
    const stamped = opts.now.toISOString();
    opts.trade.settlementAlertAt = stamped;
    await updateTradeRecord(opts.userId, opts.trade.tradeId, { settlementAlertAt: stamped });
  }
  return emitted;
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

/** Only a real signal (gap ≥ cushion, YES/NO) belongs on the Alerts hub. */
export async function maybeEmitLeanAlert(opts: {
  userId: string;
  cfg: any;
  tokens: string[];
  asset: string;
  ticker: string;
  decision: string;
  absGap: number;
  cushion: number;
  minutesLeft: number | string;
  leanAlertsSent: LeanAlertsSent;
  now: Date;
  sendPush?: typeof sendPushNotification;
}): Promise<{ next: LeanAlertsSent; dirty: boolean; persisted: boolean; pushed: boolean }> {
  const ticker = String(opts.ticker || '').trim();
  const decision = String(opts.decision || '').toUpperCase();
  const key = leanAlertKey(ticker, decision);
  const persist = alertPersistEnabled(opts.cfg, 'lean_signal');
  const pushOk = leanPushEnabled(opts.cfg) && Array.isArray(opts.tokens) && opts.tokens.length > 0;
  if (decision !== 'YES' && decision !== 'NO') {
    return { next: opts.leanAlertsSent, dirty: false, persisted: false, pushed: false };
  }
  if (!(Number(opts.absGap) >= Number(opts.cushion))) {
    return { next: opts.leanAlertsSent, dirty: false, persisted: false, pushed: false };
  }
  const minutesLeft = Number(opts.minutesLeft);
  if (Number.isFinite(minutesLeft) && minutesLeft <= 0) {
    return { next: opts.leanAlertsSent, dirty: false, persisted: false, pushed: false };
  }
  if ((!persist && !pushOk) || !ticker || opts.leanAlertsSent[key]) {
    return { next: opts.leanAlertsSent, dirty: false, persisted: false, pushed: false };
  }

  const pushTokens = leanAlertPushTokens(opts.absGap, opts.cushion, opts.tokens);
  const title = `Signal · ${opts.asset} ${decision}`;
  const body = `Gap $${Number(opts.absGap).toFixed(2)} · Cushion $${opts.cushion} · ${opts.minutesLeft ?? '?'}m left`;
  const emitted = await emitCloudAlert({
    userId: opts.userId,
    alertId: leanAlertId(ticker, decision),
    kind: 'lean_signal',
    title,
    body,
    cfg: opts.cfg,
    tokens: pushTokens,
    collapseId: leanCollapseId(opts.userId, key),
    asset: opts.asset,
    ticker,
    decision,
    at: opts.now.toISOString(),
    sendPush: opts.sendPush,
  });
  if (emitted.persisted || emitted.pushed) {
    const claim = claimLeanAlert(opts.leanAlertsSent, ticker, decision, opts.now);
    return { next: claim.next, dirty: true, persisted: emitted.persisted, pushed: emitted.pushed };
  }
  return { next: opts.leanAlertsSent, dirty: false, persisted: false, pushed: false };
}

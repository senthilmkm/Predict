import { TradeRecordDoc } from './firestore';
import { cloudDailyRealizedPnl } from './settlement';

/** Live Kalshi order that received at least one fill (buy or protect-sell exit). */
export function isLiveFilledTrade(t: TradeRecordDoc): boolean {
  if (t.dryRun) return false;
  if (t.outcome === 'miss') return false;
  const fillCount = Number(t.fillCount);
  if (Number.isFinite(fillCount)) return fillCount > 0;
  return t.status === 'FILLED' || t.status === 'SETTLED';
}

export function computeOverviewTradeMetrics(
  trades: TradeRecordDoc[],
  nowMs = Date.now()
): {
  trades24hCount: number;
  filled24hCount: number;
  volumeUsd24h: number;
} {
  const last24h = nowMs - 24 * 60 * 60 * 1000;
  const live24h = trades.filter((t) => {
    if (t.dryRun) return false;
    const at = new Date(t.executedAt || 0).getTime();
    return Number.isFinite(at) && at >= last24h;
  });
  const filled24h = live24h.filter(isLiveFilledTrade);
  const volumeUsd24h = filled24h.reduce((acc, t) => acc + (Number(t.notionalUsd) || 0), 0);
  return {
    trades24hCount: live24h.length,
    filled24hCount: filled24h.length,
    volumeUsd24h: Math.round(volumeUsd24h * 100) / 100,
  };
}

export function workerHealthStatus(
  lastTickAt: string | null | undefined,
  staleTimeoutSeconds: number,
  nowMs = Date.now()
): 'ACTIVE' | 'STALE' | 'IDLE' {
  if (!lastTickAt) return 'IDLE';
  const t = new Date(lastTickAt).getTime();
  if (!Number.isFinite(t)) return 'IDLE';
  const staleMs = Math.max(30, Number(staleTimeoutSeconds) || 120) * 1000;
  return nowMs - t <= staleMs ? 'ACTIVE' : 'STALE';
}

export const TRADE_STREAM_DISPLAY_DEFAULT = 200;
export const TRADE_STREAM_DISPLAY_MAX = 500;

export interface TradeStreamFilters {
  asset?: string;
  status?: string;
  userId?: string;
  fromMs?: number;
  toMs?: number;
}

/** Date-only values are UTC day bounds so filters do not shift with the server timezone. */
export function parseTimeBound(raw: unknown, asEndOfDay = false): number | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const iso = asEndOfDay ? `${s}T23:59:59.999Z` : `${s}T00:00:00.000Z`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : undefined;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

export function parseTradeStreamQuery(query: Record<string, unknown> | undefined): TradeStreamFilters & {
  limit: number;
} {
  const q = query || {};
  const asset = String(q.asset || '').trim();
  const status = String(q.status || '').trim().toUpperCase();
  const userId = String(q.userId || q.q || '').trim();
  let limit = Number(q.limit);
  if (!Number.isFinite(limit)) limit = TRADE_STREAM_DISPLAY_DEFAULT;
  limit = Math.min(TRADE_STREAM_DISPLAY_MAX, Math.max(1, Math.round(limit)));
  return {
    asset: asset || undefined,
    status: status && status !== 'ALL' ? status : undefined,
    userId: userId || undefined,
    fromMs: parseTimeBound(q.from, false),
    toMs: parseTimeBound(q.to, true),
    limit,
  };
}

export function tradeMatchesFilters(t: TradeRecordDoc, f: TradeStreamFilters): boolean {
  if (f.asset && String(t.asset || '') !== f.asset) return false;
  if (f.status && String(t.status || '').toUpperCase() !== f.status) return false;
  if (f.userId) {
    if (!String(t.userId || '').toLowerCase().includes(f.userId.toLowerCase())) return false;
  }
  const at = Date.parse(t.executedAt || '');
  if (!Number.isFinite(at)) {
    if (f.fromMs != null || f.toMs != null) return false;
    return true;
  }
  if (f.fromMs != null && at < f.fromMs) return false;
  if (f.toMs != null && at > f.toMs) return false;
  return true;
}

export function realizedPnlForDisplay(t: TradeRecordDoc): number | null {
  if (t.status !== 'SETTLED' && t.outcome !== 'win' && t.outcome !== 'loss' && t.outcome !== 'exited') {
    return null;
  }
  const n = Number(t.pnlUsd);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function buildTradeStreamResult(
  trades: TradeRecordDoc[],
  filters: TradeStreamFilters,
  limit = TRADE_STREAM_DISPLAY_DEFAULT
): {
  matchedCount: number;
  displayedCount: number;
  truncated: boolean;
  totalPnlUsd: number;
  trades: TradeRecordDoc[];
} {
  const matched = trades.filter((t) => tradeMatchesFilters(t, filters));
  matched.sort((a, b) => Date.parse(b.executedAt || '') - Date.parse(a.executedAt || ''));
  const liveMatched = matched.filter((t) => !t.dryRun);
  const cap = Math.min(TRADE_STREAM_DISPLAY_MAX, Math.max(1, Math.round(limit)));
  const shown = matched.slice(0, cap);
  return {
    matchedCount: matched.length,
    displayedCount: shown.length,
    truncated: matched.length > cap,
    totalPnlUsd: cloudDailyRealizedPnl(liveMatched),
    trades: shown,
  };
}

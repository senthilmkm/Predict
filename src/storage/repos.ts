import { etDateKey } from '../util/time';

export type TradeSide = 'YES' | 'NO';
export type TradeOutcome = 'win' | 'loss' | 'pending' | 'miss' | 'dry_run' | 'exited';
export type TradeEntryPath = 'home' | 'auto';

/** Home tap vs Auto-trade worker. Missing on legacy fills — do not guess. */
export function parseEntryPath(raw: unknown): TradeEntryPath | undefined {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim();
  if (v === 'home' || v === 'manual_buy' || v === 'manual') return 'home';
  if (v === 'auto' || v === 'auto_trade' || v === 'worker') return 'auto';
  return undefined;
}

export interface TradeRecord {
  id: string;
  at: string;
  asset: string;
  market_ticker: string;
  side: TradeSide;
  notional_usd: number;
  fill_price?: number | null;
  /** Contracts filled (0 = IOC miss). */
  fill_count?: number | null;
  pnl_usd?: number | null;
  outcome: TradeOutcome;
  dry_run: boolean;
  order_id?: string | null;
  config_snapshot_json?: string;
  /** Set on new fills. Protect/Home sell keeps the original buy path. */
  entry_path?: TradeEntryPath | null;
}

export interface AlertRecord {
  id: string;
  at: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  source?: string;
}

export interface DashboardStats {
  wins: number;
  losses: number;
  pending: number;
  misses: number;
  dry_runs: number;
  realized_pnl_usd: number;
  win_rate: number | null;
}

/** Same Kalshi fill from phone + Cloud Run (ids and timestamps almost never match exactly). */
export const TRADE_DEDUP_WINDOW_MS = 3 * 60 * 1000;

export function isSameTradeRecord(a: TradeRecord, b: TradeRecord): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  const oa = (a.order_id || '').trim();
  const ob = (b.order_id || '').trim();
  if (oa && ob) return oa === ob;
  const tickerA = (a.market_ticker || '').trim();
  const tickerB = (b.market_ticker || '').trim();
  if (!tickerA || tickerA !== tickerB) return false;
  if (a.side && b.side && a.side !== b.side) return false;
  const ta = new Date(a.at).getTime();
  const tb = new Date(b.at).getTime();
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    return Math.abs(ta - tb) <= TRADE_DEDUP_WINDOW_MS;
  }
  return a.at === b.at;
}

function isFinalOutcome(outcome: TradeOutcome | undefined): boolean {
  return outcome === 'win' || outcome === 'loss' || outcome === 'exited' || outcome === 'miss';
}

function pickFillCount(existing: TradeRecord, incoming: TradeRecord): number | null | undefined {
  const e = existing.fill_count;
  const n = incoming.fill_count;
  if (e != null && Number(e) > 1 && (n == null || Number(n) === 1)) return e;
  if (n != null && Number.isFinite(Number(n))) return Number(n);
  return e;
}

export class MemoryTradeRepo {
  private trades: TradeRecord[] = [];

  insert(row: TradeRecord): void {
    this.trades.unshift(row);
  }

  upsert(row: TradeRecord): void {
    const i = this.trades.findIndex((t) => isSameTradeRecord(t, row));
    if (i >= 0) {
      const existing = this.trades[i];
      const isAlreadyFinalized = isFinalOutcome(existing.outcome);
      const incomingWeak =
        row.outcome === 'pending' || row.outcome == null || (isAlreadyFinalized && !isFinalOutcome(row.outcome));
      const outcome = isAlreadyFinalized && incomingWeak ? existing.outcome : row.outcome;
      const incomingPnlMissing = row.pnl_usd == null;
      const pnl_usd =
        isAlreadyFinalized && (incomingWeak || incomingPnlMissing) ? existing.pnl_usd : (row.pnl_usd ?? existing.pnl_usd);
      this.trades[i] = {
        ...existing,
        ...row,
        id: existing.id,
        at: existing.at,
        order_id: existing.order_id || row.order_id,
        fill_count: pickFillCount(existing, row),
        fill_price: existing.fill_price ?? row.fill_price,
        entry_path: existing.entry_path ?? row.entry_path,
        outcome,
        pnl_usd,
      };
    } else {
      this.trades.unshift(row);
    }
  }

  update(id: string, patch: Partial<TradeRecord>): boolean {
    const i = this.trades.findIndex((t) => t.id === id);
    if (i < 0) return false;
    this.trades[i] = { ...this.trades[i], ...patch };
    return true;
  }

  list(limit = 100): TradeRecord[] {
    return this.trades.slice(0, limit);
  }

  /** Full book — Dashboard today-by-asset must not depend on the History 100-row slice. */
  all(): TradeRecord[] {
    return this.trades.slice();
  }

  pendingFilled(): TradeRecord[] {
    return this.trades.filter(
      (t) => !t.dry_run && t.outcome === 'pending' && Number(t.fill_count ?? 1) > 0
    );
  }

  /** All-time stats, or only trades matching predicate (e.g. today ET). */
  stats(predicate?: (t: TradeRecord) => boolean): DashboardStats {
    let wins = 0;
    let losses = 0;
    let pending = 0;
    let misses = 0;
    let dry_runs = 0;
    let realized = 0;
    for (const t of this.trades) {
      if (predicate && !predicate(t)) continue;
      if (t.dry_run || t.outcome === 'dry_run') {
        dry_runs += 1;
        continue;
      }
      if (t.outcome === 'win') {
        wins += 1;
        realized += Number(t.pnl_usd || 0);
      } else if (t.outcome === 'loss') {
        losses += 1;
        realized += Number(t.pnl_usd || 0);
      } else if (t.outcome === 'exited') {
        // Early protect-sell: count toward decided P&L like a closed trade
        if (Number(t.pnl_usd || 0) >= 0) wins += 1;
        else losses += 1;
        realized += Number(t.pnl_usd || 0);
      } else if (t.outcome === 'pending' && Number(t.fill_count ?? 1) > 0) {
        pending += 1;
      } else if (t.outcome === 'miss' || (t.outcome === 'pending' && Number(t.fill_count ?? 1) <= 0)) {
        misses += 1;
      }
    }
    const decided = wins + losses;
    return {
      wins,
      losses,
      pending,
      misses,
      dry_runs,
      realized_pnl_usd: Math.round(realized * 100) / 100,
      win_rate: decided === 0 ? null : Math.round((wins / decided) * 1000) / 1000,
    };
  }

  /** Realized + open filled trades for America/New_York calendar day. */
  statsToday(now = new Date()): DashboardStats {
    const day = etDateKey(now);
    return this.stats((t) => {
      try {
        return etDateKey(new Date(t.at)) === day;
      } catch {
        return false;
      }
    });
  }

  clear(): void {
    this.trades = [];
  }
}

function dollarsPrice(raw: unknown): number | null {
  const n = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1 ? Math.round((n / 100) * 10000) / 10000 : n;
}

export function cloudTradesToRecords(cloudTrades: any[]): TradeRecord[] {
  return (cloudTrades || []).filter((ct) => ct && typeof ct === 'object').map((ct) => {
    const economic = dollarsPrice(ct.payPrice ?? ct.pay_price) ?? dollarsPrice(ct.price);
    const countRaw = ct.fillCount ?? ct.fill_count ?? ct.count;
    const fillCount =
      countRaw != null && String(countRaw).trim() !== '' && Number.isFinite(Number(countRaw))
        ? Number(countRaw)
        : null;
    const pnl =
      ct.pnlUsd != null ? Number(ct.pnlUsd) : ct.pnl_usd != null ? Number(ct.pnl_usd) : null;
    const settled = ct.status === 'SETTLED' || ct.outcome === 'win' || ct.outcome === 'loss';
    const cancelled = ct.status === 'CANCELLED';
    let outcome: TradeOutcome;
    if (ct.outcome === 'exiting') {
      outcome = 'pending';
    } else if (ct.outcome) {
      outcome = ct.outcome;
    } else if (settled && pnl != null) {
      outcome = pnl >= 0 ? 'win' : 'loss';
    } else if (settled) {
      outcome = 'pending';
    } else if (cancelled || (fillCount != null && fillCount <= 0)) {
      outcome = 'miss';
    } else if (ct.status === 'FILLED' || ct.status === 'SUBMITTED') {
      outcome = 'pending';
    } else {
      outcome = 'miss';
    }

    return {
      id: ct.tradeId || ct.id || `trade_${Math.random()}`,
      at: ct.executedAt || ct.at || new Date().toISOString(),
      asset: ct.asset || ct.ticker || 'WTI',
      market_ticker: ct.ticker || ct.market_ticker || '',
      side: ct.decision || ct.side || 'YES',
      notional_usd: Number(ct.notionalUsd || ct.notional_usd || 0),
      fill_price: economic,
      fill_count: fillCount,
      pnl_usd: pnl,
      outcome,
      dry_run: Boolean(ct.dryRun || ct.dry_run),
      order_id: ct.orderId || ct.order_id || null,
      entry_path: parseEntryPath(ct.entryPath ?? ct.entry_path) ?? null,
    };
  });
}

export function isSkipLeanAlert(alertId?: string, decision?: string, title?: string): boolean {
  if (String(decision || '').toUpperCase() === 'SKIP') return true;
  if (/:SKIP$/i.test(String(alertId || ''))) return true;
  return /signal\s*[·•\-]\s*\S+\s+SKIP\b/i.test(String(title || ''));
}

export function isBelowCushionLeanBody(body?: string): boolean {
  const m = String(body || '').match(/Gap\s*\$([0-9]*\.?[0-9]+).*Cushion\s*\$([0-9]*\.?[0-9]+)/i);
  if (!m) return false;
  const gap = Number(m[1]);
  const cushion = Number(m[2]);
  return Number.isFinite(gap) && Number.isFinite(cushion) && gap < cushion;
}

export function isZeroMinutesLeftLeanBody(body?: string): boolean {
  const m = String(body || '').match(/(\d+)\s*m left/i);
  if (!m) return false;
  return Number(m[1]) === 0;
}

export function isInvalidLeanAlert(
  alertId?: string,
  decision?: string,
  title?: string,
  body?: string
): boolean {
  return (
    isSkipLeanAlert(alertId, decision, title) ||
    isBelowCushionLeanBody(body) ||
    isZeroMinutesLeftLeanBody(body)
  );
}

export function cloudAlertsToRecords(cloudAlerts: any[]): AlertRecord[] {
  return (cloudAlerts || [])
    .filter((raw) => raw && typeof raw === 'object')
    .map((raw) => {
      const id = String(raw.alertId || raw.id || '').trim();
      const kind = String(raw.kind || raw.type || '').trim();
      const title = String(raw.title || '').trim();
      if (!id || !kind || !title) return null;
      if (kind === 'lean_signal' && isInvalidLeanAlert(id, raw.decision, title, raw.body)) return null;
      const atRaw = raw.at || raw.createdAt || raw.timestamp;
      const atDate = atRaw ? new Date(atRaw) : new Date();
      const at = Number.isFinite(atDate.getTime()) ? atDate.toISOString() : new Date().toISOString();
      return {
        id,
        at,
        kind,
        title,
        body: String(raw.body || ''),
        read: false,
        source: 'gcp',
      } as AlertRecord;
    })
    .filter((row): row is AlertRecord => row != null);
}

export function statsFromCloudTrades(cloudTrades: any[], now = new Date()): DashboardStats {
  const repo = new MemoryTradeRepo();
  for (const row of cloudTradesToRecords(cloudTrades)) {
    repo.insert(row);
  }
  return repo.statsToday(now);
}

function normAlertText(s: string): string {
  return (s || '')
    .replace(/\[.*?\]/g, '')
    .replace(/🚨/g, '')
    .replace(/unique gcp alert sent at.*?\u00b7/gi, '')
    .trim()
    .toLowerCase();
}

function matchAlertAssetSide(s: string): string | null {
  const signal = s.match(/signal\s*[·•\-]\s*([a-z0-9]+)\s+(yes|no)/i);
  if (signal) return `${signal[1]} ${signal[2]}`.toLowerCase();
  const m = s.match(
    /\b(btc|eth|sol|doge|xrp|bnb|avax|sui|link|wti|gold|silver|ng|copper|spx|ndx|eurusd|gbpusd|usdjpy|ixic)\s+(yes|no)\b/i
  );
  return m ? m[0].toLowerCase() : null;
}

function alertsWithin2m(a: AlertRecord, b: AlertRecord): boolean {
  const ta = new Date(a.at).getTime();
  const tb = new Date(b.at).getTime();
  const diffMs = Math.abs(ta - tb);
  return !Number.isFinite(diffMs) || diffMs <= 120_000;
}

/** Local ↔ local / local ↔ GCP lean collapse (title/body/asset-side). */
function isFuzzyAlertDup(existing: AlertRecord, row: AlertRecord): boolean {
  if (existing.kind && row.kind && existing.kind !== row.kind) return false;
  if (!alertsWithin2m(existing, row)) return false;

  const t1 = normAlertText(existing.title);
  const t2 = normAlertText(row.title);
  const b1 = normAlertText(existing.body);
  const b2 = normAlertText(row.body);

  if (t1 === t2 && b1 === b2) return true;
  if (t1 === t2 && t1.length > 3) return true;
  if (b1.length > 5 && b1 === b2) return true;

  const as1 = matchAlertAssetSide(existing.title) || matchAlertAssetSide(existing.body);
  const as2 = matchAlertAssetSide(row.title) || matchAlertAssetSide(row.body);
  return Boolean(as1 && as2 && as1 === as2);
}

const MONEY_ALERT_KINDS = new Set([
  'order_placed',
  'order_filled',
  'ioc_miss',
  'trade_result',
  'protect_sell',
  'daily_loss_stop',
]);

function isMoneyAlertKind(kind?: string): boolean {
  return MONEY_ALERT_KINDS.has(String(kind || ''));
}

/** GCP ↔ GCP: same kind + exact title/body only. Never collapse two fills/wins by copy. */
function isExactGcpAlertDup(existing: AlertRecord, row: AlertRecord): boolean {
  if (isMoneyAlertKind(row.kind) || isMoneyAlertKind(existing.kind)) return false;
  if ((existing.source || 'local') !== 'gcp') return false;
  if (existing.kind && row.kind && existing.kind !== row.kind) return false;
  if (!alertsWithin2m(existing, row)) return false;
  return (
    normAlertText(existing.title) === normAlertText(row.title) &&
    normAlertText(existing.body) === normAlertText(row.body)
  );
}

export class MemoryAlertRepo {
  private alerts: AlertRecord[] = [];
  private dismissedIds = new Set<string>();

  loadDismissed(ids: string[]): void {
    this.dismissedIds = new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean));
  }

  dismissedList(): string[] {
    return Array.from(this.dismissedIds);
  }

  rememberDismissed(ids: string[]): void {
    for (const id of ids || []) {
      const trimmed = String(id || '').trim();
      if (trimmed) this.dismissedIds.add(trimmed);
    }
  }

  dropInvalidLeans(): number {
    const removedIds: string[] = [];
    this.alerts = this.alerts.filter((a) => {
      if (a.kind === 'lean_signal' && isInvalidLeanAlert(a.id, undefined, a.title, a.body)) {
        if (a.id) removedIds.push(a.id);
        return false;
      }
      return true;
    });
    this.rememberDismissed(removedIds);
    return removedIds.length;
  }

  insert(row: AlertRecord): boolean {
    const incomingId = String(row.id || '').trim();
    if (row.kind === 'lean_signal' && isInvalidLeanAlert(incomingId, undefined, row.title, row.body)) {
      return false;
    }
    if (incomingId && this.dismissedIds.has(incomingId)) {
      return false;
    }
    if (incomingId && this.alerts.some((existing) => existing.id === incomingId)) {
      return false;
    }

    const incomingGcp = (row.source || '') === 'gcp';
    const isDup = this.alerts.some((existing) => {
      if (incomingId && existing.id === incomingId) return true;
      if (isMoneyAlertKind(row.kind) || isMoneyAlertKind(existing.kind)) return false;
      if (incomingGcp) {
        if ((existing.source || 'local') === 'gcp') return isExactGcpAlertDup(existing, row);
        return isFuzzyAlertDup(existing, row);
      }
      return isFuzzyAlertDup(existing, row);
    });

    if (isDup) {
      return false;
    }

    this.alerts.unshift(row);
    return true;
  }

  unreadCount(): number {
    return this.alerts.filter((a) => !a.read).length;
  }

  list(limit = 500): AlertRecord[] {
    return this.alerts.slice(0, limit);
  }

  markAllRead(): void {
    this.alerts = this.alerts.map((a) => ({ ...a, read: true }));
  }

  /** Drop alerts older than retentionDays (local calendar time). Returns removed count. */
  pruneOlderThanDays(retentionDays: number, now = new Date()): number {
    const days = Math.max(1, Math.round(Number(retentionDays) || 30));
    const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
    const removedIds: string[] = [];
    this.alerts = this.alerts.filter((a) => {
      const t = new Date(a.at).getTime();
      const keep = Number.isFinite(t) ? t >= cutoff : true;
      if (!keep && a.id) removedIds.push(a.id);
      return keep;
    });
    this.rememberDismissed(removedIds);
    return removedIds.length;
  }

  clear(): void {
    this.alerts = [];
  }

  /** Delete alerts by ids. Returns how many were removed. */
  deleteByIds(ids: string[]): number {
    if (!ids.length) return 0;
    this.rememberDismissed(ids);
    const idSet = new Set(ids);
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((a) => !idSet.has(a.id));
    return before - this.alerts.length;
  }
}

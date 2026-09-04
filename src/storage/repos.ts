import { etDateKey } from '../util/time';

export type TradeSide = 'YES' | 'NO';
export type TradeOutcome = 'win' | 'loss' | 'pending' | 'miss' | 'dry_run' | 'exited';

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
}

export interface AlertRecord {
  id: string;
  at: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
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

export class MemoryTradeRepo {
  private trades: TradeRecord[] = [];

  insert(row: TradeRecord): void {
    this.trades.unshift(row);
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

export function statsFromCloudTrades(cloudTrades: any[], now = new Date()): DashboardStats {
  const repo = new MemoryTradeRepo();
  for (const ct of cloudTrades || []) {
    const row: TradeRecord = {
      id: ct.tradeId || ct.id || `trade_${Math.random()}`,
      at: ct.executedAt || ct.at || new Date().toISOString(),
      asset: ct.asset || ct.ticker || 'WTI',
      market_ticker: ct.ticker || ct.market_ticker || '',
      side: ct.decision || ct.side || 'YES',
      notional_usd: Number(ct.notionalUsd || ct.notional_usd || 0),
      fill_price: ct.price != null ? Number(ct.price) : null,
      fill_count: ct.count != null ? Number(ct.count) : 1,
      pnl_usd: ct.pnlUsd != null ? Number(ct.pnlUsd) : ct.pnl_usd != null ? Number(ct.pnl_usd) : null,
      outcome:
        ct.outcome ||
        (ct.status === 'SETTLED'
          ? Number(ct.pnlUsd || 0) >= 0
            ? 'win'
            : 'loss'
          : ct.status === 'FILLED' || ct.status === 'SUBMITTED'
            ? 'pending'
            : 'miss'),
      dry_run: Boolean(ct.dryRun || ct.dry_run),
    };
    repo.insert(row);
  }
  return repo.statsToday(now);
}

export class MemoryAlertRepo {
  private alerts: AlertRecord[] = [];

  insert(row: AlertRecord): void {
    this.alerts.unshift(row);
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
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((a) => {
      const t = new Date(a.at).getTime();
      return Number.isFinite(t) ? t >= cutoff : true;
    });
    return before - this.alerts.length;
  }

  clear(): void {
    this.alerts = [];
  }

  /** Delete alerts by ids. Returns how many were removed. */
  deleteByIds(ids: string[]): number {
    if (!ids.length) return 0;
    const idSet = new Set(ids);
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((a) => !idSet.has(a.id));
    return before - this.alerts.length;
  }
}

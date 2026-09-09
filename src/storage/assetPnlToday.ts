import { etDateKey } from '../util/time';
import { TradeRecord } from './repos';

export type AssetPnlRow = {
  asset: string;
  wins: number;
  losses: number;
  realized_pnl_usd: number;
  winPayMin: number | null;
  winPayMax: number | null;
  lossPayMin: number | null;
  lossPayMax: number | null;
};

export type AssetPnlToday = {
  rows: AssetPnlRow[];
  wins: number;
  losses: number;
  realized_pnl_usd: number;
  winPnlAvg: number | null;
  lossPnlAvg: number | null;
  lossPayMin: number | null;
  lossPayMax: number | null;
};

export const EMPTY_ASSET_PNL_TODAY: AssetPnlToday = {
  rows: [],
  wins: 0,
  losses: 0,
  realized_pnl_usd: 0,
  winPnlAvg: null,
  lossPnlAvg: null,
  lossPayMin: null,
  lossPayMax: null,
};

/** Kalshi 15m binary pay in dollars. Cents (e.g. 92) become 0.92. */
export function resolvePayUsd(raw: unknown): number | null {
  const n = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const usd = n > 1 && Number.isInteger(n) ? Math.round((n / 100) * 10000) / 10000 : n;
  if (usd <= 0 || usd > 1) return null;
  return usd;
}

function money2(n: number): number {
  return Math.round(n * 100) / 100;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return money2(values.reduce((s, v) => s + v, 0) / values.length);
}

function minMax(values: number[]): { min: number | null; max: number | null } {
  if (values.length === 0) return { min: null, max: null };
  return { min: money2(Math.min(...values)), max: money2(Math.max(...values)) };
}

/** Same win/loss/exited rules as Dashboard Closed P&L. Misses and dry-runs omitted. */
export function classifyClosedPnl(t: TradeRecord): 'win' | 'loss' | null {
  if (t.dry_run || t.outcome === 'dry_run') return null;
  if (t.outcome === 'win') return 'win';
  if (t.outcome === 'loss') return 'loss';
  if (t.outcome === 'exited') return Number(t.pnl_usd || 0) >= 0 ? 'win' : 'loss';
  return null;
}

export function formatPayRange(min: number | null, max: number | null): string | null {
  if (min == null || max == null) return null;
  const a = min.toFixed(2);
  const b = max.toFixed(2);
  return a === b ? `$${a}` : `$${a}–$${b}`;
}

export function formatSignedUsd(n: number): string {
  const abs = Math.abs(money2(n)).toFixed(2);
  if (n > 0) return `+$${abs}`;
  if (n < 0) return `-$${abs}`;
  return `$${abs}`;
}

export function formatAssetPayLine(row: AssetPnlRow): string | null {
  const win = formatPayRange(row.winPayMin, row.winPayMax);
  const loss = formatPayRange(row.lossPayMin, row.lossPayMax);
  const parts: string[] = [];
  if (win && row.wins > 0) parts.push(`Wins paid ${win}`);
  if (loss && row.losses > 0) parts.push(`Losses paid ${loss}`);
  return parts.length ? parts.join(' · ') : null;
}

export function formatDayPayFooter(summary: AssetPnlToday): string | null {
  const parts: string[] = [];
  if (summary.winPnlAvg != null && summary.wins > 0) {
    parts.push(`Wins avg ${formatSignedUsd(summary.winPnlAvg)}`);
  }
  if (summary.lossPnlAvg != null && summary.losses > 0) {
    parts.push(`Losses avg ${formatSignedUsd(summary.lossPnlAvg)}`);
  }
  const paid = formatPayRange(summary.lossPayMin, summary.lossPayMax);
  if (paid && summary.losses > 0) parts.push(`Losses paid ${paid}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Closed Predict P&L for the America/New_York day, one row per asset.
 * Pay ranges use fill_price (Cloud payPrice), never the opposite-side quote.
 */
export function summarizeAssetPnlToday(trades: TradeRecord[], now = new Date()): AssetPnlToday {
  const day = etDateKey(now);
  const byAsset = new Map<
    string,
    {
      wins: number;
      losses: number;
      pnl: number;
      winPays: number[];
      lossPays: number[];
    }
  >();
  const allWinPnls: number[] = [];
  const allLossPnls: number[] = [];
  const allLossPays: number[] = [];
  let rawPnl = 0;

  const touch = (asset: string) => {
    let row = byAsset.get(asset);
    if (!row) {
      row = { wins: 0, losses: 0, pnl: 0, winPays: [], lossPays: [] };
      byAsset.set(asset, row);
    }
    return row;
  };

  for (const t of trades) {
    const kind = classifyClosedPnl(t);
    if (!kind) continue;
    try {
      if (etDateKey(new Date(t.at)) !== day) continue;
    } catch {
      continue;
    }
    const row = touch(String(t.asset || '—'));
    const pnl = Number(t.pnl_usd || 0);
    const pay = resolvePayUsd(t.fill_price);
    if (kind === 'win') {
      row.wins += 1;
      allWinPnls.push(pnl);
      if (pay != null) row.winPays.push(pay);
    } else {
      row.losses += 1;
      allLossPnls.push(pnl);
      if (pay != null) {
        row.lossPays.push(pay);
        allLossPays.push(pay);
      }
    }
    row.pnl += pnl;
    rawPnl += pnl;
  }

  const rows: AssetPnlRow[] = [...byAsset.entries()]
    .map(([asset, r]) => {
      const winPay = minMax(r.winPays);
      const lossPay = minMax(r.lossPays);
      return {
        asset,
        wins: r.wins,
        losses: r.losses,
        realized_pnl_usd: money2(r.pnl),
        winPayMin: winPay.min,
        winPayMax: winPay.max,
        lossPayMin: lossPay.min,
        lossPayMax: lossPay.max,
      };
    })
    .sort((a, b) => {
      if (a.realized_pnl_usd !== b.realized_pnl_usd) return a.realized_pnl_usd - b.realized_pnl_usd;
      return a.asset.localeCompare(b.asset);
    });

  const wins = rows.reduce((s, r) => s + r.wins, 0);
  const losses = rows.reduce((s, r) => s + r.losses, 0);
  const realized = money2(rawPnl);
  const lossPay = minMax(allLossPays);

  return {
    rows,
    wins,
    losses,
    realized_pnl_usd: realized,
    winPnlAvg: avg(allWinPnls),
    lossPnlAvg: avg(allLossPnls),
    lossPayMin: lossPay.min,
    lossPayMax: lossPay.max,
  };
}

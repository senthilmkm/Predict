import { isCountableWindowBuy } from '../../packages/trading-core/src/gates';
import { AssetRegistry } from '../config/types';
import { parseEntryPath, TradeRecord } from './repos';
import { isEtToday } from '../util/time';

export type PathBuyRow = { asset: string; count: number };

export type PathBuyCounts = {
  home: PathBuyRow[];
  auto: PathBuyRow[];
  cashOut: PathBuyRow[];
  homeTotal: number;
  autoTotal: number;
  cashOutTotal: number;
};

function assetSortIndex(asset: string): number {
  const i = AssetRegistry.keys.indexOf(asset);
  return i >= 0 ? i : 1000;
}

function grouped(counts: Record<string, number>): PathBuyRow[] {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => assetSortIndex(a[0]) - assetSortIndex(b[0]) || a[0].localeCompare(b[0]))
    .map(([asset, count]) => ({ asset, count }));
}

/** Filled new buys today (ET). Not sells, Protect, IOC misses, dry-run, or unknown path. */
export function summarizeTodayPathBuys(trades: TradeRecord[], now = new Date()): PathBuyCounts {
  const home: Record<string, number> = {};
  const auto: Record<string, number> = {};
  const cashOut: Record<string, number> = {};
  for (const t of trades || []) {
    if (!isEtToday(t.at, now)) continue;
    if (!isCountableWindowBuy(t)) continue;
    const path = parseEntryPath(t.entry_path);
    if (!path) continue;
    const asset = String(t.asset || '').trim() || 'Unknown';
    if (path === 'home') home[asset] = (home[asset] || 0) + 1;
    else if (path === 'cash_out') cashOut[asset] = (cashOut[asset] || 0) + 1;
    else auto[asset] = (auto[asset] || 0) + 1;
  }
  const homeRows = grouped(home);
  const autoRows = grouped(auto);
  const cashOutRows = grouped(cashOut);
  return {
    home: homeRows,
    auto: autoRows,
    cashOut: cashOutRows,
    homeTotal: homeRows.reduce((s, r) => s + r.count, 0),
    autoTotal: autoRows.reduce((s, r) => s + r.count, 0),
    cashOutTotal: cashOutRows.reduce((s, r) => s + r.count, 0),
  };
}

function formatAssetCounts(rows: PathBuyRow[]): string {
  return rows.map((r) => `${r.asset} ${r.count}`).join(' · ');
}

/** Home strip: `Home  BTC 2 · Gold 1` then `Auto  ETH 1`. Hide a path at 0. */
export function formatHomePathBuyLines(summary: PathBuyCounts): string[] {
  const lines: string[] = [];
  if (summary.homeTotal > 0) lines.push(`Home  ${formatAssetCounts(summary.home)}`);
  if (summary.autoTotal > 0) lines.push(`Auto  ${formatAssetCounts(summary.auto)}`);
  if (summary.cashOutTotal > 0) lines.push(`Cash out  ${formatAssetCounts(summary.cashOut)}`);
  return lines;
}

/** Dashboard Trades card: `Home 3 · Auto 5`. Hide a path at 0. */
export function formatDashboardPathBuys(summary: PathBuyCounts): string | null {
  const parts: string[] = [];
  if (summary.homeTotal > 0) parts.push(`Home ${summary.homeTotal}`);
  if (summary.autoTotal > 0) parts.push(`Auto ${summary.autoTotal}`);
  if (summary.cashOutTotal > 0) parts.push(`Cash out ${summary.cashOutTotal}`);
  return parts.length ? parts.join(' · ') : null;
}

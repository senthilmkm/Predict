import { isCountableWindowBuy } from '../../packages/trading-core/src/gates';
import { AssetRegistry } from '../config/types';
import { parseEntryPath, TradeRecord } from './repos';
import { isEtToday } from '../util/time';

export type PathBuyRow = { asset: string; count: number };

export type PathBuyCounts = {
  home: PathBuyRow[];
  auto: PathBuyRow[];
  cashOut: PathBuyRow[];
  twapLock: PathBuyRow[];
  lastMinute: PathBuyRow[];
  stepBuy: PathBuyRow[];
  spikeFade: PathBuyRow[];
  pairLock: PathBuyRow[];
  homeTotal: number;
  autoTotal: number;
  cashOutTotal: number;
  twapLockTotal: number;
  lastMinuteTotal: number;
  stepBuyTotal: number;
  spikeFadeTotal: number;
  pairLockTotal: number;
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
  const twapLock: Record<string, number> = {};
  const lastMinute: Record<string, number> = {};
  const stepBuy: Record<string, number> = {};
  const spikeFade: Record<string, number> = {};
  const pairLock: Record<string, number> = {};
  for (const t of trades || []) {
    if (!isEtToday(t.at, now)) continue;
    if (!isCountableWindowBuy(t)) continue;
    const path = parseEntryPath(t.entry_path);
    if (!path) continue;
    const asset = String(t.asset || '').trim() || 'Unknown';
    if (path === 'home') home[asset] = (home[asset] || 0) + 1;
    else if (path === 'cash_out') cashOut[asset] = (cashOut[asset] || 0) + 1;
    else if (path === 'twap_lock') twapLock[asset] = (twapLock[asset] || 0) + 1;
    else if (path === 'last_minute') lastMinute[asset] = (lastMinute[asset] || 0) + 1;
    else if (path === 'step_buy') stepBuy[asset] = (stepBuy[asset] || 0) + 1;
    else if (path === 'spike_fade') spikeFade[asset] = (spikeFade[asset] || 0) + 1;
    else if (path === 'pair_lock') pairLock[asset] = (pairLock[asset] || 0) + 1;
    else auto[asset] = (auto[asset] || 0) + 1;
  }
  const homeRows = grouped(home);
  const autoRows = grouped(auto);
  const cashOutRows = grouped(cashOut);
  const twapRows = grouped(twapLock);
  const lastMinuteRows = grouped(lastMinute);
  const stepBuyRows = grouped(stepBuy);
  const spikeFadeRows = grouped(spikeFade);
  const pairLockRows = grouped(pairLock);
  return {
    home: homeRows,
    auto: autoRows,
    cashOut: cashOutRows,
    twapLock: twapRows,
    lastMinute: lastMinuteRows,
    stepBuy: stepBuyRows,
    spikeFade: spikeFadeRows,
    pairLock: pairLockRows,
    homeTotal: homeRows.reduce((s, r) => s + r.count, 0),
    autoTotal: autoRows.reduce((s, r) => s + r.count, 0),
    cashOutTotal: cashOutRows.reduce((s, r) => s + r.count, 0),
    twapLockTotal: twapRows.reduce((s, r) => s + r.count, 0),
    lastMinuteTotal: lastMinuteRows.reduce((s, r) => s + r.count, 0),
    stepBuyTotal: stepBuyRows.reduce((s, r) => s + r.count, 0),
    spikeFadeTotal: spikeFadeRows.reduce((s, r) => s + r.count, 0),
    pairLockTotal: pairLockRows.reduce((s, r) => s + r.count, 0),
  };
}

function formatAssetCounts(rows: PathBuyRow[]): string {
  return rows.map((r) => `${r.asset} ${r.count}`).join(' · ');
}

/** Dashboard path split: `Home  BTC 2 · Gold 1` then `Auto  ETH 1`. Hide a path at 0. */
export function formatHomePathBuyLines(summary: PathBuyCounts): string[] {
  const lines: string[] = [];
  if (summary.homeTotal > 0) lines.push(`Home  ${formatAssetCounts(summary.home)}`);
  if (summary.autoTotal > 0) lines.push(`Auto  ${formatAssetCounts(summary.auto)}`);
  if (summary.cashOutTotal > 0) lines.push(`Cash out  ${formatAssetCounts(summary.cashOut)}`);
  if (summary.twapLockTotal > 0) lines.push(`TWAP lock  ${formatAssetCounts(summary.twapLock)}`);
  if (summary.lastMinuteTotal > 0) lines.push(`Last-minute  ${formatAssetCounts(summary.lastMinute)}`);
  if (summary.stepBuyTotal > 0) lines.push(`Step buy  ${formatAssetCounts(summary.stepBuy)}`);
  if (summary.spikeFadeTotal > 0) lines.push(`Spike fade  ${formatAssetCounts(summary.spikeFade)}`);
  if (summary.pairLockTotal > 0) lines.push(`Pair lock  ${formatAssetCounts(summary.pairLock)}`);
  return lines;
}

/** Dashboard Trades card: `Home 3 · Auto 5`. Hide a path at 0. */
export function formatDashboardPathBuys(summary: PathBuyCounts): string | null {
  const parts: string[] = [];
  if (summary.homeTotal > 0) parts.push(`Home ${summary.homeTotal}`);
  if (summary.autoTotal > 0) parts.push(`Auto ${summary.autoTotal}`);
  if (summary.cashOutTotal > 0) parts.push(`Cash out ${summary.cashOutTotal}`);
  if (summary.twapLockTotal > 0) parts.push(`TWAP lock ${summary.twapLockTotal}`);
  if (summary.lastMinuteTotal > 0) parts.push(`Last-minute ${summary.lastMinuteTotal}`);
  if (summary.stepBuyTotal > 0) parts.push(`Step buy ${summary.stepBuyTotal}`);
  if (summary.spikeFadeTotal > 0) parts.push(`Spike fade ${summary.spikeFadeTotal}`);
  if (summary.pairLockTotal > 0) parts.push(`Pair lock ${summary.pairLockTotal}`);
  return parts.length ? parts.join(' · ') : null;
}

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
  capLock: PathBuyRow[];
  bufferRun: PathBuyRow[];
  cheapLoop: PathBuyRow[];
  cheapLoopHourly: PathBuyRow[];
  cheapLoopWeekly: PathBuyRow[];
  homeTotal: number;
  autoTotal: number;
  cashOutTotal: number;
  twapLockTotal: number;
  lastMinuteTotal: number;
  stepBuyTotal: number;
  spikeFadeTotal: number;
  pairLockTotal: number;
  capLockTotal: number;
  bufferRunTotal: number;
  cheapLoopTotal: number;
  cheapLoopHourlyTotal: number;
  cheapLoopWeeklyTotal: number;
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
  const capLock: Record<string, number> = {};
  const bufferRun: Record<string, number> = {};
  const cheapLoop: Record<string, number> = {};
  const cheapLoopHourly: Record<string, number> = {};
  const cheapLoopWeekly: Record<string, number> = {};
  for (const t of trades || []) {
    if (!isEtToday(t.at, now)) continue;
    if (!isCountableWindowBuy(t)) continue;
    const parsed = parseEntryPath(t.entry_path);
    const path = parsed === 'pair_lock_hedge' ? 'pair_lock' : parsed;
    if (!path) continue;
    const asset = String(t.asset || '').trim() || 'Unknown';
    if (path === 'home') home[asset] = (home[asset] || 0) + 1;
    else if (path === 'cash_out') cashOut[asset] = (cashOut[asset] || 0) + 1;
    else if (path === 'twap_lock') twapLock[asset] = (twapLock[asset] || 0) + 1;
    else if (path === 'last_minute') lastMinute[asset] = (lastMinute[asset] || 0) + 1;
    else if (path === 'step_buy') stepBuy[asset] = (stepBuy[asset] || 0) + 1;
    else if (path === 'spike_fade') spikeFade[asset] = (spikeFade[asset] || 0) + 1;
    else if (path === 'pair_lock') pairLock[asset] = (pairLock[asset] || 0) + 1;
    else if (path === 'cap_lock') capLock[asset] = (capLock[asset] || 0) + 1;
    else if (path === 'buffer_run') bufferRun[asset] = (bufferRun[asset] || 0) + 1;
    else if (path === 'cheap_loop') cheapLoop[asset] = (cheapLoop[asset] || 0) + 1;
    else if (path === 'cheap_loop_hourly') cheapLoopHourly[asset] = (cheapLoopHourly[asset] || 0) + 1;
    else if (path === 'cheap_loop_weekly') cheapLoopWeekly[asset] = (cheapLoopWeekly[asset] || 0) + 1;
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
  const capLockRows = grouped(capLock);
  const bufferRunRows = grouped(bufferRun);
  const cheapLoopRows = grouped(cheapLoop);
  const cheapLoopHourlyRows = grouped(cheapLoopHourly);
  const cheapLoopWeeklyRows = grouped(cheapLoopWeekly);
  return {
    home: homeRows,
    auto: autoRows,
    cashOut: cashOutRows,
    twapLock: twapRows,
    lastMinute: lastMinuteRows,
    stepBuy: stepBuyRows,
    spikeFade: spikeFadeRows,
    pairLock: pairLockRows,
    capLock: capLockRows,
    bufferRun: bufferRunRows,
    cheapLoop: cheapLoopRows,
    cheapLoopHourly: cheapLoopHourlyRows,
    cheapLoopWeekly: cheapLoopWeeklyRows,
    homeTotal: homeRows.reduce((s, r) => s + r.count, 0),
    autoTotal: autoRows.reduce((s, r) => s + r.count, 0),
    cashOutTotal: cashOutRows.reduce((s, r) => s + r.count, 0),
    twapLockTotal: twapRows.reduce((s, r) => s + r.count, 0),
    lastMinuteTotal: lastMinuteRows.reduce((s, r) => s + r.count, 0),
    stepBuyTotal: stepBuyRows.reduce((s, r) => s + r.count, 0),
    spikeFadeTotal: spikeFadeRows.reduce((s, r) => s + r.count, 0),
    pairLockTotal: pairLockRows.reduce((s, r) => s + r.count, 0),
    capLockTotal: capLockRows.reduce((s, r) => s + r.count, 0),
    bufferRunTotal: bufferRunRows.reduce((s, r) => s + r.count, 0),
    cheapLoopTotal: cheapLoopRows.reduce((s, r) => s + r.count, 0),
    cheapLoopHourlyTotal: cheapLoopHourlyRows.reduce((s, r) => s + r.count, 0),
    cheapLoopWeeklyTotal: cheapLoopWeeklyRows.reduce((s, r) => s + r.count, 0),
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
  if (summary.capLockTotal > 0) lines.push(`Cap lock  ${formatAssetCounts(summary.capLock)}`);
  if (summary.bufferRunTotal > 0) lines.push(`Buffer run  ${formatAssetCounts(summary.bufferRun)}`);
  if (summary.cheapLoopTotal > 0) lines.push(`Cheap loop 15m  ${formatAssetCounts(summary.cheapLoop)}`);
  if (summary.cheapLoopHourlyTotal > 0) {
    lines.push(`Cheap loop hourly  ${formatAssetCounts(summary.cheapLoopHourly)}`);
  }
  if (summary.cheapLoopWeeklyTotal > 0) {
    lines.push(`Cheap loop weekly  ${formatAssetCounts(summary.cheapLoopWeekly)}`);
  }
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
  if (summary.capLockTotal > 0) parts.push(`Cap lock ${summary.capLockTotal}`);
  if (summary.bufferRunTotal > 0) parts.push(`Buffer run ${summary.bufferRunTotal}`);
  if (summary.cheapLoopTotal > 0) parts.push(`Cheap loop 15m ${summary.cheapLoopTotal}`);
  if (summary.cheapLoopHourlyTotal > 0) parts.push(`Cheap loop hourly ${summary.cheapLoopHourlyTotal}`);
  if (summary.cheapLoopWeeklyTotal > 0) parts.push(`Cheap loop weekly ${summary.cheapLoopWeeklyTotal}`);
  return parts.length ? parts.join(' · ') : null;
}

import type { TradeEntryPath } from '../storage/repos';

export const PINNED_PATHS_MAX = 3;

export const PATH_FOCUS_IDS = [
  'shared',
  'home',
  'auto',
  'cashOut',
  'goldFade',
  'twapLock',
  'lastMinute',
  'stepBuy',
  'spikeFade',
  'pairLock',
  'capLock',
  'bufferRun',
  'cheapLoop',
] as const;

export type PathFocusId = (typeof PATH_FOCUS_IDS)[number];

export type PathTileDef = {
  id: PathFocusId;
  title: string;
  sub: string;
  adminFlag?:
    | 'cashOutFeatureOn'
    | 'goldFadeFeatureOn'
    | 'twapLockFeatureOn'
    | 'lastMinuteFeatureOn'
    | 'stepBuyFeatureOn'
    | 'spikeFadeFeatureOn'
    | 'pairLockFeatureOn'
    | 'capLockFeatureOn'
    | 'bufferRunFeatureOn'
    | 'cheapLoopFeatureOn';
};

export const PATH_TILES: PathTileDef[] = [
  { id: 'shared', title: 'Shared limits', sub: 'Day cap, window, open' },
  { id: 'home', title: 'Home Buy', sub: 'Your tap size' },
  { id: 'auto', title: 'Cushion lean', sub: 'Cushion < gap ≤ cushion×' },
  { id: 'cashOut', title: 'Cash out', sub: 'Partial cushion', adminFlag: 'cashOutFeatureOn' },
  { id: 'goldFade', title: 'Gold fade', sub: 'Gold, always dump', adminFlag: 'goldFadeFeatureOn' },
  { id: 'twapLock', title: 'TWAP lock', sub: 'BTC / ETH to $1', adminFlag: 'twapLockFeatureOn' },
  { id: 'lastMinute', title: 'Last-minute', sub: 'Last 90 seconds', adminFlag: 'lastMinuteFeatureOn' },
  { id: 'stepBuy', title: 'Step buy', sub: 'Add if lean holds', adminFlag: 'stepBuyFeatureOn' },
  { id: 'spikeFade', title: 'Spike fade', sub: 'Buy cheap side', adminFlag: 'spikeFadeFeatureOn' },
  { id: 'pairLock', title: 'Pair lock', sub: 'Both sides under $1', adminFlag: 'pairLockFeatureOn' },
  { id: 'capLock', title: 'Cap lock', sub: 'YES+NO same ticker, cap the bleed', adminFlag: 'capLockFeatureOn' },
  { id: 'bufferRun', title: 'Buffer run', sub: 'Mid-window lean scalp', adminFlag: 'bufferRunFeatureOn' },
  { id: 'cheapLoop', title: 'Cheap loop', sub: 'Cheap side, take or flatten', adminFlag: 'cheapLoopFeatureOn' },
];

export function isPathFocusId(raw: unknown): raw is PathFocusId {
  return PATH_FOCUS_IDS.includes(String(raw) as PathFocusId);
}

export function normalizePinnedPathIds(raw: unknown): PathFocusId[] {
  if (!Array.isArray(raw)) return [];
  const out: PathFocusId[] = [];
  for (const item of raw) {
    if (!isPathFocusId(item) || out.includes(item)) continue;
    out.push(item);
    if (out.length >= PINNED_PATHS_MAX) break;
  }
  return out;
}

export function pathTileById(id: PathFocusId): PathTileDef {
  return PATH_TILES.find((t) => t.id === id) || PATH_TILES[0];
}

/** entry_path values that belong to this path screen (null = Shared — no fills of its own). */
export function entryPathsForFocus(id: PathFocusId): TradeEntryPath[] | null {
  switch (id) {
    case 'home':
      return ['home'];
    case 'auto':
      return ['auto'];
    case 'cashOut':
      return ['cash_out'];
    case 'goldFade':
      return ['gold_fade'];
    case 'twapLock':
      return ['twap_lock'];
    case 'lastMinute':
      return ['last_minute'];
    case 'stepBuy':
      return ['step_buy'];
    case 'spikeFade':
      return ['spike_fade'];
    case 'pairLock':
      return ['pair_lock', 'pair_lock_hedge'];
    case 'capLock':
      return ['cap_lock'];
    case 'bufferRun':
      return ['buffer_run'];
    case 'cheapLoop':
      return ['cheap_loop', 'cheap_loop_hourly', 'cheap_loop_weekly'];
    case 'shared':
      return null;
    default:
      return null;
  }
}

/** Admin-off path pins stay in storage but must not count toward the 3-pin cap or show on Home. */
export function isPinnedPathVisible(
  id: PathFocusId,
  flags: Partial<Record<NonNullable<PathTileDef['adminFlag']>, boolean>>
): boolean {
  const tile = pathTileById(id);
  if (!tile.adminFlag) return true;
  return flags[tile.adminFlag] === true;
}

export function visiblePinnedPathIds(
  ids: readonly PathFocusId[],
  flags: Partial<Record<NonNullable<PathTileDef['adminFlag']>, boolean>>
): PathFocusId[] {
  return ids.filter((id) => isPinnedPathVisible(id, flags));
}

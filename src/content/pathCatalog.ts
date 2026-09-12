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
    | 'pairLockFeatureOn';
};

export const PATH_TILES: PathTileDef[] = [
  { id: 'shared', title: 'Shared limits', sub: 'Day cap, window, open' },
  { id: 'home', title: 'Home Buy', sub: 'Your tap size' },
  { id: 'auto', title: 'Auto-trade', sub: 'Cushion lean' },
  { id: 'cashOut', title: 'Cash out', sub: 'Partial cushion', adminFlag: 'cashOutFeatureOn' },
  { id: 'goldFade', title: 'Gold fade', sub: 'Gold, always dump', adminFlag: 'goldFadeFeatureOn' },
  { id: 'twapLock', title: 'TWAP lock', sub: 'BTC / ETH to $1', adminFlag: 'twapLockFeatureOn' },
  { id: 'lastMinute', title: 'Last-minute', sub: 'Last 90 seconds', adminFlag: 'lastMinuteFeatureOn' },
  { id: 'stepBuy', title: 'Step buy', sub: 'Add if lean holds', adminFlag: 'stepBuyFeatureOn' },
  { id: 'spikeFade', title: 'Spike fade', sub: 'Buy cheap side', adminFlag: 'spikeFadeFeatureOn' },
  { id: 'pairLock', title: 'Pair lock', sub: 'Both sides under $1', adminFlag: 'pairLockFeatureOn' },
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

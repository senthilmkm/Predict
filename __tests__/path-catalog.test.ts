import {
  isPinnedPathVisible,
  normalizePinnedPathIds,
  pathTileById,
  PINNED_PATHS_MAX,
  visiblePinnedPathIds,
} from '../src/content/pathCatalog';

describe('normalizePinnedPathIds', () => {
  test('drops unknown ids, duplicates, and caps at three', () => {
    expect(normalizePinnedPathIds(['home', 'home', 'nope', 'auto', 'shared', 'pairLock'])).toEqual([
      'home',
      'auto',
      'shared',
    ]);
    expect(PINNED_PATHS_MAX).toBe(3);
    expect(normalizePinnedPathIds(null)).toEqual([]);
    expect(normalizePinnedPathIds('auto')).toEqual([]);
    expect(pathTileById('auto').title).toBe('Cushion lean');
    expect(pathTileById('auto').sub).toBe('Cushion < gap ≤ cushion×');
  });

  test('admin-off pins do not count as visible toward the Home row', () => {
    const flags = {
      bufferRunFeatureOn: true,
      cheapLoopFeatureOn: false,
      capLockFeatureOn: false,
    };
    expect(isPinnedPathVisible('home', flags)).toBe(true);
    expect(isPinnedPathVisible('bufferRun', flags)).toBe(true);
    expect(isPinnedPathVisible('cheapLoop', flags)).toBe(false);
    expect(visiblePinnedPathIds(['home', 'auto', 'cheapLoop'], flags)).toEqual(['home', 'auto']);
  });
});

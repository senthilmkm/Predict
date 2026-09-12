import { normalizePinnedPathIds, PINNED_PATHS_MAX } from '../src/content/pathCatalog';

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
  });
});

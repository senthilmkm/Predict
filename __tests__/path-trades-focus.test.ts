import { entryPathsForFocus } from '../src/content/pathCatalog';

describe('entryPathsForFocus', () => {
  test('maps path screens to entry_path values', () => {
    expect(entryPathsForFocus('auto')).toEqual(['auto']);
    expect(entryPathsForFocus('lastMinute')).toEqual(['last_minute']);
    expect(entryPathsForFocus('pairLock')).toEqual(['pair_lock', 'pair_lock_hedge']);
    expect(entryPathsForFocus('cheapLoop')).toEqual([
      'cheap_loop',
      'cheap_loop_hourly',
      'cheap_loop_weekly',
    ]);
    expect(entryPathsForFocus('shared')).toBeNull();
  });
});

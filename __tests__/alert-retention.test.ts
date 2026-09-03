import { MemoryAlertRepo } from '../src/storage/repos';

describe('MemoryAlertRepo.pruneOlderThanDays', () => {
  test('removes alerts older than retention window', () => {
    const repo = new MemoryAlertRepo();
    const now = new Date('2026-09-03T12:00:00.000Z');
    repo.insert({
      id: 'old',
      kind: 'lean_signal',
      title: 'old',
      body: 'x',
      at: '2026-07-01T12:00:00.000Z',
      read: true,
    });
    repo.insert({
      id: 'fresh',
      kind: 'lean_signal',
      title: 'fresh',
      body: 'y',
      at: '2026-09-01T12:00:00.000Z',
      read: false,
    });
    const removed = repo.pruneOlderThanDays(30, now);
    expect(removed).toBe(1);
    expect(repo.list().map((a) => a.id)).toEqual(['fresh']);
  });

  test('keeps all when within window', () => {
    const repo = new MemoryAlertRepo();
    const now = new Date('2026-09-03T12:00:00.000Z');
    repo.insert({
      id: 'a',
      kind: 'error',
      title: 'a',
      body: 'z',
      at: '2026-08-20T12:00:00.000Z',
      read: true,
    });
    expect(repo.pruneOlderThanDays(30, now)).toBe(0);
    expect(repo.list()).toHaveLength(1);
  });
});

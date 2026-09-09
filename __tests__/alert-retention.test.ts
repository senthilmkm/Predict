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

  test('pruneOlderThanDays refuses a later insert of a pruned id', () => {
    const repo = new MemoryAlertRepo();
    const now = new Date('2026-09-08T12:00:00.000Z');
    repo.insert({
      id: 'fill:old',
      kind: 'order_filled',
      title: 'Order Placed',
      body: '1 ctr',
      at: '2026-07-01T12:00:00.000Z',
      read: true,
      source: 'gcp',
    });
    expect(repo.pruneOlderThanDays(30, now)).toBe(1);
    expect(
      repo.insert({
        id: 'fill:old',
        kind: 'order_filled',
        title: 'Order Placed',
        body: '1 ctr',
        at: '2026-07-01T12:00:00.000Z',
        read: true,
        source: 'gcp',
      })
    ).toBe(false);
    expect(repo.list()).toHaveLength(0);
  });

  test('deleteByIds refuses a later insert of the same id', () => {
    const repo = new MemoryAlertRepo();
    repo.insert({
      id: 'fill:t1',
      kind: 'order_filled',
      title: 'Order Placed',
      body: '1 ctr',
      at: '2026-09-08T12:00:00.000Z',
      read: false,
      source: 'gcp',
    });
    expect(repo.deleteByIds(['fill:t1'])).toBe(1);
    expect(
      repo.insert({
        id: 'fill:t1',
        kind: 'order_filled',
        title: 'Order Placed',
        body: '1 ctr',
        at: '2026-09-08T12:00:00.000Z',
        read: false,
        source: 'gcp',
      })
    ).toBe(false);
    expect(repo.list()).toHaveLength(0);
  });

  test('dropInvalidLeans removes SKIP signals and refuses re-insert', () => {
    const repo = new MemoryAlertRepo();
    repo.insert({
      id: 'lean:KXBTC15M-X:SKIP',
      kind: 'lean_signal',
      title: 'Signal · BTC SKIP',
      body: 'Gap $1.00',
      at: '2026-09-08T12:00:00.000Z',
      read: false,
      source: 'gcp',
    });
    expect(repo.list()).toHaveLength(0);
    repo.loadDismissed([]);
    (repo as any).alerts = [
      {
        id: 'lean:KXBTC15M-X:SKIP',
        kind: 'lean_signal',
        title: 'Signal · BTC SKIP',
        body: 'Gap $1.00',
        at: '2026-09-08T12:00:00.000Z',
        read: false,
        source: 'gcp',
      },
    ];
    expect(repo.dropInvalidLeans()).toBe(1);
    expect(repo.list()).toHaveLength(0);
    expect(
      repo.insert({
        id: 'lean:KXBTC15M-X:SKIP',
        kind: 'lean_signal',
        title: 'Signal · BTC SKIP',
        body: 'Gap $1.00',
        at: '2026-09-08T12:00:00.000Z',
        read: false,
        source: 'gcp',
      })
    ).toBe(false);
  });

  test('dropInvalidLeans removes 0m-left signals', () => {
    const repo = new MemoryAlertRepo();
    expect(
      repo.insert({
        id: 'lean:KXGOLD15M-X:YES',
        kind: 'lean_signal',
        title: 'Signal · Gold YES',
        body: 'Gap $8.69 · Cushion $7.25 · 0m left',
        at: '2026-09-08T12:00:00.000Z',
        read: false,
        source: 'gcp',
      })
    ).toBe(false);
    expect(repo.list()).toHaveLength(0);
  });
});

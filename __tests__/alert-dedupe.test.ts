import { MemoryAlertRepo } from '../src/storage/repos';
import { defaultAppConfig } from '../src/config/types';
import { shouldPushAlert } from '../src/config/normalize';
import { maybeNotify, setNotifyImpl } from '../src/services/notifications';

describe('alert History + phone sound ownership', () => {
  test('GCP lean with a slightly different body does not create a second History row', () => {
    const repo = new MemoryAlertRepo();
    const at = '2026-09-07T15:32:00.000Z';
    expect(
      repo.insert({
        id: 'local',
        kind: 'lean_signal',
        title: 'Signal · Gold YES',
        body: 'Gap $10.00 · cushion $7 · 12m left · not an order',
        at,
        read: false,
        source: 'local',
      })
    ).toBe(true);
    expect(
      repo.insert({
        id: 'gcp',
        kind: 'lean_signal',
        title: 'Signal · Gold YES',
        body: 'Gap $10.00 · Cushion $7 · 12m left',
        at: '2026-09-07T15:32:02.000Z',
        read: false,
        source: 'gcp',
      })
    ).toBe(false);
    expect(repo.list()).toHaveLength(1);
  });

  test('YES then NO for the same asset both stay in History', () => {
    const repo = new MemoryAlertRepo();
    expect(
      repo.insert({
        id: 'yes',
        kind: 'lean_signal',
        title: 'Signal · BTC YES',
        body: 'Gap $1.00',
        at: '2026-09-07T15:32:00.000Z',
        read: false,
      })
    ).toBe(true);
    expect(
      repo.insert({
        id: 'no',
        kind: 'lean_signal',
        title: 'Signal · BTC NO',
        body: 'Gap $1.20',
        at: '2026-09-07T15:32:40.000Z',
        read: false,
      })
    ).toBe(true);
    expect(repo.list().map((a) => a.id)).toEqual(['no', 'yes']);
  });

  test('lean History does not swallow a later fill for the same asset', () => {
    const repo = new MemoryAlertRepo();
    expect(
      repo.insert({
        id: 'lean',
        kind: 'lean_signal',
        title: 'Signal · Gold YES',
        body: 'Gap $10.00',
        at: '2026-09-07T15:32:00.000Z',
        read: false,
      })
    ).toBe(true);
    expect(
      repo.insert({
        id: 'fill',
        kind: 'order_filled',
        title: 'Order filled',
        body: 'Gold YES · 1 ctr @ $0.55 · cost $0.55',
        at: '2026-09-07T15:32:01.000Z',
        read: false,
      })
    ).toBe(true);
    expect(repo.list().map((a) => a.id)).toEqual(['fill', 'lean']);
  });

  test('phone maybeNotify never sounds for cloud-owned lean/fill kinds', async () => {
    const calls: string[] = [];
    setNotifyImpl(async (p) => {
      calls.push(p.kind);
    });
    const cfg = defaultAppConfig();
    cfg.alerts_enabled = true;
    expect(shouldPushAlert(cfg, 'lean_signal')).toBe(false);
    expect(await maybeNotify(cfg, 'lean_signal', 'Signal · BTC YES', 'gap')).toBe(false);
    expect(await maybeNotify(cfg, 'order_filled', 'Order filled', 'btc')).toBe(false);
    expect(await maybeNotify(cfg, 'trade_result', 'Won', 'btc')).toBe(true);
    expect(calls).toEqual(['trade_result']);
  });
});

import { AppRuntime } from '../src/runtime/AppRuntime';
import { defaultAppConfig } from '../src/config/types';
import { normalizeAppConfig, shouldPushAlert } from '../src/config/normalize';
import { maybeNotify, setNotifyImpl } from '../src/services/notifications';
import { cloudAlertsToRecords } from '../src/storage/repos';
import { MemoryKeyValueStore, setKeyValueStore, setSecureStore } from '../src/platform/storage';

/**
 * Combined Phase 1–3 contract:
 * Cloud writes alerts first; phone syncs History; phone never places or dings money events.
 */
describe('phases 1–3 combined ledger', () => {
  beforeEach(() => {
    setKeyValueStore(new MemoryKeyValueStore());
    setSecureStore(new MemoryKeyValueStore());
  });

  test('Cloud GET /me/alerts payload syncs once and phone does not re-notify', async () => {
    const calls: string[] = [];
    setNotifyImpl(async (p) => {
      calls.push(p.kind);
    });

    const payload = [
      {
        alertId: 'lean:KXGOLD15M-TEST:YES',
        kind: 'lean_signal',
        title: 'Signal · Gold YES',
        body: 'Gap $10.00 · Cushion $7 · 12m left',
        at: '2026-09-08T22:00:00.000Z',
        source: 'gcp',
      },
      {
        alertId: 'fill:t_fill',
        kind: 'order_filled',
        title: 'Order Placed · Gold YES',
        body: '1 ctr @ $0.60 · Cost $0.60',
        at: '2026-09-08T22:00:05.000Z',
        source: 'gcp',
      },
      {
        alertId: 'miss:t_miss',
        kind: 'ioc_miss',
        title: 'IOC miss',
        body: 'Gold YES · IOC no fill',
        at: '2026-09-08T22:00:06.000Z',
        source: 'gcp',
      },
      {
        alertId: 'settle:t_fill',
        kind: 'trade_result',
        title: 'Trade won',
        body: 'Gold YES · P&L $0.40 · KXGOLD15M-TEST',
        at: '2026-09-08T22:16:00.000Z',
        source: 'gcp',
      },
      {
        alertId: 'dailyloss:2026-09-08',
        kind: 'daily_loss_stop',
        title: 'Daily loss stop',
        body: 'New buys paused · realized P&L $-50.00 today (stop $50.00)',
        at: '2026-09-08T22:20:00.000Z',
        source: 'gcp',
      },
      { title: 'drop me — no alertId' },
    ];

    expect(cloudAlertsToRecords(payload as any)).toHaveLength(5);

    const cfg = normalizeAppConfig({ ...defaultAppConfig(), alerts_enabled: true });
    const rt = new AppRuntime({ getConfig: () => cfg });
    rt.syncCloudAlerts(payload);
    rt.syncCloudAlerts(payload);

    const kinds = rt.alerts.list().map((a) => a.kind).sort();
    expect(kinds).toEqual(
      ['daily_loss_stop', 'ioc_miss', 'lean_signal', 'order_filled', 'trade_result'].sort()
    );
    expect(rt.alerts.list().filter((a) => a.kind === 'lean_signal')).toHaveLength(1);
    expect(rt.alerts.list().find((a) => a.kind === 'trade_result')?.id).toBe('settle:t_fill');

    expect(shouldPushAlert(cfg, 'lean_signal')).toBe(false);
    expect(shouldPushAlert(cfg, 'order_filled')).toBe(false);
    expect(shouldPushAlert(cfg, 'ioc_miss')).toBe(false);
    expect(shouldPushAlert(cfg, 'trade_result')).toBe(false);
    expect(shouldPushAlert(cfg, 'daily_loss_stop')).toBe(false);
    expect(shouldPushAlert(cfg, 'protect_sell')).toBe(false);

    expect(await maybeNotify(cfg, 'trade_result', 'Trade won', 'Gold YES · P&L $0.40')).toBe(false);
    expect(await maybeNotify(cfg, 'ioc_miss', 'IOC miss', 'Gold')).toBe(false);
    expect(await maybeNotify(cfg, 'daily_loss_stop', 'Daily loss stop', 'stop')).toBe(false);
    expect(calls).toEqual([]);
  });
});

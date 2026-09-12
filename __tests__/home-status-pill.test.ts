import { defaultAppConfig } from '../src/config/types';
import { homeStatusPillModel } from '../src/screens/homeStatusPill';

const nowMs = Date.parse('2026-09-12T18:00:00.000Z');

describe('home status pill', () => {
  test('auto + alerts live is Auto, bell, and tick seconds', () => {
    const m = homeStatusPillModel({
      config: { auto_trade_enabled: true, alerts_enabled: true },
      running: true,
      lastPulseAt: new Date(nowMs - 4000).toISOString(),
      intervalSec: 10,
      nowMs,
    });
    expect(m.paused).toBe(false);
    expect(m.showAuto).toBe(true);
    expect(m.showBell).toBe(true);
    expect(m.tickLabel).toBe('10s');
    expect(m.tone).toBe('live');
    expect(m.modeLine).toBe('Alerts on · auto-trading');
    expect(m.tickLine).toBe('Live · Cloud tick 10s · 4s ago');
  });

  test('alerts only hides Auto; paused is grey Paused', () => {
    const alerts = homeStatusPillModel({
      config: { auto_trade_enabled: false, alerts_enabled: true },
      running: true,
      lastPulseAt: new Date(nowMs).toISOString(),
      intervalSec: 20,
      nowMs,
    });
    expect(alerts.showAuto).toBe(false);
    expect(alerts.showBell).toBe(true);
    expect(alerts.modeLine).toBe('Alerts on · not trading');

    const paused = homeStatusPillModel({
      config: { auto_trade_enabled: false, alerts_enabled: false },
      running: false,
      lastPulseAt: null,
      intervalSec: 20,
      nowMs,
    });
    expect(paused.paused).toBe(true);
    expect(paused.tickLabel).toBe('Idle');
    expect(paused.modeLine).toBe('Paused');
    expect(paused.tickLine).toBe('Idle');
  });

  test('stale cloud tick uses amber Stale, not Live seconds', () => {
    const m = homeStatusPillModel({
      config: defaultAppConfig(),
      running: true,
      lastPulseAt: new Date(nowMs - 400 * 1000).toISOString(),
      intervalSec: 20,
      nowMs,
    });
    expect(m.tone).toBe('stale');
    expect(m.tickLabel).toBe('Stale');
    expect(m.tickLine).toBe('Stale · Cloud tick 20s · 400s ago');
  });
});

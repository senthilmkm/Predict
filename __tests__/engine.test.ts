import { AsyncMutex, WindowLockRegistry } from '../src/engine/concurrency';
import { evaluateStaticGate, LeanSignal } from '../src/engine/gates';
import { TradingEngine } from '../src/engine/TradingEngine';
import { defaultAppConfig } from '../src/config/types';
import { KalshiClient } from '../src/services/kalshi/client';
import { generateKeyPairSync } from 'crypto';
import { MemoryTradeRepo } from '../src/storage/repos';

function lean(over: Partial<LeanSignal> = {}): LeanSignal {
  return {
    asset: 'Gold',
    market_ticker: 'KXGOLD15M-26SEP021800',
    decision: 'YES',
    live: 2650,
    strike: 2640,
    abs_gap: 10,
    minutes_left: 8,
    minutes_elapsed: 5,
    phase: 'live',
    yes_ask: 0.55,
    no_ask: 0.48,
    ...over,
  };
}

describe('AsyncMutex / WindowLock', () => {
  test('mutex serializes concurrent work', async () => {
    const m = new AsyncMutex();
    const order: number[] = [];
    await Promise.all([
      m.runExclusive(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 30));
        order.push(2);
      }),
      m.runExclusive(async () => {
        order.push(3);
        order.push(4);
      }),
    ]);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test('window lock is single-flight per market', () => {
    const w = new WindowLockRegistry();
    expect(w.tryClaim('M1', 'a')).toBe(true);
    expect(w.tryClaim('M1', 'b')).toBe(false);
    expect(w.tryClaim('M2', 'c')).toBe(true);
    w.release('M1');
    expect(w.tryClaim('M1', 'd')).toBe(true);
  });
});

describe('evaluateStaticGate edge cases', () => {
  const base = () => {
    const cfg = defaultAppConfig();
    cfg.auto_trade_enabled = true;
    cfg.execution_mode = 'live';
    cfg.live_armed = true;
    cfg.cushions.Gold = 7;
    return cfg;
  };

  test('passes when gap above cushion', () => {
    const g = evaluateStaticGate(lean({ abs_gap: 8 }), base());
    expect(g.ok).toBe(true);
    expect(g.side).toBe('bid');
    expect(Number(g.count)).toBeGreaterThanOrEqual(1);
    // ask 0.55 + chase 0.02 = 0.57
    expect(g.pay_price).toBeCloseTo(0.57, 4);
    expect(g.notional_usd!).toBeLessThanOrEqual(g.config_snapshot!.risk.max_dollars_per_trade);
  });

  test('notional never exceeds max/fixed dollars', () => {
    const cfg = base();
    cfg.risk.fixed_dollars_per_trade = 5;
    cfg.risk.max_dollars_per_trade = 5;
    cfg.risk.chase_above_ask_usd = 0;
    const g = evaluateStaticGate(lean({ abs_gap: 10, yes_ask: 0.62 }), cfg);
    expect(g.ok).toBe(true);
    expect(g.notional_usd!).toBeLessThanOrEqual(5 + 1e-9);
    expect(Number(g.count) * (g.pay_price || 0)).toBeCloseTo(g.notional_usd!, 2);
  });

  test('below_cushion', () => {
    expect(evaluateStaticGate(lean({ abs_gap: 6 }), base()).skip_reason).toBe('below_cushion');
  });

  test('skip_decision', () => {
    expect(evaluateStaticGate(lean({ decision: 'SKIP' }), base()).skip_reason).toBe('skip_decision');
  });

  test('minutes_left', () => {
    expect(evaluateStaticGate(lean({ minutes_left: 1 }), base()).skip_reason).toBe('minutes_left');
  });

  test('minutes_elapsed', () => {
    expect(evaluateStaticGate(lean({ minutes_elapsed: 0 }), base()).skip_reason).toBe(
      'minutes_elapsed'
    );
    expect(evaluateStaticGate(lean({ minutes_elapsed: 1 }), base()).skip_reason).toBe(
      'minutes_elapsed'
    );
    expect(evaluateStaticGate(lean({ minutes_elapsed: 2 }), base()).ok).toBe(true);
  });

  test('window_ended', () => {
    expect(evaluateStaticGate(lean({ phase: 'ended' }), base()).skip_reason).toBe('window_ended');
  });

  test('auto_trade_off', () => {
    const cfg = base();
    cfg.auto_trade_enabled = false;
    expect(evaluateStaticGate(lean(), cfg).skip_reason).toBe('auto_trade_off');
  });

  test('asset_disabled', () => {
    const cfg = base();
    cfg.assets_enabled.Gold = false;
    expect(evaluateStaticGate(lean(), cfg).skip_reason).toBe('asset_disabled');
  });

  test('max_open', () => {
    const cfg = base();
    cfg.risk.max_open_positions = 1;
    expect(evaluateStaticGate(lean(), cfg, { openPositions: 1 }).skip_reason).toBe('max_open');
  });

  test('daily_loss_stop', () => {
    const cfg = base();
    cfg.risk.daily_loss_stop_usd = 50;
    expect(
      evaluateStaticGate(lean(), cfg, { dailyPnlUsd: -50 }).skip_reason
    ).toBe('daily_loss_stop');
  });

  test('ask_too_rich', () => {
    const cfg = base();
    cfg.risk.max_entry_ask_usd = 0.5;
    expect(
      evaluateStaticGate(lean({ abs_gap: 10, yes_ask: 0.8 }), cfg).skip_reason
    ).toBe('ask_too_rich');
  });
});

describe('TradingEngine live place', () => {
  test('no client skips and releases lock', async () => {
    const engine = new TradingEngine(null);
    const cfg = defaultAppConfig();
    cfg.auto_trade_enabled = true;
    cfg.execution_mode = 'live';
    cfg.live_armed = true;
    cfg.cushions.Gold = 7;

    const r1 = await engine.tryPlaceFromLean(lean({ abs_gap: 10 }), cfg);
    expect(r1.ok).toBe(false);
    expect(r1.gate.skip_reason).toBe('no_client');
    expect(engine.windows.isLocked(lean().market_ticker)).toBe(false);
  });

  test('window_locked when concurrent live success holds lock', async () => {
    const pem = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;
    const fetchImpl = jest.fn(async () => ({
      status: 201,
      json: async () => ({ order_id: 'x', fill_count: '1.00' }),
      text: async () => '',
    })) as any;
    const client = new KalshiClient('k', pem, 'production', fetchImpl);
    const engine = new TradingEngine(client);
    const cfg = defaultAppConfig();
    cfg.auto_trade_enabled = true;
    cfg.execution_mode = 'live';
    cfg.live_armed = true;
    cfg.cushions.Gold = 7;

    const r1 = await engine.tryPlaceFromLean(lean({ abs_gap: 10 }), cfg);
    expect(r1.ok).toBe(true);
    expect(engine.windows.isLocked(lean().market_ticker)).toBe(true);
    const r2 = await engine.tryPlaceFromLean(lean({ abs_gap: 10 }), cfg);
    expect(r2.ok).toBe(false);
    expect(r2.gate.skip_reason).toBe('window_locked');
  });
});

describe('MemoryTradeRepo stats', () => {
  test('excludes dry_run from win rate', () => {
    const repo = new MemoryTradeRepo();
    repo.insert({
      id: '1',
      at: 't',
      asset: 'Gold',
      market_ticker: 'M',
      side: 'YES',
      notional_usd: 5,
      outcome: 'dry_run',
      dry_run: true,
    });
    repo.insert({
      id: '2',
      at: 't',
      asset: 'Gold',
      market_ticker: 'M',
      side: 'YES',
      notional_usd: 5,
      outcome: 'win',
      dry_run: false,
      pnl_usd: 2.5,
    });
    repo.insert({
      id: '3',
      at: 't',
      asset: 'Gold',
      market_ticker: 'M',
      side: 'NO',
      notional_usd: 5,
      outcome: 'loss',
      dry_run: false,
      pnl_usd: -5,
    });
    const s = repo.stats();
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.dry_runs).toBe(1);
    expect(s.win_rate).toBe(0.5);
    expect(s.realized_pnl_usd).toBe(-2.5);
  });
});

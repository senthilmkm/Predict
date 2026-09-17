import {
  BUFFER_RUN_ASK_MAX_DEFAULT,
  BUFFER_RUN_ASK_MIN_DEFAULT,
  BUFFER_RUN_DOLLARS_DEFAULT,
  BUFFER_RUN_FLATTEN_DEFAULT,
  BUFFER_RUN_STOP_DEFAULT,
  BUFFER_RUN_TAKE_DEFAULT,
  evaluateBufferRunEnter,
  evaluateBufferRunExit,
  isBufferRunEnterWindow,
  normalizeBufferRunAssets,
  pickBufferRunSide,
  reconcileBufferRunAskBand,
  reconcileBufferRunTakeStop,
  reconcileBufferRunTiming,
  tickerHasBufferRunAttempt,
} from '../packages/trading-core/src/bufferRun';
import { defaultAppConfig } from '../packages/trading-core/src/types';

function leanBase(over: Record<string, unknown> = {}) {
  return {
    asset: 'BTC',
    market_ticker: 'KXBTC15M-TEST',
    phase: 'open',
    decision: 'YES',
    live: 100_100,
    strike: 100_000,
    abs_gap: 100,
    minutes_elapsed: 5,
    minutes_left: 8,
    minutes_remaining: 8.2,
    yes_ask: 0.55,
    no_ask: 0.48,
    yes_bid: 0.53,
    no_bid: 0.46,
    close_utc: new Date(Date.now() + 8 * 60_000).toISOString(),
    open_utc: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...over,
  };
}

function cfgWithBuffer(over: Record<string, unknown> = {}) {
  const cfg = defaultAppConfig();
  cfg.auto_trade_enabled = true;
  cfg.assets_enabled = { ...cfg.assets_enabled, BTC: true, ETH: true };
  cfg.risk = {
    ...cfg.risk,
    buffer_run_enabled: true,
    buffer_run_assets: ['BTC', 'ETH'],
    buffer_run_ask_min_usd: BUFFER_RUN_ASK_MIN_DEFAULT,
    buffer_run_ask_max_usd: BUFFER_RUN_ASK_MAX_DEFAULT,
    buffer_run_take_usd: BUFFER_RUN_TAKE_DEFAULT,
    buffer_run_stop_usd: BUFFER_RUN_STOP_DEFAULT,
    buffer_run_enter_elapsed_minutes: 3,
    buffer_run_enter_left_minutes: 5,
    buffer_run_flatten_minutes: BUFFER_RUN_FLATTEN_DEFAULT,
    buffer_run_atr_mult: 1.25,
    buffer_run_min_gap_btc_usd: 40,
    buffer_run_min_gap_eth_usd: 2.5,
    buffer_run_fixed_dollars_per_trade: BUFFER_RUN_DOLLARS_DEFAULT,
    buffer_run_pair_sum_skip: 0.98,
    twap_lock_enabled: false,
    ...over,
  };
  return cfg;
}

describe('bufferRun defaults', () => {
  it('defaults assets to BTC+ETH; empty stays empty', () => {
    expect(normalizeBufferRunAssets(undefined)).toEqual(['BTC', 'ETH']);
    expect(normalizeBufferRunAssets([])).toEqual([]);
    expect(normalizeBufferRunAssets(['BTC', 'SOL', 'ETH'])).toEqual(['BTC', 'ETH']);
  });

  it('keeps ask band and take>stop', () => {
    expect(reconcileBufferRunAskBand({ askMinUsd: 0.6, askMaxUsd: 0.5 })).toEqual({
      askMinUsd: 0.55,
      askMaxUsd: 0.6,
    });
    const ts = reconcileBufferRunTakeStop({ takeUsd: 0.05, stopUsd: 0.07 });
    expect(ts.takeUsd).toBeGreaterThan(ts.stopUsd);
  });

  it('keeps enter-left above flatten', () => {
    const t = reconcileBufferRunTiming({
      enterElapsedMinutes: 3,
      enterLeftMinutes: 3,
      flattenMinutes: 3,
    });
    expect(t.enterLeftMinutes).toBeGreaterThan(t.flattenMinutes);
  });
});

describe('bufferRun enter gates', () => {
  it('enters when lead and ask band pass', () => {
    const gate = evaluateBufferRunEnter({
      lean: leanBase() as any,
      cfg: cfgWithBuffer(),
      adminEnabled: true,
    });
    expect(gate.ok).toBe(true);
    expect(gate.decision).toBe('YES');
    expect(gate.ask).toBe(0.55);
  });

  it('skips thin lead under min gap', () => {
    const gate = evaluateBufferRunEnter({
      lean: leanBase({ live: 100_020, abs_gap: 20 }) as any,
      cfg: cfgWithBuffer(),
      adminEnabled: true,
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('buffer_run_thin_lead');
  });

  it('skips ask outside band', () => {
    const rich = evaluateBufferRunEnter({
      lean: leanBase({ yes_ask: 0.7 }) as any,
      cfg: cfgWithBuffer(),
      adminEnabled: true,
    });
    expect(rich.skip_reason).toBe('buffer_run_ask_rich');
    const cheap = evaluateBufferRunEnter({
      lean: leanBase({ yes_ask: 0.3, no_ask: 0.75 }) as any,
      cfg: cfgWithBuffer(),
      adminEnabled: true,
    });
    expect(cheap.skip_reason).toBe('buffer_run_ask_cheap');
  });

  it('skips pair-lock sum', () => {
    const gate = evaluateBufferRunEnter({
      lean: leanBase({ yes_ask: 0.48, no_ask: 0.48 }) as any,
      cfg: cfgWithBuffer(),
      adminEnabled: true,
    });
    expect(gate.skip_reason).toBe('buffer_run_pair_lock');
  });

  it('skips when TWAP owns BTC', () => {
    const gate = evaluateBufferRunEnter({
      lean: leanBase() as any,
      cfg: cfgWithBuffer({ twap_lock_enabled: true, twap_lock_assets: ['BTC', 'ETH'] }),
      adminEnabled: true,
      twapAdminEnabled: true,
    });
    expect(gate.skip_reason).toBe('buffer_run_twap_owns');
  });

  it('skips one-per-window attempt', () => {
    const gate = evaluateBufferRunEnter({
      lean: leanBase() as any,
      cfg: cfgWithBuffer(),
      adminEnabled: true,
      alreadyAttempted: true,
    });
    expect(gate.skip_reason).toBe('buffer_run_attempted');
  });

  it('enter window respects elapsed and left', () => {
    expect(
      isBufferRunEnterWindow({
        minutesElapsed: 2,
        minutesLeft: 8,
        enterElapsedMinutes: 3,
        enterLeftMinutes: 5,
        flattenMinutes: 3,
      })
    ).toBe(false);
    expect(
      isBufferRunEnterWindow({
        minutesElapsed: 4,
        minutesLeft: 4,
        enterElapsedMinutes: 3,
        enterLeftMinutes: 5,
        flattenMinutes: 3,
      })
    ).toBe(false);
    expect(
      isBufferRunEnterWindow({
        minutesElapsed: 4,
        minutesLeft: 6,
        enterElapsedMinutes: 3,
        enterLeftMinutes: 5,
        flattenMinutes: 3,
      })
    ).toBe(true);
  });
});

describe('bufferRun exits', () => {
  it('takes when bid clears fill+take', () => {
    const res = evaluateBufferRunExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.7, yes_ask: 0.72, no_bid: 0.28, no_ask: 0.3 },
      fillUsd: 0.55,
      takeUsd: 0.12,
      stopUsd: 0.07,
      flattenMinutes: 3,
      lean: { phase: 'open', minutes_left: 6, live: 100_100, strike: 100_000 },
      filledAt: new Date(Date.now() - 10_000).toISOString(),
    });
    expect(res.sell).toBe(true);
    expect(res.kind).toBe('buffer_run_take');
  });

  it('stops on lean flip', () => {
    const res = evaluateBufferRunExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.5, yes_ask: 0.52, no_bid: 0.48, no_ask: 0.5 },
      fillUsd: 0.55,
      takeUsd: 0.12,
      stopUsd: 0.07,
      flattenMinutes: 3,
      lean: { phase: 'open', minutes_left: 6, live: 99_900, strike: 100_000 },
      filledAt: new Date(Date.now() - 10_000).toISOString(),
    });
    expect(res.sell).toBe(true);
    expect(res.kind).toBe('buffer_run_lean_flip');
  });

  it('flattens when minutes left hit floor', () => {
    const res = evaluateBufferRunExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.56, yes_ask: 0.58, no_bid: 0.42, no_ask: 0.44 },
      fillUsd: 0.55,
      takeUsd: 0.12,
      stopUsd: 0.07,
      flattenMinutes: 3,
      lean: { phase: 'open', minutes_left: 3, live: 100_100, strike: 100_000 },
      filledAt: new Date(Date.now() - 10_000).toISOString(),
    });
    expect(res.sell).toBe(true);
    expect(res.kind).toBe('buffer_run_flatten');
  });

  it('sells at % when mark clears fill × (1 + pct/100)', () => {
    // fill 50¢, Sell at 10% → need 55¢. Bid 56¢ hits % before Take +12¢ (62¢).
    const res = evaluateBufferRunExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.56, yes_ask: 0.58, no_bid: 0.42, no_ask: 0.44 },
      fillUsd: 0.5,
      takeUsd: 0.12,
      stopUsd: 0.07,
      flattenMinutes: 3,
      sellAtPct: 10,
      lean: { phase: 'open', minutes_left: 6, live: 100_100, strike: 100_000 },
      filledAt: new Date(Date.now() - 10_000).toISOString(),
    });
    expect(res.sell).toBe(true);
    expect(res.kind).toBe('buffer_run_sell_at');
  });

  it('sell at % Off leaves take ¢ in charge', () => {
    const res = evaluateBufferRunExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.56, yes_ask: 0.58, no_bid: 0.42, no_ask: 0.44 },
      fillUsd: 0.5,
      takeUsd: 0.12,
      stopUsd: 0.07,
      flattenMinutes: 3,
      sellAtPct: 0,
      lean: { phase: 'open', minutes_left: 6, live: 100_100, strike: 100_000 },
      filledAt: new Date(Date.now() - 10_000).toISOString(),
    });
    expect(res.sell).toBe(false);
    expect(res.kind).toBe('none');
  });
});

describe('bufferRun helpers', () => {
  it('picks NO when live under strike', () => {
    const picked = pickBufferRunSide({
      live: 99_900,
      strike: 100_000,
      yesAsk: 0.45,
      noAsk: 0.55,
      askMinUsd: 0.42,
      askMaxUsd: 0.62,
    });
    expect(picked).toEqual({ ok: true, decision: 'NO', ask: 0.55 });
  });

  it('detects prior attempt', () => {
    expect(
      tickerHasBufferRunAttempt(
        [{ ticker: 'T1', entryPath: 'buffer_run', outcome: 'exited' }],
        'T1'
      )
    ).toBe(true);
    expect(tickerHasBufferRunAttempt([{ ticker: 'T1', entryPath: 'auto' }], 'T1')).toBe(false);
  });
});

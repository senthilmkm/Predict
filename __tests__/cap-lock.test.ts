import { LeanSignal } from '../packages/trading-core/src/gates';
import { ASSETS_CATALOG, defaultAppConfig } from '../packages/trading-core/src/types';
import {
  capLockFirstMaxPayUsd,
  capLockFitsCap,
  capLockHoldingWatchText,
  capLockLotsForTicker,
  capLockRicherSide,
  evaluateCapLockEnter,
  evaluateCapLockSecondLeg,
  evaluateCapLockWatch,
  isCapLockEnterPath,
  isCapLockEnterWindow,
  isCapLockHistorySellable,
  kalshiBinaryFeeUsd,
  normalizeCapLockAssets,
  tickerHasCapLockAttempt,
} from '../packages/trading-core/src/capLock';
import { PATH_INFO } from '../src/content/pathInfo';
import { PATH_TILES } from '../src/content/pathCatalog';
import { formatSkipReason } from '../packages/trading-core/src/gates';

function cfg() {
  const c = defaultAppConfig();
  c.auto_trade_enabled = true;
  c.assets_enabled.Gold = true;
  c.risk.cap_lock_enabled = true;
  c.risk.cap_lock_assets = ['Gold'];
  c.risk.cap_lock_max_loss_usd = 0.05;
  c.risk.cap_lock_lot_count = 1;
  c.risk.cap_lock_window_open_seconds = 90;
  c.risk.cap_lock_allow_later = true;
  return c;
}

function lean(over: Record<string, unknown> = {}) {
  return {
    asset: 'Gold',
    market_ticker: 'KXGOLD15M-T',
    decision: 'SKIP' as const,
    live: 2650,
    strike: 2650,
    abs_gap: 0,
    minutes_left: 13,
    minutes_elapsed: 0,
    minutes_remaining: 14.5,
    phase: 'live' as const,
    yes_ask: 0.5,
    no_ask: 0.5,
    ...over,
  } as LeanSignal & { yes_ask?: number | null; no_ask?: number | null };
}

describe('Cap lock path', () => {
  test('all catalog chips are selectable; empty = no buys; missing = defaultOn', () => {
    expect(normalizeCapLockAssets([]).length).toBe(0);
    expect(normalizeCapLockAssets(['Gold', 'NOPE'])).toEqual(['Gold']);
    expect(normalizeCapLockAssets(['HYPE'])).toEqual(['HYPE']);
    expect(normalizeCapLockAssets(undefined).includes('Gold')).toBe(true);
    const allKeys = ASSETS_CATALOG.map((a) => a.key);
    expect(allKeys.includes('HYPE')).toBe(true);
    expect(normalizeCapLockAssets(allKeys)).toEqual(allKeys);
    expect(normalizeCapLockAssets(undefined).includes('HYPE')).toBe(false);
  });

  test('0.48+0.48 allows when fees stay under 5¢ cap', () => {
    expect(kalshiBinaryFeeUsd(0.48, 1)).toBe(0.02);
    expect(capLockFitsCap({ yesAskUsd: 0.48, noAskUsd: 0.48, count: 1, maxLockLossUsd: 0.05 })).toBe(true);
    const gate = evaluateCapLockEnter({
      lean: lean({ yes_ask: 0.48, no_ask: 0.48 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(gate.ok).toBe(true);
    expect(gate.firstSide).toBe('YES');
    expect(gate.first?.decision).toBe('YES');
    expect(gate.second?.decision).toBe('NO');
  });

  test('0.50+0.50 allows ~4¢ fee loss at 5¢ cap', () => {
    expect(capLockFitsCap({ yesAskUsd: 0.5, noAskUsd: 0.5, count: 1, maxLockLossUsd: 0.05 })).toBe(true);
    expect(evaluateCapLockEnter({ lean: lean(), cfg: cfg(), adminEnabled: true }).ok).toBe(true);
  });

  test('0.52+0.52 skips at 5¢ cap', () => {
    expect(capLockFitsCap({ yesAskUsd: 0.52, noAskUsd: 0.52, count: 1, maxLockLossUsd: 0.05 })).toBe(false);
    const gate = evaluateCapLockEnter({
      lean: lean({ yes_ask: 0.52, no_ask: 0.52 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('cap_lock_too_rich');
  });

  test('0.60+0.60 skips', () => {
    const gate = evaluateCapLockEnter({
      lean: lean({ yes_ask: 0.6, no_ask: 0.6 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(gate.skip_reason).toBe('cap_lock_too_rich');
  });

  test('missing no_ask skips', () => {
    const gate = evaluateCapLockEnter({
      lean: lean({ no_ask: null }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(gate.skip_reason).toBe('cap_lock_no_ask');
  });

  test('admin or user off → no place', () => {
    expect(evaluateCapLockEnter({ lean: lean(), cfg: cfg(), adminEnabled: false }).skip_reason).toBe(
      'cap_lock_admin_off'
    );
    const off = cfg();
    off.risk.cap_lock_enabled = false;
    expect(evaluateCapLockEnter({ lean: lean(), cfg: off, adminEnabled: true }).skip_reason).toBe('cap_lock_off');
    expect(
      evaluateCapLockEnter({
        lean: lean(),
        cfg: cfg(),
        adminEnabled: true,
        lastMissAtMs: 1_000,
        nowMs: 1_000 + 3_000,
      }).skip_reason
    ).toBe('cap_lock_cooldown');
    expect(
      isCapLockEnterPath({
        adminEnabled: true,
        userEnabled: false,
        assetEnabled: true,
        asset: 'Gold',
        assets: ['Gold'],
      })
    ).toBe(false);
  });

  test('no lean required — SKIP still enters', () => {
    const gate = evaluateCapLockEnter({
      lean: lean({ decision: 'SKIP', abs_gap: 0 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(gate.ok).toBe(true);
  });

  test('empty chips skip; other path holding skips; attempt burns the window', () => {
    const empty = cfg();
    empty.risk.cap_lock_assets = [];
    expect(evaluateCapLockEnter({ lean: lean(), cfg: empty, adminEnabled: true }).skip_reason).toBe(
      'cap_lock_asset_off'
    );
    expect(
      evaluateCapLockEnter({ lean: lean(), cfg: cfg(), adminEnabled: true, hasOpenOnTicker: true }).skip_reason
    ).toBe('cap_lock_holding_other_path');
    expect(
      evaluateCapLockEnter({ lean: lean(), cfg: cfg(), adminEnabled: true, alreadyAttempted: true }).skip_reason
    ).toBe('cap_lock_attempted');
  });

  test('early window is first 90s; allow_later can still fire', () => {
    expect(
      isCapLockEnterWindow({
        minutesRemaining: 14.5,
        windowOpenSeconds: 90,
        allowLater: false,
      })
    ).toBe(true);
    expect(
      isCapLockEnterWindow({
        minutesRemaining: 10,
        windowOpenSeconds: 90,
        allowLater: false,
      })
    ).toBe(false);
    expect(
      isCapLockEnterWindow({
        minutesRemaining: 10,
        windowOpenSeconds: 90,
        allowLater: true,
      })
    ).toBe(true);
    expect(
      isCapLockEnterWindow({
        minutesRemaining: 0,
        windowOpenSeconds: 90,
        allowLater: true,
      })
    ).toBe(false);
  });

  test('richer ask is first; first 0 fill means no second', () => {
    expect(capLockRicherSide(0.52, 0.48)).toBe('YES');
    const miss = evaluateCapLockSecondLeg({
      firstSide: 'YES',
      firstFillUsd: 0.52,
      firstFillCount: 0,
      secondAskUsd: 0.48,
      maxLockLossUsd: 0.05,
    });
    expect(miss).toEqual({ ok: false, skip_reason: 'cap_lock_first_miss' });
  });

  test('first full, second would exceed cap → flatten, no chase', () => {
    const retry = evaluateCapLockSecondLeg({
      firstSide: 'YES',
      firstFillUsd: 0.6,
      firstFillCount: 1,
      secondAskUsd: 0.6,
      maxLockLossUsd: 0.05,
    });
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.skip_reason).toBe('cap_lock_too_rich');
    const watch = evaluateCapLockWatch({
      lots: {
        yesCount: 1,
        noCount: 0,
        yesFillUsd: 0.6,
        noFillUsd: null,
        yesFilledAt: '2026-09-15T10:00:00.000Z',
        noFilledAt: null,
        matchedCount: 0,
        extraSide: 'YES',
        extraCount: 1,
        attempted: true,
        locked: false,
      },
      quotes: { yes_bid: 0.55, yes_ask: 0.6, no_bid: 0.4, no_ask: 0.6 },
      maxLockLossUsd: 0.05,
      alreadyRetried: true,
      now: new Date('2026-09-15T10:00:16.000Z'),
      minutesRemaining: 1,
    });
    expect(watch.kind).toBe('flatten');
    expect(watch.flatten?.ok).toBe(true);
  });

  test('unmatched leftover waits 15s; dump worse than cap holds until late', () => {
    const lots = {
      yesCount: 1,
      noCount: 0,
      yesFillUsd: 0.6,
      noFillUsd: null,
      yesFilledAt: '2026-09-15T10:00:00.000Z',
      noFilledAt: null,
      matchedCount: 0,
      extraSide: 'YES' as const,
      extraCount: 1,
      attempted: true,
      locked: false,
    };
    const quotes = { yes_bid: 0.55, yes_ask: 0.6, no_bid: 0.4, no_ask: 0.6 };
    expect(
      evaluateCapLockWatch({
        lots,
        quotes,
        maxLockLossUsd: 0.05,
        alreadyRetried: true,
        now: new Date('2026-09-15T10:00:05.000Z'),
        minutesRemaining: 10,
      }).kind
    ).toBe('none');
    expect(
      evaluateCapLockWatch({
        lots,
        quotes,
        maxLockLossUsd: 0.05,
        alreadyRetried: true,
        now: new Date('2026-09-15T10:00:16.000Z'),
        minutesRemaining: 10,
      }).reason
    ).toBe('cap_lock_hold_leftover');
    expect(
      evaluateCapLockWatch({
        lots,
        quotes,
        maxLockLossUsd: 0.05,
        alreadyRetried: true,
        now: new Date('2026-09-15T10:00:16.000Z'),
        minutesRemaining: 1,
      }).kind
    ).toBe('flatten');
  });

  test('matched pair hides History Sell; unmatched leftover can sell', () => {
    const yes = {
      ticker: 'KXGOLD15M-T',
      entryPath: 'cap_lock',
      decision: 'YES',
      fillCount: 1,
      status: 'FILLED',
      outcome: 'pending',
      payPrice: 0.48,
    };
    const no = { ...yes, decision: 'NO', payPrice: 0.48 };
    expect(isCapLockHistorySellable(yes, [yes, no])).toBe(false);
    expect(isCapLockHistorySellable(no, [yes, no])).toBe(false);
    expect(isCapLockHistorySellable(yes, [yes])).toBe(true);
    const extraYes = { ...yes, fillCount: 2 };
    expect(isCapLockHistorySellable(extraYes, [extraYes, no])).toBe(true);
    expect(isCapLockHistorySellable(no, [extraYes, no])).toBe(false);
  });

  test('a 0-fill miss does not burn the window; a fill does', () => {
    expect(
      tickerHasCapLockAttempt(
        [{ ticker: 'KXGOLD15M-T', entryPath: 'cap_lock', fillCount: 0, outcome: 'miss', status: 'CANCELLED' }],
        'KXGOLD15M-T'
      )
    ).toBe(false);
    expect(
      tickerHasCapLockAttempt(
        [
          {
            ticker: 'KXGOLD15M-T',
            entryPath: 'cap_lock',
            fillCount: 1,
            outcome: 'pending',
            status: 'FILLED',
            decision: 'YES',
          },
        ],
        'KXGOLD15M-T'
      )
    ).toBe(true);
    const lots = capLockLotsForTicker(
      [
        {
          ticker: 'KXGOLD15M-T',
          entryPath: 'cap_lock',
          decision: 'YES',
          fillCount: 1,
          status: 'FILLED',
          outcome: 'pending',
          payPrice: 0.48,
        },
        {
          ticker: 'KXGOLD15M-T',
          entryPath: 'cap_lock',
          decision: 'NO',
          fillCount: 1,
          status: 'FILLED',
          outcome: 'pending',
          payPrice: 0.48,
        },
      ],
      'KXGOLD15M-T'
    );
    expect(lots.locked).toBe(true);
    expect(capLockHoldingWatchText(lots, -0.04)).toBe('Cap lock holding · locked −$0.04');
  });

  test('skip labels and Paths tile', () => {
    expect(formatSkipReason('cap_lock_too_rich')).toBe('asks too rich to lock');
    expect(formatSkipReason('cap_lock_no_ask')).toBe('no ask');
    expect(formatSkipReason('cap_lock_wait_second')).toBe('waiting for second leg');
    expect(formatSkipReason('cap_lock_hold_leftover')).toBe('holding leftover — dump bigger than cap');
    expect(capLockFirstMaxPayUsd({
      firstSide: 'YES',
      firstAskUsd: 0.5,
      otherAskUsd: 0.48,
      count: 1,
      maxLockLossUsd: 0.05,
    })).toBeGreaterThanOrEqual(0.51);
    expect(PATH_INFO.capLock.title).toBe('Cap lock');
    expect(PATH_INFO.capLock.body).toMatch(/Cap lock asset chips/);
    expect(PATH_INFO.capLock.body).toMatch(/Empty chips = no Cap lock buys/);
    expect(PATH_INFO.capLock.body).toMatch(/Try first/);
    expect(PATH_TILES.some((t) => t.id === 'capLock' && t.adminFlag === 'capLockFeatureOn')).toBe(true);
  });
});

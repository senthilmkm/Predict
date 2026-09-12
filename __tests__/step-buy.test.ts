import {
  STEP_BUY_STOP_ADD_SEC,
  evaluateStepBuyEnter,
  evaluateStepBuyStops,
  isStepBuyEnterPath,
  isStepBuyStartWindow,
  isStepBuyStopAddWindow,
  nextStepBuyLotIndex,
  normalizeStepBuyAddBandUsd,
  normalizeStepBuyAssets,
  normalizeStepBuyCushionPct,
  normalizeStepBuyMaxAskUsd,
  normalizeStepBuyMaxLots,
  normalizeStepBuyStartMinutes,
  normalizeStepBuyStopUsd,
  stepBuyAskInAddBand,
  stepBuyLotsForTicker,
  stepBuyNeedGapUsd,
  stepBuyThesisHolds,
  stepBuyTwapOwns,
} from '../packages/trading-core/src/stepBuy';
import { formatSkipReason } from '../packages/trading-core/src/gates';
import { defaultAppConfig } from '../packages/trading-core/src/types';
import { PATH_INFO } from '../src/content/pathInfo';

function cfg(over: Record<string, unknown> = {}) {
  const c = defaultAppConfig();
  c.auto_trade_enabled = true;
  c.assets_enabled.Gold = true;
  c.assets_enabled.BTC = true;
  c.cushions.Gold = 4;
  c.risk.step_buy_enabled = true;
  c.risk.step_buy_start_minutes = 5;
  c.risk.step_buy_cushion_pct = 50;
  c.risk.step_buy_lot_count = 1;
  c.risk.step_buy_add_wait_minutes = 1;
  c.risk.step_buy_add_band_usd = 0.02;
  c.risk.step_buy_max_lots = 3;
  c.risk.step_buy_stop_usd = 0.03;
  c.risk.step_buy_max_ask_usd = 0.8;
  c.risk.max_trades_per_asset_per_window = 1;
  Object.assign(c.risk, over.risk || {});
  return c;
}

const close = new Date('2026-09-12T10:15:00.000Z');
const nowLive = new Date(close.getTime() - 8 * 60_000);

function lean(over: Record<string, unknown> = {}) {
  return {
    asset: 'Gold' as const,
    market_ticker: 'KXGOLD15M-T',
    decision: 'YES' as const,
    live: 3704,
    strike: 3700,
    abs_gap: 4,
    minutes_left: 8,
    minutes_elapsed: 7,
    minutes_remaining: 8,
    phase: 'live' as const,
    yes_ask: 0.72,
    yes_bid: 0.7,
    no_ask: 0.3,
    no_bid: 0.28,
    close_utc: close.toISOString(),
    ...over,
  };
}

describe('Step buy path', () => {
  test('normalizers, chips, and thesis', () => {
    expect(normalizeStepBuyStartMinutes(1)).toBe(2);
    expect(normalizeStepBuyStartMinutes(99)).toBe(10);
    expect(normalizeStepBuyCushionPct(10)).toBe(25);
    expect(normalizeStepBuyCushionPct(50)).toBe(50);
    expect(normalizeStepBuyAddBandUsd(-1)).toBe(0);
    expect(normalizeStepBuyAddBandUsd(0.024)).toBe(0.02);
    expect(normalizeStepBuyAddBandUsd(0.2)).toBe(0.1);
    expect(normalizeStepBuyMaxLots(0)).toBe(1);
    expect(normalizeStepBuyMaxLots(99)).toBe(8);
    expect(normalizeStepBuyStopUsd(0)).toBe(0.01);
    expect(normalizeStepBuyMaxAskUsd(0.4)).toBe(0.5);
    expect(normalizeStepBuyMaxAskUsd(0.99)).toBe(0.9);
    expect(normalizeStepBuyAssets(undefined).includes('Gold')).toBe(true);
    expect(normalizeStepBuyAssets([])).toEqual([]);
    expect(normalizeStepBuyAssets(['Gold', 'Gold', 'NOPE'])).toEqual(['Gold']);
    expect(stepBuyNeedGapUsd(4, 50)).toBe(2);
    expect(
      stepBuyThesisHolds({ absGap: 2, cushionUsd: 4, cushionPct: 50, leanSide: 'YES' })
    ).toBe(true);
    expect(
      stepBuyThesisHolds({ absGap: 1.9, cushionUsd: 4, cushionPct: 50, leanSide: 'YES' })
    ).toBe(false);
    expect(
      stepBuyThesisHolds({
        absGap: 4,
        cushionUsd: 4,
        cushionPct: 50,
        leanSide: 'NO',
        heldSide: 'YES',
      })
    ).toBe(false);
    expect(
      isStepBuyEnterPath({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        assets: [],
      })
    ).toBe(false);
    expect(
      isStepBuyEnterPath({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'Gold',
        assets: ['Gold'],
      })
    ).toBe(true);
    expect(
      stepBuyTwapOwns({
        twapAdminEnabled: true,
        twapUserEnabled: true,
        twapAssets: ['BTC', 'ETH'],
        asset: 'BTC',
      })
    ).toBe(true);
    expect(formatSkipReason('step_buy_stop_add')).toMatch(/30s/i);
    expect(formatSkipReason('step_buy_holding_other_path')).toMatch(/holding/i);
  });

  test('add band 0¢ requires the last fill; 2¢ allows up to last fill + 2¢', () => {
    expect(stepBuyAskInAddBand(0.7, 0.7, 0)).toBe(true);
    expect(stepBuyAskInAddBand(0.71, 0.7, 0)).toBe(false);
    expect(stepBuyAskInAddBand(0.69, 0.7, 0.02)).toBe(false);
    expect(stepBuyAskInAddBand(0.72, 0.7, 0.02)).toBe(true);
    expect(stepBuyAskInAddBand(0.73, 0.7, 0.02)).toBe(false);
  });

  test('lot 1 after Start after + Cushion % + lean + Entry ask', () => {
    const gate = evaluateStepBuyEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLive,
    });
    expect(gate.ok).toBe(true);
    expect(gate.decision).toBe('YES');
    expect(gate.time_in_force).toBe('immediate_or_cancel');
    expect(Number(gate.count)).toBe(1);
  });

  test('every add still needs Cushion % and the same lean side', () => {
    const lastLotAt = new Date(nowLive.getTime() - 70_000);
    const flipped = evaluateStepBuyEnter({
      lean: lean({ decision: 'NO', no_ask: 0.72, yes_ask: 0.3 }),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLive,
      stepBuyLots: 1,
      lastLotAt,
      lastFill: 0.72,
      heldSide: 'YES',
    });
    expect(flipped.ok).toBe(false);
    expect(flipped.skip_reason).toBe('step_buy_lean_flipped');

    const thinThesis = evaluateStepBuyEnter({
      lean: lean({ abs_gap: 1 }),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLive,
      stepBuyLots: 1,
      lastLotAt,
      lastFill: 0.72,
      heldSide: 'YES',
    });
    expect(thinThesis.ok).toBe(false);
    expect(thinThesis.skip_reason).toBe('step_buy_lean_flipped');

    const add = evaluateStepBuyEnter({
      lean: lean({ yes_ask: 0.75 }),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLive,
      stepBuyLots: 1,
      lastLotAt,
      lastFill: 0.72,
      heldSide: 'YES',
    });
    expect(add.ok).toBe(false);
    expect(add.skip_reason).toBe('step_buy_add_band');

    const ok = evaluateStepBuyEnter({
      lean: lean({ yes_ask: 0.74 }),
      cfg: cfg({ risk: { step_buy_add_band_usd: 0.02 } }),
      adminEnabled: true,
      now: nowLive,
      stepBuyLots: 1,
      lastLotAt,
      lastFill: 0.72,
      heldSide: 'YES',
    });
    expect(ok.ok).toBe(true);
  });

  test('stop adding with 30s left; stops still evaluate', () => {
    expect(STEP_BUY_STOP_ADD_SEC).toBe(30);
    expect(isStepBuyStopAddWindow(new Date(close.getTime() - 30_000), close)).toBe(true);
    expect(
      isStepBuyStartWindow({
        now: new Date(close.getTime() - 20_000),
        minutesElapsed: 14,
        startMinutes: 5,
        closeUtc: close,
      })
    ).toBe(false);
    const enter = evaluateStepBuyEnter({
      lean: lean({ minutes_elapsed: 14 }),
      cfg: cfg(),
      adminEnabled: true,
      now: new Date(close.getTime() - 20_000),
    });
    expect(enter.ok).toBe(false);
    expect(enter.skip_reason).toBe('step_buy_stop_add');

    const lot1 = {
      ticker: 'KXGOLD15M-T',
      entryPath: 'step_buy',
      status: 'FILLED',
      fillCount: 1,
      payPrice: 0.72,
      decision: 'YES',
      executedAt: '2026-09-12T10:06:00.000Z',
      stepLotIndex: 1,
    };
    const lot2 = {
      ...lot1,
      stepLotIndex: 2,
      payPrice: 0.73,
      executedAt: '2026-09-12T10:08:00.000Z',
    };
    const flatten = evaluateStepBuyStops({
      trades: [lot1, lot2],
      marketTicker: 'KXGOLD15M-T',
      yesAsk: 0.69,
      stopUsd: 0.03,
      now: new Date(close.getTime() - 10_000),
    });
    expect(flatten).toHaveLength(2);
    expect(flatten.every((h) => h.flatten && h.reason === 'step_buy_lot1_flatten')).toBe(true);

    const laterOnly = evaluateStepBuyStops({
      trades: [lot1, lot2],
      marketTicker: 'KXGOLD15M-T',
      yesAsk: 0.7,
      stopUsd: 0.03,
      now: new Date(close.getTime() - 10_000),
    });
    expect(laterOnly).toHaveLength(1);
    expect(laterOnly[0].flatten).toBe(false);
    expect(laterOnly[0].trade).toBe(lot2);
  });

  test('isolation: window cap lot 1, other path, Last-minute, TWAP, empty chips', () => {
    const cap = evaluateStepBuyEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLive,
      assetTradesInWindow: 1,
    });
    expect(cap.ok).toBe(false);
    expect(cap.skip_reason).toBe('step_buy_window_cap');

    const extra = evaluateStepBuyEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLive,
      assetTradesInWindow: 1,
      stepBuyLots: 1,
      lastLotAt: new Date(nowLive.getTime() - 70_000),
      lastFill: 0.72,
      heldSide: 'YES',
    });
    expect(extra.ok).toBe(true);

    const other = evaluateStepBuyEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLive,
      hasOpenOnTicker: true,
    });
    expect(other.ok).toBe(false);
    expect(other.skip_reason).toBe('step_buy_holding_other_path');

    const lm = evaluateStepBuyEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLive,
      lastMinuteOwnsNewBuys: true,
    });
    expect(lm.ok).toBe(false);
    expect(lm.skip_reason).toBe('step_buy_last_minute_owns');

    const twap = evaluateStepBuyEnter({
      lean: lean({ asset: 'BTC', market_ticker: 'KXBTC15M-T' }),
      cfg: cfg({ risk: { twap_lock_enabled: true, twap_lock_assets: ['BTC'] } }),
      adminEnabled: true,
      twapAdminEnabled: true,
      now: nowLive,
    });
    expect(twap.ok).toBe(false);
    expect(twap.skip_reason).toBe('step_buy_twap_owns');

    const chips = evaluateStepBuyEnter({
      lean: lean(),
      cfg: cfg({ risk: { step_buy_assets: [] } }),
      adminEnabled: true,
      now: nowLive,
    });
    expect(chips.ok).toBe(false);
    expect(chips.skip_reason).toBe('step_buy_asset_off');
  });

  test('open lots only count toward Max lots; sold lots free a slot', () => {
    const trades = [
      {
        ticker: 'KXGOLD15M-T',
        entryPath: 'step_buy',
        status: 'SETTLED',
        outcome: 'exited',
        fillCount: 1,
        payPrice: 0.7,
        decision: 'YES',
        executedAt: '2026-09-12T10:06:00.000Z',
        stepLotIndex: 1,
      },
      {
        ticker: 'KXGOLD15M-T',
        entryPath: 'step_buy',
        status: 'FILLED',
        outcome: 'pending',
        fillCount: 1,
        payPrice: 0.72,
        decision: 'YES',
        executedAt: '2026-09-12T10:08:00.000Z',
        stepLotIndex: 2,
      },
    ];
    expect(stepBuyLotsForTicker(trades, 'KXGOLD15M-T').count).toBe(1);
    expect(nextStepBuyLotIndex(trades, 'KXGOLD15M-T')).toBe(3);
    const maxed = evaluateStepBuyEnter({
      lean: lean(),
      cfg: cfg({ risk: { step_buy_max_lots: 1 } }),
      adminEnabled: true,
      now: nowLive,
      stepBuyLots: 1,
      lastLotAt: new Date(nowLive.getTime() - 70_000),
      lastFill: 0.72,
      heldSide: 'YES',
    });
    expect(maxed.ok).toBe(false);
    expect(maxed.skip_reason).toBe('step_buy_max_lots');
  });

  test('i-icon covers knobs, 30s stop-add, chips, and isolation', () => {
    expect(PATH_INFO.stepBuy.title).toBe('Step buy');
    expect(PATH_INFO.stepBuy.body).toMatch(/Step buy asset chips/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Empty chips = no Step buy buys/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Start after/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Cushion %/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Lot contracts/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Add wait/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Add band/);
    expect(PATH_INFO.stepBuy.body).toMatch(/does not chase/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Max lots/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Stop adding with 30s left/);
    expect(PATH_INFO.stepBuy.body).toMatch(/5s grace/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Lot 1 stop sells every remaining/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Window cap 1/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Last-minute owns new buys/);
    expect(PATH_INFO.stepBuy.body).toMatch(/Protect skips Step buy/);
    expect(PATH_INFO.stepBuy.body).toMatch(/TWAP lock/);
    expect(PATH_INFO.shared.body).toMatch(/Step buy lot 1/);
    expect(PATH_INFO.protect.body).toMatch(/Skips Step buy/);
  });
});

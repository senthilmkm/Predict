import {
  CASH_OUT_FLIP_GAP_RATIO,
  CASH_OUT_MIN_MINUTES_LEFT,
  CASH_OUT_SPREAD_MAX_USD,
  buildCashOutSellOrder,
  cashOutEdgeUsd,
  cashOutEnterMinGapUsd,
  cashOutFillExitTargetUsd,
  cashOutEdgeWarn,
  cashOutGateConfig,
  cashOutMinMinutesLeft,
  cashOutTargetsValid,
  cashOutWatchOffsetsMs,
  complementTicket,
  evaluateCashOutEnter,
  evaluateCashOutExit,
  isCashOutEnterPath,
  isCashOutEntryPath,
  isOpenLiveFill,
  noAskOf,
  noBidOf,
  normalizeCashOutAssets,
  normalizeCashOutBid,
  normalizeCashOutBidCheckSeconds,
  normalizeCashOutEnterPct,
  normalizeCashOutMaxAsk,
  openCashOutAssets,
  parseTradeEntryPath,
  reconcileCashOutTargets,
  sideAskOf,
  sideBidOf,
  sideSpreadOf,
  ticketUsd,
  tickerHasOpenCashOut,
  tickerHasOpenNonCashOut,
} from '../packages/trading-core/src/cashOut';
import { formatSkipReason } from '../packages/trading-core/src/gates';
import { defaultAppConfig } from '../packages/trading-core/src/types';

function cfg(over: Record<string, unknown> = {}) {
  const c = defaultAppConfig();
  c.auto_trade_enabled = true;
  c.cushions.Gold = 175;
  c.risk.cash_out_enabled = true;
  c.risk.cash_out_enter_pct = 60;
  c.risk.cash_out_max_ask_usd = 0.82;
  c.risk.cash_out_bid_usd = 0.88;
  c.risk.cash_out_assets = ['Gold'];
  c.risk.smart_buy_enabled = true;
  c.risk.min_minutes_left = 2;
  c.risk.min_minutes_elapsed = 2;
  c.risk.fixed_dollars_per_trade = 5;
  c.risk.max_dollars_per_trade = 5;
  Object.assign(c.risk, over.risk || {});
  return c;
}

function goldLean(over: Record<string, unknown> = {}) {
  return {
    asset: 'Gold',
    market_ticker: 'KXGOLD-T',
    decision: 'YES' as const,
    live: 2650,
    strike: 2545,
    abs_gap: 105,
    minutes_left: 8,
    minutes_elapsed: 3,
    minutes_remaining: 8.2,
    phase: 'live' as const,
    yes_ask: 0.7,
    yes_bid: 0.66,
    no_ask: 0.34,
    no_bid: 0.3,
    ...over,
  };
}

describe('Cash out ticket math', () => {
  test('ticketUsd rejects junk and clamps to the 1¢–99¢ book', () => {
    expect(ticketUsd(undefined)).toBeNull();
    expect(ticketUsd('x')).toBeNull();
    expect(ticketUsd(0)).toBeNull();
    expect(ticketUsd(1)).toBeNull();
    expect(ticketUsd(0.7)).toBe(0.7);
    expect(ticketUsd(0.70004)).toBe(0.7);
    expect(ticketUsd(0.01)).toBe(0.01);
    expect(ticketUsd(0.99)).toBe(0.99);
  });

  test('NO bid/ask are quote or 1 − YES complement, 4 dp', () => {
    expect(complementTicket(0.82)).toBe(0.18);
    expect(noBidOf({ yes_ask: 0.82 })).toBe(0.18);
    expect(noAskOf({ yes_bid: 0.66 })).toBe(0.34);
    expect(noBidOf({ no_bid: 0.88, yes_ask: 0.2 })).toBe(0.88);
    expect(sideBidOf('YES', { yes_bid: 0.88 })).toBe(0.88);
    expect(sideBidOf('NO', { yes_ask: 0.12 })).toBe(0.88);
    expect(sideAskOf('NO', { no_ask: 0.7 })).toBe(0.7);
    expect(sideSpreadOf('YES', { yes_ask: 0.82, yes_bid: 0.76 })).toBe(0.06);
  });

  test('normalize clamps enter %, ask, bid, watch seconds, assets', () => {
    expect(normalizeCashOutEnterPct(60)).toBe(60);
    expect(normalizeCashOutEnterPct(10)).toBe(40);
    expect(normalizeCashOutEnterPct(200)).toBe(100);
    expect(normalizeCashOutMaxAsk(0.82)).toBe(0.82);
    expect(normalizeCashOutMaxAsk(0.1)).toBe(0.5);
    expect(normalizeCashOutBid(0.88)).toBe(0.88);
    expect(normalizeCashOutBid(1.2)).toBe(0.99);
    expect(normalizeCashOutBidCheckSeconds(3)).toBe(3);
    expect(normalizeCashOutBidCheckSeconds(1)).toBe(2);
    expect(normalizeCashOutBidCheckSeconds(99)).toBe(10);
    expect(normalizeCashOutAssets(undefined)).toEqual(['Gold']);
    expect(normalizeCashOutAssets(['Gold', 'Gold', 'NOPE'])).toEqual(['Gold']);
    expect(normalizeCashOutAssets([])).toEqual([]);
  });

  test('Gold 60% of $175 is exactly $105', () => {
    expect(cashOutEnterMinGapUsd(175, 60)).toBe(105);
    expect(cashOutEnterMinGapUsd(175, 100)).toBe(175);
    expect(cashOutEnterMinGapUsd(80, 60)).toBe(48);
  });

  test('min minutes left is max(auto, 3)', () => {
    expect(cashOutMinMinutesLeft(2)).toBe(CASH_OUT_MIN_MINUTES_LEFT);
    expect(cashOutMinMinutesLeft(5)).toBe(5);
  });

  test('targets: bid must beat max ask; warn under 4¢', () => {
    expect(cashOutTargetsValid(0.82, 0.88)).toBe(true);
    expect(cashOutEdgeUsd(0.82, 0.88)).toBeCloseTo(0.06, 10);
    expect(cashOutEdgeWarn(0.82, 0.88)).toBe(false);
    expect(cashOutTargetsValid(0.88, 0.88)).toBe(false);
    expect(cashOutTargetsValid(0.9, 0.88)).toBe(false);
    expect(cashOutEdgeWarn(0.82, 0.85)).toBe(true);
    const fixed = reconcileCashOutTargets(0.88, 0.88);
    expect(fixed.bid).toBeGreaterThan(fixed.maxAsk);
  });

  test('watch offsets sit inside the Cloud tick interval', () => {
    expect(cashOutWatchOffsetsMs(20, 3)).toEqual([3000, 6000, 9000, 12000, 15000, 18000]);
    expect(cashOutWatchOffsetsMs(10, 3)).toEqual([3000, 6000, 9000]);
    expect(cashOutWatchOffsetsMs(3, 3)).toEqual([]);
  });
});

describe('Cash out enter', () => {
  test('buys Gold at 60% cushion, 70¢ ask, tight book — Smart buy is ignored', () => {
    const gate = evaluateCashOutEnter({
      lean: goldLean(),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(gate.ok).toBe(true);
    expect(gate.decision).toBe('YES');
    expect(gate.pay_price).toBeLessThanOrEqual(0.82);
    expect(Number(gate.count)).toBeGreaterThanOrEqual(1);
  });

  test('105.00 gap on $175 / 60% is the exact enter line', () => {
    const at = evaluateCashOutEnter({ lean: goldLean({ abs_gap: 105 }), cfg: cfg(), adminEnabled: true });
    const under = evaluateCashOutEnter({ lean: goldLean({ abs_gap: 104.999 }), cfg: cfg(), adminEnabled: true });
    expect(at.ok).toBe(true);
    expect(under.ok).toBe(false);
    expect(under.skip_reason).toBe('below_cushion');
  });

  test('full $175 cushion is not required', () => {
    const g = evaluateCashOutEnter({ lean: goldLean({ abs_gap: 120 }), cfg: cfg(), adminEnabled: true });
    expect(g.ok).toBe(true);
    expect(cashOutGateConfig(cfg(), 'Gold').cushions.Gold).toBe(105);
    expect(cashOutGateConfig(cfg(), 'Gold').risk.smart_buy_enabled).toBe(false);
  });

  test('ask 0.83 is too rich vs $0.82 cap', () => {
    const g = evaluateCashOutEnter({
      lean: goldLean({ yes_ask: 0.83, yes_bid: 0.8 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(g.ok).toBe(false);
    expect(g.skip_reason).toBe('ask_too_rich');
  });

  test('spread > 6¢ skips; 6.00¢ passes', () => {
    const wide = evaluateCashOutEnter({
      lean: goldLean({ yes_ask: 0.7, yes_bid: 0.63 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(wide.skip_reason).toBe('cash_out_spread_wide');
    const ok = evaluateCashOutEnter({
      lean: goldLean({ yes_ask: 0.7, yes_bid: 0.64 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(ok.ok).toBe(true);
    expect(CASH_OUT_SPREAD_MAX_USD).toBe(0.06);
  });

  test('no bid skips', () => {
    const g = evaluateCashOutEnter({
      lean: goldLean({ yes_bid: null, no_bid: null, yes_ask: 0.7 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(g.skip_reason).toBe('cash_out_no_bid');
  });

  test('needs 3 minutes left even if Auto says 2', () => {
    const g = evaluateCashOutEnter({
      lean: goldLean({ minutes_left: 2, minutes_remaining: 2.2 }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(g.skip_reason).toBe('minutes_left');
  });

  test('admin / user / asset / mix / invalid targets', () => {
    expect(evaluateCashOutEnter({ lean: goldLean(), cfg: cfg(), adminEnabled: false }).skip_reason).toBe(
      'cash_out_admin_off'
    );
    const off = cfg();
    off.risk.cash_out_enabled = false;
    expect(evaluateCashOutEnter({ lean: goldLean(), cfg: off, adminEnabled: true }).skip_reason).toBe('cash_out_off');
    const btc = cfg();
    expect(
      evaluateCashOutEnter({ lean: goldLean({ asset: 'BTC' }), cfg: btc, adminEnabled: true }).skip_reason
    ).toBe('cash_out_asset_off');
    expect(
      evaluateCashOutEnter({
        lean: goldLean(),
        cfg: cfg(),
        adminEnabled: true,
        hasOpenNonCashOutOnTicker: true,
      }).skip_reason
    ).toBe('cash_out_holding_other_path');
    const bad = cfg();
    bad.risk.cash_out_max_ask_usd = 0.9;
    bad.risk.cash_out_bid_usd = 0.88;
    expect(evaluateCashOutEnter({ lean: goldLean(), cfg: bad, adminEnabled: true }).skip_reason).toBe(
      'cash_out_invalid_targets'
    );
  });

  test('NO enter uses NO ask/bid', () => {
    const g = evaluateCashOutEnter({
      lean: goldLean({
        decision: 'NO',
        no_ask: 0.72,
        no_bid: 0.68,
        yes_ask: 0.32,
        yes_bid: 0.28,
      }),
      cfg: cfg(),
      adminEnabled: true,
    });
    expect(g.ok).toBe(true);
    expect(g.decision).toBe('NO');
  });

  test('isCashOutEnterPath requires admin + user + asset', () => {
    expect(isCashOutEnterPath({ adminEnabled: true, userEnabled: true, assets: ['Gold'], asset: 'Gold' })).toBe(true);
    expect(isCashOutEnterPath({ adminEnabled: false, userEnabled: true, assets: ['Gold'], asset: 'Gold' })).toBe(
      false
    );
    expect(isCashOutEnterPath({ adminEnabled: true, userEnabled: true, assets: ['Gold'], asset: 'BTC' })).toBe(false);
  });
});

describe('Cash out exit', () => {
  const filledAt = '2026-09-10T15:00:00.000Z';

  test('45s grace blocks bid and flip', () => {
    const early = evaluateCashOutExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.9, yes_ask: 0.92 },
      cashOutBidUsd: 0.88,
      lean: { decision: 'NO', abs_gap: 200, phase: 'live' },
      cushion: 175,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-10T15:00:20.000Z'),
    });
    expect(early.sell).toBe(false);
    expect(early.reason).toBe('grace_after_fill');
  });

  test('YES bid ≥ 0.88 sells cash_out first, even if lean flipped', () => {
    const hit = evaluateCashOutExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.88, yes_ask: 0.9 },
      cashOutBidUsd: 0.88,
      lean: { decision: 'NO', abs_gap: 200, phase: 'live' },
      cushion: 175,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-10T15:01:00.000Z'),
    });
    expect(hit.sell).toBe(true);
    expect(hit.kind).toBe('cash_out_bid');
    expect(hit.bid).toBe(0.88);
    expect(hit.target).toBe(0.88);
  });

  test('fill + (bid − max ask): paid 78¢ sells at 84¢, not 88¢', () => {
    expect(cashOutFillExitTargetUsd({ fillPayUsd: 0.82, maxAskUsd: 0.82, bidUsd: 0.88 })).toBe(0.88);
    expect(cashOutFillExitTargetUsd({ fillPayUsd: 0.78, maxAskUsd: 0.82, bidUsd: 0.88 })).toBe(0.84);
    expect(cashOutFillExitTargetUsd({ fillPayUsd: null, maxAskUsd: 0.82, bidUsd: 0.88 })).toBe(0.88);
    expect(cashOutFillExitTargetUsd({ fillPayUsd: 0.78, maxAskUsd: 0.82, bidUsd: 0.9 })).toBe(0.86);

    const miss = evaluateCashOutExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.8399, yes_ask: 0.86 },
      cashOutBidUsd: 0.88,
      cashOutMaxAskUsd: 0.82,
      fillPayUsd: 0.78,
      lean: { decision: 'YES', abs_gap: 120, phase: 'live' },
      cushion: 175,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-10T15:01:00.000Z'),
    });
    expect(miss.sell).toBe(false);
    expect(miss.target).toBe(0.84);

    const hit = evaluateCashOutExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.84, yes_ask: 0.86 },
      cashOutBidUsd: 0.88,
      cashOutMaxAskUsd: 0.82,
      fillPayUsd: 0.78,
      lean: { decision: 'YES', abs_gap: 120, phase: 'live' },
      cushion: 175,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-10T15:01:00.000Z'),
    });
    expect(hit.kind).toBe('cash_out_bid');
    expect(hit.target).toBe(0.84);
    expect(hit.bid).toBe(0.84);
  });

  test('87.99¢ does not cash out; 88.00¢ does', () => {
    const miss = evaluateCashOutExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.8799, yes_ask: 0.9 },
      cashOutBidUsd: 0.88,
      lean: { decision: 'YES', abs_gap: 120, phase: 'live' },
      cushion: 175,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-10T15:01:00.000Z'),
    });
    expect(miss.sell).toBe(false);
    const hit = evaluateCashOutExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.88, yes_ask: 0.9 },
      cashOutBidUsd: 0.88,
      lean: { decision: 'YES', abs_gap: 120, phase: 'live' },
      cushion: 175,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-10T15:01:00.000Z'),
    });
    expect(hit.kind).toBe('cash_out_bid');
  });

  test('NO cash out uses NO bid (or 1 − YES ask)', () => {
    const hit = evaluateCashOutExit({
      heldSide: 'NO',
      quotes: { yes_ask: 0.12, yes_bid: 0.1 },
      cashOutBidUsd: 0.88,
      lean: { decision: 'NO', abs_gap: 120, phase: 'live' },
      cushion: 175,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-10T15:01:00.000Z'),
    });
    expect(hit.kind).toBe('cash_out_bid');
    expect(hit.bid).toBe(0.88);
  });

  test('full opposite cushion flips at 1.00×; half gap does not', () => {
    expect(CASH_OUT_FLIP_GAP_RATIO).toBe(1);
    const flip = evaluateCashOutExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.4, yes_ask: 0.42 },
      cashOutBidUsd: 0.88,
      lean: { decision: 'NO', abs_gap: 175, phase: 'live' },
      cushion: 175,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-10T15:01:00.000Z'),
    });
    expect(flip.kind).toBe('flip');
    const small = evaluateCashOutExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.4, yes_ask: 0.42 },
      cashOutBidUsd: 0.88,
      lean: { decision: 'NO', abs_gap: 174.99, phase: 'live' },
      cushion: 175,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-10T15:01:00.000Z'),
    });
    expect(small.sell).toBe(false);
  });

  test('window ended settles — no dump', () => {
    const end = evaluateCashOutExit({
      heldSide: 'YES',
      quotes: { yes_bid: 0.9, yes_ask: 0.92 },
      cashOutBidUsd: 0.88,
      lean: { decision: 'YES', abs_gap: 120, phase: 'ended' },
      cushion: 175,
      filledAt,
      graceSeconds: 45,
      now: new Date('2026-09-10T15:14:00.000Z'),
    });
    expect(end.kind).toBe('settle');
    expect(end.sell).toBe(false);
  });

  test('sell order matches Protect: YES hits bid minus slip', () => {
    const order = buildCashOutSellOrder({
      heldSide: 'YES',
      fillCount: 7,
      quotes: { yes_bid: 0.88, yes_ask: 0.9 },
      slippageUsd: 0.02,
    });
    expect(order.ok).toBe(true);
    expect(order.side).toBe('ask');
    expect(Number(order.price)).toBeCloseTo(0.86, 4);
    expect(order.count).toBe('7');
  });
});

describe('Cash out path book', () => {
  test('parse paths including cash_out', () => {
    expect(parseTradeEntryPath('cash_out')).toBe('cash_out');
    expect(parseTradeEntryPath('home')).toBe('home');
    expect(isCashOutEntryPath('cash_out')).toBe(true);
    expect(isCashOutEntryPath('auto')).toBe(false);
  });

  test('open fill mix on one ticker', () => {
    const home = {
      ticker: 'KXGOLD-T',
      entryPath: 'home',
      fillCount: 4,
      status: 'FILLED',
      outcome: 'pending',
      asset: 'Gold',
    };
    const cash = {
      ticker: 'KXGOLD-T',
      entryPath: 'cash_out',
      fillCount: 7,
      status: 'FILLED',
      outcome: 'pending',
      asset: 'Gold',
    };
    expect(isOpenLiveFill(home)).toBe(true);
    expect(tickerHasOpenNonCashOut([home], 'KXGOLD-T')).toBe(true);
    expect(tickerHasOpenCashOut([home], 'KXGOLD-T')).toBe(false);
    expect(tickerHasOpenCashOut([cash], 'KXGOLD-T')).toBe(true);
    expect(openCashOutAssets([cash, home])).toEqual(['Gold']);
    expect(isOpenLiveFill({ ...cash, outcome: 'exited', status: 'SETTLED' })).toBe(false);
    expect(isOpenLiveFill({ ...cash, fillCount: 0 })).toBe(false);
  });

  test('skip labels', () => {
    expect(formatSkipReason('cash_out_holding')).toBe('cash out is holding this ticket');
    expect(formatSkipReason('cash_out_spread_wide')).toBe('spread too wide');
    expect(formatSkipReason('cash_out_holding_other_path')).toBe('Home or Auto already holding');
  });
});

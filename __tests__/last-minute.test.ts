import {
  evaluateLastMinuteEnter,
  isLastMinuteEnterPath,
  lastMinuteTwapOwns,
  normalizeLastMinuteAssets,
  normalizeLastMinuteMaxAskUsd,
  normalizeLastMinuteSide,
  pickLastMinuteSide,
} from '../packages/trading-core/src/lastMinute';
import { formatSkipReason } from '../packages/trading-core/src/gates';
import { defaultAppConfig } from '../packages/trading-core/src/types';
import { PATH_INFO } from '../src/content/pathInfo';

function cfg(over: Record<string, unknown> = {}) {
  const c = defaultAppConfig();
  c.auto_trade_enabled = true;
  c.assets_enabled.BTC = true;
  c.assets_enabled.Gold = true;
  c.risk.last_minute_enabled = true;
  c.risk.last_minute_side = 'yes';
  c.risk.last_minute_max_ask_usd = 0.96;
  c.risk.min_minutes_elapsed = 2;
  c.risk.fixed_dollars_per_trade = 5;
  c.risk.max_dollars_per_trade = 5;
  Object.assign(c.risk, over.risk || {});
  return c;
}

const close = new Date('2026-09-12T10:15:00.000Z');
const nowLast = new Date(close.getTime() - 20_000);

function lean(over: Record<string, unknown> = {}) {
  return {
    asset: 'Gold' as const,
    market_ticker: 'KXGOLD15M-T',
    decision: 'SKIP' as const,
    live: 3700,
    strike: 3690,
    abs_gap: 10,
    minutes_left: 0,
    minutes_elapsed: 14,
    minutes_remaining: 0.3,
    phase: 'live' as const,
    yes_ask: 0.95,
    yes_bid: 0.93,
    no_ask: 0.07,
    no_bid: 0.05,
    close_utc: close.toISOString(),
    ...over,
  };
}

describe('Last-minute path', () => {
  test('normalizers and side pick', () => {
    expect(normalizeLastMinuteMaxAskUsd(0.96)).toBe(0.96);
    expect(normalizeLastMinuteMaxAskUsd(0.5)).toBe(0.8);
    expect(normalizeLastMinuteMaxAskUsd(1.2)).toBe(0.99);
    expect(normalizeLastMinuteSide('NO')).toBe('no');
    expect(normalizeLastMinuteSide('both')).toBe('both');
    expect(normalizeLastMinuteSide(undefined)).toBe('yes');
    expect(
      pickLastMinuteSide({ side: 'yes', yesAsk: 0.95, noAsk: 0.07, maxAsk: 0.96 })
    ).toEqual({ ok: true, decision: 'YES', ask: 0.95 });
    expect(
      pickLastMinuteSide({ side: 'no', yesAsk: 0.07, noAsk: 0.95, maxAsk: 0.96 })
    ).toEqual({ ok: true, decision: 'NO', ask: 0.95 });
    expect(
      pickLastMinuteSide({ side: 'both', yesAsk: 0.55, noAsk: 0.45, maxAsk: 0.96 }).ok
    ).toBe(false);
    expect(
      pickLastMinuteSide({ side: 'both', yesAsk: 0.96, noAsk: 0.04, maxAsk: 0.96 })
    ).toEqual({ ok: true, decision: 'YES', ask: 0.96 });
    expect(normalizeLastMinuteAssets(undefined).includes('Gold')).toBe(true);
    expect(normalizeLastMinuteAssets([])).toEqual([]);
    expect(normalizeLastMinuteAssets(['Gold', 'Gold', 'NOPE'])).toEqual(['Gold']);
    expect(
      isLastMinuteEnterPath({ adminEnabled: true, userEnabled: true, assetEnabled: true, asset: 'WTI' })
    ).toBe(true);
    expect(
      isLastMinuteEnterPath({
        adminEnabled: true,
        userEnabled: true,
        assetEnabled: true,
        asset: 'WTI',
        assets: ['Gold'],
      })
    ).toBe(false);
    expect(
      lastMinuteTwapOwns({
        twapAdminEnabled: true,
        twapUserEnabled: true,
        twapAssets: ['BTC', 'ETH'],
        asset: 'BTC',
      })
    ).toBe(true);
    expect(
      lastMinuteTwapOwns({
        twapAdminEnabled: true,
        twapUserEnabled: true,
        twapAssets: ['BTC', 'ETH'],
        asset: 'Gold',
      })
    ).toBe(false);
    expect(formatSkipReason('last_minute_twap_owns')).toBe('twap lock owns this coin');
    expect(formatSkipReason('last_minute_no_favorite')).toBe('no last-minute favorite');
  });

  test('buys Yes in the last minute at or under entry ask', () => {
    const gate = evaluateLastMinuteEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLast,
    });
    expect(gate.ok).toBe(true);
    expect(gate.decision).toBe('YES');
    expect(gate.time_in_force).toBe('immediate_or_cancel');
  });

  test('does not use cushions or Auto minutes', () => {
    const c = cfg();
    c.cushions.Gold = 25;
    c.risk.min_minutes_left = 2;
    const gate = evaluateLastMinuteEnter({
      lean: lean({ abs_gap: 1 }),
      cfg: c,
      adminEnabled: true,
      now: nowLast,
    });
    expect(gate.ok).toBe(true);
  });

  test('sits out when TWAP owns the coin or another path is holding', () => {
    const c = cfg();
    c.assets_enabled.BTC = true;
    c.risk.twap_lock_enabled = true;
    c.risk.twap_lock_assets = ['BTC'];
    const twap = evaluateLastMinuteEnter({
      lean: lean({ asset: 'BTC', market_ticker: 'KXBTC15M-T' }),
      cfg: c,
      adminEnabled: true,
      twapAdminEnabled: true,
      now: nowLast,
    });
    expect(twap.ok).toBe(false);
    expect(twap.skip_reason).toBe('last_minute_twap_owns');

    const held = evaluateLastMinuteEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
      now: nowLast,
      hasOpenOnTicker: true,
    });
    expect(held.ok).toBe(false);
    expect(held.skip_reason).toBe('last_minute_holding_other_path');

    const assetOff = evaluateLastMinuteEnter({
      lean: lean(),
      cfg: cfg({ risk: { last_minute_assets: ['BTC'] } }),
      adminEnabled: true,
      now: nowLast,
    });
    expect(assetOff.ok).toBe(false);
    expect(assetOff.skip_reason).toBe('last_minute_asset_off');
    expect(formatSkipReason('last_minute_asset_off')).toBe('last-minute asset off');
  });

  test('silent skip outside the last minute', () => {
    const gate = evaluateLastMinuteEnter({
      lean: lean(),
      cfg: cfg(),
      adminEnabled: true,
      now: new Date(close.getTime() - 5 * 60_000),
    });
    expect(gate.ok).toBe(false);
    expect(gate.skip_reason).toBe('last_minute_not_last_minute');
  });

  test('i-icon copy names uses, unused settings, and true isolation', () => {
    expect(PATH_INFO.lastMinute.body).toMatch(/Does not pull coins off Cash out or Auto/);
    expect(PATH_INFO.lastMinute.body).toMatch(/Window cap 1/);
    expect(PATH_INFO.lastMinute.body).toMatch(/TWAP lock/);
    expect(PATH_INFO.lastMinute.body).toMatch(/Cushions/);
    expect(PATH_INFO.auto.body).toMatch(/no last-minute chase/);
    expect(PATH_INFO.cashOut.body).toMatch(/never last-minute/);
    expect(PATH_INFO.twapLock.body).toMatch(/leave Cash out and Auto/);
  });
});

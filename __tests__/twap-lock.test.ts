import {
  evaluateTwapLockEnter,
  evaluateTwapLockSeries,
  isTwapLockEnterPath,
  isTwapLockEntryPath,
  twapLockBlocksOtherAutoPaths,
  normalizeTwapLockAssets,
  normalizeTwapLockMaxAskUsd,
  TWAP_LOCK_SAMPLE_COUNT,
} from '../packages/trading-core/src/twapLock';
import { formatSkipReason } from '../packages/trading-core/src/gates';
import { defaultAppConfig } from '../packages/trading-core/src/types';
import { parseCfbRtiPrint, parseCfbRtiPrints } from '../services/cloud-backend/src/services/cfbRti';

function cfg(over: Record<string, unknown> = {}) {
  const c = defaultAppConfig();
  c.auto_trade_enabled = true;
  c.assets_enabled.BTC = true;
  c.assets_enabled.ETH = true;
  c.risk.twap_lock_enabled = true;
  c.risk.twap_lock_assets = ['BTC', 'ETH'];
  c.risk.twap_lock_max_ask_usd = 0.96;
  c.risk.min_minutes_elapsed = 2;
  c.risk.fixed_dollars_per_trade = 5;
  c.risk.max_dollars_per_trade = 5;
  Object.assign(c.risk, over.risk || {});
  return c;
}

const close = new Date('2026-09-11T20:15:00.000Z');

function printsForSeconds(startSec: number, count: number, price: number) {
  return Array.from({ length: count }, (_, i) => ({ utcSec: startSec + i, price }));
}

function btcLean(over: Record<string, unknown> = {}) {
  return {
    asset: 'BTC' as const,
    market_ticker: 'KXBTC15M-T',
    decision: 'SKIP' as const,
    live: 80100,
    strike: 80000,
    abs_gap: 100,
    minutes_left: 0,
    minutes_elapsed: 14,
    minutes_remaining: 0.05,
    phase: 'live' as const,
    yes_ask: 0.95,
    yes_bid: 0.93,
    no_ask: 0.07,
    no_bid: 0.05,
    close_utc: close.toISOString(),
    ...over,
  };
}

describe('TWAP lock math', () => {
  test('normalizers clamp max ask and assets', () => {
    expect(normalizeTwapLockMaxAskUsd(0.96)).toBe(0.96);
    expect(normalizeTwapLockMaxAskUsd(0.5)).toBe(0.9);
    expect(normalizeTwapLockMaxAskUsd(0.99)).toBe(0.97);
    expect(normalizeTwapLockAssets(undefined)).toEqual(['BTC', 'ETH']);
    expect(normalizeTwapLockAssets(['BTC', 'Gold', 'ETH', 'BTC'])).toEqual(['BTC', 'ETH']);
    expect(normalizeTwapLockAssets([])).toEqual([]);
    expect(isTwapLockEnterPath({ adminEnabled: true, userEnabled: true, assets: ['BTC'], asset: 'BTC' })).toBe(
      true
    );
    expect(
      twapLockBlocksOtherAutoPaths({
        adminEnabled: true,
        userEnabled: true,
        assets: ['BTC', 'ETH'],
        asset: 'BTC',
      })
    ).toBe(true);
    expect(
      twapLockBlocksOtherAutoPaths({
        adminEnabled: true,
        userEnabled: true,
        assets: ['BTC', 'ETH'],
        asset: 'Gold',
      })
    ).toBe(false);
    expect(isTwapLockEnterPath({ adminEnabled: false, userEnabled: true, assets: ['BTC'], asset: 'BTC' })).toBe(
      false
    );
    expect(isTwapLockEntryPath('twap_lock')).toBe(true);
    expect(isTwapLockEntryPath('gold_fade')).toBe(false);
  });

  test('banked >= strike * 60 locks; one cent short does not', () => {
    const startSec = Math.floor((close.getTime() - 60_000) / 1000);
    const now = new Date(close.getTime() - 2000);
    const lock = evaluateTwapLockSeries({
      prints: printsForSeconds(startSec, 58, 90000),
      closeUtc: close,
      now,
      strike: 80000,
    });
    expect(lock.ok).toBe(true);
    expect(lock.elapsed).toBe(58);
    expect(lock.banked).toBe(58 * 90000);
    expect(lock.needed).toBe(80000 * 60);
    expect(lock.locked).toBe(true);
    const shortPrints = printsForSeconds(startSec, 58, 80000);
    const short = evaluateTwapLockSeries({
      prints: shortPrints,
      closeUtc: close,
      now,
      strike: 80000,
    });
    expect(short.ok).toBe(true);
    expect(short.banked).toBe(58 * 80000);
    expect(short.locked).toBe(false);
  });

  test('45 samples at strike+$150 is the blog-post trap — not locked', () => {
    const startSec = Math.floor((close.getTime() - 60_000) / 1000);
    const now = new Date(close.getTime() - 15_000);
    const series = evaluateTwapLockSeries({
      prints: printsForSeconds(startSec, 45, 80150),
      closeUtc: close,
      now,
      strike: 80000,
    });
    expect(series.ok).toBe(true);
    expect(series.elapsed).toBe(45);
    expect(series.locked).toBe(false);
    expect(series.banked).toBe(45 * 80150);
    expect(series.needed).toBe(80000 * TWAP_LOCK_SAMPLE_COUNT);
  });

  test('missing one second fails closed', () => {
    const startSec = Math.floor((close.getTime() - 60_000) / 1000);
    const now = new Date(close.getTime() - 2000);
    const prints = printsForSeconds(startSec, 58, 90000);
    prints.splice(10, 1);
    const series = evaluateTwapLockSeries({
      prints,
      closeUtc: close,
      now,
      strike: 80000,
    });
    expect(series.ok).toBe(false);
    expect(series.reason).toBe('twap_lock_feed');
  });

  test('settled-window fixture matches Kalshi Yes when close TWAP >= strike', () => {
    const startSec = Math.floor((close.getTime() - 60_000) / 1000);
    const yesPrints = printsForSeconds(startSec, 59, 82000);
    expect((59 * 82000) / 60).toBeGreaterThanOrEqual(80000);
    const yesAtLastSecond = evaluateTwapLockSeries({
      prints: yesPrints,
      closeUtc: close,
      now: new Date(close.getTime() - 1000),
      strike: 80000,
    });
    expect(yesAtLastSecond.ok).toBe(true);
    expect(yesAtLastSecond.elapsed).toBe(59);
    expect(yesAtLastSecond.locked).toBe(true);
    const noPrints = printsForSeconds(startSec, 60, 79990);
    expect(noPrints.reduce((s, p) => s + p.price, 0) / 60).toBeLessThan(80000);
    const noWin = evaluateTwapLockSeries({
      prints: noPrints,
      closeUtc: close,
      now: new Date(close.getTime() - 1000),
      strike: 80000,
    });
    expect(noWin.ok).toBe(true);
    expect(noWin.locked).toBe(false);
  });
});

describe('TWAP lock enter', () => {
  const startSec = Math.floor((close.getTime() - 60_000) / 1000);
  const now = new Date(close.getTime() - 2000);
  const lockedPrints = printsForSeconds(startSec, 58, 90000);

  test('ask $0.98 vs max $0.96 skips; admin/user/asset/Gold skip', () => {
    const ok = evaluateTwapLockEnter({
      lean: btcLean(),
      cfg: cfg(),
      adminEnabled: true,
      prints: lockedPrints,
      now,
    });
    expect(ok.ok).toBe(true);
    expect(ok.decision).toBe('YES');

    expect(
      evaluateTwapLockEnter({
        lean: btcLean({ yes_ask: 0.98 }),
        cfg: cfg(),
        adminEnabled: true,
        prints: lockedPrints,
        now,
      }).skip_reason
    ).toBe('twap_lock_ask_rich');
    expect(
      evaluateTwapLockEnter({
        lean: btcLean(),
        cfg: cfg(),
        adminEnabled: false,
        prints: lockedPrints,
        now,
      }).skip_reason
    ).toBe('twap_lock_admin_off');
    const userOff = cfg();
    userOff.risk.twap_lock_enabled = false;
    expect(
      evaluateTwapLockEnter({ lean: btcLean(), cfg: userOff, adminEnabled: true, prints: lockedPrints, now })
        .skip_reason
    ).toBe('twap_lock_off');
    const btcOff = cfg();
    btcOff.risk.twap_lock_assets = ['ETH'];
    expect(
      evaluateTwapLockEnter({ lean: btcLean(), cfg: btcOff, adminEnabled: true, prints: lockedPrints, now })
        .skip_reason
    ).toBe('twap_lock_asset_off');
    expect(
      evaluateTwapLockEnter({
        lean: btcLean({ asset: 'Gold', market_ticker: 'KXGOLD-T' }),
        cfg: cfg(),
        adminEnabled: true,
        prints: lockedPrints,
        now,
      }).skip_reason
    ).toBe('twap_lock_asset_off');
  });

  test('thin bid On + bidSize null fails closed', () => {
    const unknown = evaluateTwapLockEnter({
      lean: btcLean(),
      cfg: cfg(),
      adminEnabled: true,
      prints: lockedPrints,
      now,
      skipThinBid: true,
      bidSize: null,
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.skip_reason).toBe('twap_lock_feed');
  });

  test('skip labels', () => {
    expect(formatSkipReason('twap_lock_not_locked')).toBe('not locked');
    expect(formatSkipReason('twap_lock_ask_rich')).toBe('ask too rich');
    expect(formatSkipReason('twap_lock_feed')).toBe('lock feed');
    expect(formatSkipReason('twap_lock_too_late')).toBe('too late');
    expect(formatSkipReason('twap_lock_holding')).toBe('twap lock is holding this ticket');
  });
});

describe('CFB parse', () => {
  test('reads value/time ticker JSON and Kalshi envelope', () => {
    expect(parseCfbRtiPrint({ value: '80123.45', time: 1773000000 })).toEqual({
      utcSec: 1773000000,
      price: 80123.45,
    });
    expect(
      parseCfbRtiPrint({
        data: {
          serverTime: '2026-09-11T23:14:59.000Z',
          payload: [
            { id: 'BRTI', value: '80100.00', time: 1773000000 },
            { id: 'BRTI', value: '80123.45', time: 1773003599 },
          ],
        },
      })
    ).toEqual({ utcSec: 1773003599, price: 80123.45 });
    expect(parseCfbRtiPrint({})).toBeNull();
    expect(
      parseCfbRtiPrints({
        data: {
          payload: [
            { value: 90, time: 1773000000 },
            { value: 101, time: 1773003600 },
          ],
        },
      })
    ).toHaveLength(2);
  });
});

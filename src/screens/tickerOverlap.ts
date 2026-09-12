import { TradeRecord, TradeEntryPath, parseEntryPath } from '../storage/repos';
import { isCountableWindowBuy } from '../../packages/trading-core/src/gates';
import { isCashOutEnterPath } from '../../packages/trading-core/src/cashOut';
import { isGoldFadeEnterPath } from '../../packages/trading-core/src/goldFade';
import {
  isLastMinuteEnterPath,
  isLastMinuteWatchWindow,
  isLastMinuteWindow,
  lastMinuteTimingFromRisk,
  lastMinuteTwapOwns,
  resolveLastMinuteCloseUtc,
} from '../../packages/trading-core/src/lastMinute';
import { isStepBuyEnterPath, normalizeStepBuyStartMinutes, stepBuyLotsForTicker } from '../../packages/trading-core/src/stepBuy';
import { isSpikeFadeEnterPath, isSpikeFadeEnterWindow } from '../../packages/trading-core/src/spikeFade';
import { isPairLockEnterPath, isPairLockEnterWindow } from '../../packages/trading-core/src/pairLock';
import { isTwapLockEnterPath } from '../../packages/trading-core/src/twapLock';

export type OverlapPathId = TradeEntryPath;

const SITTER_ORDER: OverlapPathId[] = [
  'home',
  'auto',
  'cash_out',
  'gold_fade',
  'twap_lock',
  'last_minute',
  'step_buy',
  'spike_fade',
  'pair_lock',
];

export const OVERLAP_PATH_LABEL: Record<OverlapPathId, string> = {
  home: 'Home',
  auto: 'Auto',
  cash_out: 'Cash out',
  gold_fade: 'Gold fade',
  twap_lock: 'TWAP lock',
  last_minute: 'Last-minute',
  step_buy: 'Step buy',
  spike_fade: 'Spike fade',
  pair_lock: 'Pair lock',
};

const HOLDING_LINE: Record<OverlapPathId, string> = {
  home: 'Home is holding this ticket',
  auto: 'Auto is holding this ticket',
  cash_out: 'cash out is holding this ticket',
  gold_fade: 'gold fade is holding this ticket',
  twap_lock: 'twap lock is holding this ticket',
  last_minute: 'last-minute is holding this ticket',
  step_buy: 'step buy is holding this ticket',
  spike_fade: 'spike fade is holding this ticket',
  pair_lock: 'pair lock is holding this ticket',
};

export function joinOverlapNames(labels: string[]): string {
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export function firstWindowBuyPath(
  trades: Array<Pick<TradeRecord, 'market_ticker' | 'dry_run' | 'outcome' | 'fill_count' | 'entry_path'>>,
  ticker: string | null | undefined
): OverlapPathId | undefined {
  const tkr = String(ticker || '').trim();
  if (!tkr) return undefined;
  for (const row of trades || []) {
    if (String(row.market_ticker || '').trim() !== tkr) continue;
    if (!isCountableWindowBuy(row)) continue;
    return parseEntryPath(row.entry_path);
  }
  return undefined;
}

function isOpenHeldFill(
  trade: Pick<TradeRecord, 'market_ticker' | 'dry_run' | 'outcome' | 'fill_count'>,
  ticker: string
): boolean {
  if (String(trade.market_ticker || '').trim() !== ticker) return false;
  if (trade.dry_run) return false;
  if (!(Number(trade.fill_count ?? 0) > 0)) return false;
  const outcome = String(trade.outcome || 'pending');
  return outcome === 'pending' || outcome === 'exiting';
}

function heldPath(
  trades: Array<Pick<TradeRecord, 'market_ticker' | 'dry_run' | 'outcome' | 'fill_count' | 'entry_path'>>,
  ticker: string | null | undefined
): OverlapPathId | undefined {
  const tkr = String(ticker || '').trim();
  if (!tkr) return undefined;
  const held = (trades || []).find((t) => isOpenHeldFill(t, tkr));
  return held ? parseEntryPath(held.entry_path) : undefined;
}

function withSitters(lead: string, sitters: OverlapPathId[]): string {
  if (!sitters.length) return lead;
  const names = joinOverlapNames(sitters.map((id) => OVERLAP_PATH_LABEL[id]));
  return `${lead} — ${names} ${sitters.length === 1 ? 'sits out' : 'sit out'}`;
}

export function formatSharedChipOverlapNote(groups: Array<{ title: string; assets: string[] }>): string | null {
  const byAsset = new Map<string, string[]>();
  for (const group of groups) {
    for (const asset of group.assets) {
      const key = String(asset || '').trim();
      if (!key) continue;
      const titles = byAsset.get(key) || [];
      if (!titles.includes(group.title)) titles.push(group.title);
      byAsset.set(key, titles);
    }
  }
  const overlapped = [...byAsset.entries()].filter(([, titles]) => titles.length > 1);
  if (!overlapped.length) return null;
  if (overlapped.length === 1) {
    const [asset, titles] = overlapped[0];
    return `${asset} is also on ${joinOverlapNames(titles)}. First fill this window uses the slot.`;
  }
  const assets = overlapped.map(([asset]) => asset);
  return `${joinOverlapNames(assets)} are on more than one path. First fill this window uses the slot.`;
}

export function formatTickerOverlapLine(opts: {
  asset: string;
  ticker?: string | null;
  decision?: string;
  trades: TradeRecord[];
  now?: Date;
  closeUtc?: string | Date | null;
  minutesElapsed?: number | null;
  homeOn?: boolean;
  autoOn?: boolean;
  cashOutAdmin?: boolean;
  cashOutOn?: boolean;
  cashOutAssets?: unknown;
  goldFadeAdmin?: boolean;
  goldFadeOn?: boolean;
  twapAdmin?: boolean;
  twapOn?: boolean;
  twapAssets?: unknown;
  lastMinuteAdmin?: boolean;
  lastMinuteOn?: boolean;
  lastMinuteAssets?: unknown;
  lastMinuteWatchSec?: unknown;
  lastMinuteEnterSec?: unknown;
  lastMinuteStopSec?: unknown;
  stepBuyAdmin?: boolean;
  stepBuyOn?: boolean;
  stepBuyAssets?: unknown;
  stepBuyStartMinutes?: unknown;
  spikeFadeAdmin?: boolean;
  spikeFadeOn?: boolean;
  spikeFadeAssets?: unknown;
  spikeFadeStartMinutes?: unknown;
  spikeFadeUntilMinutes?: unknown;
  pairLockAdmin?: boolean;
  pairLockOn?: boolean;
  pairLockAssets?: unknown;
  pairLockStartMinutes?: unknown;
  pairLockUntilMinutes?: unknown;
  assetEnabled?: boolean;
}): string | null {
  const asset = String(opts.asset || '').trim();
  const assetEnabled = opts.assetEnabled !== false;
  const now = opts.now || new Date();
  const closeUtc = resolveLastMinuteCloseUtc({ close_utc: opts.closeUtc }, now);
  const ticker = String(opts.ticker || '').trim();
  const lmTimes = lastMinuteTimingFromRisk({
    last_minute_watch_seconds: opts.lastMinuteWatchSec,
    last_minute_enter_seconds: opts.lastMinuteEnterSec,
    last_minute_stop_seconds: opts.lastMinuteStopSec,
  });

  const twapOwns = lastMinuteTwapOwns({
    twapAdminEnabled: Boolean(opts.twapAdmin),
    twapUserEnabled: Boolean(opts.twapOn),
    twapAssets: opts.twapAssets,
    asset,
  });
  const lmOn = isLastMinuteEnterPath({
    adminEnabled: Boolean(opts.lastMinuteAdmin),
    userEnabled: Boolean(opts.lastMinuteOn),
    assetEnabled,
    asset,
    assets: opts.lastMinuteAssets,
  });
  const lmWatching = Boolean(lmOn && closeUtc && isLastMinuteWatchWindow(now, closeUtc, lmTimes.watchSec));
  const lmBuying = Boolean(lmOn && closeUtc && isLastMinuteWindow(now, closeUtc, lmTimes.enterSec, lmTimes.stopSec));
  const stepOn = isStepBuyEnterPath({
    adminEnabled: Boolean(opts.stepBuyAdmin),
    userEnabled: Boolean(opts.stepBuyOn),
    assetEnabled,
    asset,
    assets: opts.stepBuyAssets,
  });
  const stepStarted =
    stepOn &&
    (Number(opts.minutesElapsed) || 0) + 1e-9 >= normalizeStepBuyStartMinutes(opts.stepBuyStartMinutes);
  const spikeOn = isSpikeFadeEnterPath({
    adminEnabled: Boolean(opts.spikeFadeAdmin),
    userEnabled: Boolean(opts.spikeFadeOn),
    assetEnabled,
    asset,
    assets: opts.spikeFadeAssets,
  });
  const spikeInWindow =
    spikeOn &&
    isSpikeFadeEnterWindow({
      minutesElapsed: opts.minutesElapsed,
      startMinutes: opts.spikeFadeStartMinutes,
      untilMinutes: opts.spikeFadeUntilMinutes,
    });
  const pairOn = isPairLockEnterPath({
    adminEnabled: Boolean(opts.pairLockAdmin),
    userEnabled: Boolean(opts.pairLockOn),
    assetEnabled,
    asset,
    assets: opts.pairLockAssets,
  });
  const pairInWindow =
    pairOn &&
    isPairLockEnterWindow({
      minutesElapsed: opts.minutesElapsed,
      startMinutes: opts.pairLockStartMinutes,
      untilMinutes: opts.pairLockUntilMinutes,
    });
  const twapOn = isTwapLockEnterPath({
    adminEnabled: Boolean(opts.twapAdmin),
    userEnabled: Boolean(opts.twapOn),
    assets: opts.twapAssets,
    asset,
  });
  const cashOn = isCashOutEnterPath({
    adminEnabled: Boolean(opts.cashOutAdmin),
    userEnabled: Boolean(opts.cashOutOn),
    assets: opts.cashOutAssets,
    asset,
  });
  const goldOn = isGoldFadeEnterPath({
    adminEnabled: Boolean(opts.goldFadeAdmin),
    userEnabled: Boolean(opts.goldFadeOn),
    asset,
  });
  const homeOn = false;
  const autoOn = Boolean(opts.autoOn) && assetEnabled;
  const stepLots = ticker ? stepBuyLotsForTicker(opts.trades, ticker).count : 0;
  const lmOwns = lmBuying && stepLots <= 0 && !twapOwns;

  const active: Partial<Record<OverlapPathId, boolean>> = {
    home: homeOn,
    auto: autoOn,
    cash_out: cashOn,
    gold_fade: goldOn,
    twap_lock: twapOn,
    last_minute: lmWatching,
    step_buy: stepStarted,
    spike_fade: spikeInWindow,
    pair_lock: pairInWindow,
  };

  const sittersFor = (owner: OverlapPathId, allowed?: OverlapPathId[]): OverlapPathId[] =>
    SITTER_ORDER.filter((id) => {
      if (id === owner) return false;
      if (allowed && !allowed.includes(id)) return false;
      return Boolean(active[id]);
    });

  const holding = heldPath(opts.trades, ticker);
  if (holding) {
    return withSitters(HOLDING_LINE[holding], sittersFor(holding));
  }

  const oneSecond: OverlapPathId[] = ['last_minute', 'step_buy', 'spike_fade', 'pair_lock'];
  if (twapOwns) {
    const blocked = sittersFor('twap_lock', oneSecond);
    if (!blocked.length) return null;
    return `TWAP lock owns ${asset}`;
  }

  const windowOwner = firstWindowBuyPath(opts.trades, ticker);
  if (windowOwner) {
    const sitters = sittersFor(windowOwner);
    if (!sitters.length) return null;
    return withSitters(
      `${OVERLAP_PATH_LABEL[windowOwner]} already filled this window`,
      sitters
    );
  }

  if (lmOwns) {
    const sitters = sittersFor('last_minute', ['step_buy', 'spike_fade', 'pair_lock']);
    if (!sitters.length) return null;
    return withSitters('Last-minute owns new buys', sitters);
  }

  return null;
}

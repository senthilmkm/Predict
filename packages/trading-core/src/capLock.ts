import { AppConfig, ASSETS_CATALOG, AssetKey } from './types';
import { capGateLotCount, evaluateStaticGate, GateResult, LeanSignal } from './gates';
import { CashOutQuotes, isOpenLiveFill, openFillsForTicker, ticketUsd } from './cashOut';
import { buildProtectSellOrder, computeProtectSellPnlUsd } from './protectSell';
import { lastMinuteTwapOwns } from './lastMinute';
import { goldFadeMinutesLeft } from './goldFade';

export const CAP_LOCK_MAX_LOSS_DEFAULT = 0.05;
export const CAP_LOCK_MAX_LOSS_MIN = 0.01;
export const CAP_LOCK_MAX_LOSS_MAX = 0.08;
export const CAP_LOCK_WINDOW_OPEN_DEFAULT = 90;
export const CAP_LOCK_WINDOW_OPEN_MIN = 30;
export const CAP_LOCK_WINDOW_OPEN_MAX = 180;
export const CAP_LOCK_LOT_COUNT_DEFAULT = 1;
export const CAP_LOCK_LOT_COUNT_MAX = 5;
export const CAP_LOCK_WINDOW_SEC = 15 * 60;
/** Wait this long after a one-leg fill before dumping. Same-tick flatten was the big loss. */
export const CAP_LOCK_FLATTEN_GRACE_SEC = 15;
/** After a 0-fill, sit this long before sending again. */
export const CAP_LOCK_MISS_COOLDOWN_SEC = 8;
/** Only dump a leftover if minutes left are at or under this, or the dump is ≤ max lock loss. */
export const CAP_LOCK_HOLD_MINUTES_LEFT = 2;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function snap(n: number, step: number): number {
  if (step <= 0) return n;
  const rounded = Math.round(n / step) * step;
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  return Number(rounded.toFixed(decimals));
}

export function normalizeCapLockMaxLossUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? CAP_LOCK_MAX_LOSS_DEFAULT), CAP_LOCK_MAX_LOSS_MIN, CAP_LOCK_MAX_LOSS_MAX),
    0.01
  );
}

export function normalizeCapLockWindowOpenSeconds(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? CAP_LOCK_WINDOW_OPEN_DEFAULT), CAP_LOCK_WINDOW_OPEN_MIN, CAP_LOCK_WINDOW_OPEN_MAX)
  );
}

export function normalizeCapLockLotCount(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? CAP_LOCK_LOT_COUNT_DEFAULT), 1, CAP_LOCK_LOT_COUNT_MAX));
}

export function isCapLockAllowLater(raw: unknown): boolean {
  return raw !== false;
}

/** Full 15m catalog — every chip is selectable. Off-by-default coins stay listed. */
export function capLockDefaultAssets(): string[] {
  return ASSETS_CATALOG.map((a) => a.key);
}

/** Missing → catalog coins that start On. Empty = no Cap lock buys. */
export function normalizeCapLockAssets(raw: unknown): string[] {
  const allowed = capLockDefaultAssets();
  const allowedSet = new Set(allowed);
  if (raw == null || !Array.isArray(raw)) {
    return allowed.filter((k) => ASSETS_CATALOG.find((a) => a.key === k)?.defaultOn !== false);
  }
  const out: string[] = [];
  for (const item of raw) {
    const k = String(item || '').trim();
    if (allowedSet.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function isCapLockAssetSelected(assets: unknown, asset: string): boolean {
  return normalizeCapLockAssets(assets).includes(String(asset));
}

export function isCapLockEntryPath(raw: unknown): boolean {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/-/g, '_');
  return v === 'cap_lock' || v === 'caplock' || v === 'completeness_lock' || v === 'completenesslock';
}

export function isCapLockEnterPath(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assetEnabled: boolean;
  asset: string;
  assets?: unknown;
}): boolean {
  return Boolean(
    opts.adminEnabled &&
      opts.userEnabled &&
      opts.assetEnabled &&
      String(opts.asset || '').trim() &&
      isCapLockAssetSelected(opts.assets, opts.asset)
  );
}

export function capLockTwapOwns(opts: {
  twapAdminEnabled: boolean;
  twapUserEnabled: boolean;
  twapAssets: unknown;
  asset: string;
}): boolean {
  return lastMinuteTwapOwns(opts);
}

/**
 * Kalshi binary taker fee, rounded up to a cent.
 * fee = ceil(0.07 × C × P × (1 − P) × 100) / 100
 * Overestimate on purpose — never under.
 */
export function kalshiBinaryFeeUsd(priceUsd: unknown, count: unknown): number {
  const p = ticketUsd(priceUsd);
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (p == null || n <= 0) return 0;
  const px = Math.min(0.99, Math.max(0.01, p));
  return Math.ceil(0.07 * n * px * (1 - px) * 100) / 100;
}

/** $1 − YES − NO − fees. Negative = locked loss. */
export function capLockLockedPnlUsd(opts: {
  yesAskUsd?: unknown;
  noAskUsd?: unknown;
  yesCount?: unknown;
  noCount?: unknown;
}): number | null {
  const yes = ticketUsd(opts.yesAskUsd);
  const no = ticketUsd(opts.noAskUsd);
  const yesN = Math.max(0, Math.floor(Number(opts.yesCount) || 0));
  const noN = Math.max(0, Math.floor(Number(opts.noCount) || 0));
  const n = Math.min(yesN || noN, noN || yesN);
  if (yes == null || no == null || n <= 0) return null;
  const fees = kalshiBinaryFeeUsd(yes, n) + kalshiBinaryFeeUsd(no, n);
  return snap(n * 1 - n * yes - n * no - fees, 0.01);
}

export function capLockFitsCap(opts: {
  yesAskUsd?: unknown;
  noAskUsd?: unknown;
  count?: unknown;
  maxLockLossUsd?: unknown;
}): boolean {
  const yes = ticketUsd(opts.yesAskUsd);
  const no = ticketUsd(opts.noAskUsd);
  const n = Math.max(0, Math.floor(Number(opts.count) || 0));
  if (yes == null || no == null || n <= 0) return false;
  const cap = normalizeCapLockMaxLossUsd(opts.maxLockLossUsd);
  const debit = n * yes + n * no + kalshiBinaryFeeUsd(yes, n) + kalshiBinaryFeeUsd(no, n);
  return debit <= n * 1 + cap + 1e-9;
}

export function capLockSecondsElapsed(lean: {
  minutes_elapsed?: unknown;
  minutes_remaining?: unknown;
}): number | null {
  const remaining = Number(lean.minutes_remaining);
  if (Number.isFinite(remaining) && remaining >= 0) {
    return Math.max(0, CAP_LOCK_WINDOW_SEC - remaining * 60);
  }
  const elapsedMin = Number(lean.minutes_elapsed);
  if (!Number.isFinite(elapsedMin) || elapsedMin < 0) return null;
  return Math.max(0, elapsedMin * 60);
}

export function isCapLockEnterWindow(opts: {
  minutesElapsed?: unknown;
  minutesRemaining?: unknown;
  windowOpenSeconds?: unknown;
  allowLater?: unknown;
}): boolean {
  const elapsed = capLockSecondsElapsed({
    minutes_elapsed: opts.minutesElapsed,
    minutes_remaining: opts.minutesRemaining,
  });
  if (elapsed == null) return false;
  if (elapsed >= CAP_LOCK_WINDOW_SEC - 1e-9) return false;
  const remaining = Number(opts.minutesRemaining);
  if (Number.isFinite(remaining) && remaining <= 0) return false;
  const openSec = normalizeCapLockWindowOpenSeconds(opts.windowOpenSeconds);
  if (elapsed <= openSec + 1e-9) return true;
  return isCapLockAllowLater(opts.allowLater);
}

export type CapLockSide = 'YES' | 'NO';

export type CapLockLotState = {
  yesCount: number;
  noCount: number;
  yesFillUsd: number | null;
  noFillUsd: number | null;
  yesFilledAt: string | Date | number | null;
  noFilledAt: string | Date | number | null;
  matchedCount: number;
  extraSide: CapLockSide | null;
  extraCount: number;
  attempted: boolean;
  locked: boolean;
};

export type CapLockTrade = {
  ticker?: string;
  market_ticker?: string;
  entryPath?: unknown;
  entry_path?: unknown;
  decision?: unknown;
  executedAt?: string | Date | number | null;
  payPrice?: unknown;
  pay_price?: unknown;
  price?: unknown;
  fillCount?: number | null;
  fill_count?: number | null;
} & Parameters<typeof isOpenLiveFill>[0];

function sideOf(raw: unknown): CapLockSide | null {
  const v = String(raw || '').toUpperCase();
  if (v === 'YES') return 'YES';
  if (v === 'NO') return 'NO';
  return null;
}

function fillUsdOf(t: CapLockTrade): number | null {
  return ticketUsd(t.payPrice ?? t.pay_price ?? t.price);
}

function fillCountOf(t: CapLockTrade): number {
  const n = Number(t.fillCount ?? t.fill_count ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function capLockLotsForTicker(trades: CapLockTrade[], marketTicker: string): CapLockLotState {
  const want = String(marketTicker || '').trim();
  const empty: CapLockLotState = {
    yesCount: 0,
    noCount: 0,
    yesFillUsd: null,
    noFillUsd: null,
    yesFilledAt: null,
    noFilledAt: null,
    matchedCount: 0,
    extraSide: null,
    extraCount: 0,
    attempted: false,
    locked: false,
  };
  let yesCount = 0;
  let noCount = 0;
  let yesFillUsd: number | null = null;
  let noFillUsd: number | null = null;
  let yesFilledAt: string | Date | number | null = null;
  let noFilledAt: string | Date | number | null = null;
  let attempted = false;
  for (const t of trades || []) {
    const ticker = String(t.ticker || t.market_ticker || '').trim();
    if (ticker !== want) continue;
    if (!isCapLockEntryPath(t.entryPath ?? t.entry_path)) continue;
    attempted = true;
    if (!isOpenLiveFill(t)) continue;
    const side = sideOf(t.decision);
    const n = fillCountOf(t);
    if (!side || n <= 0) continue;
    if (side === 'YES') {
      yesCount += n;
      yesFillUsd = fillUsdOf(t) ?? yesFillUsd;
      yesFilledAt = t.executedAt ?? yesFilledAt;
    } else {
      noCount += n;
      noFillUsd = fillUsdOf(t) ?? noFillUsd;
      noFilledAt = t.executedAt ?? noFilledAt;
    }
  }
  const matchedCount = Math.min(yesCount, noCount);
  const extraCount = Math.abs(yesCount - noCount);
  const extraSide: CapLockSide | null =
    extraCount > 0 ? (yesCount > noCount ? 'YES' : 'NO') : null;
  return {
    yesCount,
    noCount,
    yesFillUsd,
    noFillUsd,
    yesFilledAt,
    noFilledAt,
    matchedCount,
    extraSide,
    extraCount,
    attempted,
    locked: matchedCount > 0 && extraCount <= 0,
  };
}

export function tickerHasOpenCapLock(trades: CapLockTrade[], marketTicker: string): boolean {
  return openFillsForTicker(trades, marketTicker).some((t) =>
    isCapLockEntryPath((t as CapLockTrade).entryPath ?? (t as CapLockTrade).entry_path)
  );
}

export function tickerHasCapLockAttempt(trades: CapLockTrade[], marketTicker: string): boolean {
  const want = String(marketTicker || '').trim();
  if (!want) return false;
  return (trades || []).some((t) => {
    const ticker = String(t.ticker || t.market_ticker || '').trim();
    if (ticker !== want || !isCapLockEntryPath(t.entryPath ?? t.entry_path)) return false;
    return fillCountOf(t) > 0 || isOpenLiveFill(t);
  });
}

export function tickerHasOpenOtherThanCapLock(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some(
    (t) => !isCapLockEntryPath((t as CapLockTrade).entryPath ?? (t as CapLockTrade).entry_path)
  );
}

/** Matched pair holds to settlement — History Sell stays hidden. Unmatched leftover can dump. */
export function isCapLockHistorySellable(
  trade: CapLockTrade,
  trades: CapLockTrade[],
  marketTicker?: string
): boolean {
  if (!isCapLockEntryPath(trade.entryPath ?? trade.entry_path)) return true;
  if (!isOpenLiveFill(trade)) return false;
  const ticker = String(marketTicker || trade.ticker || trade.market_ticker || '').trim();
  const lots = capLockLotsForTicker(trades, ticker);
  if (lots.extraCount <= 0 || !lots.extraSide) return false;
  return sideOf(trade.decision) === lots.extraSide;
}

export function shouldWatchCapLockLots(lots: CapLockLotState): boolean {
  return lots.extraCount > 0 && lots.extraSide != null;
}

export function capLockRicherSide(yesAsk: number, noAsk: number): CapLockSide {
  return yesAsk + 1e-9 >= noAsk ? 'YES' : 'NO';
}

function capLockBuyGate(side: CapLockSide, ask: number, count: number): GateResult {
  const need = Math.max(1, count);
  return {
    ok: true,
    decision: side,
    count: String(need),
    side: side === 'YES' ? 'bid' : 'ask',
    price: ask.toFixed(2),
    pay_price: ask,
    notional_usd: Math.round(need * ask * 100) / 100,
    time_in_force: 'immediate_or_cancel',
  };
}

export type CapLockEnterResult = GateResult & {
  first?: GateResult;
  second?: GateResult;
  firstSide?: CapLockSide;
  yesAsk?: number;
  noAsk?: number;
  feeYes?: number;
  feeNo?: number;
  lockedPnlUsd?: number;
  lotCount?: number;
};

function capLockRisk(cfg: AppConfig) {
  return cfg.risk as AppConfig['risk'] & {
    cap_lock_enabled?: boolean;
    cap_lock_max_loss_usd?: number;
    cap_lock_window_open_seconds?: number;
    cap_lock_allow_later?: boolean;
    cap_lock_lot_count?: number;
    cap_lock_assets?: string[];
    twap_lock_enabled?: boolean;
    twap_lock_assets?: string[];
    min_minutes_left?: number;
  };
}

export function capLockGateConfig(cfg: AppConfig, lotCount: number, maxAsk: number): AppConfig {
  const cushions = { ...cfg.cushions };
  for (const key of Object.keys(cushions) as AssetKey[]) {
    cushions[key] = 0;
  }
  const minLeft = Math.max(0, Number(cfg.risk?.min_minutes_left) || 2);
  const clipUsd = Math.max(0.01, lotCount * maxAsk);
  return {
    ...cfg,
    risk: {
      ...cfg.risk,
      max_entry_ask_usd: Math.min(0.99, maxAsk),
      min_minutes_left: minLeft,
      min_minutes_elapsed: 0,
      smart_buy_enabled: false,
      chase_above_ask_usd: 0,
      time_in_force: 'immediate_or_cancel',
      fixed_dollars_per_trade: clipUsd,
      max_dollars_per_trade: clipUsd,
      min_dollars_per_trade: 0.01,
      max_trades_per_asset_per_window: 99,
    },
    cushions,
  };
}

export function evaluateCapLockEnter(opts: {
  lean: LeanSignal & CashOutQuotes;
  cfg: AppConfig;
  adminEnabled: boolean;
  twapAdminEnabled?: boolean;
  openPositions?: number;
  dailyPnlUsd?: number;
  tradesToday?: number;
  hasOpenOnTicker?: boolean;
  alreadyAttempted?: boolean;
  lastMinuteOwnsNewBuys?: boolean;
  pairLockOwns?: boolean;
  lastMissAtMs?: number;
  nowMs?: number;
}): CapLockEnterResult {
  const risk = capLockRisk(opts.cfg);
  if (!opts.adminEnabled) return { ok: false, skip_reason: 'cap_lock_admin_off' };
  if (risk.cap_lock_enabled !== true) return { ok: false, skip_reason: 'cap_lock_off' };
  if (!opts.cfg.assets_enabled?.[opts.lean.asset]) return { ok: false, skip_reason: 'asset_disabled' };
  if (!isCapLockAssetSelected(risk.cap_lock_assets, opts.lean.asset)) {
    return { ok: false, skip_reason: 'cap_lock_asset_off' };
  }
  if (
    capLockTwapOwns({
      twapAdminEnabled: opts.twapAdminEnabled === true,
      twapUserEnabled: risk.twap_lock_enabled === true,
      twapAssets: risk.twap_lock_assets,
      asset: opts.lean.asset,
    })
  ) {
    return { ok: false, skip_reason: 'cap_lock_twap_owns' };
  }
  if (opts.lean.phase === 'ended') return { ok: false, skip_reason: 'window_ended' };
  if (opts.lastMinuteOwnsNewBuys) return { ok: false, skip_reason: 'cap_lock_last_minute_owns' };
  if (opts.pairLockOwns) return { ok: false, skip_reason: 'cap_lock_pair_lock_owns' };
  if (opts.hasOpenOnTicker) return { ok: false, skip_reason: 'cap_lock_holding_other_path' };
  if (opts.alreadyAttempted) return { ok: false, skip_reason: 'cap_lock_attempted' };
  const missAt = Number(opts.lastMissAtMs);
  if (Number.isFinite(missAt) && missAt > 0) {
    const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
    if (nowMs - missAt < CAP_LOCK_MISS_COOLDOWN_SEC * 1000) {
      return { ok: false, skip_reason: 'cap_lock_cooldown' };
    }
  }
  if (
    !isCapLockEnterWindow({
      minutesElapsed: opts.lean.minutes_elapsed,
      minutesRemaining: opts.lean.minutes_remaining,
      windowOpenSeconds: risk.cap_lock_window_open_seconds,
      allowLater: risk.cap_lock_allow_later,
    })
  ) {
    return { ok: false, skip_reason: 'cap_lock_outside_window' };
  }
  const minLeft = Math.max(0, Number(risk.min_minutes_left) || 2);
  if (goldFadeMinutesLeft(opts.lean) <= minLeft + 1e-9) {
    return { ok: false, skip_reason: 'cap_lock_too_late' };
  }
  const yesAsk = ticketUsd(opts.lean.yes_ask);
  const noAsk = ticketUsd(opts.lean.no_ask);
  if (yesAsk == null || noAsk == null) return { ok: false, skip_reason: 'cap_lock_no_ask' };
  const lotCount = normalizeCapLockLotCount(risk.cap_lock_lot_count);
  const maxLoss = normalizeCapLockMaxLossUsd(risk.cap_lock_max_loss_usd);
  if (!capLockFitsCap({ yesAskUsd: yesAsk, noAskUsd: noAsk, count: lotCount, maxLockLossUsd: maxLoss })) {
    return { ok: false, skip_reason: 'cap_lock_too_rich' };
  }
  const leanForGate: LeanSignal = {
    ...opts.lean,
    decision: 'YES',
    abs_gap: Number(opts.lean.abs_gap) || 0,
    minutes_left: Number(opts.lean.minutes_left) || 0,
    minutes_elapsed: Number(opts.lean.minutes_elapsed) || 0,
  };
  const gate = evaluateStaticGate(
    leanForGate,
    capLockGateConfig(opts.cfg, lotCount, Math.max(yesAsk, noAsk)),
    {
      openPositions: opts.openPositions,
      dailyPnlUsd: opts.dailyPnlUsd,
      tradesToday: opts.tradesToday,
      assetTradesInWindow: 0,
    }
  );
  if (!gate.ok) return gate;
  const capped = capGateLotCount(gate, lotCount);
  if (!capped.ok) return capped;
  const firstSide = capLockRicherSide(yesAsk, noAsk);
  const secondSide: CapLockSide = firstSide === 'YES' ? 'NO' : 'YES';
  const firstAsk = firstSide === 'YES' ? yesAsk : noAsk;
  const secondAsk = secondSide === 'YES' ? yesAsk : noAsk;
  const feeYes = kalshiBinaryFeeUsd(yesAsk, lotCount);
  const feeNo = kalshiBinaryFeeUsd(noAsk, lotCount);
  const lockedPnlUsd = capLockLockedPnlUsd({
    yesAskUsd: yesAsk,
    noAskUsd: noAsk,
    yesCount: lotCount,
    noCount: lotCount,
  });
  return {
    ...capped,
    decision: firstSide,
    first: capLockBuyGate(firstSide, firstAsk, lotCount),
    second: capLockBuyGate(secondSide, secondAsk, lotCount),
    firstSide,
    yesAsk,
    noAsk,
    feeYes,
    feeNo,
    lockedPnlUsd: lockedPnlUsd ?? undefined,
    lotCount,
  };
}

/** Highest first-leg pay that still fits the pair cap. Lets IOC bump 1–2¢ on a walked ask. */
export function capLockFirstMaxPayUsd(opts: {
  firstSide: CapLockSide;
  firstAskUsd: unknown;
  otherAskUsd: unknown;
  count: unknown;
  maxLockLossUsd?: unknown;
}): number {
  const first = ticketUsd(opts.firstAskUsd);
  const other = ticketUsd(opts.otherAskUsd);
  const n = Math.max(1, Math.floor(Number(opts.count) || 1));
  if (first == null || other == null) return 0.01;
  let best = first;
  for (let p = first; p <= 0.99 + 1e-9; p = Math.round((p + 0.01) * 100) / 100) {
    const yesAskUsd = opts.firstSide === 'YES' ? p : other;
    const noAskUsd = opts.firstSide === 'NO' ? p : other;
    if (!capLockFitsCap({ yesAskUsd, noAskUsd, count: n, maxLockLossUsd: opts.maxLockLossUsd })) break;
    best = p;
  }
  return best;
}

export function capLockUnmatchedAgeSec(lots: CapLockLotState, now?: Date): number | null {
  if (!lots.extraSide) return null;
  const at = lots.extraSide === 'YES' ? lots.yesFilledAt : lots.noFilledAt;
  if (at == null) return null;
  const ms = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(String(at));
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, ((now ?? new Date()).getTime() - ms) / 1000);
}

export function evaluateCapLockSecondLeg(opts: {
  firstSide: CapLockSide;
  firstFillUsd: unknown;
  firstFillCount: unknown;
  secondAskUsd: unknown;
  maxLockLossUsd?: unknown;
}): { ok: true; gate: GateResult } | { ok: false; skip_reason: string } {
  const n = Math.max(0, Math.floor(Number(opts.firstFillCount) || 0));
  if (n <= 0) return { ok: false, skip_reason: 'cap_lock_first_miss' };
  const firstFill = ticketUsd(opts.firstFillUsd);
  const secondAsk = ticketUsd(opts.secondAskUsd);
  if (firstFill == null || secondAsk == null) return { ok: false, skip_reason: 'cap_lock_no_ask' };
  const secondSide: CapLockSide = opts.firstSide === 'YES' ? 'NO' : 'YES';
  const yesAsk = opts.firstSide === 'YES' ? firstFill : secondAsk;
  const noAsk = opts.firstSide === 'NO' ? firstFill : secondAsk;
  if (!capLockFitsCap({ yesAskUsd: yesAsk, noAskUsd: noAsk, count: n, maxLockLossUsd: opts.maxLockLossUsd })) {
    return { ok: false, skip_reason: 'cap_lock_too_rich' };
  }
  return { ok: true, gate: capLockBuyGate(secondSide, secondAsk, n) };
}

export type CapLockWatchKind = 'none' | 'retry_second' | 'flatten';

export function evaluateCapLockWatch(opts: {
  lots: CapLockLotState;
  quotes: CashOutQuotes;
  maxLockLossUsd?: unknown;
  alreadyRetried?: boolean;
  now?: Date;
  minutesRemaining?: unknown;
}): { kind: CapLockWatchKind; reason?: string; second?: GateResult; flatten?: ReturnType<typeof buildProtectSellOrder> } {
  if (opts.lots.locked || (opts.lots.matchedCount > 0 && opts.lots.extraCount <= 0)) {
    return { kind: 'none', reason: 'cap_lock_hold' };
  }
  if (opts.lots.extraCount <= 0 || !opts.lots.extraSide) {
    return { kind: 'none', reason: 'cap_lock_flat' };
  }
  const extraSide = opts.lots.extraSide;
  const filledAsk = extraSide === 'YES' ? opts.lots.yesFillUsd : opts.lots.noFillUsd;
  const secondAsk = extraSide === 'YES' ? ticketUsd(opts.quotes.no_ask) : ticketUsd(opts.quotes.yes_ask);
  if (!opts.alreadyRetried && filledAsk != null && secondAsk != null) {
    const retry = evaluateCapLockSecondLeg({
      firstSide: extraSide,
      firstFillUsd: filledAsk,
      firstFillCount: opts.lots.extraCount,
      secondAskUsd: secondAsk,
      maxLockLossUsd: opts.maxLockLossUsd,
    });
    if (retry.ok) return { kind: 'retry_second', second: retry.gate };
  }
  const age = capLockUnmatchedAgeSec(opts.lots, opts.now);
  if (age == null || age < CAP_LOCK_FLATTEN_GRACE_SEC) {
    return { kind: 'none', reason: 'cap_lock_wait_second' };
  }
  const flatten = buildProtectSellOrder({
    heldSide: extraSide,
    fillCount: opts.lots.extraCount,
    yesBid: opts.quotes.yes_bid,
    yesAsk: opts.quotes.yes_ask,
    slippageUsd: 0.02,
  });
  const entry = ticketUsd(filledAsk);
  const exit = ticketUsd(flatten.economicExit);
  const cap = normalizeCapLockMaxLossUsd(opts.maxLockLossUsd);
  const minutesLeft = Number(opts.minutesRemaining);
  const late =
    Number.isFinite(minutesLeft) && minutesLeft <= CAP_LOCK_HOLD_MINUTES_LEFT + 1e-9;
  if (flatten.ok && entry != null && exit != null && !late) {
    const dumpPnl = computeProtectSellPnlUsd({
      heldSide: extraSide,
      fillCount: opts.lots.extraCount,
      entryPay: entry,
      exitEconomic: exit,
    });
    if (dumpPnl < -cap - 1e-9) {
      return { kind: 'none', reason: 'cap_lock_hold_leftover' };
    }
  }
  return { kind: 'flatten', reason: 'cap_lock_flatten', flatten };
}

export function capLockHoldingWatchText(lots: CapLockLotState, lockedPnlUsd?: number | null): string {
  if (lots.locked) {
    const pnl = lockedPnlUsd;
    if (pnl == null) return 'Cap lock holding · matched to $1';
    const sign = pnl >= 0 ? '+' : '−';
    return `Cap lock holding · locked ${sign}$${Math.abs(pnl).toFixed(2)}`;
  }
  if (lots.extraCount > 0 && lots.extraSide) {
    return `Cap lock unmatched · ${lots.extraSide} ${lots.extraCount}`;
  }
  return 'Cap lock';
}

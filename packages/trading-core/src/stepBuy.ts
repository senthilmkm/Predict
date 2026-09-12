import { AppConfig, ASSETS_CATALOG, AssetKey } from './types';
import { evaluateStaticGate, GateResult, LeanSignal } from './gates';
import { CashOutQuotes, isOpenLiveFill, openFillsForTicker, ticketUsd } from './cashOut';
import { resolveSkipThinBid } from './skipThinBid';
import { inProtectSellGrace } from './protectSell';
import {
  resolveTwapCloseUtc,
  twapLockBlocksOtherAutoPaths,
  twapLockSecondsLeft,
} from './twapLock';
import { lastMinuteTwapOwns } from './lastMinute';

export const STEP_BUY_START_MIN_DEFAULT = 5;
export const STEP_BUY_START_MIN_MIN = 2;
export const STEP_BUY_START_MIN_MAX = 10;
export const STEP_BUY_CUSHION_PCT_DEFAULT = 50;
export const STEP_BUY_CUSHION_PCT_MIN = 25;
export const STEP_BUY_CUSHION_PCT_MAX = 100;
export const STEP_BUY_LOT_COUNT_DEFAULT = 1;
export const STEP_BUY_LOT_COUNT_MAX = 5;
export const STEP_BUY_ADD_WAIT_MIN_DEFAULT = 1;
export const STEP_BUY_ADD_WAIT_MIN_MIN = 1;
export const STEP_BUY_ADD_WAIT_MIN_MAX = 3;
export const STEP_BUY_ADD_BAND_DEFAULT = 0.02;
export const STEP_BUY_ADD_BAND_MIN = 0;
export const STEP_BUY_ADD_BAND_MAX = 0.1;
export const STEP_BUY_MAX_LOTS_DEFAULT = 3;
export const STEP_BUY_MAX_LOTS_MAX = 8;
export const STEP_BUY_STOP_DEFAULT = 0.03;
export const STEP_BUY_STOP_MIN = 0.01;
export const STEP_BUY_STOP_MAX = 0.1;
export const STEP_BUY_MAX_ASK_DEFAULT = 0.8;
export const STEP_BUY_MAX_ASK_MIN = 0.5;
export const STEP_BUY_MAX_ASK_MAX = 0.9;
export const STEP_BUY_GRACE_SEC = 5;
export const STEP_BUY_STOP_ADD_SEC = 30;

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

export function normalizeStepBuyStartMinutes(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? STEP_BUY_START_MIN_DEFAULT), STEP_BUY_START_MIN_MIN, STEP_BUY_START_MIN_MAX));
}

export function normalizeStepBuyCushionPct(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? STEP_BUY_CUSHION_PCT_DEFAULT), STEP_BUY_CUSHION_PCT_MIN, STEP_BUY_CUSHION_PCT_MAX)
  );
}

export function normalizeStepBuyLotCount(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? STEP_BUY_LOT_COUNT_DEFAULT), 1, STEP_BUY_LOT_COUNT_MAX));
}

export function normalizeStepBuyAddWaitMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? STEP_BUY_ADD_WAIT_MIN_DEFAULT), STEP_BUY_ADD_WAIT_MIN_MIN, STEP_BUY_ADD_WAIT_MIN_MAX)
  );
}

export function normalizeStepBuyAddBandUsd(raw: unknown): number {
  return snap(clamp(Number(raw ?? STEP_BUY_ADD_BAND_DEFAULT), STEP_BUY_ADD_BAND_MIN, STEP_BUY_ADD_BAND_MAX), 0.01);
}

export function normalizeStepBuyMaxLots(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? STEP_BUY_MAX_LOTS_DEFAULT), 1, STEP_BUY_MAX_LOTS_MAX));
}

export function normalizeStepBuyStopUsd(raw: unknown): number {
  return snap(clamp(Number(raw ?? STEP_BUY_STOP_DEFAULT), STEP_BUY_STOP_MIN, STEP_BUY_STOP_MAX), 0.01);
}

export function normalizeStepBuyMaxAskUsd(raw: unknown): number {
  return snap(clamp(Number(raw ?? STEP_BUY_MAX_ASK_DEFAULT), STEP_BUY_MAX_ASK_MIN, STEP_BUY_MAX_ASK_MAX), 0.01);
}

export function stepBuyDefaultAssets(): string[] {
  return ASSETS_CATALOG.map((a) => a.key);
}

/** Missing → all catalog assets. Empty = no Step buy buys. */
export function normalizeStepBuyAssets(raw: unknown): string[] {
  const allowed = stepBuyDefaultAssets();
  const allowedSet = new Set(allowed);
  if (raw == null || !Array.isArray(raw)) return allowed;
  const out: string[] = [];
  for (const item of raw) {
    const k = String(item || '').trim();
    if (allowedSet.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function isStepBuyAssetSelected(assets: unknown, asset: string): boolean {
  return normalizeStepBuyAssets(assets).includes(String(asset));
}

export function isStepBuyEntryPath(raw: unknown): boolean {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim();
  return v === 'step_buy' || v === 'stepbuy' || v === 'step-buy';
}

export function isStepBuyEnterPath(opts: {
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
      isStepBuyAssetSelected(opts.assets, opts.asset)
  );
}

export function stepBuyTwapOwns(opts: {
  twapAdminEnabled: boolean;
  twapUserEnabled: boolean;
  twapAssets: unknown;
  asset: string;
}): boolean {
  return lastMinuteTwapOwns(opts);
}

export function stepBuyNeedGapUsd(cushionUsd: unknown, cushionPct: unknown): number {
  const cushion = Number(cushionUsd);
  const pct = normalizeStepBuyCushionPct(cushionPct);
  if (!Number.isFinite(cushion) || cushion <= 0) return 0;
  return Math.round(cushion * (pct / 100) * 100) / 100;
}

export function stepBuyThesisHolds(opts: {
  absGap: unknown;
  cushionUsd: unknown;
  cushionPct: unknown;
  leanSide: unknown;
  heldSide?: unknown;
}): boolean {
  const gap = Number(opts.absGap);
  if (!Number.isFinite(gap) || gap + 1e-9 < stepBuyNeedGapUsd(opts.cushionUsd, opts.cushionPct)) {
    return false;
  }
  const lean = String(opts.leanSide || '').toUpperCase();
  if (lean !== 'YES' && lean !== 'NO') return false;
  const held = String(opts.heldSide || '').toUpperCase();
  if (held === 'YES' || held === 'NO') return lean === held;
  return true;
}

export function stepBuyAskUsd(raw: unknown): number | null {
  const x = Number(raw);
  if (!Number.isFinite(x)) return null;
  if (x >= 0.995) return 1;
  return ticketUsd(raw);
}

export function stepBuyAskInAddBand(liveAsk: unknown, lastFill: unknown, bandUsd: unknown): boolean {
  const ask = stepBuyAskUsd(liveAsk);
  const fill = stepBuyAskUsd(lastFill) ?? ticketUsd(lastFill);
  const band = normalizeStepBuyAddBandUsd(bandUsd);
  if (ask == null || fill == null || ask >= 0.995) return false;
  if (ask + 1e-9 < fill) return false;
  return ask <= fill + band + 1e-9;
}

export function resolveStepBuyCloseUtc(
  lean: { close_utc?: string | Date | null; minutes_remaining?: number },
  now: Date
): Date | null {
  return resolveTwapCloseUtc(lean, now);
}

export function stepBuySecondsLeft(now: Date, closeUtc: Date): number {
  return twapLockSecondsLeft(now, closeUtc);
}

export function isStepBuyStopAddWindow(now: Date, closeUtc: Date): boolean {
  return stepBuySecondsLeft(now, closeUtc) <= STEP_BUY_STOP_ADD_SEC;
}

export function isStepBuyStartWindow(opts: {
  now?: Date;
  minutesElapsed?: unknown;
  startMinutes?: unknown;
  closeUtc?: Date | null;
}): boolean {
  const elapsed = Number(opts.minutesElapsed);
  if (!Number.isFinite(elapsed) || elapsed + 1e-9 < normalizeStepBuyStartMinutes(opts.startMinutes)) {
    return false;
  }
  if (opts.closeUtc) {
    const now = opts.now || new Date();
    if (stepBuySecondsLeft(now, opts.closeUtc) <= 0) return false;
    if (isStepBuyStopAddWindow(now, opts.closeUtc)) return false;
  }
  return true;
}

type StepBuyTrade = {
  ticker?: string;
  market_ticker?: string;
  entryPath?: unknown;
  entry_path?: unknown;
  fillCount?: number | null;
  fill_count?: number | null;
  status?: string;
  outcome?: string | null;
  dryRun?: boolean;
  dry_run?: boolean;
  executedAt?: string | null;
  payPrice?: number | null;
  pay_price?: number | null;
  price?: string | number | null;
  decision?: string;
  stepLotIndex?: number | null;
  step_lot_index?: number | null;
};

export function stepBuyLotIndexOf(trade: StepBuyTrade): number {
  const n = Number(trade.stepLotIndex ?? trade.step_lot_index);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
}

export function stepBuyLotsForTicker(
  trades: StepBuyTrade[],
  marketTicker: string
): { count: number; lastAt: Date | null; lastFill: number | null; heldSide: 'YES' | 'NO' | null } {
  const want = String(marketTicker || '').trim();
  let count = 0;
  let lastAt: Date | null = null;
  let lastFill: number | null = null;
  let heldSide: 'YES' | 'NO' | null = null;
  for (const t of trades || []) {
    const ticker = String(t.ticker || t.market_ticker || '').trim();
    if (ticker !== want) continue;
    if (!isStepBuyEntryPath(t.entryPath ?? t.entry_path)) continue;
    if (!isOpenLiveFill(t)) continue;
    count += 1;
    const at = t.executedAt ? new Date(t.executedAt) : null;
    if (at && Number.isFinite(at.getTime()) && (!lastAt || at.getTime() > lastAt.getTime())) {
      lastAt = at;
      lastFill = ticketUsd(t.payPrice ?? t.pay_price ?? t.price);
      const d = String(t.decision || '').toUpperCase();
      heldSide = d === 'NO' ? 'NO' : 'YES';
    }
  }
  return { count, lastAt, lastFill, heldSide };
}

export function tickerHasOpenStepBuy(trades: StepBuyTrade[], marketTicker: string): boolean {
  return stepBuyLotsForTicker(trades, marketTicker).count > 0;
}

export function tickerHasOpenOtherThanStepBuy(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some(
    (t) => !isStepBuyEntryPath((t as StepBuyTrade).entryPath ?? (t as StepBuyTrade).entry_path)
  );
}

export function nextStepBuyLotIndex(trades: StepBuyTrade[], marketTicker: string): number {
  const want = String(marketTicker || '').trim();
  let max = 0;
  for (const t of trades || []) {
    const ticker = String(t.ticker || t.market_ticker || '').trim();
    if (ticker !== want) continue;
    if (!isStepBuyEntryPath(t.entryPath ?? t.entry_path)) continue;
    const fills = Number(t.fillCount ?? t.fill_count ?? 0);
    if (!(fills > 0)) continue;
    max = Math.max(max, stepBuyLotIndexOf(t));
  }
  return max + 1;
}

export function stepBuyOriginalLot1(
  trades: StepBuyTrade[],
  marketTicker: string
): StepBuyTrade | null {
  const want = String(marketTicker || '').trim();
  let best: StepBuyTrade | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const t of trades || []) {
    const ticker = String(t.ticker || t.market_ticker || '').trim();
    if (ticker !== want) continue;
    if (!isStepBuyEntryPath(t.entryPath ?? t.entry_path)) continue;
    const fills = Number(t.fillCount ?? t.fill_count ?? 0);
    if (!(fills > 0)) continue;
    if (stepBuyLotIndexOf(t) === 1) return t;
    const at = t.executedAt ? new Date(t.executedAt).getTime() : Number.POSITIVE_INFINITY;
    if (at < bestAt) {
      bestAt = at;
      best = t;
    }
  }
  return best;
}

export function evaluateStepBuyLotStop(opts: {
  fillPay: unknown;
  heldSide: unknown;
  yesAsk?: unknown;
  noAsk?: unknown;
  stopUsd?: unknown;
  filledAt?: string | Date | number | null;
  now?: Date;
  graceSeconds?: number;
}): { sell: boolean; reason: string } {
  const stop = normalizeStepBuyStopUsd(opts.stopUsd);
  const fill = ticketUsd(opts.fillPay);
  const held = String(opts.heldSide || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  const ask = held === 'NO' ? stepBuyAskUsd(opts.noAsk) : stepBuyAskUsd(opts.yesAsk);
  if (fill == null) return { sell: false, reason: 'step_buy_no_fill' };
  if (ask == null || ask >= 0.995) return { sell: false, reason: 'step_buy_no_ask' };
  if (
    inProtectSellGrace({
      filledAt: opts.filledAt,
      graceSeconds: opts.graceSeconds ?? STEP_BUY_GRACE_SEC,
      now: opts.now,
    })
  ) {
    return { sell: false, reason: 'grace_after_fill' };
  }
  if (ask <= fill - stop + 1e-9) {
    return { sell: true, reason: 'step_buy_stop' };
  }
  return { sell: false, reason: 'step_buy_hold' };
}

export function evaluateStepBuyStops(opts: {
  trades: StepBuyTrade[];
  marketTicker: string;
  yesAsk?: unknown;
  noAsk?: unknown;
  stopUsd?: unknown;
  now?: Date;
}): Array<{ trade: StepBuyTrade; reason: string; flatten: boolean }> {
  const open = (opts.trades || []).filter(
    (t) =>
      String(t.ticker || t.market_ticker || '').trim() === String(opts.marketTicker || '').trim() &&
      isStepBuyEntryPath(t.entryPath ?? t.entry_path) &&
      isOpenLiveFill(t)
  );
  const lot1 = stepBuyOriginalLot1(opts.trades, opts.marketTicker);
  const lot1Open = Boolean(lot1 && isOpenLiveFill(lot1));
  const lot1Stop =
    lot1 && lot1Open
      ? evaluateStepBuyLotStop({
          fillPay: lot1.payPrice ?? lot1.pay_price ?? lot1.price,
          heldSide: lot1.decision,
          yesAsk: opts.yesAsk,
          noAsk: opts.noAsk,
          stopUsd: opts.stopUsd,
          filledAt: lot1.executedAt,
          now: opts.now,
        })
      : { sell: false, reason: 'step_buy_hold' };
  const out: Array<{ trade: StepBuyTrade; reason: string; flatten: boolean }> = [];
  for (const trade of open) {
    if (lot1Stop.sell) {
      out.push({ trade, reason: 'step_buy_lot1_flatten', flatten: true });
      continue;
    }
    const one = evaluateStepBuyLotStop({
      fillPay: trade.payPrice ?? trade.pay_price ?? trade.price,
      heldSide: trade.decision,
      yesAsk: opts.yesAsk,
      noAsk: opts.noAsk,
      stopUsd: opts.stopUsd,
      filledAt: trade.executedAt,
      now: opts.now,
    });
    if (one.sell) out.push({ trade, reason: one.reason, flatten: false });
  }
  return out;
}

export function stepBuyGateConfig(cfg: AppConfig, maxAskUsd: number, lotCount: number, maxLots: number): AppConfig {
  const cushions = { ...cfg.cushions };
  for (const key of Object.keys(cushions) as AssetKey[]) {
    cushions[key] = 0;
  }
  const clipUsd = Math.max(0.01, lotCount * maxAskUsd);
  return {
    ...cfg,
    risk: {
      ...cfg.risk,
      max_entry_ask_usd: maxAskUsd,
      min_minutes_left: 0,
      min_minutes_elapsed: 0,
      smart_buy_enabled: false,
      chase_above_ask_usd: 0,
      time_in_force: 'immediate_or_cancel',
      fixed_dollars_per_trade: clipUsd,
      max_dollars_per_trade: clipUsd,
      min_dollars_per_trade: 0.01,
      max_trades_per_asset_per_window: maxLots,
    },
    cushions,
  };
}

export function evaluateStepBuyEnter(opts: {
  lean: LeanSignal & CashOutQuotes & { close_utc?: string | Date | null };
  cfg: AppConfig;
  adminEnabled: boolean;
  twapAdminEnabled?: boolean;
  now?: Date;
  openPositions?: number;
  dailyPnlUsd?: number;
  tradesToday?: number;
  assetTradesInWindow?: number;
  stepBuyLots?: number;
  lastLotAt?: Date | null;
  lastFill?: number | null;
  heldSide?: 'YES' | 'NO' | null;
  hasOpenOnTicker?: boolean;
  lastMinuteOwnsNewBuys?: boolean;
  skipThinBid?: boolean;
  bidSize?: number | null;
}): GateResult {
  const now = opts.now || new Date();
  const risk = opts.cfg.risk as AppConfig['risk'] & {
    step_buy_enabled?: boolean;
    step_buy_start_minutes?: number;
    step_buy_cushion_pct?: number;
    step_buy_lot_count?: number;
    step_buy_add_wait_minutes?: number;
    step_buy_add_band_usd?: number;
    step_buy_max_lots?: number;
    step_buy_stop_usd?: number;
    step_buy_max_ask_usd?: number;
    step_buy_assets?: string[];
    step_buy_skip_thin_bid?: boolean;
    twap_lock_enabled?: boolean;
    twap_lock_assets?: string[];
  };
  if (!opts.adminEnabled) return { ok: false, skip_reason: 'step_buy_admin_off' };
  if (risk.step_buy_enabled !== true) return { ok: false, skip_reason: 'step_buy_off' };
  if (!opts.cfg.assets_enabled?.[opts.lean.asset]) return { ok: false, skip_reason: 'asset_disabled' };
  if (!isStepBuyAssetSelected(risk.step_buy_assets, opts.lean.asset)) {
    return { ok: false, skip_reason: 'step_buy_asset_off' };
  }
  if (
    twapLockBlocksOtherAutoPaths({
      adminEnabled: opts.twapAdminEnabled === true,
      userEnabled: risk.twap_lock_enabled === true,
      assets: risk.twap_lock_assets,
      asset: opts.lean.asset,
    })
  ) {
    return { ok: false, skip_reason: 'step_buy_twap_owns' };
  }
  if (opts.lean.phase === 'ended') return { ok: false, skip_reason: 'window_ended' };
  const closeUtc = resolveStepBuyCloseUtc(opts.lean, now);
  if (!closeUtc) return { ok: false, skip_reason: 'step_buy_no_close' };
  const left = stepBuySecondsLeft(now, closeUtc);
  if (left <= 0) return { ok: false, skip_reason: 'window_ended' };
  if (left <= STEP_BUY_STOP_ADD_SEC) return { ok: false, skip_reason: 'step_buy_stop_add' };

  const lots = Math.max(0, Math.floor(Number(opts.stepBuyLots) || 0));
  const maxLots = normalizeStepBuyMaxLots(risk.step_buy_max_lots);
  if (lots >= maxLots) return { ok: false, skip_reason: 'step_buy_max_lots' };
  if (opts.lastMinuteOwnsNewBuys) return { ok: false, skip_reason: 'step_buy_last_minute_owns' };
  if (opts.hasOpenOnTicker) return { ok: false, skip_reason: 'step_buy_holding_other_path' };

  if (lots <= 0) {
    if (
      !isStepBuyStartWindow({
        now,
        minutesElapsed: opts.lean.minutes_elapsed,
        startMinutes: risk.step_buy_start_minutes,
        closeUtc,
      })
    ) {
      return { ok: false, skip_reason: 'step_buy_too_early' };
    }
    const windowCap = Math.max(1, Math.floor(Number(opts.cfg.risk.max_trades_per_asset_per_window) || 1));
    const existing = Math.max(0, Math.floor(Number(opts.assetTradesInWindow) || 0));
    if (existing >= windowCap) return { ok: false, skip_reason: 'step_buy_window_cap' };
  } else {
    const waitMs = normalizeStepBuyAddWaitMinutes(risk.step_buy_add_wait_minutes) * 60_000;
    const lastMs = opts.lastLotAt ? opts.lastLotAt.getTime() : 0;
    if (Number.isFinite(lastMs) && lastMs > 0 && now.getTime() - lastMs < waitMs - 20) {
      return { ok: false, skip_reason: 'step_buy_add_wait' };
    }
  }

  const leanSide = String(opts.lean.decision || '').toUpperCase();
  const held = lots > 0 ? opts.heldSide : undefined;
  if (
    !stepBuyThesisHolds({
      absGap: opts.lean.abs_gap,
      cushionUsd: opts.cfg.cushions?.[opts.lean.asset],
      cushionPct: risk.step_buy_cushion_pct,
      leanSide,
      heldSide: held,
    })
  ) {
    return { ok: false, skip_reason: lots > 0 ? 'step_buy_lean_flipped' : 'step_buy_no_thesis' };
  }
  const decision = (held === 'NO' || leanSide === 'NO' ? 'NO' : 'YES') as 'YES' | 'NO';
  const maxAsk = normalizeStepBuyMaxAskUsd(risk.step_buy_max_ask_usd);
  const ask = decision === 'NO' ? stepBuyAskUsd(opts.lean.no_ask) : stepBuyAskUsd(opts.lean.yes_ask);
  if (ask == null) return { ok: false, skip_reason: 'step_buy_no_ask' };
  if (ask >= 0.995 || ask > maxAsk + 1e-9) return { ok: false, skip_reason: 'step_buy_ask_rich' };
  if (lots > 0 && !stepBuyAskInAddBand(ask, opts.lastFill, risk.step_buy_add_band_usd)) {
    return { ok: false, skip_reason: 'step_buy_add_band' };
  }

  const lotCount = normalizeStepBuyLotCount(risk.step_buy_lot_count);
  const leanForGate: LeanSignal = {
    ...opts.lean,
    decision,
    abs_gap: Number(opts.lean.abs_gap) || 0,
    minutes_left: 0,
    minutes_elapsed: Number(opts.lean.minutes_elapsed) || 0,
  };
  const gate = evaluateStaticGate(leanForGate, stepBuyGateConfig(opts.cfg, maxAsk, lotCount, maxLots), {
    openPositions: opts.openPositions,
    dailyPnlUsd: opts.dailyPnlUsd,
    tradesToday: opts.tradesToday,
    assetTradesInWindow: lots,
  });
  if (!gate.ok) return gate;

  const thinOn = resolveSkipThinBid(risk, 'step_buy', opts.skipThinBid);
  if (thinOn) {
    const need = Math.floor(Number(gate.count) || 0);
    if (opts.bidSize == null || !Number.isFinite(Number(opts.bidSize))) {
      return { ok: false, skip_reason: 'step_buy_thin_bid' };
    }
    if (need > 0 && Number(opts.bidSize) < need) {
      return { ok: false, skip_reason: 'step_buy_thin_bid' };
    }
  }
  return { ...gate, decision };
}

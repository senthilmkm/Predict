/**
 * Buffer run — mid-window lean scalp.
 *
 * Buy the lead side when spot has a buffer vs strike, ask is mid-range,
 * then take / stop / lean-flip / flatten before settlement.
 *
 * Locked defaults (POC 14d): ask 42–62¢, take +12¢, stop −7¢,
 * enter elapsed ≥3 / left ≥5, flatten ≤3m, ATR×1.25 with BTC $40 / ETH $2.50 floors,
 * $2.50 notional, 1 trade/window, pair-sum skip ≤0.98.
 *
 * Design: poc/buffer-run/MODEL.md · docs/BUFFER_RUN.md
 */

import { AppConfig, AssetKey, ASSETS_CATALOG } from './types';
import { capGateLotCount, evaluateStaticGate, GateResult, LeanSignal } from './gates';
import {
  CashOutQuotes,
  isHistorySellableTrade,
  isOpenLiveFill,
  openFillsForTicker,
  sideBidOf,
  ticketUsd,
} from './cashOut';
import {
  buildProtectSellOrder,
  computeProtectSellPnlUsd,
  inProtectSellGrace,
  shouldSellAtProfitPct,
} from './protectSell';
import { lastMinuteTwapOwns } from './lastMinute';
import { goldFadeMinutesLeft } from './goldFade';
import {
  computeOneMinuteAtr,
  LAST_MINUTE_ATR_MULT_DEFAULT,
  LAST_MINUTE_ATR_MULT_MAX,
  LAST_MINUTE_ATR_MULT_MIN,
  LAST_MINUTE_ATR_PERIOD,
  signedLeadUsd,
} from './lateAtrCushion';
import { SpotTick } from './smartBuy';

export const BUFFER_RUN_ASSETS = ['BTC', 'ETH'] as const;
export type BufferRunAsset = (typeof BUFFER_RUN_ASSETS)[number];

export const BUFFER_RUN_ASK_MIN_DEFAULT = 0.42;
export const BUFFER_RUN_ASK_MIN_MIN = 0.35;
export const BUFFER_RUN_ASK_MIN_MAX = 0.55;
export const BUFFER_RUN_ASK_MAX_DEFAULT = 0.62;
export const BUFFER_RUN_ASK_MAX_MIN = 0.5;
export const BUFFER_RUN_ASK_MAX_MAX = 0.75;

export const BUFFER_RUN_TAKE_DEFAULT = 0.12;
export const BUFFER_RUN_TAKE_MIN = 0.06;
export const BUFFER_RUN_TAKE_MAX = 0.2;
export const BUFFER_RUN_STOP_DEFAULT = 0.07;
export const BUFFER_RUN_STOP_MIN = 0.04;
export const BUFFER_RUN_STOP_MAX = 0.15;

export const BUFFER_RUN_ENTER_ELAPSED_DEFAULT = 3;
export const BUFFER_RUN_ENTER_ELAPSED_MIN = 1;
export const BUFFER_RUN_ENTER_ELAPSED_MAX = 8;
export const BUFFER_RUN_ENTER_LEFT_DEFAULT = 5;
export const BUFFER_RUN_ENTER_LEFT_MIN = 4;
export const BUFFER_RUN_ENTER_LEFT_MAX = 10;
export const BUFFER_RUN_FLATTEN_DEFAULT = 3;
export const BUFFER_RUN_FLATTEN_MIN = 2;
export const BUFFER_RUN_FLATTEN_MAX = 5;

export const BUFFER_RUN_ATR_MULT_DEFAULT = LAST_MINUTE_ATR_MULT_DEFAULT;
export const BUFFER_RUN_ATR_MULT_MIN = LAST_MINUTE_ATR_MULT_MIN;
export const BUFFER_RUN_ATR_MULT_MAX = LAST_MINUTE_ATR_MULT_MAX;
export const BUFFER_RUN_ATR_PERIOD = LAST_MINUTE_ATR_PERIOD;

export const BUFFER_RUN_MIN_GAP_BTC_DEFAULT = 40;
export const BUFFER_RUN_MIN_GAP_ETH_DEFAULT = 2.5;
export const BUFFER_RUN_MIN_GAP_BTC_MIN = 10;
export const BUFFER_RUN_MIN_GAP_BTC_MAX = 200;
export const BUFFER_RUN_MIN_GAP_ETH_MIN = 0.5;
export const BUFFER_RUN_MIN_GAP_ETH_MAX = 20;

export const BUFFER_RUN_DOLLARS_DEFAULT = 2.5;
export const BUFFER_RUN_DOLLARS_MIN = 1;
export const BUFFER_RUN_DOLLARS_MAX = 50;

export const BUFFER_RUN_PAIR_SUM_SKIP_DEFAULT = 0.98;
export const BUFFER_RUN_PAIR_SUM_SKIP_MIN = 0.95;
export const BUFFER_RUN_PAIR_SUM_SKIP_MAX = 1;
export const BUFFER_RUN_ASK_CEILING = 0.995;
export const BUFFER_RUN_GRACE_SEC = 5;
export const BUFFER_RUN_LOT_COUNT_DEFAULT = 1;
export const BUFFER_RUN_LOT_COUNT_MAX = 1;

export type BufferRunSide = 'YES' | 'NO';
export type BufferRunExitKind =
  | 'none'
  | 'buffer_run_take'
  | 'buffer_run_sell_at'
  | 'buffer_run_stop'
  | 'buffer_run_lean_flip'
  | 'buffer_run_flatten';

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

export function normalizeBufferRunAskMinUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? BUFFER_RUN_ASK_MIN_DEFAULT), BUFFER_RUN_ASK_MIN_MIN, BUFFER_RUN_ASK_MIN_MAX),
    0.01
  );
}

export function normalizeBufferRunAskMaxUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? BUFFER_RUN_ASK_MAX_DEFAULT), BUFFER_RUN_ASK_MAX_MIN, BUFFER_RUN_ASK_MAX_MAX),
    0.01
  );
}

/** Keep ask_min < ask_max. */
export function reconcileBufferRunAskBand(opts: {
  askMinUsd?: unknown;
  askMaxUsd?: unknown;
}): { askMinUsd: number; askMaxUsd: number } {
  let askMinUsd = normalizeBufferRunAskMinUsd(opts.askMinUsd);
  let askMaxUsd = normalizeBufferRunAskMaxUsd(opts.askMaxUsd);
  if (askMinUsd + 1e-9 >= askMaxUsd) {
    askMaxUsd = snap(
      clamp(askMinUsd + 0.05, BUFFER_RUN_ASK_MAX_MIN, BUFFER_RUN_ASK_MAX_MAX),
      0.01
    );
    if (askMinUsd + 1e-9 >= askMaxUsd) {
      askMinUsd = BUFFER_RUN_ASK_MIN_DEFAULT;
      askMaxUsd = BUFFER_RUN_ASK_MAX_DEFAULT;
    }
  }
  return { askMinUsd, askMaxUsd };
}

export function normalizeBufferRunTakeUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? BUFFER_RUN_TAKE_DEFAULT), BUFFER_RUN_TAKE_MIN, BUFFER_RUN_TAKE_MAX),
    0.01
  );
}

export function normalizeBufferRunStopUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? BUFFER_RUN_STOP_DEFAULT), BUFFER_RUN_STOP_MIN, BUFFER_RUN_STOP_MAX),
    0.01
  );
}

/** Take must stay strictly above Stop. Hydrate cuts Take; never raise Stop. */
export function reconcileBufferRunTakeStop(opts: {
  takeUsd?: unknown;
  stopUsd?: unknown;
}): { takeUsd: number; stopUsd: number } {
  const stopUsd = normalizeBufferRunStopUsd(opts.stopUsd);
  let takeUsd = normalizeBufferRunTakeUsd(opts.takeUsd);
  if (takeUsd <= stopUsd + 1e-9) {
    takeUsd = snap(clamp(stopUsd + 0.01, BUFFER_RUN_TAKE_MIN, BUFFER_RUN_TAKE_MAX), 0.01);
    if (takeUsd <= stopUsd + 1e-9) takeUsd = BUFFER_RUN_TAKE_DEFAULT;
  }
  return { takeUsd, stopUsd };
}

export function normalizeBufferRunEnterElapsedMinutes(raw: unknown): number {
  return Math.round(
    clamp(
      Number(raw ?? BUFFER_RUN_ENTER_ELAPSED_DEFAULT),
      BUFFER_RUN_ENTER_ELAPSED_MIN,
      BUFFER_RUN_ENTER_ELAPSED_MAX
    )
  );
}

export function normalizeBufferRunEnterLeftMinutes(raw: unknown): number {
  return Math.round(
    clamp(
      Number(raw ?? BUFFER_RUN_ENTER_LEFT_DEFAULT),
      BUFFER_RUN_ENTER_LEFT_MIN,
      BUFFER_RUN_ENTER_LEFT_MAX
    )
  );
}

export function normalizeBufferRunFlattenMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? BUFFER_RUN_FLATTEN_DEFAULT), BUFFER_RUN_FLATTEN_MIN, BUFFER_RUN_FLATTEN_MAX)
  );
}

/** Enter-left must stay above flatten. */
export function reconcileBufferRunTiming(opts: {
  enterElapsedMinutes?: unknown;
  enterLeftMinutes?: unknown;
  flattenMinutes?: unknown;
}): {
  enterElapsedMinutes: number;
  enterLeftMinutes: number;
  flattenMinutes: number;
} {
  const enterElapsedMinutes = normalizeBufferRunEnterElapsedMinutes(opts.enterElapsedMinutes);
  let flattenMinutes = normalizeBufferRunFlattenMinutes(opts.flattenMinutes);
  let enterLeftMinutes = normalizeBufferRunEnterLeftMinutes(opts.enterLeftMinutes);
  if (enterLeftMinutes <= flattenMinutes) {
    enterLeftMinutes = snap(
      clamp(flattenMinutes + 1, BUFFER_RUN_ENTER_LEFT_MIN, BUFFER_RUN_ENTER_LEFT_MAX),
      1
    );
    if (enterLeftMinutes <= flattenMinutes) {
      flattenMinutes = BUFFER_RUN_FLATTEN_DEFAULT;
      enterLeftMinutes = BUFFER_RUN_ENTER_LEFT_DEFAULT;
    }
  }
  return { enterElapsedMinutes, enterLeftMinutes, flattenMinutes };
}

export function normalizeBufferRunAtrMult(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? BUFFER_RUN_ATR_MULT_DEFAULT), BUFFER_RUN_ATR_MULT_MIN, BUFFER_RUN_ATR_MULT_MAX),
    0.05
  );
}

export function normalizeBufferRunMinGapBtcUsd(raw: unknown): number {
  return snap(
    clamp(
      Number(raw ?? BUFFER_RUN_MIN_GAP_BTC_DEFAULT),
      BUFFER_RUN_MIN_GAP_BTC_MIN,
      BUFFER_RUN_MIN_GAP_BTC_MAX
    ),
    1
  );
}

export function normalizeBufferRunMinGapEthUsd(raw: unknown): number {
  return snap(
    clamp(
      Number(raw ?? BUFFER_RUN_MIN_GAP_ETH_DEFAULT),
      BUFFER_RUN_MIN_GAP_ETH_MIN,
      BUFFER_RUN_MIN_GAP_ETH_MAX
    ),
    0.1
  );
}

export function bufferRunMinGapUsd(opts: {
  asset: string;
  minGapBtcUsd?: unknown;
  minGapEthUsd?: unknown;
}): number {
  const asset = String(opts.asset || '').trim();
  if (asset === 'ETH') return normalizeBufferRunMinGapEthUsd(opts.minGapEthUsd);
  return normalizeBufferRunMinGapBtcUsd(opts.minGapBtcUsd);
}

export function normalizeBufferRunDollars(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? BUFFER_RUN_DOLLARS_DEFAULT), BUFFER_RUN_DOLLARS_MIN, BUFFER_RUN_DOLLARS_MAX),
    0.5
  );
}

export function normalizeBufferRunPairSumSkip(raw: unknown): number {
  return snap(
    clamp(
      Number(raw ?? BUFFER_RUN_PAIR_SUM_SKIP_DEFAULT),
      BUFFER_RUN_PAIR_SUM_SKIP_MIN,
      BUFFER_RUN_PAIR_SUM_SKIP_MAX
    ),
    0.01
  );
}

export function bufferRunDefaultAssets(): string[] {
  return [...BUFFER_RUN_ASSETS];
}

/** Missing → BTC+ETH. Empty = no Buffer run buys. */
export function normalizeBufferRunAssets(raw: unknown): string[] {
  const allowed = new Set<string>(BUFFER_RUN_ASSETS);
  if (raw == null || !Array.isArray(raw)) return bufferRunDefaultAssets();
  const out: string[] = [];
  for (const item of raw) {
    const k = String(item || '').trim();
    if (allowed.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function isBufferRunAssetSelected(assets: unknown, asset: string): boolean {
  return normalizeBufferRunAssets(assets).includes(String(asset));
}

export function isBufferRunEntryPath(raw: unknown): boolean {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/-/g, '_');
  return v === 'buffer_run' || v === 'bufferrun';
}

export function isBufferRunHistorySellableTrade(trade: {
  entryPath?: unknown;
  entry_path?: unknown;
  dryRun?: boolean;
  dry_run?: boolean;
  outcome?: string | null;
  fillCount?: number | null;
  fill_count?: number | null;
  protectExitOrderId?: string | null;
}): boolean {
  const path = trade.entryPath ?? trade.entry_path;
  if (!isBufferRunEntryPath(path)) return false;
  return isHistorySellableTrade(trade);
}

export function isBufferRunEnterPath(opts: {
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
      BUFFER_RUN_ASSETS.includes(String(opts.asset || '').trim() as BufferRunAsset) &&
      isBufferRunAssetSelected(opts.assets, opts.asset)
  );
}

export function bufferRunTwapOwns(opts: {
  twapAdminEnabled: boolean;
  twapUserEnabled: boolean;
  twapAssets: unknown;
  asset: string;
}): boolean {
  return lastMinuteTwapOwns(opts);
}

export function isBufferRunEnterWindow(opts: {
  minutesElapsed?: unknown;
  minutesLeft?: unknown;
  enterElapsedMinutes?: unknown;
  enterLeftMinutes?: unknown;
  flattenMinutes?: unknown;
}): boolean {
  const timing = reconcileBufferRunTiming({
    enterElapsedMinutes: opts.enterElapsedMinutes,
    enterLeftMinutes: opts.enterLeftMinutes,
    flattenMinutes: opts.flattenMinutes,
  });
  const elapsed = Number(opts.minutesElapsed);
  const left = Number(opts.minutesLeft);
  if (!Number.isFinite(elapsed) || !Number.isFinite(left)) return false;
  if (elapsed + 1e-9 < timing.enterElapsedMinutes) return false;
  if (left + 1e-9 < timing.enterLeftMinutes) return false;
  if (left <= timing.flattenMinutes + 1e-9) return false;
  return true;
}

export function bufferRunLeadNeedUsd(opts: {
  asset: string;
  minGapBtcUsd?: unknown;
  minGapEthUsd?: unknown;
  atrMult?: unknown;
  timeseries?: SpotTick[] | null;
}): { need: number; atr: number | null; minGap: number } {
  const minGap = bufferRunMinGapUsd({
    asset: opts.asset,
    minGapBtcUsd: opts.minGapBtcUsd,
    minGapEthUsd: opts.minGapEthUsd,
  });
  const atr = computeOneMinuteAtr(opts.timeseries, BUFFER_RUN_ATR_PERIOD);
  const mult = normalizeBufferRunAtrMult(opts.atrMult);
  if (atr == null || !(atr > 0)) return { need: minGap, atr: null, minGap };
  return { need: Math.max(minGap, atr * mult), atr, minGap };
}

export function pickBufferRunSide(opts: {
  live?: unknown;
  strike?: unknown;
  yesAsk?: unknown;
  noAsk?: unknown;
  askMinUsd?: unknown;
  askMaxUsd?: unknown;
  pairSumSkip?: unknown;
}): { ok: true; decision: BufferRunSide; ask: number } | { ok: false; skip_reason: string } {
  const live = Number(opts.live);
  const strike = Number(opts.strike);
  if (!Number.isFinite(live) || !Number.isFinite(strike)) {
    return { ok: false, skip_reason: 'buffer_run_no_spot' };
  }
  const yes = ticketUsd(opts.yesAsk);
  const no = ticketUsd(opts.noAsk);
  if (yes == null || no == null) return { ok: false, skip_reason: 'buffer_run_no_ask' };
  if (yes >= BUFFER_RUN_ASK_CEILING || no >= BUFFER_RUN_ASK_CEILING) {
    return { ok: false, skip_reason: 'buffer_run_ask_rich' };
  }
  const pairSkip = normalizeBufferRunPairSumSkip(opts.pairSumSkip);
  if (yes + no <= pairSkip + 1e-9) {
    return { ok: false, skip_reason: 'buffer_run_pair_lock' };
  }
  const band = reconcileBufferRunAskBand({
    askMinUsd: opts.askMinUsd,
    askMaxUsd: opts.askMaxUsd,
  });
  const decision: BufferRunSide = live + 1e-9 >= strike ? 'YES' : 'NO';
  const ask = decision === 'YES' ? yes : no;
  if (ask + 1e-9 < band.askMinUsd) return { ok: false, skip_reason: 'buffer_run_ask_cheap' };
  if (ask > band.askMaxUsd + 1e-9) return { ok: false, skip_reason: 'buffer_run_ask_rich' };
  return { ok: true, decision, ask };
}

type BufferRunTradeRow = {
  ticker?: string;
  market_ticker?: string;
  asset?: string;
  entryPath?: unknown;
  entry_path?: unknown;
  outcome?: unknown;
  status?: unknown;
  protectExitOrderId?: unknown;
  settledAt?: unknown;
  executedAt?: unknown;
};

function tickerOf(t: BufferRunTradeRow): string {
  return String(t.ticker || t.market_ticker || '').trim();
}

function entryOf(t: BufferRunTradeRow): unknown {
  return t.entryPath ?? t.entry_path;
}

export function tickerHasOpenBufferRun(
  trades: Array<BufferRunTradeRow & Parameters<typeof isOpenLiveFill>[0]>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some((t) =>
    isBufferRunEntryPath(t.entryPath ?? t.entry_path)
  );
}

export function tickerHasOpenOtherThanBufferRun(
  trades: Array<BufferRunTradeRow & Parameters<typeof isOpenLiveFill>[0]>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some(
    (t) => !isBufferRunEntryPath(t.entryPath ?? t.entry_path)
  );
}

/** Any Buffer run fill attempt this window (open or exited) — one trade / window. */
export function tickerHasBufferRunAttempt(
  trades: BufferRunTradeRow[],
  marketTicker: string
): boolean {
  const tkr = String(marketTicker || '').trim();
  if (!tkr) return false;
  return (trades || []).some((t) => tickerOf(t) === tkr && isBufferRunEntryPath(entryOf(t)));
}

export function bufferRunGateConfig(cfg: AppConfig, askMax: number, dollars: number, flatten: number): AppConfig {
  const cushions = { ...cfg.cushions };
  for (const key of Object.keys(cushions) as AssetKey[]) {
    cushions[key] = 0;
  }
  const clipUsd = Math.max(0.01, dollars);
  return {
    ...cfg,
    risk: {
      ...cfg.risk,
      max_entry_ask_usd: askMax,
      min_minutes_left: flatten,
      min_minutes_elapsed: 0,
      smart_buy_enabled: false,
      chase_above_ask_usd: 0,
      time_in_force: 'immediate_or_cancel',
      fixed_dollars_per_trade: clipUsd,
      max_dollars_per_trade: clipUsd,
      min_dollars_per_trade: 0.01,
    },
    cushions,
  };
}

export type BufferRunEnterResult = GateResult & {
  decision?: BufferRunSide;
  ask?: number;
  lead?: number | null;
  atr?: number | null;
  need?: number | null;
};

export function evaluateBufferRunEnter(opts: {
  lean: LeanSignal & CashOutQuotes & { live?: unknown; strike?: unknown; timeseries?: SpotTick[] | null };
  cfg: AppConfig;
  adminEnabled: boolean;
  twapAdminEnabled?: boolean;
  openPositions?: number;
  dailyPnlUsd?: number;
  tradesToday?: number;
  hasOpenOnTicker?: boolean;
  alreadyHolding?: boolean;
  alreadyAttempted?: boolean;
  lastMinuteOwnsNewBuys?: boolean;
  spikeFadeOwns?: boolean;
  stepBuyOwns?: boolean;
  pairLockOwns?: boolean;
  capLockOwns?: boolean;
  cheapLoopOwns?: boolean;
  skipThinBid?: boolean;
  bidSize?: number | null;
  timeseries?: SpotTick[] | null;
}): BufferRunEnterResult {
  const risk = opts.cfg.risk as AppConfig['risk'] & {
    buffer_run_enabled?: boolean;
    buffer_run_ask_min_usd?: number;
    buffer_run_ask_max_usd?: number;
    buffer_run_take_usd?: number;
    buffer_run_stop_usd?: number;
    buffer_run_enter_elapsed_minutes?: number;
    buffer_run_enter_left_minutes?: number;
    buffer_run_flatten_minutes?: number;
    buffer_run_atr_mult?: number;
    buffer_run_min_gap_btc_usd?: number;
    buffer_run_min_gap_eth_usd?: number;
    buffer_run_fixed_dollars_per_trade?: number;
    buffer_run_pair_sum_skip?: number;
    buffer_run_skip_thin_bid?: boolean;
    buffer_run_assets?: string[];
    twap_lock_enabled?: boolean;
    twap_lock_assets?: string[];
  };

  if (!opts.adminEnabled) return { ok: false, skip_reason: 'buffer_run_admin_off' };
  if (risk.buffer_run_enabled !== true) return { ok: false, skip_reason: 'buffer_run_off' };
  if (!opts.cfg.assets_enabled?.[opts.lean.asset]) return { ok: false, skip_reason: 'asset_disabled' };
  if (!isBufferRunAssetSelected(risk.buffer_run_assets, opts.lean.asset)) {
    return { ok: false, skip_reason: 'buffer_run_asset_off' };
  }
  if (
    bufferRunTwapOwns({
      twapAdminEnabled: opts.twapAdminEnabled === true,
      twapUserEnabled: risk.twap_lock_enabled === true,
      twapAssets: risk.twap_lock_assets,
      asset: opts.lean.asset,
    })
  ) {
    return { ok: false, skip_reason: 'buffer_run_twap_owns' };
  }
  if (opts.lean.phase === 'ended') return { ok: false, skip_reason: 'window_ended' };
  if (opts.lastMinuteOwnsNewBuys) return { ok: false, skip_reason: 'buffer_run_last_minute_owns' };
  if (opts.spikeFadeOwns) return { ok: false, skip_reason: 'buffer_run_spike_owns' };
  if (opts.stepBuyOwns) return { ok: false, skip_reason: 'buffer_run_step_owns' };
  if (opts.pairLockOwns) return { ok: false, skip_reason: 'buffer_run_pair_owns' };
  if (opts.capLockOwns) return { ok: false, skip_reason: 'buffer_run_cap_owns' };
  if (opts.cheapLoopOwns) return { ok: false, skip_reason: 'buffer_run_cheap_owns' };
  if (opts.alreadyHolding) return { ok: false, skip_reason: 'buffer_run_holding' };
  if (opts.hasOpenOnTicker) return { ok: false, skip_reason: 'buffer_run_holding_other_path' };
  if (opts.alreadyAttempted) return { ok: false, skip_reason: 'buffer_run_attempted' };

  const timing = reconcileBufferRunTiming({
    enterElapsedMinutes: risk.buffer_run_enter_elapsed_minutes,
    enterLeftMinutes: risk.buffer_run_enter_left_minutes,
    flattenMinutes: risk.buffer_run_flatten_minutes,
  });
  const left = goldFadeMinutesLeft(opts.lean);
  if (
    !isBufferRunEnterWindow({
      minutesElapsed: opts.lean.minutes_elapsed,
      minutesLeft: left,
      enterElapsedMinutes: timing.enterElapsedMinutes,
      enterLeftMinutes: timing.enterLeftMinutes,
      flattenMinutes: timing.flattenMinutes,
    })
  ) {
    const elapsed = Number(opts.lean.minutes_elapsed);
    if (!Number.isFinite(elapsed) || elapsed + 1e-9 < timing.enterElapsedMinutes) {
      return { ok: false, skip_reason: 'buffer_run_too_early' };
    }
    return { ok: false, skip_reason: 'buffer_run_too_late' };
  }

  const band = reconcileBufferRunAskBand({
    askMinUsd: risk.buffer_run_ask_min_usd,
    askMaxUsd: risk.buffer_run_ask_max_usd,
  });
  const picked = pickBufferRunSide({
    live: opts.lean.live,
    strike: opts.lean.strike,
    yesAsk: opts.lean.yes_ask,
    noAsk: opts.lean.no_ask,
    askMinUsd: band.askMinUsd,
    askMaxUsd: band.askMaxUsd,
    pairSumSkip: risk.buffer_run_pair_sum_skip,
  });
  if (!picked.ok) return { ok: false, skip_reason: picked.skip_reason };

  const series = opts.timeseries ?? opts.lean.timeseries ?? null;
  const leadNeed = bufferRunLeadNeedUsd({
    asset: opts.lean.asset,
    minGapBtcUsd: risk.buffer_run_min_gap_btc_usd,
    minGapEthUsd: risk.buffer_run_min_gap_eth_usd,
    atrMult: risk.buffer_run_atr_mult,
    timeseries: series,
  });
  const lead = signedLeadUsd({
    decision: picked.decision,
    live: opts.lean.live,
    strike: opts.lean.strike,
  });
  if (lead == null) return { ok: false, skip_reason: 'buffer_run_no_spot' };
  if (lead + 1e-9 < leadNeed.need) {
    return {
      ok: false,
      skip_reason: 'buffer_run_thin_lead',
      lead,
      atr: leadNeed.atr,
      need: leadNeed.need,
    };
  }

  const dollars = normalizeBufferRunDollars(risk.buffer_run_fixed_dollars_per_trade);
  const leanForGate: LeanSignal = {
    ...opts.lean,
    decision: picked.decision,
    abs_gap: Math.abs(Number(opts.lean.abs_gap) || lead),
    minutes_left: Number(opts.lean.minutes_left) || 0,
    minutes_elapsed: Number(opts.lean.minutes_elapsed) || 0,
  };
  const gate = evaluateStaticGate(
    leanForGate,
    bufferRunGateConfig(opts.cfg, band.askMaxUsd, dollars, timing.flattenMinutes),
    {
      openPositions: opts.openPositions,
      dailyPnlUsd: opts.dailyPnlUsd,
      tradesToday: opts.tradesToday,
      assetTradesInWindow: 0,
    }
  );
  if (!gate.ok) return { ...gate, lead, atr: leadNeed.atr, need: leadNeed.need };

  const capped = capGateLotCount(gate, BUFFER_RUN_LOT_COUNT_DEFAULT);
  const thinOn = opts.skipThinBid === true || risk.buffer_run_skip_thin_bid === true;
  if (thinOn) {
    const need = Math.floor(Number(capped.count) || BUFFER_RUN_LOT_COUNT_DEFAULT);
    if (opts.bidSize == null || !Number.isFinite(Number(opts.bidSize))) {
      return { ok: false, skip_reason: 'buffer_run_thin_bid', lead, atr: leadNeed.atr, need: leadNeed.need };
    }
    if (need > 0 && Number(opts.bidSize) < need) {
      return { ok: false, skip_reason: 'buffer_run_thin_bid', lead, atr: leadNeed.atr, need: leadNeed.need };
    }
  }

  return {
    ...capped,
    decision: picked.decision,
    ask: picked.ask,
    lead,
    atr: leadNeed.atr,
    need: leadNeed.need,
  };
}

export function evaluateBufferRunExit(opts: {
  heldSide: unknown;
  quotes: CashOutQuotes;
  fillUsd: unknown;
  takeUsd?: unknown;
  stopUsd?: unknown;
  flattenMinutes?: unknown;
  /** 0 = Off. Dump when held mark ≥ fill × (1 + pct/100). Independent of Take ¢. */
  sellAtPct?: unknown;
  lean: {
    phase?: string;
    minutes_left?: number;
    minutes_remaining?: number;
    live?: unknown;
    strike?: unknown;
  };
  filledAt?: string | Date | number | null;
  now?: Date;
}): { sell: boolean; kind: BufferRunExitKind; reason: string; bid: number | null } {
  const side = String(opts.heldSide || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  const bid = sideBidOf(side, opts.quotes);
  const fill = ticketUsd(opts.fillUsd);
  const { takeUsd, stopUsd } = reconcileBufferRunTakeStop({
    takeUsd: opts.takeUsd,
    stopUsd: opts.stopUsd,
  });
  const flatten = normalizeBufferRunFlattenMinutes(opts.flattenMinutes);
  const left = goldFadeMinutesLeft(opts.lean);

  if (opts.lean.phase === 'ended') {
    return { sell: true, kind: 'buffer_run_flatten', reason: 'buffer_run_flatten', bid };
  }

  if (
    inProtectSellGrace({
      filledAt: opts.filledAt,
      graceSeconds: BUFFER_RUN_GRACE_SEC,
      now: opts.now,
    })
  ) {
    return { sell: false, kind: 'none', reason: 'buffer_run_grace', bid };
  }

  const live = Number(opts.lean.live);
  const strike = Number(opts.lean.strike);
  if (Number.isFinite(live) && Number.isFinite(strike)) {
    const leanNow: BufferRunSide = live + 1e-9 >= strike ? 'YES' : 'NO';
    if (leanNow !== side) {
      return { sell: true, kind: 'buffer_run_lean_flip', reason: 'buffer_run_lean_flip', bid };
    }
  }

  const sellAt = shouldSellAtProfitPct({
    sellAtPct: opts.sellAtPct,
    entryPay: fill,
    heldSide: side,
    yesBid: opts.quotes.yes_bid,
    yesAsk: opts.quotes.yes_ask,
    filledAt: opts.filledAt,
    graceSeconds: 0,
    now: opts.now,
    phase: opts.lean.phase,
  });
  if (sellAt.sell) {
    return { sell: true, kind: 'buffer_run_sell_at', reason: 'buffer_run_sell_at', bid };
  }

  if (bid != null && fill != null && bid + 1e-9 >= fill + takeUsd) {
    return { sell: true, kind: 'buffer_run_take', reason: 'buffer_run_take', bid };
  }
  if (bid != null && fill != null && bid <= fill - stopUsd + 1e-9) {
    return { sell: true, kind: 'buffer_run_stop', reason: 'buffer_run_stop', bid };
  }
  if (left <= flatten + 1e-9) {
    return { sell: true, kind: 'buffer_run_flatten', reason: 'buffer_run_flatten', bid };
  }
  return { sell: false, kind: 'none', reason: 'buffer_run_hold', bid };
}

export function buildBufferRunSellOrder(opts: {
  heldSide: unknown;
  fillCount: unknown;
  quotes: CashOutQuotes;
  slippageUsd: number;
}): ReturnType<typeof buildProtectSellOrder> {
  return buildProtectSellOrder({
    heldSide: String(opts.heldSide || '').toUpperCase() === 'NO' ? 'NO' : 'YES',
    fillCount: Math.max(0, Math.floor(Number(opts.fillCount) || 0)),
    yesBid: opts.quotes.yes_bid,
    yesAsk: opts.quotes.yes_ask,
    slippageUsd: opts.slippageUsd,
  });
}

export { computeProtectSellPnlUsd };

/** Catalog keys Buffer run can select (BTC/ETH only). */
export function bufferRunSelectableAssets(): string[] {
  return ASSETS_CATALOG.map((a) => a.key).filter((k) =>
    BUFFER_RUN_ASSETS.includes(k as BufferRunAsset)
  );
}

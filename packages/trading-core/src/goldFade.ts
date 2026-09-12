import { AppConfig, AssetKey } from './types';
import { evaluateStaticGate, GateResult, LeanSignal } from './gates';
import {
  CASH_OUT_SPREAD_MAX_USD,
  CashOutQuotes,
  isCashOutThinBid,
  isOpenLiveFill,
  openFillsForTicker,
  sideAskOf,
  sideBidOf,
  sideSpreadOf,
  ticketUsd,
} from './cashOut';
import { buildProtectSellOrder, inProtectSellGrace, shouldProtectSell } from './protectSell';

export const GOLD_FADE_ASSET: AssetKey = 'Gold';
export const GOLD_FADE_MAX_GAP_DEFAULT = 3;
export const GOLD_FADE_MAX_GAP_MIN = 1;
export const GOLD_FADE_MAX_GAP_MAX = 6;
export const GOLD_FADE_MAX_ASK_DEFAULT = 0.5;
export const GOLD_FADE_MAX_ASK_MIN = 0.35;
export const GOLD_FADE_MAX_ASK_MAX = 0.55;
export const GOLD_FADE_TAKE_DEFAULT = 0.06;
export const GOLD_FADE_TAKE_MIN = 0.05;
export const GOLD_FADE_TAKE_MAX = 0.1;
export const GOLD_FADE_STOP_DEFAULT = 0.05;
export const GOLD_FADE_STOP_MIN = 0.03;
export const GOLD_FADE_STOP_MAX = 0.1;
export const GOLD_FADE_FLATTEN_DEFAULT = 3;
export const GOLD_FADE_FLATTEN_MIN = 2;
export const GOLD_FADE_FLATTEN_MAX = 5;
export const GOLD_FADE_GRACE_DEFAULT = 45;

export type GoldFadeHeldSide = 'YES' | 'NO';
export type GoldFadeExitKind =
  | 'none'
  | 'gold_fade_take'
  | 'gold_fade_stop'
  | 'gold_fade_thin_bid'
  | 'gold_fade_time'
  | 'gold_fade_flip';

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

export function normalizeGoldFadeMaxGapUsd(raw: unknown): number {
  return snap(clamp(Number(raw ?? GOLD_FADE_MAX_GAP_DEFAULT), GOLD_FADE_MAX_GAP_MIN, GOLD_FADE_MAX_GAP_MAX), 0.5);
}

export function normalizeGoldFadeMaxAskUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? GOLD_FADE_MAX_ASK_DEFAULT), GOLD_FADE_MAX_ASK_MIN, GOLD_FADE_MAX_ASK_MAX),
    0.01
  );
}

export function normalizeGoldFadeTakeUsd(raw: unknown): number {
  return snap(clamp(Number(raw ?? GOLD_FADE_TAKE_DEFAULT), GOLD_FADE_TAKE_MIN, GOLD_FADE_TAKE_MAX), 0.01);
}

export function normalizeGoldFadeStopUsd(raw: unknown): number {
  return snap(clamp(Number(raw ?? GOLD_FADE_STOP_DEFAULT), GOLD_FADE_STOP_MIN, GOLD_FADE_STOP_MAX), 0.01);
}

export function normalizeGoldFadeFlattenMinutes(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? GOLD_FADE_FLATTEN_DEFAULT), GOLD_FADE_FLATTEN_MIN, GOLD_FADE_FLATTEN_MAX)
  );
}

export function isGoldFadeEntryPath(raw: unknown): boolean {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim();
  return v === 'gold_fade' || v === 'goldfade' || v === 'fade';
}

/** Admin On + user On + Gold. */
export function isGoldFadeEnterPath(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  asset: string;
}): boolean {
  return Boolean(opts.adminEnabled && opts.userEnabled && String(opts.asset) === GOLD_FADE_ASSET);
}

export function goldFadeCheapSide(quotes: CashOutQuotes): GoldFadeHeldSide | null {
  const yesAsk = sideAskOf('YES', quotes);
  const noAsk = sideAskOf('NO', quotes);
  if (yesAsk == null || noAsk == null) return null;
  if (yesAsk + 1e-9 < noAsk) return 'YES';
  if (noAsk + 1e-9 < yesAsk) return 'NO';
  return null;
}

export function goldFadeTakeTargetUsd(fillPayUsd: unknown, takeUsd: unknown): number | null {
  const fill = ticketUsd(fillPayUsd);
  if (fill == null) return null;
  const take = normalizeGoldFadeTakeUsd(takeUsd);
  const target = Math.round((fill + take) * 10000) / 10000;
  return Math.min(0.99, target);
}

export function goldFadeStopFloorUsd(fillPayUsd: unknown, stopUsd: unknown): number | null {
  const fill = ticketUsd(fillPayUsd);
  if (fill == null) return null;
  const stop = normalizeGoldFadeStopUsd(stopUsd);
  const floor = Math.round((fill - stop) * 10000) / 10000;
  if (floor < 0.01 - 1e-12) return 0.01;
  return floor;
}

export function goldFadeMinutesLeft(lean: { minutes_left?: number; minutes_remaining?: number }): number {
  const rem = Number(lean.minutes_remaining);
  if (Number.isFinite(rem)) return rem;
  return Number(lean.minutes_left) || 0;
}

export function tickerHasOpenFill(
  trades: Array<{ ticker?: string; market_ticker?: string } & Parameters<typeof isOpenLiveFill>[0]>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).length > 0;
}

export function tickerHasOpenGoldFade(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some((t) =>
    isGoldFadeEntryPath((t as { entryPath?: unknown; entry_path?: unknown }).entryPath ?? (t as { entry_path?: unknown }).entry_path)
  );
}

export function openGoldFadeAssets(
  trades: Array<{ asset?: string; entryPath?: unknown; entry_path?: unknown } & Parameters<typeof isOpenLiveFill>[0]>
): string[] {
  const out: string[] = [];
  for (const t of trades || []) {
    if (!isOpenLiveFill(t) || !isGoldFadeEntryPath(t.entryPath ?? t.entry_path)) continue;
    const asset = String(t.asset || '').trim();
    if (asset && !out.includes(asset)) out.push(asset);
  }
  return out;
}

export function goldFadeGateConfig(cfg: AppConfig, maxAskUsd: number, flattenMinutes: number): AppConfig {
  return {
    ...cfg,
    risk: {
      ...cfg.risk,
      max_entry_ask_usd: maxAskUsd,
      min_minutes_left: flattenMinutes,
      smart_buy_enabled: false,
      chase_above_ask_usd: 0,
    },
    cushions: { ...cfg.cushions, [GOLD_FADE_ASSET]: 0 },
  };
}

export function evaluateGoldFadeEnter(opts: {
  lean: LeanSignal & CashOutQuotes;
  cfg: AppConfig;
  adminEnabled: boolean;
  openPositions?: number;
  dailyPnlUsd?: number;
  tradesToday?: number;
  assetTradesInWindow?: number;
  hasOpenOnTicker?: boolean;
  skipThinBid?: boolean;
  bidSize?: number | null;
}): GateResult {
  const risk = opts.cfg.risk as AppConfig['risk'] & {
    gold_fade_enabled?: boolean;
    gold_fade_max_gap_usd?: number;
    gold_fade_max_ask_usd?: number;
    gold_fade_flatten_minutes?: number;
    cash_out_skip_thin_bid?: boolean;
  };
  if (!opts.adminEnabled) {
    return { ok: false, skip_reason: 'gold_fade_admin_off' };
  }
  if (!risk.gold_fade_enabled) {
    return { ok: false, skip_reason: 'gold_fade_off' };
  }
  if (opts.lean.asset !== GOLD_FADE_ASSET) {
    return { ok: false, skip_reason: 'gold_fade_not_gold' };
  }
  if (opts.lean.phase === 'ended') {
    return { ok: false, skip_reason: 'window_ended' };
  }
  const maxGap = normalizeGoldFadeMaxGapUsd(risk.gold_fade_max_gap_usd);
  const absGap = Number(opts.lean.abs_gap) || 0;
  if (absGap > maxGap + 1e-9) {
    return { ok: false, skip_reason: 'gold_fade_gap_wide' };
  }
  const cheap = goldFadeCheapSide(opts.lean);
  if (!cheap) {
    return { ok: false, skip_reason: 'gold_fade_no_cheap_side' };
  }
  const maxAsk = normalizeGoldFadeMaxAskUsd(risk.gold_fade_max_ask_usd);
  const ask = sideAskOf(cheap, opts.lean);
  if (ask == null || ask > maxAsk + 1e-9) {
    return { ok: false, skip_reason: 'gold_fade_ask_rich' };
  }
  const spread = sideSpreadOf(cheap, opts.lean);
  if (spread == null || spread > CASH_OUT_SPREAD_MAX_USD + 1e-9) {
    return { ok: false, skip_reason: 'gold_fade_spread_wide' };
  }
  const flatten = normalizeGoldFadeFlattenMinutes(risk.gold_fade_flatten_minutes);
  if (goldFadeMinutesLeft(opts.lean) <= flatten + 1e-9) {
    return { ok: false, skip_reason: 'gold_fade_too_late' };
  }
  if (opts.hasOpenOnTicker) {
    return { ok: false, skip_reason: 'gold_fade_holding_other_path' };
  }

  const leanForGate: LeanSignal & CashOutQuotes = {
    ...opts.lean,
    decision: cheap,
    abs_gap: absGap,
  };
  const gate = evaluateStaticGate(leanForGate, goldFadeGateConfig(opts.cfg, maxAsk, flatten), {
    openPositions: opts.openPositions,
    dailyPnlUsd: opts.dailyPnlUsd,
    tradesToday: opts.tradesToday,
    assetTradesInWindow: opts.assetTradesInWindow,
  });
  if (
    gate.ok &&
    (opts.skipThinBid || Boolean(risk.cash_out_skip_thin_bid)) &&
    isCashOutThinBid(opts.bidSize, gate.count)
  ) {
    return { ok: false, skip_reason: 'gold_fade_thin_bid' };
  }
  return gate;
}

export function evaluateGoldFadeExit(opts: {
  heldSide: GoldFadeHeldSide;
  quotes: CashOutQuotes;
  fillPayUsd?: number | null;
  takeUsd?: number | null;
  stopUsd?: number | null;
  flattenMinutes?: number | null;
  lean: { decision: string; abs_gap?: number; phase?: string; minutes_left?: number; minutes_remaining?: number };
  cushion: number;
  filledAt?: string | Date | number | null;
  graceSeconds?: number;
  now?: Date;
  skipThinBid?: boolean;
  bidSize?: number | null;
  needCount?: number | null;
}): {
  sell: boolean;
  kind: GoldFadeExitKind;
  reason: string;
  bid: number | null;
  target: number | null;
  minGap: number;
  leanGap: number;
} {
  const take = normalizeGoldFadeTakeUsd(opts.takeUsd);
  const target = goldFadeTakeTargetUsd(opts.fillPayUsd, take);
  const stopFloor = goldFadeStopFloorUsd(
    opts.fillPayUsd,
    opts.stopUsd == null ? GOLD_FADE_STOP_DEFAULT : opts.stopUsd
  );
  const flatten = normalizeGoldFadeFlattenMinutes(opts.flattenMinutes);
  const bid = sideBidOf(opts.heldSide, opts.quotes);
  const flip = shouldProtectSell({
    enabled: true,
    heldSide: opts.heldSide,
    lean: opts.lean,
    cushion: opts.cushion,
    gapRatio: 1,
    filledAt: opts.filledAt,
    graceSeconds: 0,
    now: opts.now,
  });

  const empty = {
    bid,
    target,
    minGap: flip.minGap,
    leanGap: flip.leanGap,
  };

  if (opts.lean.phase === 'ended') {
    return { sell: true, kind: 'gold_fade_time', reason: 'window_ended', ...empty };
  }
  if (
    inProtectSellGrace({
      filledAt: opts.filledAt,
      graceSeconds: opts.graceSeconds ?? GOLD_FADE_GRACE_DEFAULT,
      now: opts.now,
    })
  ) {
    return { sell: false, kind: 'none', reason: 'grace_after_fill', ...empty };
  }
  if (bid != null && target != null && bid + 1e-9 >= target) {
    return { sell: true, kind: 'gold_fade_take', reason: 'bid_take', ...empty };
  }
  if (bid != null && stopFloor != null && bid <= stopFloor + 1e-9) {
    return { sell: true, kind: 'gold_fade_stop', reason: 'bid_stop', ...empty };
  }
  if (opts.skipThinBid && isCashOutThinBid(opts.bidSize, opts.needCount)) {
    return { sell: true, kind: 'gold_fade_thin_bid', reason: 'thin_bid', ...empty };
  }
  if (goldFadeMinutesLeft(opts.lean) <= flatten + 1e-9) {
    return { sell: true, kind: 'gold_fade_time', reason: 'flatten_minutes', ...empty };
  }
  if (flip.sell) {
    return { sell: true, kind: 'gold_fade_flip', reason: flip.reason, ...empty };
  }
  return { sell: false, kind: 'none', reason: flip.reason, ...empty };
}

export function buildGoldFadeSellOrder(opts: {
  heldSide: GoldFadeHeldSide;
  fillCount: number;
  quotes: CashOutQuotes;
  slippageUsd?: number;
}) {
  return buildProtectSellOrder({
    heldSide: opts.heldSide,
    fillCount: opts.fillCount,
    yesBid: opts.quotes.yes_bid,
    yesAsk: opts.quotes.yes_ask,
    slippageUsd: opts.slippageUsd,
  });
}

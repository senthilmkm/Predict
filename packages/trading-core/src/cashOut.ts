import { AppConfig, ASSETS_CATALOG, AssetKey } from './types';
import { evaluateStaticGate, GateResult, LeanSignal } from './gates';
import {
  buildProtectSellOrder,
  inProtectSellGrace,
  shouldProtectSell,
} from './protectSell';

export const CASH_OUT_SPREAD_MAX_USD = 0.06;
export const CASH_OUT_MIN_MINUTES_LEFT = 3;
export const CASH_OUT_FLIP_GAP_RATIO = 1;
export const CASH_OUT_ENTER_PCT_DEFAULT = 60;
export const CASH_OUT_ENTER_PCT_MIN = 40;
export const CASH_OUT_ENTER_PCT_MAX = 100;
export const CASH_OUT_MAX_ASK_DEFAULT = 0.82;
export const CASH_OUT_BID_DEFAULT = 0.88;
export const CASH_OUT_TICKET_MIN = 0.5;
export const CASH_OUT_TICKET_MAX = 0.99;
export const CASH_OUT_BID_CHECK_DEFAULT_SEC = 3;
export const CASH_OUT_BID_CHECK_MIN_SEC = 2;
export const CASH_OUT_BID_CHECK_MAX_SEC = 10;
export const CASH_OUT_MIN_EDGE_WARN_USD = 0.04;
export const CASH_OUT_STOP_DEFAULT_USD = 0.05;
export const CASH_OUT_STOP_MIN_USD = 0.03;
export const CASH_OUT_STOP_MAX_USD = 0.1;
export const CASH_OUT_DEFAULT_ASSETS: AssetKey[] = ['Gold'];

export type TradeEntryPath = 'home' | 'auto' | 'cash_out';
export type CashOutHeldSide = 'YES' | 'NO';
export type CashOutExitKind = 'none' | 'cash_out_bid' | 'cash_out_stop' | 'flip' | 'settle';

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

/** Kalshi ticket dollar, 4 dp, valid 1¢–99¢. */
export function ticketUsd(raw: unknown): number | null {
  const x = Number(raw);
  if (!Number.isFinite(x)) return null;
  const r = Math.round(x * 10000) / 10000;
  if (r < 0.01 - 1e-12 || r > 0.99 + 1e-12) return null;
  return Math.min(0.99, Math.max(0.01, r));
}

export function complementTicket(n: number): number {
  return Math.round((1 - n) * 10000) / 10000;
}

export type CashOutQuotes = {
  yes_bid?: number | null;
  yes_ask?: number | null;
  no_bid?: number | null;
  no_ask?: number | null;
};

export function yesBidOf(q: CashOutQuotes): number | null {
  return ticketUsd(q.yes_bid);
}

export function yesAskOf(q: CashOutQuotes): number | null {
  return ticketUsd(q.yes_ask);
}

/** NO ask from quote, or 1 − YES bid (Kalshi complement). */
export function noAskOf(q: CashOutQuotes): number | null {
  const direct = ticketUsd(q.no_ask);
  if (direct != null) return direct;
  const yb = yesBidOf(q);
  return yb == null ? null : ticketUsd(complementTicket(yb));
}

/** NO bid from quote, or 1 − YES ask (Kalshi complement). */
export function noBidOf(q: CashOutQuotes): number | null {
  const direct = ticketUsd(q.no_bid);
  if (direct != null) return direct;
  const ya = yesAskOf(q);
  return ya == null ? null : ticketUsd(complementTicket(ya));
}

export function sideAskOf(side: CashOutHeldSide, q: CashOutQuotes): number | null {
  return side === 'YES' ? yesAskOf(q) : noAskOf(q);
}

export function sideBidOf(side: CashOutHeldSide, q: CashOutQuotes): number | null {
  return side === 'YES' ? yesBidOf(q) : noBidOf(q);
}

export function sideSpreadOf(side: CashOutHeldSide, q: CashOutQuotes): number | null {
  const ask = sideAskOf(side, q);
  const bid = sideBidOf(side, q);
  if (ask == null || bid == null) return null;
  return Math.round((ask - bid) * 10000) / 10000;
}

export function normalizeCashOutEnterPct(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? CASH_OUT_ENTER_PCT_DEFAULT), CASH_OUT_ENTER_PCT_MIN, CASH_OUT_ENTER_PCT_MAX));
}

export function normalizeCashOutMaxAsk(raw: unknown): number {
  return snap(clamp(Number(raw ?? CASH_OUT_MAX_ASK_DEFAULT), CASH_OUT_TICKET_MIN, CASH_OUT_TICKET_MAX), 0.01);
}

export function normalizeCashOutBid(raw: unknown): number {
  return snap(clamp(Number(raw ?? CASH_OUT_BID_DEFAULT), CASH_OUT_TICKET_MIN, CASH_OUT_TICKET_MAX), 0.01);
}

export function normalizeCashOutStopUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? CASH_OUT_STOP_DEFAULT_USD), CASH_OUT_STOP_MIN_USD, CASH_OUT_STOP_MAX_USD),
    0.01
  );
}

export function normalizeCashOutBidCheckSeconds(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? CASH_OUT_BID_CHECK_DEFAULT_SEC), CASH_OUT_BID_CHECK_MIN_SEC, CASH_OUT_BID_CHECK_MAX_SEC)
  );
}

export function normalizeCashOutAssets(raw: unknown): string[] {
  const allowed = new Set(ASSETS_CATALOG.map((a) => a.key));
  if (raw == null) return [...CASH_OUT_DEFAULT_ASSETS];
  if (!Array.isArray(raw)) return [...CASH_OUT_DEFAULT_ASSETS];
  const out: string[] = [];
  for (const item of raw) {
    const k = String(item || '').trim();
    if (allowed.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** If bid ≤ max ask, lift bid one cent (capped). Used when stepping Risk fields. */
export function reconcileCashOutTargets(maxAsk: number, bid: number): { maxAsk: number; bid: number } {
  let ask = normalizeCashOutMaxAsk(maxAsk);
  let target = normalizeCashOutBid(bid);
  if (target <= ask + 1e-9) {
    target = normalizeCashOutBid(ask + 0.01);
    if (target <= ask + 1e-9) {
      ask = normalizeCashOutMaxAsk(target - 0.01);
    }
  }
  return { maxAsk: ask, bid: target };
}

export function cashOutEdgeUsd(maxAsk: number, bid: number): number {
  return Math.round((normalizeCashOutBid(bid) - normalizeCashOutMaxAsk(maxAsk)) * 10000) / 10000;
}

/**
 * Sell when held-side bid ≥ fill + (Cash out bid − max ask).
 * Paid $0.82 with $0.82 / $0.88 → $0.88. Paid $0.78 → $0.84.
 * Missing fill or invalid edge falls back to the Cash out bid setting.
 */
export function cashOutFillExitTargetUsd(opts: {
  fillPayUsd?: number | null;
  maxAskUsd?: number | null;
  bidUsd: number;
}): number {
  const bid = normalizeCashOutBid(opts.bidUsd);
  const maxAsk =
    opts.maxAskUsd == null || !Number.isFinite(Number(opts.maxAskUsd))
      ? CASH_OUT_MAX_ASK_DEFAULT
      : normalizeCashOutMaxAsk(opts.maxAskUsd);
  const edge = cashOutEdgeUsd(maxAsk, bid);
  const fill = ticketUsd(opts.fillPayUsd);
  if (fill == null || !(edge > 0)) return bid;
  return normalizeCashOutBid(fill + edge);
}

/** Bid at or below this → Cash out stop. Paid $0.78 / 5¢ → $0.73. */
export function cashOutStopFloorUsd(fillPayUsd: unknown, stopUsd: unknown): number | null {
  const fill = ticketUsd(fillPayUsd);
  if (fill == null) return null;
  const stop = normalizeCashOutStopUsd(stopUsd);
  const floor = Math.round((fill - stop) * 10000) / 10000;
  if (floor < 0.01 - 1e-12) return 0.01;
  return floor;
}

export function cashOutTargetsValid(maxAsk: number, bid: number): boolean {
  return cashOutEdgeUsd(maxAsk, bid) > 0;
}

export function cashOutEdgeWarn(maxAsk: number, bid: number): boolean {
  return cashOutEdgeUsd(maxAsk, bid) + 1e-9 < CASH_OUT_MIN_EDGE_WARN_USD;
}

/** Gap in asset $ required to enter. Gold $175 × 60% = $105.0000 */
export function cashOutEnterMinGapUsd(cushion: number, enterPct: number): number {
  const c = Math.max(0, Number(cushion) || 0);
  const p = normalizeCashOutEnterPct(enterPct);
  return Math.round(((c * p) / 100) * 10000) / 10000;
}

export function cashOutMinMinutesLeft(autoMinMinutesLeft: number): number {
  const auto = Math.max(0, Math.round(Number(autoMinMinutesLeft) || 0));
  return Math.max(CASH_OUT_MIN_MINUTES_LEFT, auto);
}

export function isCashOutAssetSelected(assets: unknown, asset: string): boolean {
  const list = Array.isArray(assets) ? assets.map((a) => String(a)) : normalizeCashOutAssets(assets);
  return list.includes(String(asset));
}

/** Admin On + user On + asset checked. */
export function isCashOutEnterPath(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assets: unknown;
  asset: string;
}): boolean {
  if (!opts.adminEnabled || !opts.userEnabled) return false;
  return isCashOutAssetSelected(opts.assets, opts.asset);
}

export function parseTradeEntryPath(raw: unknown): TradeEntryPath | undefined {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim();
  if (v === 'home' || v === 'manual_buy' || v === 'manual') return 'home';
  if (v === 'auto' || v === 'auto_trade' || v === 'worker') return 'auto';
  if (v === 'cash_out' || v === 'cashout') return 'cash_out';
  return undefined;
}

export function isCashOutEntryPath(raw: unknown): boolean {
  return parseTradeEntryPath(raw) === 'cash_out';
}

export function isOpenLiveFill(trade: {
  dryRun?: boolean;
  dry_run?: boolean;
  status?: string;
  outcome?: string | null;
  fillCount?: number | null;
  fill_count?: number | null;
  ticker?: string;
  market_ticker?: string;
}): boolean {
  if (trade.dryRun || trade.dry_run) return false;
  const fills = Number(trade.fillCount ?? trade.fill_count ?? 0);
  if (!(Number.isFinite(fills) && fills > 0)) return false;
  const status = String(trade.status || '');
  if (status === 'CANCELLED' || status === 'SETTLED') {
    const outcome = String(trade.outcome || '');
    if (outcome === 'exited' || outcome === 'win' || outcome === 'loss' || outcome === 'miss') return false;
    if (status === 'SETTLED') return false;
  }
  const outcome = String(trade.outcome || 'pending');
  if (outcome === 'exited' || outcome === 'win' || outcome === 'loss' || outcome === 'miss' || outcome === 'dry_run') {
    return false;
  }
  return outcome === 'pending' || outcome === 'exiting' || outcome === '';
}

export function openFillsForTicker<T extends { ticker?: string; market_ticker?: string }>(
  trades: T[] | null | undefined,
  marketTicker: string
): T[] {
  const ticker = String(marketTicker || '').trim();
  if (!ticker) return [];
  return (trades || []).filter((t) => {
    const row = String(t?.ticker || t?.market_ticker || '').trim();
    return row === ticker && isOpenLiveFill(t);
  });
}

export function tickerHasOpenCashOut(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some((t) =>
    isCashOutEntryPath(t.entryPath ?? t.entry_path)
  );
}

export function tickerHasOpenNonCashOut(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some(
    (t) => !isCashOutEntryPath(t.entryPath ?? t.entry_path)
  );
}

export function openCashOutAssets(
  trades: Array<{ asset?: string; entryPath?: unknown; entry_path?: unknown } & Parameters<typeof isOpenLiveFill>[0]>
): string[] {
  const out: string[] = [];
  for (const t of trades || []) {
    if (!isOpenLiveFill(t) || !isCashOutEntryPath(t.entryPath ?? t.entry_path)) continue;
    const asset = String(t.asset || '').trim();
    if (asset && !out.includes(asset)) out.push(asset);
  }
  return out;
}

export function cashOutGateConfig(cfg: AppConfig, asset: AssetKey): AppConfig {
  const enterPct = normalizeCashOutEnterPct((cfg.risk as { cash_out_enter_pct?: number }).cash_out_enter_pct);
  const maxAsk = normalizeCashOutMaxAsk((cfg.risk as { cash_out_max_ask_usd?: number }).cash_out_max_ask_usd);
  const fullCushion = Number(cfg.cushions[asset]) || 0;
  const enterCushion = cashOutEnterMinGapUsd(fullCushion, enterPct);
  return {
    ...cfg,
    risk: {
      ...cfg.risk,
      max_entry_ask_usd: maxAsk,
      min_minutes_left: cashOutMinMinutesLeft(cfg.risk.min_minutes_left),
      smart_buy_enabled: false,
    },
    cushions: { ...cfg.cushions, [asset]: enterCushion },
  };
}

export function evaluateCashOutEnter(opts: {
  lean: LeanSignal & CashOutQuotes;
  cfg: AppConfig;
  adminEnabled: boolean;
  openPositions?: number;
  dailyPnlUsd?: number;
  tradesToday?: number;
  assetTradesInWindow?: number;
  hasOpenNonCashOutOnTicker?: boolean;
}): GateResult {
  const risk = opts.cfg.risk as AppConfig['risk'] & {
    cash_out_enabled?: boolean;
    cash_out_assets?: string[];
    cash_out_max_ask_usd?: number;
    cash_out_bid_usd?: number;
    cash_out_enter_pct?: number;
  };
  if (!opts.adminEnabled) {
    return { ok: false, skip_reason: 'cash_out_admin_off' };
  }
  if (!risk.cash_out_enabled) {
    return { ok: false, skip_reason: 'cash_out_off' };
  }
  if (!isCashOutAssetSelected(risk.cash_out_assets, opts.lean.asset)) {
    return { ok: false, skip_reason: 'cash_out_asset_off' };
  }
  const maxAsk = normalizeCashOutMaxAsk(risk.cash_out_max_ask_usd);
  const target = normalizeCashOutBid(risk.cash_out_bid_usd);
  if (!cashOutTargetsValid(maxAsk, target)) {
    return { ok: false, skip_reason: 'cash_out_invalid_targets' };
  }
  if (opts.hasOpenNonCashOutOnTicker) {
    return { ok: false, skip_reason: 'cash_out_holding_other_path' };
  }

  const decision = opts.lean.decision;
  if (decision === 'YES' || decision === 'NO') {
    const spread = sideSpreadOf(decision, opts.lean);
    const bid = sideBidOf(decision, opts.lean);
    if (bid == null) {
      return { ok: false, skip_reason: 'cash_out_no_bid' };
    }
    if (spread == null || spread > CASH_OUT_SPREAD_MAX_USD + 1e-9) {
      return { ok: false, skip_reason: 'cash_out_spread_wide' };
    }
  }

  return evaluateStaticGate(opts.lean, cashOutGateConfig(opts.cfg, opts.lean.asset), {
    openPositions: opts.openPositions,
    dailyPnlUsd: opts.dailyPnlUsd,
    tradesToday: opts.tradesToday,
    assetTradesInWindow: opts.assetTradesInWindow,
  });
}

export function evaluateCashOutExit(opts: {
  heldSide: CashOutHeldSide;
  quotes: CashOutQuotes;
  cashOutBidUsd: number;
  cashOutMaxAskUsd?: number | null;
  fillPayUsd?: number | null;
  stopUsd?: number | null;
  lean: { decision: string; abs_gap?: number; phase?: string };
  cushion: number;
  filledAt?: string | Date | number | null;
  graceSeconds?: number;
  now?: Date;
}): {
  sell: boolean;
  kind: CashOutExitKind;
  reason: string;
  bid: number | null;
  target: number;
  minGap: number;
  leanGap: number;
} {
  const target = cashOutFillExitTargetUsd({
    fillPayUsd: opts.fillPayUsd,
    maxAskUsd: opts.cashOutMaxAskUsd,
    bidUsd: opts.cashOutBidUsd,
  });
  const stopFloor = cashOutStopFloorUsd(
    opts.fillPayUsd,
    opts.stopUsd == null ? CASH_OUT_STOP_DEFAULT_USD : opts.stopUsd
  );
  const bid = sideBidOf(opts.heldSide, opts.quotes);
  const flip = shouldProtectSell({
    enabled: true,
    heldSide: opts.heldSide,
    lean: opts.lean,
    cushion: opts.cushion,
    gapRatio: CASH_OUT_FLIP_GAP_RATIO,
    filledAt: opts.filledAt,
    graceSeconds: opts.graceSeconds ?? 0,
    now: opts.now,
  });

  if (opts.lean.phase === 'ended') {
    return {
      sell: false,
      kind: 'settle',
      reason: 'window_ended',
      bid,
      target,
      minGap: flip.minGap,
      leanGap: flip.leanGap,
    };
  }
  if (
    inProtectSellGrace({
      filledAt: opts.filledAt,
      graceSeconds: opts.graceSeconds ?? 0,
      now: opts.now,
    })
  ) {
    return {
      sell: false,
      kind: 'none',
      reason: 'grace_after_fill',
      bid,
      target,
      minGap: flip.minGap,
      leanGap: flip.leanGap,
    };
  }
  if (bid != null && bid + 1e-9 >= target) {
    return {
      sell: true,
      kind: 'cash_out_bid',
      reason: 'bid_target',
      bid,
      target,
      minGap: flip.minGap,
      leanGap: flip.leanGap,
    };
  }
  if (bid != null && stopFloor != null && bid <= stopFloor + 1e-9) {
    return {
      sell: true,
      kind: 'cash_out_stop',
      reason: 'bid_stop',
      bid,
      target,
      minGap: flip.minGap,
      leanGap: flip.leanGap,
    };
  }
  if (flip.sell) {
    return {
      sell: true,
      kind: 'flip',
      reason: flip.reason,
      bid,
      target,
      minGap: flip.minGap,
      leanGap: flip.leanGap,
    };
  }
  return {
    sell: false,
    kind: 'none',
    reason: flip.reason,
    bid,
    target,
    minGap: flip.minGap,
    leanGap: flip.leanGap,
  };
}

export function buildCashOutSellOrder(opts: {
  heldSide: CashOutHeldSide;
  fillCount: number;
  quotes: CashOutQuotes;
  slippageUsd?: number;
}) {
  return buildProtectSellOrder({
    heldSide: opts.heldSide,
    fillCount: opts.fillCount,
    yesBid: yesBidOf(opts.quotes) ?? opts.quotes.yes_bid,
    yesAsk: yesAskOf(opts.quotes) ?? opts.quotes.yes_ask,
    slippageUsd: opts.slippageUsd,
  });
}

/** Delays (ms) after a full tick, within one tick interval, for quote-only watches. */
export function cashOutWatchOffsetsMs(intervalSec: number, bidCheckSec: number): number[] {
  const interval = Math.max(1, Number(intervalSec) || 20);
  const step = normalizeCashOutBidCheckSeconds(bidCheckSec);
  const out: number[] = [];
  for (let t = step; t < interval - 0.05; t += step) {
    out.push(Math.round(t * 1000));
  }
  return out;
}

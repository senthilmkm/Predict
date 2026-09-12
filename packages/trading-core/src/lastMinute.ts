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

export const LAST_MINUTE_WATCH_SEC = 150;
export const LAST_MINUTE_WATCH_SEC_MIN = 70;
export const LAST_MINUTE_WATCH_SEC_MAX = 180;
export const LAST_MINUTE_ENTER_SEC_DEFAULT = 90;
export const LAST_MINUTE_ENTER_SEC_MIN = 30;
export const LAST_MINUTE_ENTER_SEC_MAX = 150;
export const LAST_MINUTE_STOP_SEC_DEFAULT = 10;
export const LAST_MINUTE_STOP_SEC_MIN = 5;
export const LAST_MINUTE_STOP_SEC_MAX = 20;
export const LAST_MINUTE_LADDER_SEC_DEFAULT = 2;
export const LAST_MINUTE_LADDER_SEC_MIN = 1;
export const LAST_MINUTE_LADDER_SEC_MAX = 5;
export const LAST_MINUTE_CLIP_COUNT_DEFAULT = 1;
export const LAST_MINUTE_CLIP_COUNT_MAX = 5;
export const LAST_MINUTE_MAX_CLIPS_DEFAULT = 5;
export const LAST_MINUTE_MAX_CLIPS_MAX = 20;
export const LAST_MINUTE_MAX_ASK_DEFAULT = 0.96;
export const LAST_MINUTE_MAX_ASK_MIN = 0.8;
export const LAST_MINUTE_MAX_ASK_MAX = 0.99;
/** Both sits out unless the favorite ask is at least this (or the entry ask, if lower). */
export const LAST_MINUTE_BOTH_MIN_ASK = 0.9;
export const LAST_MINUTE_BOTH_MIN_ASK_MIN = 0.7;
export const LAST_MINUTE_BOTH_MIN_ASK_MAX = 0.95;
export const LAST_MINUTE_BOTH_GAP_MIN = 0.1;
export const LAST_MINUTE_BOTH_GAP_MAX = 0.2;
/** 0 = Off. On range 5–20¢. A 1¢ dip does not sell. */
export const LAST_MINUTE_FLIP_SELL_OFF = 0;
export const LAST_MINUTE_FLIP_SELL_MIN = 0.05;
export const LAST_MINUTE_FLIP_SELL_MAX = 0.2;
export const LAST_MINUTE_FLIP_SELL_DEFAULT = 0;
export const LAST_MINUTE_FLIP_SELL_GRACE_SEC = 2;

export type LastMinuteSide = 'yes' | 'no' | 'both';

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

export function normalizeLastMinuteMaxAskUsd(raw: unknown): number {
  return snap(
    clamp(Number(raw ?? LAST_MINUTE_MAX_ASK_DEFAULT), LAST_MINUTE_MAX_ASK_MIN, LAST_MINUTE_MAX_ASK_MAX),
    0.01
  );
}

export function normalizeLastMinuteWatchSeconds(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? LAST_MINUTE_WATCH_SEC), LAST_MINUTE_WATCH_SEC_MIN, LAST_MINUTE_WATCH_SEC_MAX));
}

export function normalizeLastMinuteEnterSeconds(raw: unknown, watchSec?: unknown): number {
  const watch = normalizeLastMinuteWatchSeconds(watchSec ?? LAST_MINUTE_WATCH_SEC);
  return Math.round(
    clamp(
      Number(raw ?? LAST_MINUTE_ENTER_SEC_DEFAULT),
      LAST_MINUTE_ENTER_SEC_MIN,
      Math.min(LAST_MINUTE_ENTER_SEC_MAX, watch)
    )
  );
}

export function normalizeLastMinuteStopSeconds(raw: unknown, enterSec?: number): number {
  const enter = Math.max(LAST_MINUTE_ENTER_SEC_MIN, Number(enterSec) || LAST_MINUTE_ENTER_SEC_DEFAULT);
  return Math.round(
    clamp(Number(raw ?? LAST_MINUTE_STOP_SEC_DEFAULT), LAST_MINUTE_STOP_SEC_MIN, Math.min(LAST_MINUTE_STOP_SEC_MAX, enter - 1))
  );
}

export function normalizeLastMinuteLadderSeconds(raw: unknown): number {
  return Math.round(
    clamp(Number(raw ?? LAST_MINUTE_LADDER_SEC_DEFAULT), LAST_MINUTE_LADDER_SEC_MIN, LAST_MINUTE_LADDER_SEC_MAX)
  );
}

export function normalizeLastMinuteClipCount(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? LAST_MINUTE_CLIP_COUNT_DEFAULT), 1, LAST_MINUTE_CLIP_COUNT_MAX));
}

export function normalizeLastMinuteMaxClips(raw: unknown): number {
  return Math.round(clamp(Number(raw ?? LAST_MINUTE_MAX_CLIPS_DEFAULT), 1, LAST_MINUTE_MAX_CLIPS_MAX));
}

export function normalizeLastMinuteBothMinAsk(raw: unknown, maxAsk?: number): number {
  const cap = maxAsk != null ? normalizeLastMinuteMaxAskUsd(maxAsk) : LAST_MINUTE_BOTH_MIN_ASK_MAX;
  return snap(
    clamp(Number(raw ?? LAST_MINUTE_BOTH_MIN_ASK), LAST_MINUTE_BOTH_MIN_ASK_MIN, Math.min(LAST_MINUTE_BOTH_MIN_ASK_MAX, cap)),
    0.01
  );
}

export function normalizeLastMinuteBothGap(raw: unknown): number {
  return snap(clamp(Number(raw ?? LAST_MINUTE_BOTH_GAP_MIN), 0.05, LAST_MINUTE_BOTH_GAP_MAX), 0.01);
}

export function normalizeLastMinuteFlipSellUsd(raw: unknown): number {
  const n = Number(raw ?? LAST_MINUTE_FLIP_SELL_DEFAULT);
  if (!Number.isFinite(n) || n <= 0) return LAST_MINUTE_FLIP_SELL_OFF;
  return snap(clamp(n, LAST_MINUTE_FLIP_SELL_MIN, LAST_MINUTE_FLIP_SELL_MAX), 0.01);
}

export function lastMinuteDefaultAssets(): string[] {
  return ASSETS_CATALOG.map((a) => a.key);
}

/** Missing → all catalog assets (old “any asset you have On”). Empty = no Last-minute buys. */
export function normalizeLastMinuteAssets(raw: unknown): string[] {
  const allowed = lastMinuteDefaultAssets();
  const allowedSet = new Set(allowed);
  if (raw == null || !Array.isArray(raw)) return allowed;
  const out: string[] = [];
  for (const item of raw) {
    const k = String(item || '').trim();
    if (allowedSet.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function isLastMinuteAssetSelected(assets: unknown, asset: string): boolean {
  return normalizeLastMinuteAssets(assets).includes(String(asset));
}

export function normalizeLastMinuteSide(raw: unknown): LastMinuteSide {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim();
  if (v === 'no') return 'no';
  if (v === 'both') return 'both';
  return 'yes';
}

export function isLastMinuteEntryPath(raw: unknown): boolean {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim();
  return v === 'last_minute' || v === 'lastminute' || v === 'last-minute';
}

/** Admin On + user On + Cushions On + checked on this path. Does not reserve the coin from Cash out / Auto. */
export function isLastMinuteEnterPath(opts: {
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
      isLastMinuteAssetSelected(opts.assets, opts.asset)
  );
}

export function lastMinuteTimingFromRisk(risk?: {
  last_minute_watch_seconds?: unknown;
  last_minute_enter_seconds?: unknown;
  last_minute_stop_seconds?: unknown;
  last_minute_max_clips?: unknown;
}): { watchSec: number; enterSec: number; stopSec: number; maxClips: number } {
  const watchSec = normalizeLastMinuteWatchSeconds(risk?.last_minute_watch_seconds);
  const enterSec = normalizeLastMinuteEnterSeconds(risk?.last_minute_enter_seconds, watchSec);
  const stopSec = normalizeLastMinuteStopSeconds(risk?.last_minute_stop_seconds, enterSec);
  const maxClips = normalizeLastMinuteMaxClips(risk?.last_minute_max_clips);
  return { watchSec, enterSec, stopSec, maxClips };
}

export function lastMinuteSecondsLeft(now: Date, closeUtc: Date): number {
  return twapLockSecondsLeft(now, closeUtc);
}

export function isLastMinuteWindow(now: Date, closeUtc: Date, enterSec?: unknown, stopSec?: unknown): boolean {
  const left = (closeUtc.getTime() - now.getTime()) / 1000;
  const enter = normalizeLastMinuteEnterSeconds(enterSec);
  const stop = normalizeLastMinuteStopSeconds(stopSec, enter);
  return left > stop && left <= enter;
}

export function isLastMinuteWatchWindow(now: Date, closeUtc: Date, watchSec?: unknown): boolean {
  const left = (closeUtc.getTime() - now.getTime()) / 1000;
  return left > 0 && left <= normalizeLastMinuteWatchSeconds(watchSec);
}

export function resolveLastMinuteCloseUtc(
  lean: { close_utc?: string | Date | null; minutes_remaining?: number },
  now: Date
): Date | null {
  return resolveTwapCloseUtc(lean, now);
}

export function lastMinuteTwapOwns(opts: {
  twapAdminEnabled: boolean;
  twapUserEnabled: boolean;
  twapAssets: unknown;
  asset: string;
}): boolean {
  return twapLockBlocksOtherAutoPaths({
    adminEnabled: opts.twapAdminEnabled,
    userEnabled: opts.twapUserEnabled,
    assets: opts.twapAssets,
    asset: opts.asset,
  });
}

export function tickerHasOpenOtherThanLastMinute(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some(
    (t) =>
      !isLastMinuteEntryPath(
        (t as { entryPath?: unknown; entry_path?: unknown }).entryPath ??
          (t as { entry_path?: unknown }).entry_path
      )
  );
}

export function tickerHasOpenLastMinute(
  trades: Array<{ ticker?: string; market_ticker?: string; entryPath?: unknown; entry_path?: unknown }>,
  marketTicker: string
): boolean {
  return openFillsForTicker(trades, marketTicker).some((t) =>
    isLastMinuteEntryPath(
      (t as { entryPath?: unknown; entry_path?: unknown }).entryPath ??
        (t as { entry_path?: unknown }).entry_path
    )
  );
}

export function openLastMinuteAssets(
  trades: Array<{ asset?: string; entryPath?: unknown; entry_path?: unknown } & Parameters<typeof isOpenLiveFill>[0]>
): string[] {
  const out: string[] = [];
  for (const t of trades || []) {
    if (!isOpenLiveFill(t) || !isLastMinuteEntryPath(t.entryPath ?? t.entry_path)) continue;
    const asset = String(t.asset || '').trim();
    if (asset && !out.includes(asset)) out.push(asset);
  }
  return out;
}

/** Live Kalshi ask. $1.00 is a real print — stop, do not treat as missing. */
export function lastMinuteAskUsd(raw: unknown): number | null {
  const x = Number(raw);
  if (!Number.isFinite(x)) return null;
  if (x >= 0.995) return 1;
  return ticketUsd(raw);
}

export function pickLastMinuteSide(opts: {
  side: LastMinuteSide;
  yesAsk: number | null;
  noAsk: number | null;
  maxAsk: number;
  bothMinAsk?: number;
  bothGap?: number;
}): { ok: true; decision: 'YES' | 'NO'; ask: number } | { ok: false; reason: string } {
  const maxAsk = opts.maxAsk;
  const yes = opts.yesAsk != null && Number.isFinite(opts.yesAsk) ? Number(opts.yesAsk) : null;
  const no = opts.noAsk != null && Number.isFinite(opts.noAsk) ? Number(opts.noAsk) : null;

  if (opts.side === 'yes') {
    if (yes == null) return { ok: false, reason: 'last_minute_no_ask' };
    if (yes >= 0.995) return { ok: false, reason: 'last_minute_ask_rich' };
    if (yes > maxAsk + 1e-9) return { ok: false, reason: 'last_minute_ask_rich' };
    return { ok: true, decision: 'YES', ask: yes };
  }
  if (opts.side === 'no') {
    if (no == null) return { ok: false, reason: 'last_minute_no_ask' };
    if (no >= 0.995) return { ok: false, reason: 'last_minute_ask_rich' };
    if (no > maxAsk + 1e-9) return { ok: false, reason: 'last_minute_ask_rich' };
    return { ok: true, decision: 'NO', ask: no };
  }

  if (yes == null || no == null) return { ok: false, reason: 'last_minute_no_ask' };
  const gapNeed = normalizeLastMinuteBothGap(opts.bothGap);
  if (Math.abs(yes - no) + 1e-9 < gapNeed) {
    return { ok: false, reason: 'last_minute_no_favorite' };
  }
  const favorite = yes > no ? { decision: 'YES' as const, ask: yes } : { decision: 'NO' as const, ask: no };
  const bothMin = normalizeLastMinuteBothMinAsk(opts.bothMinAsk, maxAsk);
  if (favorite.ask + 1e-9 < bothMin) return { ok: false, reason: 'last_minute_no_favorite' };
  if (favorite.ask >= 0.995) return { ok: false, reason: 'last_minute_ask_rich' };
  if (favorite.ask > maxAsk + 1e-9) return { ok: false, reason: 'last_minute_ask_rich' };
  return { ok: true, ...favorite };
}

export function lastMinuteClipsForTicker(
  trades: Array<{
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
  }>,
  marketTicker: string
): { count: number; lastAt: Date | null } {
  const want = String(marketTicker || '').trim();
  let count = 0;
  let lastAt: Date | null = null;
  for (const t of trades || []) {
    const ticker = String(t.ticker || t.market_ticker || '').trim();
    if (ticker !== want) continue;
    if (!isLastMinuteEntryPath(t.entryPath ?? t.entry_path)) continue;
    if (!isOpenLiveFill(t)) continue;
    count += 1;
    const at = t.executedAt ? new Date(t.executedAt) : null;
    if (at && Number.isFinite(at.getTime()) && (!lastAt || at.getTime() > lastAt.getTime())) lastAt = at;
  }
  return { count, lastAt };
}

/** How much richer the opposite ask is vs the held side. Positive = against you. */
export function lastMinuteFlipUsd(
  heldSide: 'YES' | 'NO',
  yesAsk: number | null,
  noAsk: number | null
): number | null {
  const yes = lastMinuteAskUsd(yesAsk);
  const no = lastMinuteAskUsd(noAsk);
  if (yes == null || no == null) return null;
  if (heldSide === 'YES') return Math.round((no - yes) * 10000) / 10000;
  return Math.round((yes - no) * 10000) / 10000;
}

export function evaluateLastMinuteFlipSell(opts: {
  flipSellUsd?: unknown;
  heldSide: 'YES' | 'NO' | string;
  yesAsk?: number | null;
  noAsk?: number | null;
  phase?: string;
  filledAt?: string | Date | number | null;
  now?: Date;
  graceSeconds?: number;
}): { sell: boolean; reason: string; flipUsd: number; needUsd: number } {
  const needUsd = normalizeLastMinuteFlipSellUsd(opts.flipSellUsd);
  const held = String(opts.heldSide || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  const flipUsd = lastMinuteFlipUsd(held, lastMinuteAskUsd(opts.yesAsk), lastMinuteAskUsd(opts.noAsk));
  const gap = flipUsd == null ? 0 : flipUsd;
  if (needUsd <= 0) {
    return { sell: false, reason: 'last_minute_flip_off', flipUsd: gap, needUsd };
  }
  if (opts.phase === 'ended') {
    return { sell: false, reason: 'window_ended', flipUsd: gap, needUsd };
  }
  if (flipUsd == null) {
    return { sell: false, reason: 'last_minute_no_ask', flipUsd: 0, needUsd };
  }
  if (flipUsd + 1e-9 < needUsd) {
    return { sell: false, reason: 'last_minute_no_flip', flipUsd, needUsd };
  }
  if (
    inProtectSellGrace({
      filledAt: opts.filledAt,
      graceSeconds: opts.graceSeconds ?? LAST_MINUTE_FLIP_SELL_GRACE_SEC,
      now: opts.now,
    })
  ) {
    return { sell: false, reason: 'grace_after_fill', flipUsd, needUsd };
  }
  return { sell: true, reason: 'last_minute_flip', flipUsd, needUsd };
}

export function lastMinuteGateConfig(
  cfg: AppConfig,
  maxAskUsd: number,
  clipCount: number,
  maxClips: number
): AppConfig {
  const cushions = { ...cfg.cushions };
  for (const key of Object.keys(cushions) as AssetKey[]) {
    cushions[key] = 0;
  }
  const clipUsd = Math.max(0.01, clipCount * maxAskUsd);
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
      max_trades_per_asset_per_window: maxClips,
    },
    cushions,
  };
}

export function evaluateLastMinuteEnter(opts: {
  lean: LeanSignal & CashOutQuotes & { close_utc?: string | Date | null };
  cfg: AppConfig;
  adminEnabled: boolean;
  twapAdminEnabled?: boolean;
  now?: Date;
  openPositions?: number;
  dailyPnlUsd?: number;
  tradesToday?: number;
  assetTradesInWindow?: number;
  lastMinuteClips?: number;
  lastClipAt?: Date | null;
  hasOpenOnTicker?: boolean;
  skipThinBid?: boolean;
  bidSize?: number | null;
}): GateResult {
  const now = opts.now || new Date();
  const risk = opts.cfg.risk as AppConfig['risk'] & {
    last_minute_enabled?: boolean;
    last_minute_side?: LastMinuteSide;
    last_minute_max_ask_usd?: number;
    last_minute_assets?: string[];
    last_minute_watch_seconds?: number;
    last_minute_enter_seconds?: number;
    last_minute_stop_seconds?: number;
    last_minute_ladder_seconds?: number;
    last_minute_clip_count?: number;
    last_minute_max_clips?: number;
    last_minute_both_min_ask?: number;
    last_minute_both_gap?: number;
    last_minute_flip_sell_usd?: number;
    cash_out_skip_thin_bid?: boolean;
    last_minute_skip_thin_bid?: boolean;
    twap_lock_enabled?: boolean;
    twap_lock_assets?: string[];
  };
  if (!opts.adminEnabled) {
    return { ok: false, skip_reason: 'last_minute_admin_off' };
  }
  if (risk.last_minute_enabled !== true) {
    return { ok: false, skip_reason: 'last_minute_off' };
  }
  if (!opts.cfg.assets_enabled?.[opts.lean.asset]) {
    return { ok: false, skip_reason: 'asset_disabled' };
  }
  if (!isLastMinuteAssetSelected(risk.last_minute_assets, opts.lean.asset)) {
    return { ok: false, skip_reason: 'last_minute_asset_off' };
  }
  if (
    lastMinuteTwapOwns({
      twapAdminEnabled: opts.twapAdminEnabled === true,
      twapUserEnabled: risk.twap_lock_enabled === true,
      twapAssets: risk.twap_lock_assets,
      asset: opts.lean.asset,
    })
  ) {
    return { ok: false, skip_reason: 'last_minute_twap_owns' };
  }
  if (opts.lean.phase === 'ended') {
    return { ok: false, skip_reason: 'window_ended' };
  }
  const closeUtc = resolveLastMinuteCloseUtc(opts.lean, now);
  if (!closeUtc) {
    return { ok: false, skip_reason: 'last_minute_no_close' };
  }
  const watchSec = normalizeLastMinuteWatchSeconds(risk.last_minute_watch_seconds);
  const enterSec = normalizeLastMinuteEnterSeconds(risk.last_minute_enter_seconds, watchSec);
  const stopSec = normalizeLastMinuteStopSeconds(risk.last_minute_stop_seconds, enterSec);
  const ladderSec = normalizeLastMinuteLadderSeconds(risk.last_minute_ladder_seconds);
  const clipCount = normalizeLastMinuteClipCount(risk.last_minute_clip_count);
  const maxClips = normalizeLastMinuteMaxClips(risk.last_minute_max_clips);
  const left = lastMinuteSecondsLeft(now, closeUtc);
  if (left <= 0) {
    return { ok: false, skip_reason: 'window_ended' };
  }
  if (left <= stopSec) {
    return { ok: false, skip_reason: 'last_minute_stop_window' };
  }
  const clips = Math.max(0, Math.floor(Number(opts.lastMinuteClips) || 0));
  if (clips <= 0) {
    if (!isLastMinuteWindow(now, closeUtc, enterSec, stopSec)) {
      return { ok: false, skip_reason: 'last_minute_not_last_minute' };
    }
  } else if (clips >= maxClips) {
    return { ok: false, skip_reason: 'last_minute_max_clips' };
  } else {
    const lastClipMs = opts.lastClipAt ? opts.lastClipAt.getTime() : 0;
    if (Number.isFinite(lastClipMs) && lastClipMs > 0 && now.getTime() - lastClipMs < ladderSec * 1000 - 20) {
      return { ok: false, skip_reason: 'last_minute_ladder_wait' };
    }
  }
  const maxAsk = normalizeLastMinuteMaxAskUsd(risk.last_minute_max_ask_usd);
  const picked = pickLastMinuteSide({
    side: normalizeLastMinuteSide(risk.last_minute_side),
    yesAsk: lastMinuteAskUsd(opts.lean.yes_ask),
    noAsk: lastMinuteAskUsd(opts.lean.no_ask),
    maxAsk,
    bothMinAsk: risk.last_minute_both_min_ask,
    bothGap: risk.last_minute_both_gap,
  });
  if (!picked.ok) {
    return { ok: false, skip_reason: picked.reason };
  }
  if (opts.hasOpenOnTicker) {
    return { ok: false, skip_reason: 'last_minute_holding_other_path' };
  }

  const leanForGate: LeanSignal = {
    ...opts.lean,
    decision: picked.decision,
    abs_gap: Number(opts.lean.abs_gap) || 0,
    minutes_left: 0,
    minutes_elapsed: Number(opts.lean.minutes_elapsed) || 0,
  };
  const gate = evaluateStaticGate(leanForGate, lastMinuteGateConfig(opts.cfg, maxAsk, clipCount, maxClips), {
    openPositions: opts.openPositions,
    dailyPnlUsd: opts.dailyPnlUsd,
    tradesToday: opts.tradesToday,
    assetTradesInWindow: clips,
  });
  if (!gate.ok) return gate;

  const thinOn = resolveSkipThinBid(risk, 'last_minute', opts.skipThinBid);
  if (thinOn) {
    const need = Math.floor(Number(gate.count) || 0);
    if (opts.bidSize == null || !Number.isFinite(Number(opts.bidSize))) {
      return { ok: false, skip_reason: 'last_minute_thin_bid' };
    }
    if (need > 0 && Number(opts.bidSize) < need) {
      return { ok: false, skip_reason: 'last_minute_thin_bid' };
    }
  }
  return gate;
}

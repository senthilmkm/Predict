import { AppConfig, AssetKey } from './types';
import { evaluateStaticGate, GateResult, LeanSignal } from './gates';
import { CashOutQuotes, isOpenLiveFill, openFillsForTicker, sideAskOf, ticketUsd } from './cashOut';
import {
  isTwapLockLastMinute,
  isTwapLockWatchWindow,
  resolveTwapCloseUtc,
  twapLockBlocksOtherAutoPaths,
  twapLockSecondsLeft,
  TWAP_LOCK_WATCH_SEC,
} from './twapLock';

export const LAST_MINUTE_WATCH_SEC = TWAP_LOCK_WATCH_SEC;
export const LAST_MINUTE_MAX_ASK_DEFAULT = 0.96;
export const LAST_MINUTE_MAX_ASK_MIN = 0.8;
export const LAST_MINUTE_MAX_ASK_MAX = 0.99;
/** Both sits out unless the favorite ask is at least this (or the entry ask, if lower). */
export const LAST_MINUTE_BOTH_MIN_ASK = 0.9;
export const LAST_MINUTE_BOTH_GAP_MIN = 0.1;

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

/** Admin On + user On + that asset is On. Does not reserve the coin from Cash out / Auto. */
export function isLastMinuteEnterPath(opts: {
  adminEnabled: boolean;
  userEnabled: boolean;
  assetEnabled: boolean;
  asset: string;
}): boolean {
  return Boolean(opts.adminEnabled && opts.userEnabled && opts.assetEnabled && String(opts.asset || '').trim());
}

export function lastMinuteSecondsLeft(now: Date, closeUtc: Date): number {
  return twapLockSecondsLeft(now, closeUtc);
}

export function isLastMinuteWindow(now: Date, closeUtc: Date): boolean {
  return isTwapLockLastMinute(now, closeUtc);
}

export function isLastMinuteWatchWindow(now: Date, closeUtc: Date): boolean {
  return isTwapLockWatchWindow(now, closeUtc);
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

export function pickLastMinuteSide(opts: {
  side: LastMinuteSide;
  yesAsk: number | null;
  noAsk: number | null;
  maxAsk: number;
}): { ok: true; decision: 'YES' | 'NO'; ask: number } | { ok: false; reason: string } {
  const maxAsk = opts.maxAsk;
  const yes = opts.yesAsk != null && Number.isFinite(opts.yesAsk) ? Number(opts.yesAsk) : null;
  const no = opts.noAsk != null && Number.isFinite(opts.noAsk) ? Number(opts.noAsk) : null;

  if (opts.side === 'yes') {
    if (yes == null) return { ok: false, reason: 'last_minute_no_ask' };
    if (yes > maxAsk + 1e-9) return { ok: false, reason: 'last_minute_ask_rich' };
    return { ok: true, decision: 'YES', ask: yes };
  }
  if (opts.side === 'no') {
    if (no == null) return { ok: false, reason: 'last_minute_no_ask' };
    if (no > maxAsk + 1e-9) return { ok: false, reason: 'last_minute_ask_rich' };
    return { ok: true, decision: 'NO', ask: no };
  }

  if (yes == null || no == null) return { ok: false, reason: 'last_minute_no_ask' };
  if (Math.abs(yes - no) + 1e-9 < LAST_MINUTE_BOTH_GAP_MIN) {
    return { ok: false, reason: 'last_minute_no_favorite' };
  }
  const favorite = yes > no ? { decision: 'YES' as const, ask: yes } : { decision: 'NO' as const, ask: no };
  const bothMin = Math.min(LAST_MINUTE_BOTH_MIN_ASK, maxAsk);
  if (favorite.ask + 1e-9 < bothMin) return { ok: false, reason: 'last_minute_no_favorite' };
  if (favorite.ask > maxAsk + 1e-9) return { ok: false, reason: 'last_minute_ask_rich' };
  return { ok: true, ...favorite };
}

export function lastMinuteGateConfig(cfg: AppConfig, maxAskUsd: number): AppConfig {
  const cushions = { ...cfg.cushions };
  for (const key of Object.keys(cushions) as AssetKey[]) {
    cushions[key] = 0;
  }
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
  hasOpenOnTicker?: boolean;
  skipThinBid?: boolean;
  bidSize?: number | null;
}): GateResult {
  const now = opts.now || new Date();
  const risk = opts.cfg.risk as AppConfig['risk'] & {
    last_minute_enabled?: boolean;
    last_minute_side?: LastMinuteSide;
    last_minute_max_ask_usd?: number;
    cash_out_skip_thin_bid?: boolean;
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
  if (!isLastMinuteWindow(now, closeUtc)) {
    return { ok: false, skip_reason: 'last_minute_not_last_minute' };
  }
  const maxAsk = normalizeLastMinuteMaxAskUsd(risk.last_minute_max_ask_usd);
  const picked = pickLastMinuteSide({
    side: normalizeLastMinuteSide(risk.last_minute_side),
    yesAsk: ticketUsd(sideAskOf('YES', opts.lean)),
    noAsk: ticketUsd(sideAskOf('NO', opts.lean)),
    maxAsk,
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
  const gate = evaluateStaticGate(leanForGate, lastMinuteGateConfig(opts.cfg, maxAsk), {
    openPositions: opts.openPositions,
    dailyPnlUsd: opts.dailyPnlUsd,
    tradesToday: opts.tradesToday,
    assetTradesInWindow: opts.assetTradesInWindow,
  });
  if (!gate.ok) return gate;

  const thinOn = opts.skipThinBid || Boolean(risk.cash_out_skip_thin_bid);
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

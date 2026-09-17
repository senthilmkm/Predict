import { computeLean, decideLean, getKalshiEventLiveSpot, sanitizeTimeseries } from 'trading-core';
import { readWsAskBid } from './kalshiWsQuotes';

type CachedLean = {
  lean: Record<string, any>;
  at: number;
};

const cache = new Map<string, CachedLean>();
const inflight = new Map<string, Promise<Record<string, any>>>();

export function resetSharedLeanCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

export function rememberSharedLeans(
  leans: Partial<Record<string, any>>,
  at = Date.now()
): void {
  for (const [asset, lean] of Object.entries(leans)) {
    const key = String(asset || '').trim();
    if (!key || !lean) continue;
    cache.set(key, { lean: { ...lean }, at });
  }
}

export function dropSharedLeansNotIn(assets: readonly string[]): void {
  const keep = new Set(assets.map((a) => String(a || '').trim()).filter(Boolean));
  for (const key of [...cache.keys()]) {
    if (!keep.has(key)) cache.delete(key);
  }
}

export function cachedLeanTicker(asset: string): string | null {
  const ticker = String(cache.get(String(asset || '').trim())?.lean?.market_ticker || '').trim();
  return ticker || null;
}

export function cachedLeanTickers(): string[] {
  const out: string[] = [];
  for (const row of cache.values()) {
    const ticker = String(row?.lean?.market_ticker || '').trim();
    if (ticker && !out.includes(ticker)) out.push(ticker);
  }
  return out;
}

export function overlayLeanWsBook(lean: Record<string, any>): Record<string, any> {
  const next = { ...lean };
  const ws = readWsAskBid(String(next.market_ticker || ''));
  if (!ws) return next;
  if (ws.yes_ask != null) next.yes_ask = ws.yes_ask;
  if (ws.no_ask != null) next.no_ask = ws.no_ask;
  if (ws.yes_bid != null) next.yes_bid = ws.yes_bid;
  if (ws.no_bid != null) next.no_bid = ws.no_bid;
  return next;
}

const DEFAULT_WINDOW_MS = 15 * 60_000;

function refreshLeanClock(lean: Record<string, any>, now: Date): Record<string, any> {
  const next = { ...lean };
  const close = next.close_utc ? new Date(String(next.close_utc)) : null;
  if (close && Number.isFinite(close.getTime())) {
    const remaining = Math.max(0, (close.getTime() - now.getTime()) / 60000);
    next.minutes_remaining = remaining;
    next.minutes_left = Math.floor(remaining);
    if (now.getTime() >= close.getTime()) next.phase = 'ended';
  }
  let open = next.open_utc ? new Date(String(next.open_utc)) : null;
  // Older cached leans omitted open_utc — infer 15m open from close so elapsed advances.
  if ((!open || !Number.isFinite(open.getTime())) && close && Number.isFinite(close.getTime())) {
    open = new Date(close.getTime() - DEFAULT_WINDOW_MS);
    next.open_utc = open.toISOString();
  }
  if (open && Number.isFinite(open.getTime())) {
    next.minutes_elapsed = Math.max(0, Math.floor((now.getTime() - open.getTime()) / 60000));
  }
  return next;
}

export function leanFromSharedCache(asset: string, now = new Date()): Record<string, any> | null {
  const row = cache.get(String(asset || '').trim());
  if (!row?.lean?.market_ticker) return null;
  return overlayLeanWsBook(refreshLeanClock(row.lean, now));
}

export function cachedLeanNeedsRefresh(asset: string, now = new Date()): boolean {
  const row = cache.get(String(asset || '').trim());
  if (!row?.lean?.market_ticker) return true;
  const close = row.lean.close_utc ? new Date(String(row.lean.close_utc)) : null;
  if (close && Number.isFinite(close.getTime()) && now.getTime() >= close.getTime()) return true;
  return false;
}

function stampLeanDecision(lean: Record<string, any>, now: Date): Record<string, any> {
  const next = overlayLeanWsBook(refreshLeanClock(lean, now));
  const live = Number(next.live);
  const strike = Number(next.strike);
  if (Number.isFinite(live) && Number.isFinite(strike)) {
    const decided = decideLean(next.phase || 'live', live, strike, 0);
    next.decision = decided.decision;
    next.abs_gap = decided.abs_gap;
  }
  return next;
}

/** Shared 1s Home payload: live, strike, gap, book. No extra Kalshi REST. */
export function peekSharedLeansForClient(now = new Date()): Record<string, Record<string, any>> {
  const out: Record<string, Record<string, any>> = {};
  for (const asset of cache.keys()) {
    const row = cache.get(asset);
    if (!row?.lean?.market_ticker) continue;
    const lean = stampLeanDecision(row.lean, now);
    out[asset] = {
      ok: true,
      asset,
      market_ticker: lean.market_ticker,
      event_ticker: lean.event_ticker,
      live: lean.live,
      strike: lean.strike,
      abs_gap: lean.abs_gap,
      decision: lean.decision,
      phase: lean.phase,
      yes_ask: lean.yes_ask,
      no_ask: lean.no_ask,
      yes_bid: lean.yes_bid,
      no_bid: lean.no_bid,
      minutes_left: lean.minutes_left,
      minutes_elapsed: lean.minutes_elapsed,
      minutes_remaining: lean.minutes_remaining,
      open_utc: lean.open_utc,
      close_utc: lean.close_utc,
      price_source: lean.price_source,
    };
  }
  return out;
}

/**
 * 1s lean for Cushions-On coins: one live_data call per coin per second (cached),
 * WS ask/bid overlay, clock refresh. Full /events computeLean only on miss or window end.
 */
export async function refreshCushionLeanSignals(
  assets: readonly string[],
  now = new Date(),
  deps?: {
    computeLeanFn?: typeof computeLean;
    getLiveSpotFn?: typeof getKalshiEventLiveSpot;
  }
): Promise<Partial<Record<string, any>>> {
  const leans: Partial<Record<string, any>> = {};
  const compute = deps?.computeLeanFn || computeLean;
  const liveSpot = deps?.getLiveSpotFn || getKalshiEventLiveSpot;
  await Promise.all(
    [...new Set(assets.map((a) => String(a || '').trim()).filter(Boolean))].map(async (asset) => {
      try {
        if (cachedLeanNeedsRefresh(asset, now)) {
          const lean = await computeLeanOnce(asset, () => compute(asset as any, 0.0, fetch, now));
          const next = stampLeanDecision(lean as Record<string, any>, now);
          rememberSharedLeans({ [asset]: next }, now.getTime());
          leans[asset] = next;
          return;
        }
        const row = cache.get(asset);
        if (!row?.lean) return;
        const next = { ...row.lean };
        const eventTicker = String(next.event_ticker || '').trim();
        if (eventTicker) {
          const spot = await liveSpot(eventTicker, fetch);
          if (spot?.price != null && Number.isFinite(Number(spot.price))) {
            next.live = Number(spot.price);
            const series = sanitizeTimeseries(spot.timeseries);
            if (series) next.timeseries = series;
            next.price_source = 'predict_chart';
          }
        }
        const stamped = stampLeanDecision(next, now);
        rememberSharedLeans({ [asset]: stamped }, now.getTime());
        leans[asset] = stamped;
      } catch {
        const cached = leanFromSharedCache(asset, now);
        if (cached) leans[asset] = cached;
      }
    })
  );
  return leans;
}

/** One in-flight full computeLean per coin so 10s tick and 1s fallback cannot double-hit Kalshi. */
export function computeLeanOnce<T>(asset: string, run: () => Promise<T>): Promise<T> {
  const key = String(asset || '').trim();
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const pending = Promise.resolve()
    .then(run)
    .finally(() => {
      inflight.delete(key);
    }) as Promise<T>;
  inflight.set(key, pending as Promise<Record<string, any>>);
  return pending;
}

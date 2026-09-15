import type { CashOutOrderBook } from '../../../../packages/trading-core/src/cashOut';

export type WsAskQuote = {
  yes_ask?: number;
  no_ask?: number;
  yes_bid?: number;
  no_bid?: number;
};

export const KALSHI_WS_STALE_MS = 2500;
export const KALSHI_WS_TICKER_CAP = 40;

export type WsBookSource = 'ws' | 'rest_fallback';

export type TickerBook = {
  seq: number;
  gen: number;
  ready: boolean;
  updatedAtMs: number;
  source: WsBookSource;
  /** Price in integer cents → contract size. */
  yes: Map<number, number>;
  no: Map<number, number>;
};

export function emptyTickerBook(nowMs = Date.now()): TickerBook {
  return {
    seq: 0,
    gen: 1,
    ready: false,
    updatedAtMs: nowMs,
    source: 'ws',
    yes: new Map(),
    no: new Map(),
  };
}

/** Kalshi dollars `"0.0800"` or cents `8`. */
export function wsPriceToCents(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  const usd = n > 1 + 1e-9 ? n / 100 : n;
  const cents = Math.round(usd * 100);
  if (cents < 0 || cents > 99) return null;
  return cents;
}

export function wsSizeFp(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n);
}

function cloneLevels(src: Map<number, number>): Map<number, number> {
  return new Map(src);
}

function applyLevels(raw: unknown): Map<number, number> {
  const out = new Map<number, number>();
  if (!Array.isArray(raw)) return out;
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const cents = wsPriceToCents(row[0]);
    const size = wsSizeFp(row[1]);
    if (cents == null) continue;
    if (size <= 0) continue;
    out.set(cents, size);
  }
  return out;
}

export function applyOrderbookSnapshot(book: TickerBook, seq: unknown, msg: Record<string, unknown>, nowMs: number): TickerBook {
  const n = Math.floor(Number(seq));
  book.seq = Number.isFinite(n) && n > 0 ? n : 1;
  book.ready = true;
  book.updatedAtMs = nowMs;
  book.source = 'ws';
  book.yes = applyLevels(msg.yes_dollars_fp ?? msg.yes);
  book.no = applyLevels(msg.no_dollars_fp ?? msg.no);
  return book;
}

/** false = seq gap or not ready; caller must fail closed / resnapshot. */
export function applyOrderbookDelta(book: TickerBook, seq: unknown, msg: Record<string, unknown>, nowMs: number): boolean {
  if (!book.ready) return false;
  const n = Math.floor(Number(seq));
  if (!Number.isFinite(n) || n <= 0) return false;
  if (n !== book.seq + 1) return false;
  const side = String(msg.side || '').toLowerCase();
  const map = side === 'no' ? book.no : side === 'yes' ? book.yes : null;
  if (!map) return false;
  const cents = wsPriceToCents(msg.price_dollars ?? msg.price);
  if (cents == null) return false;
  const next = (map.get(cents) || 0) + wsSizeFp(msg.delta_fp ?? msg.delta);
  if (next <= 0) map.delete(cents);
  else map.set(cents, next);
  book.seq = n;
  book.updatedAtMs = nowMs;
  book.source = 'ws';
  return true;
}

export function markBookUnready(book: TickerBook, nowMs = Date.now()): void {
  book.ready = false;
  book.gen += 1;
  book.updatedAtMs = nowMs;
}

function bestBidCents(levels: Map<number, number>): { cents: number; size: number } | null {
  let best: number | null = null;
  let size = 0;
  for (const [cents, sz] of levels) {
    if (!(sz > 0)) continue;
    if (best == null || cents > best) {
      best = cents;
      size = sz;
    } else if (cents === best) size += sz;
  }
  return best == null ? null : { cents: best, size };
}

export function bookIsFresh(book: TickerBook | undefined, nowMs: number, staleMs = KALSHI_WS_STALE_MS): boolean {
  if (!book || !book.ready) return false;
  return nowMs - book.updatedAtMs <= staleMs;
}

function complementAsk(bid: { cents: number; size: number } | null): { cents: number; size: number } | null {
  if (!bid) return null;
  const cents = 100 - bid.cents;
  if (cents < 1 || cents > 99) return null;
  return { cents, size: bid.size };
}

/** Kalshi yes/no maps are bids. Ask is 1 − opposite best bid. Stale/unready → null (REST). */
/** Kalshi yes/no maps are bids. Ask is 1 − opposite best bid. Stale/unready → null (REST). */
export function readAskBidFromBook(book: TickerBook | undefined, nowMs: number): WsAskQuote | null {
  if (!bookIsFresh(book, nowMs) || !book) return null;
  const yesBid = bestBidCents(book.yes);
  const noBid = bestBidCents(book.no);
  const yesAsk = complementAsk(noBid);
  const noAsk = complementAsk(yesBid);
  if (!yesAsk && !noAsk && !yesBid && !noBid) return null;
  const dollars = (row: { cents: number } | null) =>
    row ? Math.round(row.cents) / 100 : undefined;
  return {
    yes_ask: dollars(yesAsk),
    no_ask: dollars(noAsk),
    yes_bid: dollars(yesBid),
    no_bid: dollars(noBid),
  };
}

export function readBestBidSizeFromBook(
  book: TickerBook | undefined,
  side: 'YES' | 'NO',
  nowMs: number
): number | null {
  if (!bookIsFresh(book, nowMs) || !book) return null;
  const row = bestBidCents(side === 'NO' ? book.no : book.yes);
  if (!row) return 0;
  return row.size;
}

export function bookToCashOutOrderBook(book: TickerBook): CashOutOrderBook {
  const toLevels = (m: Map<number, number>) =>
    [...m.entries()]
      .filter(([, size]) => size > 0)
      .map(([cents, size]) => ({ priceUsd: cents / 100, size }))
      .sort((a, b) => b.priceUsd - a.priceUsd);
  return { yes: toLevels(book.yes), no: toLevels(book.no) };
}

export function cloneTickerBook(book: TickerBook): TickerBook {
  return {
    seq: book.seq,
    gen: book.gen,
    ready: book.ready,
    updatedAtMs: book.updatedAtMs,
    source: book.source,
    yes: cloneLevels(book.yes),
    no: cloneLevels(book.no),
  };
}

export function capTickers(tickers: string[], cap = KALSHI_WS_TICKER_CAP): string[] {
  const uniq = [...new Set(tickers.map((t) => String(t || '').trim()).filter(Boolean))];
  return uniq.slice(0, Math.max(1, cap));
}

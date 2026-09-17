import { ticketUsd } from './cashOut';

export type IocLiveAsks = {
  yes_ask?: number | null;
  no_ask?: number | null;
};

const ONE_CENT = 0.01;

function snapCent(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Live ask for this buy. Null = no book; keep the quoted pay. */
export function liveAskForDecision(decision: unknown, quotes?: IocLiveAsks | null): number | null {
  const held = String(decision || '').toUpperCase() === 'NO' ? 'NO' : 'YES';
  return held === 'NO' ? ticketUsd(quotes?.no_ask) : ticketUsd(quotes?.yes_ask);
}

/**
 * Requote an IOC buy at send time.
 * If the live ask walked 1¢ and still fits max pay, bump.
 * If it walked further or above max, skip — do not fire a miss.
 * Pair lock: allowBump false so a walked ask sits out instead of locking worse.
 */
export function refreshIocPayForPlace(opts: {
  decision?: unknown;
  quotedPayUsd?: unknown;
  maxPayUsd?: unknown;
  quotes?: IocLiveAsks | null;
  allowBump?: boolean;
}):
  | { ok: true; payUsd: number; bumped: boolean }
  | { ok: false; skip_reason: 'ask_moved' } {
  const quoted = ticketUsd(opts.quotedPayUsd);
  const liveAsk = liveAskForDecision(opts.decision, opts.quotes);
  const maxPay = ticketUsd(opts.maxPayUsd) ?? 0.99;
  if (quoted == null) {
    if (liveAsk == null || liveAsk > maxPay + 1e-9) return { ok: false, skip_reason: 'ask_moved' };
    return { ok: true, payUsd: liveAsk, bumped: false };
  }
  if (liveAsk == null) return { ok: true, payUsd: quoted, bumped: false };
  if (liveAsk <= quoted + 1e-9) return { ok: true, payUsd: quoted, bumped: false };
  const bumpedPay = snapCent(liveAsk);
  const allowBump = opts.allowBump === true;
  const withinCent = bumpedPay <= quoted + ONE_CENT + 1e-9;
  if (!allowBump || !withinCent || bumpedPay > maxPay + 1e-9) {
    return { ok: false, skip_reason: 'ask_moved' };
  }
  return { ok: true, payUsd: bumpedPay, bumped: true };
}

/** YES = bid@pay; NO = ask@pay (V2 events/orders — same debit as Cap/Pair). */
export function iocKalshiPrice(opts: {
  decision?: unknown;
  payUsd: number;
  existingSide?: unknown;
  existingPrice?: unknown;
  existingPayUsd?: unknown;
}): { side: 'bid' | 'ask'; price: string } {
  const pay = snapCent(opts.payUsd);
  const yes = String(opts.decision || '').toUpperCase() !== 'NO';
  if (yes) return { side: 'bid', price: pay.toFixed(2) };
  return { side: 'ask', price: pay.toFixed(2) };
}

/**
 * Home Buy limit at send: live ask + chase, capped by max entry ask.
 * Prefer this over a stale gate pay so the IOC hits the book ASAP at the right ticket.
 */
export function homeBuyPayFromLiveAsk(opts: {
  liveAskUsd?: unknown;
  chaseUsd?: unknown;
  maxEntryAskUsd?: unknown;
}):
  | { ok: true; payUsd: number }
  | { ok: false; skip_reason: 'ask_unavailable' | 'ask_moved' } {
  const ask = ticketUsd(opts.liveAskUsd);
  if (ask == null || !(ask > 0)) return { ok: false, skip_reason: 'ask_unavailable' };
  const chase = Math.max(0, Math.min(0.05, Number(opts.chaseUsd) || 0));
  const maxEntry = ticketUsd(opts.maxEntryAskUsd) ?? 0.99;
  if (ask > maxEntry + 1e-9) return { ok: false, skip_reason: 'ask_moved' };
  const pay = Math.min(0.99, maxEntry, snapCent(ask + chase));
  return { ok: true, payUsd: pay };
}

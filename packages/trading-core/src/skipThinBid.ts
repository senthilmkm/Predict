export type ThinBidPath = 'cash_out' | 'gold_fade' | 'twap_lock' | 'last_minute';

const PATH_FLAG: Record<ThinBidPath, 'cash_out_skip_thin_bid' | 'gold_fade_skip_thin_bid' | 'twap_lock_skip_thin_bid' | 'last_minute_skip_thin_bid'> = {
  cash_out: 'cash_out_skip_thin_bid',
  gold_fade: 'gold_fade_skip_thin_bid',
  twap_lock: 'twap_lock_skip_thin_bid',
  last_minute: 'last_minute_skip_thin_bid',
};

export type ThinBidRisk = {
  cash_out_skip_thin_bid?: boolean;
  gold_fade_skip_thin_bid?: boolean;
  twap_lock_skip_thin_bid?: boolean;
  last_minute_skip_thin_bid?: boolean;
};

/** Old docs only had Cash out’s switch. Missing path flags inherit that On. */
export function inheritSkipThinBid(explicit: unknown, cashOutOn: boolean): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  return cashOutOn;
}

/**
 * Path-owned Skip thin bid.
 * Explicit `override` wins (worker passes the resolved flag).
 * Missing path flag falls back to `cash_out_skip_thin_bid` so old Cloud docs keep working.
 */
export function resolveSkipThinBid(
  risk: ThinBidRisk | null | undefined,
  path: ThinBidPath,
  override?: boolean
): boolean {
  if (override === true) return true;
  if (override === false) return false;
  const v = risk?.[PATH_FLAG[path]];
  if (typeof v === 'boolean') return v;
  return risk?.cash_out_skip_thin_bid === true;
}

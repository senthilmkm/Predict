import { normalizeCashOutBidCheckSeconds } from '../../../../packages/trading-core/src/cashOut';

export interface FeatureFlags {
  /** Home Last signals Buy YES/NO and Sell. Cloud place-now path. */
  lastSignalsManualTrade: boolean;
  /** Cash out Auto path. Default Off — Admin must enable. */
  cashOut: boolean;
  /** Seconds between bid checks on an open Cash out lot. Default 3. Range 2–10. */
  cashOutBidCheckSeconds: number;
  /** Gold fade Auto path. Default Off — Admin must enable. */
  goldFade: boolean;
  /** Seconds between bid checks on an open Gold fade lot. Default 3. Range 2–10. */
  goldFadeBidCheckSeconds: number;
  /** TWAP lock Auto path. Default Off — Admin must enable. */
  twapLock: boolean;
  /** Last-minute Auto path. Default Off — Admin must enable. */
  lastMinute: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  lastSignalsManualTrade: true,
  cashOut: false,
  cashOutBidCheckSeconds: 3,
  goldFade: false,
  goldFadeBidCheckSeconds: 3,
  twapLock: false,
  lastMinute: false,
};

export function normalizeFeatureFlags(raw?: Partial<FeatureFlags> | null): FeatureFlags {
  return {
    lastSignalsManualTrade: raw?.lastSignalsManualTrade === false ? false : true,
    cashOut: raw?.cashOut === true,
    cashOutBidCheckSeconds: normalizeCashOutBidCheckSeconds(raw?.cashOutBidCheckSeconds),
    goldFade: raw?.goldFade === true,
    goldFadeBidCheckSeconds: normalizeCashOutBidCheckSeconds(raw?.goldFadeBidCheckSeconds),
    twapLock: raw?.twapLock === true,
    lastMinute: raw?.lastMinute === true,
  };
}

export function mergeFeatureFlags(
  existing: Partial<FeatureFlags> | undefined,
  patch: Partial<FeatureFlags> | undefined
): FeatureFlags {
  const base = normalizeFeatureFlags(existing);
  if (!patch) return base;
  return normalizeFeatureFlags({ ...base, ...patch });
}

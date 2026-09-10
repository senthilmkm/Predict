import { normalizeCashOutBidCheckSeconds } from '../../../../packages/trading-core/src/cashOut';

export interface FeatureFlags {
  /** Home Last signals Buy YES/NO and Sell. Cloud place-now path. */
  lastSignalsManualTrade: boolean;
  /** Cash out Auto path. Default Off — Admin must enable. */
  cashOut: boolean;
  /** Seconds between bid checks on an open Cash out lot. Default 3. Range 2–10. */
  cashOutBidCheckSeconds: number;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  lastSignalsManualTrade: true,
  cashOut: false,
  cashOutBidCheckSeconds: 3,
};

export function normalizeFeatureFlags(raw?: Partial<FeatureFlags> | null): FeatureFlags {
  return {
    lastSignalsManualTrade: raw?.lastSignalsManualTrade === false ? false : true,
    cashOut: raw?.cashOut === true,
    cashOutBidCheckSeconds: normalizeCashOutBidCheckSeconds(raw?.cashOutBidCheckSeconds),
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

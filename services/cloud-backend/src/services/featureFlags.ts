export interface FeatureFlags {
  /** Home Last signals Buy YES/NO and Sell. Cloud place-now path. */
  lastSignalsManualTrade: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  lastSignalsManualTrade: true,
};

export function normalizeFeatureFlags(raw?: Partial<FeatureFlags> | null): FeatureFlags {
  return {
    lastSignalsManualTrade: raw?.lastSignalsManualTrade === false ? false : true,
  };
}

export function mergeFeatureFlags(
  existing: FeatureFlags | undefined,
  patch: Partial<FeatureFlags> | undefined
): FeatureFlags {
  const base = normalizeFeatureFlags(existing);
  if (!patch) return base;
  return normalizeFeatureFlags({ ...base, ...patch });
}

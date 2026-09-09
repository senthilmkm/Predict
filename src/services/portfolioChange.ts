/** Point-in-time Predictions total (cash + open marks), used for Kalshi-style 24h change. */
export type PortfolioSample = {
  at: string;
  predictionsUsd: number;
  cashUsd: number | null;
};

export const PORTFOLIO_RETAIN_MS = 36 * 60 * 60 * 1000;
/** Hard cap so AsyncStorage stays small even if the clock jumps. */
export const PORTFOLIO_MAX_SAMPLES = 800;
export const PORTFOLIO_SAMPLE_INTERVAL_MS = 2 * 60 * 1000;
export const PORTFOLIO_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** Refuse a baseline that is too far from T-24h — never invent a 24h number. */
export const PORTFOLIO_BASELINE_MAX_GAP_MS = 90 * 60 * 1000;

function sampleTimeMs(s: PortfolioSample): number {
  return new Date(s.at).getTime();
}

export function prunePortfolioSamples(samples: PortfolioSample[], nowMs = Date.now()): PortfolioSample[] {
  const cutoff = nowMs - PORTFOLIO_RETAIN_MS;
  const kept = samples.filter((s) => {
    const t = sampleTimeMs(s);
    return Number.isFinite(t) && t >= cutoff && Number.isFinite(s.predictionsUsd);
  });
  if (kept.length <= PORTFOLIO_MAX_SAMPLES) return kept;
  return kept
    .slice()
    .sort((a, b) => sampleTimeMs(a) - sampleTimeMs(b))
    .slice(-PORTFOLIO_MAX_SAMPLES);
}

export function recordPortfolioSample(
  samples: PortfolioSample[],
  next: PortfolioSample,
  nowMs = Date.now()
): PortfolioSample[] {
  const t = sampleTimeMs(next);
  if (!Number.isFinite(t) || !Number.isFinite(next.predictionsUsd)) {
    return prunePortfolioSamples(samples, nowMs);
  }
  const last = samples[samples.length - 1];
  const lastT = last ? sampleTimeMs(last) : NaN;
  const valueChanged = last != null && last.predictionsUsd !== next.predictionsUsd;
  if (last && Number.isFinite(lastT) && t - lastT < PORTFOLIO_SAMPLE_INTERVAL_MS && !valueChanged) {
    return prunePortfolioSamples(samples, nowMs);
  }
  return prunePortfolioSamples([...samples, next], nowMs);
}

/** Latest sample at or before target; else earliest after. Null if none is close enough. */
export function findBaselineSample(
  samples: PortfolioSample[],
  targetMs: number,
  maxGapMs = PORTFOLIO_BASELINE_MAX_GAP_MS
): PortfolioSample | null {
  let before: PortfolioSample | null = null;
  let after: PortfolioSample | null = null;
  for (const s of samples) {
    const t = sampleTimeMs(s);
    if (!Number.isFinite(t)) continue;
    if (t <= targetMs) {
      if (!before || t > sampleTimeMs(before)) before = s;
    } else if (!after || t < sampleTimeMs(after)) {
      after = s;
    }
  }
  const pick = before ?? after;
  if (!pick) return null;
  if (Math.abs(sampleTimeMs(pick) - targetMs) > maxGapMs) return null;
  return pick;
}

export type PortfolioChange = {
  usd: number;
  pct: number | null;
  windowMs: number;
  complete: boolean;
};

function oldestUsableSample(samples: PortfolioSample[]): PortfolioSample | null {
  let oldest: PortfolioSample | null = null;
  for (const s of samples) {
    const t = sampleTimeMs(s);
    if (!Number.isFinite(t)) continue;
    if (!oldest || t < sampleTimeMs(oldest)) oldest = s;
  }
  return oldest;
}

function changeFromBaseline(
  baseline: PortfolioSample,
  currentUsd: number,
  nowMs: number,
  complete: boolean
): PortfolioChange {
  const usd = Math.round((currentUsd - baseline.predictionsUsd) * 100) / 100;
  const pct =
    baseline.predictionsUsd > 0 ? Math.round((usd / baseline.predictionsUsd) * 10000) / 100 : null;
  return { usd, pct, windowMs: Math.max(0, nowMs - sampleTimeMs(baseline)), complete };
}

export function computeChange24h(
  samples: PortfolioSample[],
  currentUsd: number | null,
  nowMs = Date.now()
): PortfolioChange | null {
  if (currentUsd == null || !Number.isFinite(currentUsd)) return null;
  const near = findBaselineSample(samples, nowMs - PORTFOLIO_LOOKBACK_MS);
  if (near) return changeFromBaseline(near, currentUsd, nowMs, true);
  const oldest = oldestUsableSample(samples);
  if (!oldest) return null;
  if (nowMs - sampleTimeMs(oldest) < PORTFOLIO_SAMPLE_INTERVAL_MS) return null;
  return changeFromBaseline(oldest, currentUsd, nowMs, false);
}

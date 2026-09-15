import { getSystemConfig } from './firestore';
import { normalizeFeatureFlags, type FeatureFlags } from './featureFlags';
import { setKalshiWsFillsEnabled } from './kalshiWsFills';
import { closeKalshiWsQuotes, pumpKalshiWsQuotes, type KalshiWsQuotesHealth } from './kalshiWsQuotes';
import { getPlatformKalshiSecret } from './secretManager';

const FLAGS_TTL_MS = 5000;

let flagsCache: { at: number; flags: FeatureFlags } | null = null;

export function resetKalshiWsPumpForTests(): void {
  flagsCache = null;
}

async function featureFlagsNow(): Promise<FeatureFlags> {
  if (flagsCache && Date.now() - flagsCache.at < FLAGS_TTL_MS) return flagsCache.flags;
  const sys = await getSystemConfig();
  const flags = normalizeFeatureFlags(sys?.featureFlags);
  flagsCache = { at: Date.now(), flags };
  return flags;
}

/**
 * Always-on quotes writer. Trade `/tick` only reads the reconstructed book.
 * Flag Off or missing platform key → close socket and keep REST.
 */
export async function pumpKalshiWsQuotesFromConfig(tickers: string[]): Promise<KalshiWsQuotesHealth> {
  let flags: FeatureFlags;
  try {
    flags = await featureFlagsNow();
  } catch {
    setKalshiWsFillsEnabled(false);
    await closeKalshiWsQuotes();
    return {
      status: 'down',
      tickers: 0,
      lastError: 'flags_unavailable',
      lastSeqAgeMs: null,
      fallbackReason: 'flags_unavailable',
    };
  }
  setKalshiWsFillsEnabled(flags.kalshiWsFills);
  if (!flags.kalshiWsQuotes) {
    return pumpKalshiWsQuotes({ enabled: false, tickers: [] });
  }
  const secret = await getPlatformKalshiSecret();
  return pumpKalshiWsQuotes({
    enabled: true,
    tickers,
    keyId: secret?.keyId,
    privateKeyPem: secret?.privateKeyPem,
  });
}

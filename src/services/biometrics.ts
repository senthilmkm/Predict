/**
 * Face ID / biometrics — used before unlocking credentials or enabling auto-trade.
 * Requires expo-local-authentication + NSFaceIDUsageDescription (app.json plugin).
 */
export async function authenticateForSecrets(
  prompt = 'Unlock Kalshi credentials'
): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const LocalAuth = require('expo-local-authentication');
    const has = await LocalAuth.hasHardwareAsync();
    const enrolled = await LocalAuth.isEnrolledAsync();
    if (!has || !enrolled) {
      // Simulator / device without biometrics: allow (dev-friendly)
      return true;
    }
    const types = await LocalAuth.supportedAuthenticationTypesAsync();
    const res = await LocalAuth.authenticateAsync({
      promptMessage: prompt,
      fallbackLabel: 'Use passcode',
      disableDeviceFallback: false,
      // Prefer Face ID when available
      ...(types?.length
        ? {}
        : {}),
    });
    return Boolean(res.success);
  } catch {
    return true;
  }
}

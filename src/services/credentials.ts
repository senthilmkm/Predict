import { getSecureStore } from '../platform/storage';
import { authenticateForSecrets as faceIdGate } from './biometrics';

const KEY_ID = 'foresight.kalshi.key_id';
const KEY_PEM = 'foresight.kalshi.pem';
const KEY_ENV = 'foresight.kalshi.env';

export interface KalshiCredentials {
  keyId: string;
  privateKeyPem: string;
  env: 'production' | 'demo';
}

export async function saveCredentials(creds: KalshiCredentials): Promise<void> {
  const s = getSecureStore();
  await s.setItem(KEY_ID, creds.keyId.trim());
  await s.setItem(KEY_PEM, creds.privateKeyPem.trim());
  await s.setItem(KEY_ENV, creds.env);
}

export async function loadCredentials(): Promise<KalshiCredentials | null> {
  const s = getSecureStore();
  const keyId = await s.getItem(KEY_ID);
  const pem = await s.getItem(KEY_PEM);
  const env = ((await s.getItem(KEY_ENV)) || 'production') as 'production' | 'demo';
  if (!keyId || !pem) return null;
  return { keyId, privateKeyPem: pem, env };
}

export async function clearCredentials(): Promise<void> {
  const s = getSecureStore();
  await s.deleteItem?.(KEY_ID);
  await s.deleteItem?.(KEY_PEM);
  await s.deleteItem?.(KEY_ENV);
}

export async function hasCredentials(): Promise<boolean> {
  return (await loadCredentials()) != null;
}

/** Face ID / biometrics gate — allow when hardware missing (simulator / tests). */
export async function authenticateForSecrets(
  prompt = 'Unlock Kalshi credentials'
): Promise<boolean> {
  return faceIdGate(prompt);
}

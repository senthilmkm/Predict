import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export interface UserKalshiSecret {
  keyId: string;
  privateKeyPem: string;
}

// In-memory fallback for local dry-run tests when GCP Secret Manager is offline
const localSecretStore = new Map<string, UserKalshiSecret>();
const USER_SECRET_TTL_MS = 60_000;
const userSecretCache = new Map<string, { secret: UserKalshiSecret; at: number }>();

let client: SecretManagerServiceClient | null = null;
function getClient(): SecretManagerServiceClient | null {
  if (process.env.NODE_ENV === 'test' || process.env.USE_LOCAL_SECRETS === 'true') {
    return null;
  }
  if (!client) {
    try {
      client = new SecretManagerServiceClient({ projectId: 'predict-trading-0904' });
    } catch (e: any) {
      console.error('[SECRET_MANAGER_CLIENT_INIT_ERROR]', e?.message || e);
      client = null;
    }
  }
  return client;
}

function secretName(projectId: string, userId: string): string {
  // Sanitize userId for GCP secret ID format
  const sanitizedId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `projects/${projectId}/secrets/predict-user-${sanitizedId}-kalshi-key`;
}

export async function saveUserSecret(
  userId: string,
  keyId: string,
  privateKeyPem: string
): Promise<void> {
  const sm = getClient();
  const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'predict-trading-0904';

  console.log('[SECRET_MANAGER_SAVE_ATTEMPT]', { userId, projectId, clientReady: Boolean(sm) });

  if (!sm) {
    console.warn('[SECRET_MANAGER_FALLBACK_MEMORY]', { userId });
    localSecretStore.set(userId, { keyId, privateKeyPem });
    invalidateUserSecretCache(userId);
    userSecretCache.set(userId, { secret: { keyId, privateKeyPem }, at: Date.now() });
    return;
  }

  const name = secretName(projectId, userId);
  const secretId = `predict-user-${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}-kalshi-key`;

  // Create secret if it does not exist
  try {
    console.log('[SECRET_MANAGER_CREATING]', { secretId, parent: `projects/${projectId}` });
    await sm.createSecret({
      parent: `projects/${projectId}`,
      secretId,
      secret: {
        replication: {
          automatic: {},
        },
      },
    });
    console.log('[SECRET_MANAGER_CREATED_SUCCESS]', { secretId });
  } catch (err: any) {
    if (!err?.message?.includes('already exists')) {
      console.warn('[SECRET_MANAGER_CREATE_NOTE]', err?.message || err);
    } else {
      console.log('[SECRET_MANAGER_EXISTS]', { secretId });
    }
  }

  // Add secret version payload
  const payload = JSON.stringify({ keyId, privateKeyPem });
  console.log('[SECRET_MANAGER_ADDING_VERSION]', { parent: name });
  const [v] = await sm.addSecretVersion({
    parent: name,
    payload: {
      data: Buffer.from(payload, 'utf8'),
    },
  });
  console.log('[SECRET_MANAGER_VERSION_ADDED]', { version: v.name });
  invalidateUserSecretCache(userId);
  userSecretCache.set(userId, { secret: { keyId, privateKeyPem }, at: Date.now() });
}

export async function getUserSecret(userId: string): Promise<UserKalshiSecret | null> {
  const id = String(userId || '').trim();
  if (!id) return null;
  const hit = userSecretCache.get(id);
  if (hit && Date.now() - hit.at < USER_SECRET_TTL_MS) {
    return hit.secret;
  }

  const sm = getClient();
  const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'predict-trading-0904';

  if (!sm) {
    const local = localSecretStore.get(id) || null;
    if (local) userSecretCache.set(id, { secret: local, at: Date.now() });
    return local;
  }

  try {
    const name = `${secretName(projectId, id)}/versions/latest`;
    const [version] = await sm.accessSecretVersion({ name });
    const payloadStr = version.payload?.data?.toString();
    if (!payloadStr) return null;
    const secret = JSON.parse(payloadStr) as UserKalshiSecret;
    userSecretCache.set(id, { secret, at: Date.now() });
    return secret;
  } catch {
    const local = localSecretStore.get(id) || null;
    if (local) userSecretCache.set(id, { secret: local, at: Date.now() });
    return local;
  }
}

/** Drop cached PEM after a key rotate / save so the next place uses the new secret. */
export function invalidateUserSecretCache(userId?: string): void {
  if (userId == null || userId === '') {
    userSecretCache.clear();
    return;
  }
  userSecretCache.delete(String(userId).trim());
}

export const CFB_API_KEY_SECRET_ID = 'predict-cfb-api-key';

export type CfbApiCredentials = {
  username?: string;
  key: string;
};

let cfbCredsCache: { at: number; value: CfbApiCredentials | null } | null = null;
const CFB_CREDS_TTL_MS = 60_000;

function projectId(): string {
  return process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'predict-trading-0904';
}

function parseCfbSecretPayload(raw: string): CfbApiCredentials | null {
  const text = String(raw || '').trim();
  if (!text || text === 'UNSET') return null;
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const key = String(obj.key ?? obj.apiKey ?? obj.api_key ?? obj.password ?? '').trim();
    const username = String(obj.username ?? obj.user ?? obj.id ?? '').trim();
    if (!key) return null;
    return username ? { username, key } : { key };
  } catch {
    const colon = text.indexOf(':');
    if (colon > 0 && colon < text.length - 1) {
      return { username: text.slice(0, colon).trim(), key: text.slice(colon + 1).trim() };
    }
    return { key: text };
  }
}

/** Env CFB_API_KEY wins. Else Secret Manager predict-cfb-api-key. Cached 60s. */
export async function getCfbApiCredentials(): Promise<CfbApiCredentials | null> {
  const fromEnv = parseCfbSecretPayload(String(process.env.CFB_API_KEY || ''));
  if (fromEnv) return fromEnv;
  if (cfbCredsCache && Date.now() - cfbCredsCache.at < CFB_CREDS_TTL_MS) {
    return cfbCredsCache.value;
  }
  const sm = getClient();
  if (!sm) {
    cfbCredsCache = { at: Date.now(), value: null };
    return null;
  }
  try {
    const name = `projects/${projectId()}/secrets/${CFB_API_KEY_SECRET_ID}/versions/latest`;
    const [version] = await sm.accessSecretVersion({ name });
    const payloadStr = version.payload?.data?.toString() || '';
    const parsed = parseCfbSecretPayload(payloadStr);
    cfbCredsCache = { at: Date.now(), value: parsed };
    return parsed;
  } catch {
    cfbCredsCache = { at: Date.now(), value: null };
    return null;
  }
}

export function resetCfbApiCredentialsCacheForTests(): void {
  cfbCredsCache = null;
}

export const PLATFORM_KALSHI_SECRET_ID = 'predict-platform-kalshi-key';

let platformKalshiCache: { at: number; value: UserKalshiSecret | null } | null = null;
const PLATFORM_KALSHI_TTL_MS = 60_000;

function parsePlatformKalshiPayload(raw: string): UserKalshiSecret | null {
  const text = String(raw || '').trim();
  if (!text || text === 'UNSET') return null;
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const keyId = String(obj.keyId ?? obj.key_id ?? obj.id ?? '').trim();
    const privateKeyPem = String(obj.privateKeyPem ?? obj.private_key_pem ?? obj.pem ?? '').trim();
    if (!keyId || !privateKeyPem.includes('PRIVATE KEY')) return null;
    return { keyId, privateKeyPem };
  } catch {
    return null;
  }
}

/** Env wins. Else Secret Manager predict-platform-kalshi-key. Cached 60s. */
export async function getPlatformKalshiSecret(): Promise<UserKalshiSecret | null> {
  const envId = String(process.env.KALSHI_PLATFORM_KEY_ID || '').trim();
  const envPem = String(process.env.KALSHI_PLATFORM_PEM || '').trim();
  if (envId && envPem.includes('PRIVATE KEY')) return { keyId: envId, privateKeyPem: envPem };
  if (platformKalshiCache && Date.now() - platformKalshiCache.at < PLATFORM_KALSHI_TTL_MS) {
    return platformKalshiCache.value;
  }
  const sm = getClient();
  if (!sm) {
    platformKalshiCache = { at: Date.now(), value: localSecretStore.get('platform') || null };
    return platformKalshiCache.value;
  }
  try {
    const name = `projects/${projectId()}/secrets/${PLATFORM_KALSHI_SECRET_ID}/versions/latest`;
    const [version] = await sm.accessSecretVersion({ name });
    const parsed = parsePlatformKalshiPayload(version.payload?.data?.toString() || '');
    platformKalshiCache = { at: Date.now(), value: parsed };
    return parsed;
  } catch {
    platformKalshiCache = { at: Date.now(), value: null };
    return null;
  }
}

export function resetPlatformKalshiSecretCacheForTests(): void {
  platformKalshiCache = null;
}

export { parseCfbSecretPayload, parsePlatformKalshiPayload };

export async function deleteUserSecret(userId: string): Promise<void> {
  localSecretStore.delete(userId);

  const sm = getClient();
  const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'predict-trading-0904';

  if (!sm) return;

  try {
    const name = secretName(projectId, userId);
    await sm.deleteSecret({ name });
  } catch {
    /* ignore if secret already deleted */
  }
}

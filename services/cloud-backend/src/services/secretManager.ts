import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export interface UserKalshiSecret {
  keyId: string;
  privateKeyPem: string;
}

// In-memory fallback for local dry-run tests when GCP Secret Manager is offline
const localSecretStore = new Map<string, UserKalshiSecret>();

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
}

export async function getUserSecret(userId: string): Promise<UserKalshiSecret | null> {
  const sm = getClient();
  const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'predict-trading-0904';

  if (!sm) {
    return localSecretStore.get(userId) || null;
  }

  try {
    const name = `${secretName(projectId, userId)}/versions/latest`;
    const [version] = await sm.accessSecretVersion({ name });
    const payloadStr = version.payload?.data?.toString();
    if (!payloadStr) return null;
    return JSON.parse(payloadStr) as UserKalshiSecret;
  } catch {
    return localSecretStore.get(userId) || null;
  }
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

export { parseCfbSecretPayload };

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

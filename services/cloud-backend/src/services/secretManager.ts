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

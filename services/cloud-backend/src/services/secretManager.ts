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
      client = new SecretManagerServiceClient();
    } catch {
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
  const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'predict-autotrade-prod';

  if (!sm) {
    localSecretStore.set(userId, { keyId, privateKeyPem });
    return;
  }

  const name = secretName(projectId, userId);
  const secretId = `predict-user-${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}-kalshi-key`;

  // Create secret if it does not exist
  try {
    await sm.createSecret({
      parent: `projects/${projectId}`,
      secretId,
      secret: {
        replication: {
          automatic: {},
        },
      },
    });
  } catch (err: any) {
    if (!err?.message?.includes('already exists')) {
      // Fallback to local store if GCP API call fails
      localSecretStore.set(userId, { keyId, privateKeyPem });
      return;
    }
  }

  // Add secret version payload
  const payload = JSON.stringify({ keyId, privateKeyPem });
  await sm.addSecretVersion({
    parent: name,
    payload: {
      data: Buffer.from(payload, 'utf8'),
    },
  });
}

export async function getUserSecret(userId: string): Promise<UserKalshiSecret | null> {
  const sm = getClient();
  const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'predict-autotrade-prod';

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
  const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'predict-autotrade-prod';

  if (!sm) return;

  try {
    const name = secretName(projectId, userId);
    await sm.deleteSecret({ name });
  } catch {
    /* ignore if secret already deleted */
  }
}

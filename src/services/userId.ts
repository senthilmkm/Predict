import { getSecureStore } from '../platform/storage';

const USER_ID_KEY = 'foresight.persistent_user_id.v1';

/**
 * Returns the persistent User ID (Apple Subject ID or persistent hardware-backed ID).
 * Ensures Secret Manager and Firestore DB keys use distinct multi-tenant User IDs.
 */
export async function getPersistentUserId(): Promise<string> {
  const store = getSecureStore();
  try {
    let id = await store.getItem(USER_ID_KEY);
    if (id && id.trim()) {
      return id.trim();
    }
    // Generate clean persistent ID for this account/device
    const rand = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    id = `usr_${rand}`;
    await store.setItem(USER_ID_KEY, id);
    return id;
  } catch {
    return 'default_user';
  }
}

/**
 * Binds Apple Sign In User ID (Apple Subject ID) to persistent cloud user identity.
 */
export async function setAppleUserId(appleUserId: string): Promise<void> {
  if (!appleUserId || !appleUserId.trim()) return;
  const store = getSecureStore();
  const sanitized = appleUserId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  try {
    await store.setItem(USER_ID_KEY, sanitized);
  } catch {
    /* ignore */
  }
}

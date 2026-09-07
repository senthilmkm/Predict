import { getSecureStore } from '../platform/storage';

const USER_ID_KEY = 'foresight.persistent_user_id.v1';

let cachedUserId: string | null = null;

/**
 * Returns the persistent User ID (Apple Subject ID or persistent hardware-backed ID).
 * Ensures Secret Manager and Firestore DB keys use distinct multi-tenant User IDs.
 */
export async function getPersistentUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const store = getSecureStore();
  try {
    let id = await store.getItem(USER_ID_KEY);
    if (id && id.trim()) {
      cachedUserId = id.trim();
      return cachedUserId;
    }
    // Generate clean persistent ID for this account/device
    const rand = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    id = `usr_${rand}`;
    await store.setItem(USER_ID_KEY, id);
    cachedUserId = id;
    return id;
  } catch (e: any) {
    console.warn('[USER_ID_SECURESTORE_NOTE]', e?.message || e);
    return cachedUserId || 'default_user';
  }
}

/**
 * Binds Apple Sign In User ID (Apple Subject ID) to persistent cloud user identity.
 */
export async function setAppleUserId(appleUserId: string): Promise<void> {
  if (!appleUserId || !appleUserId.trim()) return;
  const store = getSecureStore();
  const sanitized = appleUserId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  cachedUserId = sanitized;
  try {
    await store.setItem(USER_ID_KEY, sanitized);
  } catch {
    /* ignore */
  }
}

const DISPLAY_NAME_KEY = 'foresight.user_display_name.v1';
let cachedDisplayName: string | null = null;

export async function getUserDisplayName(): Promise<string> {
  if (cachedDisplayName) return cachedDisplayName;
  try {
    const store = getSecureStore();
    const name = await store.getItem(DISPLAY_NAME_KEY);
    if (name && name.trim()) {
      cachedDisplayName = name.trim();
      return cachedDisplayName;
    }
  } catch {
    /* ignore */
  }

  // Hybrid Automatic Detection: Check Device Name (e.g. "User's iPhone")
  try {
    const Device = require('expo-device');
    if (Device?.deviceName && String(Device.deviceName).trim()) {
      cachedDisplayName = String(Device.deviceName).trim();
      return cachedDisplayName;
    }
  } catch {
    /* ignore */
  }

  const { Platform } = require('react-native');
  cachedDisplayName = `${Platform.OS === 'ios' ? 'iOS' : 'Android'} Device`;
  return cachedDisplayName;
}

export async function setUserDisplayName(name: string): Promise<void> {
  if (!name || !name.trim()) return;
  const store = getSecureStore();
  cachedDisplayName = name.trim();
  try {
    await store.setItem(DISPLAY_NAME_KEY, name.trim());
  } catch {
    /* ignore */
  }
}

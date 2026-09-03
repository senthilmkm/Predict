/** Injectable storage so Jest/Node e2e can run without native modules. */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem?(key: string): Promise<void>;
}

export class MemoryKeyValueStore implements KeyValueStore {
  private map = new Map<string, string>();
  async getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  async setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  async deleteItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

let kv: KeyValueStore = new MemoryKeyValueStore();
let secure: KeyValueStore = new MemoryKeyValueStore();

export function setKeyValueStore(store: KeyValueStore) {
  kv = store;
}
export function setSecureStore(store: KeyValueStore) {
  secure = store;
}
export function getKeyValueStore() {
  return kv;
}
export function getSecureStore() {
  return secure;
}

/** Call from App.tsx on device to bind real AsyncStorage / SecureStore. */
export async function bindNativeStores(): Promise<void> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    setKeyValueStore({
      getItem: (k) => AsyncStorage.getItem(k),
      setItem: (k, v) => AsyncStorage.setItem(k, v),
      deleteItem: (k) => AsyncStorage.removeItem(k),
    });
  } catch {
    /* keep memory */
  }
  try {
    const SecureStore = require('expo-secure-store');
    setSecureStore({
      getItem: (k) => SecureStore.getItemAsync(k),
      setItem: (k, v) => SecureStore.setItemAsync(k, v),
      deleteItem: (k) => SecureStore.deleteItemAsync(k),
    });
  } catch {
    /* keep memory */
  }
}

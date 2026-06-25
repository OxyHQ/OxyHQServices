export interface StorageInterface {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  clear: () => Promise<void>;
}

export interface SessionStorageKeys {
  activeSessionId: string;
  sessionIds: string;
  language: string;
}

/**
 * Create an in-memory storage implementation used as a safe fallback.
 */
const MEMORY_STORAGE = (): StorageInterface => {
  const store = new Map<string, string>();

  return {
    async getItem(key: string) {
      const value = store.get(key);
      return value === undefined ? null : value;
    },
    async setItem(key: string, value: string) {
      store.set(key, value);
    },
    async removeItem(key: string) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
  };
};

/**
 * Create a web storage implementation backed by `localStorage`.
 * Falls back to in-memory storage when unavailable.
 */
const createWebStorage = (): StorageInterface => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return MEMORY_STORAGE();
  }

  return {
    async getItem(key: string) {
      try {
        return window.localStorage.getItem(key);
      } catch (err) {
        console.warn('[oxy.storage] localStorage.getItem failed:', err);
        return null;
      }
    },
    async setItem(key: string, value: string) {
      try {
        window.localStorage.setItem(key, value);
      } catch (err) {
        // Quota exceeded or storage disabled (e.g., Safari private mode).
        // Surface to logs so it is debuggable, but do not throw so callers
        // can keep functioning with degraded persistence.
        console.warn('[oxy.storage] localStorage.setItem failed:', err);
      }
    },
    async removeItem(key: string) {
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        console.warn('[oxy.storage] localStorage.removeItem failed:', err);
      }
    },
    async clear() {
      try {
        window.localStorage.clear();
      } catch (err) {
        console.warn('[oxy.storage] localStorage.clear failed:', err);
      }
    },
  };
};

let asyncStorageInstance: StorageInterface | null = null;

/**
 * Structural type for the React Native AsyncStorage default export.
 * Only includes the methods this SDK uses.
 */
interface AsyncStorageLike {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * Type guard verifying that an imported value exposes the AsyncStorage API.
 */
const isAsyncStorageLike = (value: unknown): value is AsyncStorageLike => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function' &&
    typeof candidate.removeItem === 'function' &&
    typeof candidate.clear === 'function'
  );
};

/**
 * Lazily import React Native AsyncStorage implementation.
 */
const createNativeStorage = async (): Promise<StorageInterface> => {
  if (asyncStorageInstance) {
    return asyncStorageInstance;
  }

  try {
    const asyncStorageModule = (await import('@react-native-async-storage/async-storage')) as {
      default?: unknown;
    };
    const candidate = asyncStorageModule.default;
    if (!isAsyncStorageLike(candidate)) {
      throw new Error('AsyncStorage default export does not match expected API');
    }
    asyncStorageInstance = {
      getItem: (key) => candidate.getItem(key),
      setItem: (key, value) => candidate.setItem(key, value),
      removeItem: (key) => candidate.removeItem(key),
      clear: () => candidate.clear(),
    };
    return asyncStorageInstance;
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Failed to import AsyncStorage:', error);
    }
    throw new Error('AsyncStorage is required in React Native environment');
  }
};

/**
 * Detect whether the current runtime is React Native.
 */
export const isReactNative = (): boolean =>
  typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

/**
 * Create a platform-appropriate storage implementation.
 * Defaults to in-memory storage when no platform storage is available.
 */
export const createPlatformStorage = async (): Promise<StorageInterface> => {
  if (isReactNative()) {
    return createNativeStorage();
  }

  return createWebStorage();
};

export const STORAGE_KEY_PREFIX = 'oxy_session';

/**
 * Produce strongly typed storage key names for the supplied prefix.
 *
 * @param prefix - Storage key prefix
 */
export const getStorageKeys = (prefix: string = STORAGE_KEY_PREFIX): SessionStorageKeys => ({
  activeSessionId: `${prefix}_active_session_id`,
  sessionIds: `${prefix}_session_ids`,
  language: `${prefix}_language`,
});



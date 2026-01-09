import { create } from 'zustand';

// Lazy import for expo-secure-store (works on native and web)
let SecureStore: typeof import('expo-secure-store') | null = null;

async function initSecureStore(): Promise<typeof import('expo-secure-store') | null> {
  if (!SecureStore) {
    try {
      const module = await import('expo-secure-store');
      // Verify the module has the expected methods
      if (module && typeof module.getItemAsync === 'function' && typeof module.setItemAsync === 'function') {
        SecureStore = module;
      } else {
        if (__DEV__) {
          console.warn('[IdentityStore] expo-secure-store module is missing expected methods:', {
            hasGetItemAsync: typeof module?.getItemAsync === 'function',
            hasSetItemAsync: typeof module?.setItemAsync === 'function',
            moduleKeys: module ? Object.keys(module) : 'null',
          });
        }
        return null;
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[IdentityStore] Failed to load expo-secure-store:', error);
      }
      return null;
    }
  }
  return SecureStore;
}

/** Storage key for identity sync state */
export const IDENTITY_SYNC_STORAGE_KEY = 'oxy_identity_synced';

export interface IdentityState {
  /** Whether identity is synced with server */
  isSynced: boolean;
  /** Whether sync is currently in progress */
  isSyncing: boolean;
}

export interface IdentityStore extends IdentityState {
  /** Set sync status atomically */
  setSynced: (synced: boolean) => void;
  /** Set syncing status */
  setSyncing: (syncing: boolean) => void;
  /** Initialize store from secure storage */
  hydrate: () => Promise<void>;
  /** Reset store state */
  reset: () => void;
}

const defaultState: IdentityState = {
  isSynced: true, // Assume synced until proven otherwise
  isSyncing: false,
};

/**
 * Identity store - single source of truth for identity sync state.
 * Persists to async storage automatically.
 */
export const useIdentityStore = create<IdentityStore>((set: (state: Partial<IdentityState>) => void, get: () => IdentityStore) => ({
  ...defaultState,

  setSynced: (synced: boolean) => {
    set({ isSynced: synced });
    // Note: Persistence is handled via persistIdentitySyncState in the caller
  },

  setSyncing: (syncing: boolean) => {
    set({ isSyncing: syncing });
  },

  hydrate: async () => {
    try {
      const store = await initSecureStore();
      if (!store) {
        set({ isSynced: defaultState.isSynced });
        return;
      }

      const synced = await store.getItemAsync(IDENTITY_SYNC_STORAGE_KEY);
      set({ isSynced: synced !== 'false' });
    } catch (error) {
      if (__DEV__) {
        console.warn('[IdentityStore] Failed to hydrate from secure storage:', error);
      }
      set({ isSynced: defaultState.isSynced });
    }
  },

  reset: () => {
    set(defaultState);
  },
}));

/**
 * Persist sync state to secure storage.
 * Uses expo-secure-store which works on both native and web platforms.
 */
export const persistIdentitySyncState = async (isSynced: boolean): Promise<void> => {
  try {
    const store = await initSecureStore();
    if (!store) {
      return;
    }
    await store.setItemAsync(IDENTITY_SYNC_STORAGE_KEY, isSynced ? 'true' : 'false');
  } catch (error) {
    if (__DEV__) {
      console.warn('[IdentityStore] Failed to persist sync state:', error);
    }
  }
};

/**
 * Get sync state from secure storage directly (for non-reactive reads).
 */
export const getIdentitySyncStateFromStorage = async (): Promise<boolean> => {
  try {
    const store = await initSecureStore();
    if (!store) {
      return true;
    }
    const synced = await store.getItemAsync(IDENTITY_SYNC_STORAGE_KEY);
    return synced !== 'false';
  } catch (error) {
    if (__DEV__) {
      console.warn('[IdentityStore] Failed to read sync state:', error);
    }
    return true;
  }
};

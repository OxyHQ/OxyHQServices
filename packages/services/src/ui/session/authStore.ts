/**
 * Platform `AuthStateStore` for `@oxyhq/services`.
 *
 * The zero-cookie device model persists the durable device credential
 * (`deviceId` + `deviceSecret`) per origin (web) / per device (native), and the
 * SDK re-mints the access token from that credential on cold boot. `@oxyhq/core`
 * owns the store shape + logic (`createWebAuthStateStore` /
 * `createNativeAuthStateStore`); this module only supplies the platform storage
 * seam:
 *
 *  - web  → `createWebAuthStateStore()` (localStorage, in-memory fallback).
 *  - native → `createNativeAuthStateStore(secureKV)` for the SESSION blob over
 *    `expo-secure-store` (AsyncStorage fallback).
 *
 * `expo-secure-store` is loaded via a runtime-computed dynamic import (the same
 * optional-native-module pattern `OxyProvider` uses for netinfo / keyboard
 * controller), so the web bundle never pulls it and a device without it falls
 * back to AsyncStorage rather than crashing.
 */
import {
  createWebAuthStateStore,
  createNativeAuthStateStore,
  type AuthStateStore,
  type NativeKeyValueStorage,
} from '@oxyhq/core';
import { createPlatformStorage, isReactNative } from '../utils/storageHelpers';

// Variable indirection so Metro's static analyzer never traces expo-secure-store
// into the web bundle; the module is native-only and optional.
const SECURE_STORE_MODULE = 'expo-secure-store';

interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

let secureStorePromise: Promise<SecureStoreLike | null> | null = null;

/**
 * Resolve the `expo-secure-store` module once (memoised), or `null` when it is
 * unavailable — callers then fall back to AsyncStorage. Never throws.
 */
function loadSecureStore(): Promise<SecureStoreLike | null> {
  if (!secureStorePromise) {
    const moduleName = SECURE_STORE_MODULE;
    secureStorePromise = import(moduleName)
      .then((mod: Partial<SecureStoreLike>) => {
        if (
          typeof mod.getItemAsync === 'function' &&
          typeof mod.setItemAsync === 'function' &&
          typeof mod.deleteItemAsync === 'function'
        ) {
          return {
            getItemAsync: mod.getItemAsync.bind(mod),
            setItemAsync: mod.setItemAsync.bind(mod),
            deleteItemAsync: mod.deleteItemAsync.bind(mod),
          } satisfies SecureStoreLike;
        }
        return null;
      })
      .catch(() => null);
  }
  return secureStorePromise;
}

/**
 * A native `NativeKeyValueStorage` that prefers `expo-secure-store` (encrypted
 * at rest) and falls back to AsyncStorage when SecureStore is not installed.
 * The SecureStore module is resolved lazily on first access so construction
 * stays synchronous.
 */
function createNativeSecureKeyValueStorage(): NativeKeyValueStorage {
  let asyncStorage: Awaited<ReturnType<typeof createPlatformStorage>> | null = null;
  const getAsyncStorage = async () => {
    if (!asyncStorage) {
      asyncStorage = await createPlatformStorage();
    }
    return asyncStorage;
  };
  return {
    getItem: async (key) => {
      const secure = await loadSecureStore();
      if (secure) {
        return secure.getItemAsync(key);
      }
      return (await getAsyncStorage()).getItem(key);
    },
    setItem: async (key, value) => {
      const secure = await loadSecureStore();
      if (secure) {
        await secure.setItemAsync(key, value);
        return;
      }
      await (await getAsyncStorage()).setItem(key, value);
    },
    removeItem: async (key) => {
      const secure = await loadSecureStore();
      if (secure) {
        await secure.deleteItemAsync(key);
        return;
      }
      await (await getAsyncStorage()).removeItem(key);
    },
  };
}

/**
 * Build the platform {@link AuthStateStore} for this runtime.
 *
 * Native persists the SESSION blob (`deviceId` + `deviceSecret` + cached access
 * token) per-app in SecureStore; the SDK re-mints the access token from the
 * device credential on the next cold boot.
 */
export function createPlatformAuthStateStore(): AuthStateStore {
  if (!isReactNative()) {
    return createWebAuthStateStore();
  }

  return createNativeAuthStateStore(createNativeSecureKeyValueStorage());
}

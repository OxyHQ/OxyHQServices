/**
 * Platform `AuthStateStore` for `@oxyhq/services`.
 *
 * The zero-cookie device model persists the durable device credential
 * (`deviceId` + `deviceSecret`) per origin (web) / per device (native), and the
 * SDK re-mints the access token from that credential on cold boot. `@oxyhq/core`
 * owns the store shape + logic (`createWebAuthStateStore` /
 * `createNativeAuthStateStore`); this module only selects the platform storage
 * seam:
 *
 *  - web  → `createWebAuthStateStore()` (localStorage, in-memory fallback).
 *  - native → `createNativeAuthStateStore(secureKV)` for the SESSION blob over
 *    the shared `createNativeSecureKeyValueStorage()` adapter
 *    (`expo-secure-store`, AsyncStorage fallback).
 */
import {
  createWebAuthStateStore,
  createNativeAuthStateStore,
  type AuthStateStore,
} from '@oxyhq/core';
import { isReactNative } from '../utils/storageHelpers';
import { createNativeSecureKeyValueStorage } from './nativeSecureStorage';

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

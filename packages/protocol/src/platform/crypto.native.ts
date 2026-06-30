/**
 * Platform Crypto / Storage — React Native Variant
 *
 * Companion to `./crypto.ts`. See the doc-comment at the top of that file for
 * the full design.
 *
 * Metro auto-selects this file in any non-web build (`preferNativePlatform`
 * is `true` for iOS / Android, so `*.native.js` shadows `*.js` during
 * source-extension resolution inside `node_modules/@oxyhq/protocol/dist/`). On
 * iOS / Android `<base>.ios.js` / `<base>.android.js` would shadow this file
 * if they existed, but they don't — `.native.js` is the shared RN variant.
 *
 *   - The default variant references Node's `'crypto'` and would crash Metro
 *     if bundled into an RN app.
 *   - This variant references the RN-only modules (`expo-crypto`,
 *     `expo-secure-store`, `@react-native-async-storage/async-storage`)
 *     as static imports, so Metro and Hermes both resolve and parse them
 *     cleanly.
 *
 * Both variants expose the same surface; importers don't care which one
 * they got.
 *
 * # Why static imports?
 *
 * Every RN consumer of `@oxyhq/protocol` (via `@oxyhq/core`) already lists or
 * transitively pulls in `expo-crypto`, `expo-secure-store`, and
 * `@react-native-async-storage/async-storage` (they're stable Expo modules
 * present in `services`, `accounts`, `inbox`, and `test-app`). A static
 * import is what Metro wants to see anyway, and Hermes parses it like any
 * other ES module — no `Function`-constructor parser exotic-mode involved.
 *
 * This is also clearer to debug: Metro fails up-front with a normal
 * unresolved-module error if a consumer is missing a peer dep, instead of
 * a confusing runtime throw the first time a code path that needs the
 * module is exercised.
 */

import * as ExpoCrypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExpoCryptoLike, ExpoSecureStoreLike } from './expoTypes';

// Re-export the interfaces so consumers can import them from the same
// entry-point they use for the loaders (mirrors the default variant).
export type { ExpoCryptoLike, ExpoSecureStoreLike };

// ---------------------------------------------------------------------------
// Node `crypto` — never available in RN.
// ---------------------------------------------------------------------------

export async function loadNodeCrypto(): Promise<typeof import('crypto')> {
  // Unreachable in practice: every caller gates with `isNodeJS()` before
  // invoking this. If it somehow does fire, throw immediately with a clear
  // diagnostic rather than letting Metro / Hermes attempt to find a
  // non-existent module at runtime.
  throw new Error(
    "[oxy.protocol.crypto] Node's built-in 'crypto' module is not available " +
      'in a React Native runtime. Use the RN-specific helpers ' +
      '(loadExpoCrypto, getRandomBytesRN) or the Web Crypto API (`globalThis.crypto`).',
  );
}

// ---------------------------------------------------------------------------
// expo-crypto — RN cryptographic primitives.
//
// Cast to `ExpoCryptoLike` via `unknown` because the structural interface
// narrows the surface (omits internal expo types) but the real module satisfies
// every declared method/property structurally.
// ---------------------------------------------------------------------------

export async function loadExpoCrypto(): Promise<ExpoCryptoLike> {
  return ExpoCrypto as unknown as ExpoCryptoLike;
}

// ---------------------------------------------------------------------------
// expo-secure-store — RN keychain / keystore.
//
// Same pattern: the real SecureStore namespace satisfies ExpoSecureStoreLike
// structurally. Cast via `unknown` to avoid importing SecureStoreOptions.
// ---------------------------------------------------------------------------

export async function loadSecureStore(): Promise<ExpoSecureStoreLike> {
  return SecureStore as unknown as ExpoSecureStoreLike;
}

// ---------------------------------------------------------------------------
// @react-native-async-storage/async-storage — RN persistent KV storage.
// ---------------------------------------------------------------------------

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export async function loadAsyncStorage(): Promise<{ default: AsyncStorageLike }> {
  // Mirror the shape callers historically used (`module.default.<method>`)
  // so the call sites don't have to know whether the underlying module
  // ships ESM or CJS-with-default.
  const storage = AsyncStorage as unknown as AsyncStorageLike;
  return {
    default: storage,
  };
}

/**
 * Synchronous random-bytes via `expo-crypto.getRandomBytes`. Available
 * synchronously because `expo-crypto` is statically imported by this file
 * — no async initialization race.
 */
export function getRandomBytesRN(byteCount: number): Uint8Array {
  return ExpoCrypto.getRandomBytes(byteCount);
}

/**
 * Crypto Polyfills
 *
 * Ensures Buffer and crypto.getRandomValues are available
 * across all platforms (Node.js, Browser, React Native).
 *
 * - Browser/Node.js: Uses native crypto
 * - React Native: Uses expo-crypto (statically imported via the
 *   per-platform `platformCrypto` module — see that file's doc-comment for
 *   how platform routing works).
 */

import { Buffer } from 'buffer';
import { getRandomBytesRN } from '../utils/platformCrypto';

const getGlobalObject = (): typeof globalThis => {
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof global !== 'undefined') return global;
  if (typeof window !== 'undefined') return window as unknown as typeof globalThis;
  if (typeof self !== 'undefined') return self as unknown as typeof globalThis;
  return {} as typeof globalThis;
};

const globalObject = getGlobalObject();

// Make Buffer available globally for libraries that depend on it
if (!globalObject.Buffer) {
  (globalObject as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

type CryptoLike = {
  getRandomValues: <T extends ArrayBufferView>(array: T) => T;
};

/**
 * Synchronous random-bytes shim. On RN, this delegates to
 * `expo-crypto.getRandomBytes` (statically imported by the RN variant of
 * `platformCrypto`, so available without any async warm-up). On Node /
 * browser, this throws — but is never called there because both platforms
 * already provide `globalThis.crypto.getRandomValues` natively.
 */
function getRandomBytesSync(byteCount: number): Uint8Array {
  // `getRandomBytesRN` throws on non-RN platforms. That's fine: this
  // function is only ever called as a fallback when the native
  // `globalThis.crypto.getRandomValues` is missing, which on a normal
  // Node/browser host never happens.
  return getRandomBytesRN(byteCount);
}

const cryptoPolyfill: CryptoLike = {
  getRandomValues<T extends ArrayBufferView>(array: T): T {
    const bytes = getRandomBytesSync(array.byteLength);
    const uint8View = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    uint8View.set(bytes);
    return array;
  },
};

// Only polyfill if crypto or crypto.getRandomValues is not available
if (typeof globalObject.crypto === 'undefined') {
  (globalObject as unknown as { crypto: CryptoLike }).crypto = cryptoPolyfill;
} else if (typeof globalObject.crypto.getRandomValues !== 'function') {
  (globalObject.crypto as CryptoLike).getRandomValues = cryptoPolyfill.getRandomValues;
}

export { Buffer };

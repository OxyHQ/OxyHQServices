/**
 * Crypto Polyfills
 *
 * Ensures Buffer and crypto.getRandomValues are available
 * across all platforms (Node.js, Browser, React Native).
 *
 * - Browser/Node.js: Uses native crypto
 * - React Native: Falls back to expo-crypto if native crypto unavailable
 */

import { Buffer } from 'buffer';

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

// Cache for expo-crypto module (lazy loaded only in React Native)
let expoCryptoModule: { getRandomBytes: (count: number) => Uint8Array } | null = null;
let expoCryptoLoadAttempted = false;

function getRandomBytesSync(byteCount: number): Uint8Array {
  if (!expoCryptoLoadAttempted) {
    expoCryptoLoadAttempted = true;
    try {
      // Variable indirection prevents bundlers (Vite, webpack) from statically resolving this
      const moduleName = 'expo-crypto';
      expoCryptoModule = require(moduleName);
    } catch {
      // expo-crypto not available — expected in non-RN environments
    }
  }
  if (expoCryptoModule) {
    return expoCryptoModule.getRandomBytes(byteCount);
  }
  throw new Error(
    'No crypto.getRandomValues implementation available. ' +
    'In React Native, install expo-crypto.'
  );
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

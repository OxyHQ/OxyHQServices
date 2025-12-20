/**
 * Crypto Polyfills for React Native
 * 
 * This file ensures that required polyfills are available
 * before any crypto operations are performed.
 * 
 * Polyfills included:
 * - Buffer: Required by crypto libraries
 * - crypto.getRandomValues: Required for secure random number generation
 */

// Import Buffer polyfill for React Native compatibility
// Some crypto libraries depend on Buffer which isn't available in React Native
import { Buffer } from 'buffer';

// Get the global object in a cross-platform way
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

// Polyfill crypto.getRandomValues for React Native
// This is required by crypto libraries for secure random number generation
type CryptoLike = {
  getRandomValues: <T extends ArrayBufferView>(array: T) => T;
};

// Cache for expo-crypto module
let expoCryptoModule: typeof import('expo-crypto') | null = null;

/**
 * Get random bytes using expo-crypto (synchronous)
 * This is a synchronous wrapper that loads expo-crypto lazily
 */
function getRandomBytesSync(byteCount: number): Uint8Array {
  if (!expoCryptoModule) {
    // Try to require expo-crypto synchronously
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      expoCryptoModule = require('expo-crypto');
    } catch {
      throw new Error('expo-crypto is required for crypto.getRandomValues polyfill');
    }
  }
  // TypeScript guard - expoCryptoModule is guaranteed to be non-null here
  const cryptoModule = expoCryptoModule;
  if (!cryptoModule) {
    throw new Error('Failed to load expo-crypto module');
  }
  return cryptoModule.getRandomBytes(byteCount);
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

// Re-export Buffer for convenience
export { Buffer };


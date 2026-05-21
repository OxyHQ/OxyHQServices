/**
 * Signature Service - ECDSA Digital Signatures
 * 
 * Handles signing and verification of messages using ECDSA secp256k1.
 * Used for authenticating requests and proving identity ownership.
 */

import { ec as EC } from 'elliptic';
import { KeyManager } from './keyManager';
import { isReactNative, isNodeJS } from '../utils/platform';
import { logger } from '../utils/loggerUtils';
import { isDev } from '../shared/utils/debugUtils';

// Lazy imports for platform-specific crypto
let ExpoCrypto: typeof import('expo-crypto') | null = null;
let NodeCrypto: typeof import('crypto') | null = null;

const ec = new EC('secp256k1');

async function initExpoCrypto(): Promise<typeof import('expo-crypto')> {
  if (!ExpoCrypto) {
    // Literal-string import: Hermes/Metro require static strings, not variable
    // expressions. `/* @vite-ignore */` tells Vite to skip static analysis (so
    // the optional expo-crypto module isn't required in web builds).
    ExpoCrypto = await import(/* @vite-ignore */ 'expo-crypto');
  }
  return ExpoCrypto!;
}

async function initNodeCrypto(): Promise<typeof import('crypto')> {
  if (!NodeCrypto) {
    // Node's built-in `crypto` module: use `new Function('m','return import(m)')`
    // to hide the import from all bundlers (Vite, Hermes, Metro). Literal
    // `import('crypto')` would be pulled into RN bundles and crash at runtime.
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<typeof import('crypto')>;
    NodeCrypto = await dynamicImport('crypto');
  }
  return NodeCrypto!;
}

/**
 * Compute SHA-256 hash of a string
 */
async function sha256(message: string): Promise<string> {
  // In React Native, use expo-crypto
  if (isReactNative()) {
    const Crypto = await initExpoCrypto();
    return Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      message
    );
  }

  if (isNodeJS()) {
    try {
      const nodeCrypto = await initNodeCrypto();
      return nodeCrypto.createHash('sha256').update(message).digest('hex');
    } catch (error) {
      // Node crypto failed to load — log and fall through to Web Crypto API
      logger.warn('[oxy.crypto] Node crypto unavailable, falling back to Web Crypto', { component: 'SignatureService' }, error);
    }
  }

  // Browser: use Web Crypto API
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface SignedMessage {
  message: string;
  signature: string;
  publicKey: string;
  timestamp: number;
}

export interface AuthChallenge {
  challenge: string;
  publicKey: string;
  timestamp: number;
}

export class SignatureService {
  /**
   * Generate a random challenge string (for offline use)
   * Uses expo-crypto in React Native, crypto.randomBytes in Node.js
   */
  static async generateChallenge(): Promise<string> {
    // In React Native, use expo-crypto
    if (isReactNative()) {
      const Crypto = await initExpoCrypto();
      const randomBytes = await Crypto.getRandomBytesAsync(32);
      return Array.from(new Uint8Array(randomBytes))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }

    if (isNodeJS()) {
      try {
        const nodeCrypto = await initNodeCrypto();
        return nodeCrypto.randomBytes(32).toString('hex');
      } catch (error) {
        // Node crypto failed to load — log and fall through to Web Crypto API
        logger.warn('[oxy.crypto] Node crypto unavailable, falling back to Web Crypto', { component: 'SignatureService' }, error);
      }
    }

    // Browser: use Web Crypto API
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Hash a message using SHA-256
   */
  static async hashMessage(message: string): Promise<string> {
    return sha256(message);
  }

  /**
   * Sign a message using the stored private key
   * Returns the signature in DER format (hex encoded)
   */
  static async sign(message: string): Promise<string> {
    const keyPair = await KeyManager.getKeyPairObject();
    if (!keyPair) {
      throw new Error('No identity found. Please create or import an identity first.');
    }

    const messageHash = await sha256(message);
    const signature = keyPair.sign(messageHash);
    return signature.toDER('hex');
  }

  /**
   * Sign a message with an explicit private key (without storing)
   * Useful for one-time operations or testing
   */
  static async signWithKey(message: string, privateKey: string): Promise<string> {
    const keyPair = ec.keyFromPrivate(privateKey);
    const messageHash = await sha256(message);
    const signature = keyPair.sign(messageHash);
    return signature.toDER('hex');
  }

  /**
   * Verify a signature against a message and public key
   *
   * Returns false on any error (invalid signature, malformed input, etc.).
   * Errors are logged at debug level so they're available when troubleshooting
   * signature mismatches but don't surface to the caller.
   */
  static async verify(message: string, signature: string, publicKey: string): Promise<boolean> {
    try {
      const key = ec.keyFromPublic(publicKey, 'hex');
      const messageHash = await sha256(message);
      return key.verify(messageHash, signature);
    } catch (error) {
      if (isDev()) {
        logger.debug('[oxy.crypto] verify() returned false', { component: 'SignatureService' }, error);
      }
      return false;
    }
  }

  /**
   * Synchronous verification (for Node.js backend)
   * Uses crypto module directly for hashing
   * Note: This method should only be used in Node.js environments
   */
  static verifySync(message: string, signature: string, publicKey: string): boolean {
    try {
      if (!isNodeJS()) {
        // In React Native, use async verify instead
        throw new Error('verifySync should only be used in Node.js. Use verify() in React Native.');
      }
      // Intentionally using Function constructor here: this method is synchronous by design
      // (Node.js backend hot-path) so we cannot use `await import()`. The Function constructor
      // prevents Metro/bundlers from statically resolving the require. This is acceptable because
      // verifySync is gated by isNodeJS() and will never execute in browser/RN environments.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const getCrypto = new Function('return require("crypto")');
      const crypto = getCrypto();
      const key = ec.keyFromPublic(publicKey, 'hex');
      const messageHash = crypto.createHash('sha256').update(message).digest('hex');
      return key.verify(messageHash, signature);
    } catch (error) {
      if (isDev()) {
        logger.debug('[oxy.crypto] verifySync() returned false', { component: 'SignatureService' }, error);
      }
      return false;
    }
  }

  /**
   * Create a signed message object with metadata
   */
  static async createSignedMessage(message: string): Promise<SignedMessage> {
    const publicKey = await KeyManager.getPublicKey();
    if (!publicKey) {
      throw new Error('No identity found. Please create or import an identity first.');
    }

    const timestamp = Date.now();
    const messageWithTimestamp = `${message}:${timestamp}`;
    const signature = await SignatureService.sign(messageWithTimestamp);

    return {
      message,
      signature,
      publicKey,
      timestamp,
    };
  }

  /**
   * Verify a signed message object
   * Checks both signature validity and timestamp freshness
   */
  static async verifySignedMessage(
    signedMessage: SignedMessage,
    maxAgeMs: number = 5 * 60 * 1000 // 5 minutes default
  ): Promise<boolean> {
    const { message, signature, publicKey, timestamp } = signedMessage;

    // Check timestamp freshness
    const now = Date.now();
    if (now - timestamp > maxAgeMs) {
      return false;
    }

    // Verify signature
    const messageWithTimestamp = `${message}:${timestamp}`;
    return SignatureService.verify(messageWithTimestamp, signature, publicKey);
  }

  /**
   * Create a signed authentication challenge response
   * Used for challenge-response authentication
   */
  static async signChallenge(challenge: string): Promise<AuthChallenge> {
    const publicKey = await KeyManager.getPublicKey();
    if (!publicKey) {
      throw new Error('No identity found. Please create or import an identity first.');
    }

    const timestamp = Date.now();
    const message = `auth:${publicKey}:${challenge}:${timestamp}`;
    const signature = await SignatureService.sign(message);

    return {
      challenge: signature,
      publicKey,
      timestamp,
    };
  }

  /**
   * Verify a challenge response
   */
  static async verifyChallengeResponse(
    originalChallenge: string,
    response: AuthChallenge,
    maxAgeMs: number = 5 * 60 * 1000
  ): Promise<boolean> {
    const { challenge: signature, publicKey, timestamp } = response;

    // Check timestamp freshness
    const now = Date.now();
    if (now - timestamp > maxAgeMs) {
      return false;
    }

    const message = `auth:${publicKey}:${originalChallenge}:${timestamp}`;
    return SignatureService.verify(message, signature, publicKey);
  }

  /**
   * Create a registration signature
   * Used when registering a new identity with the server
   * Format matches server expectation: oxy:register:{publicKey}:{timestamp}
   */
  static async createRegistrationSignature(): Promise<{ signature: string; publicKey: string; timestamp: number }> {
    const publicKey = await KeyManager.getPublicKey();
    if (!publicKey) {
      throw new Error('No identity found. Please create or import an identity first.');
    }

    const timestamp = Date.now();
    const message = `oxy:register:${publicKey}:${timestamp}`;
    const signature = await SignatureService.sign(message);

    return {
      signature,
      publicKey,
      timestamp,
    };
  }

  /**
   * Sign arbitrary data for API requests
   * Creates a canonical string representation and signs it
   */
  static async signRequestData(data: Record<string, unknown>): Promise<{
    signature: string;
    publicKey: string;
    timestamp: number;
  }> {
    const publicKey = await KeyManager.getPublicKey();
    if (!publicKey) {
      throw new Error('No identity found. Please create or import an identity first.');
    }

    const timestamp = Date.now();
    
    // Create canonical string representation
    const sortedKeys = Object.keys(data).sort();
    const canonicalParts = sortedKeys.map(key => `${key}:${JSON.stringify(data[key])}`);
    const canonicalString = canonicalParts.join('|');
    
    const message = `request:${publicKey}:${timestamp}:${canonicalString}`;
    const signature = await SignatureService.sign(message);

    return {
      signature,
      publicKey,
      timestamp,
    };
  }
}

export default SignatureService;

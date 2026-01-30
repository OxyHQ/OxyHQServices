/**
 * Signature Service - ECDSA Digital Signatures
 * 
 * Handles signing and verification of messages using ECDSA secp256k1.
 * Used for authenticating requests and proving identity ownership.
 */

import { ec as EC } from 'elliptic';
import { KeyManager } from './keyManager';

// Lazy import for expo-crypto
let ExpoCrypto: typeof import('expo-crypto') | null = null;

const ec = new EC('secp256k1');

/**
 * Check if we're in a React Native environment
 */
function isReactNative(): boolean {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
}

/**
 * Check if we're in a Node.js environment
 */
function isNodeJS(): boolean {
  return typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
}

/**
 * Initialize expo-crypto module
 */
async function initExpoCrypto(): Promise<typeof import('expo-crypto')> {
  if (!ExpoCrypto) {
    ExpoCrypto = await import('expo-crypto');
  }
  return ExpoCrypto;
}

/**
 * Compute SHA-256 hash of a string
 */
async function sha256(message: string): Promise<string> {
  // In React Native, always use expo-crypto
  if (isReactNative() || !isNodeJS()) {
    const Crypto = await initExpoCrypto();
    return Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      message
    );
  }
  
  // In Node.js, use Node's crypto module
  // Use Function constructor to prevent Metro bundler from statically analyzing this require
  // This ensures the require is only evaluated in Node.js runtime, not during Metro bundling
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const getCrypto = new Function('return require("crypto")');
    const crypto = getCrypto();
    return crypto.createHash('sha256').update(message).digest('hex');
  } catch (error) {
    // Fallback to expo-crypto if Node crypto fails
    const Crypto = await initExpoCrypto();
    return Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      message
    );
  }
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
    if (isReactNative() || !isNodeJS()) {
      // Use expo-crypto for React Native (expo-random is deprecated)
      const Crypto = await initExpoCrypto();
      const randomBytes = await Crypto.getRandomBytesAsync(32);
      return Array.from(randomBytes)
        .map((b: number) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    
    // Node.js fallback
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const getCrypto = new Function('return require("crypto")');
      const crypto = getCrypto();
      return crypto.randomBytes(32).toString('hex');
    } catch (error) {
      // Fallback to expo-crypto if Node crypto fails
      const Crypto = await initExpoCrypto();
      const randomBytes = await Crypto.getRandomBytesAsync(32);
      return Array.from(randomBytes)
        .map((b: number) => b.toString(16).padStart(2, '0'))
        .join('');
    }
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
   */
  static async verify(message: string, signature: string, publicKey: string): Promise<boolean> {
    try {
      const key = ec.keyFromPublic(publicKey, 'hex');
      const messageHash = await sha256(message);
      return key.verify(messageHash, signature);
    } catch {
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
      // Use Function constructor to prevent Metro bundler from statically analyzing this require
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const getCrypto = new Function('return require("crypto")');
      const crypto = getCrypto();
      const key = ec.keyFromPublic(publicKey, 'hex');
      const messageHash = crypto.createHash('sha256').update(message).digest('hex');
      return key.verify(messageHash, signature);
    } catch {
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



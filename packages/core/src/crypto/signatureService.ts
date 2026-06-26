/**
 * Signature Service - ECDSA Digital Signatures
 * 
 * Handles signing and verification of messages using ECDSA secp256k1.
 * Used for authenticating requests and proving identity ownership.
 */

import { ec as EC } from 'elliptic';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';
import { KeyManager } from './keyManager';
import { canonicalize } from './canonicalJson';
import { isReactNative, isNodeJS } from '../utils/platform';
import { loadExpoCrypto, loadNodeCrypto } from '../utils/platformCrypto';
import { logger } from '../utils/loggerUtils';
import { isDev } from '../shared/utils/debugUtils';

const ec = new EC('secp256k1');

/**
 * The signing-input portion of a {@link SignedRecordEnvelope}: every field
 * EXCEPT the `publicKey` and `signature`. Both the client (when signing) and
 * the server (when verifying) canonicalize exactly these fields, so they agree
 * on the bytes that the signature covers.
 */
export type SignedRecordSigningFields = Pick<
  SignedRecordEnvelope,
  'version' | 'type' | 'subject' | 'issuer' | 'record' | 'issuedAt'
>;

/**
 * Compute the canonical signing input for a signed-record envelope.
 *
 * This is the single definition of "what the signature covers": the canonical
 * JSON of `{version, type, subject, issuer, record, issuedAt}`. `@oxyhq/core`
 * (client signing) and `@oxyhq/api` (server verification) both call this, so a
 * record signed by a client and verified by the server cannot drift.
 */
export function signedRecordSigningInput(fields: SignedRecordSigningFields): string {
  const { version, type, subject, issuer, record, issuedAt } = fields;
  return canonicalize({ version, type, subject, issuer, record, issuedAt });
}

/**
 * Compute SHA-256 hash of a string
 */
async function sha256(message: string): Promise<string> {
  // In React Native, use expo-crypto
  if (isReactNative()) {
    const Crypto = await loadExpoCrypto();
    return Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      message
    );
  }

  if (isNodeJS()) {
    try {
      const nodeCrypto = await loadNodeCrypto();
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
      const Crypto = await loadExpoCrypto();
      const randomBytes = await Crypto.getRandomBytesAsync(32);
      return Array.from(new Uint8Array(randomBytes))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }

    if (isNodeJS()) {
      try {
        const nodeCrypto = await loadNodeCrypto();
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
   * Create a signed authentication challenge response using the SHARED identity
   * key (the cross-app `group.so.oxy.shared` keychain key), not the primary
   * device key.
   *
   * Mirrors {@link signChallenge} exactly — same message format
   * (`auth:${publicKey}:${challenge}:${timestamp}`) so the server verification
   * path is unchanged — but sources the shared public/private key from
   * `KeyManager` and signs with `signWithKey`. Used by "Sign in with Oxy"
   * same-device shared-keychain SSO (Mechanism A): a sibling native app proves
   * control of the shared identity to mint its own session.
   *
   * Throws if no shared identity exists (native-only; the shared keychain is
   * unavailable on web).
   */
  static async signChallengeWithSharedKey(challenge: string): Promise<AuthChallenge> {
    const publicKey = await KeyManager.getSharedPublicKey();
    const privateKey = await KeyManager.getSharedPrivateKey();
    if (!publicKey || !privateKey) {
      throw new Error('No shared identity found. Cannot sign with the shared key.');
    }

    const timestamp = Date.now();
    const message = `auth:${publicKey}:${challenge}:${timestamp}`;
    const signature = await SignatureService.signWithKey(message, privateKey);

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

  /**
   * Build a signed-record envelope for a self-issued identity/profile record.
   *
   * The envelope is self-issued: `issuer` equals `subject` (the signer's DID).
   * The signature covers the canonical JSON of every field EXCEPT `publicKey`
   * and `signature` (see {@link signedRecordSigningInput}); `alg` is
   * `ES256K-DER-SHA256` (secp256k1 over the SHA-256 of the canonical bytes,
   * DER-encoded), the same scheme this service uses everywhere else.
   *
   * Requires a stored identity (native secure storage); throws if none exists.
   *
   * @param type - The record category (`'identity'` or `'profile'`).
   * @param subject - The subject DID the record is about (also the issuer).
   * @param record - The arbitrary record payload to attest to.
   */
  static async signRecord(
    type: SignedRecordEnvelope['type'],
    subject: string,
    record: Record<string, unknown>,
  ): Promise<SignedRecordEnvelope> {
    const publicKey = await KeyManager.getPublicKey();
    if (!publicKey) {
      throw new Error('No identity found. Please create or import an identity first.');
    }

    const version = 1 as const;
    const issuer = subject;
    const issuedAt = Date.now();
    const signingInput = signedRecordSigningInput({
      version,
      type,
      subject,
      issuer,
      record,
      issuedAt,
    });
    const signature = await SignatureService.sign(signingInput);

    return {
      version,
      type,
      subject,
      issuer,
      record,
      issuedAt,
      publicKey,
      alg: 'ES256K-DER-SHA256',
      signature,
    };
  }

  /**
   * Verify a signed-record envelope: recompute the canonical signing input from
   * the envelope's own fields and check the signature against the envelope's
   * `publicKey`.
   *
   * Note: this confirms the signature is internally consistent with the
   * embedded `publicKey`. It does NOT establish that `publicKey` is an
   * authorized verification method for `subject` — that authorization check is
   * the server's responsibility (it asserts the key is a current verification
   * method on the subject's DID).
   */
  static async verifyRecord(envelope: SignedRecordEnvelope): Promise<boolean> {
    const signingInput = signedRecordSigningInput(envelope);
    return SignatureService.verify(signingInput, envelope.signature, envelope.publicKey);
  }
}

export default SignatureService;

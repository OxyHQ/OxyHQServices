/**
 * Signature Verification Service
 * 
 * Handles ECDSA signature verification for the backend.
 * Used to authenticate users via their public key and digital signatures.
 */

import { ec as EC } from 'elliptic';
import crypto from 'crypto';

const ec = new EC('secp256k1');

// Challenge expiration time in milliseconds (5 minutes)
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Maximum age for signed requests (5 minutes)
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

export class SignatureService {
  /**
   * Generate a random challenge string
   */
  static generateChallenge(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Compute SHA-256 hash of a message
   */
  static hashMessage(message: string): string {
    return crypto.createHash('sha256').update(message).digest('hex');
  }

  /**
   * Verify an ECDSA signature
   * 
   * @param message - The original message that was signed
   * @param signature - The signature in DER format (hex encoded)
   * @param publicKey - The public key (hex encoded, uncompressed)
   * @returns true if the signature is valid
   */
  static verifySignature(message: string, signature: string, publicKey: string): boolean {
    try {
      const key = ec.keyFromPublic(publicKey, 'hex');
      const messageHash = SignatureService.hashMessage(message);
      return key.verify(messageHash, signature);
    } catch (error) {
      return false;
    }
  }

  /**
   * Verify an authentication challenge response
   * 
   * @param publicKey - The user's public key
   * @param challenge - The original challenge string
   * @param signature - The signature of the auth message
   * @param timestamp - The timestamp when the signature was created
   * @returns true if the challenge response is valid
   */
  static verifyChallengeResponse(
    publicKey: string,
    challenge: string,
    signature: string,
    timestamp: number
  ): boolean {
    // Check timestamp is not too old
    const now = Date.now();
    if (now - timestamp > CHALLENGE_TTL_MS) {
      return false;
    }

    // Verify the signature
    const message = `auth:${publicKey}:${challenge}:${timestamp}`;
    return SignatureService.verifySignature(message, signature, publicKey);
  }

  /**
   * Verify a registration signature
   * Signature format: oxy:register:{publicKey}:{timestamp}
   */
  static verifyRegistrationSignature(
    publicKey: string,
    signature: string,
    timestamp: number
  ): boolean {
    // Check timestamp freshness
    const now = Date.now();
    if (now - timestamp > MAX_SIGNATURE_AGE_MS) {
      return false;
    }

    const message = `oxy:register:${publicKey}:${timestamp}`;
    return SignatureService.verifySignature(message, signature, publicKey);
  }

  /**
   * Verify a signed request
   * Used for authenticated API operations
   */
  static verifyRequestSignature(
    publicKey: string,
    data: Record<string, unknown>,
    signature: string,
    timestamp: number
  ): boolean {
    // Check timestamp freshness
    const now = Date.now();
    if (now - timestamp > MAX_SIGNATURE_AGE_MS) {
      return false;
    }

    // Create canonical string representation
    const sortedKeys = Object.keys(data).sort();
    const canonicalParts = sortedKeys.map(key => `${key}:${JSON.stringify(data[key])}`);
    const canonicalString = canonicalParts.join('|');
    
    const message = `request:${publicKey}:${timestamp}:${canonicalString}`;
    return SignatureService.verifySignature(message, signature, publicKey);
  }

  /**
   * Validate that a string is a valid public key
   */
  static isValidPublicKey(publicKey: string): boolean {
    try {
      ec.keyFromPublic(publicKey, 'hex');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a shortened display version of a public key
   */
  static shortenPublicKey(publicKey: string): string {
    if (publicKey.length <= 16) return publicKey;
    return `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`;
  }
}

export default SignatureService;



/**
 * Node.js Signature Service
 * 
 * Provides synchronous signature operations for Node.js backend.
 * Uses Node's crypto module for hashing and the shared core for verification.
 */

import crypto from 'crypto';
import {
  verifySignatureCore,
  isValidPublicKey,
  isTimestampFresh,
  buildAuthMessage,
  buildRegistrationMessage,
  buildRequestMessage,
  shortenPublicKey,
  CHALLENGE_TTL_MS,
  MAX_SIGNATURE_AGE_MS,
} from '../crypto/core';

export class SignatureService {
  /**
   * Generate a random challenge string
   */
  static generateChallenge(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Compute SHA-256 hash of a message (synchronous)
   */
  static hashMessage(message: string): string {
    return crypto.createHash('sha256').update(message).digest('hex');
  }

  /**
   * Verify an ECDSA signature (synchronous)
   * 
   * @param message - The original message that was signed
   * @param signature - The signature in DER format (hex encoded)
   * @param publicKey - The public key (hex encoded, uncompressed)
   * @returns true if the signature is valid
   */
  static verifySignature(message: string, signature: string, publicKey: string): boolean {
    const messageHash = SignatureService.hashMessage(message);
    return verifySignatureCore(messageHash, signature, publicKey);
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
    if (!isTimestampFresh(timestamp, CHALLENGE_TTL_MS)) {
      return false;
    }

    // Build the message and verify signature
    const message = buildAuthMessage(publicKey, challenge, timestamp);
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
    if (!isTimestampFresh(timestamp, MAX_SIGNATURE_AGE_MS)) {
      return false;
    }

    const message = buildRegistrationMessage(publicKey, timestamp);
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
    if (!isTimestampFresh(timestamp, MAX_SIGNATURE_AGE_MS)) {
      return false;
    }

    const message = buildRequestMessage(publicKey, timestamp, data);
    return SignatureService.verifySignature(message, signature, publicKey);
  }

  /**
   * Validate that a string is a valid public key
   */
  static isValidPublicKey(publicKey: string): boolean {
    return isValidPublicKey(publicKey);
  }

  /**
   * Get a shortened display version of a public key
   */
  static shortenPublicKey(publicKey: string): string {
    return shortenPublicKey(publicKey);
  }
}

export default SignatureService;

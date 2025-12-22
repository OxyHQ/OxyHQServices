/**
 * Core Cryptographic Functions - Platform Agnostic
 * 
 * This module contains the core signature verification logic
 * that is shared between all platforms (React Native, Node.js, Web).
 * Platform-specific implementations (hashing, random generation) are injected.
 */

import { ec as EC } from 'elliptic';

const ec = new EC('secp256k1');

// Constants for signature validation
export const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Core signature verification using elliptic curve
 * This is platform-agnostic and works everywhere
 */
export function verifySignatureCore(
  messageHash: string,
  signature: string,
  publicKey: string
): boolean {
  try {
    const key = ec.keyFromPublic(publicKey, 'hex');
    return key.verify(messageHash, signature);
  } catch {
    return false;
  }
}

/**
 * Validate that a string is a valid public key
 */
export function isValidPublicKey(publicKey: string): boolean {
  try {
    ec.keyFromPublic(publicKey, 'hex');
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a string is a valid private key
 */
export function isValidPrivateKey(privateKey: string): boolean {
  try {
    const keyPair = ec.keyFromPrivate(privateKey);
    // Verify it can derive a public key
    keyPair.getPublic('hex');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a shortened display version of a public key
 * Format: first 8 chars...last 8 chars
 */
export function shortenPublicKey(publicKey: string): string {
  if (publicKey.length <= 20) return publicKey;
  return `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`;
}

/**
 * Derive public key from a private key (without storing)
 */
export function derivePublicKey(privateKey: string): string {
  const keyPair = ec.keyFromPrivate(privateKey);
  return keyPair.getPublic('hex');
}

/**
 * Check timestamp freshness
 */
export function isTimestampFresh(timestamp: number, maxAgeMs: number = MAX_SIGNATURE_AGE_MS): boolean {
  const now = Date.now();
  return (now - timestamp) <= maxAgeMs;
}

/**
 * Build authentication challenge message
 * Format: auth:{publicKey}:{challenge}:{timestamp}
 */
export function buildAuthMessage(publicKey: string, challenge: string, timestamp: number): string {
  return `auth:${publicKey}:${challenge}:${timestamp}`;
}

/**
 * Build registration message
 * Format: oxy:register:{publicKey}:{timestamp}
 */
export function buildRegistrationMessage(publicKey: string, timestamp: number): string {
  return `oxy:register:${publicKey}:${timestamp}`;
}

/**
 * Build request signature message
 * Format: request:{publicKey}:{timestamp}:{canonicalString}
 */
export function buildRequestMessage(
  publicKey: string,
  timestamp: number,
  data: Record<string, unknown>
): string {
  const sortedKeys = Object.keys(data).sort();
  const canonicalParts = sortedKeys.map(key => `${key}:${JSON.stringify(data[key])}`);
  const canonicalString = canonicalParts.join('|');
  return `request:${publicKey}:${timestamp}:${canonicalString}`;
}

/**
 * Get the elliptic curve instance (for key generation)
 */
export function getEllipticCurve(): EC {
  return ec;
}

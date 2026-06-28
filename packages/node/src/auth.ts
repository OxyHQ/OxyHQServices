/**
 * Owner authorization for node writes.
 *
 * Two write paths, both anchored on the node's configured owner public key:
 *
 *  1. **Signed records** (`POST /records`, `POST /sync/push`) — self-authenticating.
 *     The envelope is signed by the owner's key, so the owner check is simply
 *     "is `envelope.publicKey` the owner key?" ({@link isOwnerKey}). The signature
 *     itself is verified in {@link ./verify.ts}.
 *
 *  2. **Blob pins** (`PUT /blobs/:hash`) — the body is raw bytes, not a signed
 *     envelope, so the owner proves control with a fresh signed header over the
 *     action ({@link verifyOwnerActionSignature}). This reuses the SAME
 *     `@oxyhq/core` `SignatureService` rather than introducing a shared bearer
 *     secret.
 *
 * Public-key equality is compared with `verifySecret` (`@oxyhq/core/server`) —
 * constant-time and length-guarded, the blessed helper for identity equality.
 */

import { SignatureService } from '@oxyhq/core';
import { verifySecret } from '@oxyhq/core/server';
import { OWNER_AUTH_MAX_AGE_MS } from './constants.js';

/** True iff `publicKey` is the node's configured owner key (case-insensitive, constant-time). */
export function isOwnerKey(publicKey: string, ownerPublicKey: string): boolean {
  if (typeof publicKey !== 'string' || publicKey.length === 0) {
    return false;
  }
  return verifySecret(publicKey.toLowerCase(), ownerPublicKey.toLowerCase());
}

/** The canonical message an owner signs to authorize a node action. */
export function ownerActionMessage(action: string, timestamp: number): string {
  return `oxy-node:${action}:${timestamp}`;
}

export interface OwnerActionAuth {
  /** The signer's claimed public key (must equal the owner key). */
  publicKey: string;
  /** DER-encoded (hex) secp256k1 signature over {@link ownerActionMessage}. */
  signature: string;
  /** Epoch milliseconds the authorization was created (freshness-checked). */
  timestamp: number;
}

/**
 * Verify an owner-signed authorization for a node `action` (e.g. `blob-pin:<hash>`).
 *
 * Requires that the signer IS the owner key, the timestamp is fresh (within
 * {@link OWNER_AUTH_MAX_AGE_MS}), and the secp256k1 signature over
 * {@link ownerActionMessage} verifies against the owner key.
 */
export async function verifyOwnerActionSignature(
  ownerPublicKey: string,
  action: string,
  auth: OwnerActionAuth,
): Promise<boolean> {
  if (!isOwnerKey(auth.publicKey, ownerPublicKey)) {
    return false;
  }
  if (!Number.isFinite(auth.timestamp)) {
    return false;
  }
  if (Math.abs(Date.now() - auth.timestamp) > OWNER_AUTH_MAX_AGE_MS) {
    return false;
  }
  const message = ownerActionMessage(action, auth.timestamp);
  return SignatureService.verify(message, auth.signature, auth.publicKey);
}

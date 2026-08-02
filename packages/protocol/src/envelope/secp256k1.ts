/**
 * secp256k1 ECDSA (DER) wrapper.
 *
 * The single low-level binding to `elliptic`'s secp256k1 curve used by the
 * protocol's signing/verification. Operates over a precomputed hex DIGEST (the
 * SHA-256 of the canonical signing input); the `ES256K-DER-SHA256` scheme is
 * "secp256k1 over the SHA-256 of the canonical bytes, DER-encoded".
 *
 * Pure and synchronous — no platform deps, only `elliptic`. Hashing lives in
 * `./recordId` (`sha256`); this module never hashes.
 */

import { ec as EC } from 'elliptic';

const ec = new EC('secp256k1');

/**
 * Sign a hex digest with a private key, returning a DER-encoded hex signature.
 *
 * `elliptic` uses RFC 6979 deterministic nonces, so signing the same digest
 * with the same key is reproducible.
 */
export function signDigest(privateKeyHex: string, digestHex: string): string {
  const keyPair = ec.keyFromPrivate(privateKeyHex);
  return keyPair.sign(digestHex).toDER('hex');
}

/**
 * Verify a DER-encoded hex signature over a hex digest against a public key.
 *
 * Throws on malformed key/signature input (the caller swallows and treats as
 * "not a valid signature").
 */
export function verifyDigest(publicKeyHex: string, digestHex: string, signatureDER: string): boolean {
  const key = ec.keyFromPublic(publicKeyHex, 'hex');
  return key.verify(digestHex, signatureDER);
}

/**
 * Derive the uncompressed hex public key for a private key.
 *
 * Matches `KeyManager`'s stored public key (`keyPair.getPublic('hex')`), so an
 * envelope whose `publicKey` is derived here equals the registered verification
 * method for the same key.
 */
export function derivePublicKeyHex(privateKeyHex: string): string {
  return ec.keyFromPrivate(privateKeyHex).getPublic('hex');
}

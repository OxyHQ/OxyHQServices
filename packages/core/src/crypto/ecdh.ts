/**
 * ECDH shared-secret derivation (secp256k1)
 *
 * Derives a raw 32-byte ECDH shared secret from a local private key and a
 * remote public key, using the SAME `elliptic` `EC('secp256k1')` primitive the
 * rest of core's identity layer uses (`keyManager.ts`). This is the key-exchange
 * step for the Commons device-to-device transfer flow: each side computes the
 * same shared secret, which is then run through `hkdfSha256` to derive the
 * symmetric key handed to `encryptAead` / `decryptAead`.
 *
 * The returned value is the raw x-coordinate of the ECDH point, big-endian,
 * zero-padded to 32 bytes. It is NOT itself a symmetric key — always pass it
 * through a KDF (HKDF) with a context-binding `info` before use.
 *
 * ESM/CJS safe: static `import` only, no `require()`.
 */

import { ec as EC } from 'elliptic';

const ec = new EC('secp256k1');

/** Lowercase and left-pad a private-key hex string to canonical 64-char form. */
function canonicalPrivateKey(key: string): string {
  return key.toLowerCase().padStart(64, '0');
}

const HEX_RE = /^[0-9a-fA-F]+$/;

/**
 * Compute the ECDH shared secret between a local private key and a remote
 * public key on secp256k1.
 *
 * Symmetric by construction:
 * `deriveSharedSecret(privA, pubB) === deriveSharedSecret(privB, pubA)`.
 *
 * @param privateKeyHex     Local private key, hex (up to 64 chars; canonicalized).
 * @param otherPublicKeyHex Remote public key, hex — compressed (`02`/`03` + 32
 *                          bytes) or uncompressed (`04` + 64 bytes).
 * @returns                 The 32-byte big-endian shared secret.
 */
export function deriveSharedSecret(
  privateKeyHex: string,
  otherPublicKeyHex: string,
): Uint8Array {
  if (typeof privateKeyHex !== 'string' || !HEX_RE.test(privateKeyHex)) {
    throw new Error('deriveSharedSecret: privateKeyHex must be a hex string');
  }
  if (typeof otherPublicKeyHex !== 'string' || !HEX_RE.test(otherPublicKeyHex)) {
    throw new Error('deriveSharedSecret: otherPublicKeyHex must be a hex string');
  }

  const keyPair = ec.keyFromPrivate(canonicalPrivateKey(privateKeyHex));
  const otherKey = ec.keyFromPublic(otherPublicKeyHex, 'hex');

  // `derive` returns a BN (the shared point's x-coordinate). Serialize it
  // big-endian, fixed 32 bytes, so both sides agree byte-for-byte regardless of
  // any leading-zero stripping.
  const sharedBytes = keyPair.derive(otherKey.getPublic()).toArray('be', 32);
  return Uint8Array.from(sharedBytes);
}

/**
 * Contact identifier hashing — canonical, privacy-preserving derivation of
 * email/phone hashes used for the contact discovery flow.
 *
 * The same normalization is implemented on the client (see
 * `packages/accounts/lib/contacts/hash.ts`). Both sides MUST produce identical
 * digests for matching to work.
 *
 * Algorithm: SHA-256, hex-encoded, lowercase.
 *
 * Email canonicalization:
 *   1. trim surrounding whitespace
 *   2. lowercase
 *   3. SHA-256(utf-8 bytes) -> hex
 *
 * Phone canonicalization:
 *   1. trim
 *   2. strip every character that is not a digit, except for a single leading "+"
 *   3. if no leading "+", prepend "+" (best-effort E.164 — full parsing requires
 *      the user's country which we do not transmit)
 *   4. SHA-256(utf-8 bytes) -> hex
 *
 * We deliberately avoid storing raw phone/email anywhere this hash flows — the
 * hash is treated as a non-reversible matching token.
 */

import { createHash } from 'node:crypto';

/** Hex-encoded 64-char SHA-256 digest of the canonical email form. */
export function hashEmail(rawEmail: string): string {
  if (typeof rawEmail !== 'string') {
    throw new TypeError('hashEmail expects a string');
  }
  const canonical = rawEmail.trim().toLowerCase();
  if (canonical.length === 0) {
    throw new Error('hashEmail received an empty value after normalization');
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Best-effort E.164 normalization without country context.
 * Keeps a single leading "+" then strips everything except digits.
 * Returns an empty string if the input has no digits.
 */
export function normalizePhone(rawPhone: string): string {
  if (typeof rawPhone !== 'string') {
    throw new TypeError('normalizePhone expects a string');
  }
  const trimmed = rawPhone.trim();
  if (trimmed.length === 0) return '';
  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/[^0-9]/g, '');
  if (digitsOnly.length === 0) return '';
  return hasPlus ? `+${digitsOnly}` : `+${digitsOnly}`;
}

/** Hex-encoded 64-char SHA-256 digest of the canonical phone form. */
export function hashPhone(rawPhone: string): string {
  const canonical = normalizePhone(rawPhone);
  if (canonical.length === 0) {
    throw new Error('hashPhone received an empty value after normalization');
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Returns `hashEmail(value)` or `undefined` for falsy/blank input. */
export function maybeHashEmail(rawEmail: string | undefined | null): string | undefined {
  if (typeof rawEmail !== 'string') return undefined;
  const canonical = rawEmail.trim().toLowerCase();
  if (canonical.length === 0) return undefined;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Returns `hashPhone(value)` or `undefined` for falsy/blank input. */
export function maybeHashPhone(rawPhone: string | undefined | null): string | undefined {
  if (typeof rawPhone !== 'string') return undefined;
  const canonical = normalizePhone(rawPhone);
  if (canonical.length === 0) return undefined;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** A 64-char hex SHA-256 digest. */
export function isValidSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

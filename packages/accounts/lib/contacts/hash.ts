/**
 * Contact identifier hashing — client side.
 *
 * Canonical mirror of `packages/api/src/utils/contactHash.ts`. Any change here
 * MUST also be made there or contact discovery matches will silently break.
 *
 * Algorithm: SHA-256, hex-encoded, lowercase.
 *
 * Email canonicalization:
 *   1. trim
 *   2. lowercase
 *   3. SHA-256(utf-8 bytes) -> hex
 *
 * Phone canonicalization (best-effort E.164 without country context):
 *   1. trim
 *   2. preserve a single leading "+"
 *   3. strip every other non-digit
 *   4. if no leading "+" was present, prepend "+"
 *   5. SHA-256(utf-8 bytes) -> hex
 *
 * Implementation notes:
 *   - We use `expo-crypto`'s `digestStringAsync` with SHA-256. This relies on
 *     the platform's native crypto and is the strongest algorithm exposed by
 *     the API — we deliberately do not fall back to anything weaker.
 *   - Hashes are stable across renders; consumers can safely cache them
 *     keyed by the source value.
 */

import * as Crypto from 'expo-crypto';

const SHA256 = Crypto.CryptoDigestAlgorithm.SHA256;
const HEX = { encoding: Crypto.CryptoEncoding.HEX } as const;

/** Returns the canonical email form (trimmed + lowercased) or null if empty. */
export function canonicalizeEmail(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Returns the canonical phone form (E.164-ish) or null if no digits. */
export function canonicalizePhone(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;
  // Whether the original had a "+" or not, we always emit "+<digits>" so the
  // canonical form is stable.
  return `+${digits}`;
}

/** SHA-256 hex of the canonical email; null for unusable input. */
export async function hashEmail(raw: string | undefined | null): Promise<string | null> {
  const canonical = canonicalizeEmail(raw);
  if (!canonical) return null;
  return await Crypto.digestStringAsync(SHA256, canonical, HEX);
}

/** SHA-256 hex of the canonical phone; null for unusable input. */
export async function hashPhone(raw: string | undefined | null): Promise<string | null> {
  const canonical = canonicalizePhone(raw);
  if (!canonical) return null;
  return await Crypto.digestStringAsync(SHA256, canonical, HEX);
}

interface DeviceContactInput {
  /** Stable client-side ID for this contact (e.g. `Contacts.Contact.id`). */
  id: string;
  /** Display name as shown to the user — never sent to the server. */
  displayName: string;
  /** All emails from the address-book entry (raw strings). */
  emails: readonly (string | undefined | null)[];
  /** All phone numbers from the address-book entry (raw strings). */
  phones: readonly (string | undefined | null)[];
}

export interface HashedContactBatch {
  /** Unique hashed emails to send to `/contacts/discover`. */
  hashedEmails: string[];
  /** Unique hashed phones to send to `/contacts/discover`. */
  hashedPhones: string[];
  /**
   * Reverse-lookup: for each hash we emitted, the local contact(s) it came
   * from. Used after the server response to map a matched hash back to the
   * display name on the device.
   */
  hashToContacts: Map<string, DeviceContactInput[]>;
}

/**
 * Hash a batch of device contacts in parallel, de-duplicating hashes across
 * contacts (same email/phone appearing on multiple cards collapses to one
 * upload but keeps all originating contact references).
 *
 * Bounded by `maxHashesPerChannel` to stay under the server's per-request
 * cap (200 by default). Excess input is silently truncated — callers should
 * batch repeatedly if they have more contacts.
 */
export async function hashContacts(
  contacts: readonly DeviceContactInput[],
  maxHashesPerChannel = 200,
): Promise<HashedContactBatch> {
  const hashToContacts = new Map<string, DeviceContactInput[]>();
  const emailJobs: Promise<{ hash: string | null; contact: DeviceContactInput }>[] = [];
  const phoneJobs: Promise<{ hash: string | null; contact: DeviceContactInput }>[] = [];

  for (const contact of contacts) {
    for (const email of contact.emails) {
      emailJobs.push(hashEmail(email).then((hash) => ({ hash, contact })));
    }
    for (const phone of contact.phones) {
      phoneJobs.push(hashPhone(phone).then((hash) => ({ hash, contact })));
    }
  }

  const [emailResults, phoneResults] = await Promise.all([
    Promise.all(emailJobs),
    Promise.all(phoneJobs),
  ]);

  const dedupedEmails = new Set<string>();
  for (const { hash, contact } of emailResults) {
    if (!hash) continue;
    if (!dedupedEmails.has(hash) && dedupedEmails.size >= maxHashesPerChannel) continue;
    dedupedEmails.add(hash);
    const existing = hashToContacts.get(hash);
    if (existing) {
      if (!existing.includes(contact)) existing.push(contact);
    } else {
      hashToContacts.set(hash, [contact]);
    }
  }

  const dedupedPhones = new Set<string>();
  for (const { hash, contact } of phoneResults) {
    if (!hash) continue;
    if (!dedupedPhones.has(hash) && dedupedPhones.size >= maxHashesPerChannel) continue;
    dedupedPhones.add(hash);
    const existing = hashToContacts.get(hash);
    if (existing) {
      if (!existing.includes(contact)) existing.push(contact);
    } else {
      hashToContacts.set(hash, [contact]);
    }
  }

  return {
    hashedEmails: Array.from(dedupedEmails),
    hashedPhones: Array.from(dedupedPhones),
    hashToContacts,
  };
}

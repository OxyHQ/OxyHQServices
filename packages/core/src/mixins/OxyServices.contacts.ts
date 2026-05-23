/**
 * Contact Discovery Mixin
 *
 * Privacy-preserving discovery of which address-book contacts are on Oxy.
 *
 * The client hashes emails and phones locally before calling the API.
 * The server responds with only Oxy user IDs and the hashes that matched,
 * so the consumer can map each match back to the local contact that
 * produced it.
 *
 * Hashing rules (must match the server `utils/contactHash.ts` exactly):
 *   - SHA-256, hex-encoded, lowercase
 *   - Email: `value.trim().toLowerCase()` then digest
 *   - Phone: trim → keep a single leading "+" → strip non-digits → prepend "+"
 *     if missing → digest
 *
 * Mobile clients can compute these digests with `expo-crypto`'s
 * `digestStringAsync(SHA256, value, { encoding: HEX })`. Web clients should
 * use `SubtleCrypto.digest('SHA-256', ...)`.
 */

import type { OxyServicesBase } from '../OxyServices.base';

/** A single match returned by `POST /contacts/discover`. */
export interface ContactDiscoveryMatch {
  /** Oxy user ID (MongoDB ObjectId hex string). */
  userId: string;
  /** The hashed identifier from the request that matched this user. */
  hashedIdentifier: string;
  /** Whether the match came from the email index or phone index. */
  matchType: 'email' | 'phone';
}

/** Response shape of `POST /contacts/discover`. */
export interface ContactDiscoveryResponse {
  matches: ContactDiscoveryMatch[];
}

export function OxyServicesContactsMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Discover which of the caller's contacts are on Oxy.
     *
     * @param hashedEmails - SHA-256 hex digests of normalized emails.
     * @param hashedPhones - SHA-256 hex digests of normalized phone numbers.
     * @returns Matches mapping each hashed identifier to the Oxy user ID it
     *   resolved to. Empty arrays are valid for either parameter, but at
     *   least one must be non-empty.
     *
     * The server enforces a 200-hash cap per channel per request — callers
     * should batch larger address books client-side.
     */
    async discoverContacts(
      hashedEmails: string[],
      hashedPhones: string[],
    ): Promise<ContactDiscoveryResponse> {
      try {
        return await this.makeRequest<ContactDiscoveryResponse>(
          'POST',
          '/contacts/discover',
          { hashedEmails, hashedPhones },
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

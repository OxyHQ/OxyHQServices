/**
 * Identity Methods Mixin (self-sovereign identity layer)
 *
 * Provides typed access to Oxy's AtProto/Bluesky-flavoured identity &
 * portability layer:
 *  - DID resolution (`did:web:oxy.so:u:<userId>`, derived on demand by the API).
 *  - The auth-method ↔ DID verification-method mapping and its reversibility
 *    (link/unlink an identity key, link a password) via the existing
 *    `/auth/link` surface.
 *  - Signed records: clients sign an envelope with their own cryptographic key
 *    (`SignatureService.signRecord` + the shared `canonicalize`) and publish it;
 *    anyone can fetch and verify it.
 *  - The signed data-export ("credible exit") bundle.
 *  - Verified-domain badges (prove ownership of `nate.com`).
 *
 * Wire shapes come from `@oxyhq/contracts` (`DidDocument`,
 * `SignedRecordEnvelope`, `AuthMethodsResponse`, `VerifiedDomain`,
 * `DomainVerificationInstructions`, `ExportBundle`) — the single source of truth
 * the API validates its output against, so producer and consumer cannot drift.
 *
 * Identity signing is NATIVE-ONLY: the private key lives in native secure
 * storage, so `linkIdentityKey`, `signRecord`, and `publishRecord` require an
 * on-device identity and throw on web (where `KeyManager.getPublicKey()` is
 * always `null`).
 */
import type {
  AuthMethodsResponse,
  DidDocument,
  DomainVerificationInstructions,
  ExportBundle,
  OxySignedRecordType,
  SignedRecordEnvelope,
  VerifiedDomain,
} from '@oxyhq/contracts';
import type { OxyServicesBase } from '../OxyServices.base';
import { KeyManager } from '../crypto/keyManager';
import { SignatureService } from '../crypto/signatureService';
import { CACHE_TIMES } from './mixinHelpers';

/**
 * Registrable apex the Oxy DID method is anchored on. A user's DID is
 * `did:web:<OXY_IDENTITY_APEX>:u:<userId>`, anchored on the stable account id
 * (NOT the keypair).
 */
const OXY_IDENTITY_APEX = 'oxy.so';

/**
 * Record categories a client may sign and publish to the Oxy store. The base
 * envelope `type` is now an open string (any app may define its own records on
 * the shared grammar); the Oxy identity store re-narrows it to the closed Oxy
 * record set.
 */
export type IdentityRecordType = OxySignedRecordType;

/** Auth-method types that can be unlinked via {@link OxyServicesIdentityMixin}. */
export type UnlinkableAuthMethodType = 'identity' | 'password' | 'google' | 'apple' | 'github';

/**
 * Result of a link/unlink auth-method mutation (`POST /auth/link`,
 * `DELETE /auth/link/:type`).
 */
export interface LinkAuthMethodResult {
  success: boolean;
  message: string;
}

/**
 * Result of publishing a signed record (`POST /identity/records`). Echoes the
 * stored envelope plus the server's verification verdict.
 */
export interface PublishRecordResult {
  envelope: SignedRecordEnvelope;
  verified: boolean;
}

/**
 * Result of verifying a stored record (`GET /identity/records/:userId/:type/verify`).
 * `verified` is the server's verdict; `reason` is present when it is `false`.
 */
export interface VerifyRecordResult {
  verified: boolean;
  reason?: string;
}

/** Result of a successful domain verification (`POST /identity/domains/:domain/verify`). */
export interface VerifyDomainResult {
  verified: boolean;
  domain: VerifiedDomain;
}

/** Result of removing a verified domain (`DELETE /identity/domains/:domain`). */
export interface RemoveDomainResult {
  success: boolean;
}

/**
 * Derive a user's Oxy DID from their stable account id.
 * `did:web:oxy.so:u:<userId>`.
 */
export function buildUserDid(userId: string): string {
  return `did:web:${OXY_IDENTITY_APEX}:u:${userId}`;
}

export function OxyServicesIdentityMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Resolve the W3C DID document for any user. The API derives it on demand
     * from the account's `authMethods` + `publicKey` — there is no stored
     * document. Public (no auth required); short-TTL cached.
     *
     * @param userId - The account's Mongo `_id`. URL-encoded into the path.
     */
    async resolveDid(userId: string): Promise<DidDocument> {
      try {
        return await this.makeRequest<DidDocument>(
          'GET',
          `/u/${encodeURIComponent(userId)}/did.json`,
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * The current user's DID (`did:web:oxy.so:u:<userId>`), derived locally from
     * the access token's user id. Throws if no user is authenticated.
     */
    getMyDid(): string {
      const userId = this.getCurrentUserId();
      if (!userId) {
        throw new Error('No authenticated user — cannot derive DID.');
      }
      return buildUserDid(userId);
    }

    /** Resolve the current user's DID document. Requires an authenticated session. */
    async getMyDidDocument(): Promise<DidDocument> {
      const userId = this.getCurrentUserId();
      if (!userId) {
        throw new Error('No authenticated user — cannot resolve DID document.');
      }
      return this.resolveDid(userId);
    }

    /**
     * List the current user's linked authentication methods plus their DID.
     * Each `identity` method carries a `verificationMethodId` linking it to its
     * DID verification-method fragment.
     */
    async listAuthMethods(): Promise<AuthMethodsResponse> {
      try {
        return await this.makeRequest<AuthMethodsResponse>(
          'GET',
          '/auth/methods',
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Link the on-device cryptographic identity to the current account,
     * upgrading it from custodial to self-sovereign. Signs a proof of private
     * key ownership and posts it to `POST /auth/link`.
     *
     * NATIVE-ONLY: requires a stored identity (throws if `KeyManager` has no key
     * or no user is authenticated). The signed payload is
     * `JSON.stringify({ action: 'link_identity', userId, timestamp })` — the
     * exact bytes the server reconstructs and verifies.
     */
    async linkIdentityKey(): Promise<LinkAuthMethodResult> {
      try {
        const userId = this.getCurrentUserId();
        if (!userId) {
          throw new Error('No authenticated user — sign in before linking an identity key.');
        }
        const publicKey = await KeyManager.getPublicKey();
        if (!publicKey) {
          throw new Error('No identity found on this device. Create or import an identity first.');
        }

        const timestamp = Date.now();
        // The signed message MUST match the server's reconstruction byte-for-byte:
        // JSON.stringify with this exact key order (action, userId, timestamp).
        const message = JSON.stringify({ action: 'link_identity', userId, timestamp });
        const signature = await SignatureService.sign(message);

        const result = await this.makeRequest<LinkAuthMethodResult>(
          'POST',
          '/auth/link',
          { type: 'identity', publicKey, signature, timestamp },
          { cache: false },
        );
        this._invalidateIdentityCaches(userId);
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Link password authentication to the current account. Adds a `password`
     * auth method (does not remove existing methods).
     *
     * @param email - The email to associate with password auth.
     * @param password - The new password (server enforces strength rules).
     */
    async linkPassword(email: string, password: string): Promise<LinkAuthMethodResult> {
      try {
        const result = await this.makeRequest<LinkAuthMethodResult>(
          'POST',
          '/auth/link',
          { type: 'password', email, password },
          { cache: false },
        );
        this._invalidateIdentityCaches(this.getCurrentUserId());
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Unlink an authentication method from the current account. The server
     * refuses to remove the last remaining method (the account would become
     * inaccessible). Unlinking `identity` downgrades the account to custodial.
     *
     * @param type - The auth-method type to remove.
     */
    async unlinkAuthMethod(type: UnlinkableAuthMethodType): Promise<LinkAuthMethodResult> {
      try {
        const result = await this.makeRequest<LinkAuthMethodResult>(
          'DELETE',
          `/auth/link/${encodeURIComponent(type)}`,
          undefined,
          { cache: false },
        );
        this._invalidateIdentityCaches(this.getCurrentUserId());
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Sign a record with the on-device identity key, WITHOUT publishing it.
     * The subject is the current user's DID. NATIVE-ONLY (requires a stored
     * key). Use {@link publishRecord} to sign and store in one step.
     *
     * @param type - The record category.
     * @param record - The arbitrary record payload to attest to.
     */
    async signRecord(
      type: IdentityRecordType,
      record: Record<string, unknown>,
    ): Promise<SignedRecordEnvelope> {
      const subject = this.getMyDid();
      return SignatureService.signRecord(type, subject, record);
    }

    /**
     * Sign a record and publish it to the append-only record store
     * (`POST /identity/records`). NATIVE-ONLY (requires a stored key).
     *
     * @param type - The record category.
     * @param record - The arbitrary record payload to attest to.
     */
    async publishRecord(
      type: IdentityRecordType,
      record: Record<string, unknown>,
    ): Promise<PublishRecordResult> {
      try {
        const envelope = await this.signRecord(type, record);
        return await this.makeRequest<PublishRecordResult>(
          'POST',
          '/identity/records',
          envelope,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Fetch a user's most recent signed record of a given type. Public (no auth
     * required); short-TTL cached.
     *
     * @param userId - The subject account's Mongo `_id`.
     * @param type - The record category to fetch.
     */
    async getRecord(userId: string, type: IdentityRecordType): Promise<SignedRecordEnvelope> {
      try {
        const res = await this.makeRequest<{ record: SignedRecordEnvelope }>(
          'GET',
          `/identity/records/${encodeURIComponent(userId)}/${encodeURIComponent(type)}`,
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT },
        );
        return res.record;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Ask the server to verify a user's stored record: it recomputes the
     * canonical signing input, checks the signature, and asserts the signing key
     * is a current verification method on the subject's DID.
     *
     * @param userId - The subject account's Mongo `_id`.
     * @param type - The record category to verify.
     */
    async verifyRecord(userId: string, type: IdentityRecordType): Promise<VerifyRecordResult> {
      try {
        return await this.makeRequest<VerifyRecordResult>(
          'GET',
          `/identity/records/${encodeURIComponent(userId)}/${encodeURIComponent(type)}/verify`,
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Download the current user's signed, open-format data-export bundle
     * (`GET /users/me/export`) — the "credible exit" snapshot. Always carries an
     * Oxy provenance `attestation`; carries an optional client `proof` when the
     * account holds its own key.
     */
    async exportMyData(): Promise<ExportBundle> {
      try {
        return await this.makeRequest<ExportBundle>(
          'GET',
          '/users/me/export',
          undefined,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Start verifying ownership of a domain. Returns the instructions: publish
     * EITHER the DNS-TXT record OR the `/.well-known/oxy-domain` file, then call
     * {@link verifyDomain}.
     *
     * @param domain - The domain to claim (e.g. `nate.com`).
     */
    async requestDomainVerification(domain: string): Promise<DomainVerificationInstructions> {
      try {
        return await this.makeRequest<DomainVerificationInstructions>(
          'POST',
          '/identity/domains',
          { domain },
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Complete domain verification: the server checks the DNS-TXT record or
     * well-known file and, on success, attaches the domain to the account
     * (surfaced in the DID's `alsoKnownAs` and the user's `verifiedDomains`).
     *
     * @param domain - The domain previously requested via
     *   {@link requestDomainVerification}.
     */
    async verifyDomain(domain: string): Promise<VerifyDomainResult> {
      try {
        const result = await this.makeRequest<VerifyDomainResult>(
          'POST',
          `/identity/domains/${encodeURIComponent(domain)}/verify`,
          undefined,
          { cache: false },
        );
        this._invalidateIdentityCaches(this.getCurrentUserId());
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /** List the current user's verified domains. */
    async listDomains(): Promise<VerifiedDomain[]> {
      try {
        const res = await this.makeRequest<{ domains?: VerifiedDomain[] }>(
          'GET',
          '/identity/domains',
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT },
        );
        return res.domains ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Remove a verified domain from the current account.
     * @param domain - The verified domain to remove.
     */
    async removeDomain(domain: string): Promise<RemoveDomainResult> {
      try {
        const result = await this.makeRequest<RemoveDomainResult>(
          'DELETE',
          `/identity/domains/${encodeURIComponent(domain)}`,
          undefined,
          { cache: false },
        );
        this._invalidateIdentityCaches(this.getCurrentUserId());
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Bust the cached reads that an identity mutation invalidates: the current
     * user (`/users/me*`), the linked auth-methods list, the verified-domains
     * list, and the user's derived DID document (which embeds auth methods +
     * verified domains, so it goes stale on link/unlink/domain changes).
     *
     * Internal helper (leading underscore); not part of the supported public
     * surface. Public rather than `private` because mixins compose into an
     * exported anonymous class, where TypeScript cannot represent a private
     * member in the emitted declaration file (TS4094).
     */
    _invalidateIdentityCaches(userId: string | null): void {
      this.clearCacheByPrefix('GET:/users/me');
      this.clearCacheEntry('GET:/auth/methods');
      this.clearCacheEntry('GET:/identity/domains');
      if (userId) {
        this.clearCacheEntry(`GET:/u/${encodeURIComponent(userId)}/did.json`);
      }
    }
  };
}

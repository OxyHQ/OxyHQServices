/**
 * Authentication Methods Mixin
 *
 * Supports password-based login (email/username) and public key challenge-response.
 */
import type { User } from '../models/interfaces';
import type { UserNameResponse, LoginResult, LoginSessionResult } from '@oxyhq/contracts';
import { loginResultSchema, safeParseContract } from '@oxyhq/contracts';
import type { SessionLoginResponse } from '../models/session';
import type { OxyServicesBase } from '../OxyServices.base';
import type { PublicApplication } from './OxyServices.connectedApps';
import { OxyAuthenticationError } from '../OxyServices.errors';
import { KeyManager } from '../crypto/keyManager';
import { SignatureService } from '../crypto/signatureService';
import { loadNodeCrypto } from '@oxyhq/protocol';
import { logger } from '../utils/loggerUtils';
import { normalizeUserIdentity, normalizeUserIdentityOrNull } from '../utils/userIdentity';

/**
 * Default lifetime of a "Sign in with Oxy" device-flow session / authorize code.
 * Matches the authorize-code TTL the server enforces (5 minutes). The server's
 * returned `expiresAt` is authoritative; this is only the client-proposed value.
 */
const COMMONS_SIGN_IN_EXPIRY_MS = 5 * 60 * 1000;

export interface ChallengeResponse {
  challenge: string;
  expiresAt: string;
}

export interface RegistrationRequest {
  publicKey: string;
  username: string;
  email?: string;
  signature: string;
  timestamp: number;
}

export interface ChallengeVerifyRequest {
  publicKey: string;
  challenge: string;
  signature: string;
  timestamp: number;
  deviceName?: string;
  deviceFingerprint?: string;
}

export interface PublicKeyCheckResponse {
  registered: boolean;
  message: string;
}

// ===========================================================================
// "Sign in with Oxy" — cross-device QR / app-to-app handoff (Workstream C)
// ===========================================================================

/**
 * Handle returned by {@link OxyServicesAuthMixin.startCommonsSignIn} for a
 * relying-party app initiating a "Sign in with Oxy" flow.
 *
 * `sessionToken` is the SECRET, high-entropy device-flow credential — it stays
 * on the initiating client, is exchanged once via `claimSessionByToken`, and is
 * NEVER placed in the QR/deep-link. `authorizeCode` is the PUBLIC handle carried
 * in `qrPayload`; the approver (Commons) resolves it via
 * {@link OxyServicesAuthMixin.getCommonsApprovalInfo}.
 */
export interface CommonsSignInHandle {
  /** Secret device-flow token (held by the initiator; exchanged via `claimSessionByToken`). */
  sessionToken: string;
  /** Public, single-use authorize code carried in the QR / deep-link. */
  authorizeCode: string;
  /** Ready-to-render deep-link / universal-link string (`oxycommons://approve?...`). */
  qrPayload: string;
  /** Server-authoritative expiry (epoch milliseconds). */
  expiresAt: number;
  /** Session lifecycle status as reported by the server (e.g. `'pending'`). */
  status: string;
}

/** Poll result for a "Sign in with Oxy" device-flow session (`GET /auth/session/status`). */
export interface CommonsSignInStatus {
  /** True once an approver has authorized the session. */
  authorized: boolean;
  /** The authorized session id (present once `authorized`). */
  sessionId?: string;
  /** The approving identity's public key (present once `authorized`). */
  publicKey?: string;
  /** Lifecycle status (`'pending'` | `'authorized'` | `'cancelled'` | `'expired'`). */
  status?: string;
}

/**
 * Server-resolved approval context shown by the approver (Commons) before
 * authorizing — the TRUSTED identity of the requesting app, resolved from the
 * `authorizeCode` server-side (never from the QR string).
 */
export interface CommonsApprovalInfo {
  /** Sanitized, display-safe identity of the requesting application. */
  application: PublicApplication;
  /** OAuth scopes the application is requesting. */
  scopes: string[];
  /** The origin the session is bound to (the RP web origin), when applicable. */
  boundOrigin?: string;
  /**
   * Server-authoritative anti-phishing flag: `true` only when this device-flow
   * sign-in was started from a verified, registered origin of a trusted app.
   * The approver (Commons) shows a warning when this is `false`. Always present
   * — a missing/non-boolean server value is coerced to `false` (fail-safe to
   * "not verified") by {@link OxyServicesAuthMixin.getCommonsApprovalInfo}.
   */
  originVerified: boolean;
  /** Server-authoritative expiry (epoch milliseconds). */
  expiresAt: number;
  /** Session lifecycle status. */
  status: string;
}

/**
 * @internal Raw server response of `GET /auth/session/approve-info/:code`.
 * `originVerified` is typed loosely here because older servers may omit it (or
 * send a non-boolean); the SDK coerces it to a strict `boolean` when mapping
 * into {@link CommonsApprovalInfo}.
 */
interface CommonsApprovalInfoResponse {
  application: PublicApplication;
  scopes: string[];
  boundOrigin?: string;
  originVerified?: unknown;
  expiresAt: number;
  status: string;
}

/** Result of approving / denying a "Sign in with Oxy" request. */
export interface CommonsSignInActionResult {
  success: boolean;
}

/** @internal Response shape of the extended `POST /auth/session/create`. */
interface CommonsSessionCreateResponse {
  authorizeCode: string;
  qrPayload: string;
  status: string;
  /** Optional server-authoritative expiry; falls back to the client-proposed value. */
  expiresAt?: number;
  /** Optional server echo of the session token (the client-supplied value is authoritative). */
  sessionToken?: string;
}

export interface ServiceTokenResponse {
  token: string;
  expiresIn: number;
  appName: string;
}

/**
 * One cache entry per (apiKey hash) → issued token + the secret that produced it.
 * The secret is kept around in raw Buffer form so we can perform a
 * constant-time compare against any reused credential pair — this prevents an
 * attacker who learned a victim's apiKey from receiving the victim's cached
 * service token by simply guessing the secret.
 *
 * @internal
 */
interface ServiceTokenCacheEntry {
  token: string;
  /** Expiry as ms since epoch */
  expiresAt: number;
  /** Raw secret stored as Buffer for constant-time comparison on cache hit */
  secretBuf: Buffer;
  /** In-flight refresh promise (deduplicates concurrent callers) */
  pending: Promise<string> | null;
  /**
   * The raw apiKey that produced this entry. Retained so a targeted, fully
   * synchronous `invalidateServiceToken(apiKey)` can locate the entry without
   * re-deriving the async `SHA-256(apiKey)` Map key. Never logged or returned.
   */
  apiKey: string;
}

/**
 * Sentinel error raised when getServiceToken() is called with a known apiKey
 * but a non-matching secret. Indicates either credential drift in the caller
 * or a cross-tenant cache lookup attempt. Surface as a 401-equivalent.
 */
export class ServiceCredentialMismatchError extends Error {
  constructor() {
    super('Service credential mismatch: provided secret does not match the secret stored for this apiKey');
    this.name = 'ServiceCredentialMismatchError';
  }
}

export function OxyServicesAuthMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    /**
     * Per-credential token cache.
     *
     * Keyed by SHA-256(apiKey). Each entry carries:
     *   - the issued service JWT
     *   - its expiry timestamp
     *   - the secret that produced it (Buffer for constant-time compare)
     *   - an optional in-flight promise to deduplicate concurrent refreshes
     *
     * The previous implementation kept ONE token/exp pair per OxyServices
     * instance. That meant calling `getServiceToken(keyA, secretA)` populated
     * the cache, and a subsequent `getServiceToken(keyB, secretB)` (different
     * tenant) would receive tenant A's token. This is fixed by routing every
     * lookup through the Map.
     *
     * @internal
     */
    _serviceTokenCache = new Map<string, ServiceTokenCacheEntry>();

    /** @internal Raw apiKey stored by configureServiceAuth() for use by getServiceToken() */
    _serviceApiKey: string | null = null;
    /** @internal Raw apiSecret stored by configureServiceAuth() for use by getServiceToken() */
    _serviceApiSecret: string | null = null;

    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Hash an apiKey into a stable Map cache key. Uses Node's SHA-256 — service
     * tokens are only ever issued by a Node host (the SDK on web/RN never has
     * the apiSecret in the first place), so we can rely on Node crypto here.
     *
     * @internal
     */
    async _hashApiKey(apiKey: string): Promise<string> {
      const nodeCrypto = await loadNodeCrypto();
      return nodeCrypto.createHash('sha256').update(apiKey).digest('hex');
    }

    /**
     * Configure service credentials for internal service-to-service communication.
     * Call this once at startup so that getServiceToken() and makeServiceRequest()
     * can automatically obtain and refresh tokens.
     *
     * Calling this with credentials that differ from a previously-configured pair
     * is allowed — each `(apiKey, apiSecret)` pair is cached independently, so
     * legitimate multi-tenant hosts that need to switch credentials cannot leak
     * one tenant's token to another tenant on the same instance.
     *
     * @param apiKey - Application credential public key (oxy_dk_*)
     * @param apiSecret - Application credential secret
     */
    configureServiceAuth(apiKey: string, apiSecret: string): void {
      this._serviceApiKey = apiKey;
      this._serviceApiSecret = apiSecret;
    }

    /**
     * Get a service token for internal service-to-service communication.
     * Tokens are short-lived (1h) and automatically cached/refreshed per
     * `(apiKey, apiSecret)` pair.
     *
     * Concurrent callers for the same credential pair share a single in-flight
     * request to avoid hammering `/auth/service-token` when the cache is empty
     * or expired.
     *
     * **Security guarantee:** if the cache already holds a token for this
     * apiKey but the supplied apiSecret does not constant-time match the
     * secret that originally produced that token, this method throws
     * `ServiceCredentialMismatchError` instead of returning the cached token.
     * This prevents an attacker who learned a peer's apiKey from extracting
     * their service token by polling with a wrong secret.
     *
     * @param apiKey - Application credential public key (optional if configureServiceAuth was called)
     * @param apiSecret - Application credential secret (optional if configureServiceAuth was called)
     */
    async getServiceToken(apiKey?: string, apiSecret?: string): Promise<string> {
      const key = apiKey || this._serviceApiKey;
      const secret = apiSecret || this._serviceApiSecret;

      if (!key || !secret) {
        throw new Error('Service credentials not provided. Call configureServiceAuth() or pass apiKey and apiSecret.');
      }

      const cacheKey = await this._hashApiKey(key);
      const now = Date.now();
      const providedSecretBuf = Buffer.from(secret, 'utf8');

      let entry = this._serviceTokenCache.get(cacheKey);

      // Verify the secret on every cache hit, regardless of token freshness.
      // Constant-time compare prevents timing oracles on the stored secret.
      if (entry) {
        const nodeCrypto = await loadNodeCrypto();
        const storedSecretBuf = entry.secretBuf;
        const lengthMatch = storedSecretBuf.length === providedSecretBuf.length;
        // Always run timingSafeEqual on equal-length inputs to keep timing flat.
        // When lengths differ, run against a zero-padded copy of the same length
        // to avoid an early-return timing signal.
        const compareBuf = lengthMatch
          ? providedSecretBuf
          : Buffer.alloc(storedSecretBuf.length);
        const compareResult = nodeCrypto.timingSafeEqual(storedSecretBuf, compareBuf);
        if (!lengthMatch || !compareResult) {
          logger.warn('[oxy.auth] Service token cache hit with mismatched secret', {
            component: 'auth',
            method: 'getServiceToken',
          });
          throw new ServiceCredentialMismatchError();
        }

        // Return cached token if still valid (with 60s buffer for clock drift)
        if (entry.token && entry.expiresAt > now + 60_000) {
          return entry.token;
        }

        // If a fetch is already in-flight for this credential, share its result
        if (entry.pending) {
          return entry.pending;
        }
      } else {
        // First time seeing this apiKey on this instance — seed an empty entry
        // so concurrent callers serialize on the same promise.
        entry = {
          token: '',
          expiresAt: 0,
          secretBuf: providedSecretBuf,
          pending: null,
          apiKey: key,
        };
        this._serviceTokenCache.set(cacheKey, entry);
      }

      const pending = this._doFetchServiceToken(key, secret, cacheKey, providedSecretBuf);
      entry.pending = pending;
      try {
        return await pending;
      } catch (error) {
        // Do not retain unauthenticated cache entries. If the initial
        // /auth/service-token request fails (for example, wrong apiSecret),
        // leaving the pre-seeded empty entry would cause later calls with the
        // real secret for the same apiKey to fail locally as a credential
        // mismatch without ever contacting the server. Keep previously-issued
        // stale tokens on refresh failures, but remove never-authenticated
        // entries.
        const failed = this._serviceTokenCache.get(cacheKey);
        if (failed?.pending === pending && !failed.token) {
          this._serviceTokenCache.delete(cacheKey);
        }
        throw error;
      } finally {
        // Clear the in-flight slot; the entry itself (with fresh token / expiry)
        // is updated inside _doFetchServiceToken before we land here.
        const settled = this._serviceTokenCache.get(cacheKey);
        if (settled?.pending === pending) {
          settled.pending = null;
        }
      }
    }

    /**
     * Perform the actual /auth/service-token request and cache the result.
     * Separated so getServiceToken() can deduplicate concurrent calls.
     * @internal
     */
    async _doFetchServiceToken(
      key: string,
      secret: string,
      cacheKey: string,
      secretBuf: Buffer,
    ): Promise<string> {
      const response = await this.makeRequest<ServiceTokenResponse>(
        'POST',
        '/auth/service-token',
        { apiKey: key, apiSecret: secret },
        { cache: false, retry: false }
      );

      const expiresAt = Date.now() + response.expiresIn * 1000;
      // Update the entry in-place so any caller that already grabbed a reference
      // (via `_serviceTokenCache.get(...)`) sees the fresh state.
      const entry = this._serviceTokenCache.get(cacheKey);
      if (entry) {
        entry.token = response.token;
        entry.expiresAt = expiresAt;
        entry.secretBuf = secretBuf;
      } else {
        this._serviceTokenCache.set(cacheKey, {
          token: response.token,
          expiresAt,
          secretBuf,
          pending: null,
          apiKey: key,
        });
      }

      return response.token;
    }

    /**
     * Invalidate cached service token(s), forcing the next `getServiceToken()`
     * call to mint a fresh token from `/auth/service-token`.
     *
     * `getServiceToken()` only refreshes on expiry (with a 60s clock-drift
     * buffer), so a credential that is revoked or rotated mid-run — surfaced as
     * a 401 on a downstream service request — cannot otherwise be recovered
     * within the same process: the still-unexpired cached token keeps being
     * returned. Call this after such a 401 to clear the stale entry; the very
     * next `getServiceToken()` for that credential re-mints.
     *
     * Fully synchronous and deterministic: the call completes before it
     * returns, so a `getServiceToken()` issued immediately afterwards is
     * guaranteed to see the cleared cache and mint anew.
     *
     * @param apiKey - When provided, clears only the cache entry for that
     *   specific apiKey. When omitted, clears the entry for the credential set
     *   via `configureServiceAuth()`; if neither is available (no key to
     *   target), clears the entire cache. Passing no argument is the common
     *   case for hosts that configured a single service credential at startup.
     *
     * The cache Map is keyed by an asynchronously-computed `SHA-256(apiKey)`
     * that cannot be reproduced synchronously, so a targeted clear scans the
     * entries and removes the one whose stored raw `apiKey` matches — keeping
     * this method synchronous. The fully-untargeted call (no argument and no
     * configured key) clears every entry, which is safe because each credential
     * pair is independently re-minted on its next request.
     */
    invalidateServiceToken(apiKey?: string): void {
      const targetKey = apiKey ?? this._serviceApiKey;

      // No specific credential to target — clear everything. The next
      // getServiceToken() for any credential re-mints from scratch.
      if (!targetKey) {
        this._serviceTokenCache.clear();
        return;
      }

      for (const [cacheKey, entry] of this._serviceTokenCache) {
        if (entry.apiKey === targetKey) {
          this._serviceTokenCache.delete(cacheKey);
          return;
        }
      }
    }

    /**
     * Make an authenticated request on behalf of a user using a service token.
     * Automatically obtains/refreshes the service token.
     *
     * @param method - HTTP method
     * @param url - API endpoint URL
     * @param data - Request body or query params
     * @param userId - Optional user ID to act on behalf of (sent as X-Oxy-User-Id)
     */
    async makeServiceRequest<R = any>(
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      url: string,
      data?: any,
      userId?: string
    ): Promise<R> {
      const token = await this.getServiceToken();

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (userId) {
        headers['X-Oxy-User-Id'] = userId;
      }

      return this.makeRequest<R>(method, url, data, { headers, cache: false });
    }

    /**
     * Register a new identity with public key authentication
     * Identity is purely cryptographic - username and profile data are optional
     * 
     * @param publicKey - The user's ECDSA public key (hex)
     * @param signature - Signature of the registration request
     * @param timestamp - Timestamp when the signature was created
     */
    async register(
      publicKey: string,
      signature: string,
      timestamp: number
    ): Promise<{ message: string; user: User }> {
      try {
        const res = await this.makeRequest<{ message: string; user: User }>('POST', '/auth/register', {
          publicKey,
          signature,
          timestamp,
        }, { cache: false });

        if (!res || (typeof res === 'object' && Object.keys(res).length === 0)) {
          throw new OxyAuthenticationError('Registration failed', 'REGISTER_FAILED', 400);
        }

        return res;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Request an authentication challenge
     * The client must sign this challenge with their private key
     * 
     * @param publicKey - The user's public key
     */
    async requestChallenge(publicKey: string): Promise<ChallengeResponse> {
      try {
        return await this.makeRequest<ChallengeResponse>('POST', '/auth/challenge', {
          publicKey,
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Verify a signed challenge and create a session
     * 
     * @param publicKey - The user's public key
     * @param challenge - The challenge string from requestChallenge
     * @param signature - Signature of the auth message
     * @param timestamp - Timestamp when the signature was created
     * @param deviceName - Optional device name
     * @param deviceFingerprint - Optional device fingerprint
     */
    async verifyChallenge(
      publicKey: string,
      challenge: string,
      signature: string,
      timestamp: number,
      deviceName?: string,
      deviceFingerprint?: string
    ): Promise<SessionLoginResponse> {
      try {
        const res = await this.makeRequest<SessionLoginResponse>('POST', '/auth/verify', {
          publicKey,
          challenge,
          signature,
          timestamp,
          deviceName,
          deviceFingerprint,
        }, { cache: false });

        // Plant the freshly-minted tokens, mirroring `claimSessionByToken`.
        // `/auth/verify` returns the first access token (and refresh token) in
        // its body, so installing it here means callers get an authenticated
        // client without a second round-trip. Refresh stays in the httpOnly
        // cookie slot set by the API.
        if (res?.accessToken) {
          this.setTokens(res.accessToken);
        }

        return {
          ...res,
          user: normalizeUserIdentity(res.user),
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Check if a public key is already registered
     */
    async checkPublicKeyRegistered(publicKey: string): Promise<PublicKeyCheckResponse> {
      try {
        return await this.makeRequest<PublicKeyCheckResponse>(
          'GET',
          `/auth/check-publickey/${encodeURIComponent(publicKey)}`,
          undefined,
          { cache: false }
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user by public key
     */
    async getUserByPublicKey(publicKey: string): Promise<User> {
      try {
        const user = await this.makeRequest<User>(
          'GET',
          `/auth/user/${encodeURIComponent(publicKey)}`,
          undefined,
          { cache: true, cacheTTL: 2 * 60 * 1000 }
        );
        return normalizeUserIdentity(user);
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user by session ID
     */
    async getUserBySession(sessionId: string): Promise<User> {
      try {
        const user = await this.makeRequest<User>('GET', `/session/user/${sessionId}`, undefined, {
          cache: true,
          cacheTTL: 2 * 60 * 1000,
        });
        return normalizeUserIdentity(user);
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Batch get multiple user profiles by session IDs
     */
    async getUsersBySessions(sessionIds: string[]): Promise<Array<{ sessionId: string; user: User | null }>> {
      try {
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
          return [];
        }
        
        const uniqueSessionIds = Array.from(new Set(sessionIds)).sort();
        
        const users = await this.makeRequest<Array<{ sessionId: string; user: User | null }>>(
          'POST',
          '/session/users/batch',
          { sessionIds: uniqueSessionIds },
          {
            cache: true,
            cacheTTL: 2 * 60 * 1000,
            deduplicate: true,
          }
        );
        return users.map((entry) => ({
          ...entry,
          user: normalizeUserIdentityOrNull(entry.user),
        }));
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Exchange a device-flow sessionToken for the first access token.
     *
     * The originating client holds a 128-bit `sessionToken` that nobody
     * else has seen — it was generated client-side, sent once on
     * `POST /auth/session/create`, and is never echoed back. After
     * another authenticated device approves the session via
     * `POST /auth/session/authorize/{sessionToken}` (bearer-authed) and
     * the auth socket / poll loop notifies this client, the client
     * exchanges its `sessionToken` here for the first access token,
     * refresh token, sessionId, and the authorized user.
     *
     * This call requires no Authorization header — the high-entropy
     * `sessionToken` IS the credential (RFC 8628 §3.4). The exchange is
     * single-use; replay attempts are rejected with 401.
     *
     * @param sessionToken - The same sessionToken the SDK passed to
     *   `POST /auth/session/create` at the start of the flow.
     * @param options.deviceFingerprint - Optional fingerprint of the
     *   originating client device.
     */
    async claimSessionByToken(
      sessionToken: string,
      options: { deviceFingerprint?: string } = {}
    ): Promise<{
      accessToken: string;
      sessionId: string;
      deviceId: string;
      expiresAt: string;
      user: User;
    }> {
      try {
        const res = await this.makeRequest<{
          accessToken: string;
          sessionId: string;
          deviceId: string;
          expiresAt: string;
          user: User;
        }>(
          'POST',
          '/auth/session/claim',
          {
            sessionToken,
            ...(options.deviceFingerprint ? { deviceFingerprint: options.deviceFingerprint } : {}),
          },
          { cache: false, retry: false }
        );

        this.setTokens(res.accessToken);

        return res;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    // =======================================================================
    // "Sign in with Oxy" — handoff (Workstream C)
    //
    // Two mechanisms share the same challenge/verify + device-flow primitives:
    //   A. Same-device shared-keychain SSO (`signInWithSharedIdentity`): a
    //      sibling native app silently mints its own session from the shared
    //      identity key. No user interaction.
    //   B. QR / app-to-app handoff: a relying party (`startCommonsSignIn` +
    //      `pollCommonsSignIn` + the existing `claimSessionByToken`) and the
    //      approver / Commons (`getCommonsApprovalInfo` + `approveCommonsSignIn`
    //      / `denyCommonsSignIn`). The approver signs with its PRIMARY local
    //      key; the RP never sees the private key.
    // =======================================================================

    /**
     * MECHANISM A — same-device shared-keychain SSO.
     *
     * Native-only. If this device holds a shared identity (the cross-app
     * `group.so.oxy.shared` keychain key), prove control of it and mint a
     * session: `requestChallenge(sharedPublicKey)` → `signChallengeWithSharedKey`
     * → `verifyChallenge` (which plants the tokens). Returns `null` on web or
     * when no shared identity is present — never throws for the absent-identity
     * case, so a cold-boot caller can fall through to the next step.
     *
     * The cold-boot wiring that CALLS this lives in `OxyContext`
     * (`@oxyhq/services`); this method just performs the exchange.
     */
    async signInWithSharedIdentity(
      opts: { deviceName?: string; deviceFingerprint?: string } = {}
    ): Promise<SessionLoginResponse | null> {
      try {
        // `hasSharedIdentity()` already returns false on web (the shared
        // keychain is native-only), so this short-circuits the web case without
        // a wasted challenge round-trip.
        if (!(await KeyManager.hasSharedIdentity())) {
          return null;
        }
        const sharedPublicKey = await KeyManager.getSharedPublicKey();
        if (!sharedPublicKey) {
          return null;
        }

        const { challenge } = await this.requestChallenge(sharedPublicKey);
        const signed = await SignatureService.signChallengeWithSharedKey(challenge);

        // `signed.challenge` carries the SIGNATURE (mirrors `signChallenge`).
        return await this.verifyChallenge(
          signed.publicKey,
          challenge,
          signed.challenge,
          signed.timestamp,
          opts.deviceName,
          opts.deviceFingerprint,
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * MECHANISM B (relying party) — begin a "Sign in with Oxy" handoff.
     *
     * Generates a secret device-flow `sessionToken` client-side (it never
     * appears in the QR), registers it with `POST /auth/session/create`, and
     * returns the server-issued public `authorizeCode` + ready-to-render
     * `qrPayload`. Render the QR (web) / open the deep-link (same-device); the
     * approver resolves the code and authorizes. Then poll with
     * {@link pollCommonsSignIn} and, on `authorized`, exchange the
     * `sessionToken` via the existing `claimSessionByToken`.
     *
     * @param params.clientId - The RP's registered OAuth client id
     *   (ApplicationCredential publicKey); required so the server can resolve the
     *   requesting application's identity.
     */
    async startCommonsSignIn(params: { clientId: string }): Promise<CommonsSignInHandle> {
      try {
        // High-entropy opaque secret token (256-bit hex). Generated client-side
        // and held only here; the server stores it but never returns it in the
        // QR. Reuses the platform-safe random generator.
        const sessionToken = await SignatureService.generateChallenge();
        const expiresAt = Date.now() + COMMONS_SIGN_IN_EXPIRY_MS;

        const res = await this.makeRequest<CommonsSessionCreateResponse>(
          'POST',
          '/auth/session/create',
          { sessionToken, expiresAt, clientId: params.clientId },
          { cache: false }
        );

        return {
          sessionToken,
          authorizeCode: res.authorizeCode,
          qrPayload: res.qrPayload,
          expiresAt: res.expiresAt ?? expiresAt,
          status: res.status,
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * MECHANISM B (relying party) — poll a device-flow session for approval.
     *
     * Backstop for the auth socket. On `authorized` (with a `sessionId`), the
     * caller exchanges the secret `sessionToken` via the existing
     * `claimSessionByToken` to mint the first access token.
     *
     * @param sessionToken - The secret token from {@link startCommonsSignIn}.
     */
    async pollCommonsSignIn(sessionToken: string): Promise<CommonsSignInStatus> {
      try {
        return await this.makeRequest<CommonsSignInStatus>(
          'GET',
          `/auth/session/status/${encodeURIComponent(sessionToken)}`,
          undefined,
          { cache: false, retry: false }
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * MECHANISM B (approver / Commons) — resolve the TRUSTED identity of a
     * sign-in request from its public `authorizeCode`.
     *
     * The returned `application` is resolved server-side and is the only safe
     * thing to display in the approval UI — NEVER trust the app/name/origin
     * strings carried in the QR payload. Public (no auth required).
     *
     * @param authorizeCode - The public code scanned from the QR / deep-link.
     */
    async getCommonsApprovalInfo(authorizeCode: string): Promise<CommonsApprovalInfo> {
      try {
        const raw = await this.makeRequest<CommonsApprovalInfoResponse>(
          'GET',
          `/auth/session/approve-info/${encodeURIComponent(authorizeCode)}`,
          undefined,
          { cache: false }
        );
        return {
          application: raw.application,
          scopes: raw.scopes,
          boundOrigin: raw.boundOrigin,
          // Fail-safe: only a literal boolean `true` counts as verified. A
          // missing or non-boolean value (older server, malformed response)
          // coerces to `false` so a stale server can never imply trust.
          originVerified: raw.originVerified === true,
          expiresAt: raw.expiresAt,
          status: raw.status,
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * MECHANISM B (approver / Commons) — approve a sign-in request by signing a
     * fresh challenge with the PRIMARY local identity key.
     *
     * Commons holds the user's identity as its primary key (not the shared
     * key), so this uses `signChallenge`. The signed-but-cookieless authorize
     * endpoint resolves the user from the verified signer — the RP that started
     * the flow then claims its session. Native-only (requires a local identity).
     *
     * @param params.authorizeCode - The public code being approved.
     * @param params.deviceName - Optional human-readable device label.
     * @param params.deviceFingerprint - Optional device fingerprint.
     */
    async approveCommonsSignIn(params: {
      authorizeCode: string;
      deviceName?: string;
      deviceFingerprint?: string;
    }): Promise<CommonsSignInActionResult> {
      try {
        const publicKey = await KeyManager.getPublicKey();
        if (!publicKey) {
          throw new Error('No identity found on this device. Create or import an identity first.');
        }

        const { challenge } = await this.requestChallenge(publicKey);
        const signed = await SignatureService.signChallenge(challenge);

        return await this.makeRequest<CommonsSignInActionResult>(
          'POST',
          `/auth/session/authorize-signed/${encodeURIComponent(params.authorizeCode)}`,
          {
            // `signed.challenge` carries the SIGNATURE; `challenge` is the
            // original server-issued challenge string.
            publicKey: signed.publicKey,
            challenge,
            signature: signed.challenge,
            timestamp: signed.timestamp,
            ...(params.deviceName ? { deviceName: params.deviceName } : {}),
            ...(params.deviceFingerprint ? { deviceFingerprint: params.deviceFingerprint } : {}),
          },
          { cache: false }
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * MECHANISM B (approver / Commons) — deny a sign-in request, cancelling the
     * device-flow session so the RP stops waiting.
     *
     * @param authorizeCode - The public code being denied.
     */
    async denyCommonsSignIn(authorizeCode: string): Promise<CommonsSignInActionResult> {
      try {
        return await this.makeRequest<CommonsSignInActionResult>(
          'POST',
          `/auth/session/deny/${encodeURIComponent(authorizeCode)}`,
          undefined,
          { cache: false }
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Internal: decode (without verifying) the `sessionId` claim from a
     * server-signed access token. The server already verified the signature;
     * the client only reads the claim to drive multi-session state.
     *
     * @internal
     */
    _decodeSessionIdFromAccessToken(token: string): string | null {
      if (!token || typeof token !== 'string') {
        return null;
      }
      const segments = token.split('.');
      if (segments.length !== 3) {
        return null;
      }
      const payloadSegment = segments[1];
      if (!payloadSegment) {
        return null;
      }
      try {
        const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
        if (typeof atob !== 'function') {
          return null;
        }
        const json = decodeURIComponent(
          atob(padded)
            .split('')
            .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
            .join(''),
        );
        const parsed: unknown = JSON.parse(json);
        if (parsed === null || typeof parsed !== 'object') {
          return null;
        }
        const claims = parsed as Record<string, unknown>;
        return typeof claims.sessionId === 'string' ? claims.sessionId : null;
      } catch {
        return null;
      }
    }

    /**
     * Get sessions by session ID
     */
    async getSessionsBySessionId(sessionId: string): Promise<any[]> {
      try {
        return await this.makeRequest('GET', `/session/sessions/${sessionId}`, undefined, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Logout from a specific session
     */
    async logoutSession(sessionId: string, targetSessionId?: string): Promise<void> {
      try {
        const url = targetSessionId 
          ? `/session/logout/${sessionId}/${targetSessionId}`
          : `/session/logout/${sessionId}`;
        
        await this.makeRequest('POST', url, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Logout from all sessions
     */
    async logoutAllSessions(sessionId: string): Promise<void> {
      try {
        await this.makeRequest('POST', `/session/logout-all/${sessionId}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Validate session
     */
    async validateSession(
      sessionId: string,
      options: {
        deviceFingerprint?: string;
        useHeaderValidation?: boolean;
      } = {}
    ): Promise<{
      valid: boolean;
      expiresAt: string;
      lastActivity: string;
      user: User;
      sessionId?: string;
      source?: string;
    }> {
      try {
        const urlParams: Record<string, string> = {};
        if (options.deviceFingerprint) urlParams.deviceFingerprint = options.deviceFingerprint;
        if (options.useHeaderValidation) urlParams.useHeaderValidation = 'true';
        const validation = await this.makeRequest<{
          valid: boolean;
          expiresAt: string;
          lastActivity: string;
          user: User;
          sessionId?: string;
          source?: string;
        }>('GET', `/session/validate/${sessionId}`, urlParams, { cache: false });
        return {
          ...validation,
          user: normalizeUserIdentity(validation.user),
        };
      } catch (error) {
        // Session is invalid — clear any cached user data for this session (#196)
        this.clearCacheEntry(`GET:/session/user/${sessionId}`);
        throw this.handleError(error);
      }
    }

    /**
     * Check username availability
     */
    async checkUsernameAvailability(username: string): Promise<{ available: boolean; message: string }> {
      try {
        return await this.makeRequest('GET', `/auth/check-username/${username}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Check email availability
     */
    async checkEmailAvailability(email: string): Promise<{ available: boolean; message: string }> {
      try {
        return await this.makeRequest('GET', `/auth/check-email/${email}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Register a new user with email/username and password
     */
    async signUp(
      username: string,
      email: string,
      password: string,
      deviceName?: string,
      deviceFingerprint?: any
    ): Promise<SessionLoginResponse> {
      try {
        const session = await this.makeRequest<SessionLoginResponse>('POST', '/auth/signup', {
          username,
          email,
          password,
          deviceName,
          deviceFingerprint,
        }, { cache: false });
        return {
          ...session,
          user: normalizeUserIdentity(session.user),
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Sign in with email or username and password
     */
    async signIn(
      identifier: string,
      password: string,
      deviceName?: string,
      deviceFingerprint?: any
    ): Promise<SessionLoginResponse> {
      try {
        const session = await this.makeRequest<SessionLoginResponse>('POST', '/auth/login', {
          identifier,
          password,
          deviceName,
          deviceFingerprint,
        }, { cache: false });
        return {
          ...session,
          user: normalizeUserIdentity(session.user),
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Convenience helper for email sign-in
     */
    async signInWithEmail(
      email: string,
      password: string,
      deviceName?: string,
      deviceFingerprint?: any
    ): Promise<SessionLoginResponse> {
      return this.signIn(email, password, deviceName, deviceFingerprint);
    }

    /**
     * Device-first password sign-in. Unlike the legacy {@link signIn} (which
     * assumes a one-step session and is kept intact for existing callers until
     * the F4 cutover), this returns the FULL `POST /auth/login` contract — the
     * discriminated {@link LoginResult}: either a 2FA challenge
     * (`{ twoFactorRequired, loginToken }`) to complete via
     * {@link completeTwoFactorSignIn}, or a session arm.
     *
     * On the session arm, a returned access token is planted immediately
     * (mirroring {@link verifyChallenge}), so the caller has an authenticated
     * client without a second round-trip. The response's `deviceId` +
     * `deviceSecret` are the zero-cookie restore credential the caller persists.
     */
    async passwordSignIn(
      identifier: string,
      password: string,
      options: { deviceName?: string; deviceFingerprint?: string; deviceId?: string } = {},
    ): Promise<LoginResult> {
      try {
        const res = await this.makeRequest<unknown>('POST', '/auth/login', {
          identifier,
          password,
          deviceName: options.deviceName,
          deviceFingerprint: options.deviceFingerprint,
          ...(options.deviceId ? { deviceId: options.deviceId } : {}),
        }, { cache: false });
        const parsed = safeParseContract(loginResultSchema, res);
        if (!parsed) {
          throw new Error('auth/login returned an unexpected response shape');
        }
        if (!('twoFactorRequired' in parsed) && parsed.accessToken) {
          this.setTokens(parsed.accessToken);
        }
        return parsed;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Complete a 2FA-gated sign-in started by {@link passwordSignIn}. Presents
     * the short-lived `loginToken` with either a TOTP `token` or a `backupCode`
     * to `POST /security/2fa/verify-login`, which must resolve to the session
     * arm of {@link LoginResult} (a second 2FA challenge here is a protocol
     * error). A returned access token is planted immediately.
     */
    async completeTwoFactorSignIn(params: {
      loginToken: string;
      token?: string;
      backupCode?: string;
      deviceName?: string;
      deviceId?: string;
    }): Promise<LoginSessionResult> {
      try {
        const res = await this.makeRequest<unknown>('POST', '/security/2fa/verify-login', {
          loginToken: params.loginToken,
          token: params.token,
          backupCode: params.backupCode,
          deviceName: params.deviceName,
          ...(params.deviceId ? { deviceId: params.deviceId } : {}),
        }, { cache: false });
        const parsed = safeParseContract(loginResultSchema, res);
        if (!parsed || 'twoFactorRequired' in parsed) {
          throw new Error('security/2fa/verify-login returned an unexpected response shape');
        }
        if (parsed.accessToken) {
          this.setTokens(parsed.accessToken);
        }
        return parsed;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Mint a one-shot handoff code so auth.oxy.so can plant the same
     * DeviceSession credentials (cross-origin hub, zero cookies).
     */
    async createIdpHandoff(): Promise<{ handoffCode: string; expiresIn: number }> {
      try {
        const res = await this.makeRequest<{ handoffCode: string; expiresIn: number }>(
          'POST',
          '/auth/idp-handoff/create',
          {},
          { cache: false },
        );
        const payload = (res as { data?: { handoffCode: string; expiresIn: number } }).data ?? res;
        if (!payload?.handoffCode) {
          throw new Error('idp-handoff/create returned an unexpected response shape');
        }
        return {
          handoffCode: payload.handoffCode,
          expiresIn: payload.expiresIn ?? 30,
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Exchange a one-shot IdP handoff code for device credentials (called from
     * auth.oxy.so only).
     */
    async exchangeIdpHandoff(handoffCode: string): Promise<LoginSessionResult> {
      try {
        const res = await this.makeRequest<unknown>(
          'POST',
          '/auth/idp-handoff/exchange',
          { handoffCode },
          { cache: false },
        );
        const payload =
          (res as { data?: Record<string, unknown> }).data ??
          (res as Record<string, unknown>);
        if (!payload || typeof payload !== 'object') {
          throw new Error('idp-handoff/exchange returned an unexpected response shape');
        }
        const record = payload as Record<string, unknown>;
        const accessToken = record.accessToken as string | undefined;
        const sessionId = record.sessionId as string | undefined;
        const deviceId = record.deviceId as string | undefined;
        const deviceSecret = record.deviceSecret as string | undefined;
        const userRaw = record.user;
        if (!sessionId || !deviceId || !deviceSecret || !userRaw || typeof userRaw !== 'object') {
          throw new Error('idp-handoff/exchange returned an incomplete session payload');
        }
        const userObj = userRaw as Record<string, unknown>;
        const userId = userObj.id as string | undefined;
        if (!userId) {
          throw new Error('idp-handoff/exchange returned a session without user.id');
        }
        const expiresAt =
          typeof record.expiresAt === 'string'
            ? record.expiresAt
            : new Date(Date.now() + 15 * 60 * 1000).toISOString();
        if (accessToken) {
          this.setTokens(accessToken);
        }
        return {
          sessionId,
          deviceId,
          deviceSecret,
          expiresAt,
          accessToken,
          user: {
            id: userId,
            username: typeof userObj.username === 'string' ? userObj.username : undefined,
            avatar: typeof userObj.avatar === 'string' ? userObj.avatar : undefined,
          },
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Exchange an OAuth authorization code (returned to the RP redirect URI
     * after password sign-in at auth.oxy.so) for a device-first session.
     * Public first-party clients use PKCE (`codeVerifier`); the access token is
     * planted immediately on success.
     */
    async exchangeOAuthCode(params: {
      code: string;
      clientId: string;
      redirectUri: string;
      codeVerifier: string;
    }): Promise<LoginSessionResult> {
      try {
        const res = await this.makeRequest<unknown>('POST', '/auth/oauth/token', {
          code: params.code,
          clientId: params.clientId,
          redirectUri: params.redirectUri,
          codeVerifier: params.codeVerifier,
        }, { cache: false });
        const payload =
          (res as { data?: Record<string, unknown> }).data ??
          (res as Record<string, unknown>);
        if (!payload || typeof payload !== 'object') {
          throw new Error('auth/oauth/token returned an unexpected response shape');
        }
        const record = payload as Record<string, unknown>;
        const accessToken = (record.access_token ?? record.accessToken) as string | undefined;
        const sessionId = (record.session_id ?? record.sessionId) as string | undefined;
        const deviceId = (record.deviceId ?? record.device_id) as string | undefined;
        const deviceSecret = (record.deviceSecret ?? record.device_secret) as string | undefined;
        const userRaw = record.user;
        if (!sessionId || !deviceId || !userRaw || typeof userRaw !== 'object') {
          throw new Error('auth/oauth/token returned an incomplete session payload');
        }
        const userObj = userRaw as Record<string, unknown>;
        const userId = userObj.id as string | undefined;
        if (!userId) {
          throw new Error('auth/oauth/token returned a session without user.id');
        }
        const expiresInSec =
          typeof record.expires_in === 'number'
            ? record.expires_in
            : typeof record.expiresIn === 'number'
              ? record.expiresIn
              : 15 * 60;
        const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();
        if (accessToken) {
          this.setTokens(accessToken);
        }
        return {
          sessionId,
          deviceId,
          expiresAt,
          accessToken,
          deviceSecret,
          user: {
            id: userId,
            username: typeof userObj.username === 'string' ? userObj.username : undefined,
            avatar: typeof userObj.avatar === 'string' ? userObj.avatar : undefined,
          },
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

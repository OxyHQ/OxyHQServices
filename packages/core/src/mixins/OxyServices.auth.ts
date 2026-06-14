/**
 * Authentication Methods Mixin
 *
 * Supports password-based login (email/username) and public key challenge-response.
 */
import type {
  User,
  RefreshAllResponse,
  RefreshAllAccount,
  RefreshCookieResponse,
} from '../models/interfaces';
import type { SessionLoginResponse } from '../models/session';
import type { OxyServicesBase } from '../OxyServices.base';
import { OxyAuthenticationError } from '../OxyServices.errors';
import { loadNodeCrypto } from '../utils/platformCrypto';
import { logger } from '../utils/loggerUtils';

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
     * @param apiKey - DeveloperApp API key (oxy_dk_*)
     * @param apiSecret - DeveloperApp API secret
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
     * @param apiKey - DeveloperApp API key (optional if configureServiceAuth was called)
     * @param apiSecret - DeveloperApp API secret (optional if configureServiceAuth was called)
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
      } finally {
        // Clear the in-flight slot; the entry itself (with fresh token / expiry)
        // is updated inside _doFetchServiceToken before we land here.
        const settled = this._serviceTokenCache.get(cacheKey);
        if (settled) {
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
        // client without a second round-trip — and, critically, without
        // falling back to the bearer-protected `GET /session/token/:sessionId`
        // (C1 hardening), which 401s for a brand-new identity that has no
        // bearer yet. `accessToken`/`refreshToken` are optional on
        // SessionLoginResponse; only plant when an access token is present and
        // default the refresh token to an empty string.
        if (res?.accessToken) {
          this.setTokens(res.accessToken, res.refreshToken ?? '');
        }

        return res;
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
        return await this.makeRequest<User>(
          'GET',
          `/auth/user/${encodeURIComponent(publicKey)}`,
          undefined,
          { cache: true, cacheTTL: 2 * 60 * 1000 }
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user by session ID
     */
    async getUserBySession(sessionId: string): Promise<User> {
      try {
        return await this.makeRequest<User>('GET', `/session/user/${sessionId}`, undefined, {
          cache: true,
          cacheTTL: 2 * 60 * 1000,
        });
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
        
        return await this.makeRequest<Array<{ sessionId: string; user: User | null }>>(
          'POST',
          '/session/users/batch',
          { sessionIds: uniqueSessionIds },
          {
            cache: true,
            cacheTTL: 2 * 60 * 1000,
            deduplicate: true,
          }
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get access token by session ID
     *
     * SECURITY: this endpoint requires the caller to already hold a
     * bearer token whose user owns the referenced session (C1 hardening
     * in the API). For the device-flow / QR sign-in case where the
     * client has no bearer token yet, use `claimSessionByToken` instead.
     */
    async getTokenBySession(sessionId: string): Promise<{ accessToken: string; expiresAt: string }> {
      try {
        const res = await this.makeRequest<{ accessToken: string; expiresAt: string }>(
          'GET',
          `/session/token/${sessionId}`,
          undefined,
          { cache: false, retry: false }
        );

        this.setTokens(res.accessToken);

        return res;
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
      refreshToken: string;
      sessionId: string;
      deviceId: string;
      expiresAt: string;
      user: User;
    }> {
      try {
        const res = await this.makeRequest<{
          accessToken: string;
          refreshToken: string;
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

        this.setTokens(res.accessToken, res.refreshToken);

        return res;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Refresh every device-local refresh-cookie slot in a single round trip
     * (Google-style multi-account rebuild).
     *
     * Calls `POST {sessionBaseUrl}/auth/refresh-all` with `credentials: 'include'`
     * and NO bearer. The browser attaches every `oxy_rt*` cookie it has; the
     * server rotates each in parallel and returns one entry per VALID account.
     *
     * Failure handling:
     * - 401 → no signed-in accounts on this device → returns `{ accounts: [] }`
     *   (NOT an error; this is the cold-boot "not signed in" path).
     * - 404 → server is older than the multi-account endpoint. We fall back to
     *   `POST /auth/refresh` (single-slot) and wrap its response in the
     *   refresh-all shape so callers can treat the two paths uniformly. The
     *   fallback entry has `authuser: 0` (the legacy slot maps to slot 0 by
     *   convention) and a minimal `user` shape — consumers needing the full
     *   user must fetch it separately. Always exactly one account in this
     *   shape.
     * - Any other non-2xx → throws via `handleError`.
     *
     * The refresh cookie itself never enters JS — only the rotated access
     * tokens do. Each access token still needs to be planted via
     * `setTokens(...)` (or per-account in-memory storage) at the consumer.
     */
    async refreshAllSessions(): Promise<RefreshAllResponse> {
      const url = `${this.getSessionBaseUrl().replace(/\/$/, '')}/auth/refresh-all`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
      } catch (error) {
        throw this.handleError(error);
      }

      if (response.status === 401) {
        return { accounts: [] };
      }

      if (response.status === 404) {
        // Legacy single-account refresh fallback. Wrap the response so the
        // caller can treat both paths identically.
        const legacy = await this._refreshCookieRaw();
        if (!legacy) {
          return { accounts: [] };
        }
        const fallbackAccount: RefreshAllAccount = {
          authuser: 0,
          accessToken: legacy.accessToken,
          expiresAt: legacy.expiresAt,
          sessionId: this._decodeSessionIdFromAccessToken(legacy.accessToken) ?? '',
          // Legacy /auth/refresh does NOT project the user shape; the caller
          // (AuthManager) is expected to hydrate via /users/me after planting.
          user: null,
        };
        return { accounts: [fallbackAccount] };
      }

      if (!response.ok) {
        throw this.handleError(
          new Error(`Refresh-all failed with HTTP ${response.status}`)
        );
      }

      const payload = (await response.json()) as { accounts?: unknown };
      const raw = Array.isArray(payload.accounts) ? payload.accounts : [];
      const accounts: RefreshAllAccount[] = [];

      for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') {
          continue;
        }
        const e = entry as {
          authuser?: number | null;
          accessToken?: string;
          expiresAt?: string;
          sessionId?: string;
          user?: { id?: string; _id?: string; username?: string; name?: string; avatar?: string | null; email?: string; color?: string | null };
        };
        if (!e.accessToken || !e.expiresAt || !e.sessionId || !e.user) {
          continue;
        }
        const userId = e.user.id ?? e.user._id;
        if (!userId || !e.user.username) {
          continue;
        }
        // Normalise the legacy un-suffixed cookie (`authuser: null` on the
        // wire) to slot 0. The SDK surface always operates on numeric indices.
        const authuser = typeof e.authuser === 'number' ? e.authuser : 0;
        accounts.push({
          authuser,
          accessToken: e.accessToken,
          expiresAt: e.expiresAt,
          sessionId: e.sessionId,
          user: {
            id: userId,
            username: e.user.username,
            name: e.user.name,
            avatar: e.user.avatar ?? null,
            email: e.user.email,
            color: e.user.color ?? null,
          },
        });
      }

      return { accounts };
    }

    /**
     * Rotate a single refresh-cookie slot and return the fresh access token.
     *
     * When `authuser` is provided, the server rotates ONLY that slot
     * (`oxy_rt_${authuser}`) — sibling accounts on the same device stay
     * untouched. When omitted, the server picks the lowest indexed slot
     * present (legacy fallback applies). The refresh cookie itself never
     * enters JS.
     *
     * Returns `null` on 401 (no cookie / expired / reused) so the caller can
     * fall through cleanly to the unauthenticated path.
     */
    async refreshTokenViaCookie(
      opts: { authuser?: number } = {}
    ): Promise<RefreshCookieResponse | null> {
      const result = await this._refreshCookieRaw(opts.authuser);
      return result;
    }

    /**
     * Sign out a single device-local account by its authuser slot index.
     *
     * Revokes that slot's refresh-token family and deactivates its session;
     * sibling indexed slots stay signed in. The browser-side `oxy_rt_${n}`
     * cookie is cleared by the server's `Set-Cookie` response header.
     */
    async logoutSessionByAuthuser(authuser: number): Promise<void> {
      const url = `${this.getSessionBaseUrl().replace(/\/$/, '')}/auth/logout?authuser=${encodeURIComponent(String(authuser))}`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok && response.status !== 401) {
          throw new Error(`Logout (authuser=${authuser}) failed with HTTP ${response.status}`);
        }
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Sign out EVERY device-local account on this device by clearing every
     * presented refresh-cookie slot at once. Revokes every family + clears
     * every slot. Always succeeds (idempotent on unknown/garbage tokens).
     */
    async logoutAllSessionsViaCookie(): Promise<void> {
      const url = `${this.getSessionBaseUrl().replace(/\/$/, '')}/auth/logout`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok && response.status !== 401) {
          throw new Error(`Logout-all failed with HTTP ${response.status}`);
        }
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Internal: raw `POST /auth/refresh[?authuser=N]` call returning the
     * minted access token. Returns `null` on 401 / non-2xx. Used as both the
     * implementation of `refreshTokenViaCookie` and the legacy fallback for
     * `refreshAllSessions` against older servers.
     *
     * @internal
     */
    async _refreshCookieRaw(authuser?: number): Promise<RefreshCookieResponse | null> {
      const base = this.getSessionBaseUrl().replace(/\/$/, '');
      const url = typeof authuser === 'number'
        ? `${base}/auth/refresh?authuser=${encodeURIComponent(String(authuser))}`
        : `${base}/auth/refresh`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
      } catch (error) {
        throw this.handleError(error);
      }

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        accessToken?: unknown;
        expiresAt?: unknown;
        authuser?: unknown;
      };
      if (typeof payload.accessToken !== 'string' || !payload.accessToken) {
        return null;
      }
      const expiresAt = typeof payload.expiresAt === 'string' ? payload.expiresAt : '';
      const respAuthuser = typeof payload.authuser === 'number' ? payload.authuser : null;
      return {
        accessToken: payload.accessToken,
        expiresAt,
        authuser: respAuthuser,
      };
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
        return await this.makeRequest('GET', `/session/validate/${sessionId}`, urlParams, { cache: false });
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
        return await this.makeRequest<SessionLoginResponse>('POST', '/auth/signup', {
          username,
          email,
          password,
          deviceName,
          deviceFingerprint,
        }, { cache: false });
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
        return await this.makeRequest<SessionLoginResponse>('POST', '/auth/login', {
          identifier,
          password,
          deviceName,
          deviceFingerprint,
        }, { cache: false });
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
  };
}

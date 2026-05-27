/**
 * Authentication Methods Mixin
 *
 * Supports password-based login (email/username) and public key challenge-response.
 */
import type { User } from '../models/interfaces';
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
        });
      }

      return response.token;
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
        return await this.makeRequest<SessionLoginResponse>('POST', '/auth/verify', {
          publicKey,
          challenge,
          signature,
          timestamp,
          deviceName,
          deviceFingerprint,
        }, { cache: false });
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

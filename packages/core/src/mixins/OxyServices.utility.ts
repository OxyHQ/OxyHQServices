/**
 * Utility Methods Mixin
 *
 * Provides utility methods including link metadata fetching
 * and Express.js authentication middleware
 */
import { jwtDecode } from 'jwt-decode';
import type { LinkPreview } from '@oxyhq/contracts';
import type { ApiError, User } from '../models/interfaces';
import type { OxyServicesBase } from '../OxyServices.base';
import { loadNodeCrypto } from '@oxyhq/protocol';
import { buildUrl } from '../utils/apiUtils';
import { logger } from '../utils/loggerUtils';
import { CACHE_TIMES } from './mixinHelpers';

interface JwtPayload {
  exp?: number;
  userId?: string;
  id?: string;
  sessionId?: string;
  type?: string;
  appId?: string;
  credentialId?: string;
  appName?: string;
  scopes?: string[];
  aud?: string | string[];
  iss?: string;
  [key: string]: unknown;
}

/**
 * Result from the service-acting-as verification endpoint.
 * Confirms that a given service app holds an active delegation grant for
 * the supplied user, along with the explicit scope list the grant covers.
 *
 * The api side persists these via the `ServiceActingAs` model:
 *   { serviceAppId, userId, scopes: string[], grantedAt, expiresAt }
 *
 * The SDK never inspects the grant directly — it round-trips through
 * `GET /internal/service-acting-as/verify?appId=...&userId=...` so the
 * authoritative store stays server-side.
 */
export interface ServiceActingAsVerification {
  authorized: boolean;
  scopes: string[];
}

/**
 * Service app metadata attached to requests authenticated with service tokens.
 * `scopes` reflects the scopes granted to the app at signup time (from the
 * `Application.scopes` field); route-level checks can require additional
 * scope-narrowing via `requireScope()`.
 */
export interface ServiceApp {
  appId: string;
  appName: string;
  scopes: string[];
  /** The credentialId of the specific service credential that minted this token. */
  credentialId: string;
}

/**
 * Expected JWT audience for tokens issued by the Oxy auth service.
 */
const OXY_JWT_AUDIENCE = 'oxy-api';
/**
 * Expected JWT issuer for tokens issued by the Oxy auth service.
 */
const OXY_JWT_ISSUER = 'oxy-auth';

/**
 * Sentinel error classes for service-token verification. Using classes (not
 * message strings) makes the catch site below safe to extend: a new failure
 * mode added later cannot silently fall through to the generic 500 branch.
 */
class ServiceTokenStructureError extends Error {
  constructor(message = 'Service token has malformed structure') {
    super(message);
    this.name = 'ServiceTokenStructureError';
  }
}

class ServiceTokenSignatureError extends Error {
  constructor(message = 'Service token signature is invalid') {
    super(message);
    this.name = 'ServiceTokenSignatureError';
  }
}

class ServiceTokenClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceTokenClaimError';
  }
}

/**
 * Options for oxyClient.auth() middleware
 */
interface AuthMiddlewareOptions {
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Custom error handler - receives error object, can return response */
  onError?: (error: ApiError) => unknown;
  /** Load full user profile from API (default: false for performance) */
  loadUser?: boolean;
  /** Optional auth - attach user if token present but don't block (default: false) */
  optional?: boolean;
  /**
   * JWT secret for verifying service token signatures locally.
   * When provided, service tokens will be cryptographically verified.
   * When omitted, service tokens will be rejected (secure default).
   *
   * **Migration note (>=1.11.14):** the Oxy API now signs service tokens
   * with a dedicated `SERVICE_TOKEN_SECRET` distinct from `ACCESS_TOKEN_SECRET`.
   * Pass that value here. If you keep passing the access-token secret you will
   * still verify ALL signed-by-Oxy tokens (which is the whole class of bug
   * H4 was supposed to prevent — DO NOT do that in production).
   */
  jwtSecret?: string;
  /**
   * Expected JWT issuer. Defaults to `'oxy-auth'`. Override only if you run
   * a private fork of the Oxy auth server under a different `iss` claim.
   */
  expectedIssuer?: string;
  /**
   * Expected JWT audience. Defaults to `'oxy-api'`. Override only if your
   * private fork mints tokens for a different audience.
   */
  expectedAudience?: string;
}

export function OxyServicesUtilityMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    /**
     * In-memory cache for service-acting-as verification.
     * Negative results are cached for 1min to avoid hammering the verify
     * endpoint when a service is misconfigured; positive grants are cached
     * for 5min to amortize the round-trip without holding stale grants too long.
     * @internal
     */
    _serviceActingAsCache = new Map<string, { result: ServiceActingAsVerification | null; expiresAt: number }>();

    // TypeScript's mixin pattern requires `(...args: any[])` here — the
    // constructor signature is a structural shape check the compiler enforces.
    // Matches every other mixin in this package; do not change without a
    // monorepo-wide refactor of the mixin pipeline.
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Verify that a service app holds an active delegation grant authorising
     * it to act on behalf of `userId`. Returns the grant (with allowed scopes)
     * on success or `null` if no valid grant exists. Negative answers are
     * cached briefly to protect the verify endpoint from misconfigured callers.
     *
     * Implemented as a per-instance Map keyed by `appId:userId`. Cached
     * positive grants live for 5 minutes (acceptable staleness window for an
     * impersonation grant); revocations propagate within that window.
     *
     * @internal Used by the auth() middleware — not part of the public API
     */
    async verifyServiceActingAs(
      appId: string,
      userId: string,
    ): Promise<ServiceActingAsVerification | null> {
      const cacheKey = `${appId}:${userId}`;
      const now = Date.now();

      const cached = this._serviceActingAsCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.result;
      }

      try {
        const result = await this.makeRequest<ServiceActingAsVerification>(
          'GET',
          '/internal/service-acting-as/verify',
          { appId, userId },
          { cache: false, retry: false, timeout: 5000 },
        );

        const authorized = Boolean(result && result.authorized);
        const verified: ServiceActingAsVerification | null = authorized
          ? { authorized: true, scopes: Array.isArray(result.scopes) ? result.scopes : [] }
          : null;

        this._serviceActingAsCache.set(cacheKey, {
          result: verified,
          expiresAt: now + 5 * 60 * 1000,
        });

        return verified;
      } catch (error) {
        logger.warn('[oxy.auth] verifyServiceActingAs lookup failed — caching negative result', {
          component: 'auth',
          method: 'verifyServiceActingAs',
          appId,
          userId,
        }, error);
        // Negative cache prevents a runaway loop if the verify endpoint is
        // down, while still letting a real grant become visible within 60s.
        this._serviceActingAsCache.set(cacheKey, {
          result: null,
          expiresAt: now + 1 * 60 * 1000,
        });
        return null;
      }
    }

    /**
     * Fetch link metadata
     */
    async fetchLinkMetadata(url: string): Promise<{
      url: string;
      title: string;
      description: string;
      image?: string;
    }> {
      try {
        const path = buildUrl('/links/preview', { url, wait: 1 });
        const preview = await this.makeRequest<LinkPreview>('GET', path, undefined, { cache: false });
        return {
          url: preview.url,
          title: preview.title?.trim() || preview.url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
          description: preview.description?.trim() || 'Link',
          image: preview.image,
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Express.js authentication middleware
     *
     * Validates JWT tokens against the Oxy API and attaches user data to requests.
     * Uses server-side session validation for security (not just JWT decode).
     *
     * **Design note — jwtDecode vs jwt.verify:**
     * This middleware intentionally uses `jwtDecode()` (decode-only, no signature
     * verification) for user tokens. This is by design, NOT a security gap:
     * - Third-party apps using `oxy.auth()` don't have the Oxy JWT secret
     * - Security comes from API-based session validation (`validateSession()`)
     *   which checks the session server-side on every request
     * - Service tokens (type: 'service') DO use cryptographic HMAC verification
     *   via the `jwtSecret` option, since they are stateless. Service tokens
     *   are additionally checked for `aud`, `iss`, and `type` claims to prevent
     *   cross-token-type confusion attacks.
     * - The backend's own `authMiddleware` uses `jwt.verify()` because it has
     *   direct access to `SERVICE_TOKEN_SECRET` / `ACCESS_TOKEN_SECRET`.
     *
     * **Service-token delegation (X-Oxy-User-Id):**
     * When a service token is accompanied by `X-Oxy-User-Id`, the SDK calls
     * `verifyServiceActingAs(appId, userId)` to confirm an explicit delegation
     * grant exists before attaching `req.userId`. A missing/expired grant
     * results in a 403 — there is no fail-open path.
     *
     * @example
     * ```typescript
     * import { OxyServices } from '@oxyhq/core';
     *
     * const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
     *
     * // Protect all routes under /protected
     * app.use('/protected', oxy.auth({ jwtSecret: process.env.SERVICE_TOKEN_SECRET }));
     *
     * // Access user in route handler
     * app.get('/protected/me', (req, res) => {
     *   res.json({ userId: req.userId, user: req.user });
     * });
     *
     * // Load full user profile from API
     * app.use('/admin', oxy.auth({ loadUser: true }));
     *
     * // Optional auth - attach user if present, don't block if absent
     * app.use('/public', oxy.auth({ optional: true }));
     *
     * // Require a specific scope on a service-token-protected route
     * app.use('/internal/files', oxy.serviceAuth({ jwtSecret: process.env.SERVICE_TOKEN_SECRET }), oxy.requireScope('files:write'));
     * ```
     *
     * @param options Optional configuration
     * @returns Express middleware function
     */
    auth(options: AuthMiddlewareOptions = {}) {
      const {
        debug = false,
        onError,
        loadUser = false,
        optional = false,
        jwtSecret,
        expectedIssuer = OXY_JWT_ISSUER,
        expectedAudience = OXY_JWT_AUDIENCE,
      } = options;
      // Cross-mixin method access: typed as a structural subset of the
      // composed OxyServices we know we have at runtime.
      const oxyInstance = this as unknown as OxyAuthInstance;

      // Return an async middleware function
      return async (req: AuthReq, res: AuthRes, next: AuthNext) => {
        try {
          // Extract token from Authorization header.
          // Node/Express normalizes `Authorization` to a string; we guard
          // against the (legal but unusual) string[] case anyway.
          const rawAuthHeader = req.headers.authorization;
          const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
          const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

          if (debug) {
            logger.debug(`[oxy.auth] ${req.method} ${req.path} | token: ${!!token}`, {
              component: 'auth',
              method: 'auth',
            });
          }

          if (!token) {
            if (optional) {
              req.userId = null;
              req.user = null;
              return next();
            }

            const error = {
              error: 'MISSING_TOKEN',
              message: 'Access token required',
              code: 'MISSING_TOKEN',
              status: 401
            };
            if (onError) return onError(error);
            return res.status(401).json(error);
          }

          // Decode token to extract claims
          let decoded: JwtPayload;
          try {
            decoded = jwtDecode<JwtPayload>(token);
          } catch (decodeError) {
            if (debug) {
              logger.debug('[oxy.auth] Token decode failed', {
                component: 'auth',
                method: 'auth',
              }, decodeError);
            }
            if (optional) {
              req.userId = null;
              req.user = null;
              return next();
            }

            const error = {
              error: 'INVALID_TOKEN_FORMAT',
              message: 'Invalid token format',
              code: 'INVALID_TOKEN_FORMAT',
              status: 401
            };
            if (onError) return onError(error);
            return res.status(401).json(error);
          }

          // Handle service tokens (internal service-to-service auth)
          // Service tokens are stateless JWTs with type: 'service' — requires signature verification
          if (decoded.type === 'service') {
            // Service tokens MUST be cryptographically verified — reject if no secret provided
            if (!jwtSecret) {
              if (optional) {
                req.userId = null;
                req.user = null;
                return next();
              }
              const error = {
                error: 'SERVICE_TOKEN_NOT_CONFIGURED',
                message: 'Service token verification not configured',
                code: 'SERVICE_TOKEN_NOT_CONFIGURED',
                status: 403
              };
              if (onError) return onError(error);
              return res.status(403).json(error);
            }

            // Verify JWT signature, then audience / issuer / type / appId claims.
            //
            // Signature verification uses a manual HMAC-SHA256 compare because
            // this file ships into RN/web bundles where `jsonwebtoken` is
            // unavailable. The middleware only ever runs on Node hosts (see
            // `@oxyhq/protocol`'s `platform/crypto` doc-comment), and
            // `loadNodeCrypto` is per-platform: the RN variant throws so Metro
            // never bundles a Node built-in reference.
            try {
              await verifyServiceTokenSignature(token, jwtSecret);
              verifyServiceTokenClaims(decoded, {
                audience: expectedAudience,
                issuer: expectedIssuer,
              });
            } catch (verifyError) {
              // Structure + signature + claim errors all map to 401. Anything
              // else (e.g. Node crypto failing to load on a misconfigured host)
              // genuinely IS a 500.
              if (
                verifyError instanceof ServiceTokenStructureError ||
                verifyError instanceof ServiceTokenSignatureError ||
                verifyError instanceof ServiceTokenClaimError
              ) {
                if (debug) {
                  logger.debug('[oxy.auth] Service token rejected', {
                    component: 'auth',
                    method: 'auth.serviceToken',
                    reason: verifyError.name,
                    detail: verifyError.message,
                  });
                }
                if (optional) {
                  req.userId = null;
                  req.user = null;
                  return next();
                }
                const code = verifyError instanceof ServiceTokenSignatureError
                  ? 'INVALID_SERVICE_TOKEN'
                  : verifyError instanceof ServiceTokenStructureError
                    ? 'INVALID_SERVICE_TOKEN'
                    : 'INVALID_SERVICE_TOKEN_CLAIMS';
                const error = {
                  error: code,
                  message: verifyError.message,
                  code,
                  status: 401,
                };
                if (onError) return onError(error);
                return res.status(401).json(error);
              }

              logger.error('[oxy.auth] Unexpected error during service token verification', verifyError, {
                component: 'auth',
                method: 'auth.serviceToken',
              });
              const error = {
                error: 'AUTH_INTERNAL_ERROR',
                message: 'Internal authentication error',
                code: 'AUTH_INTERNAL_ERROR',
                status: 500,
              };
              if (onError) return onError(error);
              return res.status(500).json(error);
            }

            // Check expiration — reject tokens at exact expiry second (use <=)
            if (decoded.exp && decoded.exp <= Math.floor(Date.now() / 1000)) {
              if (optional) {
                req.userId = null;
                req.user = null;
                return next();
              }
              const error = { error: 'TOKEN_EXPIRED', message: 'Service token expired', code: 'TOKEN_EXPIRED', status: 401 };
              if (onError) return onError(error);
              return res.status(401).json(error);
            }

            // Validate required service token fields
            const appId = decoded.appId;
            const credentialId = decoded.credentialId;
            if (!appId || typeof credentialId !== 'string' || credentialId.length === 0) {
              if (optional) {
                req.userId = null;
                req.user = null;
                return next();
              }
              const error = { error: 'INVALID_SERVICE_TOKEN', message: 'Invalid service token: missing required claims', code: 'INVALID_SERVICE_TOKEN', status: 401 };
              if (onError) return onError(error);
              return res.status(401).json(error);
            }

            // Read delegated user ID from header
            const oxyUserIdRaw = req.headers['x-oxy-user-id'];
            const oxyUserId = typeof oxyUserIdRaw === 'string' && oxyUserIdRaw.length > 0 ? oxyUserIdRaw : null;

            // C3: a service may only act as a user when an explicit
            // ServiceActingAs grant exists for that (appId, userId) pair.
            // Without the grant we MUST refuse — silently attaching
            // `req.userId = oxyUserId` would let any service impersonate
            // any user simply by setting the header.
            if (oxyUserId) {
              const grant = await oxyInstance.verifyServiceActingAs(appId, oxyUserId);
              if (!grant || !grant.authorized) {
                logger.warn('[oxy.auth] Service token rejected — no delegation grant', {
                  component: 'auth',
                  method: 'auth.serviceToken',
                  appId,
                  attemptedUserId: oxyUserId,
                });
                const error = {
                  error: 'SERVICE_ACTING_AS_UNAUTHORIZED',
                  message: 'Service not authorized to act as this user',
                  code: 'SERVICE_ACTING_AS_UNAUTHORIZED',
                  status: 403,
                };
                if (onError) return onError(error);
                return res.status(403).json(error);
              }

              req.userId = oxyUserId;
              req.user = { id: oxyUserId } as User;
              req.serviceActingAs = { userId: oxyUserId, scopes: grant.scopes };
            } else {
              // No X-Oxy-User-Id means the service is acting as itself.
              req.userId = null;
              req.user = null;
            }

            req.accessToken = token;
            req.serviceApp = {
              appId,
              appName: decoded.appName || 'unknown',
              credentialId,
              scopes: Array.isArray(decoded.scopes) ? decoded.scopes : [],
            };

            if (debug) {
              logger.debug(`[oxy.auth] Service token OK app=${decoded.appName} delegateUser=${oxyUserId || '(none)'}`, {
                component: 'auth',
                method: 'auth.serviceToken',
              });
            }

            return next();
          }

          const userId = decoded.userId || decoded.id;
          if (!userId) {
            if (optional) {
              req.userId = null;
              req.user = null;
              return next();
            }

            const error = {
              error: 'INVALID_TOKEN_PAYLOAD',
              message: 'Token missing user ID',
              code: 'INVALID_TOKEN_PAYLOAD',
              status: 401
            };
            if (onError) return onError(error);
            return res.status(401).json(error);
          }

          // Check token expiration locally first (fast path)
          // Reject tokens at exact expiry second (use <=)
          if (decoded.exp && decoded.exp <= Math.floor(Date.now() / 1000)) {
            if (optional) {
              req.userId = null;
              req.user = null;
              return next();
            }

            const error = {
              error: 'TOKEN_EXPIRED',
              message: 'Token expired',
              code: 'TOKEN_EXPIRED',
              status: 401
            };
            if (onError) return onError(error);
            return res.status(401).json(error);
          }

          // Validate token against the Oxy API for session-based verification
          // This ensures the session hasn't been revoked server-side
          if (decoded.sessionId) {
            try {
              const validationResult = await oxyInstance.validateSession(decoded.sessionId, {
                useHeaderValidation: true,
              });

              if (!validationResult || !validationResult.valid) {
                if (optional) {
                  req.userId = null;
                  req.user = null;
                  return next();
                }

                const error = {
                  error: 'INVALID_SESSION',
                  message: 'Session invalid or expired',
                  code: 'INVALID_SESSION',
                  status: 401
                };
                if (onError) return onError(error);
                return res.status(401).json(error);
              }

              // Use validated user data from session validation (already has full user)
              req.userId = userId;
              req.accessToken = token;
              req.sessionId = decoded.sessionId;

              if (loadUser && validationResult.user) {
                // Session validation already returns full user data
                req.user = validationResult.user;
              } else {
                req.user = { id: userId } as User;
              }

              if (debug) {
                logger.debug(`[oxy.auth] OK user=${userId} session=${decoded.sessionId}`, {
                  component: 'auth',
                  method: 'auth',
                });
              }

              return next();
            } catch (validationError) {
              if (debug) {
                logger.debug('[oxy.auth] Session validation failed', {
                  component: 'auth',
                  method: 'auth',
                }, validationError);
              }

              if (optional) {
                req.userId = null;
                req.user = null;
                return next();
              }

              const error = {
                error: 'SESSION_VALIDATION_ERROR',
                message: 'Session validation failed',
                code: 'SESSION_VALIDATION_ERROR',
                status: 401
              };
              if (onError) return onError(error);
              return res.status(401).json(error);
            }
          }

          // Non-session token: use local validation only (userId from JWT)
          req.userId = userId;
          req.accessToken = token;
          req.user = { id: userId } as User;

          // If loadUser requested with non-session token, fetch from API
          if (loadUser) {
            try {
              // Temporarily set token to make the API call
              const prevToken = oxyInstance.getAccessToken();
              oxyInstance.setTokens(token);
              const fullUser = await oxyInstance.getCurrentUser();
              // Restore previous token
              if (prevToken) {
                oxyInstance.setTokens(prevToken);
              } else {
                oxyInstance.clearTokens();
              }

              if (fullUser) {
                req.user = fullUser;
              }
            } catch (loadUserError) {
              // Loading the full user is best-effort here; the basic { id }
              // object is already attached. Log so misconfigured deployments
              // can be diagnosed instead of silently failing.
              logger.warn('[oxy.auth] loadUser fallback — could not fetch full profile', {
                component: 'auth',
                method: 'auth.loadUser',
                userId,
              }, loadUserError);
            }
          }

          if (debug) {
            logger.debug(`[oxy.auth] OK user=${userId} (no session)`, {
              component: 'auth',
              method: 'auth',
            });
          }

          next();
        } catch (error) {
          const handled = oxyInstance.handleError(error) as Error & {
            code?: string;
            status?: number;
            details?: Record<string, unknown>;
          };
          const apiError: ApiError = {
            message: handled.message || 'Authentication error',
            code: handled.code ?? 'AUTH_ERROR',
            status: handled.status ?? 500,
            details: handled.details,
          };

          if (debug) {
            logger.debug('[oxy.auth] Error', {
              component: 'auth',
              method: 'auth',
            }, apiError);
          }

          if (onError) return onError(apiError);
          return res.status(apiError.status).json(apiError);
        }
      };
    }

    /**
     * Socket.IO authentication middleware factory
     *
     * Returns a middleware function for Socket.IO that validates JWT tokens
     * from the handshake auth object and attaches user data to the socket.
     *
     * Uses `jwtDecode()` + API session validation (same rationale as `auth()`).
     *
     * @example
     * ```typescript
     * import { OxyServices } from '@oxyhq/core';
     * import { Server } from 'socket.io';
     *
     * const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
     * const io = new Server(server);
     *
     * // Authenticate all socket connections
     * io.use(oxy.authSocket());
     *
     * io.on('connection', (socket) => {
     *   console.log('Authenticated user:', socket.data.userId);
     * });
     * ```
     */
    authSocket(options: { debug?: boolean } = {}) {
      const { debug = false } = options;
      // Cross-mixin method access typed via the same structural subset.
      const oxyInstance = this as unknown as OxyAuthInstance;

      return async (socket: SocketLike, next: (err?: Error) => void) => {
        try {
          const token = socket.handshake?.auth?.token;

          if (!token) {
            return next(new Error('Authentication required'));
          }

          let decoded: JwtPayload;
          try {
            decoded = jwtDecode<JwtPayload>(token);
          } catch (decodeError) {
            if (debug) {
              logger.debug('[oxy.authSocket] Token decode failed', {
                component: 'auth',
                method: 'authSocket',
              }, decodeError);
            }
            return next(new Error('Invalid token'));
          }

          const claimedUserId = decoded.userId || decoded.id;
          if (!claimedUserId) {
            return next(new Error('Invalid token payload'));
          }

          // Check expiration — reject tokens at exact expiry second (use <=)
          if (decoded.exp && decoded.exp <= Math.floor(Date.now() / 1000)) {
            return next(new Error('Token expired'));
          }

          // A server-validated session is mandatory. A bare decoded JWT proves
          // nothing — the signature is not verified here, so without a session
          // round-trip a forged token could claim any user id.
          if (!decoded.sessionId) {
            return next(new Error('Session required'));
          }

          let userId = claimedUserId;
          try {
            const result = await oxyInstance.validateSession(decoded.sessionId, {
              useHeaderValidation: true,
            });
            if (!result || !result.valid || !result.user) {
              return next(new Error('Session invalid'));
            }

            // The session is the source of truth. The client-claimed user id
            // must match the server-validated identity, otherwise a valid
            // session could be paired with a forged user id.
            const validatedUserId = getUserIdentityId(result.user);
            if (!validatedUserId || validatedUserId !== claimedUserId) {
              return next(new Error('Session user mismatch'));
            }

            userId = validatedUserId;
          } catch (validateErr) {
            if (debug) {
              logger.debug('[oxy.authSocket] Session validation failed', {
                component: 'auth',
                method: 'authSocket',
              }, validateErr);
            }
            return next(new Error('Session validation failed'));
          }

          // Attach user data to socket. We expose BOTH `socket.data.userId`
          // (the official Socket.IO data slot) and `socket.user` because
          // every consumer in this ecosystem (Mention, Allo, api/server.ts)
          // reads from `socket.user.id`.
          socket.data = socket.data || {};
          socket.data.userId = userId;
          socket.data.sessionId = decoded.sessionId || null;
          socket.data.token = token;

          socket.user = { id: userId, userId, sessionId: decoded.sessionId };

          if (debug) {
            logger.debug(`[oxy.authSocket] OK user=${userId}`, {
              component: 'auth',
              method: 'authSocket',
            });
          }

          next();
        } catch (err) {
          if (debug) {
            logger.debug('[oxy.authSocket] Error', {
              component: 'auth',
              method: 'authSocket',
            }, err);
          }
          next(new Error('Authentication error'));
        }
      };
    }
    /**
     * Express.js middleware that only allows service tokens.
     * Use this for internal-only endpoints that should not be accessible
     * to regular users or API key consumers.
     *
     * @example
     * ```typescript
     * // Protect internal endpoints
     * app.use('/internal', oxy.serviceAuth({ jwtSecret: process.env.SERVICE_TOKEN_SECRET }));
     *
     * app.post('/internal/trigger', (req, res) => {
     *   console.log('Service app:', req.serviceApp);
     *   console.log('Acting on behalf of user:', req.userId);
     * });
     * ```
     */
    serviceAuth(options: { debug?: boolean; jwtSecret?: string; expectedIssuer?: string; expectedAudience?: string } = {}) {
      const innerAuth = this.auth({ ...options });

      return async (req: AuthReq, res: AuthRes, next: AuthNext) => {
        await innerAuth(req, res, () => {
          if (!req.serviceApp) {
            return res.status(403).json({
              error: 'Service token required',
              message: 'This endpoint is only accessible to internal services',
              code: 'SERVICE_TOKEN_REQUIRED',
            });
          }
          next();
        });
      };
    }

    /**
     * Express.js middleware that enforces a specific service-token scope.
     *
     * Mount AFTER `auth()` / `serviceAuth()` — relies on `req.serviceApp` and
     * (when delegation is in effect) `req.serviceActingAs.scopes`. App-only
     * service requests require the app scope. Delegated user requests require
     * BOTH the app scope and the per-user delegation scope.
     *
     * Requests authenticated as a regular user (no service token) are rejected
     * with 403 — scope-protected endpoints are service-to-service by design.
     *
     * @example
     * ```typescript
     * app.use(
     *   '/internal/files',
     *   oxy.serviceAuth({ jwtSecret: process.env.SERVICE_TOKEN_SECRET }),
     *   oxy.requireScope('files:write'),
     * );
     * ```
     */
    requireScope(scope: string) {
      if (typeof scope !== 'string' || scope.length === 0) {
        throw new Error('requireScope: scope must be a non-empty string');
      }

      return (req: AuthReq, res: AuthRes, next: AuthNext): void => {
        const appScopes = req.serviceApp?.scopes ?? [];
        const delegatedScopes = req.serviceActingAs?.scopes ?? [];

        if (!req.serviceApp) {
          res.status(403).json({
            error: 'SERVICE_TOKEN_REQUIRED',
            message: 'Scope-protected endpoint requires a service token',
            code: 'SERVICE_TOKEN_REQUIRED',
            status: 403,
          });
          return;
        }

        const appHasScope = appScopes.includes(scope);
        const delegationHasScope = delegatedScopes.includes(scope);
        const hasRequiredScope = req.serviceActingAs
          ? appHasScope && delegationHasScope
          : appHasScope;

        if (hasRequiredScope) {
          next();
          return;
        }

        logger.warn('[oxy.auth] Service token missing required scope', {
          component: 'auth',
          method: 'requireScope',
          appId: req.serviceApp.appId,
          required: scope,
        });
        res.status(403).json({
          error: 'INSUFFICIENT_SCOPE',
          message: `Required scope '${scope}' not granted`,
          code: 'INSUFFICIENT_SCOPE',
          status: 403,
        });
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Service token verification helpers
// ---------------------------------------------------------------------------

/**
 * Verify a service JWT's HMAC-SHA256 signature using a constant-time compare.
 * Throws `ServiceTokenStructureError` on malformed tokens and
 * `ServiceTokenSignatureError` on signature mismatch — both map to 401.
 */
async function verifyServiceTokenSignature(token: string, secret: string): Promise<void> {
  const nodeCrypto = await loadNodeCrypto();
  const { createHmac, timingSafeEqual } = nodeCrypto;
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new ServiceTokenStructureError(`Service token must have 3 parts, got ${parts.length}`);
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new ServiceTokenStructureError('Service token has empty segment');
  }
  const expectedSig = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const sigBuf = Buffer.from(signatureB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new ServiceTokenSignatureError();
  }
}

/**
 * Verify that a decoded service-token payload carries the expected `aud`,
 * `iss`, and `type` claims. Throws `ServiceTokenClaimError` on mismatch.
 * This is the defence against the H4 vulnerability where a recovery / 2FA /
 * access token signed by the same shared secret could be replayed as a
 * service token because no claim binding existed.
 */
/**
 * Resolve the canonical user id from a validated session's user object.
 *
 * The API serializer emits `id`, but some upstream shapes carry the raw Mongo
 * `_id` instead. We accept either, but only a non-empty string — anything else
 * means the validated identity is unusable and the caller must reject.
 */
function getUserIdentityId(user: User): string | null {
  const candidate = (user as { id?: unknown; _id?: unknown }).id
    ?? (user as { id?: unknown; _id?: unknown })._id;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function verifyServiceTokenClaims(
  decoded: JwtPayload,
  expected: { audience: string; issuer: string },
): void {
  if (decoded.type !== 'service') {
    throw new ServiceTokenClaimError(`Service token has unexpected type '${String(decoded.type)}'`);
  }
  if (decoded.iss !== expected.issuer) {
    throw new ServiceTokenClaimError(`Service token issuer mismatch: expected '${expected.issuer}', got '${String(decoded.iss)}'`);
  }
  const aud = decoded.aud;
  if (Array.isArray(aud)) {
    if (!aud.includes(expected.audience)) {
      throw new ServiceTokenClaimError(`Service token audience does not include '${expected.audience}'`);
    }
  } else if (aud !== expected.audience) {
    throw new ServiceTokenClaimError(`Service token audience mismatch: expected '${expected.audience}', got '${String(aud)}'`);
  }
}

// ---------------------------------------------------------------------------
// Local request/response/socket typing
//
// Express's types are an optional peer (we don't want to take a hard dep on
// `@types/express` from a platform-agnostic SDK). The structural subset below
// captures everything this middleware actually touches, so consumers get type
// checking without us coupling to Express's full surface.
// ---------------------------------------------------------------------------

interface AuthReq {
  method?: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  userId?: string | null;
  user?: User | null;
  accessToken?: string;
  sessionId?: string | null;
  serviceApp?: ServiceApp;
  serviceActingAs?: { userId: string; scopes: string[] };
}

interface AuthRes {
  status(code: number): AuthRes;
  json(body: unknown): unknown;
}

type AuthNext = (err?: unknown) => void;

interface SocketLike {
  handshake?: { auth?: { token?: string } };
  data?: Record<string, unknown>;
  user?: { id: string; userId: string; sessionId?: string | null };
}

interface OxyAuthInstance {
  verifyServiceActingAs(appId: string, userId: string): Promise<ServiceActingAsVerification | null>;
  validateSession(
    sessionId: string,
    options?: { deviceFingerprint?: string; useHeaderValidation?: boolean },
  ): Promise<{
    valid: boolean;
    user?: User;
    [key: string]: unknown;
  } | null>;
  getAccessToken(): string | null;
  setTokens(accessToken: string): void;
  clearTokens(): void;
  getCurrentUser(): Promise<User | null>;
  handleError(error: unknown): Error;
}

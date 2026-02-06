/**
 * Utility Methods Mixin
 *
 * Provides utility methods including link metadata fetching
 * and Express.js authentication middleware
 */
import { jwtDecode } from 'jwt-decode';
import type { ApiError, User } from '../models/interfaces';
import type { OxyServicesBase } from '../OxyServices.base';
import { CACHE_TIMES } from './mixinHelpers';

interface JwtPayload {
  exp?: number;
  userId?: string;
  id?: string;
  sessionId?: string;
  type?: string;
  appId?: string;
  appName?: string;
  [key: string]: any;
}

/**
 * Service app metadata attached to requests authenticated with service tokens
 */
export interface ServiceApp {
  appId: string;
  appName: string;
}

/**
 * Options for oxyClient.auth() middleware
 */
interface AuthMiddlewareOptions {
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Custom error handler - receives error object, can return response */
  onError?: (error: ApiError) => any;
  /** Load full user profile from API (default: false for performance) */
  loadUser?: boolean;
  /** Optional auth - attach user if token present but don't block (default: false) */
  optional?: boolean;
  /**
   * JWT secret for verifying service token signatures locally.
   * When provided, service tokens will be cryptographically verified.
   * When omitted, service tokens will be rejected (secure default).
   */
  jwtSecret?: string;
}

export function OxyServicesUtilityMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
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
        return await this.makeRequest<{
          url: string;
          title: string;
          description: string;
          image?: string;
        }>('GET', '/api/link-metadata', { url }, {
          cache: true,
          cacheTTL: CACHE_TIMES.EXTRA_LONG,
        });
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
     * @example
     * ```typescript
     * import { OxyServices } from '@oxyhq/core';
     *
     * const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
     *
     * // Protect all routes under /api/protected
     * app.use('/api/protected', oxy.auth());
     *
     * // Access user in route handler
     * app.get('/api/protected/me', (req, res) => {
     *   res.json({ userId: req.userId, user: req.user });
     * });
     *
     * // Load full user profile from API
     * app.use('/api/admin', oxy.auth({ loadUser: true }));
     *
     * // Optional auth - attach user if present, don't block if absent
     * app.use('/api/public', oxy.auth({ optional: true }));
     * ```
     *
     * @param options Optional configuration
     * @returns Express middleware function
     */
    auth(options: AuthMiddlewareOptions = {}) {
      const { debug = false, onError, loadUser = false, optional = false, jwtSecret } = options;
      // Cast to any for cross-mixin method access (Auth mixin methods available at runtime)
      const oxyInstance = this as any;

      // Return an async middleware function
      return async (req: any, res: any, next: any) => {
        try {
          // Extract token from Authorization header or query params
          const authHeader = req.headers['authorization'];
          let token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

          // Fallback to query params (useful for WebSocket upgrades)
          if (!token) {
            const q = req.query || {};
            if (typeof q.token === 'string' && q.token) token = q.token;
            else if (typeof q.access_token === 'string' && q.access_token) token = q.access_token;
          }

          if (debug) {
            console.log(`[oxy.auth] ${req.method} ${req.path} | token: ${!!token}`);
          }

          if (!token) {
            if (optional) {
              req.userId = null;
              req.user = null;
              return next();
            }

            const error = {
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
            if (optional) {
              req.userId = null;
              req.user = null;
              return next();
            }

            const error = {
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
                message: 'Service token verification not configured',
                code: 'SERVICE_TOKEN_NOT_CONFIGURED',
                status: 403
              };
              if (onError) return onError(error);
              return res.status(403).json(error);
            }

            // Verify JWT signature (not just decode)
            try {
              const { createHmac } = await import('crypto');
              const [headerB64, payloadB64, signatureB64] = token.split('.');
              if (!headerB64 || !payloadB64 || !signatureB64) {
                throw new Error('Invalid token structure');
              }
              const expectedSig = createHmac('sha256', jwtSecret)
                .update(`${headerB64}.${payloadB64}`)
                .digest('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');

              // Timing-safe comparison
              const sigBuf = Buffer.from(signatureB64);
              const expectedBuf = Buffer.from(expectedSig);
              const { timingSafeEqual } = await import('crypto');
              if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
                throw new Error('Invalid signature');
              }
            } catch (verifyError) {
              const isSignatureError = verifyError instanceof Error &&
                (verifyError.message === 'Invalid signature' || verifyError.message === 'Invalid token structure');

              if (!isSignatureError) {
                console.error('[oxy.auth] Unexpected error during service token verification:', verifyError);
                const error = { message: 'Internal authentication error', code: 'AUTH_INTERNAL_ERROR', status: 500 };
                if (onError) return onError(error);
                return res.status(500).json(error);
              }

              if (optional) {
                req.userId = null;
                req.user = null;
                return next();
              }
              const error = { message: 'Invalid service token signature', code: 'INVALID_SERVICE_TOKEN', status: 401 };
              if (onError) return onError(error);
              return res.status(401).json(error);
            }

            // Check expiration
            if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
              if (optional) {
                req.userId = null;
                req.user = null;
                return next();
              }
              const error = { message: 'Service token expired', code: 'TOKEN_EXPIRED', status: 401 };
              if (onError) return onError(error);
              return res.status(401).json(error);
            }

            // Validate required service token fields
            if (!decoded.appId) {
              if (optional) {
                req.userId = null;
                req.user = null;
                return next();
              }
              const error = { message: 'Invalid service token: missing appId', code: 'INVALID_SERVICE_TOKEN', status: 401 };
              if (onError) return onError(error);
              return res.status(401).json(error);
            }

            // Read delegated user ID from header
            const oxyUserId = req.headers['x-oxy-user-id'] as string;

            req.userId = oxyUserId || null;
            req.user = oxyUserId ? ({ id: oxyUserId } as User) : null;
            req.accessToken = token;
            req.serviceApp = {
              appId: decoded.appId || '',
              appName: decoded.appName || 'unknown',
            };

            if (debug) {
              console.log(`[oxy.auth] Service token OK app=${decoded.appName} delegateUser=${oxyUserId || '(none)'}`);
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
              message: 'Token missing user ID',
              code: 'INVALID_TOKEN_PAYLOAD',
              status: 401
            };
            if (onError) return onError(error);
            return res.status(401).json(error);
          }

          // Check token expiration locally first (fast path)
          if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
            if (optional) {
              req.userId = null;
              req.user = null;
              return next();
            }

            const error = {
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
                console.log(`[oxy.auth] OK user=${userId} session=${decoded.sessionId}`);
              }

              return next();
            } catch (validationError) {
              if (debug) {
                console.log(`[oxy.auth] Session validation failed:`, validationError);
              }

              if (optional) {
                req.userId = null;
                req.user = null;
                return next();
              }

              const error = {
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
            } catch {
              // Failed to load user, continue with basic user object
            }
          }

          if (debug) {
            console.log(`[oxy.auth] OK user=${userId} (no session)`);
          }

          next();
        } catch (error) {
          const apiError = oxyInstance.handleError(error) as any;

          if (debug) {
            console.log(`[oxy.auth] Error:`, apiError);
          }

          if (onError) return onError(apiError);
          return res.status((apiError && apiError.status) || 500).json(apiError);
        }
      };
    }

    /**
     * Socket.IO authentication middleware factory
     *
     * Returns a middleware function for Socket.IO that validates JWT tokens
     * from the handshake auth object and attaches user data to the socket.
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
      // Cast to any for cross-mixin method access (Auth mixin methods available at runtime)
      const oxyInstance = this as any;

      return async (socket: any, next: (err?: Error) => void) => {
        try {
          const token = socket.handshake?.auth?.token;

          if (!token) {
            return next(new Error('Authentication required'));
          }

          let decoded: JwtPayload;
          try {
            decoded = jwtDecode<JwtPayload>(token);
          } catch {
            return next(new Error('Invalid token'));
          }

          const userId = decoded.userId || decoded.id;
          if (!userId) {
            return next(new Error('Invalid token payload'));
          }

          // Check expiration
          if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
            return next(new Error('Token expired'));
          }

          // Validate session if available
          if (decoded.sessionId) {
            try {
              const result = await oxyInstance.validateSession(decoded.sessionId, {
                useHeaderValidation: true,
              });
              if (!result || !result.valid) {
                return next(new Error('Session invalid'));
              }
            } catch {
              return next(new Error('Session validation failed'));
            }
          }

          // Attach user data to socket
          socket.data = socket.data || {};
          socket.data.userId = userId;
          socket.data.sessionId = decoded.sessionId || null;
          socket.data.token = token;

          // Also set on socket.user for backward compatibility
          socket.user = { id: userId, userId, sessionId: decoded.sessionId };

          if (debug) {
            console.log(`[oxy.authSocket] OK user=${userId}`);
          }

          next();
        } catch (err) {
          if (debug) {
            console.log(`[oxy.authSocket] Error:`, err);
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
     * app.use('/internal', oxy.serviceAuth());
     *
     * app.post('/internal/trigger', (req, res) => {
     *   console.log('Service app:', req.serviceApp);
     *   console.log('Acting on behalf of user:', req.userId);
     * });
     * ```
     */
    serviceAuth(options: { debug?: boolean } = {}) {
      const innerAuth = this.auth({ ...options });

      return async (req: any, res: any, next: any) => {
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
  };
}


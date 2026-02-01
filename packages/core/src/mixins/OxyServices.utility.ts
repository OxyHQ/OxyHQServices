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
  [key: string]: any;
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
      const { debug = false, onError, loadUser = false, optional = false } = options;
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
  };
}


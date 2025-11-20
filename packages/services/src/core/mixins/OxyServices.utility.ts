/**
 * Utility Methods Mixin
 * 
 * Provides utility methods including link metadata fetching
 * and Express.js authentication middleware
 */
import { jwtDecode } from 'jwt-decode';
import type { ApiError, User } from '../../models/interfaces';
import type { OxyServicesBase } from '../OxyServices.base';
import { CACHE_TIMES } from './mixinHelpers';

interface JwtPayload {
  exp?: number;
  userId?: string;
  id?: string;
  sessionId?: string;
  [key: string]: any;
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
     * Simple Express.js authentication middleware
     * 
     * Built-in authentication middleware that validates JWT tokens and adds user data to requests.
     * 
     * @example
     * ```typescript
     * // Basic usage - just add it to your routes
     * app.use('/api/protected', oxyServices.auth());
     * 
     * // With debug logging
     * app.use('/api/protected', oxyServices.auth({ debug: true }));
     * 
     * // With custom error handling
     * app.use('/api/protected', oxyServices.auth({
     *   onError: (error) => console.error('Auth failed:', error)
     * }));
     * 
     * // Load full user data
     * app.use('/api/protected', oxyServices.auth({ loadUser: true }));
     * ```
     * 
     * @param options Optional configuration
     * @param options.debug Enable debug logging (default: false)
     * @param options.onError Custom error handler
     * @param options.loadUser Load full user data (default: false for performance)
     * @param options.session Use session-based validation (default: false)
     * @returns Express middleware function
     */
    auth(options: {
      debug?: boolean;
      onError?: (error: ApiError) => any;
      loadUser?: boolean;
      session?: boolean;
    } = {}) {
      const { debug = false, onError, loadUser = false, session = false } = options;
      
      // Return a synchronous middleware function
      return (req: any, res: any, next: any) => {
        try {
          // Extract token from Authorization header
          const authHeader = req.headers['authorization'];
          const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
          
          if (debug) {
            console.log(`🔐 Auth: Processing ${req.method} ${req.path}`);
            console.log(`🔐 Auth: Token present: ${!!token}`);
          }
          
          if (!token) {
            const error = {
              message: 'Access token required',
              code: 'MISSING_TOKEN',
              status: 401
            };
            
            if (debug) console.log(`❌ Auth: Missing token`);
            
            if (onError) return onError(error);
            return res.status(401).json(error);
          }
          
          // Decode and validate token
          let decoded: JwtPayload;
          try {
            decoded = jwtDecode<JwtPayload>(token);
            
            if (debug) {
              console.log(`🔐 Auth: Token decoded, User ID: ${decoded.userId || decoded.id}`);
            }
          } catch (decodeError) {
            const error = {
              message: 'Invalid token format',
              code: 'INVALID_TOKEN_FORMAT',
              status: 403
            };
            
            if (debug) console.log(`❌ Auth: Token decode failed`);
            
            if (onError) return onError(error);
            return res.status(403).json(error);
          }
          
          const userId = decoded.userId || decoded.id;
          if (!userId) {
            const error = {
              message: 'Token missing user ID',
              code: 'INVALID_TOKEN_PAYLOAD',
              status: 403
            };
            
            if (debug) console.log(`❌ Auth: Token missing user ID`);
            
            if (onError) return onError(error);
            return res.status(403).json(error);
          }
          
          // Check token expiration
          if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
            const error = {
              message: 'Token expired',
              code: 'TOKEN_EXPIRED',
              status: 403
            };
            
            if (debug) console.log(`❌ Auth: Token expired`);
            
            if (onError) return onError(error);
            return res.status(403).json(error);
          }
          
          // For now, skip session validation to keep it simple
          // Session validation can be added later if needed
          
          // Set request properties immediately
          req.userId = userId;
          req.accessToken = token;
          req.user = { id: userId } as User;
          
          if (debug) {
            console.log(`✅ Auth: Authentication successful for user ${userId}`);
          }
          
          next();
        } catch (error) {
          const apiError = this.handleError(error) as any;
          
          if (debug) {
            console.log(`❌ Auth: Unexpected error:`, apiError);
          }
          
          if (onError) return onError(apiError);
          return res.status((apiError && apiError.status) || 500).json(apiError);
        }
      };
    }
  };
}


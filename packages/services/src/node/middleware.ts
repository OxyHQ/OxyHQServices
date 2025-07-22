/**
 * Zero-config Express middleware for OxyHQ Services authentication
 * 
 * This provides a simple, one-line solution for adding authentication to Express apps.
 * Simply import and use: app.use('/api', createOxyAuth())
 */

import { OxyServices } from '../core';
import { ApiError } from '../models/interfaces';

export interface OxyAuthConfig {
  /** Base URL of your Oxy API server */
  baseURL?: string;
  /** Whether to load full user data (default: true) */
  loadUser?: boolean;
  /** Routes that don't require authentication */
  publicPaths?: string[];
  /** Custom error handler */
  onError?: (error: ApiError, req: any, res: any) => void;
}

export interface AuthenticatedRequest {
  user?: any;
  userId?: string;
  accessToken?: string;
}

/**
 * Creates zero-config authentication middleware for Express.js
 * 
 * @example
 * ```typescript
 * import express from 'express';
 * import { createOxyAuth } from '@oxyhq/services/node';
 * 
 * const app = express();
 * 
 * // Zero-config auth for all /api routes
 * app.use('/api', createOxyAuth());
 * 
 * // Now all routes under /api automatically have req.user available
 * app.get('/api/profile', (req, res) => {
 *   res.json({ user: req.user }); // req.user is automatically available
 * });
 * ```
 */
export function createOxyAuth(config: OxyAuthConfig = {}) {
  const {
    baseURL = process.env.OXY_API_URL || 'http://localhost:3001',
    loadUser = true,
    publicPaths = [],
    onError
  } = config;

  const oxy = new OxyServices({ baseURL });

  return async (req: any, res: any, next: any) => {
    // Check if this is a public path
    const isPublicPath = publicPaths.some(path => 
      req.path === path || req.path.startsWith(path + '/')
    );

    if (isPublicPath) {
      return next();
    }

    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

      if (!token) {
        const error: ApiError = {
          message: 'Access token required',
          code: 'MISSING_TOKEN',
          status: 401
        };

        if (onError) {
          return onError(error, req, res);
        }

        return res.status(401).json({
          error: 'Access token required',
          code: 'MISSING_TOKEN'
        });
      }

      // Validate token using the OxyServices client
      const authResult = await oxy.authenticateToken(token);

      if (!authResult.valid) {
        const error: ApiError = {
          message: authResult.error || 'Invalid token',
          code: 'INVALID_TOKEN',
          status: 403
        };

        if (onError) {
          return onError(error, req, res);
        }

        return res.status(403).json({
          error: authResult.error || 'Invalid token',
          code: 'INVALID_TOKEN'
        });
      }

      // Attach user data to request
      req.userId = authResult.userId;
      req.accessToken = token;

      if (loadUser && authResult.user) {
        req.user = authResult.user;
      } else {
        req.user = { id: authResult.userId };
      }

      next();
    } catch (error: any) {
      const apiError: ApiError = {
        message: error.message || 'Authentication failed',
        code: error.code || 'AUTH_ERROR',
        status: error.status || 500
      };

      if (onError) {
        return onError(apiError, req, res);
      }

      res.status(apiError.status).json({
        error: apiError.message,
        code: apiError.code
      });
    }
  };
}

/**
 * Creates optional authentication middleware
 * This middleware will attach user data if a valid token is present, but won't fail if missing
 * 
 * @example
 * ```typescript
 * import { createOptionalOxyAuth } from '@oxyhq/services/node';
 * 
 * app.use('/api', createOptionalOxyAuth());
 * 
 * app.get('/api/content', (req, res) => {
 *   if (req.user) {
 *     // User is authenticated, show personalized content
 *     res.json({ content: 'personalized', user: req.user });
 *   } else {
 *     // Anonymous user, show public content
 *     res.json({ content: 'public' });
 *   }
 * });
 * ```
 */
export function createOptionalOxyAuth(config: OxyAuthConfig = {}) {
  const {
    baseURL = process.env.OXY_API_URL || 'http://localhost:3001',
    loadUser = true
  } = config;

  const oxy = new OxyServices({ baseURL });

  return async (req: any, res: any, next: any) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

      if (!token) {
        // No token provided, continue without authentication
        return next();
      }

      // Validate token using the OxyServices client
      const authResult = await oxy.authenticateToken(token);

      if (authResult.valid) {
        // Attach user data to request if token is valid
        req.userId = authResult.userId;
        req.accessToken = token;

        if (loadUser && authResult.user) {
          req.user = authResult.user;
        } else {
          req.user = { id: authResult.userId };
        }
      }

      next();
    } catch (error) {
      // If there's an error, continue without authentication
      // This makes the middleware truly optional
      next();
    }
  };
}

/**
 * Utility function to quickly set up a complete Express app with authentication
 * 
 * @example
 * ```typescript
 * import { createOxyExpressApp } from '@oxyhq/services/node';
 * 
 * const app = createOxyExpressApp();
 * 
 * // All routes automatically have authentication and req.user available
 * app.get('/api/profile', (req, res) => {
 *   res.json({ user: req.user });
 * });
 * 
 * app.listen(3000);
 * ```
 */
export function createOxyExpressApp(config: OxyAuthConfig & {
  /** Express app configuration */
  cors?: boolean;
  /** JSON body parser limit */
  jsonLimit?: string;
  /** Additional middleware to apply */
  middleware?: any[];
} = {}) {
  // This is a lightweight helper - users should import express themselves
  // We'll provide the middleware setup instructions instead
  
  throw new Error('createOxyExpressApp is not implemented yet. Please use createOxyAuth() middleware with your existing Express app.');
}

// Re-export for convenience
export { OxyServices } from '../core';
export * from '../models/interfaces';
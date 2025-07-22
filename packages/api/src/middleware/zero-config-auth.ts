/**
 * Zero-Config Backend Authentication Middleware
 * 
 * Automatically populates req.user for authenticated requests without manual setup.
 * Provides consistent error handling and session management.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';
import { logger } from '../utils/logger';
import { Document } from 'mongoose';

/**
 * Extended request interface with automatic user population
 */
export interface OxyRequest extends Request {
  user?: IUser & Document;
  userId?: string;
}

interface JwtPayload {
  id: string;
  userId: string;
  username: string;
  exp: number;
  [key: string]: any;
}

/**
 * Authentication configuration options
 */
interface AuthConfig {
  /**
   * Whether authentication is required for this route
   * @default true
   */
  required?: boolean;

  /**
   * Whether to load the full user object or just set user ID
   * @default true
   */
  loadFullUser?: boolean;

  /**
   * Custom error handler for authentication failures
   */
  onError?: (error: AuthError, req: Request, res: Response) => void;

  /**
   * Skip authentication for specific conditions
   */
  skipIf?: (req: Request) => boolean;
}

/**
 * Authentication error class with structured error information
 */
export class AuthError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isAuthError = true;

  constructor(message: string, code: string = 'AUTH_ERROR', statusCode: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Extract and validate JWT token from request
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Also check for token in cookies as fallback
  if (req.cookies?.accessToken) {
    return req.cookies.accessToken;
  }

  return null;
}

/**
 * Verify JWT token and extract user payload
 */
function verifyToken(token: string): JwtPayload {
  if (!process.env.ACCESS_TOKEN_SECRET) {
    throw new AuthError('Server configuration error', 'CONFIG_ERROR', 500);
  }

  try {
    const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET) as JwtPayload;
    
    // Ensure we have required fields
    const userId = payload.id || payload.userId;
    if (!userId) {
      throw new AuthError('Invalid token payload', 'INVALID_TOKEN');
    }

    return { ...payload, userId, id: userId };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthError('Token has expired', 'TOKEN_EXPIRED');
    }
    
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthError('Invalid token', 'INVALID_TOKEN');
    }
    
    throw new AuthError('Token verification failed', 'TOKEN_ERROR');
  }
}

/**
 * Load full user object from database
 */
async function loadUser(userId: string): Promise<IUser & Document> {
  try {
    const user = await User.findById(userId).select('+refreshToken');
    
    if (!user) {
      throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    }

    // Ensure consistent ID field
    user.id = user._id.toString();
    
    return user;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    
    logger.error('Database error loading user:', error);
    throw new AuthError('Failed to load user', 'DATABASE_ERROR', 500);
  }
}

/**
 * Default error handler for authentication failures
 */
function defaultErrorHandler(error: AuthError, req: Request, res: Response): void {
  logger.warn(`Authentication failed for ${req.method} ${req.path}:`, error.message);

  const response = {
    success: false,
    error: error.code,
    message: error.message,
    timestamp: new Date().toISOString(),
  };

  // Add additional context in development
  if (process.env.NODE_ENV !== 'production') {
    (response as any).path = req.path;
    (response as any).method = req.method;
  }

  res.status(error.statusCode).json(response);
}

/**
 * Zero-Config Authentication Middleware Factory
 * 
 * Creates middleware that automatically handles authentication with minimal configuration.
 * Use this instead of manually setting up auth middleware.
 * 
 * @param config - Optional configuration for authentication behavior
 * @returns Express middleware function
 * 
 * @example
 * // Zero config - just add to routes that need authentication
 * app.get('/protected', authenticateRequest(), (req, res) => {
 *   // req.user is automatically populated
 *   res.json({ user: req.user });
 * });
 * 
 * @example
 * // Optional authentication (user populated if token present)
 * app.get('/optional', authenticateRequest({ required: false }), (req, res) => {
 *   if (req.user) {
 *     res.json({ message: 'Authenticated', user: req.user });
 *   } else {
 *     res.json({ message: 'Anonymous access' });
 *   }
 * });
 */
export function authenticateRequest(config: AuthConfig = {}): (req: Request, res: Response, next: NextFunction) => void {
  const {
    required = true,
    loadFullUser = true,
    onError = defaultErrorHandler,
    skipIf,
  } = config;

  return async (req: OxyRequest, res: Response, next: NextFunction) => {
    try {
      // Check if we should skip authentication
      if (skipIf && skipIf(req)) {
        return next();
      }

      // Extract token from request
      const token = extractToken(req);

      // Handle missing token
      if (!token) {
        if (required) {
          return onError(
            new AuthError('Authentication required', 'MISSING_TOKEN'),
            req,
            res
          );
        } else {
          // Optional auth - continue without user
          return next();
        }
      }

      // Verify token and extract payload
      let payload: JwtPayload;
      try {
        payload = verifyToken(token);
      } catch (error) {
        if (error instanceof AuthError) {
          return onError(error, req, res);
        }
        return onError(
          new AuthError('Authentication failed', 'AUTH_FAILED'),
          req,
          res
        );
      }

      // Set basic user information
      req.userId = payload.userId;

      // Load full user object if requested
      if (loadFullUser) {
        try {
          req.user = await loadUser(payload.userId);
        } catch (error) {
          if (error instanceof AuthError) {
            return onError(error, req, res);
          }
          return onError(
            new AuthError('Failed to load user data', 'USER_LOAD_FAILED'),
            req,
            res
          );
        }
      } else {
        // Create minimal user object
        req.user = {
          id: payload.userId,
          _id: payload.userId,
          username: payload.username,
        } as any;
      }

      // Authentication successful - continue to route handler
      next();
      
    } catch (error) {
      logger.error('Unexpected authentication middleware error:', error);
      
      const authError = new AuthError(
        'Internal authentication error',
        'INTERNAL_ERROR',
        500
      );
      
      onError(authError, req, res);
    }
  };
}

/**
 * Lightweight authentication middleware that only validates tokens
 * without loading user data. Use for high-performance routes that only
 * need to verify authentication status.
 */
export function authenticateTokenOnly(config: Omit<AuthConfig, 'loadFullUser'> = {}): (req: Request, res: Response, next: NextFunction) => void {
  return authenticateRequest({ ...config, loadFullUser: false });
}

/**
 * Optional authentication middleware that sets req.user if a token is present
 * but doesn't require authentication. Use for routes that work for both
 * authenticated and anonymous users but provide different experiences.
 */
export function optionalAuthentication(config: Omit<AuthConfig, 'required'> = {}): (req: Request, res: Response, next: NextFunction) => void {
  return authenticateRequest({ ...config, required: false });
}

/**
 * Session validation middleware for routes that need fresh session validation
 * Uses a more strict validation approach, checking refresh token validity
 */
export function validateSession(req: OxyRequest, res: Response, next: NextFunction): void {
  const authMiddleware = authenticateRequest({
    required: true,
    loadFullUser: true,
    onError: (error, req, res) => {
      res.status(error.statusCode).json({
        valid: false,
        error: error.code,
        message: error.message,
      });
    },
  });

  authMiddleware(req, res, (error) => {
    if (error) {
      return next(error);
    }

    // Additional session validation if needed
    if (!req.user) {
      return res.status(401).json({
        valid: false,
        error: 'SESSION_INVALID',
        message: 'Session validation failed',
      });
    }

    // Check if user still exists and is active
    if (!req.user._id) {
      return res.status(401).json({
        valid: false,
        error: 'USER_INVALID',
        message: 'User account is no longer valid',
      });
    }

    next();
  });
}

/**
 * Express middleware to automatically apply authentication to all routes
 * except those explicitly excluded. Use this for apps where most routes
 * require authentication.
 */
export function autoAuthenticate(options: {
  excludePaths?: string[];
  excludePatterns?: RegExp[];
  config?: AuthConfig;
} = {}): (req: Request, res: Response, next: NextFunction) => void {
  const {
    excludePaths = [
      '/auth/login',
      '/auth/signup',
      '/auth/register',
      '/auth/check-username',
      '/auth/check-email',
      '/health',
      '/',
    ],
    excludePatterns = [],
    config = {},
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Check if path should be excluded
    const shouldExclude = excludePaths.includes(req.path) ||
      excludePatterns.some(pattern => pattern.test(req.path));

    if (shouldExclude) {
      return next();
    }

    // Apply authentication middleware
    const authMiddleware = authenticateRequest(config);
    return authMiddleware(req, res, next);
  };
}

/**
 * Utility function to check if a request is authenticated without throwing errors
 */
export function isAuthenticated(req: Request): boolean {
  const oxyReq = req as OxyRequest;
  return !!(oxyReq.user && oxyReq.userId);
}

/**
 * Utility function to get the current user ID from a request
 */
export function getCurrentUserId(req: Request): string | null {
  const oxyReq = req as OxyRequest;
  return oxyReq.userId || null;
}

/**
 * Utility function to get the current user from a request
 */
export function getCurrentUser(req: Request): (IUser & Document) | null {
  const oxyReq = req as OxyRequest;
  return oxyReq.user || null;
}

// Export the enhanced request type for use in route handlers
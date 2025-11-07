/**
 * Optional Authentication Middleware
 * 
 * Similar to authMiddleware but doesn't reject requests without authentication.
 * Sets req.user if a valid token is present, otherwise leaves it undefined.
 * This allows routes to serve public content while still identifying authenticated users.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    _id: string;
    [key: string]: any;
  };
}

/**
 * Optional authentication middleware
 * Attempts to authenticate but doesn't block if authentication fails
 */
export function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    // Check for token in Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth token provided, continue without user
      return next();
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(
        token,
        process.env.ACCESS_TOKEN_SECRET || 'default_secret'
      );
      
      req.user = decoded as { _id: string; [key: string]: any };
      logger.debug('Optional auth: User authenticated', { userId: req.user._id });
    } catch (jwtError) {
      // Invalid token, but continue without user
      logger.debug('Optional auth: Invalid token, continuing without user', { error: jwtError });
    }
    
    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    // Even on error, continue without blocking the request
    next();
  }
}

/**
 * Extract user ID from request (works with both auth and optional auth)
 */
export function getUserId(req: AuthenticatedRequest): string | undefined {
  return req.user?._id;
}

/**
 * Optional Authentication Middleware
 * 
 * Similar to authMiddleware but doesn't reject requests without authentication.
 * Sets req.user if a valid token is present, otherwise leaves it undefined.
 * This allows routes to serve public content while still identifying authenticated users.
 */

import { Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { authenticateRequestNonBlocking, AuthenticatedRequest } from './authUtils';

/**
 * Optional authentication middleware
 * Attempts to authenticate but doesn't block if authentication fails
 * Handles both session-based tokens and legacy tokens
 */
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { user, source } = await authenticateRequestNonBlocking(req, false);
    
    if (user) {
      req.user = user;
      logger.debug('Optional auth: User authenticated', { 
        userId: user._id, 
        source: source || 'unknown'
      });
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

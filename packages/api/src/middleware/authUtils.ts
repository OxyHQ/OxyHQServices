/**
 * Shared Authentication Utilities
 * 
 * Common functions used by both authMiddleware and optionalAuthMiddleware
 * to avoid code duplication and ensure consistency
 */

import { Request } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import sessionService from '../services/session.service';
import User from '../models/User';

export interface TokenDecoded {
  userId?: string;
  id?: string;
  _id?: string;
  sessionId?: string;
  exp?: number;
  [key: string]: any;
}

export interface NormalizedUser {
  _id: string;
  [key: string]: any;
}

export interface AuthenticatedRequest extends Request {
  user?: NormalizedUser;
}

/**
 * Extract token from request (header or query param)
 */
export function extractTokenFromRequest(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  if (req.query.token && typeof req.query.token === 'string') {
    return req.query.token;
  }
  
  return undefined;
}

/**
 * Decode JWT token
 */
export function decodeToken(token: string): TokenDecoded | null {
  try {
    return jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET || 'default_secret'
    ) as TokenDecoded;
  } catch (error) {
    return null;
  }
}

/**
 * Extract user ID from decoded token (supports multiple token formats)
 */
export function extractUserIdFromDecoded(decoded: TokenDecoded): string | null {
  return decoded.userId || decoded.id || decoded._id || null;
}

/**
 * Normalize user object to ensure _id is always a string
 */
export function normalizeUser(user: any): NormalizedUser | null {
  if (!user) return null;
  
  const userId = user._id?.toString() || user.id?.toString();
  if (!userId) return null;
  
  const userObj = user.toObject ? user.toObject() : (typeof user === 'object' && user !== null ? user : {});
  const { _id, id, ...restUser } = userObj as any;
  
  return {
    ...restUser,
    _id: userId
  };
}

/**
 * Validate session-based token and return normalized user
 */
export async function validateSessionToken(token: string): Promise<NormalizedUser | null> {
  try {
    const validationResult = await sessionService.validateSession(token);
    
    if (!validationResult?.user) {
      return null;
    }
    
    return normalizeUser(validationResult.user);
  } catch (error) {
    logger.debug('Session validation error', { error });
    return null;
  }
}

/**
 * Get user from database by ID (for legacy tokens)
 */
export async function getUserById(userId: string, includeRefreshToken: boolean = false): Promise<NormalizedUser | null> {
  try {
    const query = User.findById(userId);
    if (includeRefreshToken) {
      query.select('+refreshToken');
    }
    const user = await query.lean();
    return normalizeUser(user);
  } catch (error) {
    logger.debug('Database error fetching user', { error, userId });
    return null;
  }
}

/**
 * Authenticate request and return normalized user (non-blocking)
 * Returns null if authentication fails (doesn't throw)
 */
export async function authenticateRequestNonBlocking(
  req: Request,
  requireAuth: boolean = false
): Promise<{ user: NormalizedUser | null; source: 'header' | 'query' | null }> {
  const token = extractTokenFromRequest(req);
  const source = req.headers.authorization ? 'header' : (req.query.token ? 'query' : null);
  
  if (!token) {
    return { user: null, source };
  }
  
  const decoded = decodeToken(token);
  if (!decoded) {
    return { user: null, source };
  }
  
  // Session-based token
  if (decoded.sessionId) {
    const user = await validateSessionToken(token);
    return { user, source };
  }
  
  // Legacy token
  const userId = extractUserIdFromDecoded(decoded);
  if (!userId) {
    return { user: null, source };
  }
  
  const user = await getUserById(userId, false);
  return { user, source };
}


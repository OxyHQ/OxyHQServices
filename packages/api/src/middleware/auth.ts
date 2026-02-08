import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
import { Document } from 'mongoose';
import sessionService from '../services/session.service';
import { 
  extractTokenFromRequest, 
  decodeToken, 
  validateSessionToken
} from './authUtils';

// Ensure environment variables are loaded
dotenv.config();

/**
 * Interface for requests with full user object
 */
export interface AuthRequest extends Request {
  user?: IUser & Document;
}

/**
 * Interface for requests with just user ID
 */
export interface SimpleAuthRequest extends Request {
  user?: {
    id: string;
  };
}

/**
 * Authentication middleware that validates JWT tokens and attaches the full user object to the request
 * 
 * Optimized for high-scale usage:
 * - Uses session-based tokens only
 * - Uses session service with caching to minimize database queries
 * - Eliminates redundant user fetches by using populated user from validation
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Support Authorization via header or query parameter (?token= or ?access_token=)
    let authHeader = req.headers.authorization;
    let tokenFromQuery: string | undefined;
    const q = req.query as Record<string, any>;
    if (!authHeader) {
      if (typeof q.token === 'string' && q.token) tokenFromQuery = q.token;
      else if (typeof q.access_token === 'string' && q.access_token) tokenFromQuery = q.access_token;
      if (tokenFromQuery) {
        authHeader = `Bearer ${tokenFromQuery}`;
      }
    }
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Invalid or missing authorization header'
      });
    }

    const token = authHeader.split(' ')[1];
    
    if (!process.env.ACCESS_TOKEN_SECRET) {
      logger.error('ACCESS_TOKEN_SECRET not configured');
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Server configuration error'
      });
    }

    try {
      // Decode token to check if it's session-based
      const decoded = decodeToken(token);
      
      if (!decoded) {
        return res.status(401).json({
          error: 'Invalid token',
          message: 'Token could not be decoded'
        });
      }
      
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Token decoded', { 
          hasSessionId: !!decoded.sessionId, 
          sessionId: decoded.sessionId,
          userId: decoded.userId,
          exp: decoded.exp 
        });
      }
      
      // Only session-based tokens are supported
      if (!decoded.sessionId) {
        return res.status(401).json({
          error: 'Invalid token',
          message: 'Token must be session-based. Legacy token format is no longer supported.'
        });
      }

      // Session-based token - validate session using service layer
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Validating session-based token', { sessionId: decoded.sessionId });
      }
      
      try {
        // Use session service for optimized validation with caching
        const validationResult = await sessionService.validateSession(token);

        if (!validationResult) {
          if (process.env.NODE_ENV === 'development') {
            logger.debug('Session validation failed', { sessionId: decoded.sessionId });
          }
          return res.status(401).json({
            error: 'Invalid session',
            message: 'Session not found or expired'
          });
        }

        const { user } = validationResult;

        if (!user) {
          return res.status(401).json({
            error: 'Invalid session',
            message: 'User not found'
          });
        }

        // Use user from validationResult - it's already populated with all fields
        // This eliminates a redundant database query on every authenticated request
        const fullUser = user as IUser & Document;
        
        // Ensure id field is set consistently
        if (fullUser._id) {
          fullUser.id = fullUser._id.toString();
        }
        req.user = fullUser;
        
        next();
      } catch (dbError) {
        logger.error('Database error during session lookup', dbError instanceof Error ? dbError : new Error(String(dbError)), {
          component: 'auth',
          method: 'authMiddleware',
        });
        return res.status(500).json({
          error: 'Database error',
          message: 'Error validating session'
        });
      }
    } catch (error) {
      logger.error('Token verification error', error instanceof Error ? error : new Error(String(error)), {
        component: 'auth',
        method: 'authMiddleware',
      });
      
      if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({
          error: 'Token expired',
          message: 'Your session has expired. Please log in again.'
        });
      }
      
      if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({
          error: 'Invalid token',
          message: 'The provided authentication token is invalid'
        });
      }
      
      return res.status(401).json({
        error: 'Authentication error',
        message: 'An error occurred while authenticating your request'
      });
    }
  } catch (error) {
    logger.error('Auth middleware error', error instanceof Error ? error : new Error(String(error)), {
      component: 'auth',
      method: 'authMiddleware',
    });
    return res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while authenticating your request'
    });
  }
};

/**
 * Simplified authentication middleware that only validates the token and attaches the user ID
 * 
 * Optimized for high-scale usage - lighter weight than full authMiddleware.
 * Uses session-based tokens only.
 * Use this when you only need the user ID, not the full user object.
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const simpleAuthMiddleware = async (req: SimpleAuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Invalid or missing authorization header'
      });
    }

    const token = authHeader.split(' ')[1];
    if (!process.env.ACCESS_TOKEN_SECRET) {
      logger.error('ACCESS_TOKEN_SECRET not configured');
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Server configuration error'
      });
    }

    try {
      // Decode token to check if it's session-based
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as any;

      // Only session-based tokens are supported
      if (!decoded.sessionId) {
        return res.status(401).json({
          error: 'Invalid token',
          message: 'Token must be session-based. Legacy token format is no longer supported.'
        });
      }

      // Session-based token - validate session using service layer
      const validationResult = await sessionService.validateSession(token);

      if (!validationResult) {
        return res.status(401).json({
          error: 'Invalid session',
          message: 'Session not found or expired'
        });
      }

      // Set user ID
      const userId = validationResult.user?._id?.toString() || validationResult.session.userId.toString();
      req.user = { id: userId };
      next();
    } catch (error) {
      logger.error('Token verification error', error instanceof Error ? error : new Error(String(error)), {
        component: 'auth',
        method: 'simpleAuthMiddleware',
      });

      if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({
          error: 'Token expired',
          message: 'Your session has expired. Please log in again.'
        });
      }

      if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({
          error: 'Invalid token',
          message: 'The provided authentication token is invalid'
        });
      }

      return res.status(401).json({
        error: 'Authentication error',
        message: 'An error occurred while authenticating your request'
      });
    }
  } catch (error) {
    logger.error('Unexpected auth error', error instanceof Error ? error : new Error(String(error)), {
      component: 'auth',
      method: 'simpleAuthMiddleware',
    });
    return res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while authenticating your request'
    });
  }
};
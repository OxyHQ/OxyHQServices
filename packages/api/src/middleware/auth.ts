import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';
import Session from '../models/Session';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
import { Document } from 'mongoose';

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
 * Extract user ID from JWT token
 */
const extractUserIdFromToken = (token: string): string | null => {
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as { id: string };
    return decoded.id || null;
  } catch (error) {
    logger.error('Error extracting user ID from token:', error);
    return null;
  }
};

/**
 * Authentication middleware that validates JWT tokens and attaches the full user object to the request
 * Supports both old token format and new session-based tokens
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
        success: false,
        message: 'Server configuration error'
      });
    }

    try {
      // Decode token to check if it's session-based
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as any;
      
      logger.debug('Token decoded:', { 
        hasSessionId: !!decoded.sessionId, 
        sessionId: decoded.sessionId,
        userId: decoded.userId,
        exp: decoded.exp 
      });
      
      if (decoded.sessionId) {
        // Session-based token - validate session
        logger.debug('Validating session-based token for sessionId:', decoded.sessionId);
        
        let session;
        try {
          session = await Session.findOne({
            sessionId: decoded.sessionId,
            isActive: true,
            expiresAt: { $gt: new Date() }
          }).populate('userId');

          logger.debug('Session lookup result:', { 
            found: !!session, 
            sessionId: session?.sessionId,
            isActive: session?.isActive,
            expiresAt: session?.expiresAt 
          });

          if (!session) {
            // Log additional debugging info for production troubleshooting
            const allSessions = await Session.find({ sessionId: decoded.sessionId });
            logger.warn('Session not found or expired for sessionId:', decoded.sessionId, {
              totalSessionsWithId: allSessions.length,
              sessions: allSessions.map(s => ({
                sessionId: s.sessionId,
                isActive: s.isActive,
                expiresAt: s.expiresAt,
                userId: s.userId
              }))
            });
            
            return res.status(401).json({
              error: 'Invalid session',
              message: 'Session not found or expired'
            });
          }
        } catch (dbError) {
          logger.error('Database error during session lookup:', dbError);
          return res.status(500).json({
            error: 'Database error',
            message: 'Error validating session'
          });
        }

        // Update session activity
        session.deviceInfo.lastActive = new Date();
        await session.save();

        // Get user data - handle both populated and unpopulated cases
        let user;
        if (session.userId && typeof session.userId === 'object' && '_id' in session.userId) {
          // userId is populated
          user = session.userId as any;
        } else {
          // userId is not populated, fetch user separately
          user = await User.findById(session.userId).select('-password');
        }
        
        if (!user) {
          return res.status(401).json({
            error: 'Invalid session',
            message: 'User not found'
          });
        }

        // Ensure id field is set consistently
        user.id = user._id.toString();
        req.user = user;
        
        next();
      } else {
        // Old token format - use existing logic
        const userId = extractUserIdFromToken(token);
        if (!userId) {
          return res.status(401).json({
            error: 'Invalid token',
            message: 'User ID not found in token'
          });
        }

        // Get user from database
        const user = await User.findById(userId).select('+refreshToken');
        if (!user) {
          return res.status(401).json({
            error: 'Invalid token',
            message: 'User not found'
          });
        }

        // Ensure id field is set consistently
        user.id = user._id.toString();
        req.user = user;
        
        next();
      }
    } catch (error) {
      logger.error('Token verification error:', error);
      
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
    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while authenticating your request'
    });
  }
};

/**
 * Simplified authentication middleware that only validates the token and attaches the user ID
 * Supports both old token format and new session-based tokens
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
        success: false,
        message: 'Server configuration error'
      });
    }

    try {
      // Decode token to check if it's session-based
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as any;
      
      if (decoded.sessionId) {
        // Session-based token - validate session
        const session = await Session.findOne({
          sessionId: decoded.sessionId,
          isActive: true,
          expiresAt: { $gt: new Date() }
        });

        if (!session) {
          return res.status(401).json({
            error: 'Invalid session',
            message: 'Session not found or expired'
          });
        }

        // Update session activity
        session.deviceInfo.lastActive = new Date();
        await session.save();

        // Set user ID
        req.user = { id: session.userId.toString() };
        next();
      } else {
        // Old token format - use existing logic
        const userId = extractUserIdFromToken(token);
        if (!userId) {
          return res.status(401).json({
            error: 'Invalid token',
            message: 'User ID not found in token'
          });
        }

        // Set just the ID for simple auth
        req.user = { id: userId };
        next();
      }
    } catch (error) {
      logger.error('Token verification error:', error);

      if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({
          success: false,
          message: 'Session expired',
          code: 'TOKEN_EXPIRED'
        });
      }
      
      if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({
          error: 'Invalid session',
          code: 'INVALID_SESSION'
        });
      }
      
      return res.status(401).json({
        success: false,
        message: 'Authentication error',
        code: 'TOKEN_ERROR'
      });
    }
  } catch (error) {
    logger.error('Unexpected auth error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
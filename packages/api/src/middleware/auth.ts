import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
import { Document } from 'mongoose';
import { updateSessionActivity } from '../utils/sessionUtils';

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
 * Use this when you need the complete user profile in your route handler
 */
export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
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
      // Verify token and extract user ID
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
      
      // Update session activity asynchronously
      updateSessionActivity(token).catch(err => 
        logger.error('Error updating session activity:', err)
      );
      
      next();
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
 * to the request without fetching the full user object
 * Use this when you only need the user ID in your route handler
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
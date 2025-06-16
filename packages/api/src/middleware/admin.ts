import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { logger } from '../utils/logger';

// Extend Express Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: any; // Ideally define a User interface but any will work for now
    }
  }
}

/**
 * Middleware to ensure user is an admin
 * Note: This must be used after the authMiddleware to have req.user available
 */
export const adminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Make sure user is authenticated and req.user exists
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'Unauthorized: Authentication required' });
    }

    // Fetch user and check if they're an admin
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if user has admin role
    // This implements a simple admin check based on username
    // In a real app, you would have a proper roles system
    // For simplicity, we're just checking if username contains 'admin'
    if (!user.username.includes('admin')) {
      return res.status(403).json({ message: 'Forbidden: Admin privileges required' });
    }

    // User is an admin, proceed
    next();
  } catch (error) {
    logger.error('Error in admin middleware:', error);
    return res.status(500).json({ message: 'Server error in admin authorization' });
  }
}; 
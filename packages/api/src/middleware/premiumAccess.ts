import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { logger } from '../utils/logger';

export const checkPremiumAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userID } = req.query;
    if (!userID) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await User.findById(userID);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.privacySettings?.analyticsSharing) {
      return res.status(403).json({ 
        message: "Analytics access denied", 
        error: "PREMIUM_REQUIRED",
        details: "Analytics features require a premium subscription"
      });
    }

    next();
  } catch (error) {
    logger.error('Error checking premium access:', error);
    res.status(500).json({ 
      message: "Error checking premium access",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
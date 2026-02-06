import { Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AuthRequest } from './auth';

export const checkPremiumAccess = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ message: "Authentication required" });
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
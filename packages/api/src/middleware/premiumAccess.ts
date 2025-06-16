import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { EntitlementService, FeatureType } from '../services/entitlementService';
import { logger } from '../utils/logger';

/**
 * Enhanced premium access middleware that supports flexible feature checking
 * Can check for specific features or any premium access
 * 
 * @param features - Optional array of specific features to check for. If not provided, checks for any premium features
 */
export const checkPremiumAccess = (features?: FeatureType[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userID } = req.query;
      if (!userID || typeof userID !== 'string') {
        return res.status(400).json({ message: "Valid User ID is required" });
      }

      const user = await User.findOne({ _id: { $eq: userID } });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get user's entitlement data
      const entitlement = await EntitlementService.getUserEntitlement(userID as string);

      // If specific features are requested, check for those
      if (features && features.length > 0) {
        const hasAccess = await EntitlementService.hasAllFeatureAccess(userID as string, features);
        
        if (!hasAccess) {
          return res.status(403).json({
            message: "Feature access denied",
            error: "PREMIUM_REQUIRED",
            details: `Access to features [${features.join(', ')}] requires a premium subscription`,
            requiredFeatures: features,
            userPlans: entitlement.activePlans,
            userFeatures: entitlement.allFeatures
          });
        }
      } else {
        // Default behavior: check if user has any premium features (backward compatibility)
        if (!entitlement.isActive || entitlement.allFeatures.length === 0) {
          return res.status(403).json({
            message: "Premium access denied",
            error: "PREMIUM_REQUIRED", 
            details: "This feature requires a premium subscription",
            userPlans: entitlement.activePlans,
            userFeatures: entitlement.allFeatures
          });
        }
      }

      // Add entitlement data to request for use in route handlers
      (req as any).userEntitlement = entitlement;
      
      next();
    } catch (error) {
      logger.error('Error checking premium access:', error);
      res.status(500).json({
        message: "Error checking premium access",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  };
};

/**
 * Middleware specifically for analytics access (backward compatibility)
 */
export const checkAnalyticsAccess = checkPremiumAccess(['analytics']);

/**
 * Middleware for advanced analytics access
 */
export const checkAdvancedAnalyticsAccess = checkPremiumAccess(['advancedAnalytics']);

/**
 * Middleware for checking multiple feature access
 */
export const checkFeatureAccess = (features: FeatureType[]) => checkPremiumAccess(features);

/**
 * Legacy middleware for backward compatibility with existing code
 * This maintains the original function signature and behavior
 */
export const checkPremiumAccessLegacy = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userID } = req.query;
    if (!userID || typeof userID !== 'string') {
      return res.status(400).json({ message: "Valid User ID is required" });
    }

    const user = await User.findOne({ _id: { $eq: userID } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // For legacy compatibility, check both the old analyticsSharing flag and new entitlement system
    const hasLegacyAccess = user.privacySettings?.analyticsSharing;
    const hasNewAccess = await EntitlementService.hasFeatureAccess(userID as string, 'analytics');

    if (!hasLegacyAccess && !hasNewAccess) {
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
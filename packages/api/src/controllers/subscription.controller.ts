import { Request, Response } from "express";
import Subscription from "../models/Subscription";
import User from "../models/User";
import { EntitlementService, SubscriptionPlan, FeatureType } from "../services/entitlementService";
import { logger } from '../utils/logger';

export const getSubscription = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    // Get subscription data and entitlement information
    const subscription = await Subscription.findOne({ userId });
    const entitlement = await EntitlementService.getUserEntitlement(userId);
    
    res.json({
      subscription: subscription || { plan: "Free" },
      entitlement
    });
  } catch (error) {
    logger.error('Error fetching subscription:', error);
    res.status(500).json({ 
      message: "Error fetching subscription",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const updateSubscription = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { plan, individualFeatures } = req.body;

    // Validate plan if provided
    if (plan && !EntitlementService.getAllPlans().includes(plan)) {
      return res.status(400).json({ 
        message: "Invalid plan",
        availablePlans: EntitlementService.getAllPlans()
      });
    }

    // Validate individual features if provided
    if (individualFeatures && Array.isArray(individualFeatures)) {
      const validFeatures = EntitlementService.getAllFeatures();
      const invalidFeatures = individualFeatures.filter((f: string) => !validFeatures.includes(f as FeatureType));
      if (invalidFeatures.length > 0) {
        return res.status(400).json({ 
          message: "Invalid features",
          invalidFeatures,
          availableFeatures: validFeatures
        });
      }
    }

    // Initialize features object with all features set to false
    let features = {
      analytics: false,
      advancedAnalytics: false,
      premiumBadge: false,
      unlimitedFollowing: false,
      higherUploadLimits: false,
      promotedPosts: false,
      businessTools: false,
      undoPosts: false,
      customThemes: false,
      prioritySupport: false,
      advancedPrivacy: false,
      bulkActions: false,
      contentScheduling: false,
      teamCollaboration: false,
    };

    // Set features based on plan using the EntitlementService
    if (plan) {
      const planFeatures = EntitlementService.getPlanFeatures(plan as SubscriptionPlan);
      planFeatures.forEach(feature => {
        if (feature in features) {
          (features as any)[feature] = true;
        }
      });
    }

    // Add any individual features
    if (individualFeatures && Array.isArray(individualFeatures)) {
      individualFeatures.forEach((feature: FeatureType) => {
        if (feature in features) {
          (features as any)[feature] = true;
        }
      });
    }

    // For backward compatibility with legacy plans, maintain old logic
    if (plan === "pro" || plan === "business") {
      features = {
        ...features,
        analytics: true,
        premiumBadge: true,
        unlimitedFollowing: true,
        higherUploadLimits: true,
      };
    }

    if (plan === "business") {
      features = {
        ...features,
        promotedPosts: true,
        businessTools: true,
      };
    }

    // Calculate end date (30 days from now)
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    const subscription = await Subscription.findOneAndUpdate(
      { userId },
      {
        plan: plan || "Free",
        status: "active",
        startDate: new Date(),
        endDate,
        features,
      },
      { upsert: true, new: true }
    );

    // Update user analytics sharing based on subscription for backward compatibility
    await User.findByIdAndUpdate(
      userId,
      { 
        $set: { 
          "privacySettings.analyticsSharing": features.analytics || features.advancedAnalytics
        }
      }
    );

    // Get updated entitlement data
    const entitlement = await EntitlementService.getUserEntitlement(userId);

    res.json({
      subscription,
      entitlement
    });
  } catch (error) {
    logger.error('Error updating subscription:', error);
    res.status(500).json({ 
      message: "Error updating subscription",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const cancelSubscription = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const subscription = await Subscription.findOneAndUpdate(
      { userId },
      { status: "canceled" },
      { new: true }
    );

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    // Update user analytics sharing when subscription is canceled
    await User.findByIdAndUpdate(
      userId,
      { 
        $set: { 
          "privacySettings.analyticsSharing": false
        }
      }
    );

    res.json(subscription);
  } catch (error) {
    logger.error('Error canceling subscription:', error);
    res.status(500).json({ 
      message: "Error canceling subscription",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

/**
 * Get user entitlement information
 */
export const getUserEntitlement = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const entitlement = await EntitlementService.getUserEntitlement(userId);
    res.json(entitlement);
  } catch (error) {
    logger.error('Error fetching user entitlement:', error);
    res.status(500).json({ 
      message: "Error fetching user entitlement",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

/**
 * Check if user has access to specific features
 */
export const checkFeatureAccess = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { features } = req.query;
    
    if (!features) {
      return res.status(400).json({ message: "Features query parameter is required" });
    }
    
    const featureList = (features as string).split(',').map(f => f.trim()) as FeatureType[];
    const validFeatures = EntitlementService.getAllFeatures();
    const invalidFeatures = featureList.filter(f => !validFeatures.includes(f));
    
    if (invalidFeatures.length > 0) {
      return res.status(400).json({ 
        message: "Invalid features",
        invalidFeatures,
        availableFeatures: validFeatures
      });
    }
    
    const accessResults = await Promise.all(
      featureList.map(async feature => ({
        feature,
        hasAccess: await EntitlementService.hasFeatureAccess(userId, feature)
      }))
    );
    
    res.json({
      userId,
      features: accessResults,
      hasAllAccess: accessResults.every(r => r.hasAccess),
      hasAnyAccess: accessResults.some(r => r.hasAccess)
    });
  } catch (error) {
    logger.error('Error checking feature access:', error);
    res.status(500).json({ 
      message: "Error checking feature access",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

/**
 * Get available plans and their features
 */
export const getAvailablePlans = async (req: Request, res: Response) => {
  try {
    const plans = EntitlementService.getAllPlans().map(plan => ({
      plan,
      features: EntitlementService.getPlanFeatures(plan)
    }));
    
    res.json({
      plans,
      allFeatures: EntitlementService.getAllFeatures()
    });
  } catch (error) {
    logger.error('Error fetching available plans:', error);
    res.status(500).json({ 
      message: "Error fetching available plans",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
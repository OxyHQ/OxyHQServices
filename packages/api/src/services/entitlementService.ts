import { Types } from 'mongoose';
import Subscription from '../models/Subscription';
import { logger } from '../utils/logger';

/**
 * Available subscription plans in the OxyHQ ecosystem
 */
export type SubscriptionPlan = 
  | 'Free'
  | 'Mention+'
  | 'Oxy+ Insider'
  | 'Oxy+ Connect'
  | 'Oxy+ Premium'
  | 'Oxy+ Creator'
  // Legacy plans for backward compatibility
  | 'basic'
  | 'pro'
  | 'business';

/**
 * Available features that can be accessed individually or through plans
 */
export type FeatureType = 
  | 'analytics'
  | 'advancedAnalytics'
  | 'premiumBadge'
  | 'unlimitedFollowing'
  | 'higherUploadLimits'
  | 'promotedPosts'
  | 'businessTools'
  | 'undoPosts'
  | 'customThemes'
  | 'prioritySupport'
  | 'advancedPrivacy'
  | 'bulkActions'
  | 'contentScheduling'
  | 'teamCollaboration';

/**
 * User entitlement data structure
 */
export interface UserEntitlement {
  userId: string;
  activePlans: SubscriptionPlan[];
  individualFeatures: FeatureType[];
  planFeatures: FeatureType[];
  allFeatures: FeatureType[];
  isActive: boolean;
}

/**
 * Plan definitions with their included features
 * This centralizes the feature mapping for all plans
 */
const PLAN_FEATURES: Record<SubscriptionPlan, FeatureType[]> = {
  'Free': [],
  'Mention+': ['analytics', 'premiumBadge'],
  'Oxy+ Insider': ['analytics', 'premiumBadge', 'advancedPrivacy', 'customThemes'],
  'Oxy+ Connect': ['analytics', 'premiumBadge', 'unlimitedFollowing', 'advancedPrivacy', 'prioritySupport'],
  'Oxy+ Premium': [
    'analytics', 'advancedAnalytics', 'premiumBadge', 'unlimitedFollowing', 
    'higherUploadLimits', 'undoPosts', 'customThemes', 'prioritySupport', 
    'advancedPrivacy', 'bulkActions'
  ],
  'Oxy+ Creator': [
    'analytics', 'advancedAnalytics', 'premiumBadge', 'unlimitedFollowing',
    'higherUploadLimits', 'promotedPosts', 'businessTools', 'undoPosts',
    'customThemes', 'prioritySupport', 'advancedPrivacy', 'bulkActions',
    'contentScheduling', 'teamCollaboration'
  ],
  // Legacy plan support for backward compatibility
  'basic': [],
  'pro': ['analytics', 'premiumBadge', 'unlimitedFollowing', 'higherUploadLimits'],
  'business': [
    'analytics', 'premiumBadge', 'unlimitedFollowing', 'higherUploadLimits',
    'promotedPosts', 'businessTools'
  ]
};

/**
 * Entitlement Service for managing user subscription and feature access
 */
export class EntitlementService {
  /**
   * Get comprehensive entitlement data for a user
   */
  static async getUserEntitlement(userId: string | Types.ObjectId): Promise<UserEntitlement> {
    try {
      const userIdStr = userId.toString();
      
      // Find all active subscriptions for the user
      const subscriptions = await Subscription.find({
        userId: userIdStr,
        status: 'active',
        endDate: { $gt: new Date() }
      });

      // Extract active plans
      const activePlans: SubscriptionPlan[] = subscriptions.map(sub => sub.plan as SubscriptionPlan);
      
      // Get features from plans
      const planFeatures = new Set<FeatureType>();
      activePlans.forEach(plan => {
        const features = PLAN_FEATURES[plan] || [];
        features.forEach(feature => planFeatures.add(feature));
      });

      // Get individual features from subscription features object
      const individualFeatures = new Set<FeatureType>();
      subscriptions.forEach(subscription => {
        if (subscription.features) {
          Object.entries(subscription.features).forEach(([featureKey, enabled]) => {
            if (enabled && featureKey in subscription.features) {
              // Map subscription feature keys to our FeatureType enum
              const mappedFeature = this.mapSubscriptionFeatureToFeatureType(featureKey);
              if (mappedFeature) {
                individualFeatures.add(mappedFeature);
              }
            }
          });
        }
      });

      // Combine all features
      const allFeatures = new Set([...planFeatures, ...individualFeatures]);

      return {
        userId: userIdStr,
        activePlans,
        individualFeatures: Array.from(individualFeatures),
        planFeatures: Array.from(planFeatures),
        allFeatures: Array.from(allFeatures),
        isActive: subscriptions.length > 0
      };
    } catch (error) {
      logger.error('Error getting user entitlement:', error);
      // Return default entitlement on error
      return {
        userId: userId.toString(),
        activePlans: ['Free'],
        individualFeatures: [],
        planFeatures: [],
        allFeatures: [],
        isActive: false
      };
    }
  }

  /**
   * Check if user has access to a specific feature
   */
  static async hasFeatureAccess(userId: string | Types.ObjectId, feature: FeatureType): Promise<boolean> {
    try {
      const entitlement = await this.getUserEntitlement(userId);
      return entitlement.allFeatures.includes(feature);
    } catch (error) {
      logger.error('Error checking feature access:', error);
      return false;
    }
  }

  /**
   * Check if user has access to any of the specified features
   */
  static async hasAnyFeatureAccess(userId: string | Types.ObjectId, features: FeatureType[]): Promise<boolean> {
    try {
      const entitlement = await this.getUserEntitlement(userId);
      return features.some(feature => entitlement.allFeatures.includes(feature));
    } catch (error) {
      logger.error('Error checking any feature access:', error);
      return false;
    }
  }

  /**
   * Check if user has access to all specified features
   */
  static async hasAllFeatureAccess(userId: string | Types.ObjectId, features: FeatureType[]): Promise<boolean> {
    try {
      const entitlement = await this.getUserEntitlement(userId);
      return features.every(feature => entitlement.allFeatures.includes(feature));
    } catch (error) {
      logger.error('Error checking all feature access:', error);
      return false;
    }
  }

  /**
   * Check if user has a specific plan
   */
  static async hasPlan(userId: string | Types.ObjectId, plan: SubscriptionPlan): Promise<boolean> {
    try {
      const entitlement = await this.getUserEntitlement(userId);
      return entitlement.activePlans.includes(plan);
    } catch (error) {
      logger.error('Error checking plan access:', error);
      return false;
    }
  }

  /**
   * Get features available in a specific plan
   */
  static getPlanFeatures(plan: SubscriptionPlan): FeatureType[] {
    return PLAN_FEATURES[plan] || [];
  }

  /**
   * Get all available plans
   */
  static getAllPlans(): SubscriptionPlan[] {
    return Object.keys(PLAN_FEATURES) as SubscriptionPlan[];
  }

  /**
   * Get all available features
   */
  static getAllFeatures(): FeatureType[] {
    return [
      'analytics', 'advancedAnalytics', 'premiumBadge', 'unlimitedFollowing',
      'higherUploadLimits', 'promotedPosts', 'businessTools', 'undoPosts',
      'customThemes', 'prioritySupport', 'advancedPrivacy', 'bulkActions',
      'contentScheduling', 'teamCollaboration'
    ];
  }

  /**
   * Map subscription model feature keys to our FeatureType enum
   * This provides backward compatibility with existing subscription data
   */
  private static mapSubscriptionFeatureToFeatureType(subscriptionFeature: string): FeatureType | null {
    const mapping: Record<string, FeatureType> = {
      'analytics': 'analytics',
      'premiumBadge': 'premiumBadge',
      'unlimitedFollowing': 'unlimitedFollowing',
      'higherUploadLimits': 'higherUploadLimits',
      'promotedPosts': 'promotedPosts',
      'businessTools': 'businessTools'
    };
    
    return mapping[subscriptionFeature] || null;
  }
}

/**
 * Utility functions for common feature checks
 */
export const FeatureChecks = {
  /**
   * Check if user has analytics access (basic or advanced)
   */
  hasAnalyticsAccess: (userId: string | Types.ObjectId) => 
    EntitlementService.hasAnyFeatureAccess(userId, ['analytics', 'advancedAnalytics']),

  /**
   * Check if user has advanced analytics access
   */
  hasAdvancedAnalyticsAccess: (userId: string | Types.ObjectId) => 
    EntitlementService.hasFeatureAccess(userId, 'advancedAnalytics'),

  /**
   * Check if user has premium badge access
   */
  hasPremiumBadgeAccess: (userId: string | Types.ObjectId) => 
    EntitlementService.hasFeatureAccess(userId, 'premiumBadge'),

  /**
   * Check if user has undo posts feature
   */
  hasUndoPostsAccess: (userId: string | Types.ObjectId) => 
    EntitlementService.hasFeatureAccess(userId, 'undoPosts'),

  /**
   * Check if user has unlimited following
   */
  hasUnlimitedFollowing: (userId: string | Types.ObjectId) => 
    EntitlementService.hasFeatureAccess(userId, 'unlimitedFollowing'),

  /**
   * Check if user has content promotion features
   */
  hasPromotionAccess: (userId: string | Types.ObjectId) => 
    EntitlementService.hasFeatureAccess(userId, 'promotedPosts'),

  /**
   * Check if user has business tools access
   */
  hasBusinessToolsAccess: (userId: string | Types.ObjectId) => 
    EntitlementService.hasFeatureAccess(userId, 'businessTools')
};
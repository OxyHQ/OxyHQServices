# OxyHQ Entitlement System - Usage Examples

This file provides practical examples of how to use the new entitlement system in your API routes and application logic.

## Quick Start Examples

### 1. Basic Feature Checking

```typescript
import { EntitlementService, FeatureChecks } from '../services/entitlementService';

// Check if a user has analytics access
async function checkUserAnalytics(userId: string) {
  const hasAccess = await FeatureChecks.hasAnalyticsAccess(userId);
  if (hasAccess) {
    console.log('User has analytics access');
  }
}

// Check for specific advanced features
async function checkAdvancedFeatures(userId: string) {
  const canUndoPosts = await EntitlementService.hasFeatureAccess(userId, 'undoPosts');
  const hasAdvancedAnalytics = await EntitlementService.hasFeatureAccess(userId, 'advancedAnalytics');
  
  return { canUndoPosts, hasAdvancedAnalytics };
}
```

### 2. Middleware Usage in Routes

```typescript
import express from 'express';
import { checkPremiumAccess, checkAnalyticsAccess, checkFeatureAccess } from '../middleware/premiumAccess';

const router = express.Router();

// Basic premium access check
router.get('/premium-features', checkPremiumAccess(), (req, res) => {
  // User has some premium features
  const userEntitlement = (req as any).userEntitlement;
  res.json({
    message: 'Welcome to premium features!',
    availableFeatures: userEntitlement.allFeatures
  });
});

// Specific feature access
router.get('/analytics-dashboard', checkAnalyticsAccess, (req, res) => {
  res.json({ message: 'Analytics dashboard data' });
});

// Multiple feature requirements
router.get('/advanced-tools', 
  checkFeatureAccess(['advancedAnalytics', 'bulkActions']), 
  (req, res) => {
    res.json({ message: 'Advanced tools available' });
  }
);

// Business features
router.get('/business-dashboard', 
  checkFeatureAccess(['businessTools', 'teamCollaboration']), 
  (req, res) => {
    res.json({ message: 'Business dashboard' });
  }
);
```

### 3. Subscription Management

```typescript
// Create or update a subscription
async function updateUserSubscription(userId: string, plan: string) {
  const response = await fetch(`/api/subscription/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan })
  });
  
  const result = await response.json();
  return result;
}

// Add individual features to a subscription
async function addIndividualFeatures(userId: string, features: string[]) {
  const response = await fetch(`/api/subscription/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      plan: 'Free', // Keep current plan
      individualFeatures: features 
    })
  });
  
  return response.json();
}

// Example usage:
// updateUserSubscription('user123', 'Oxy+ Premium');
// addIndividualFeatures('user456', ['analytics', 'customThemes']);
```

### 4. Advanced Entitlement Checking

```typescript
import { EntitlementService } from '../services/entitlementService';

// Get complete user entitlement information
async function getUserEntitlementDetails(userId: string) {
  const entitlement = await EntitlementService.getUserEntitlement(userId);
  
  return {
    userId: entitlement.userId,
    plans: entitlement.activePlans,
    features: entitlement.allFeatures,
    hasAnalytics: entitlement.allFeatures.includes('analytics'),
    hasAdvancedFeatures: entitlement.allFeatures.includes('advancedAnalytics'),
    isPremiumUser: entitlement.isActive
  };
}

// Check multiple features with different requirements
async function checkFeatureMatrix(userId: string) {
  const features = {
    // Must have ALL of these
    contentCreator: await EntitlementService.hasAllFeatureAccess(userId, [
      'contentScheduling', 'promotedPosts', 'customThemes'
    ]),
    
    // Must have ANY of these
    analyticsUser: await EntitlementService.hasAnyFeatureAccess(userId, [
      'analytics', 'advancedAnalytics'
    ]),
    
    // Individual feature checks
    canUndoPosts: await EntitlementService.hasFeatureAccess(userId, 'undoPosts'),
    hasBusinessTools: await EntitlementService.hasFeatureAccess(userId, 'businessTools')
  };
  
  return features;
}
```

### 5. Plan Comparison and Upgrades

```typescript
// Get available plans with their features for upgrade comparison
async function getUpgradeOptions() {
  const response = await fetch('/api/subscription/plans');
  const { plans } = await response.json();
  
  // Group plans by tier
  const planTiers = {
    free: plans.filter(p => p.plan === 'Free'),
    basic: plans.filter(p => ['Mention+', 'basic'].includes(p.plan)),
    premium: plans.filter(p => ['Oxy+ Insider', 'Oxy+ Connect', 'Oxy+ Premium', 'pro'].includes(p.plan)),
    enterprise: plans.filter(p => ['Oxy+ Creator', 'business'].includes(p.plan))
  };
  
  return planTiers;
}

// Suggest upgrade based on desired features
function suggestPlanUpgrade(desiredFeatures: string[], availablePlans: any[]) {
  const recommendations = availablePlans
    .filter(plan => {
      // Check if plan includes all desired features
      return desiredFeatures.every(feature => plan.features.includes(feature));
    })
    .sort((a, b) => a.features.length - b.features.length); // Sort by number of features (cheapest first)
  
  return recommendations[0]; // Return the plan with fewest features that meets requirements
}
```

### 6. Legacy Compatibility Examples

```typescript
// For existing code that checks the old analytics flag
async function legacyAnalyticsCheck(userId: string) {
  // The middleware now checks both old and new systems
  const hasLegacyAccess = await checkOldAnalyticsFlag(userId); // Your existing function
  const hasNewAccess = await EntitlementService.hasFeatureAccess(userId, 'analytics');
  
  return hasLegacyAccess || hasNewAccess;
}

// Gradual migration function
async function migrateUserToNewSystem(userId: string) {
  // Get current subscription
  const response = await fetch(`/api/subscription/${userId}`);
  const { subscription, entitlement } = await response.json();
  
  // If user has old analytics flag but no new subscription, create one
  if (!entitlement.isActive && subscription.features?.analytics) {
    await updateUserSubscription(userId, 'Mention+'); // Minimal plan with analytics
  }
}
```

### 7. Error Handling Examples

```typescript
// Handle entitlement errors gracefully
async function safeFeatureCheck(userId: string, feature: string) {
  try {
    return await EntitlementService.hasFeatureAccess(userId, feature);
  } catch (error) {
    console.error('Feature check failed:', error);
    // Fallback to safe default
    return false;
  }
}

// API error handling with detailed responses
router.get('/protected-feature', checkFeatureAccess(['advancedAnalytics']), (req, res) => {
  // This middleware will return detailed error if access is denied:
  // {
  //   "message": "Feature access denied",
  //   "error": "PREMIUM_REQUIRED",
  //   "details": "Access to features [advancedAnalytics] requires a premium subscription",
  //   "requiredFeatures": ["advancedAnalytics"],
  //   "userPlans": ["Free"],
  //   "userFeatures": []
  // }
  
  res.json({ message: 'Advanced analytics data here' });
});
```

## Testing Examples

```typescript
// Mock entitlement for testing
const mockEntitlement = {
  userId: 'test-user',
  activePlans: ['Oxy+ Premium'],
  individualFeatures: [],
  planFeatures: ['analytics', 'advancedAnalytics', 'premiumBadge'],
  allFeatures: ['analytics', 'advancedAnalytics', 'premiumBadge'],
  isActive: true
};

// Test middleware behavior
describe('Premium Access Middleware', () => {
  it('should allow access with premium features', async () => {
    // Mock EntitlementService.getUserEntitlement to return mockEntitlement
    // Test that middleware calls next() for premium users
  });
  
  it('should deny access without required features', async () => {
    // Mock EntitlementService to return no features
    // Test that middleware returns 403 error
  });
});
```

This examples file shows the practical usage patterns for the new entitlement system while maintaining backward compatibility and providing clear upgrade paths for existing applications.
# OxyHQ Entitlement System

The OxyHQ entitlement system provides a flexible way to manage user subscriptions and feature access. It supports both plan-based subscriptions and individual feature purchases.

## Overview

The system has been designed to replace the previous single-flag approach (`user.privacySettings.analyticsSharing`) with a comprehensive entitlement system that can handle:

- Multiple subscription plans
- Individual feature access
- Plan-based feature bundles
- Backward compatibility with existing data

## Available Plans

### Current Plans
- **Free**: Basic access with no premium features
- **Mention+**: Basic analytics and premium badge
- **Oxy+ Insider**: Analytics, premium badge, advanced privacy, and custom themes
- **Oxy+ Connect**: All Insider features plus unlimited following and priority support
- **Oxy+ Premium**: Comprehensive feature set including advanced analytics, undo posts, and bulk actions
- **Oxy+ Creator**: Full feature access including content scheduling and team collaboration

### Legacy Plans (Backward Compatibility)
- **basic**: Equivalent to Free plan
- **pro**: Analytics, premium badge, unlimited following, higher upload limits
- **business**: All pro features plus promoted posts and business tools

## Available Features

### Core Features
- `analytics`: Basic analytics access
- `advancedAnalytics`: Advanced analytics with detailed insights
- `premiumBadge`: Premium user badge display
- `unlimitedFollowing`: Remove following limits
- `higherUploadLimits`: Increased file upload limits

### Content Features
- `promotedPosts`: Ability to promote posts
- `undoPosts`: Undo post deletion/editing
- `contentScheduling`: Schedule posts for future publishing

### Customization Features
- `customThemes`: Access to premium themes
- `advancedPrivacy`: Enhanced privacy controls
- `bulkActions`: Bulk operations on content

### Business Features
- `businessTools`: Advanced business analytics and tools
- `teamCollaboration`: Multi-user team features
- `prioritySupport`: Priority customer support

## Usage Examples

### Basic Feature Checking

```typescript
import { EntitlementService, FeatureChecks } from '../services/entitlementService';

// Check if user has analytics access
const hasAnalytics = await FeatureChecks.hasAnalyticsAccess(userId);

// Check for specific feature
const hasUndoPosts = await EntitlementService.hasFeatureAccess(userId, 'undoPosts');

// Check for multiple features (user must have ALL)
const hasAllFeatures = await EntitlementService.hasAllFeatureAccess(userId, ['analytics', 'premiumBadge']);

// Check for any of multiple features (user must have AT LEAST ONE)
const hasAnyFeature = await EntitlementService.hasAnyFeatureAccess(userId, ['analytics', 'advancedAnalytics']);
```

### Using Middleware

```typescript
import { checkPremiumAccess, checkAnalyticsAccess, checkFeatureAccess } from '../middleware/premiumAccess';

// Check for any premium access
app.get('/premium-endpoint', checkPremiumAccess(), (req, res) => {
  // User has some premium features
});

// Check for specific analytics access
app.get('/analytics', checkAnalyticsAccess, (req, res) => {
  // User has analytics access
});

// Check for multiple specific features
app.get('/advanced-features', checkFeatureAccess(['advancedAnalytics', 'bulkActions']), (req, res) => {
  // User has both advanced analytics and bulk actions
});
```

### Getting User Entitlement Data

```typescript
const entitlement = await EntitlementService.getUserEntitlement(userId);

console.log(entitlement);
// Output:
// {
//   userId: "user123",
//   activePlans: ["Oxy+ Premium"],
//   individualFeatures: ["customThemes"],
//   planFeatures: ["analytics", "advancedAnalytics", "premiumBadge", ...],
//   allFeatures: ["analytics", "advancedAnalytics", "premiumBadge", "customThemes", ...],
//   isActive: true
// }
```

## API Endpoints

### Subscription Management

```http
# Get user subscription and entitlement data
GET /api/subscription/:userId

# Update user subscription
PUT /api/subscription/:userId
{
  "plan": "Oxy+ Premium",
  "individualFeatures": ["customThemes", "prioritySupport"]
}

# Cancel subscription
DELETE /api/subscription/:userId

# Get user entitlement information
GET /api/subscription/:userId/entitlement

# Check specific feature access
GET /api/subscription/:userId/features?features=analytics,undoPosts

# Get all available plans and features
GET /api/subscription/plans
```

### Response Examples

#### Subscription Response
```json
{
  "subscription": {
    "plan": "Oxy+ Premium",
    "status": "active",
    "features": {
      "analytics": true,
      "advancedAnalytics": true,
      "premiumBadge": true,
      "undoPosts": true,
      "customThemes": true
    }
  },
  "entitlement": {
    "userId": "user123",
    "activePlans": ["Oxy+ Premium"],
    "allFeatures": ["analytics", "advancedAnalytics", "premiumBadge", "undoPosts", "customThemes"],
    "isActive": true
  }
}
```

#### Feature Access Check Response
```json
{
  "userId": "user123",
  "features": [
    { "feature": "analytics", "hasAccess": true },
    { "feature": "undoPosts", "hasAccess": true }
  ],
  "hasAllAccess": true,
  "hasAnyAccess": true
}
```

## Migration and Backward Compatibility

The system maintains backward compatibility with existing data:

1. **Legacy Plan Support**: Existing "basic", "pro", and "business" plans continue to work
2. **Analytics Flag**: The `user.privacySettings.analyticsSharing` flag is automatically updated when subscriptions change
3. **Gradual Migration**: Existing middleware (`checkPremiumAccessLegacy`) checks both old and new systems

### Migration Strategy

1. **Phase 1**: Deploy new system alongside existing one
2. **Phase 2**: Update frontend to use new entitlement endpoints
3. **Phase 3**: Migrate existing users to new plan structure
4. **Phase 4**: Remove legacy support code

## Error Handling

The system provides detailed error responses for debugging:

```json
{
  "message": "Feature access denied",
  "error": "PREMIUM_REQUIRED",
  "details": "Access to features [advancedAnalytics, bulkActions] requires a premium subscription",
  "requiredFeatures": ["advancedAnalytics", "bulkActions"],
  "userPlans": ["Free"],
  "userFeatures": []
}
```

## Best Practices

### Performance
- Entitlement data is cached per request in middleware
- Use specific feature checks rather than broad entitlement queries
- Consider caching entitlement data for frequently accessed users

### Security
- Always validate feature access on the server side
- Use middleware for route-level protection
- Log access attempts for audit purposes

### Development
- Use the feature checking utilities for common patterns
- Test with different plan combinations
- Consider edge cases like expired subscriptions

## Future Extensibility

The system is designed to easily support:
- New subscription plans
- Additional features
- Time-limited feature access
- Usage-based billing
- Team/organization subscriptions
- Feature trials and promotions

To add a new plan:
1. Add the plan name to the `SubscriptionPlan` type
2. Update the `PLAN_FEATURES` mapping in `entitlementService.ts`
3. Update the Subscription model enum

To add a new feature:
1. Add the feature to the `FeatureType` type
2. Update the Subscription model interface and schema
3. Add the feature to relevant plan mappings
4. Create specific utility functions if needed
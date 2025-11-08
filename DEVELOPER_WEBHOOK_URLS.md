# Dual Webhook URL System

## Overview

Developer apps now support separate production and development webhook URLs, allowing developers to maintain stable production endpoints while easily testing with local development servers.

## Features

### Production Webhook URL (Required)
- **Field**: `webhookUrl`
- **Required**: Yes
- **Purpose**: Stable production endpoint for webhook notifications
- **Validation**: Must be a valid URL
- **Secret Generation**: New webhook secret generated when URL changes

### Development Webhook URL (Optional)
- **Field**: `devWebhookUrl`
- **Required**: No
- **Purpose**: Temporary endpoint for local testing
- **Validation**: Must be a valid URL if provided
- **Use Case**: Points to local development server during testing

## API Changes

### Create Developer App
```typescript
POST /api/developer/apps
{
  "name": "My App",
  "description": "App description",
  "webhookUrl": "https://api.myapp.com/webhooks",  // Required
  "devWebhookUrl": "http://localhost:4000",        // Optional
  "scopes": ["files:read", "webhooks:receive"]
}
```

### Update Developer App
```typescript
PATCH /api/developer/apps/:id
{
  "webhookUrl": "https://api.myapp.com/webhooks/v2",  // Updates production URL & regenerates secret
  "devWebhookUrl": "http://localhost:3000"             // Updates or removes dev URL
}
```

### Response Format
All developer app responses now include both URLs:
```json
{
  "success": true,
  "app": {
    "id": "...",
    "name": "My App",
    "apiKey": "dk_...",
    "webhookUrl": "https://api.myapp.com/webhooks",
    "devWebhookUrl": "http://localhost:4000",
    "status": "active",
    "scopes": [...],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

## Developer Portal UI

### Create App Screen
Two separate input fields:
1. **Production Webhook URL** (required)
   - Marked with asterisk (*)
   - Helper text: "Your production webhook endpoint"

2. **Development Webhook URL** (optional)
   - Quick-fill buttons for common localhost ports (:3000, :4000, :5000)
   - Helper text: "Optional local endpoint for testing"
   - Dev note: "💡 Run node webhook-dev-server.js to test locally"

### App Details Screen
- Edit Mode: Separate inputs for both URLs with quick-fill buttons
- Display Mode: 
  - Always shows production webhook URL
  - Shows development URL only if set
  - Helper text explains purpose of each URL

## Testing Workflow

### 1. Create Developer App
```bash
# Create app with both URLs
curl -X POST http://localhost:5000/api/developer/apps \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test App",
    "webhookUrl": "https://api.myapp.com/webhooks",
    "devWebhookUrl": "http://localhost:4000"
  }'
```

### 2. Start Webhook Dev Server
```bash
cd packages/DeveloperPortal
node webhook-dev-server.js 4000
```

### 3. Trigger Webhook Event
```bash
# Change file visibility or delete file
# Webhook notification will be sent to devWebhookUrl if set, otherwise webhookUrl
```

### 4. Switch to Production
```bash
# Update app to remove dev URL
curl -X PATCH http://localhost:5000/api/developer/apps/APP_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "devWebhookUrl": null
  }'
```

## Backend Implementation

### Model Schema
```typescript
// packages/api/src/models/DeveloperApp.ts
interface IDeveloperApp {
  webhookUrl: string;        // Required - production endpoint
  devWebhookUrl?: string;    // Optional - development endpoint
  webhookSecret?: string;    // Secret for webhook signature verification
}
```

### Validation
```typescript
// packages/api/src/routes/developer.ts
const createAppSchema = z.object({
  webhookUrl: z.string().url('Invalid production webhook URL'),
  devWebhookUrl: z.string().url('Invalid development webhook URL').optional().nullable()
});
```

### Update Logic
- `webhookUrl` cannot be removed (required field)
- Changing `webhookUrl` regenerates webhook secret
- `devWebhookUrl` can be added, updated, or removed freely

## Services Package

### Updated Methods
```typescript
// packages/services/src/core/OxyServices.ts

// Create app - webhookUrl now required
createDeveloperApp(data: {
  name: string;
  description?: string;
  webhookUrl: string;         // Required
  devWebhookUrl?: string;     // Optional
  scopes?: string[];
}): Promise<any>

// Update app - both URLs optional in updates
updateDeveloperApp(appId: string, data: {
  name?: string;
  description?: string;
  webhookUrl?: string;        // Can update production URL
  devWebhookUrl?: string;     // Can update/remove dev URL
  scopes?: string[];
}): Promise<any>
```

## Benefits

1. **Stability**: Production webhook URL is always configured and reliable
2. **Flexibility**: Easy to switch between local dev servers without affecting production
3. **Testing**: Quick-fill buttons make it easy to test on different localhost ports
4. **Safety**: Can test webhook integrations locally without affecting production endpoint
5. **Developer Experience**: Clear separation between production and development environments

## Migration Notes

Existing apps with `webhookUrl` will work as-is. The `devWebhookUrl` field is purely additive and optional.

To migrate existing apps:
1. Existing `webhookUrl` values remain unchanged
2. `devWebhookUrl` will be `undefined` until explicitly set
3. No breaking changes to existing webhook functionality

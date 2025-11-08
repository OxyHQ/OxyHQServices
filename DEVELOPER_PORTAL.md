# Developer Portal Implementation

## Overview

Complete implementation of a Developer Portal system that allows developers to create apps, manage API credentials, and configure webhooks for file event notifications.

## What Was Built

### 1. Backend Infrastructure

#### DeveloperApp Model (`packages/api/src/models/DeveloperApp.ts`)
- Schema for storing developer applications
- Fields:
  - `name`, `description` - App information
  - `developerUserId` - Owner reference
  - `apiKey` - Public identifier (prefix: `dk_`)
  - `apiSecret` - Hashed authentication secret
  - `webhookUrl` - Endpoint for file event notifications
  - `webhookSecret` - Secret for verifying webhook signatures
  - `status` - active/deleted
  - `scopes` - Permission array
  - `lastUsedAt` - Usage tracking
- Enforces 10 app limit per developer
- Unique apiKey index

#### Developer API Routes (`packages/api/src/routes/developer.ts`)
Complete REST API with authentication middleware:

**GET /api/developer/apps**
- List all apps for authenticated user
- Hides sensitive secrets in response

**POST /api/developer/apps**
- Create new developer app
- Generates unique API key and secret
- Returns `apiSecret` ONCE (never stored in plaintext)
- Enforces 10 app limit
- Auto-generates `webhookSecret` if `webhookUrl` provided

**GET /api/developer/apps/:id**
- Get single app details
- Shows `webhookSecret` (needed for signature verification)

**PATCH /api/developer/apps/:id**
- Update app name, description, webhookUrl, or scopes
- Regenerates `webhookSecret` if `webhookUrl` changes

**POST /api/developer/apps/:id/regenerate-secret**
- Generate new API secret
- Returns new secret ONCE
- Invalidates old secret

**DELETE /api/developer/apps/:id**
- Soft delete (sets status to 'deleted')

#### Server Integration (`packages/api/src/server.ts`)
- Imported developer routes
- Registered at `/api/developer` endpoint
- Protected by authentication middleware

### 2. OxyServices Client Methods

Added to `packages/services/src/core/OxyServices.ts`:

```typescript
async getDeveloperApps(): Promise<any[]>
async createDeveloperApp(data): Promise<any>
async getDeveloperApp(appId: string): Promise<any>
async updateDeveloperApp(appId: string, data): Promise<any>
async regenerateDeveloperAppSecret(appId: string): Promise<any>
async deleteDeveloperApp(appId: string): Promise<any>
```

### 3. Developer Portal Frontend

#### App List Screen (`packages/DeveloperPortal/app/(tabs)/index.tsx`)
- Displays all developer apps
- Shows API key with copy-to-clipboard
- Quick actions: View Details, Delete
- Empty state with CTA to create first app
- Status badges for each app

#### Create App Screen (`packages/DeveloperPortal/app/create-app.tsx`)
- Form for app creation:
  - Name (required)
  - Description (optional)
  - Webhook URL (optional)
- Shows API secret ONCE after creation
- Warning message to save secret
- Validation and error handling

#### App Details Screen (`packages/DeveloperPortal/app/app/[id].tsx`)
- View complete app information
- Edit mode for updating:
  - Name
  - Description
  - Webhook URL
- Display credentials:
  - API Key (copy to clipboard)
  - Webhook Secret (copy to clipboard)
- Actions:
  - Edit App
  - Regenerate API Secret (with confirmation)
- Creation timestamp

## Security Features

1. **One-Time Secret Display**
   - API secrets only shown during creation/regeneration
   - Stored as bcrypt hash in database
   - Cannot be retrieved after initial display

2. **Webhook Secret Auto-Regeneration**
   - New `webhookSecret` generated when `webhookUrl` changes
   - Prevents old webhooks from being verified with new URLs

3. **Soft Delete**
   - Apps marked as deleted, not removed from database
   - Maintains audit trail

4. **Scopes System**
   - Ready for future permission management
   - Array-based for flexibility

5. **Rate Limiting**
   - 10 app limit per developer
   - Prevents abuse

## Integration with File System

The webhook system integrates with existing file management:

**When a file is deleted** (`assetService.deleteFile()`):
```javascript
await notifyLinks(file, 'deleted');
```

**When file visibility changes** (`assetService.updateFileVisibility()`):
```javascript
await notifyLinks(file, 'visibility_changed', newVisibility);
```

**Webhook Payload Format**:
```json
{
  "event": "deleted" | "visibility_changed",
  "fileId": "abc123",
  "visibility": "public" | "private" | "unlisted",
  "status": "deleted",
  "link": {
    "app": "your-app-name",
    "entityType": "post",
    "entityId": "entity-id",
    "webhookUrl": "https://yourapp.com/webhook"
  },
  "details": "Additional context",
  "timestamp": "2025-11-08T12:00:00Z"
}
```

## Usage Example

### 1. Create Developer App
```typescript
const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
await oxy.setTokens('USER_ACCESS_TOKEN');

const app = await oxy.createDeveloperApp({
  name: 'My Photo App',
  description: 'A photo sharing application',
  webhookUrl: 'https://myphotoapp.com/webhooks/oxy'
});

// SAVE THIS! Only shown once
console.log('API Secret:', app.apiSecret);
console.log('API Key:', app.apiKey);
```

### 2. Use in Third-Party App
```typescript
// Initialize with developer credentials
const oxy = new OxyServices({ 
  baseURL: 'https://api.oxy.so',
  apiKey: 'dk_...your_api_key',
  apiSecret: 'your_api_secret'
});

// Link a file with webhook notification
await oxy.assetLink(
  fileId,
  'my-photo-app',
  'post',
  'post-123',
  'public',
  'https://myphotoapp.com/webhooks/oxy' // Webhook URL
);
```

### 3. Handle Webhook in Your App
```javascript
app.post('/webhooks/oxy', (req, res) => {
  const { event, fileId, visibility, link } = req.body;
  
  // Verify signature with webhookSecret
  const signature = req.headers['x-webhook-signature'];
  if (!verifySignature(signature, req.body, WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  
  if (event === 'deleted') {
    // Remove reference to deleted file
    await removeFileFromPost(link.entityId, fileId);
  } else if (event === 'visibility_changed') {
    // Update cached visibility
    await updateFileVisibility(link.entityId, fileId, visibility);
  }
  
  res.status(200).send('OK');
});
```

## Files Changed/Created

### Backend
- ✅ `packages/api/src/models/DeveloperApp.ts` - NEW
- ✅ `packages/api/src/routes/developer.ts` - NEW
- ✅ `packages/api/src/server.ts` - MODIFIED (added developer routes)

### Services
- ✅ `packages/services/src/core/OxyServices.ts` - MODIFIED (added developer methods)

### Frontend
- ✅ `packages/DeveloperPortal/app/(tabs)/index.tsx` - MODIFIED (app list screen)
- ✅ `packages/DeveloperPortal/app/create-app.tsx` - NEW
- ✅ `packages/DeveloperPortal/app/app/[id].tsx` - NEW
- ✅ `packages/DeveloperPortal/package.json` - MODIFIED (added @oxyhq/services)
- ✅ `packages/DeveloperPortal/README.md` - MODIFIED (documentation)

### Documentation
- ✅ `DEVELOPER_PORTAL.md` - NEW (this file)

## Testing Checklist

- [ ] API builds without errors ✅
- [ ] Services package builds without errors ✅
- [ ] Developer Portal compiles without TypeScript errors ✅
- [ ] Create developer app endpoint
- [ ] API secret shown once
- [ ] Webhook secret generated automatically
- [ ] Update app endpoint
- [ ] Webhook secret regenerates on URL change
- [ ] Regenerate API secret endpoint
- [ ] Delete app endpoint
- [ ] List apps endpoint
- [ ] 10 app limit enforced
- [ ] Webhook notifications sent on file delete
- [ ] Webhook notifications sent on visibility change

## Next Steps

1. **Version and Publish**
   - Update `@oxyhq/services` version
   - Publish to npm
   - Update DeveloperPortal dependency

2. **Production Deployment**
   - Deploy API with new routes
   - Deploy Developer Portal
   - Configure environment variables

3. **Future Enhancements**
   - Scope-based permissions
   - Usage analytics dashboard
   - Rate limiting per app
   - Webhook retry logic
   - Webhook signature verification helper
   - OAuth flow for third-party apps

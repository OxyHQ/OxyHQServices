# File Visibility and Public Access System

## Overview

Implemented a comprehensive file visibility system that allows certain files (like avatars and profile content) to be publicly accessible without authentication, while maintaining privacy controls for sensitive content.

## File Visibility Levels

### `private` (Default)
- **Access:** Only the file owner
- **Use Cases:** Personal documents, private photos, sensitive content
- **Authentication:** Required
- **Example:** User's private gallery photos

### `public`
- **Access:** Anyone, even without authentication
- **Use Cases:** Avatars, profile banners, public profile content
- **Authentication:** Optional (but still tracked if provided)
- **Example:** User profile avatar, public post images

### `unlisted`
- **Access:** Anyone with direct link
- **Use Cases:** Shareable content that shouldn't be listed publicly
- **Authentication:** Optional
- **Example:** Shared documents, preview links

## Database Schema Changes

### File Model (`/models/File.ts`)

```typescript
export type FileVisibility = 'private' | 'public' | 'unlisted';

export interface IFile extends Document {
  // ... existing fields
  visibility: FileVisibility;  // NEW FIELD
  // ...
}
```

**Indexes Added:**
```typescript
FileSchema.index({ ownerUserId: 1, visibility: 1, status: 1 });
FileSchema.index({ visibility: 1, status: 1 }); // For public file queries
```

## API Changes

### Asset Service (`/services/assetService.ts`)

#### New Methods

**`inferVisibilityFromEntityType(app, entityType)`**
- Automatically determines visibility based on entity type
- Public entity types: `avatar`, `profile-avatar`, `user-avatar`, `profile-banner`, `profile-cover`
- Returns: `'public'` or `'private'`

**`updateFileVisibility(fileId, visibility)`**
- Updates file visibility setting
- Returns: Updated file object

**`canUserAccessFile(file, userId?)`**
- Checks if a user can access a file
- Logic:
  - `public` files: Always accessible
  - `unlisted` files: Accessible with direct link
  - `private` files: Only accessible by owner
- Returns: `boolean`

#### Updated Methods

**`completeUpload(request)`**
- Now accepts optional `visibility` parameter
- Auto-sets visibility if not provided

**`linkFile(fileId, linkRequest)`**
- Now accepts optional `visibility` parameter
- Auto-detects visibility based on entity type

### Middleware

#### Optional Authentication (`/middleware/optionalAuth.ts`)

```typescript
export function optionalAuthMiddleware(req, res, next)
```

**Purpose:** Allows routes to serve both authenticated and anonymous users

**Behavior:**
- If valid token present: Sets `req.user`
- If no token or invalid token: Continues without blocking
- Never returns 401 error

**Use Cases:**
- Public file streaming
- Content that adapts to authentication state

### Routes Changes

#### Updated Routes (`/routes/assets.ts`)

**1. Stream Endpoint - Now Public with Optional Auth**
```
GET /api/assets/:id/stream?variant=thumbnail
```
- **Before:** Required authentication
- **After:** Optional authentication
- **Access Control:** Checks `file.visibility` and user ownership
- **Response:** 
  - 200: File stream
  - 403: Access denied (private file, no auth)
  - 404: File not found

**2. Download Endpoint - Now Public with Optional Auth**
```
GET /api/assets/:id/download?variant=large
```
- **Before:** Required authentication
- **After:** Optional authentication
- **Access Control:** Checks `file.visibility` and user ownership
- **Response:** Redirects to signed URL or returns 403/404

**3. NEW: Update Visibility Endpoint**
```
PATCH /api/assets/:id/visibility
Content-Type: application/json

{
  "visibility": "public" | "private" | "unlisted"
}
```
- **Access:** Private (owner only)
- **Validation:** Checks ownership before updating
- **Response:**
```json
{
  "success": true,
  "file": {
    "id": "file_id",
    "visibility": "public",
    "updatedAt": "2025-11-08T..."
  }
}
```

#### Schema Updates

```typescript
// Complete upload now accepts visibility
const completeUploadSchema = z.object({
  // ... existing fields
  visibility: z.enum(['private', 'public', 'unlisted']).optional()
});

// Link file now accepts visibility
const linkFileSchema = z.object({
  // ... existing fields
  visibility: z.enum(['private', 'public', 'unlisted']).optional()
});
```

## Usage Examples

### 1. Upload Public Avatar

```typescript
// Step 1: Initialize upload
POST /api/assets/init
{
  "sha256": "abc123...",
  "size": 102400,
  "mime": "image/jpeg"
}

// Step 2: Upload file to presigned URL
PUT <uploadUrl>
Content-Type: image/jpeg
<binary data>

// Step 3: Complete upload with public visibility
POST /api/assets/complete
{
  "fileId": "file_id",
  "originalName": "avatar.jpg",
  "size": 102400,
  "mime": "image/jpeg",
  "visibility": "public"
}

// Step 4: Link to user profile (auto-detected as public)
POST /api/assets/:id/links
{
  "app": "profiles",
  "entityType": "avatar",
  "entityId": "user_123"
}
```

### 2. Access Public File Without Authentication

```typescript
// No Authorization header needed for public files
GET /api/assets/:id/stream

// Response: Image stream (200 OK)
```

### 3. Access Private File (Requires Auth)

```typescript
// Without auth
GET /api/assets/:id/stream
// Response: 403 Forbidden

// With auth
GET /api/assets/:id/stream
Authorization: Bearer <token>
// Response: Image stream (200 OK)
```

### 4. Update File Visibility

```typescript
// Make private file public
PATCH /api/assets/:id/visibility
Authorization: Bearer <token>
{
  "visibility": "public"
}

// Now accessible without auth
GET /api/assets/:id/stream
// Response: Image stream (200 OK)
```

### 5. Create Unlisted Shareable Link

```typescript
// Upload file with unlisted visibility
POST /api/assets/complete
{
  "fileId": "file_id",
  "originalName": "shared-doc.pdf",
  "visibility": "unlisted",
  // ...
}

// Share URL - accessible without auth but not discoverable
const shareableUrl = `https://api.oxy.so/api/assets/${fileId}/download`;
```

## Auto-Detection Logic

The system automatically sets visibility based on entity types:

```typescript
const publicEntityTypes = [
  'avatar',
  'profile-avatar',
  'user-avatar',
  'profile-banner',
  'profile-cover',
  'public-profile-content'
];
```

**Example:**
```typescript
// Linking file as avatar automatically makes it public
POST /api/assets/:id/links
{
  "app": "profiles",
  "entityType": "avatar",  // Auto-detected as public
  "entityId": "user_123"
}
// File visibility set to 'public' automatically
```

## Access Control Flow

```
┌─────────────────────────────┐
│  Request to File Endpoint   │
└──────────────┬──────────────┘
               │
               v
┌─────────────────────────────┐
│  Optional Auth Middleware   │
│  (Sets req.user if present) │
└──────────────┬──────────────┘
               │
               v
┌─────────────────────────────┐
│     Get File from DB        │
└──────────────┬──────────────┘
               │
               v
┌─────────────────────────────┐
│  Check File Visibility      │
└──────────────┬──────────────┘
               │
       ┌───────┴────────┐
       │                │
   Public/          Private
   Unlisted?
       │                │
       v                v
   ✓ Allow      Check Ownership
                       │
                ┌──────┴──────┐
                │             │
            Owner?       Not Owner?
                │             │
                v             v
            ✓ Allow      ✗ Deny 403
```

## Security Considerations

### 1. **Private by Default**
- All files default to `private` visibility
- Explicit opt-in required for public access

### 2. **Owner Verification**
- Only file owners can update visibility
- Ownership checked before any visibility changes

### 3. **Access Logging**
- All access attempts logged with user ID (if authenticated)
- Failed access attempts logged with reason

### 4. **CORS Headers**
- Public files include proper CORS headers
- Prevents ORB blocking in browsers

### 5. **No Data Leakage**
- 403 errors don't reveal file existence
- Consistent error messages for missing/forbidden files

## Migration Guide

### For Existing Files

All existing files will have `visibility: 'private'` by default. To make them public:

```typescript
// Update single file
PATCH /api/assets/:id/visibility
{
  "visibility": "public"
}

// Or programmatically
await assetService.updateFileVisibility(fileId, 'public');
```

### For New Integrations

When creating profile-related content:

```typescript
// Explicit visibility
POST /api/assets/complete
{
  "visibility": "public",
  // ...
}

// Or rely on auto-detection
POST /api/assets/:id/links
{
  "entityType": "avatar",  // Auto-detects as public
  // ...
}
```

## Performance Considerations

### Database Indexes
- `{ visibility: 1, status: 1 }` for public file queries
- `{ ownerUserId: 1, visibility: 1, status: 1 }` for user file listings

### Caching Strategy
- Public files: `max-age=31536000, immutable` (1 year)
- Private files: `private, max-age=3600` (1 hour)
- Unlisted files: `private, max-age=3600` (1 hour)

### Query Optimization
```typescript
// Efficient public file query
File.find({ 
  visibility: 'public', 
  status: 'active' 
}).hint({ visibility: 1, status: 1 });
```

## Testing Checklist

- [ ] Public file accessible without auth
- [ ] Private file blocked without auth
- [ ] Private file accessible with owner auth
- [ ] Unlisted file accessible with direct link
- [ ] Visibility update requires ownership
- [ ] Avatar auto-detected as public
- [ ] CORS headers present on public files
- [ ] Access logging works for all scenarios
- [ ] Migration of existing files to default private

## Future Enhancements

1. **Time-Limited Public Access**
   - Add `publicUntil` field for temporary public access
   - Use case: Limited-time event photos

2. **Group/Team Access**
   - Add `sharedWith` array for specific user/group access
   - Use case: Collaborative workspaces

3. **Access Analytics**
   - Track view counts for public files
   - Popular content insights

4. **Bulk Visibility Updates**
   - Endpoint to update multiple files at once
   - Use case: Making entire album public

## Summary

This implementation provides a flexible, secure file visibility system that:

✅ **Supports Public Content** - Avatars and profiles accessible without auth  
✅ **Maintains Privacy** - Private by default, explicit opt-in  
✅ **Auto-Detection** - Smart defaults based on entity type  
✅ **Secure** - Owner verification, access logging  
✅ **Performant** - Proper indexing, caching strategies  
✅ **Developer-Friendly** - Clear API, good documentation  

The system balances accessibility for public content with security for private files, providing the foundation for a modern content delivery system.

# Migration to Asset Service - Complete

## Overview
Successfully migrated from the legacy GridFS file system to the new Asset Service. All old code has been removed.

## What Was Removed

### Backend (packages/api)
1. **`src/routes/files.ts`** (1052 lines) - DELETED
   - Legacy GridFS-based file routes
   - All `/api/files/*` endpoints removed
   
2. **`src/utils/fileUtils.ts`** - DELETED
   - Utilities only used by old file system
   
3. **`src/server.ts`** - CLEANED
   - Removed `import fileRoutes from "./routes/files"`
   - Removed `app.use("/api/files", fileRoutes)`

### Frontend (packages/services)
1. **`src/core/OxyServices.ts`** - CLEANED
   - Removed `uploadFile()` method (replaced by `assetUpload()`)
   - Removed `getFile()` method (replaced by `assetGet()`)

## Current File System - Asset Service Only

### Backend Routes (`/api/assets`)
All file operations now go through Asset Service:

- **POST** `/api/assets/init` - Initialize upload with SHA256
- **POST** `/api/assets/:assetId/upload-direct` - Direct upload fallback
- **POST** `/api/assets/:assetId/complete` - Complete upload
- **POST** `/api/assets/:assetId/link` - Link asset to entity
- **GET** `/api/assets` - List user assets
- **GET** `/api/assets/:assetId` - Get asset metadata
- **GET** `/api/assets/:assetId/stream` - Stream asset with variants
- **GET** `/api/assets/:assetId/download` - Download asset
- **PATCH** `/api/assets/:assetId/visibility` - Update visibility
- **DELETE** `/api/assets/:assetId` - Delete asset

### Frontend Methods (OxyServices)
Use these methods for all file operations:

```typescript
// Upload file
const result = await oxy.assetUpload(file, visibility, metadata, onProgress);

// Get file metadata
const metadata = await oxy.assetGet(assetId);

// Get signed download URL
const { url } = await oxy.assetLink(assetId, app, entityType, entityId);

// Get streaming URL for <img> tags
const url = oxy.getFileDownloadUrl(assetId, variant);

// Update visibility
await oxy.assetUpdateVisibility(assetId, 'public');

// Delete file
await oxy.deleteFile(assetId); // Uses /api/assets endpoint

// List files
const { files, total, hasMore } = await oxy.listUserFiles(limit, offset);
```

## Asset Service Benefits

✅ **Content-addressed storage** - SHA256 deduplication
✅ **Visibility control** - private/public/unlisted
✅ **Better S3/Spaces integration** - Presigned URLs
✅ **CDN-friendly** - Optimized for caching
✅ **Variant support** - Automatic image resizing
✅ **Security** - Optional auth middleware for public files
✅ **CORS compliant** - Proper headers for media files

## Visibility Levels

- **`private`** - Only owner can access (default)
- **`public`** - Anyone can access (avatars, banners)
- **`unlisted`** - Accessible with link, not listed

## Auto-Public Files

These file types automatically become public:
- Avatars (`entityType: 'avatar'`)
- Profile banners (`entityType: 'profile-banner'`)

## Migration Notes

- All existing code should use Asset Service methods
- No backward compatibility layer needed
- Frontend `uploadRawFile()` already uses `assetUpload()`
- All screens updated to use new Asset Service

## Build Status

✅ Backend build: PASSED
✅ Frontend build: PASSED
✅ No broken imports or references

## Next Steps

If you need to migrate existing files in the database:
1. Create a migration script to convert old file records
2. Update file references in entities (users, posts, etc.)
3. Consider keeping old S3 files for a transition period

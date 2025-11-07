# Frontend Visibility System Support

**Date:** November 8, 2024  
**Package:** @oxyhq/services  
**Status:** ✅ Implemented

## Overview

Updated the frontend services package to support the new file visibility system implemented in the backend API. This enables frontend applications to control file visibility when uploading or linking assets.

## Changes Made

### 1. Type Definitions (`src/models/interfaces.ts`)

#### New Type Export

```typescript
/**
 * File visibility levels
 * - private: Only accessible by owner (default)
 * - public: Accessible by anyone without authentication (e.g., avatars, public profile content)
 * - unlisted: Accessible with direct link but not listed publicly
 */
export type FileVisibility = 'private' | 'public' | 'unlisted';
```

#### Updated Interfaces

**Asset Interface** - Added visibility field:
```typescript
export interface Asset {
  // ... existing fields
  visibility: FileVisibility;
  // ... other fields
}
```

**AssetCompleteRequest Interface** - Added optional visibility:
```typescript
export interface AssetCompleteRequest {
  fileId: string;
  originalName: string;
  size: number;
  mime: string;
  visibility?: FileVisibility;  // NEW
  metadata?: AssetMetadata;
}
```

**AssetLinkRequest Interface** - Added optional visibility:
```typescript
export interface AssetLinkRequest {
  app: string;
  entityType: string;
  entityId: string;
  visibility?: FileVisibility;  // NEW
}
```

**New Interfaces** for visibility updates:
```typescript
export interface AssetUpdateVisibilityRequest {
  visibility: FileVisibility;
}

export interface AssetUpdateVisibilityResponse {
  success: boolean;
  file: {
    id: string;
    visibility: FileVisibility;
    updatedAt: string;
  };
}
```

### 2. Service Methods (`src/core/OxyServices.ts`)

#### Updated Methods

**assetComplete()** - Now accepts visibility parameter:
```typescript
async assetComplete(
  fileId: string,
  originalName: string,
  size: number,
  mime: string,
  visibility?: 'private' | 'public' | 'unlisted',  // NEW parameter
  metadata?: Record<string, any>
): Promise<any>
```

**assetLink()** - Now accepts visibility parameter:
```typescript
async assetLink(
  fileId: string,
  app: string,
  entityType: string,
  entityId: string,
  visibility?: 'private' | 'public' | 'unlisted'  // NEW parameter
): Promise<any>
```

**assetUpload()** - Now accepts visibility parameter:
```typescript
async assetUpload(
  file: File,
  visibility?: 'private' | 'public' | 'unlisted',  // NEW parameter
  metadata?: Record<string, any>,
  onProgress?: (progress: number) => void
): Promise<any>
```

**uploadRawFile()** - Now accepts visibility parameter:
```typescript
async uploadRawFile(
  file: File | Blob,
  visibility?: 'private' | 'public' | 'unlisted',  // NEW parameter
  metadata?: Record<string, any>
): Promise<any>
```

#### New Method

**assetUpdateVisibility()** - Update visibility of existing file:
```typescript
/**
 * Update asset visibility
 * @param fileId - The file ID
 * @param visibility - New visibility level ('private', 'public', or 'unlisted')
 * @returns Updated asset information
 */
async assetUpdateVisibility(
  fileId: string,
  visibility: 'private' | 'public' | 'unlisted'
): Promise<any>
```

### 3. Exports (`src/index.ts`)

Added new type exports:
```typescript
export type {
  FileVisibility,              // NEW
  AssetLink,
  AssetVariant,
  Asset,
  AssetInitRequest,
  AssetInitResponse,
  AssetCompleteRequest,
  AssetLinkRequest,
  AssetUnlinkRequest,
  AssetUrlResponse,
  AssetDeleteSummary,
  AssetUploadProgress,
  AssetUpdateVisibilityRequest,   // NEW
  AssetUpdateVisibilityResponse   // NEW
}
```

## Usage Examples

### 1. Upload Public Avatar

```typescript
import { OxyServices, FileVisibility } from '@oxyhq/services';

const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Upload avatar as public file
const file = avatarInput.files[0];
const asset = await oxyServices.assetUpload(file, 'public');

// Link to user profile
await oxyServices.assetLink(
  asset.fileId,
  'profiles',
  'avatar',
  userId,
  'public'  // Ensures visibility is public
);
```

### 2. Upload Private Document

```typescript
// Upload document (defaults to private)
const asset = await oxyServices.assetUpload(documentFile);

// Or explicitly set as private
const asset = await oxyServices.assetUpload(documentFile, 'private');
```

### 3. Update Visibility of Existing File

```typescript
// Change profile banner from private to public
const result = await oxyServices.assetUpdateVisibility(
  bannerId,
  'public'
);

console.log('Updated visibility:', result.file.visibility);
```

### 4. Upload Unlisted Content

```typescript
// Upload content that's accessible via direct link but not listed
const asset = await oxyServices.assetUpload(
  sharedFile,
  'unlisted'
);

// Anyone with the link can access, but won't appear in public listings
const url = await oxyServices.assetGetUrl(asset.fileId);
```

## Backward Compatibility

✅ **Fully backward compatible** - All visibility parameters are optional. Existing code continues to work:

```typescript
// Still works - defaults to 'private'
await oxyServices.assetUpload(file);
await oxyServices.assetComplete(fileId, name, size, mime);
await oxyServices.assetLink(fileId, app, type, id);
```

## Visibility Behavior

### Default Behavior
- If `visibility` is not specified, defaults to `'private'`
- Backend can auto-detect visibility for certain entity types:
  - `avatar` → `'public'`
  - `profile-banner` → `'public'`
  - Other types → `'private'`

### Visibility Levels

| Level | Auth Required | Listed Publicly | Use Cases |
|-------|---------------|-----------------|-----------|
| `private` | ✅ Yes | ❌ No | User documents, private media |
| `public` | ❌ No | ✅ Yes | Avatars, profile banners, public content |
| `unlisted` | ❌ No | ❌ No | Shared links, embeds, previews |

## Integration with React

### Using with Asset Store

```typescript
import { useAssetStore, FileVisibility } from '@oxyhq/services';

const MyComponent = () => {
  const { uploadAsset, updateVisibility } = useAssetStore();

  const handleAvatarUpload = async (file: File) => {
    // Upload with public visibility
    const asset = await uploadAsset(file, 'public');
    
    // Or update later
    await updateVisibility(asset.fileId, 'public');
  };

  return <input type="file" onChange={e => handleAvatarUpload(e.target.files[0])} />;
};
```

## API Endpoints Used

| Method | Endpoint | Visibility Parameter |
|--------|----------|---------------------|
| `assetComplete()` | `POST /api/assets/complete` | Body: `visibility` |
| `assetLink()` | `POST /api/assets/:id/links` | Body: `visibility` |
| `assetUpdateVisibility()` | `PATCH /api/assets/:id/visibility` | Body: `visibility` |

## Testing

All TypeScript compilation passes without errors:
- ✅ No type errors
- ✅ Backward compatible
- ✅ Proper JSDoc documentation

## Related Documentation

- Backend visibility system: `FILE_VISIBILITY_SYSTEM.md`
- CORS/ORB fixes: `MEDIA_CORS_FIX.md`
- Code optimization: `CODE_OPTIMIZATION.md`

## Migration Guide

### For Existing Code Using Asset Uploads

**Before:**
```typescript
const asset = await oxyServices.assetUpload(file, metadata);
```

**After (Optional):**
```typescript
// Set visibility explicitly
const asset = await oxyServices.assetUpload(file, 'public', metadata);
```

### For Profile/Avatar Uploads

**Recommended Update:**
```typescript
// Old way - required authentication
const avatar = await oxyServices.assetUpload(file);

// New way - public access for avatars
const avatar = await oxyServices.assetUpload(file, 'public');
await oxyServices.assetLink(avatar.fileId, 'profiles', 'avatar', userId, 'public');
```

## Benefits

1. **Public Content Support** - Avatars and profile content no longer require authentication
2. **Flexible Sharing** - Unlisted content for sharing without public listing
3. **Type Safety** - Full TypeScript support with proper types
4. **Backward Compatible** - No breaking changes to existing code
5. **Granular Control** - Per-file visibility settings
6. **Auto-Detection** - Backend intelligently sets visibility for common entity types

## Next Steps

Frontend developers can now:
1. Update avatar/profile upload flows to use `'public'` visibility
2. Implement visibility controls in file management UIs
3. Use `assetUpdateVisibility()` for user-controlled privacy settings
4. Remove authentication requirements from public content displays

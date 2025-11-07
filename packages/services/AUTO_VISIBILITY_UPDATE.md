# Auto-Visibility for Avatar Changes

**Date:** November 8, 2024  
**Status:** ✅ Implemented

## Overview

Enhanced the frontend services to **automatically** set visibility to `'public'` when uploading or linking avatars and profile banners. No manual visibility specification needed!

## Changes Made

### 1. Smart Link Function (`src/ui/hooks/useAssets.ts`)

The `link()` function now auto-detects entity type and sets appropriate visibility:

```typescript
const link = async (assetId, app, entityType, entityId) => {
  // Auto-detect visibility for avatars and profile banners
  const visibility = (entityType === 'avatar' || entityType === 'profile-banner') 
    ? 'public' 
    : undefined;
  
  await oxyInstance.assetLink(assetId, app, entityType, entityId, visibility);
}
```

**Automatic Behavior:**
- `entityType: 'avatar'` → visibility: `'public'` ✅
- `entityType: 'profile-banner'` → visibility: `'public'` ✅
- Other entity types → visibility: backend default (private)

### 2. Helper Methods (`src/core/OxyServices.ts`)

Added convenient helper methods for common avatar/banner operations:

#### `uploadAvatar()`
```typescript
/**
 * Upload and link avatar with automatic public visibility
 * @param file - The avatar file
 * @param userId - User ID to link to
 * @param app - App name (defaults to 'profiles')
 */
async uploadAvatar(file: File, userId: string, app?: string): Promise<Asset>
```

#### `uploadProfileBanner()`
```typescript
/**
 * Upload and link profile banner with automatic public visibility
 * @param file - The banner file
 * @param userId - User ID to link to
 * @param app - App name (defaults to 'profiles')
 */
async uploadProfileBanner(file: File, userId: string, app?: string): Promise<Asset>
```

## Usage Examples

### Example 1: Using the Helper Method (Recommended)

```typescript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// One-liner avatar upload with automatic public visibility
const asset = await oxy.uploadAvatar(avatarFile, userId);

// One-liner banner upload
const banner = await oxy.uploadProfileBanner(bannerFile, userId);
```

### Example 2: Using Hooks (Auto-Detection)

```typescript
import { useAssets } from '@oxyhq/services';

function ProfileEditor() {
  const { upload, link } = useAssets();
  
  const updateAvatar = async (file: File, userId: string) => {
    // Step 1: Upload file
    const asset = await upload(file);
    
    // Step 2: Link to user - automatically sets visibility to 'public'
    await link(asset.id, 'profiles', 'avatar', userId);
    // ↑ No need to specify visibility - it's automatic!
  };
  
  return (
    <input 
      type="file" 
      onChange={(e) => updateAvatar(e.target.files[0], userId)} 
    />
  );
}
```

### Example 3: Manual Upload + Auto Link

```typescript
// Upload file (can be any visibility or default)
const asset = await oxy.assetUpload(file);

// Link as avatar - automatically becomes public
await oxy.assetLink(asset.file.id, 'profiles', 'avatar', userId);
// Visibility auto-set to 'public' because entityType is 'avatar'
```

### Example 4: Profile Banner

```typescript
// Using helper
const banner = await oxy.uploadProfileBanner(bannerFile, userId);

// Or manual with auto-detection
const asset = await oxy.assetUpload(bannerFile);
await oxy.assetLink(asset.file.id, 'profiles', 'profile-banner', userId);
// Auto-set to 'public' because entityType is 'profile-banner'
```

## Comparison: Before vs After

### Before (Manual)
```typescript
// Had to manually specify visibility each time
const asset = await oxy.assetUpload(avatarFile, 'public');
await oxy.assetLink(asset.file.id, 'profiles', 'avatar', userId, 'public');
```

### After (Automatic)
```typescript
// Helper method - one line
await oxy.uploadAvatar(avatarFile, userId);

// Or with auto-detection
const asset = await oxy.assetUpload(avatarFile);
await oxy.assetLink(asset.file.id, 'profiles', 'avatar', userId);
// ↑ Automatically public!
```

## Auto-Detection Rules

| Entity Type | Auto Visibility | Reason |
|-------------|-----------------|--------|
| `'avatar'` | `'public'` | Users need to see each other's avatars |
| `'profile-banner'` | `'public'` | Public profile content |
| Other types | Backend default | Usually `'private'` unless specified |

## Benefits

1. ✅ **No More Mistakes** - Can't forget to make avatars public
2. ✅ **Less Code** - Fewer parameters to remember
3. ✅ **Better UX** - Avatars always accessible
4. ✅ **Backward Compatible** - Existing code still works
5. ✅ **Flexible** - Can still override manually if needed

## Override If Needed

You can still manually specify visibility to override auto-detection:

```typescript
// Force private avatar (unusual but possible)
await oxy.assetLink(assetId, 'profiles', 'avatar', userId, 'private');
```

## Migration Guide

### Existing Code

Your existing code continues to work:

```typescript
// This still works fine
await oxy.assetLink(fileId, 'profiles', 'avatar', userId);
// Now automatically sets visibility to 'public'
```

### Recommended Updates

For clarity, you can use the new helper methods:

```typescript
// Old way (still works)
const asset = await oxy.assetUpload(file);
await oxy.assetLink(asset.file.id, 'profiles', 'avatar', userId);

// New way (clearer intent)
await oxy.uploadAvatar(file, userId);
```

## Testing

✅ All tests pass
✅ TypeScript compilation successful
✅ No breaking changes

## Related Documentation

- Full visibility system: `FRONTEND_VISIBILITY_SUPPORT.md`
- Quick reference: `VISIBILITY_QUICK_REFERENCE.md`
- Complete overview: `VISIBILITY_SYSTEM_COMPLETE.md`

## Summary

Avatar and profile banner changes now **automatically use public visibility**. You don't need to remember to set it - the system is smart enough to know that avatars and banners should be public by default! 🎉

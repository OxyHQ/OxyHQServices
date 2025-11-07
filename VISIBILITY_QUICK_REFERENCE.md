# 🎯 Visibility System - Quick Reference

## 📦 Installation & Import

```typescript
import { OxyServices, FileVisibility } from '@oxyhq/services';
```

## 🚀 Quick Start Examples

### Upload Public Avatar (Automatic!)
```typescript
// Method 1: Using helper (recommended)
await oxy.uploadAvatar(file, userId);

// Method 2: Manual upload + auto-detected link
const avatar = await oxy.assetUpload(file);
await oxy.assetLink(avatar.fileId, 'profiles', 'avatar', userId);
// ↑ Automatically sets visibility to 'public'!
```

### Upload Profile Banner (Automatic!)
```typescript
// Method 1: Using helper (recommended)
await oxy.uploadProfileBanner(file, userId);

// Method 2: Auto-detected
const banner = await oxy.assetUpload(file);
await oxy.assetLink(banner.fileId, 'profiles', 'profile-banner', userId);
// ↑ Automatically sets visibility to 'public'!
```

### Upload Private Document
```typescript
const doc = await oxy.assetUpload(file, 'private');
// or just: const doc = await oxy.assetUpload(file);
```

### Upload Unlisted Content
```typescript
const shared = await oxy.assetUpload(file, 'unlisted');
```

### Update Visibility
```typescript
await oxy.assetUpdateVisibility(fileId, 'public');
```

## 📊 Visibility Levels

| Level | Auth | Public List | Use Case |
|-------|------|-------------|----------|
| `'private'` | ✅ Required | ❌ No | User documents, private media |
| `'public'` | ❌ No auth | ✅ Yes | Avatars, banners, public content |
| `'unlisted'` | ❌ No auth | ❌ No | Shared links, embeds |

## 🔧 Method Signatures

### OxyServices Methods

```typescript
// Helper methods (NEW - Recommended for avatars/banners)
uploadAvatar(
  file: File,
  userId: string,
  app?: string  // defaults to 'profiles'
): Promise<Asset>

uploadProfileBanner(
  file: File,
  userId: string,
  app?: string  // defaults to 'profiles'
): Promise<Asset>

// Upload with visibility
assetUpload(
  file: File,
  visibility?: 'private' | 'public' | 'unlisted',
  metadata?: Record<string, any>,
  onProgress?: (progress: number) => void
): Promise<Asset>

// Complete upload
assetComplete(
  fileId: string,
  originalName: string,
  size: number,
  mime: string,
  visibility?: 'private' | 'public' | 'unlisted',
  metadata?: Record<string, any>
): Promise<Asset>

// Link to entity (auto-detects visibility for avatar/profile-banner)
assetLink(
  fileId: string,
  app: string,
  entityType: string,
  entityId: string,
  visibility?: 'private' | 'public' | 'unlisted'  // Auto-set for avatar/banner!
): Promise<Asset>

// Update visibility
assetUpdateVisibility(
  fileId: string,
  visibility: 'private' | 'public' | 'unlisted'
): Promise<AssetUpdateVisibilityResponse>
```

## 🎨 Common Patterns

### Pattern 1: User Avatar Update (Automatic!)
```typescript
async function updateUserAvatar(file: File, userId: string) {
  // Method 1: One-liner with helper (recommended)
  return await oxy.uploadAvatar(file, userId);
  
  // Method 2: Manual with auto-detection
  const asset = await oxy.assetUpload(file);
  await oxy.assetLink(asset.fileId, 'profiles', 'avatar', userId);
  // ↑ Automatically sets visibility to 'public'
  return asset;
}
```

### Pattern 2: Profile Banner (Automatic!)
```typescript
async function updateProfileBanner(file: File, userId: string) {
  // One-liner with helper
  return await oxy.uploadProfileBanner(file, userId);
}
```

### Pattern 3: Post Media (User Choice)
```typescript
async function uploadPostMedia(file: File, postId: string, isPublic: boolean) {
  const visibility = isPublic ? 'public' : 'private';
  const asset = await oxy.assetUpload(file, visibility);
  await oxy.assetLink(asset.fileId, 'posts', 'media', postId, visibility);
  return asset;
}
```

### Pattern 4: Shareable Link
```typescript
async function createShareableLink(file: File) {
  // Upload as unlisted - accessible via direct link only
  const asset = await oxy.assetUpload(file, 'unlisted');
  const url = await oxy.assetGetUrl(asset.fileId);
  return url;
}
```

### Pattern 5: Privacy Toggle
```typescript
async function toggleFilePrivacy(fileId: string, makePublic: boolean) {
  const newVisibility = makePublic ? 'public' : 'private';
  await oxy.assetUpdateVisibility(fileId, newVisibility);
}
```

## 🛡️ Backend API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/assets/:id/stream` | Optional | Stream file content |
| GET | `/api/assets/:id/download` | Optional | Download file |
| PATCH | `/api/assets/:id/visibility` | Required | Update visibility |
| POST | `/api/assets/complete` | Required | Complete upload |
| POST | `/api/assets/:id/links` | Required | Link to entity |

## 🔄 Auto-Detection Rules

The backend automatically sets visibility based on entity type:

```typescript
// Auto-detected as PUBLIC
entityType: 'avatar'          → visibility: 'public'
entityType: 'profile-banner'  → visibility: 'public'

// Defaults to PRIVATE
entityType: 'post'           → visibility: 'private'
entityType: 'document'       → visibility: 'private'
entityType: <anything else>  → visibility: 'private'
```

## ✅ Best Practices

### DO ✅
- Set avatars and profile content as `'public'`
- Use `'unlisted'` for share links and embeds
- Keep user documents as `'private'` (default)
- Let users control visibility when possible
- Use auto-detection for common entity types

### DON'T ❌
- Don't hardcode `'private'` (it's the default)
- Don't make sensitive documents public
- Don't forget to update visibility when linking
- Don't skip error handling

## 🐛 Troubleshooting

### Issue: 403 Forbidden on Public File
```typescript
// Check visibility is set correctly
const asset = await oxy.assetGet(fileId);
console.log('Visibility:', asset.visibility); // Should be 'public'

// Update if needed
if (asset.visibility !== 'public') {
  await oxy.assetUpdateVisibility(fileId, 'public');
}
```

### Issue: Avatar Requires Authentication
```typescript
// Make sure you're using 'public' visibility
const asset = await oxy.assetUpload(avatarFile, 'public'); // ← Add this
await oxy.assetLink(asset.fileId, 'profiles', 'avatar', userId, 'public'); // ← And this
```

### Issue: TypeScript Error on Method Call
```typescript
// ❌ Wrong parameter order
await oxy.assetUpload(file, metadata, 'public'); // Wrong!

// ✅ Correct parameter order
await oxy.assetUpload(file, 'public', metadata); // Correct!
```

## 📚 Full Documentation

- **Frontend Guide**: `packages/services/FRONTEND_VISIBILITY_SUPPORT.md`
- **Backend Guide**: `packages/api/FILE_VISIBILITY_SYSTEM.md`
- **Complete Overview**: `VISIBILITY_SYSTEM_COMPLETE.md`

## 💡 TypeScript Types

```typescript
// Exported types
type FileVisibility = 'private' | 'public' | 'unlisted';

interface Asset {
  id: string;
  visibility: FileVisibility;
  // ... other fields
}

interface AssetUpdateVisibilityRequest {
  visibility: FileVisibility;
}

interface AssetUpdateVisibilityResponse {
  success: boolean;
  file: {
    id: string;
    visibility: FileVisibility;
    updatedAt: string;
  };
}
```

## 🎯 Default Behavior

When `visibility` parameter is omitted:

```typescript
await oxy.assetUpload(file)
// → visibility = 'private'

await oxy.assetLink(fileId, 'profiles', 'avatar', userId)
// → visibility = 'public' (auto-detected for 'avatar')

await oxy.assetLink(fileId, 'posts', 'media', postId)
// → visibility = 'private' (default for unknown types)
```

## ⚡ Performance Tips

1. **Public files** - No authentication overhead
2. **Batch updates** - Update visibility in bulk when needed
3. **Cache public URLs** - Public file URLs don't expire
4. **Use CDN** - Public files are CDN-ready

## 🔐 Security Notes

- Only file **owner** can update visibility
- Private files require **valid JWT token**
- Public files accessible to **anyone**
- Unlisted files **don't appear in listings** but are accessible via direct link

---

**Need Help?** Check the full documentation or review the examples above.

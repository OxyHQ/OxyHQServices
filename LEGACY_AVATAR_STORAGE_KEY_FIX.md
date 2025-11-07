# Legacy Avatar Storage Key Fix

## Problem

The application was encountering a `CastError` when trying to access files through the asset service:

```
CastError: Cast to ObjectId failed for value "users/68ba55704bd8566eafb4a761/gif_1239519664706059-cb75d838-a007-4bea-9186-904b7fef8c41.gif" (type string) at path "_id" for model "File"
```

### Root Cause

The error occurred because some user avatar fields in the database contained S3 storage keys (e.g., `users/{userId}/{filename}.gif`) instead of MongoDB ObjectIds that reference the File collection.

This happened when:
1. Legacy data migration stored storage keys directly in the `avatar` field
2. Or the avatar field was incorrectly set with a storage key instead of a file ID

### Impact

When the application tried to:
- Stream avatar images via `/api/assets/:id/stream`
- Download avatar images via `/api/assets/:id/download`
- Get file metadata via `assetService.getFile(fileId)`

It would fail with a MongoDB cast error because it tried to use the storage key as an ObjectId.

## Solution

### 1. Added Backward Compatibility to AssetService

Modified `/packages/api/src/services/assetService.ts` to handle both:
- Valid MongoDB ObjectIds (current standard)
- Legacy storage keys (for backward compatibility)

#### Changes to `getFile()` method:

```typescript
async getFile(fileId: string): Promise<IFile | null> {
  try {
    // Validate that fileId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      logger.warn('Invalid ObjectId provided to getFile, checking if it\'s a legacy storage key:', { fileId });
      
      // Try to find by storage key (for legacy data)
      const fileByStorageKey = await File.findOne({ storageKey: fileId });
      if (fileByStorageKey) {
        logger.info('Found file by legacy storage key:', { fileId, actualId: fileByStorageKey._id });
        return fileByStorageKey;
      }
      
      logger.warn('File not found by ID or storage key:', { fileId });
      return null;
    }
    const file = await File.findById(fileId);
    return file;
  } catch (error) {
    logger.error('Error getting file:', error);
    throw error;
  }
}
```

#### Changes to `getFileUrl()` method:

Updated to use the new `getFile()` method which handles legacy storage keys, and uses the actual file ID when generating variants.

### 2. Added Import

Added `import mongoose from 'mongoose';` to enable ObjectId validation.

## Benefits

1. **No Breaking Changes**: Existing code continues to work with proper file IDs
2. **Backward Compatibility**: Legacy storage keys are automatically resolved
3. **Graceful Degradation**: Returns null instead of throwing errors for invalid IDs
4. **Logging**: Provides clear log messages when legacy keys are encountered
5. **Data Migration Path**: Allows time to migrate legacy data without service disruption

## Recommendations

### Short-term
- Monitor logs for occurrences of "Found file by legacy storage key" messages
- These indicate which users have legacy data

### Long-term
Create a data migration script to update user avatars with proper file IDs:

```javascript
// Migration script example
const users = await User.find({ avatar: { $exists: true, $ne: '' } });

for (const user of users) {
  if (!mongoose.Types.ObjectId.isValid(user.avatar)) {
    // This is a legacy storage key
    const file = await File.findOne({ storageKey: user.avatar });
    if (file) {
      user.avatar = file._id.toString();
      await user.save();
      console.log(`Migrated user ${user.username}: ${user.avatar} -> ${file._id}`);
    }
  }
}
```

## Testing

To test the fix:

1. **Valid ObjectId**: Should work as before
   ```
   GET /api/assets/507f1f77bcf86cd799439011/stream
   ```

2. **Legacy Storage Key**: Should now resolve correctly
   ```
   GET /api/assets/users%2F68ba55704bd8566eafb4a761%2Fgif_1239519664706059-cb75d838-a007-4bea-9186-904b7fef8c41.gif/stream
   ```

3. **Invalid ID**: Should return 404 gracefully
   ```
   GET /api/assets/invalid-id/stream
   ```

## Related Files

- `/packages/api/src/services/assetService.ts` - Core fix implementation
- `/packages/api/src/models/File.ts` - File model with storageKey field
- `/packages/api/src/models/User.ts` - User model with avatar field
- `/packages/api/src/routes/assets.ts` - Asset routes that call getFile()

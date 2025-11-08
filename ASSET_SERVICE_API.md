# Asset Service API Reference

## Backend Response Structure

All Asset Service endpoints now return `assetId` at the top level for consistency.

### Upload Complete Response
```typescript
{
  success: true,
  assetId: "690e8bfeea30d88fcd16ddef",  // ← Top-level ID
  file: {
    id: "690e8bfeea30d88fcd16ddef",     // ← Also in file object
    sha256: "94dbc837f66816a9...",
    size: 717340,
    mime: "image/gif",
    originalName: "gif_5776543282151258.gif",
    status: "active",
    usageCount: 0,
    createdAt: "2025-11-08T00:17:02.280Z",
    updatedAt: "2025-11-08T00:17:03.257Z",
    links: [],
    variants: []
  }
}
```

### Get Asset Response
```typescript
{
  success: true,
  assetId: "690e8bfeea30d88fcd16ddef",
  file: {
    id: "690e8bfeea30d88fcd16ddef",
    sha256: "...",
    size: 717340,
    mime: "image/gif",
    ext: "gif",
    originalName: "file.gif",
    ownerUserId: "...",
    status: "active",
    visibility: "public",
    usageCount: 1,
    createdAt: "...",
    updatedAt: "...",
    links: [...],
    variants: [...],
    metadata: {...}
  }
}
```

### Link Asset Response
```typescript
{
  success: true,
  assetId: "690e8bfeea30d88fcd16ddef",
  file: {
    id: "690e8bfeea30d88fcd16ddef",
    usageCount: 1,
    links: [
      {
        app: "my-app",
        entityType: "post",
        entityId: "123",
        visibility: "public"
      }
    ],
    status: "active"
  }
}
```

## Frontend Usage

### Upload File
```typescript
const result = await oxyServices.assetUpload(file, 'public', metadata);
// result.assetId = "690e8bfeea30d88fcd16ddef"
// result.file.id = "690e8bfeea30d88fcd16ddef"
```

### Upload with uploadRawFile
```typescript
const result = await oxyServices.uploadRawFile(file, 'public');
// Internally calls assetUpload
```

### Get Asset Metadata
```typescript
const result = await oxyServices.assetGet(assetId);
// result.assetId = "690e8bfeea30d88fcd16ddef"
// result.file = { ... }
```

### Get Streaming URL
```typescript
const url = oxyServices.getFileDownloadUrl(assetId, variant);
// Returns: /api/assets/{assetId}/stream?variant=thumbnail&token=...
```

## FileManagement Screen

### Using in Third-Party Apps

When using FileManagement for selecting files (e.g., GIF picker), you can specify default visibility:

```typescript
navigate('FileManagement', {
  selectMode: true,
  defaultVisibility: 'public',  // ← Files uploaded here will be public
  onSelect: (file: FileMetadata) => {
    // file.id contains the assetId
    console.log('Selected file:', file.id);
  }
});
```

### Props

```typescript
interface FileManagementScreenProps {
  selectMode?: boolean;              // Enable file picker mode
  multiSelect?: boolean;             // Allow multiple selections
  defaultVisibility?: 'private' | 'public' | 'unlisted';  // Default for uploads
  onSelect?: (file: FileMetadata) => void;
  onConfirmSelection?: (files: FileMetadata[]) => void;
  allowUploadInSelectMode?: boolean; // Allow uploading in picker
  maxSelection?: number;
  disabledMimeTypes?: string[];
  afterSelect?: 'close' | 'back' | 'none';
}
```

## Visibility Levels

- **`private`** - Only owner can access (default)
- **`public`** - Anyone can access (no authentication required)
- **`unlisted`** - Accessible with direct link, not listed publicly

## Auto-Public Files

Files are automatically set to public visibility when:
- Avatar uploads (`entityType: 'avatar'`)
- Profile banner uploads (`entityType: 'profile-banner'`)

## Migration Notes

✅ All responses now include `assetId` at top level
✅ Old `uploadFile()` and `getFile()` methods removed
✅ Use `assetUpload()`, `assetGet()`, `uploadRawFile()` instead
✅ FileManagement supports `defaultVisibility` prop
✅ Old `/api/files` routes completely removed

# Central Asset Service Documentation

The Central Asset Service provides a unified way to manage file uploads, storage, linking, variants, and deletion across the OxyHQ ecosystem. This service implements content-addressed storage using SHA256 hashing for deduplication and provides a comprehensive API for file management.

## Overview

### Key Features

- **Content-Addressed Storage**: Files are stored using SHA256 hashes to enable deduplication
- **Reference Counting**: Files track usage across apps via embedded links array
- **Variant Generation**: Automatic generation of image, video, and PDF variants
- **Cross-App Linking**: Files can be linked to entities across different applications
- **Comprehensive Deletion**: Smart deletion with impact analysis and confirmation
- **CDN Delivery**: All files served via `cloud.oxy.so` with optimized delivery
- **Zustand Integration**: Frontend state management for seamless UI integration

### Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Server    │    │   Storage       │
│   (React/RN)    │    │   (Express)     │    │   (S3/Spaces)   │
├─────────────────┤    ├─────────────────┤    ├─────────────────┤
│ useAssets Hook  │◄──►│ Asset Routes    │◄──►│ Content Files   │
│ Zustand Store   │    │ Asset Service   │    │ Variant Files   │
│ Upload Progress │    │ Variant Service │    │ CDN Delivery    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   Database      │
                       │   (MongoDB)     │
                       ├─────────────────┤
                       │ Files Collection│
                       │ Links & Variants│
                       │ Reference Count │
                       └─────────────────┘
```

## Database Schema

### Files Collection

```javascript
{
  "_id": "uuid",
  "sha256": "string",           // Content hash for deduplication
  "size": 12345,               // File size in bytes
  "mime": "image/jpeg",        // MIME type
  "ext": "jpg",                // File extension
  "ownerUserId": "uuid",       // Original uploader
  "status": "active",          // active | trash | deleted
  "createdAt": "date",
  "updatedAt": "date",
  "storageKey": "content/2025/01/ab/sha256.jpg",
  "originalName": "photo.jpg",
  "metadata": {},              // Custom metadata
  "links": [                   // Cross-app references
    {
      "app": "mention",
      "entityType": "post",
      "entityId": "p123",
      "createdBy": "uuid",
      "createdAt": "date"
    }
  ],
  "variants": [                // Generated variants
    {
      "type": "w320",
      "key": "variants/2025/01/ab/sha256/w320.webp",
      "width": 320,
      "height": 200,
      "readyAt": "date",
      "size": 15000
    }
  ]
}
```

## API Endpoints

### Upload Flow

#### 1. Initialize Upload
```http
POST /api/assets/init
Content-Type: application/json

{
  "sha256": "abc123...",
  "size": 1048576,
  "mime": "image/jpeg"
}
```

**Response:**
```json
{
  "uploadUrl": "https://spaces.example.com/presigned-url",
  "fileId": "uuid",
  "sha256": "abc123..."
}
```

#### 2. Upload to S3
```http
PUT https://spaces.example.com/presigned-url
Content-Type: image/jpeg

[binary file data]
```

#### 3. Complete Upload
```http
POST /api/assets/complete
Content-Type: application/json

{
  "fileId": "uuid",
  "originalName": "photo.jpg",
  "size": 1048576,
  "mime": "image/jpeg",
  "metadata": {
    "description": "Profile photo"
  }
}
```

### File Management

#### Link File to Entity
```http
POST /api/assets/{fileId}/links
Content-Type: application/json

{
  "app": "mention",
  "entityType": "post",
  "entityId": "post-123"
}
```

#### Unlink File from Entity
```http
DELETE /api/assets/{fileId}/links
Content-Type: application/json

{
  "app": "mention",
  "entityType": "post",
  "entityId": "post-123"
}
```

#### Get File Metadata
```http
GET /api/assets/{fileId}
```

#### Get File URL
```http
GET /api/assets/{fileId}/url?variant=w320&expiresIn=3600
```

#### Delete File
```http
DELETE /api/assets/{fileId}?force=true
```

## Frontend Integration

### Setup

```javascript
import { OxyServices, setOxyAssetInstance, useAssets } from '@oxyhq/services';

// Initialize OxyServices
const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });
setOxyAssetInstance(oxyServices);
```

### Upload Files

```javascript
import { useAssets } from '@oxyhq/services';

function UploadComponent() {
  const { upload, uploadProgress, loading } = useAssets();

  const handleFileUpload = async (file) => {
    try {
      const asset = await upload(file, {
        description: 'User uploaded file',
        tags: ['profile', 'image']
      });
      
      console.log('File uploaded:', asset);
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  return (
    <div>
      <input 
        type="file" 
        onChange={(e) => handleFileUpload(e.target.files[0])}
        disabled={loading.uploading}
      />
      
      {/* Show upload progress */}
      {Object.values(uploadProgress).map(progress => (
        <div key={progress.fileId}>
          Upload: {progress.percentage}%
        </div>
      ))}
    </div>
  );
}
```

### Link Files to Entities

```javascript
import { useAssets } from '@oxyhq/services';

function PostEditor({ postId }) {
  const { link, unlink, getAssetsByEntity } = useAssets();
  
  // Get all assets linked to this post
  const postAssets = getAssetsByEntity('mention', 'post', postId);

  const handleLinkAsset = async (assetId) => {
    try {
      await link(assetId, 'mention', 'post', postId);
      console.log('Asset linked to post');
    } catch (error) {
      console.error('Link failed:', error);
    }
  };

  const handleUnlinkAsset = async (assetId) => {
    try {
      await unlink(assetId, 'mention', 'post', postId);
      console.log('Asset unlinked from post');
    } catch (error) {
      console.error('Unlink failed:', error);
    }
  };

  return (
    <div>
      <h3>Post Assets ({postAssets.length})</h3>
      {postAssets.map(asset => (
        <div key={asset.id}>
          <span>{asset.originalName}</span>
          <button onClick={() => handleUnlinkAsset(asset.id)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
```

### Display Files with Variants

```javascript
import { useAssets } from '@oxyhq/services';

function ImageDisplay({ assetId, variant = 'w640' }) {
  const { getUrl } = useAssets();
  const [imageUrl, setImageUrl] = useState('');

  useEffect(() => {
    const loadImage = async () => {
      try {
        const url = await getUrl(assetId, variant);
        setImageUrl(url);
      } catch (error) {
        console.error('Failed to get image URL:', error);
      }
    };

    loadImage();
  }, [assetId, variant]);

  return imageUrl ? <img src={imageUrl} alt="Asset" /> : <div>Loading...</div>;
}
```

### State Management with Zustand

```javascript
import { useAssetStore } from '@oxyhq/services';

function AssetManager() {
  const {
    assets,
    loading,
    errors,
    getAssetsByApp,
    clearErrors
  } = useAssetStore();

  // Get all assets for the current app
  const mentionAssets = getAssetsByApp('mention');

  return (
    <div>
      <h2>Assets ({mentionAssets.length})</h2>
      
      {errors.upload && (
        <div className="error">
          Upload Error: {errors.upload}
          <button onClick={clearErrors}>Clear</button>
        </div>
      )}
      
      {loading.uploading && <div>Uploading...</div>}
      
      {mentionAssets.map(asset => (
        <div key={asset.id}>
          <span>{asset.originalName}</span>
          <span>Links: {asset.usageCount}</span>
          <span>Status: {asset.status}</span>
        </div>
      ))}
    </div>
  );
}
```

## Variant Types

### Images
- `thumb`: 256x256 thumbnail (square crop)
- `w320`: 320px width, proportional height
- `w640`: 640px width, proportional height  
- `w1280`: 1280px width, proportional height
- `w2048`: 2048px width, proportional height

All image variants are generated in WebP format with 82% quality for optimal compression.

### Videos
- `poster`: Poster frame extracted at 1 second
- Future: HLS streams for different bitrates

### PDFs
- `thumb`: First page rendered as 256x256 thumbnail

## Error Handling

### Common Error Codes

- `AUTH_ERROR`: Authentication required
- `VALIDATION_ERROR`: Invalid request data
- `FILE_NOT_FOUND`: Requested file doesn't exist
- `VARIANT_NOT_FOUND`: Requested variant not available
- `UPLOAD_FAILED`: File upload failed
- `LINK_EXISTS`: Link already exists
- `DELETE_CONFLICT`: Cannot delete file with active links

### Error Handling Best Practices

```javascript
import { useAssets } from '@oxyhq/services';

function robustUpload(file) {
  const { upload, errors, clearErrors } = useAssets();
  
  const handleUpload = async () => {
    try {
      clearErrors();
      const asset = await upload(file);
      return asset;
    } catch (error) {
      if (error.code === 'AUTH_ERROR') {
        // Redirect to login
        window.location.href = '/login';
      } else if (error.code === 'VALIDATION_ERROR') {
        // Show validation errors
        console.error('Validation failed:', error.details);
      } else {
        // Generic error handling
        console.error('Upload failed:', error.message);
      }
      throw error;
    }
  };
}
```

## Migration from Legacy File System

### Gradual Migration Strategy

1. **Phase 1**: Deploy Central Asset Service alongside existing file system
2. **Phase 2**: Update new uploads to use Central Asset Service
3. **Phase 3**: Migrate existing files using background jobs
4. **Phase 4**: Deprecate legacy file endpoints

### Migration Utilities

The service provides utilities to migrate existing files:

```javascript
// Migration example (server-side)
import { AssetService } from './services/assetService';

async function migrateExistingFile(legacyFileData) {
  const assetService = new AssetService(s3Service);
  
  // Calculate SHA256 of existing file
  const buffer = await downloadLegacyFile(legacyFileData.id);
  const sha256 = AssetService.calculateSHA256(buffer);
  
  // Create new asset record
  const asset = await assetService.initUpload(
    legacyFileData.userId,
    sha256,
    buffer.length,
    legacyFileData.mimeType
  );
  
  // Migrate links
  for (const link of legacyFileData.references) {
    await assetService.linkFile(asset.fileId, {
      app: link.app,
      entityType: link.entityType,
      entityId: link.entityId,
      createdBy: link.userId
    });
  }
}
```

## Performance Considerations

### Content Deduplication
- Files with identical SHA256 hashes share storage
- Variants are reused across duplicate files
- Significant storage savings for common files

### CDN Optimization
- All files served via `cloud.oxy.so` CDN
- Aggressive caching for public files
- Range request support for large files

### Database Indexing
- Optimized indexes for SHA256 lookups
- Compound indexes for link queries
- Efficient pagination for large datasets

### Variant Generation
- Background processing to avoid blocking uploads
- Progressive variant availability
- Fallback to original file if variant not ready

## Security

### Access Control
- All API endpoints require authentication
- File ownership validation
- Cross-app access controls via linking system

### Content Addressing
- SHA256 hashing prevents tampering
- Immutable content once uploaded
- Automatic duplicate detection

### Privacy
- Private files require signed URLs
- EXIF data stripped from images
- Configurable retention policies

## Monitoring and Observability

### Metrics
- Upload success/failure rates
- Variant generation completion times
- Storage usage by app and file type
- CDN hit rates and bandwidth usage

### Logging
- Structured logs for all operations
- Upload progress tracking
- Error categorization and alerting
- Performance monitoring

### Health Checks
- S3/Spaces connectivity
- Database responsiveness  
- Variant generation queue status
- CDN endpoint availability
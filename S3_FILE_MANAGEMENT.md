# S3 File Management Implementation

This document provides comprehensive documentation for the AWS S3 file management implementation in the OxyHQ services and API packages.

## Overview

The S3 file management system provides:
- **Client-side file management** for web and React Native applications
- **Server-side file management** with comprehensive API endpoints
- **Secure file operations** with authentication and authorization
- **Presigned URL generation** for direct S3 uploads/downloads
- **Batch operations** for multiple files
- **File validation** and error handling

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Client    │    │ React Native    │    │   API Server    │
│                 │    │    Client       │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AWS S3 Storage                               │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ User Files  │  │ Public      │  │ Private     │            │
│  │ (users/ID/) │  │ Assets      │  │ Data        │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## Setup

### 1. AWS Configuration

Set up your AWS S3 bucket and credentials:

```bash
# Environment variables for API server
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_S3_BUCKET=your-bucket-name
```

### 2. S3 Bucket Configuration

Configure your S3 bucket with appropriate CORS settings:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "POST", "PUT", "DELETE", "HEAD"],
        "AllowedOrigins": ["*"],
        "ExposeHeaders": ["ETag"]
    }
]
```

### 3. IAM Permissions

Ensure your AWS credentials have the following S3 permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket",
                "s3:GetObjectAcl",
                "s3:PutObjectAcl"
            ],
            "Resource": [
                "arn:aws:s3:::your-bucket-name",
                "arn:aws:s3:::your-bucket-name/*"
            ]
        }
    ]
}
```

## Client-Side Usage

### Web Environment

```typescript
import { S3FileManager, createS3FileManager } from '@oxyhq/services';

// Initialize S3 manager
const s3Config = {
  region: 'us-east-1',
  accessKeyId: 'your-access-key-id',
  secretAccessKey: 'your-secret-access-key',
  bucketName: 'your-bucket-name',
};

const s3Manager = createS3FileManager(s3Config);

// Upload a file
const uploadFile = async (file: File) => {
  const key = `uploads/${Date.now()}-${file.name}`;
  const url = await s3Manager.uploadFile(key, file, {
    contentType: file.type,
    metadata: { uploadedBy: 'user123' },
    publicRead: false,
  });
  return url;
};

// Download a file
const downloadFile = async (key: string) => {
  const buffer = await s3Manager.downloadFile(key);
  // Handle buffer (create blob, download, etc.)
};

// Get presigned URLs
const getPresignedUrls = async (key: string) => {
  const uploadUrl = await s3Manager.getPresignedUploadUrl(key, 'image/jpeg');
  const downloadUrl = await s3Manager.getPresignedDownloadUrl(key);
  return { uploadUrl, downloadUrl };
};
```

### React Native Environment

```typescript
import { S3FileManagerRN, createS3FileManagerRN } from '@oxyhq/services';

const s3Manager = createS3FileManagerRN(s3Config);

// Upload a file from React Native
const uploadFile = async (fileInfo: RNFile) => {
  const key = `uploads/${Date.now()}-${fileInfo.name}`;
  const url = await s3Manager.uploadFile(key, fileInfo, {
    contentType: fileInfo.type || 'application/octet-stream',
    metadata: { uploadedBy: 'user123' },
  });
  return url;
};

// Upload image with validation
const uploadImage = async (fileInfo: RNFile) => {
  const fileSize = await s3Manager.getFileSize(fileInfo);
  if (fileSize > 5 * 1024 * 1024) {
    throw new Error('File too large');
  }
  
  return await s3Manager.uploadImage(key, fileInfo, {
    publicRead: true,
  });
};
```

## Server-Side API Endpoints

### Authentication

All file endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### File Upload

**POST** `/api/files/upload`

Upload a single file to S3.

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/file.jpg" \
  -F "folder=images" \
  -F "publicRead=true" \
  -F "metadata={\"category\":\"profile\"}" \
  http://localhost:3000/api/files/upload
```

**Response:**
```json
{
  "success": true,
  "file": {
    "key": "users/123/images/file-123456.jpg",
    "size": 1024000,
    "lastModified": "2024-01-01T00:00:00.000Z",
    "contentType": "image/jpeg",
    "metadata": {
      "userId": "123",
      "originalName": "file.jpg",
      "uploadedAt": "2024-01-01T00:00:00.000Z",
      "category": "profile"
    },
    "url": "https://bucket.s3.amazonaws.com/users/123/images/file-123456.jpg"
  },
  "message": "File uploaded successfully"
}
```

### Multiple File Upload

**POST** `/api/files/upload-multiple`

Upload multiple files to S3.

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -F "files=@/path/to/file1.jpg" \
  -F "files=@/path/to/file2.jpg" \
  -F "folder=images" \
  http://localhost:3000/api/files/upload-multiple
```

### File Download

**GET** `/api/files/download/:key`

Download a file from S3.

```bash
curl -X GET \
  -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/files/download/users/123/images/file.jpg
```

### File Deletion

**DELETE** `/api/files/:key`

Delete a file from S3.

```bash
curl -X DELETE \
  -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/files/users/123/images/file.jpg
```

### Batch File Deletion

**DELETE** `/api/files/batch`

Delete multiple files from S3.

```bash
curl -X DELETE \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"keys": ["users/123/file1.jpg", "users/123/file2.jpg"]}' \
  http://localhost:3000/api/files/batch
```

### Presigned URLs

**GET** `/api/files/presigned-upload?key=filename&contentType=image/jpeg`

Generate a presigned URL for direct S3 upload.

```bash
curl -X GET \
  -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/files/presigned-upload?key=test.jpg&contentType=image/jpeg"
```

**Response:**
```json
{
  "success": true,
  "url": "https://bucket.s3.amazonaws.com/users/123/test.jpg?X-Amz-Algorithm=...",
  "key": "users/123/test.jpg",
  "expiresIn": 3600
}
```

**GET** `/api/files/presigned-download/:key`

Generate a presigned URL for direct S3 download.

```bash
curl -X GET \
  -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/files/presigned-download/users/123/file.jpg
```

### File Listing

**GET** `/api/files/list?prefix=images&maxKeys=50`

List files in the user's S3 folder.

```bash
curl -X GET \
  -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/files/list?prefix=images&maxKeys=50"
```

**Response:**
```json
{
  "success": true,
  "files": [
    {
      "key": "users/123/images/file1.jpg",
      "size": 1024000,
      "lastModified": "2024-01-01T00:00:00.000Z"
    }
  ],
  "count": 1
}
```

### File Metadata

**GET** `/api/files/metadata/:key`

Get metadata for a specific file.

```bash
curl -X GET \
  -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/files/metadata/users/123/file.jpg
```

### File Operations

**POST** `/api/files/copy`

Copy a file within S3.

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"sourceKey": "users/123/file.jpg", "destinationKey": "users/123/backup/file.jpg"}' \
  http://localhost:3000/api/files/copy
```

**POST** `/api/files/move`

Move a file within S3.

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"sourceKey": "users/123/file.jpg", "destinationKey": "users/123/archived/file.jpg"}' \
  http://localhost:3000/api/files/move
```

## Security Features

### User Isolation

- All files are stored under user-specific folders (`users/{userId}/`)
- Users can only access their own files
- Server-side validation ensures users cannot access other users' files

### File Validation

- File type validation (MIME types)
- File size limits (10MB default)
- Content type verification
- Malicious file detection

### Authentication & Authorization

- JWT token validation on all endpoints
- User context verification
- File ownership validation

## Error Handling

### Common Error Responses

```json
{
  "error": "Failed to upload file",
  "message": "File size exceeds limit"
}
```

### Error Codes

- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (access denied)
- `404` - File not found
- `413` - File too large
- `415` - Unsupported file type
- `500` - Internal server error

## Performance Considerations

### Upload Optimization

- Use presigned URLs for large files
- Implement chunked uploads for files > 100MB
- Use multipart uploads for better reliability

### Download Optimization

- Use presigned URLs for direct S3 access
- Implement caching headers for static assets
- Consider CDN integration for public files

### Batch Operations

- Use batch endpoints for multiple files
- Implement parallel processing where possible
- Add progress tracking for large operations

## Monitoring & Logging

### Log Events

The system logs the following events:
- File uploads (with metadata)
- File downloads (with user info)
- File deletions (with confirmation)
- Access violations (security events)
- Error conditions (with stack traces)

### Metrics to Monitor

- Upload/download success rates
- File size distributions
- Storage usage per user
- API response times
- Error rates by endpoint

## Best Practices

### File Organization

```
users/
├── {userId}/
│   ├── images/
│   │   ├── profile/
│   │   └── gallery/
│   ├── documents/
│   │   ├── contracts/
│   │   └── reports/
│   └── temp/
└── public/
    ├── assets/
    └── shared/
```

### Naming Conventions

- Use descriptive file names
- Include timestamps for uniqueness
- Use lowercase with hyphens
- Avoid special characters

### Metadata Strategy

- Store essential metadata in S3 object metadata
- Use consistent key names
- Include user context
- Add timestamps for auditing

## Troubleshooting

### Common Issues

1. **CORS Errors**
   - Verify S3 bucket CORS configuration
   - Check allowed origins in API server

2. **Authentication Failures**
   - Verify JWT token validity
   - Check token expiration
   - Ensure proper Authorization header

3. **File Upload Failures**
   - Check file size limits
   - Verify file type restrictions
   - Ensure sufficient S3 permissions

4. **Performance Issues**
   - Use presigned URLs for large files
   - Implement proper error handling
   - Monitor S3 request limits

### Debug Mode

Enable debug logging by setting the log level:

```typescript
// In your application
logger.setLevel('debug');
```

## Migration Guide

### From GridFS to S3

If migrating from the existing GridFS implementation:

1. **Data Migration**
   ```bash
   # Export files from GridFS
   mongodump --db yourdb --collection fs.files
   
   # Upload to S3 using migration script
   node scripts/migrate-to-s3.js
   ```

2. **Update Client Code**
   - Replace GridFS upload calls with S3 endpoints
   - Update file URL generation
   - Modify file listing logic

3. **Update Database References**
   - Replace file IDs with S3 keys
   - Update metadata storage
   - Migrate file associations

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review error logs
3. Verify AWS configuration
4. Test with minimal examples
5. Contact the development team

## License

This implementation is part of the OxyHQ services package and follows the same licensing terms. 
# File Management

Complete guide to file upload, storage, and management in the Oxy API.

## Overview

The Oxy API provides comprehensive file management capabilities using MongoDB GridFS for efficient storage and streaming of files up to 50MB. Files are stored with metadata including user ownership, file type, and upload information.

## Features

- **GridFS Storage**: Efficient file storage using MongoDB GridFS
- **Raw Upload**: Direct file upload without form data processing
- **Streaming**: Efficient file serving with streaming responses
- **Metadata Management**: Rich file metadata and search capabilities
- **User Isolation**: Files are isolated per user with proper access controls
- **File Validation**: Automatic file type and size validation

## File Upload

### Raw Upload Endpoint

Upload files using raw data for maximum efficiency:

```bash
POST /api/files/upload-raw
```

**Required Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/octet-stream
X-File-Name: filename.ext
X-User-Id: user_id
```

**Request Body:**
```
Raw file data (up to 50MB)
```

**Response:**
```json
{
  "_id": "file_id",
  "filename": "filename.ext",
  "size": 12345,
  "mimetype": "image/jpeg"
}
```

### Upload Example

```javascript
// JavaScript example
const fileData = fs.readFileSync('image.jpg');
const response = await fetch('/api/files/upload-raw', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/octet-stream',
    'X-File-Name': 'image.jpg',
    'X-User-Id': userId
  },
  body: fileData
});

const result = await response.json();
console.log('File uploaded:', result._id);
```

### File Size Limits

- **Maximum file size**: 50MB
- **Supported formats**: All file types
- **Storage**: MongoDB GridFS with automatic chunking

## File Retrieval

### Streaming Files

Download files with efficient streaming:

```bash
GET /api/files/:fileId
```

**Response:**
```
File stream with appropriate headers:
- Content-Type: <file_mime_type>
- Content-Length: <file_size>
- Cache-Control: public, max-age=31536000
```

### File Metadata

Get file information without downloading:

```bash
GET /api/files/meta/:fileId
```

**Response:**
```json
{
  "_id": "file_id",
  "filename": "filename.ext",
  "contentType": "image/jpeg",
  "length": 12345,
  "uploadDate": "2025-06-13T10:00:00.000Z",
  "metadata": {
    "userID": "user_id",
    "originalname": "filename.ext",
    "size": 12345,
    "uploadDate": "2025-06-13T10:00:00.000Z"
  }
}
```

### Batch File Data

Get multiple files' metadata at once:

```bash
GET /api/files/data/:fileIds
```

**Parameters:**
- `fileIds`: Comma-separated list of file IDs

**Response:**
```json
{
  "files": [
    {
      "_id": "file_id_1",
      "filename": "file1.jpg",
      "contentType": "image/jpeg",
      "length": 12345
    },
    {
      "_id": "file_id_2",
      "filename": "file2.pdf",
      "contentType": "application/pdf",
      "length": 67890
    }
  ]
}
```

## File Management

### List User Files

Get all files for a specific user:

```bash
GET /api/files/list/:userID
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
[
  {
    "_id": "file_id",
    "filename": "filename.ext",
    "contentType": "image/jpeg",
    "length": 12345,
    "uploadDate": "2025-06-13T10:00:00.000Z"
  }
]
```

### Delete Files

Remove files from storage:

```bash
DELETE /api/files/:fileId
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "message": "File deleted successfully"
}
```

### File Cleanup

Validate and identify broken file references:

```bash
POST /api/files/cleanup/:userID
```

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "message": "File validation completed",
  "total": 25,
  "valid": 23,
  "broken": 2,
  "brokenFileIds": ["file_id_1", "file_id_2"]
}
```

## File Access Control

### Public Access

File streaming endpoints are publicly accessible for efficient content delivery:

```bash
GET /api/files/:fileId
```

### Protected Operations

The following operations require authentication:

- **Upload**: Requires valid JWT token and user ID match
- **List**: Users can only list their own files
- **Delete**: Users can only delete their own files
- **Cleanup**: Users can only cleanup their own files

### Security Features

- **User Validation**: All operations verify file ownership
- **Token Authentication**: Protected endpoints require valid JWT
- **File Size Limits**: Automatic rejection of oversized files
- **Content Type Validation**: Proper MIME type handling

## Error Handling

### Common Errors

| Error Code | Description | Solution |
|------------|-------------|----------|
| `400` | Invalid file ID or missing headers | Check file ID format and required headers |
| `401` | Missing or invalid authentication | Provide valid JWT token |
| `403` | Unauthorized access | Ensure file ownership |
| `404` | File not found | Verify file exists and ID is correct |
| `413` | File too large | Reduce file size (max 50MB) |

### Error Response Format

```json
{
  "message": "Error description",
  "error": "Detailed error information"
}
```

## Performance Considerations

### Streaming Benefits

- **Memory Efficient**: Files are streamed without loading into memory
- **Fast Response**: Immediate start of file delivery
- **Scalable**: Handles large files efficiently
- **Caching**: Automatic browser caching for static content

### GridFS Advantages

- **Chunked Storage**: Large files are automatically chunked
- **Metadata Storage**: Rich file information alongside content
- **Efficient Queries**: Fast file lookup and metadata retrieval
- **Scalability**: Handles files larger than 16MB efficiently

## Best Practices

### Upload Optimization

1. **Use Raw Upload**: Avoid form data for better performance
2. **Set Proper Headers**: Include all required headers
3. **Validate Client-Side**: Check file size before upload
4. **Handle Errors**: Implement proper error handling

### File Management

1. **Regular Cleanup**: Periodically validate file references
2. **Monitor Storage**: Track file usage and storage consumption
3. **Backup Strategy**: Implement proper backup for GridFS
4. **Access Control**: Always verify file ownership

### Security

1. **Validate File Types**: Check file extensions and content
2. **Limit File Sizes**: Enforce maximum file size limits
3. **Secure Access**: Use proper authentication for all operations
4. **Audit Logging**: Log file operations for security monitoring

## Integration Examples

### React/JavaScript

```javascript
// Upload file
const uploadFile = async (file, token, userId) => {
  const response = await fetch('/api/files/upload-raw', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'X-File-Name': file.name,
      'X-User-Id': userId
    },
    body: file
  });
  
  return response.json();
};

// Display file
const displayFile = (fileId) => {
  return <img src={`/api/files/${fileId}`} alt="File" />;
};
```

### Node.js/Express

```javascript
// Upload middleware
app.post('/upload', async (req, res) => {
  try {
    const fileData = req.body;
    const fileName = req.headers['x-file-name'];
    const userId = req.headers['x-user-id'];
    
    const response = await fetch('http://localhost:3001/api/files/upload-raw', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${req.headers.authorization}`,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': fileName,
        'X-User-Id': userId
      },
      body: fileData
    });
    
    const result = await response.json();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## Troubleshooting

### Common Issues

1. **Upload Fails**: Check file size and required headers
2. **File Not Found**: Verify file ID and existence
3. **Access Denied**: Ensure proper authentication and ownership
4. **Slow Downloads**: Check network and server performance

### Debug Information

Enable debug logging to troubleshoot issues:

```javascript
// Server-side logging
console.log('File upload request:', {
  fileName: req.headers['x-file-name'],
  userId: req.headers['x-user-id'],
  contentLength: req.headers['content-length']
});
```

## API Reference

For complete API documentation, see the [API Reference](./api-reference.md#file-management-endpoints) section. 
# File Management System

The OxyServices library provides comprehensive file management capabilities built on MongoDB's GridFS system. This allows for efficient storage and retrieval of files of any size.

## Features

- Upload files to GridFS storage
- Retrieve file metadata
- Download files
- Stream files (particularly useful for audio/video)
- Update file metadata
- Delete files
- List files with filtering and pagination

## API Reference

### File Models

#### FileMetadata

```typescript
interface FileMetadata {
  id: string;
  filename: string;
  contentType: string;
  length: number;
  chunkSize: number;
  uploadDate: string;
  metadata?: {
    userId?: string;
    description?: string;
    title?: string;
    tags?: string[];
    [key: string]: any;
  };
}
```

#### FileUploadResponse

```typescript
interface FileUploadResponse {
  success: boolean;
  file: FileMetadata;
}
```

#### FileListResponse

```typescript
interface FileListResponse {
  files: FileMetadata[];
  total: number;
  hasMore: boolean;
}
```

#### FileUpdateRequest

```typescript
interface FileUpdateRequest {
  filename?: string;
  metadata?: {
    description?: string;
    title?: string;
    tags?: string[];
    [key: string]: any;
  };
}
```

#### FileDeleteResponse

```typescript
interface FileDeleteResponse {
  success: boolean;
  message: string;
  fileId: string;
}
```

### Methods

#### uploadFile(file, filename, metadata?)

Uploads a file to the server using GridFS.

```typescript
const file = /* File object (browser) or Buffer (Node.js) */;
const response = await oxyServices.uploadFile(file, 'example.pdf', {
  userId: 'user123',
  description: 'My important document',
  title: 'Example Document',
  tags: ['important', 'document']
});

console.log(response.file.id); // The file ID for future reference
```

#### getFileMetadata(fileId)

Retrieves metadata for a specific file.

```typescript
const metadata = await oxyServices.getFileMetadata('file123');
console.log(metadata.filename, metadata.contentType, metadata.length);
```

#### updateFileMetadata(fileId, updates)

Updates the metadata of a file.

```typescript
const updatedMetadata = await oxyServices.updateFileMetadata('file123', {
  filename: 'new-name.pdf',
  metadata: {
    description: 'Updated description',
    tags: ['updated', 'document']
  }
});
```

#### deleteFile(fileId)

Deletes a file from GridFS.

```typescript
const result = await oxyServices.deleteFile('file123');
if (result.success) {
  console.log(`File ${result.fileId} was deleted successfully`);
}
```

#### getFileDownloadUrl(fileId)

Gets a URL that can be used to download a file.

```typescript
const downloadUrl = oxyServices.getFileDownloadUrl('file123');
// Use this URL in an <a> tag or for direct download
```

#### getFileStreamUrl(fileId)

Gets a URL that can be used to stream a file (useful for audio/video).

```typescript
const streamUrl = oxyServices.getFileStreamUrl('file123');
// Use this URL in media players or <video>/<audio> tags
```

#### listUserFiles(userId, limit?, offset?, filters?)

Lists files for a specific user with pagination and filtering.

```typescript
// Get all files for a user
const allFiles = await oxyServices.listUserFiles('user123');

// Get paginated files
const pagedFiles = await oxyServices.listUserFiles('user123', 10, 20);

// Get files filtered by content type
const imageFiles = await oxyServices.listUserFiles('user123', 10, 0, {
  contentType: 'image/'
});

// Access the files and pagination info
console.log(`Total files: ${pagedFiles.total}`);
pagedFiles.files.forEach(file => {
  console.log(`- ${file.filename} (${file.contentType}): ${file.length} bytes`);
});
```

## Examples

### Upload a Profile Picture

```typescript
import { oxyServices } from './services';

async function uploadProfilePicture(userId, imageFile) {
  try {
    // Upload the image file
    const response = await oxyServices.uploadFile(imageFile, imageFile.name, {
      userId,
      description: 'Profile picture',
      tags: ['avatar', 'profile']
    });
    
    // Update the user's avatar with the file ID and URL
    await oxyServices.updateUser(userId, {
      avatar: {
        id: response.file.id,
        url: oxyServices.getFileDownloadUrl(response.file.id)
      }
    });
    
    return response.file;
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    throw error;
  }
}
```

### Display User Documents

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { oxyServices } from './services';

function UserDocumentsScreen({ userId }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    async function loadDocuments() {
      try {
        const response = await oxyServices.listUserFiles(userId);
        setDocuments(response.files);
      } catch (error) {
        console.error('Error loading documents:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadDocuments();
  }, [userId]);
  
  const downloadDocument = (fileId) => {
    const url = oxyServices.getFileDownloadUrl(fileId);
    // Handle download based on platform (e.g., open in browser, trigger download)
  };
  
  if (loading) return <Text>Loading documents...</Text>;
  
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Documents</Text>
      <FlatList
        data={documents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={styles.documentItem}
            onPress={() => downloadDocument(item.id)}
          >
            <Text style={styles.documentName}>{item.filename}</Text>
            <Text style={styles.documentInfo}>
              {(item.length / 1024).toFixed(2)} KB • {new Date(item.uploadDate).toLocaleDateString()}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  documentItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  documentName: {
    fontSize: 16,
    fontWeight: '500',
  },
  documentInfo: {
    fontSize: 12,
    color: '#777',
    marginTop: 4,
  }
});
```

## Server-Side Implementation Notes

The client methods in this documentation expect a server implementing the following endpoints:

- `POST /files/upload` - For file uploads using multipart/form-data
- `GET /files/:fileId/metadata` - To retrieve file metadata
- `PUT /files/:fileId/metadata` - To update file metadata
- `DELETE /files/:fileId` - To delete files
- `GET /files/:fileId/download` - To download files
- `GET /files/:fileId/stream` - To stream files
- `GET /files` - To list files with filtering

Each endpoint should implement the appropriate GridFS operations on the server side to handle the files correctly.
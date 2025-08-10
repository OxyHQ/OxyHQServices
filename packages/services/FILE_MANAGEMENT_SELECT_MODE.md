# FileManagementScreen Select Mode Usage Examples

This document demonstrates how to use the new select mode functionality in the FileManagementScreen component.

## Basic Usage

### Enable Select Mode
```tsx
import FileManagementScreen from '@oxyhq/services/ui/screens/FileManagementScreen';

// Basic select mode
<FileManagementScreen
  selectMode={true}
  onFilesSelected={(files) => console.log('Selected files:', files)}
  theme="light"
  onClose={() => navigation.goBack()}
/>
```

### Single File Selection
```tsx
<FileManagementScreen
  selectMode={true}
  allowMultipleSelection={false}
  maxSelectionCount={1}
  onFilesSelected={(files) => {
    const selectedFile = files[0];
    console.log('Selected file:', selectedFile);
  }}
  theme="light"
  onClose={() => navigation.goBack()}
/>
```

### Multiple File Selection with Limit
```tsx
<FileManagementScreen
  selectMode={true}
  allowMultipleSelection={true}
  maxSelectionCount={5}
  onFilesSelected={(files) => {
    console.log(`Selected ${files.length} files:`, files);
  }}
  theme="light"
  onClose={() => navigation.goBack()}
/>
```

## File Type Filtering

### Images Only
```tsx
<FileManagementScreen
  selectMode={true}
  allowedFileTypes={['image/*']}
  onFilesSelected={(files) => {
    // All selected files will be images
    files.forEach(file => console.log('Image file:', file.filename));
  }}
  theme="light"
  onClose={() => navigation.goBack()}
/>
```

### Specific File Types
```tsx
<FileManagementScreen
  selectMode={true}
  allowedFileTypes={['image/jpeg', 'image/png', 'application/pdf']}
  onFilesSelected={(files) => {
    console.log('Selected JPEG, PNG, or PDF files:', files);
  }}
  theme="light"
  onClose={() => navigation.goBack()}
/>
```

### File Extension Filtering
```tsx
<FileManagementScreen
  selectMode={true}
  allowedExtensions={['.jpg', '.png', '.gif']}
  onFilesSelected={(files) => {
    console.log('Selected image files:', files);
  }}
  theme="light"
  onClose={() => navigation.goBack()}
/>
```

## File Size Restrictions

### Limit File Size
```tsx
<FileManagementScreen
  selectMode={true}
  maxFileSize={5 * 1024 * 1024} // 5MB limit
  onFilesSelected={(files) => {
    console.log('Selected files (max 5MB each):', files);
  }}
  theme="light"
  onClose={() => navigation.goBack()}
/>
```

## Pre-selected Files

### Start with Files Already Selected
```tsx
<FileManagementScreen
  selectMode={true}
  preSelectedFiles={['file-id-1', 'file-id-2']}
  onFilesSelected={(files) => {
    console.log('Final selection:', files);
  }}
  theme="light"
  onClose={() => navigation.goBack()}
/>
```

## Real-world Examples

### Profile Picture Selection
```tsx
function ProfilePictureSelector({ onPictureSelected, onClose }) {
  return (
    <FileManagementScreen
      selectMode={true}
      allowMultipleSelection={false}
      allowedFileTypes={['image/*']}
      maxFileSize={2 * 1024 * 1024} // 2MB limit for profile pictures
      onFilesSelected={(files) => {
        if (files.length > 0) {
          onPictureSelected(files[0]);
        }
        onClose();
      }}
      theme="light"
      onClose={onClose}
    />
  );
}
```

### Document Attachment Selection
```tsx
function DocumentSelector({ onDocumentsSelected, onClose }) {
  return (
    <FileManagementScreen
      selectMode={true}
      allowMultipleSelection={true}
      maxSelectionCount={10}
      allowedFileTypes={['application/pdf', 'application/msword', 'text/*']}
      maxFileSize={10 * 1024 * 1024} // 10MB limit
      onFilesSelected={(files) => {
        onDocumentsSelected(files);
        onClose();
      }}
      theme="light"
      onClose={onClose}
    />
  );
}
```

### Photo Gallery Selection
```tsx
function PhotoGallerySelector({ onPhotosSelected, onClose }) {
  return (
    <FileManagementScreen
      selectMode={true}
      allowMultipleSelection={true}
      allowedFileTypes={['image/*']}
      allowedExtensions={['.jpg', '.jpeg', '.png', '.gif', '.webp']}
      onFilesSelected={(files) => {
        onPhotosSelected(files);
        onClose();
      }}
      theme="dark"
      onClose={onClose}
    />
  );
}
```

## Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `selectMode` | `boolean` | `false` | Enables select mode functionality |
| `allowMultipleSelection` | `boolean` | `true` | Allow selecting multiple files |
| `maxSelectionCount` | `number` | `undefined` | Maximum number of files that can be selected |
| `allowedFileTypes` | `string[]` | `undefined` | Allowed MIME types (supports wildcards like 'image/*') |
| `allowedExtensions` | `string[]` | `undefined` | Allowed file extensions (e.g., ['.jpg', '.png']) |
| `maxFileSize` | `number` | `undefined` | Maximum file size in bytes |
| `onFilesSelected` | `(files: FileMetadata[]) => void` | `undefined` | Callback when files are selected and "Done" is pressed |
| `preSelectedFiles` | `string[]` | `[]` | Array of file IDs that should be pre-selected |

## UI Changes in Select Mode

When `selectMode` is enabled, the following UI changes occur:

1. **Header**: Shows selection count and "Done" button
2. **File Items**: Display selection checkboxes
3. **Photo Grid**: Shows selection overlays with checkboxes
4. **Upload Button**: Hidden in select mode
5. **View Mode Toggle**: Hidden in select mode
6. **Empty States**: Updated to reflect selection context
7. **Error Messages**: Show selection constraint violations

## Error Handling

The component automatically handles and displays errors for:

- File type restrictions
- File size limits
- Selection count limits
- Invalid file selections

These errors are shown as temporary banners with appropriate messaging to guide the user.
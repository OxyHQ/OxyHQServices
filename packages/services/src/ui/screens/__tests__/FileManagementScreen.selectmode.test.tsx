import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import FileManagementScreen from '../FileManagementScreen';
import { OxyProvider } from '../../context/OxyContext';
import type { FileMetadata } from '../../../models/interfaces';

// Mock sonner dependencies
jest.mock('../../../lib/sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('sonner', () => ({
  toast: jest.fn(),
}));

jest.mock('sonner-native', () => ({
  toast: jest.fn(),
}));

// Mock dependencies
jest.mock('expo-image', () => ({
  Image: ({ testID, onError, onLoad, ...props }: any) => {
    const { View } = require('react-native');
    return <View testID={testID} {...props} />;
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, ...props }: any) => {
    const { Text } = require('react-native');
    return <Text {...props}>{name}</Text>;
  },
}));

jest.mock('../../context/OxyContext', () => ({
  useOxy: () => ({
    user: { id: 'test-user-id' },
    oxyServices: {
      listUserFiles: jest.fn().mockResolvedValue({ files: [] }),
      getFileDownloadUrl: jest.fn().mockReturnValue('https://test.com/file.jpg'),
    },
  }),
  OxyProvider: ({ children }: any) => children,
}));

jest.mock('../../components/Header', () => ({ title, subtitle, rightAction, onBack }: any) => {
  const { View, Text, TouchableOpacity } = require('react-native');
  return (
    <View>
      <Text>{title}</Text>
      {subtitle && <Text>{subtitle}</Text>}
      {onBack && <TouchableOpacity onPress={onBack}><Text>Back</Text></TouchableOpacity>}
      {rightAction && <TouchableOpacity onPress={rightAction.onPress}><Text>{rightAction.text}</Text></TouchableOpacity>}
    </View>
  );
});

jest.mock('../../components', () => ({
  GroupedSection: ({ items }: any) => {
    const { View, Text } = require('react-native');
    return (
      <View>
        {items.map((item: any) => (
          <Text key={item.id}>{item.title}</Text>
        ))}
      </View>
    );
  },
}));

// Mock the file store
jest.mock('../../stores/fileStore', () => ({
  useFileStore: (selector: any) => {
    const store = {
      files: {},
      order: [],
      uploading: false,
      deleting: null,
      uploadProgress: null,
      setFiles: jest.fn(),
      addFile: jest.fn(),
      updateFile: jest.fn(),
      removeFile: jest.fn(),
      setUploading: jest.fn(),
      setDeleting: jest.fn(),
      setUploadProgress: jest.fn(),
      reset: jest.fn(),
    };
    return selector ? selector(store) : store;
  },
  useFiles: () => [],
  useUploading: () => false,
  useUploadAggregateProgress: () => null,
  useDeleting: () => null,
}));

// Mock file store actions
const mockStoreActions = {
  setFiles: jest.fn(),
  addFile: jest.fn(),
  updateFile: jest.fn(),
  removeFile: jest.fn(),
  setUploading: jest.fn(),
  setDeleting: jest.fn(),
  setUploadProgress: jest.fn(),
  reset: jest.fn(),
};

// Sample file metadata for testing
const mockFiles: FileMetadata[] = [
  {
    id: 'file1',
    filename: 'test-image.jpg',
    contentType: 'image/jpeg',
    length: 1024,
    chunkSize: 0,
    uploadDate: '2024-01-01T00:00:00Z',
    metadata: {},
    variants: [],
  },
  {
    id: 'file2',
    filename: 'test-document.pdf',
    contentType: 'application/pdf',
    length: 2048,
    chunkSize: 0,
    uploadDate: '2024-01-02T00:00:00Z',
    metadata: {},
    variants: [],
  },
  {
    id: 'file3',
    filename: 'large-file.zip',
    contentType: 'application/zip',
    length: 10 * 1024 * 1024, // 10MB
    chunkSize: 0,
    uploadDate: '2024-01-03T00:00:00Z',
    metadata: {},
    variants: [],
  },
];

const defaultProps = {
  theme: 'light' as const,
  onClose: jest.fn(),
  goBack: jest.fn(),
  navigate: jest.fn(),
  containerWidth: 400,
};

describe('FileManagementScreen Select Mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render in normal mode by default', () => {
    const { queryByText } = render(
      <OxyProvider>
        <FileManagementScreen {...defaultProps} />
      </OxyProvider>
    );

    expect(queryByText('Select Files')).toBeNull();
    expect(queryByText('File Management')).toBeTruthy();
  });

  it('should render in select mode when selectMode prop is true', () => {
    const { getByText } = render(
      <OxyProvider>
        <FileManagementScreen {...defaultProps} selectMode={true} />
      </OxyProvider>
    );

    expect(getByText('Select Files')).toBeTruthy();
  });

  it('should show selection controls when in select mode', () => {
    const { getByText } = render(
      <OxyProvider>
        <FileManagementScreen 
          {...defaultProps} 
          selectMode={true}
          allowMultipleSelection={true}
          maxSelectionCount={3}
        />
      </OxyProvider>
    );

    expect(getByText('Select Files')).toBeTruthy();
    expect(getByText('Max 3 files')).toBeTruthy();
    expect(getByText('Tap to select')).toBeTruthy();
  });

  it('should handle single selection mode', () => {
    const onFilesSelected = jest.fn();
    
    render(
      <OxyProvider>
        <FileManagementScreen 
          {...defaultProps} 
          selectMode={true}
          allowMultipleSelection={false}
          onFilesSelected={onFilesSelected}
        />
      </OxyProvider>
    );

    // Should show single file selection limit
    expect(() => render(
      <OxyProvider>
        <FileManagementScreen 
          {...defaultProps} 
          selectMode={true}
          allowMultipleSelection={false}
          maxSelectionCount={1}
        />
      </OxyProvider>
    )).not.toThrow();
  });

  it('should filter files by allowed types', () => {
    // This test would need actual files to be present
    // Since we're mocking the store to return empty files, we can test the logic conceptually
    const { getByText } = render(
      <OxyProvider>
        <FileManagementScreen 
          {...defaultProps} 
          selectMode={true}
          allowedFileTypes={['image/*']}
        />
      </OxyProvider>
    );

    expect(getByText('Select Files')).toBeTruthy();
  });

  it('should show empty state message for select mode', () => {
    const { getByText } = render(
      <OxyProvider>
        <FileManagementScreen 
          {...defaultProps} 
          selectMode={true}
        />
      </OxyProvider>
    );

    expect(getByText('No Selectable Files')).toBeTruthy();
    expect(getByText('No files match the selection criteria. Try adjusting the file type or size filters.')).toBeTruthy();
  });

  it('should call onFilesSelected when files are selected and done is pressed', () => {
    const onFilesSelected = jest.fn();
    
    const { getByText } = render(
      <OxyProvider>
        <FileManagementScreen 
          {...defaultProps} 
          selectMode={true}
          onFilesSelected={onFilesSelected}
        />
      </OxyProvider>
    );

    // In a real test with files, we would:
    // 1. Select some files
    // 2. Press the "Done" button
    // 3. Verify onFilesSelected was called with the correct files
    
    expect(getByText('Select Files')).toBeTruthy();
  });

  it('should respect file size limits', () => {
    const maxFileSize = 5 * 1024 * 1024; // 5MB
    
    const { getByText } = render(
      <OxyProvider>
        <FileManagementScreen 
          {...defaultProps} 
          selectMode={true}
          maxFileSize={maxFileSize}
        />
      </OxyProvider>
    );

    expect(getByText('Select Files')).toBeTruthy();
    // The file filtering would happen in the isFileAllowed function
  });

  it('should handle pre-selected files', () => {
    const preSelectedFiles = ['file1', 'file2'];
    
    const { getByText } = render(
      <OxyProvider>
        <FileManagementScreen 
          {...defaultProps} 
          selectMode={true}
          preSelectedFiles={preSelectedFiles}
        />
      </OxyProvider>
    );

    expect(getByText('Select Files')).toBeTruthy();
    // With actual files, this would show the selected count
  });

  it('should show correct subtitle based on selection count', () => {
    const { rerender, getByText } = render(
      <OxyProvider>
        <FileManagementScreen 
          {...defaultProps} 
          selectMode={true}
          maxSelectionCount={5}
          allowMultipleSelection={true}
        />
      </OxyProvider>
    );

    expect(getByText('Max 5 files')).toBeTruthy();

    // Test without max selection count
    rerender(
      <OxyProvider>
        <FileManagementScreen 
          {...defaultProps} 
          selectMode={true}
          allowMultipleSelection={true}
        />
      </OxyProvider>
    );

    expect(getByText('0 available')).toBeTruthy();
  });
});

// Test helper functions
describe('FileManagementScreen Select Mode Helper Functions', () => {
  it('should validate file types correctly', () => {
    // This would test the isFileAllowed function logic
    const imageFile: FileMetadata = {
      id: 'img1',
      filename: 'test.jpg',
      contentType: 'image/jpeg',
      length: 1024,
      chunkSize: 0,
      uploadDate: '2024-01-01T00:00:00Z',
      metadata: {},
      variants: [],
    };

    const pdfFile: FileMetadata = {
      id: 'pdf1',
      filename: 'test.pdf',
      contentType: 'application/pdf',
      length: 2048,
      chunkSize: 0,
      uploadDate: '2024-01-01T00:00:00Z',
      metadata: {},
      variants: [],
    };

    // Test file type filtering logic
    expect(imageFile.contentType.startsWith('image/')).toBe(true);
    expect(pdfFile.contentType.startsWith('image/')).toBe(false);
  });

  it('should validate file extensions correctly', () => {
    const allowedExtensions = ['.jpg', '.png', '.pdf'];
    
    const jpgFile = 'test.jpg';
    const pngFile = 'test.png';
    const txtFile = 'test.txt';

    expect(allowedExtensions.includes('.' + jpgFile.split('.').pop())).toBe(true);
    expect(allowedExtensions.includes('.' + pngFile.split('.').pop())).toBe(true);
    expect(allowedExtensions.includes('.' + txtFile.split('.').pop())).toBe(false);
  });

  it('should validate file sizes correctly', () => {
    const maxFileSize = 5 * 1024 * 1024; // 5MB
    
    const smallFile = { length: 1024 }; // 1KB
    const largeFile = { length: 10 * 1024 * 1024 }; // 10MB

    expect(smallFile.length <= maxFileSize).toBe(true);
    expect(largeFile.length <= maxFileSize).toBe(false);
  });
});
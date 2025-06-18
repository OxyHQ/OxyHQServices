import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Platform,
    RefreshControl,
    Dimensions,
    Modal,
    TextInput,
    Image,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { Ionicons } from '@expo/vector-icons';
import { FileMetadata } from '../../models/interfaces';

interface FileManagementScreenProps extends BaseScreenProps {
    userId?: string;
}

const FileManagementScreen: React.FC<FileManagementScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
    userId,
    containerWidth = 400, // Fallback for when not provided by the router
}) => {
    const { user, oxyServices } = useOxy();
    
    // Debug: log the actual container width
    useEffect(() => {
        console.log('[FileManagementScreen] Container width (full):', containerWidth);
        // Padding structure:
        // - containerWidth = full bottom sheet container width (measured from OxyProvider)
        // - photoScrollContainer adds padding: 16 (32px total horizontal padding)
        // - Available content width = containerWidth - 32
        const availableContentWidth = containerWidth - 32;
        console.log('[FileManagementScreen] Available content width:', availableContentWidth);
        console.log('[FileManagementScreen] Spacing fix applied: 4px uniform gap both horizontal and vertical');
    }, [containerWidth]);
    const [files, setFiles] = useState<FileMetadata[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{current: number, total: number} | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);
    const [showFileDetails, setShowFileDetails] = useState(false);
    const [openedFile, setOpenedFile] = useState<FileMetadata | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [loadingFileContent, setLoadingFileContent] = useState(false);
    const [showFileDetailsInViewer, setShowFileDetailsInViewer] = useState(false);
    const [viewMode, setViewMode] = useState<'all' | 'photos'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [filteredFiles, setFilteredFiles] = useState<FileMetadata[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [photoDimensions, setPhotoDimensions] = useState<{[key: string]: {width: number, height: number}}>({});
    const [loadingDimensions, setLoadingDimensions] = useState(false);

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#f2f2f2';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#FFFFFF';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';
    const primaryColor = '#007AFF';
    const dangerColor = '#FF3B30';
    const successColor = '#34C759';

    const targetUserId = userId || user?.id;

    const loadFiles = useCallback(async (isRefresh = false) => {
        if (!targetUserId) return;

        try {
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            const response = await oxyServices.listUserFiles(targetUserId);
            setFiles(response.files || []);
        } catch (error: any) {
            console.error('Failed to load files:', error);
            toast.error(error.message || 'Failed to load files');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [targetUserId, oxyServices]);

    // Filter files based on search query and view mode
    useEffect(() => {
        let filteredByMode = files;
        
        // Filter by view mode first
        if (viewMode === 'photos') {
            filteredByMode = files.filter(file => file.contentType.startsWith('image/'));
        }
        
        // Then filter by search query
        if (!searchQuery.trim()) {
            setFilteredFiles(filteredByMode);
        } else {
            const query = searchQuery.toLowerCase();
            const filtered = filteredByMode.filter(file => 
                file.filename.toLowerCase().includes(query) ||
                file.contentType.toLowerCase().includes(query) ||
                (file.metadata?.description && file.metadata.description.toLowerCase().includes(query))
            );
            setFilteredFiles(filtered);
        }
    }, [files, searchQuery, viewMode]);

    // Load photo dimensions for justified grid
    const loadPhotoDimensions = useCallback(async (photos: FileMetadata[]) => {
        if (photos.length === 0) return;
        
        setLoadingDimensions(true);
        const newDimensions: {[key: string]: {width: number, height: number}} = { ...photoDimensions };
        let hasNewDimensions = false;

        // Only load dimensions for photos we don't have yet
        const photosToLoad = photos.filter(photo => !newDimensions[photo.id]);
        
        if (photosToLoad.length === 0) {
            setLoadingDimensions(false);
            return;
        }

        try {
            await Promise.all(
                photosToLoad.map(async (photo) => {
                    try {
                        const downloadUrl = oxyServices.getFileDownloadUrl(photo.id);
                        
                        if (Platform.OS === 'web') {
                            const img = new (window as any).Image();
                            await new Promise<void>((resolve, reject) => {
                                img.onload = () => {
                                    newDimensions[photo.id] = {
                                        width: img.naturalWidth,
                                        height: img.naturalHeight
                                    };
                                    hasNewDimensions = true;
                                    resolve();
                                };
                                img.onerror = () => {
                                    // Fallback dimensions for failed loads
                                    newDimensions[photo.id] = { width: 1, height: 1 };
                                    hasNewDimensions = true;
                                    resolve();
                                };
                                img.src = downloadUrl;
                            });
                        } else {
                            // For mobile, use Image.getSize from react-native
                            await new Promise<void>((resolve) => {
                                Image.getSize(
                                    downloadUrl,
                                    (width: number, height: number) => {
                                        newDimensions[photo.id] = { width, height };
                                        hasNewDimensions = true;
                                        resolve();
                                    },
                                    () => {
                                        // Fallback dimensions
                                        newDimensions[photo.id] = { width: 1, height: 1 };
                                        hasNewDimensions = true;
                                        resolve();
                                    }
                                );
                            });
                        }
                    } catch (error) {
                        // Fallback dimensions for any errors
                        newDimensions[photo.id] = { width: 1, height: 1 };
                        hasNewDimensions = true;
                    }
                })
            );

            if (hasNewDimensions) {
                setPhotoDimensions(newDimensions);
            }
        } catch (error) {
            console.error('Error loading photo dimensions:', error);
        } finally {
            setLoadingDimensions(false);
        }
    }, [oxyServices, photoDimensions]);

    // Create justified rows from photos with responsive algorithm
    const createJustifiedRows = useCallback((photos: FileMetadata[]) => {
        if (photos.length === 0) return [];
        
        const rows: FileMetadata[][] = [];
        const photosPerRow = 3; // Fixed 3 photos per row for consistency
        
        for (let i = 0; i < photos.length; i += photosPerRow) {
            const rowPhotos = photos.slice(i, i + photosPerRow);
            rows.push(rowPhotos);
        }
        
        return rows;
    }, []);

    const processFileUploads = async (selectedFiles: File[]) => {
        if (selectedFiles.length === 0) return;

        try {
            // Show initial progress
            setUploadProgress({ current: 0, total: selectedFiles.length });
            
            // Validate file sizes (example: 50MB limit per file)
            const maxSize = 50 * 1024 * 1024; // 50MB
            const oversizedFiles = selectedFiles.filter(file => file.size > maxSize);
            
            if (oversizedFiles.length > 0) {
                const fileList = oversizedFiles.map(f => f.name).join('\n');
                window.alert(`File Size Limit\n\nThe following files are too large (max 50MB):\n${fileList}`);
                return;
            }

            // Option 1: Bulk upload (faster, all-or-nothing) for 5 or fewer files
            if (selectedFiles.length <= 5) {
                const filenames = selectedFiles.map(f => f.name);
                const response = await oxyServices.uploadFiles(
                    selectedFiles, 
                    filenames, 
                    {
                        userId: targetUserId,
                        uploadDate: new Date().toISOString(),
                    }
                );

                toast.success(`${response.files.length} file(s) uploaded successfully`);
                // Small delay to ensure backend processing is complete
                setTimeout(async () => {
                    await loadFiles();
                }, 500);
            } else {
                // Option 2: Individual uploads for better progress and error handling
                let successCount = 0;
                let failureCount = 0;
                const errors: string[] = [];

                for (let i = 0; i < selectedFiles.length; i++) {
                    const file = selectedFiles[i];
                    setUploadProgress({ current: i + 1, total: selectedFiles.length });

                    try {
                        await oxyServices.uploadFile(file, file.name, {
                            userId: targetUserId,
                            uploadDate: new Date().toISOString(),
                        });
                        successCount++;
                    } catch (error: any) {
                        failureCount++;
                        errors.push(`${file.name}: ${error.message || 'Upload failed'}`);
                    }
                }

                // Show results summary
                if (successCount > 0) {
                    toast.success(`${successCount} file(s) uploaded successfully`);
                }
                
                if (failureCount > 0) {
                    const errorMessage = `${failureCount} file(s) failed to upload${errors.length > 0 ? ':\n' + errors.slice(0, 3).join('\n') + (errors.length > 3 ? '\n...' : '') : ''}`;
                    toast.error(errorMessage);
                }

                // Small delay to ensure backend processing is complete
                setTimeout(async () => {
                    await loadFiles();
                }, 500);
            }
        } catch (error: any) {
            console.error('Upload error:', error);
            toast.error(error.message || 'Failed to upload files');
        } finally {
            setUploadProgress(null);
        }
    };

    const handleFileUpload = async () => {
        try {
            setUploading(true);
            setUploadProgress(null);

            if (Platform.OS === 'web') {
                // Web file picker implementation
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.accept = '*/*';
                
                input.onchange = async (e: any) => {
                    const selectedFiles = Array.from(e.target.files) as File[];
                    await processFileUploads(selectedFiles);
                };

                input.click();
            } else {
                // Mobile - show info that file picker can be added
                const installCommand = 'npm install expo-document-picker';
                const message = `Mobile File Upload\n\nTo enable file uploads on mobile, install expo-document-picker:\n\n${installCommand}\n\nThen import and use DocumentPicker.getDocumentAsync() in this method.`;
                
                if (window.confirm(`${message}\n\nWould you like to copy the install command?`)) {
                    toast.info(`Install: ${installCommand}`);
                } else {
                    toast.info('Mobile file upload requires expo-document-picker');
                }
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to upload file');
        } finally {
            setUploading(false);
            setUploadProgress(null);
        }
    };

    const handleFileDelete = async (fileId: string, filename: string) => {
        // Use web-compatible confirmation dialog
        const confirmed = window.confirm(`Are you sure you want to delete "${filename}"? This action cannot be undone.`);
        
        if (!confirmed) {
            console.log('Delete cancelled by user');
            return;
        }

        try {
            console.log('Deleting file:', { fileId, filename });
            console.log('Target user ID:', targetUserId);
            console.log('Current user ID:', user?.id);
            setDeleting(fileId);
            
            const result = await oxyServices.deleteFile(fileId);
            console.log('Delete result:', result);
            
            toast.success('File deleted successfully');
            
            // Reload files after successful deletion
            setTimeout(async () => {
                await loadFiles();
            }, 500);
        } catch (error: any) {
            console.error('Delete error:', error);
            console.error('Error details:', error.response?.data || error.message);
            
            // Provide specific error messages
            if (error.message?.includes('File not found') || error.message?.includes('404')) {
                toast.error('File not found. It may have already been deleted.');
                // Still reload files to refresh the list
                setTimeout(async () => {
                    await loadFiles();
                }, 500);
            } else if (error.message?.includes('permission') || error.message?.includes('403')) {
                toast.error('You do not have permission to delete this file.');
            } else {
                toast.error(error.message || 'Failed to delete file');
            }
        } finally {
            setDeleting(null);
        }
    };

    // Drag and drop handlers for web
    const handleDragOver = (e: any) => {
        if (Platform.OS === 'web' && user?.id === targetUserId) {
            e.preventDefault();
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e: any) => {
        if (Platform.OS === 'web') {
            e.preventDefault();
            setIsDragging(false);
        }
    };

    const handleDrop = async (e: any) => {
        if (Platform.OS === 'web' && user?.id === targetUserId) {
            e.preventDefault();
            setIsDragging(false);
            setUploading(true);

            try {
                const files = Array.from(e.dataTransfer.files) as File[];
                await processFileUploads(files);
            } catch (error: any) {
                toast.error(error.message || 'Failed to upload files');
            } finally {
                setUploading(false);
            }
        }
    };

    const handleFileDownload = async (fileId: string, filename: string) => {
        try {
            if (Platform.OS === 'web') {
                console.log('Downloading file:', { fileId, filename });
                
                // Use the public download URL method
                const downloadUrl = oxyServices.getFileDownloadUrl(fileId);
                console.log('Download URL:', downloadUrl);
                
                try {
                    // Method 1: Try simple link download first
                    const link = document.createElement('a');
                    link.href = downloadUrl;
                    link.download = filename;
                    link.target = '_blank';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    toast.success('File download started');
                } catch (linkError) {
                    console.warn('Link download failed, trying fetch method:', linkError);
                    
                    // Method 2: Fallback to fetch download
                    const response = await fetch(downloadUrl);
                    if (!response.ok) {
                        if (response.status === 404) {
                            throw new Error('File not found. It may have been deleted.');
                        } else {
                            throw new Error(`Download failed: ${response.status} ${response.statusText}`);
                        }
                    }
                    
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    // Clean up the blob URL
                    window.URL.revokeObjectURL(url);
                    
                    toast.success('File downloaded successfully');
                }
            } else {
                toast.info('File download not implemented for mobile yet');
            }
        } catch (error: any) {
            console.error('Download error:', error);
            toast.error(error.message || 'Failed to download file');
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const getFileIcon = (contentType: string): string => {
        if (contentType.startsWith('image/')) return 'image';
        if (contentType.startsWith('video/')) return 'videocam';
        if (contentType.startsWith('audio/')) return 'musical-notes';
        if (contentType.includes('pdf')) return 'document-text';
        if (contentType.includes('word') || contentType.includes('doc')) return 'document';
        if (contentType.includes('excel') || contentType.includes('sheet')) return 'grid';
        if (contentType.includes('zip') || contentType.includes('archive')) return 'archive';
        return 'document-outline';
    };

    const handleFileOpen = async (file: FileMetadata) => {
        try {
            setLoadingFileContent(true);
            setOpenedFile(file);
            
            // For text files, images, and other viewable content, try to load the content
            if (file.contentType.startsWith('text/') || 
                file.contentType.includes('json') || 
                file.contentType.includes('xml') ||
                file.contentType.includes('javascript') ||
                file.contentType.includes('typescript') ||
                file.contentType.startsWith('image/') ||
                file.contentType.includes('pdf') ||
                file.contentType.startsWith('video/') ||
                file.contentType.startsWith('audio/')) {
                
                try {
                    const downloadUrl = oxyServices.getFileDownloadUrl(file.id);
                    const response = await fetch(downloadUrl);
                    
                    if (response.ok) {
                        if (file.contentType.startsWith('image/') || 
                            file.contentType.includes('pdf') ||
                            file.contentType.startsWith('video/') ||
                            file.contentType.startsWith('audio/')) {
                            // For images, PDFs, videos, and audio, we'll use the URL directly
                            setFileContent(downloadUrl);
                        } else {
                            // For text files, get the content
                            const content = await response.text();
                            setFileContent(content);
                        }
                    } else {
                        if (response.status === 404) {
                            toast.error('File not found. It may have been deleted.');
                        } else {
                            toast.error(`Failed to load file: ${response.status} ${response.statusText}`);
                        }
                        setFileContent(null);
                    }
                } catch (error: any) {
                    console.error('Failed to load file content:', error);
                    if (error.message?.includes('404') || error.message?.includes('not found')) {
                        toast.error('File not found. It may have been deleted.');
                    } else {
                        toast.error('Failed to load file content');
                    }
                    setFileContent(null);
                }
            } else {
                // For non-viewable files, don't load content
                setFileContent(null);
            }
        } catch (error: any) {
            console.error('Failed to open file:', error);
            toast.error(error.message || 'Failed to open file');
        } finally {
            setLoadingFileContent(false);
        }
    };

    const handleCloseFile = () => {
        setOpenedFile(null);
        setFileContent(null);
        setShowFileDetailsInViewer(false);
        // Don't reset view mode when closing a file
    };

    const showFileDetailsModal = (file: FileMetadata) => {
        setSelectedFile(file);
        setShowFileDetails(true);
    };

    const renderSimplePhotoItem = useCallback((photo: FileMetadata, index: number) => {
        const downloadUrl = oxyServices.getFileDownloadUrl(photo.id);
        
        // Calculate photo item width based on actual container size from bottom sheet
        let itemsPerRow = 3; // Default for mobile
        if (containerWidth > 768) itemsPerRow = 4; // Desktop/tablet
        else if (containerWidth > 480) itemsPerRow = 3; // Large mobile
        
        // Account for the photoScrollContainer padding (16px on each side = 32px total)
        const scrollContainerPadding = 32; // Total horizontal padding from photoScrollContainer
        const gaps = (itemsPerRow - 1) * 4; // Gap between items (4px)
        const availableWidth = containerWidth - scrollContainerPadding;
        const itemWidth = (availableWidth - gaps) / itemsPerRow;
        
        return (
            <TouchableOpacity
                key={photo.id}
                style={[
                    styles.simplePhotoItem,
                    {
                        width: itemWidth,
                        height: itemWidth,
                        marginRight: (index + 1) % itemsPerRow === 0 ? 0 : 4,
                    }
                ]}
                onPress={() => handleFileOpen(photo)}
                activeOpacity={0.8}
            >
                <View style={styles.simplePhotoContainer}>
                    {Platform.OS === 'web' ? (
                        <img
                            src={downloadUrl}
                            alt={photo.filename}
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                borderRadius: 8,
                                transition: 'transform 0.2s ease',
                            }}
                            loading="lazy"
                            onError={(e) => {
                                console.error('Photo failed to load:', e);
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'scale(1.05)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'scale(1)';
                            }}
                        />
                    ) : (
                        <Image
                            source={{ uri: downloadUrl }}
                            style={styles.simplePhotoImage}
                            resizeMode="cover"
                            onError={(e) => {
                                console.error('Photo failed to load:', e);
                            }}
                        />
                    )}
                </View>
            </TouchableOpacity>
        );
    }, [oxyServices, containerWidth]);

    const renderJustifiedPhotoItem = useCallback((photo: FileMetadata, width: number, height: number, isLast: boolean) => {
        const downloadUrl = oxyServices.getFileDownloadUrl(photo.id);
        
        return (
            <TouchableOpacity
                key={photo.id}
                style={[
                    styles.justifiedPhotoItem,
                    {
                        width,
                        height,
                    }
                ]}
                onPress={() => handleFileOpen(photo)}
                activeOpacity={0.8}
            >
                <View style={styles.justifiedPhotoContainer}>
                    {Platform.OS === 'web' ? (
                        <img
                            src={downloadUrl}
                            alt={photo.filename}
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                borderRadius: 6,
                                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                            }}
                            loading="lazy"
                            onError={(e) => {
                                console.error('Photo failed to load:', e);
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'scale(1.02)';
                                e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
                                e.currentTarget.style.zIndex = '10';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'scale(1)';
                                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                                e.currentTarget.style.zIndex = '1';
                            }}
                        />
                    ) : (
                        <Image
                            source={{ uri: downloadUrl }}
                            style={styles.justifiedPhotoImage}
                            resizeMode="cover"
                            onError={(e) => {
                                console.error('Photo failed to load:', e);
                            }}
                        />
                    )}
                </View>
            </TouchableOpacity>
        );
    }, [oxyServices]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    const renderFileItem = (file: FileMetadata) => {
        return (
            <View
                key={file.id}
                style={[styles.fileItem, { backgroundColor: secondaryBackgroundColor, borderColor }]}
            >
                <TouchableOpacity
                    style={styles.fileContent}
                    onPress={() => handleFileOpen(file)}
                >
                    <View style={styles.fileIconContainer}>
                        <Ionicons
                            name={getFileIcon(file.contentType) as any}
                            size={32}
                            color={primaryColor}
                        />
                    </View>
                    
                    <View style={styles.fileInfo}>
                        <Text style={[styles.fileName, { color: textColor }]} numberOfLines={1}>
                            {file.filename}
                        </Text>
                        <Text style={[styles.fileDetails, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {formatFileSize(file.length)} • {new Date(file.uploadDate).toLocaleDateString()}
                        </Text>
                        {file.metadata?.description && (
                            <Text
                                style={[styles.fileDescription, { color: isDarkTheme ? '#AAAAAA' : '#888888' }]}
                                numberOfLines={2}
                            >
                                {file.metadata.description}
                            </Text>
                        )}
                    </View>
                </TouchableOpacity>

                <View style={styles.fileActions}>
                    <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: isDarkTheme ? '#333333' : '#F0F0F0' }]}
                        onPress={() => handleFileDownload(file.id, file.filename)}
                    >
                        <Ionicons name="download" size={20} color={primaryColor} />
                    </TouchableOpacity>

                    {/* Always show delete button for debugging */}
                    <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: isDarkTheme ? '#400000' : '#FFEBEE' }]}
                        onPress={() => {
                            handleFileDelete(file.id, file.filename);
                        }}
                        disabled={deleting === file.id}
                    >
                        {deleting === file.id ? (
                            <ActivityIndicator size="small" color={dangerColor} />
                        ) : (
                            <Ionicons name="trash" size={20} color={dangerColor} />
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderPhotoGrid = useCallback(() => {
        const photos = filteredFiles.filter(file => file.contentType.startsWith('image/'));
        
        if (photos.length === 0) {
            return (
                <View style={styles.emptyState}>
                    <Ionicons name="images-outline" size={64} color={isDarkTheme ? '#666666' : '#CCCCCC'} />
                    <Text style={[styles.emptyStateTitle, { color: textColor }]}>No Photos Yet</Text>
                    <Text style={[styles.emptyStateDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                        {user?.id === targetUserId 
                            ? `Upload photos to get started. You can select multiple photos at once${Platform.OS === 'web' ? ' or drag & drop them here.' : '.'}`
                            : "This user hasn't uploaded any photos yet"
                        }
                    </Text>
                    {user?.id === targetUserId && (
                        <TouchableOpacity
                            style={[styles.emptyStateButton, { backgroundColor: primaryColor }]}
                            onPress={handleFileUpload}
                            disabled={uploading}
                        >
                            {uploading ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                                <>
                                    <Ionicons name="cloud-upload" size={20} color="#FFFFFF" />
                                    <Text style={styles.emptyStateButtonText}>Upload Photos</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    )}
                </View>
            );
        }

        return (
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.photoScrollContainer}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => loadFiles(true)}
                        tintColor={primaryColor}
                    />
                }
                showsVerticalScrollIndicator={false}
            >
                {loadingDimensions && (
                    <View style={styles.dimensionsLoadingIndicator}>
                        <ActivityIndicator size="small" color={primaryColor} />
                        <Text style={[styles.dimensionsLoadingText, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            Loading photo layout...
                        </Text>
                    </View>
                )}
                
                <JustifiedPhotoGrid 
                    photos={photos}
                    photoDimensions={photoDimensions}
                    loadPhotoDimensions={loadPhotoDimensions}
                    createJustifiedRows={createJustifiedRows}
                    renderJustifiedPhotoItem={renderJustifiedPhotoItem}
                    renderSimplePhotoItem={renderPhotoItem}
                    textColor={textColor}
                    containerWidth={containerWidth}
                />
            </ScrollView>
        );
    }, [filteredFiles, isDarkTheme, textColor, user?.id, targetUserId, uploading, primaryColor, handleFileUpload, refreshing, loadFiles, loadingDimensions, photoDimensions, loadPhotoDimensions, createJustifiedRows, renderJustifiedPhotoItem]);

    // Separate component for the photo grid to optimize rendering
    const JustifiedPhotoGrid = React.memo(({ 
        photos, 
        photoDimensions, 
        loadPhotoDimensions, 
        createJustifiedRows, 
        renderJustifiedPhotoItem, 
        renderSimplePhotoItem, 
        textColor,
        containerWidth
    }: {
        photos: FileMetadata[];
        photoDimensions: {[key: string]: {width: number, height: number}};
        loadPhotoDimensions: (photos: FileMetadata[]) => Promise<void>;
        createJustifiedRows: (photos: FileMetadata[], containerWidth: number) => FileMetadata[][];
        renderJustifiedPhotoItem: (photo: FileMetadata, width: number, height: number, isLast: boolean) => JSX.Element;
        renderSimplePhotoItem: (photo: FileMetadata, index: number) => JSX.Element;
        textColor: string;
        containerWidth: number;
    }) => {
        // Load dimensions for new photos
        React.useEffect(() => {
            loadPhotoDimensions(photos);
        }, [photos.map(p => p.id).join(','), loadPhotoDimensions]);

        // Group photos by date
        const photosByDate = React.useMemo(() => {
            return photos.reduce((groups: {[key: string]: FileMetadata[]}, photo) => {
                const date = new Date(photo.uploadDate).toDateString();
                if (!groups[date]) {
                    groups[date] = [];
                }
                groups[date].push(photo);
                return groups;
            }, {});
        }, [photos]);

        const sortedDates = React.useMemo(() => {
            return Object.keys(photosByDate).sort((a, b) => 
                new Date(b).getTime() - new Date(a).getTime()
            );
        }, [photosByDate]);

        return (
            <>
                {sortedDates.map(date => {
                    const dayPhotos = photosByDate[date];
                    const justifiedRows = createJustifiedRows(dayPhotos, containerWidth);
                    
                    return (
                        <View key={date} style={styles.photoDateSection}>
                            <Text style={[styles.photoDateHeader, { color: textColor }]}>
                                {new Date(date).toLocaleDateString('en-US', { 
                                    weekday: 'long', 
                                    year: 'numeric', 
                                    month: 'long', 
                                    day: 'numeric' 
                                })}
                            </Text>
                            <View style={styles.justifiedPhotoGrid}>
                                {justifiedRows.map((row, rowIndex) => {
                                    // Calculate row height based on available width
                                    const gap = 4;
                                    let totalAspectRatio = 0;
                                    
                                    // Calculate total aspect ratio for this row
                                    row.forEach(photo => {
                                        const dimensions = photoDimensions[photo.id];
                                        const aspectRatio = dimensions ? 
                                            (dimensions.width / dimensions.height) : 
                                            1.33; // Default 4:3 ratio
                                        totalAspectRatio += aspectRatio;
                                    });
                                    
                                    // Calculate the height that makes the row fill the available width
                                    // Account for photoScrollContainer padding (32px total) and gaps between photos
                                    const scrollContainerPadding = 32;
                                    const availableWidth = containerWidth - scrollContainerPadding - (gap * (row.length - 1));
                                    const calculatedHeight = availableWidth / totalAspectRatio;
                                    
                                    // Clamp height for visual consistency
                                    const rowHeight = Math.max(120, Math.min(calculatedHeight, 300));
                                    
                                    return (
                                        <View 
                                            key={`row-${rowIndex}`} 
                                            style={[
                                                styles.justifiedPhotoRow, 
                                                { 
                                                    height: rowHeight,
                                                    maxWidth: containerWidth - 32, // Account for scroll container padding
                                                    gap: 4, // Add horizontal gap between photos in row
                                                }
                                            ]}
                                        >
                                            {row.map((photo, photoIndex) => {
                                                const dimensions = photoDimensions[photo.id];
                                                const aspectRatio = dimensions ? 
                                                    (dimensions.width / dimensions.height) : 
                                                    1.33; // Default 4:3 ratio
                                                
                                                const photoWidth = rowHeight * aspectRatio;
                                                const isLast = photoIndex === row.length - 1;
                                                
                                                return renderJustifiedPhotoItem(
                                                    photo, 
                                                    photoWidth, 
                                                    rowHeight, 
                                                    isLast
                                                );
                                            })}
                                        </View>
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}
            </>
        );
    });

    const renderPhotoItem = (photo: FileMetadata, index: number) => {
        const downloadUrl = oxyServices.getFileDownloadUrl(photo.id);
        
        // Calculate photo item width based on actual container size from bottom sheet
        let itemsPerRow = 3; // Default for mobile
        if (containerWidth > 768) itemsPerRow = 6; // Tablet/Desktop
        else if (containerWidth > 480) itemsPerRow = 4; // Large mobile
        
        // Account for the photoScrollContainer padding (16px on each side = 32px total)
        const scrollContainerPadding = 32; // Total horizontal padding from photoScrollContainer
        const gaps = (itemsPerRow - 1) * 4; // Gap between items
        const availableWidth = containerWidth - scrollContainerPadding;
        const itemWidth = (availableWidth - gaps) / itemsPerRow;
        
        return (
            <TouchableOpacity
                key={photo.id}
                style={[
                    styles.photoItem,
                    {
                        width: itemWidth,
                        height: itemWidth,
                    }
                ]}
                onPress={() => handleFileOpen(photo)}
                activeOpacity={0.8}
            >
                <View style={styles.photoContainer}>
                    {Platform.OS === 'web' ? (
                        <img
                            src={downloadUrl}
                            alt={photo.filename}
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                borderRadius: 8,
                                transition: 'transform 0.2s ease',
                            }}
                            loading="lazy"
                            onError={(e) => {
                                console.error('Photo failed to load:', e);
                                // Could replace with placeholder image
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'scale(1.02)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'scale(1)';
                            }}
                        />
                    ) : (
                        <Image
                            source={{ uri: downloadUrl }}
                            style={styles.photoImage}
                            resizeMode="cover"
                            onError={(e) => {
                                console.error('Photo failed to load:', e);
                            }}
                        />
                    )}
                </View>
            </TouchableOpacity>
        );
    };

    const renderFileDetailsModal = () => (
        <Modal
            visible={showFileDetails}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setShowFileDetails(false)}
        >
            <View style={[styles.modalContainer, { backgroundColor }]}>
                <View style={[styles.modalHeader, { borderBottomColor: borderColor }]}>
                    <TouchableOpacity
                        style={styles.modalCloseButton}
                        onPress={() => setShowFileDetails(false)}
                    >
                        <Ionicons name="close" size={24} color={textColor} />
                    </TouchableOpacity>
                    <Text style={[styles.modalTitle, { color: textColor }]}>File Details</Text>
                    <View style={styles.modalPlaceholder} />
                </View>

                {selectedFile && (
                    <ScrollView style={styles.modalContent}>
                        <View style={[styles.fileDetailCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                            <View style={styles.fileDetailIcon}>
                                <Ionicons
                                    name={getFileIcon(selectedFile.contentType) as any}
                                    size={64}
                                    color={primaryColor}
                                />
                            </View>

                            <Text style={[styles.fileDetailName, { color: textColor }]}>
                                {selectedFile.filename}
                            </Text>

                            <View style={styles.fileDetailInfo}>
                                <View style={styles.detailRow}>
                                    <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        Size:
                                    </Text>
                                    <Text style={[styles.detailValue, { color: textColor }]}>
                                        {formatFileSize(selectedFile.length)}
                                    </Text>
                                </View>

                                <View style={styles.detailRow}>
                                    <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        Type:
                                    </Text>
                                    <Text style={[styles.detailValue, { color: textColor }]}>
                                        {selectedFile.contentType}
                                    </Text>
                                </View>

                                <View style={styles.detailRow}>
                                    <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        Uploaded:
                                    </Text>
                                    <Text style={[styles.detailValue, { color: textColor }]}>
                                        {new Date(selectedFile.uploadDate).toLocaleString()}
                                    </Text>
                                </View>

                                {selectedFile.metadata?.description && (
                                    <View style={styles.detailRow}>
                                        <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                            Description:
                                        </Text>
                                        <Text style={[styles.detailValue, { color: textColor }]}>
                                            {selectedFile.metadata.description}
                                        </Text>
                                    </View>
                                )}
                            </View>

                            <View style={styles.modalActions}>
                                <TouchableOpacity
                                    style={[styles.modalActionButton, { backgroundColor: primaryColor }]}
                                    onPress={() => {
                                        handleFileDownload(selectedFile.id, selectedFile.filename);
                                        setShowFileDetails(false);
                                    }}
                                >
                                    <Ionicons name="download" size={20} color="#FFFFFF" />
                                    <Text style={styles.modalActionText}>Download</Text>
                                </TouchableOpacity>

                                {(user?.id === targetUserId) && (
                                    <TouchableOpacity
                                        style={[styles.modalActionButton, { backgroundColor: dangerColor }]}
                                        onPress={() => {
                                            setShowFileDetails(false);
                                            handleFileDelete(selectedFile.id, selectedFile.filename);
                                        }}
                                    >
                                        <Ionicons name="trash" size={20} color="#FFFFFF" />
                                        <Text style={styles.modalActionText}>Delete</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    </ScrollView>
                )}
            </View>
        </Modal>
    );

    const renderFileViewer = () => {
        if (!openedFile) return null;

        const isImage = openedFile.contentType.startsWith('image/');
        const isText = openedFile.contentType.startsWith('text/') || 
                      openedFile.contentType.includes('json') || 
                      openedFile.contentType.includes('xml') ||
                      openedFile.contentType.includes('javascript') ||
                      openedFile.contentType.includes('typescript');
        const isPDF = openedFile.contentType.includes('pdf');
        const isVideo = openedFile.contentType.startsWith('video/');
        const isAudio = openedFile.contentType.startsWith('audio/');

        return (
            <View style={[styles.fileViewerContainer, { backgroundColor }]}>
                {/* File Viewer Header */}
                <View style={[styles.fileViewerHeader, { borderBottomColor: borderColor }]}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={handleCloseFile}
                    >
                        <Ionicons name="arrow-back" size={24} color={textColor} />
                    </TouchableOpacity>
                    <View style={styles.fileViewerTitleContainer}>
                        <Text style={[styles.fileViewerTitle, { color: textColor }]} numberOfLines={1}>
                            {openedFile.filename}
                        </Text>
                        <Text style={[styles.fileViewerSubtitle, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {formatFileSize(openedFile.length)} • {openedFile.contentType}
                        </Text>
                    </View>
                    <View style={styles.fileViewerActions}>
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: isDarkTheme ? '#333333' : '#F0F0F0' }]}
                            onPress={() => handleFileDownload(openedFile.id, openedFile.filename)}
                        >
                            <Ionicons name="download" size={20} color={primaryColor} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.actionButton, 
                                { 
                                    backgroundColor: showFileDetailsInViewer 
                                        ? primaryColor 
                                        : (isDarkTheme ? '#333333' : '#F0F0F0') 
                                }
                            ]}
                            onPress={() => setShowFileDetailsInViewer(!showFileDetailsInViewer)}
                        >
                            <Ionicons 
                                name={showFileDetailsInViewer ? "chevron-up" : "information-circle"} 
                                size={20} 
                                color={showFileDetailsInViewer ? "#FFFFFF" : primaryColor} 
                            />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* File Details Section */}
                {showFileDetailsInViewer && (
                    <View style={[styles.fileDetailsSection, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                        <View style={styles.fileDetailsSectionHeader}>
                            <Text style={[styles.fileDetailsSectionTitle, { color: textColor }]}>
                                File Details
                            </Text>
                            <TouchableOpacity
                                style={styles.fileDetailsSectionToggle}
                                onPress={() => setShowFileDetailsInViewer(false)}
                            >
                                <Ionicons name="chevron-up" size={20} color={isDarkTheme ? '#BBBBBB' : '#666666'} />
                            </TouchableOpacity>
                        </View>
                        
                        <View style={styles.fileDetailInfo}>
                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    File Name:
                                </Text>
                                <Text style={[styles.detailValue, { color: textColor }]}>
                                    {openedFile.filename}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Size:
                                </Text>
                                <Text style={[styles.detailValue, { color: textColor }]}>
                                    {formatFileSize(openedFile.length)}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Type:
                                </Text>
                                <Text style={[styles.detailValue, { color: textColor }]}>
                                    {openedFile.contentType}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Uploaded:
                                </Text>
                                <Text style={[styles.detailValue, { color: textColor }]}>
                                    {new Date(openedFile.uploadDate).toLocaleString()}
                                </Text>
                            </View>

                            {openedFile.metadata?.description && (
                                <View style={styles.detailRow}>
                                    <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        Description:
                                    </Text>
                                    <Text style={[styles.detailValue, { color: textColor }]}>
                                        {openedFile.metadata.description}
                                    </Text>
                                </View>
                            )}

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    File ID:
                                </Text>
                                <Text style={[styles.detailValue, { color: textColor, fontSize: 12, fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier' }]}>
                                    {openedFile.id}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.fileDetailsActions}>
                            <TouchableOpacity
                                style={[styles.fileDetailsActionButton, { backgroundColor: primaryColor }]}
                                onPress={() => handleFileDownload(openedFile.id, openedFile.filename)}
                            >
                                <Ionicons name="download" size={16} color="#FFFFFF" />
                                <Text style={styles.fileDetailsActionText}>Download</Text>
                            </TouchableOpacity>

                            {(user?.id === targetUserId) && (
                                <TouchableOpacity
                                    style={[styles.fileDetailsActionButton, { backgroundColor: dangerColor }]}
                                    onPress={() => {
                                        handleCloseFile();
                                        handleFileDelete(openedFile.id, openedFile.filename);
                                    }}
                                >
                                    <Ionicons name="trash" size={16} color="#FFFFFF" />
                                    <Text style={styles.fileDetailsActionText}>Delete</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                )}

                {/* File Content */}
                <ScrollView 
                    style={[
                        styles.fileViewerContent,
                        showFileDetailsInViewer && styles.fileViewerContentWithDetails
                    ]} 
                    contentContainerStyle={styles.fileViewerContentContainer}
                >
                    {loadingFileContent ? (
                        <View style={styles.fileViewerLoading}>
                            <ActivityIndicator size="large" color={primaryColor} />
                            <Text style={[styles.fileViewerLoadingText, { color: textColor }]}>
                                Loading file content...
                            </Text>
                        </View>
                    ) : isImage && fileContent ? (
                        <View style={styles.imageContainer}>
                            {Platform.OS === 'web' ? (
                                <img 
                                    src={fileContent} 
                                    alt={openedFile.filename}
                                    style={{
                                        maxWidth: '100%',
                                        maxHeight: '80vh',
                                        objectFit: 'contain',
                                        borderRadius: 8,
                                    }}
                                    onError={(e) => {
                                        console.error('Image failed to load:', e);
                                    }}
                                />
                            ) : (
                                <Image
                                    source={{ uri: fileContent }}
                                    style={{
                                        width: '100%',
                                        height: 400,
                                        resizeMode: 'contain',
                                        borderRadius: 8,
                                    }}
                                    onError={(e) => {
                                        console.error('Image failed to load:', e);
                                    }}
                                />
                            )}
                        </View>
                    ) : isText && fileContent ? (
                        <View style={[styles.textContainer, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                            <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
                                <Text style={[styles.textContent, { color: textColor }]}>
                                    {fileContent}
                                </Text>
                            </ScrollView>
                        </View>
                    ) : isPDF && fileContent && Platform.OS === 'web' ? (
                        <View style={styles.pdfContainer}>
                            <iframe
                                src={fileContent}
                                width="100%"
                                height="600px"
                                style={{ border: 'none', borderRadius: 8 }}
                                title={openedFile.filename}
                            />
                        </View>
                    ) : isVideo && fileContent ? (
                        <View style={styles.mediaContainer}>
                            {Platform.OS === 'web' ? (
                                <video
                                    controls
                                    style={{
                                        width: '100%',
                                        maxHeight: '70vh',
                                        borderRadius: 8,
                                    }}
                                >
                                    <source src={fileContent} type={openedFile.contentType} />
                                    Your browser does not support the video tag.
                                </video>
                            ) : (
                                <Text style={[styles.unsupportedText, { color: textColor }]}>
                                    Video playback not supported on mobile
                                </Text>
                            )}
                        </View>
                    ) : isAudio && fileContent ? (
                        <View style={styles.mediaContainer}>
                            {Platform.OS === 'web' ? (
                                <audio
                                    controls
                                    style={{
                                        width: '100%',
                                        borderRadius: 8,
                                    }}
                                >
                                    <source src={fileContent} type={openedFile.contentType} />
                                    Your browser does not support the audio tag.
                                </audio>
                            ) : (
                                <Text style={[styles.unsupportedText, { color: textColor }]}>
                                    Audio playback not supported on mobile
                                </Text>
                            )}
                        </View>
                    ) : (
                        <View style={styles.unsupportedFileContainer}>
                            <Ionicons 
                                name={getFileIcon(openedFile.contentType) as any} 
                                size={64} 
                                color={isDarkTheme ? '#666666' : '#CCCCCC'} 
                            />
                            <Text style={[styles.unsupportedFileTitle, { color: textColor }]}>
                                Preview Not Available
                            </Text>
                            <Text style={[styles.unsupportedFileDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                This file type cannot be previewed in the browser.{'\n'}
                                Download the file to view its contents.
                            </Text>
                            <TouchableOpacity
                                style={[styles.downloadButtonLarge, { backgroundColor: primaryColor }]}
                                onPress={() => handleFileDownload(openedFile.id, openedFile.filename)}
                            >
                                <Ionicons name="download" size={20} color="#FFFFFF" />
                                <Text style={styles.downloadButtonText}>Download File</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </ScrollView>
            </View>
        );
    };

    const renderEmptyState = () => (
        <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={64} color={isDarkTheme ? '#666666' : '#CCCCCC'} />
            <Text style={[styles.emptyStateTitle, { color: textColor }]}>No Files Yet</Text>
            <Text style={[styles.emptyStateDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                {user?.id === targetUserId 
                    ? `Upload files to get started. You can select multiple files at once${Platform.OS === 'web' ? ' or drag & drop them here.' : '.'}`
                    : "This user hasn't uploaded any files yet"
                }
            </Text>
            {user?.id === targetUserId && (
                <TouchableOpacity
                    style={[styles.emptyStateButton, { backgroundColor: primaryColor }]}
                    onPress={handleFileUpload}
                    disabled={uploading}
                >
                    {uploading ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                        <>
                            <Ionicons name="cloud-upload" size={20} color="#FFFFFF" />
                            <Text style={styles.emptyStateButtonText}>Upload Files</Text>
                        </>
                    )}
                </TouchableOpacity>
            )}
        </View>
    );

    if (loading) {
        return (
            <View style={[styles.container, styles.centerContent, { backgroundColor }]}>
                <ActivityIndicator size="large" color={primaryColor} />
                <Text style={[styles.loadingText, { color: textColor }]}>Loading files...</Text>
            </View>
        );
    }

    // If a file is opened, show the file viewer
    if (openedFile) {
        return (
            <>
                {renderFileViewer()}
                {renderFileDetailsModal()}
            </>
        );
    }

    return (
        <View 
            style={[
                styles.container, 
                { backgroundColor },
                isDragging && Platform.OS === 'web' && styles.dragOverlay
            ]}
            {...(Platform.OS === 'web' && user?.id === targetUserId ? {
                onDragOver: handleDragOver,
                onDragLeave: handleDragLeave,
                onDrop: handleDrop,
            } : {})}
        >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: borderColor }]}>
                <TouchableOpacity style={styles.backButton} onPress={onClose || goBack}>
                    <Ionicons name="arrow-back" size={24} color={textColor} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: textColor }]}>
                    {viewMode === 'photos' ? 'Photos' : 'File Management'}
                </Text>
                <View style={styles.headerActions}>
                    {/* View Mode Toggle */}
                    <View style={[styles.viewModeToggle, { backgroundColor: isDarkTheme ? '#333333' : '#F0F0F0' }]}>
                        <TouchableOpacity
                            style={[
                                styles.viewModeButton,
                                viewMode === 'all' && { backgroundColor: primaryColor }
                            ]}
                            onPress={() => setViewMode('all')}
                        >
                            <Ionicons 
                                name="folder" 
                                size={16} 
                                color={viewMode === 'all' ? '#FFFFFF' : textColor} 
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.viewModeButton,
                                viewMode === 'photos' && { backgroundColor: primaryColor }
                            ]}
                            onPress={() => setViewMode('photos')}
                        >
                            <Ionicons 
                                name="images" 
                                size={16} 
                                color={viewMode === 'photos' ? '#FFFFFF' : textColor} 
                            />
                        </TouchableOpacity>
                    </View>
                    
                    {user?.id === targetUserId && (
                        <TouchableOpacity
                            style={[styles.uploadButton, { backgroundColor: primaryColor }]}
                            onPress={handleFileUpload}
                            disabled={uploading}
                        >
                            {uploading ? (
                                <View style={styles.uploadProgress}>
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                    {uploadProgress && (
                                        <Text style={styles.uploadProgressText}>
                                            {uploadProgress.current}/{uploadProgress.total}
                                        </Text>
                                    )}
                                </View>
                            ) : (
                                <Ionicons name="add" size={24} color="#FFFFFF" />
                            )}
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Search Bar */}
            {files.length > 0 && (viewMode === 'all' || files.some(f => f.contentType.startsWith('image/'))) && (
                <View style={[styles.searchContainer, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                    <Ionicons name="search" size={20} color={isDarkTheme ? '#888888' : '#666666'} />
                    <TextInput
                        style={[styles.searchInput, { color: textColor }]}
                        placeholder={viewMode === 'photos' ? 'Search photos...' : 'Search files...'}
                        placeholderTextColor={isDarkTheme ? '#888888' : '#999999'}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={20} color={isDarkTheme ? '#888888' : '#666666'} />
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* File Stats */}
            {files.length > 0 && (
                <View style={[styles.statsContainer, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                    <View style={styles.statItem}>
                        <Text style={[styles.statValue, { color: textColor }]}>{filteredFiles.length}</Text>
                        <Text style={[styles.statLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {searchQuery.length > 0 ? 'Found' : (filteredFiles.length === 1 ? (viewMode === 'photos' ? 'Photo' : 'File') : (viewMode === 'photos' ? 'Photos' : 'Files'))}
                        </Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={[styles.statValue, { color: textColor }]}>
                            {formatFileSize(filteredFiles.reduce((total, file) => total + file.length, 0))}
                        </Text>
                        <Text style={[styles.statLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {searchQuery.length > 0 ? 'Size' : 'Total Size'}
                        </Text>
                    </View>
                    {searchQuery.length > 0 && (
                        <View style={styles.statItem}>
                            <Text style={[styles.statValue, { color: textColor }]}>{files.length}</Text>
                            <Text style={[styles.statLabel, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                Total
                            </Text>
                        </View>
                    )}
                </View>
            )}

            {/* File List */}
            {viewMode === 'photos' ? (
                renderPhotoGrid()
            ) : (
                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContainer}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => loadFiles(true)}
                            tintColor={primaryColor}
                        />
                    }
                >
                    {filteredFiles.length === 0 && searchQuery.length > 0 ? (
                        <View style={styles.emptyState}>
                            <Ionicons name="search" size={64} color={isDarkTheme ? '#666666' : '#CCCCCC'} />
                            <Text style={[styles.emptyStateTitle, { color: textColor }]}>No Results Found</Text>
                            <Text style={[styles.emptyStateDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                No files match your search for "{searchQuery}"
                            </Text>
                            <TouchableOpacity
                                style={[styles.emptyStateButton, { backgroundColor: primaryColor }]}
                                onPress={() => setSearchQuery('')}
                            >
                                <Ionicons name="refresh" size={20} color="#FFFFFF" />
                                <Text style={styles.emptyStateButtonText}>Clear Search</Text>
                            </TouchableOpacity>
                        </View>
                    ) : filteredFiles.length === 0 ? renderEmptyState() : (
                        <>
                            {filteredFiles.map(renderFileItem)}
                        </>
                    )}
                </ScrollView>
            )}

            {renderFileDetailsModal()}

            {/* Drag and Drop Overlay */}
            {isDragging && Platform.OS === 'web' && (
                <View style={styles.dragDropOverlay}>
                    <View style={styles.dragDropContent}>
                        <Ionicons name="cloud-upload" size={64} color={primaryColor} />
                        <Text style={[styles.dragDropTitle, { color: primaryColor }]}>
                            Drop files to upload
                        </Text>
                        <Text style={[styles.dragDropSubtitle, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            Release to upload{uploadProgress ? ` (${uploadProgress.current}/${uploadProgress.total})` : ' multiple files'}
                        </Text>
                    </View>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    dragOverlay: {
        backgroundColor: 'rgba(0, 122, 255, 0.1)',
        borderWidth: 2,
        borderColor: '#007AFF',
        borderStyle: 'dashed',
    },
    centerContent: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        flex: 1,
        textAlign: 'center',
    },
    uploadButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    uploadProgress: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    uploadProgressText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '600',
        marginTop: 2,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginHorizontal: 20,
        marginTop: 16,
        borderRadius: 12,
        borderWidth: 1,
        gap: 12,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        paddingVertical: 4,
    },
    searchIcon: {
        marginRight: 8,
    },
    statsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        paddingVertical: 16,
        marginHorizontal: 20,
        marginTop: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        fontFamily: fontFamilies.phuduBold,
    },
    statLabel: {
        fontSize: 14,
        marginTop: 4,
    },
    scrollView: {
        flex: 1,
    },
    scrollContainer: {
        padding: 20,
    },
    fileItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        marginBottom: 12,
        borderRadius: 12,
        borderWidth: 1,
    },
    fileContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    fileIconContainer: {
        width: 50,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    fileInfo: {
        flex: 1,
    },
    fileName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    fileDetails: {
        fontSize: 14,
        marginBottom: 2,
    },
    fileDescription: {
        fontSize: 12,
        fontStyle: 'italic',
    },
    fileActions: {
        flexDirection: 'row',
        gap: 8,
    },
    actionButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 60,
        paddingHorizontal: 40,
    },
    emptyStateTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        fontFamily: fontFamilies.phuduBold,
        marginTop: 16,
        marginBottom: 8,
    },
    emptyStateDescription: {
        fontSize: 16,
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 32,
    },
    emptyStateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 24,
        gap: 8,
    },
    emptyStateButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    loadingText: {
        fontSize: 16,
        marginTop: 16,
    },
    
    // Modal styles
    modalContainer: {
        flex: 1,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    modalCloseButton: {
        padding: 8,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    modalPlaceholder: {
        width: 40,
    },
    modalContent: {
        flex: 1,
        padding: 20,
    },
    fileDetailCard: {
        padding: 24,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: 'center',
    },
    fileDetailIcon: {
        marginBottom: 16,
    },
    fileDetailName: {
        fontSize: 20,
        fontWeight: 'bold',
        fontFamily: fontFamilies.phuduBold,
        textAlign: 'center',
        marginBottom: 24,
    },
    fileDetailInfo: {
        width: '100%',
        marginBottom: 32,
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
        flexWrap: 'wrap',
    },
    detailLabel: {
        fontSize: 16,
        fontWeight: '500',
        flex: 1,
        minWidth: 100,
    },
    detailValue: {
        fontSize: 16,
        flex: 2,
        textAlign: 'right',
    },
    modalActions: {
        flexDirection: 'row',
        gap: 12,
        width: '100%',
    },
    modalActionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        borderRadius: 12,
        gap: 8,
    },
    modalActionText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    
    // Drag and Drop styles
    dragDropOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    dragDropContent: {
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        padding: 40,
        borderRadius: 20,
        borderWidth: 3,
        borderColor: '#007AFF',
        borderStyle: 'dashed',
    },
    dragDropTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginTop: 16,
        marginBottom: 8,
    },
    dragDropSubtitle: {
        fontSize: 16,
        textAlign: 'center',
    },
    
    // File Viewer styles
    fileViewerContainer: {
        flex: 1,
    },
    fileViewerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    fileViewerTitleContainer: {
        flex: 1,
        marginHorizontal: 16,
    },
    fileViewerTitle: {
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 2,
    },
    fileViewerSubtitle: {
        fontSize: 14,
    },
    fileViewerActions: {
        flexDirection: 'row',
        gap: 8,
    },
    fileViewerContent: {
        flex: 1,
    },
    fileViewerContentWithDetails: {
        paddingBottom: 20,
    },
    fileViewerContentContainer: {
        flexGrow: 1,
        padding: 20,
    },
    fileViewerLoading: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fileViewerLoadingText: {
        fontSize: 16,
        marginTop: 16,
    },
    imageContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
    },
    textContainer: {
        flex: 1,
        borderRadius: 12,
        borderWidth: 1,
        padding: 16,
        minHeight: 200,
        maxHeight: '80%',
    },
    textContent: {
        fontSize: 14,
        fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier',
        lineHeight: 20,
    },
    unsupportedFileContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
        paddingHorizontal: 40,
    },
    unsupportedFileTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        fontFamily: fontFamilies.phuduBold,
        marginTop: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    unsupportedFileDescription: {
        fontSize: 16,
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 32,
    },
    downloadButtonLarge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderRadius: 24,
        gap: 8,
    },
    downloadButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    pdfContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    mediaContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
    },
    unsupportedText: {
        fontSize: 16,
        textAlign: 'center',
        fontStyle: 'italic',
    },
    
    // File Details in Viewer styles
    fileDetailsSection: {
        margin: 16,
        marginTop: 0,
        padding: 20,
        borderRadius: 12,
        borderWidth: 1,
    },
    fileDetailsSectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        flex: 1,
    },
    fileDetailsSectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    fileDetailsSectionToggle: {
        padding: 4,
    },
    fileDetailsActions: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 16,
    },
    fileDetailsActionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 8,
        gap: 6,
    },
    fileDetailsActionText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
    
    // Header styles
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    viewModeToggle: {
        flexDirection: 'row',
        borderRadius: 20,
        padding: 2,
    },
    viewModeButton: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 18,
        minWidth: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    
    // Photo Grid styles
    photoScrollContainer: {
        padding: 16,
    },
    photoDateSection: {
        marginBottom: 24,
    },
    photoDateHeader: {
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 12,
        paddingHorizontal: 4,
    },
    photoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        justifyContent: 'flex-start',
    },
    photoItem: {
        borderRadius: 8,
        overflow: 'hidden',
    },
    photoContainer: {
        width: '100%',
        height: '100%',
        position: 'relative',
        borderRadius: 8,
        overflow: 'hidden',
    },
    photoImage: {
        width: '100%',
        height: '100%',
    },
    
    // Justified Grid styles
    dimensionsLoadingIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        gap: 8,
    },
    dimensionsLoadingText: {
        fontSize: 14,
        fontStyle: 'italic',
    },
    justifiedPhotoGrid: {
        gap: 4,
    },
    justifiedPhotoRow: {
        flexDirection: 'row',
    },
    justifiedPhotoItem: {
        borderRadius: 6,
        overflow: 'hidden',
        position: 'relative',
    },
    justifiedPhotoContainer: {
        width: '100%',
        height: '100%',
        position: 'relative',
        borderRadius: 6,
        overflow: 'hidden',
        backgroundColor: '#F5F5F5',
    },
    justifiedPhotoImage: {
        width: '100%',
        height: '100%',
        borderRadius: 6,
    },
    
    // Simple Photo Grid styles  
    simplePhotoItem: {
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#F5F5F5',
    },
    simplePhotoContainer: {
        width: '100%',
        height: '100%',
        position: 'relative',
        borderRadius: 8,
        overflow: 'hidden',
    },
    simplePhotoImage: {
        width: '100%',
        height: '100%',
        borderRadius: 8,
    },
    
    // Loading skeleton styles
    photoSkeletonGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 20,
    },
    photoSkeletonItem: {
        width: '32%',
        aspectRatio: 1,
        borderRadius: 8,
        marginBottom: 4,
    },
});

export default FileManagementScreen;

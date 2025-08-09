import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
    Image, // kept for Image.getSize only
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { Ionicons } from '@expo/vector-icons';
import type { FileMetadata } from '../../models/interfaces';
import { useFileStore, useFiles, useUploading as useUploadingStore, useUploadAggregateProgress, useDeleting as useDeletingStore } from '../stores/fileStore';
import Header from '../components/Header';
import { GroupedSection } from '../components';

interface FileManagementScreenProps extends BaseScreenProps {
    userId?: string;
}

// Add this helper function near the top (after imports):
async function uploadFileRaw(file: File | Blob, userId: string, oxyServices: any) {
    return await oxyServices.uploadRawFile(file);
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
    const files = useFiles();
    const uploading = useUploadingStore();
    const uploadProgress = useUploadAggregateProgress();
    const deleting = useDeletingStore();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);
    const [showFileDetails, setShowFileDetails] = useState(false);
    const [openedFile, setOpenedFile] = useState<FileMetadata | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [loadingFileContent, setLoadingFileContent] = useState(false);
    const [showFileDetailsInViewer, setShowFileDetailsInViewer] = useState(false);
    const [viewMode, setViewMode] = useState<'all' | 'photos'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    // Derived filtered files (avoid setState loops)
    const filteredFiles = useMemo(() => {
        let filteredByMode = files;
        if (viewMode === 'photos') {
            filteredByMode = files.filter(file => file.contentType.startsWith('image/'));
        }
        if (!searchQuery.trim()) {
            return filteredByMode;
        }
        const query = searchQuery.toLowerCase();
        return filteredByMode.filter(file =>
            file.filename.toLowerCase().includes(query) ||
            file.contentType.toLowerCase().includes(query) ||
            (file.metadata?.description && file.metadata.description.toLowerCase().includes(query))
        );
    }, [files, searchQuery, viewMode]);
    const [isDragging, setIsDragging] = useState(false);
    const [photoDimensions, setPhotoDimensions] = useState<{ [key: string]: { width: number, height: number } }>({});
    const [loadingDimensions, setLoadingDimensions] = useState(false);
    const [hoveredPreview, setHoveredPreview] = useState<string | null>(null);
    const uploadStartRef = useRef<number | null>(null);
    const MIN_BANNER_MS = 600;
    const endUpload = useCallback(() => {
        const started = uploadStartRef.current;
        const elapsed = started ? Date.now() - started : MIN_BANNER_MS;
        const remaining = elapsed < MIN_BANNER_MS ? MIN_BANNER_MS - elapsed : 0;
        setTimeout(() => {
            useFileStore.getState().setUploading(false);
            uploadStartRef.current = null;
        }, remaining);
    }, []);

    // Helper to safely request a thumbnail variant only for image mime types.
    // Prevents backend warnings: "Variant thumb not supported for mime application/pdf".
    const getSafeDownloadUrl = useCallback(
        (file: FileMetadata, variant: string = 'thumb') => {
            const isImage = file.contentType.startsWith('image/');
            const isVideo = file.contentType.startsWith('video/');

            // Prefer explicit variant key if variants metadata present
            if (file.variants && file.variants.length > 0) {
                // For videos, try 'poster' regardless of requested variant
                if (isVideo) {
                    const poster = file.variants.find(v => v.type === 'poster');
                    if (poster) return oxyServices.getFileDownloadUrl(file.id, 'poster');
                }
                if (isImage) {
                    const desired = file.variants.find(v => v.type === variant);
                    if (desired) return oxyServices.getFileDownloadUrl(file.id, variant);
                }
            }

            if (isImage) {
                return oxyServices.getFileDownloadUrl(file.id, variant);
            }
            if (isVideo) {
                // Fallback to poster if backend supports implicit generation
                try {
                    return oxyServices.getFileDownloadUrl(file.id, 'poster');
                } catch {
                    return oxyServices.getFileDownloadUrl(file.id);
                }
            }
            // Other mime types: no variant
            return oxyServices.getFileDownloadUrl(file.id);
        },
        [oxyServices]
    );

    // Memoize theme-related calculations to prevent unnecessary recalculations
    const themeStyles = useMemo(() => {
        const isDarkTheme = theme === 'dark';
        return {
            isDarkTheme,
            textColor: isDarkTheme ? '#FFFFFF' : '#000000',
            backgroundColor: isDarkTheme ? '#121212' : '#f2f2f2',
            secondaryBackgroundColor: isDarkTheme ? '#222222' : '#FFFFFF',
            borderColor: isDarkTheme ? '#444444' : '#E0E0E0',
            primaryColor: '#007AFF',
            dangerColor: '#FF3B30',
            successColor: '#34C759',
        };
    }, [theme]);

    // Extract commonly used theme variables
    const backgroundColor = themeStyles.backgroundColor;
    const borderColor = themeStyles.borderColor;

    const targetUserId = userId || user?.id;

    const storeSetUploading = useFileStore(s => s.setUploading);
    const storeSetUploadProgress = useFileStore(s => s.setUploadProgress);
    const storeSetDeleting = useFileStore(s => s.setDeleting);

    const loadFiles = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
        if (!targetUserId) return;

        try {
            if (mode === 'refresh') {
                setRefreshing(true);
            } else if (mode === 'initial') {
                setLoading(true);
            }

            const response = await oxyServices.listUserFiles();
            const assets: FileMetadata[] = (response.files || []).map((f: any) => ({
                id: f.id,
                filename: f.originalName || f.sha256,
                contentType: f.mime,
                length: f.size,
                chunkSize: 0,
                uploadDate: f.createdAt,
                metadata: f.metadata || {},
                variants: f.variants || [],
            }));
            // Merge to preserve existing order & allow incremental updates
            useFileStore.getState().setFiles(assets, { merge: true });
        } catch (error: any) {
            console.error('Failed to load files:', error);
            toast.error(error.message || 'Failed to load files');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [targetUserId, oxyServices]);

    // (removed effect; filteredFiles is memoized)

    // Load photo dimensions for justified grid
    const loadPhotoDimensions = useCallback(async (photos: FileMetadata[]) => {
        if (photos.length === 0) return;

        setLoadingDimensions(true);
        const newDimensions: { [key: string]: { width: number, height: number } } = { ...photoDimensions };
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
                        const downloadUrl = getSafeDownloadUrl(photo, 'thumb');

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
    const createJustifiedRows = useCallback((photos: FileMetadata[], containerWidth: number) => {
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
        if (!targetUserId) return; // Guard clause to ensure userId is defined
        try {
            storeSetUploadProgress({ current: 0, total: selectedFiles.length });
            const maxSize = 50 * 1024 * 1024; // 50MB
            const oversizedFiles = selectedFiles.filter(file => file.size > maxSize);
            if (oversizedFiles.length > 0) {
                const fileList = oversizedFiles.map(f => f.name).join('\n');
                window.alert(`File Size Limit\n\nThe following files are too large (max 50MB):\n${fileList}`);
                return;
            }
            let successCount = 0;
            let failureCount = 0;
            const errors: string[] = [];
            for (let i = 0; i < selectedFiles.length; i++) {
                storeSetUploadProgress({ current: i + 1, total: selectedFiles.length });
                try {
                    const raw = selectedFiles[i];
                    const optimisticId = `temp-${Date.now()}-${i}`;
                    const optimisticFile: FileMetadata = {
                        id: optimisticId,
                        filename: raw.name,
                        contentType: raw.type || 'application/octet-stream',
                        length: raw.size,
                        chunkSize: 0,
                        uploadDate: new Date().toISOString(),
                        metadata: { uploading: true },
                        variants: [],
                    };
                    useFileStore.getState().addFile(optimisticFile, { prepend: true });
                    const result = await uploadFileRaw(raw, targetUserId, oxyServices);
                    // Attempt to refresh file list incrementally – fetch single file metadata if API allows
                    if (result?.file || result?.files?.[0]) {
                        const f = result.file || result.files[0];
                        const merged: FileMetadata = {
                            id: f.id,
                            filename: f.originalName || f.sha256 || raw.name,
                            contentType: f.mime || raw.type || 'application/octet-stream',
                            length: f.size || raw.size,
                            chunkSize: 0,
                            uploadDate: f.createdAt || new Date().toISOString(),
                            metadata: f.metadata || {},
                            variants: f.variants || [],
                        };
                        // Remove optimistic then add real
                        useFileStore.getState().removeFile(optimisticId);
                        useFileStore.getState().addFile(merged, { prepend: true });
                    } else {
                        // Fallback: will reconcile on later list refresh
                        useFileStore.getState().updateFile(optimisticId, { metadata: { uploading: false } as any });
                    }
                    successCount++;
                } catch (error: any) {
                    failureCount++;
                    errors.push(`${selectedFiles[i].name}: ${error.message || 'Upload failed'}`);
                }
            }
            if (successCount > 0) {
                toast.success(`${successCount} file(s) uploaded successfully`);
            }
            if (failureCount > 0) {
                const errorMessage = `${failureCount} file(s) failed to upload${errors.length > 0 ? ':\n' + errors.slice(0, 3).join('\n') + (errors.length > 3 ? '\n...' : '') : ''}`;
                toast.error(errorMessage);
            }
            // Silent background refresh to ensure metadata/variants updated
            setTimeout(() => { loadFiles('silent'); }, 1200);
        } catch (error: any) {
            console.error('Upload error:', error);
            toast.error(error.message || 'Failed to upload files');
        } finally {
            storeSetUploadProgress(null);
        }
    };

    const handleFileUpload = async () => {
        try {
            uploadStartRef.current = Date.now();
            storeSetUploading(true);
            storeSetUploadProgress(null);

            if (Platform.OS === 'web') {
                // Web file picker implementation
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.accept = '*/*';
                // Fallback: if the user cancels the dialog (no onchange fires or 0 files), hide banner
                const cancellationTimer = setTimeout(() => {
                    const state = useFileStore.getState();
                    if (state.uploading && uploadStartRef.current && !state.uploadProgress) {
                        // No selection happened; treat as cancel
                        endUpload();
                    }
                }, 1500); // allow enough time for user to pick

                input.onchange = async (e: any) => {
                    clearTimeout(cancellationTimer);
                    const selectedFiles = Array.from(e.target.files || []) as File[];
                    if (selectedFiles.length === 0) {
                        // User explicitly canceled (some browsers still fire onchange with empty list)
                        endUpload();
                        return;
                    }
                    storeSetUploadProgress({ current: 0, total: selectedFiles.length });
                    await processFileUploads(selectedFiles);
                    endUpload();
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
            // IMPORTANT: Do NOT call endUpload here.
            // We only want to hide the banner after the actual upload(s) complete.
            // The input.onchange handler invokes processFileUploads then calls endUpload().
            // Calling endUpload here caused the banner to disappear while files were still uploading.
            storeSetUploadProgress(null); // keep clearing any stale progress
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
            storeSetDeleting(fileId);

            const result = await oxyServices.deleteFile(fileId);
            console.log('Delete result:', result);

            toast.success('File deleted successfully');

            // Reload files after successful deletion
            // Optimistic remove
            useFileStore.getState().removeFile(fileId);
            // Silent background reconcile
            setTimeout(() => loadFiles('silent'), 800);
        } catch (error: any) {
            console.error('Delete error:', error);
            console.error('Error details:', error.response?.data || error.message);

            // Provide specific error messages
            if (error.message?.includes('File not found') || error.message?.includes('404')) {
                toast.error('File not found. It may have already been deleted.');
                // Still reload files to refresh the list
                setTimeout(() => loadFiles('silent'), 800);
            } else if (error.message?.includes('permission') || error.message?.includes('403')) {
                toast.error('You do not have permission to delete this file.');
            } else {
                toast.error(error.message || 'Failed to delete file');
            }
        } finally {
            storeSetDeleting(null);
        }
    };

    // Drag and drop handlers for web
    const handleDragOver = (e: any) => {
        if (Platform.OS === 'web' && user?.id === targetUserId) {
            e.preventDefault();
            setIsDragging(true);
        }
    };

    const handleDragEnter = (e: any) => {
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

    // Global drag listeners (web) to catch drags outside component bounds
    useEffect(() => {
        if (Platform.OS !== 'web' || user?.id !== targetUserId) return;
        const onDocDragEnter = (e: any) => {
            if (e?.dataTransfer?.types?.includes('Files')) setIsDragging(true);
        };
        const onDocDragOver = (e: any) => {
            if (e?.dataTransfer?.types?.includes('Files')) {
                e.preventDefault();
                setIsDragging(true);
            }
        };
        const onDocDrop = (e: any) => {
            if (e?.dataTransfer?.files?.length) {
                e.preventDefault();
                setIsDragging(false);
            }
        };
        const onDocDragLeave = (e: any) => {
            if (!e.relatedTarget && e.screenX === 0 && e.screenY === 0) setIsDragging(false);
        };
        document.addEventListener('dragenter', onDocDragEnter);
        document.addEventListener('dragover', onDocDragOver);
        document.addEventListener('drop', onDocDrop);
        document.addEventListener('dragleave', onDocDragLeave);
        return () => {
            document.removeEventListener('dragenter', onDocDragEnter);
            document.removeEventListener('dragover', onDocDragOver);
            document.removeEventListener('drop', onDocDrop);
            document.removeEventListener('dragleave', onDocDragLeave);
        };
    }, [user?.id, targetUserId]);

    const handleDrop = async (e: any) => {
        if (Platform.OS === 'web' && user?.id === targetUserId) {
            e.preventDefault();
            setIsDragging(false);
            uploadStartRef.current = Date.now();
            storeSetUploading(true);

            try {
                const files = Array.from(e.dataTransfer.files) as File[];
                if (files.length > 0) storeSetUploadProgress({ current: 0, total: files.length });
                await processFileUploads(files);
            } catch (error: any) {
                toast.error(error.message || 'Failed to upload files');
            } finally {
                endUpload();
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

                    // Method 2: Fallback to authenticated download
                    const blob = await oxyServices.getFileContentAsBlob(fileId);
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
        return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
                    if (file.contentType.startsWith('image/') ||
                        file.contentType.includes('pdf') ||
                        file.contentType.startsWith('video/') ||
                        file.contentType.startsWith('audio/')) {
                        // For images, PDFs, videos, and audio, we'll use the URL directly
                        const downloadUrl = oxyServices.getFileDownloadUrl(file.id);
                        setFileContent(downloadUrl);
                    } else {
                        // For text files, get the content using authenticated request
                        const content = await oxyServices.getFileContentAsText(file.id);
                        setFileContent(content);
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
        const downloadUrl = getSafeDownloadUrl(photo, 'thumb');

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
                    <ExpoImage
                        source={{ uri: downloadUrl }}
                        style={styles.simplePhotoImage}
                        contentFit="cover"
                        transition={120}
                        cachePolicy="memory-disk"
                        onError={(e: any) => {
                            console.error('Photo failed to load:', (e as any)?.nativeEvent ?? e);
                        }}
                        accessibilityLabel={photo.filename}
                    />
                </View>
            </TouchableOpacity>
        );
    }, [oxyServices, containerWidth]);

    const renderJustifiedPhotoItem = useCallback((photo: FileMetadata, width: number, height: number, isLast: boolean) => {
        const downloadUrl = getSafeDownloadUrl(photo, 'thumb');

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
                    <ExpoImage
                        source={{ uri: downloadUrl }}
                        style={styles.justifiedPhotoImage}
                        contentFit="cover"
                        transition={120}
                        cachePolicy="memory-disk"
                        onError={(e: any) => {
                            console.error('Photo failed to load:', (e as any)?.nativeEvent ?? e);
                        }}
                        accessibilityLabel={photo.filename}
                    />
                </View>
            </TouchableOpacity>
        );
    }, [oxyServices]);

    // Run initial load once per targetUserId change to avoid accidental loops
    const lastLoadedFor = useRef<string | undefined>(undefined);
    useEffect(() => {
        const key = targetUserId || 'anonymous';
        if (lastLoadedFor.current !== key) {
            lastLoadedFor.current = key;
            loadFiles('initial');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetUserId]);

    const renderFileItem = (file: FileMetadata) => {
        const isImage = file.contentType.startsWith('image/');
        const isPDF = file.contentType.includes('pdf');
        const isVideo = file.contentType.startsWith('video/');
        const isAudio = file.contentType.startsWith('audio/');
        const hasPreview = isImage || isPDF || isVideo;
        const borderColor = themeStyles.borderColor;

        return (
            <View
                key={file.id}
                style={[styles.fileItem, { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor }]}
            >
                <TouchableOpacity
                    style={styles.fileContent}
                    onPress={() => handleFileOpen(file)}
                >
                    {/* Preview Thumbnail */}
                    <View style={styles.filePreviewContainer}>
                        {hasPreview ? (
                            <View
                                style={styles.filePreview}
                                {...(Platform.OS === 'web' && {
                                    onMouseEnter: () => setHoveredPreview(file.id),
                                    onMouseLeave: () => setHoveredPreview(null),
                                })}
                            >
                                {isImage && (
                                    <ExpoImage
                                        source={{ uri: getSafeDownloadUrl(file, 'thumb') }}
                                        style={styles.previewImage}
                                        contentFit="cover"
                                        transition={120}
                                        cachePolicy="memory-disk"
                                        onError={(_: any) => {
                                            console.warn('Failed to load image preview.');
                                        }}
                                        accessibilityLabel={file.filename}
                                    />
                                )}
                                {isPDF && (
                                    <View style={styles.pdfPreview}>
                                        <Ionicons name="document" size={32} color={themeStyles.primaryColor} />
                                        <Text style={[styles.pdfLabel, { color: themeStyles.primaryColor }]}>PDF</Text>
                                    </View>
                                )}
                                {isVideo && (
                                    <View style={styles.videoPreviewWrapper}>
                                        <ExpoImage
                                            source={{ uri: getSafeDownloadUrl(file, 'thumb') }}
                                            style={styles.videoPosterImage}
                                            contentFit="cover"
                                            transition={120}
                                            cachePolicy="memory-disk"
                                            onError={(_: any) => {
                                                // If thumbnail not available, we still show icon overlay
                                            }}
                                            accessibilityLabel={file.filename + ' video thumbnail'}
                                        />
                                        <View style={styles.videoOverlay}>
                                            <Ionicons name="play" size={24} color="#FFFFFF" />
                                        </View>
                                    </View>
                                )}
                                {/* Fallback icon (hidden by default for images) */}
                                <View
                                    style={[styles.fallbackIcon, { display: isImage ? 'none' : 'flex' }]}
                                    {...(Platform.OS === 'web' && { 'data-fallback': 'true' })}
                                >
                                    <Ionicons
                                        name={getFileIcon(file.contentType) as any}
                                        size={32}
                                        color={themeStyles.primaryColor}
                                    />
                                </View>

                                {/* Preview overlay for hover effect */}
                                {Platform.OS === 'web' && hoveredPreview === file.id && isImage && (
                                    <View style={styles.previewOverlay}>
                                        <Ionicons name="eye" size={24} color="#FFFFFF" />
                                    </View>
                                )}
                            </View>
                        ) : (
                            <View style={styles.fileIconContainer}>
                                <Ionicons
                                    name={getFileIcon(file.contentType) as any}
                                    size={32}
                                    color={themeStyles.primaryColor}
                                />
                            </View>
                        )}
                    </View>

                    <View style={styles.fileInfo}>
                        <Text style={[styles.fileName, { color: themeStyles.textColor }]} numberOfLines={1}>
                            {file.filename}
                        </Text>
                        <Text style={[styles.fileDetails, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {formatFileSize(file.length)} • {new Date(file.uploadDate).toLocaleDateString()}
                        </Text>
                        {file.metadata?.description && (
                            <Text
                                style={[styles.fileDescription, { color: themeStyles.isDarkTheme ? '#AAAAAA' : '#888888' }]}
                                numberOfLines={2}
                            >
                                {file.metadata.description}
                            </Text>
                        )}
                    </View>
                </TouchableOpacity>

                <View style={styles.fileActions}>
                    {/* Preview button for supported files */}
                    {hasPreview && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}
                            onPress={() => handleFileOpen(file)}
                        >
                            <Ionicons name="eye" size={20} color={themeStyles.primaryColor} />
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}
                        onPress={() => handleFileDownload(file.id, file.filename)}
                    >
                        <Ionicons name="download" size={20} color={themeStyles.primaryColor} />
                    </TouchableOpacity>

                    {/* Always show delete button for debugging */}
                    <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: themeStyles.isDarkTheme ? '#400000' : '#FFEBEE' }]}
                        onPress={() => {
                            handleFileDelete(file.id, file.filename);
                        }}
                        disabled={deleting === file.id}
                    >
                        {deleting === file.id ? (
                            <ActivityIndicator size="small" color={themeStyles.dangerColor} />
                        ) : (
                            <Ionicons name="trash" size={20} color={themeStyles.dangerColor} />
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    // GroupedSection-based file items (for 'all' view) replacing legacy flat list look
    const groupedFileItems = useMemo(() => {
        return filteredFiles
            .filter(f => true) // placeholder for future filtering
            .sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())
            .map((file) => {
                const isImage = file.contentType.startsWith('image/');
                const isVideo = file.contentType.startsWith('video/');
                const hasPreview = isImage || isVideo;
                const previewUrl = hasPreview ? (isVideo ? getSafeDownloadUrl(file, 'poster') : getSafeDownloadUrl(file, 'thumb')) : undefined;
                return {
                    id: file.id,
                    image: previewUrl,
                    imageSize: 44,
                    icon: !previewUrl ? getFileIcon(file.contentType) : undefined,
                    iconColor: themeStyles.primaryColor,
                    title: file.filename,
                    subtitle: `${formatFileSize(file.length)} • ${new Date(file.uploadDate).toLocaleDateString()}`,
                    theme: theme as 'light' | 'dark',
                    onPress: () => handleFileOpen(file),
                    showChevron: false,
                    dense: true,
                    multiRow: !!file.metadata?.description,
                    customContent: (
                        <View style={styles.groupedActions}>
                            {(isImage || isVideo || file.contentType.includes('pdf')) && (
                                <TouchableOpacity
                                    style={[styles.groupedActionBtn, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}
                                    onPress={() => handleFileOpen(file)}
                                >
                                    <Ionicons name="eye" size={18} color={themeStyles.primaryColor} />
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity
                                style={[styles.groupedActionBtn, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}
                                onPress={() => handleFileDownload(file.id, file.filename)}
                            >
                                <Ionicons name="download" size={18} color={themeStyles.primaryColor} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.groupedActionBtn, { backgroundColor: themeStyles.isDarkTheme ? '#400000' : '#FFEBEE' }]}
                                onPress={() => handleFileDelete(file.id, file.filename)}
                                disabled={deleting === file.id}
                            >
                                {deleting === file.id ? (
                                    <ActivityIndicator size="small" color={themeStyles.dangerColor} />
                                ) : (
                                    <Ionicons name="trash" size={18} color={themeStyles.dangerColor} />
                                )}
                            </TouchableOpacity>
                        </View>
                    ),
                    customContentBelow: file.metadata?.description ? (
                        <Text style={[styles.groupedDescription, { color: themeStyles.isDarkTheme ? '#AAAAAA' : '#666666' }]} numberOfLines={2}>
                            {file.metadata.description}
                        </Text>
                    ) : undefined,
                } as any; // GroupedSectionItem shape
            });
    }, [filteredFiles, theme, themeStyles, deleting, handleFileDownload, handleFileDelete, handleFileOpen, getSafeDownloadUrl]);

    const renderPhotoItem = (photo: FileMetadata, index: number) => {
        const downloadUrl = getSafeDownloadUrl(photo, 'thumb');

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
                    <ExpoImage
                        source={{ uri: downloadUrl }}
                        style={styles.photoImage}
                        contentFit="cover"
                        transition={120}
                        cachePolicy="memory-disk"
                        onError={(_: any) => {
                            console.warn('Failed to load image preview for photo:', photo.id);
                        }}
                        accessibilityLabel={photo.filename}
                    />
                </View>
            </TouchableOpacity>
        );
    };

    const renderPhotoGrid = useCallback(() => {
        const photos = filteredFiles.filter(file => file.contentType.startsWith('image/'));

        if (photos.length === 0) {
            return (
                <View style={styles.emptyState}>
                    <Ionicons name="images-outline" size={64} color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'} />
                    <Text style={[styles.emptyStateTitle, { color: themeStyles.textColor }]}>No Photos Yet</Text>
                    <Text style={[styles.emptyStateDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}> {
                        user?.id === targetUserId
                            ? `Upload photos to get started. You can select multiple photos at once${Platform.OS === 'web' ? ' or drag & drop them here.' : '.'}`
                            : "This user hasn't uploaded any photos yet"
                    } </Text>
                    {user?.id === targetUserId && (
                        <TouchableOpacity
                            style={[styles.emptyStateButton, { backgroundColor: themeStyles.primaryColor }]}
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
                        onRefresh={() => loadFiles('refresh')}
                        tintColor={themeStyles.primaryColor}
                    />
                }
                showsVerticalScrollIndicator={false}
            >
                {loadingDimensions && (
                    <View style={styles.dimensionsLoadingIndicator}>
                        <ActivityIndicator size="small" color={themeStyles.primaryColor} />
                        <Text style={[styles.dimensionsLoadingText, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>Loading photo layout...</Text>
                    </View>
                )}

                <JustifiedPhotoGrid
                    photos={photos}
                    photoDimensions={photoDimensions}
                    loadPhotoDimensions={loadPhotoDimensions}
                    createJustifiedRows={createJustifiedRows}
                    renderJustifiedPhotoItem={renderJustifiedPhotoItem}
                    renderSimplePhotoItem={renderPhotoItem}
                    textColor={themeStyles.textColor}
                    containerWidth={containerWidth}
                />
            </ScrollView>
        );
    }, [
        filteredFiles,
        themeStyles,
        user?.id,
        targetUserId,
        uploading,
        handleFileUpload,
        refreshing,
        loadFiles,
        loadingDimensions,
        photoDimensions,
        loadPhotoDimensions,
        createJustifiedRows,
        renderJustifiedPhotoItem,
        renderPhotoItem,
        containerWidth
    ]);

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
        photoDimensions: { [key: string]: { width: number, height: number } };
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
            // Depend only on photo IDs to avoid re-running from dimension state changes
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [photos.map(p => p.id).join(',')]);

        // Group photos by date
        const photosByDate = React.useMemo(() => {
            return photos.reduce((groups: { [key: string]: FileMetadata[] }, photo) => {
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
                            <Text style={[styles.photoDateHeader, { color: themeStyles.textColor }]}>
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

    const renderFileDetailsModal = () => {
        const backgroundColor = themeStyles.backgroundColor;
        const borderColor = themeStyles.borderColor;

        return (
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
                            <Ionicons name="close" size={24} color={themeStyles.textColor} />
                        </TouchableOpacity>
                        <Text style={[styles.modalTitle, { color: themeStyles.textColor }]}>File Details</Text>
                        <View style={styles.modalPlaceholder} />
                    </View>

                    {selectedFile && (
                        <ScrollView style={styles.modalContent}>
                            <View style={[styles.fileDetailCard, { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor }]}>
                                <View style={styles.fileDetailIcon}>
                                    <Ionicons
                                        name={getFileIcon(selectedFile.contentType) as any}
                                        size={64}
                                        color={themeStyles.primaryColor}
                                    />
                                </View>

                                <Text style={[styles.fileDetailName, { color: themeStyles.textColor }]}>
                                    {selectedFile.filename}
                                </Text>

                                <View style={styles.fileDetailInfo}>
                                    <View style={styles.detailRow}>
                                        <Text style={[styles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                            Size:
                                        </Text>
                                        <Text style={[styles.detailValue, { color: themeStyles.textColor }]}>
                                            {formatFileSize(selectedFile.length)}
                                        </Text>
                                    </View>

                                    <View style={styles.detailRow}>
                                        <Text style={[styles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                            Type:
                                        </Text>
                                        <Text style={[styles.detailValue, { color: themeStyles.textColor }]}>
                                            {selectedFile.contentType}
                                        </Text>
                                    </View>

                                    <View style={styles.detailRow}>
                                        <Text style={[styles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                            Uploaded:
                                        </Text>
                                        <Text style={[styles.detailValue, { color: themeStyles.textColor }]}>
                                            {new Date(selectedFile.uploadDate).toLocaleString()}
                                        </Text>
                                    </View>

                                    {selectedFile.metadata?.description && (
                                        <View style={styles.detailRow}>
                                            <Text style={[styles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                                Description:
                                            </Text>
                                            <Text style={[styles.detailValue, { color: themeStyles.textColor }]}>
                                                {selectedFile.metadata.description}
                                            </Text>
                                        </View>
                                    )}
                                </View>

                                <View style={styles.modalActions}>
                                    <TouchableOpacity
                                        style={[styles.modalActionButton, { backgroundColor: themeStyles.primaryColor }]}
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
                                            style={[styles.modalActionButton, { backgroundColor: themeStyles.dangerColor }]}
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
    };

    const renderFileViewer = () => {
        if (!openedFile) return null;

        const backgroundColor = themeStyles.backgroundColor;
        const borderColor = themeStyles.borderColor;

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
                        <Ionicons name="arrow-back" size={24} color={themeStyles.textColor} />
                    </TouchableOpacity>
                    <View style={styles.fileViewerTitleContainer}>
                        <Text style={[styles.fileViewerTitle, { color: themeStyles.textColor }]} numberOfLines={1}>
                            {openedFile.filename}
                        </Text>
                        <Text style={[styles.fileViewerSubtitle, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {formatFileSize(openedFile.length)} • {openedFile.contentType}
                        </Text>
                    </View>
                    <View style={styles.fileViewerActions}>
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}
                            onPress={() => handleFileDownload(openedFile.id, openedFile.filename)}
                        >
                            <Ionicons name="download" size={20} color={themeStyles.primaryColor} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.actionButton,
                                {
                                    backgroundColor: showFileDetailsInViewer
                                        ? themeStyles.primaryColor
                                        : (themeStyles.isDarkTheme ? '#333333' : '#F0F0F0')
                                }
                            ]}
                            onPress={() => setShowFileDetailsInViewer(!showFileDetailsInViewer)}
                        >
                            <Ionicons
                                name={showFileDetailsInViewer ? "chevron-up" : "information-circle"}
                                size={20}
                                color={showFileDetailsInViewer ? "#FFFFFF" : themeStyles.primaryColor}
                            />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* File Details Section */}
                {showFileDetailsInViewer && (
                    <View style={[styles.fileDetailsSection, { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor }]}>
                        <View style={styles.fileDetailsSectionHeader}>
                            <Text style={[styles.fileDetailsSectionTitle, { color: themeStyles.textColor }]}>
                                File Details
                            </Text>
                            <TouchableOpacity
                                style={styles.fileDetailsSectionToggle}
                                onPress={() => setShowFileDetailsInViewer(false)}
                            >
                                <Ionicons name="chevron-up" size={20} color={themeStyles.isDarkTheme ? '#BBBBBB' : '#666666'} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.fileDetailInfo}>
                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    File Name:
                                </Text>
                                <Text style={[styles.detailValue, { color: themeStyles.textColor }]}>
                                    {openedFile.filename}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Size:
                                </Text>
                                <Text style={[styles.detailValue, { color: themeStyles.textColor }]}>
                                    {formatFileSize(openedFile.length)}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Type:
                                </Text>
                                <Text style={[styles.detailValue, { color: themeStyles.textColor }]}>
                                    {openedFile.contentType}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Uploaded:
                                </Text>
                                <Text style={[styles.detailValue, { color: themeStyles.textColor }]}>
                                    {new Date(openedFile.uploadDate).toLocaleString()}
                                </Text>
                            </View>

                            {openedFile.metadata?.description && (
                                <View style={styles.detailRow}>
                                    <Text style={[styles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        Description:
                                    </Text>
                                    <Text style={[styles.detailValue, { color: themeStyles.textColor }]}>
                                        {openedFile.metadata.description}
                                    </Text>
                                </View>
                            )}

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    File ID:
                                </Text>
                                <Text style={[styles.detailValue, { color: themeStyles.textColor, fontSize: 12, fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier' }]}>
                                    {openedFile.id}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.fileDetailsActions}>
                            <TouchableOpacity
                                style={[styles.fileDetailsActionButton, { backgroundColor: themeStyles.primaryColor }]}
                                onPress={() => handleFileDownload(openedFile.id, openedFile.filename)}
                            >
                                <Ionicons name="download" size={16} color="#FFFFFF" />
                                <Text style={styles.fileDetailsActionText}>Download</Text>
                            </TouchableOpacity>

                            {(user?.id === targetUserId) && (
                                <TouchableOpacity
                                    style={[styles.fileDetailsActionButton, { backgroundColor: themeStyles.dangerColor }]}
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
                            <ActivityIndicator size="large" color={themeStyles.primaryColor} />
                            <Text style={[styles.fileViewerLoadingText, { color: themeStyles.textColor }]}>
                                Loading file content...
                            </Text>
                        </View>
                    ) : isImage && fileContent ? (
                        <View style={styles.imageContainer}>
                            <ExpoImage
                                source={{ uri: fileContent }}
                                style={{ width: '100%', height: 400, borderRadius: 8 }}
                                contentFit="contain"
                                transition={120}
                                cachePolicy="memory-disk"
                                onError={(e: any) => {
                                    console.error('Image failed to load:', (e as any)?.nativeEvent ?? e);
                                }}
                                accessibilityLabel={openedFile.filename}
                            />
                        </View>
                    ) : isText && fileContent ? (
                        <View style={[styles.textContainer, { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor }]}>
                            <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
                                <Text style={[styles.textContent, { color: themeStyles.textColor }]}>
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
                                <Text style={[styles.unsupportedText, { color: themeStyles.textColor }]}>
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
                                <Text style={[styles.unsupportedText, { color: themeStyles.textColor }]}>
                                    Audio playback not supported on mobile
                                </Text>
                            )}
                        </View>
                    ) : (
                        <View style={styles.unsupportedFileContainer}>
                            <Ionicons
                                name={getFileIcon(openedFile.contentType) as any}
                                size={64}
                                color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'}
                            />
                            <Text style={[styles.unsupportedFileTitle, { color: themeStyles.textColor }]}>
                                Preview Not Available
                            </Text>
                            <Text style={[styles.unsupportedFileDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                This file type cannot be previewed in the browser.{'\n'}
                                Download the file to view its contents.
                            </Text>
                            <TouchableOpacity
                                style={[styles.downloadButtonLarge, { backgroundColor: themeStyles.primaryColor }]}
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
            <Ionicons name="folder-open-outline" size={64} color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'} />
            <Text style={[styles.emptyStateTitle, { color: themeStyles.textColor }]}>No Files Yet</Text>
            <Text style={[styles.emptyStateDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                {user?.id === targetUserId
                    ? `Upload files to get started. You can select multiple files at once${Platform.OS === 'web' ? ' or drag & drop them here.' : '.'}`
                    : "This user hasn't uploaded any files yet"
                }
            </Text>
            {user?.id === targetUserId && (
                <TouchableOpacity
                    style={[styles.emptyStateButton, { backgroundColor: themeStyles.primaryColor }]}
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
                <ActivityIndicator size="large" color={themeStyles.primaryColor} />
                <Text style={[styles.loadingText, { color: themeStyles.textColor }]}>Loading files...</Text>
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
                isDragging && Platform.OS === 'web' && styles.dragOverlay
            ]}
            {...(Platform.OS === 'web' && user?.id === targetUserId ? {
                onDragOver: handleDragOver,
                onDragEnter: handleDragEnter,
                onDragLeave: handleDragLeave,
                onDrop: handleDrop,
            } : {})}
        >
            <Header
                title={viewMode === 'photos' ? 'Photos' : 'File Management'}
                subtitle={`${filteredFiles.length} ${filteredFiles.length === 1 ? 'item' : 'items'}`}
                onBack={onClose || goBack}
                theme={theme}
                showBackButton
                variant="minimal"
                elevation="none"
                titleAlignment="left"
            />

            <View style={styles.controlsBar}>
                <View style={[
                    styles.viewModeToggle,
                    {
                        backgroundColor: themeStyles.isDarkTheme ? '#181818' : '#FFFFFF',
                        borderWidth: 1,
                        borderColor: themeStyles.isDarkTheme ? '#2A2A2A' : '#E8E9EA',
                    }
                ]}>
                    <TouchableOpacity
                        style={[
                            styles.viewModeButton,
                            viewMode === 'all' && { backgroundColor: themeStyles.primaryColor }
                        ]}
                        onPress={() => setViewMode('all')}
                    >
                        <Ionicons
                            name="folder"
                            size={18}
                            color={viewMode === 'all' ? '#FFFFFF' : themeStyles.textColor}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[
                            styles.viewModeButton,
                            viewMode === 'photos' && { backgroundColor: themeStyles.primaryColor }
                        ]}
                        onPress={() => setViewMode('photos')}
                    >
                        <Ionicons
                            name="images"
                            size={18}
                            color={viewMode === 'photos' ? '#FFFFFF' : themeStyles.textColor}
                        />
                    </TouchableOpacity>
                </View>
                {user?.id === targetUserId && (
                    <TouchableOpacity
                        style={[styles.uploadButton, { backgroundColor: themeStyles.primaryColor }]}
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
                            <Ionicons name="add" size={22} color="#FFFFFF" />
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {/* Search Bar */}
            {files.length > 0 && (viewMode === 'all' || files.some(f => f.contentType.startsWith('image/'))) && (
                <View style={[
                    styles.searchContainer,
                    {
                        backgroundColor: themeStyles.isDarkTheme ? '#1A1A1A' : '#FFFFFF',
                        borderColor: themeStyles.isDarkTheme ? '#3A3A3A' : '#E8E9EA',
                    }
                ]}>
                    <Ionicons name="search" size={22} color={themeStyles.isDarkTheme ? '#888888' : '#666666'} />
                    <TextInput
                        style={[styles.searchInput, { color: themeStyles.textColor }]}
                        placeholder={viewMode === 'photos' ? 'Search photos...' : 'Search files...'}
                        placeholderTextColor={themeStyles.isDarkTheme ? '#888888' : '#999999'}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity
                            onPress={() => setSearchQuery('')}
                            style={styles.searchClearButton}
                        >
                            <Ionicons name="close-circle" size={22} color={themeStyles.isDarkTheme ? '#888888' : '#666666'} />
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* File Stats */}
            {files.length > 0 && (
                <View style={[
                    styles.statsContainer,
                    {
                        backgroundColor: themeStyles.isDarkTheme ? '#1A1A1A' : '#FFFFFF',
                        borderColor: themeStyles.isDarkTheme ? '#3A3A3A' : '#E8E9EA',
                    }
                ]}>
                    <View style={styles.statItem}>
                        <Text style={[styles.statValue, { color: themeStyles.textColor }]}>{filteredFiles.length}</Text>
                        <Text style={[styles.statLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {searchQuery.length > 0 ? 'Found' : (filteredFiles.length === 1 ? (viewMode === 'photos' ? 'Photo' : 'File') : (viewMode === 'photos' ? 'Photos' : 'Files'))}
                        </Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={[styles.statValue, { color: themeStyles.textColor }]}>
                            {formatFileSize(filteredFiles.reduce((total, file) => total + file.length, 0))}
                        </Text>
                        <Text style={[styles.statLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {searchQuery.length > 0 ? 'Size' : 'Total Size'}
                        </Text>
                    </View>
                    {searchQuery.length > 0 && (
                        <View style={styles.statItem}>
                            <Text style={[styles.statValue, { color: themeStyles.textColor }]}>{files.length}</Text>
                            <Text style={[styles.statLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
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
                            onRefresh={() => loadFiles('refresh')}
                            tintColor={themeStyles.primaryColor}
                        />
                    }
                >
                    {filteredFiles.length === 0 && searchQuery.length > 0 ? (
                        <View style={styles.emptyState}>
                            <Ionicons name="search" size={64} color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'} />
                            <Text style={[styles.emptyStateTitle, { color: themeStyles.textColor }]}>No Results Found</Text>
                            <Text style={[styles.emptyStateDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                No files match your search for "{searchQuery}"
                            </Text>
                            <TouchableOpacity
                                style={[styles.emptyStateButton, { backgroundColor: themeStyles.primaryColor }]}
                                onPress={() => setSearchQuery('')}
                            >
                                <Ionicons name="refresh" size={20} color="#FFFFFF" />
                                <Text style={styles.emptyStateButtonText}>Clear Search</Text>
                            </TouchableOpacity>
                        </View>
                    ) : filteredFiles.length === 0 ? renderEmptyState() : (
                        <GroupedSection items={groupedFileItems} theme={theme as 'light' | 'dark'} />
                    )}
                </ScrollView>
            )}

            {renderFileDetailsModal()}

            {/* Uploading banner overlay */}
            {uploading && (
                <View pointerEvents="none" style={styles.uploadBannerContainer}>
                    <View style={[styles.uploadBanner, { backgroundColor: themeStyles.isDarkTheme ? '#222831EE' : '#FFFFFFEE', borderColor: themeStyles.borderColor }]}>
                        <Ionicons name="cloud-upload" size={18} color={themeStyles.primaryColor} />
                        <Text style={[styles.uploadBannerText, { color: themeStyles.textColor }]}>Uploading{uploadProgress ? ` ${uploadProgress.current}/${uploadProgress.total}` : '...'}</Text>
                        <View style={styles.uploadBannerDots}>
                            {[0, 1, 2].map(i => (
                                <View key={i} style={[styles.dot, { opacity: ((Date.now() / 400 + i) % 3) < 1 ? 1 : 0.25 }]} />
                            ))}
                        </View>
                    </View>
                </View>
            )}

            {/* Drag and Drop Overlay */}
            {isDragging && Platform.OS === 'web' && (
                <View style={styles.dragDropOverlay}>
                    <View style={styles.dragDropContent}>
                        <Ionicons name="cloud-upload" size={64} color={themeStyles.primaryColor} />
                        <Text style={[styles.dragDropTitle, { color: themeStyles.primaryColor }]}>
                            Drop files to upload
                        </Text>
                        <Text style={[styles.dragDropSubtitle, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
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
        backgroundColor: 'rgba(0, 122, 255, 0.06)',
        borderWidth: 1,
        borderColor: '#66AFFF',
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
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        position: 'relative',
    },
    backButton: {
        padding: 12,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 44,
        minHeight: 44,
    },
    headerTitleContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 16,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '700',
        fontFamily: fontFamilies.phuduBold,
        letterSpacing: -0.5,
        lineHeight: 28,
    },
    headerSubtitle: {
        fontSize: 13,
        fontWeight: '500',
        fontFamily: fontFamilies.phuduMedium,
        marginTop: 2,
        letterSpacing: 0.2,
    },
    uploadButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
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
    uploadBannerContainer: {
        position: 'absolute',
        top: 72, // below header
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 50,
    },
    uploadBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 24,
        gap: 8,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    uploadBannerText: {
        fontSize: 13,
        fontWeight: '500',
    },
    uploadBannerDots: {
        flexDirection: 'row',
        gap: 4,
        marginLeft: 2,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#007AFF',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginHorizontal: 16,
        marginTop: 12,
        borderRadius: 10,
        borderWidth: 1,
        gap: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        fontFamily: fontFamilies.phudu,
        lineHeight: 20,
    },
    searchClearButton: {
        padding: 4,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchIcon: {
        marginRight: 8,
    },
    statsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginHorizontal: 16,
        marginTop: 12,
        borderRadius: 10,
        borderWidth: 1,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 4,
    },
    statValue: {
        fontSize: 20,
        fontWeight: '800',
        fontFamily: fontFamilies.phuduBold,
        letterSpacing: -0.5,
        lineHeight: 24,
    },
    statLabel: {
        fontSize: 12,
        fontWeight: '500',
        fontFamily: fontFamilies.phuduMedium,
        marginTop: 2,
        letterSpacing: 0.2,
    },
    scrollView: {
        flex: 1,
    },
    scrollContainer: {
        padding: 12,
    },
    fileItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        marginBottom: 8,
        borderRadius: 10,
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
    filePreviewContainer: {
        width: 52,
        height: 52,
        marginRight: 10,
    },
    filePreview: {
        width: '100%',
        height: '100%',
        borderRadius: 8,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
    },
    previewImage: {
        width: '100%',
        height: '100%',
        borderRadius: 8,
    },
    pdfPreview: {
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#FF6B6B20',
    },
    pdfLabel: {
        fontSize: 8,
        fontWeight: 'bold',
        marginTop: 2,
    },
    videoPreview: {
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#4ECDC420',
    },
    videoLabel: {
        fontSize: 8,
        fontWeight: 'bold',
        marginTop: 2,
    },
    fallbackIcon: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        borderRadius: 8,
    },
    previewOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.25)',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
    },
    groupedActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginLeft: 12,
    },
    groupedActionBtn: {
        width: 34,
        height: 34,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    groupedDescription: {
        fontSize: 12,
        lineHeight: 16,
        marginTop: 6,
    },
    videoPreviewWrapper: {
        width: '100%',
        height: '100%',
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#000000',
        alignItems: 'center',
        justifyContent: 'center',
    },
    videoPosterImage: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
    },
    videoOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.25)',
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
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#E0E0E0',
        backgroundColor: 'transparent',
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 40,
        paddingHorizontal: 24,
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
        paddingHorizontal: 16,
        paddingVertical: 12,
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
        padding: 16,
    },
    fileDetailCard: {
        padding: 18,
        borderRadius: 14,
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
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    dragDropContent: {
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: 20,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#66AFFF',
        borderStyle: 'dashed',
    },
    dragDropTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginTop: 12,
        marginBottom: 6,
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
        paddingHorizontal: 16,
        paddingVertical: 12,
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
        padding: 14,
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
        borderRadius: 10,
        borderWidth: 1,
        padding: 12,
        minHeight: 180,
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
        paddingVertical: 40,
        paddingHorizontal: 24,
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
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderRadius: 20,
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
        margin: 12,
        marginTop: 0,
        padding: 14,
        borderRadius: 10,
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
        gap: 16,
    },
    controlsBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 4,
        gap: 12,
    },
    viewModeToggle: {
        flexDirection: 'row',
        borderRadius: 24,
        padding: 3,
        overflow: 'hidden',
    },
    viewModeButton: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 20,
        minWidth: 44,
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 1,
    },

    // Photo Grid styles
    photoScrollContainer: {
        padding: 10,
    },
    photoDateSection: {
        marginBottom: 16,
    },
    photoDateHeader: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 8,
        paddingHorizontal: 2,
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
        backgroundColor: 'transparent',
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
        backgroundColor: 'transparent',
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

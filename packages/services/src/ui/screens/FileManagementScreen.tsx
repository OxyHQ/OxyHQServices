import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    RefreshControl,
    TextInput,
    Image,
    Animated,
    Easing,
    Alert,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import type { BaseScreenProps } from '../navigation/types';
import { toast } from '../../lib/sonner';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { FileMetadata } from '../../models/interfaces';
import { useFileStore, useFiles, useUploading as useUploadingStore, useUploadAggregateProgress, useDeleting as useDeletingStore } from '../stores/fileStore';
import Header from '../components/Header';
import JustifiedPhotoGrid from '../components/photogrid/JustifiedPhotoGrid';
import { GroupedSection } from '../components';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';
import {
    confirmAction,
    convertDocumentPickerAssetToFile,
    formatFileSize,
    getFileIcon,
    getSafeDownloadUrl,
    uploadFileRaw
} from '../utils/fileManagement';
import { FileViewer } from '../components/fileManagement/FileViewer';
import { FileDetailsModal } from '../components/fileManagement/FileDetailsModal';
import { UploadPreview } from '../components/fileManagement/UploadPreview';
import { fileManagementStyles } from '../components/fileManagement/styles';

// Exporting props & callback types so external callers (e.g. showBottomSheet config objects) can annotate
export type OnConfirmFileSelection = (files: FileMetadata[]) => void;

// Animated button component for smooth transitions
const AnimatedButton: React.FC<{
    isSelected: boolean;
    onPress: () => void;
    icon: string;
    primaryColor: string;
    textColor: string;
    style: any;
}> = ({ isSelected, onPress, icon, primaryColor, textColor, style }) => {
    const animatedValue = useRef(new Animated.Value(isSelected ? 1 : 0)).current;

    useEffect(() => {
        Animated.timing(animatedValue, {
            toValue: isSelected ? 1 : 0,
            duration: 200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
        }).start();
    }, [isSelected, animatedValue]);

    const backgroundColor = animatedValue.interpolate({
        inputRange: [0, 1],
        outputRange: ['transparent', primaryColor],
    });

    const iconColor = animatedValue.interpolate({
        inputRange: [0, 1],
        outputRange: [textColor, '#FFFFFF'],
    });

    return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
            <Animated.View
                style={[
                    style,
                    {
                        backgroundColor,
                    },
                ]}
            >
                <Animated.View>
                    <MaterialCommunityIcons
                        name={icon as any}
                        size={16}
                        color={isSelected ? '#FFFFFF' : textColor}
                    />
                </Animated.View>
            </Animated.View>
        </TouchableOpacity>
    );
};

export interface FileManagementScreenProps extends BaseScreenProps {
    userId?: string;
    // Enable selection mode (acts like a picker). When true, opening a file selects it instead of showing viewer
    selectMode?: boolean;
    // Allow selecting multiple files; only used if selectMode is true
    multiSelect?: boolean;
    // Callback when a file is selected (single select mode)
    onSelect?: (file: FileMetadata) => void;
    // Callback when confirm pressed in multi-select mode
    onConfirmSelection?: OnConfirmFileSelection;
    // Initial selected file IDs for multi-select
    initialSelectedIds?: string[];
    maxSelection?: number;
    disabledMimeTypes?: string[];
    /**
     * What to do after a single selection (non-multiSelect) is made.
     * 'close' (default) will dismiss the bottom sheet via onClose.
     * 'back' will navigate back to the previous screen (e.g., return to AccountSettings without closing sheet).
     * 'none' will keep the picker open (caller can manually close or navigate).
     */
    afterSelect?: 'close' | 'back' | 'none';
    allowUploadInSelectMode?: boolean;
    /**
     * Default visibility for uploaded files in this screen
     * Useful for third-party apps that want files to be public (e.g., GIF selector)
     */
    defaultVisibility?: 'private' | 'public' | 'unlisted';
    /**
     * Link context for tracking file usage by third-party apps
     * When provided, selected files will be linked to this entity
     */
    linkContext?: {
        app: string;           // App identifier (e.g., 'chat-app', 'post-composer')
        entityType: string;    // Type of entity (e.g., 'message', 'post', 'profile')
        entityId: string;      // Unique ID of the entity using this file
        webhookUrl?: string;   // Optional webhook URL to receive file events
    };
}


const FileManagementScreen: React.FC<FileManagementScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
    userId,
    containerWidth = 400, // Fallback for when not provided by the router
    selectMode = false,
    multiSelect = false,
    onSelect,
    onConfirmSelection,
    initialSelectedIds = [],
    maxSelection,
    disabledMimeTypes = [],
    afterSelect = 'close',
    allowUploadInSelectMode = true,
    defaultVisibility = 'private',
    linkContext,
    // OxyContext values from props (instead of useOxy hook)
    user,
    oxyServices,
}) => {
    const files = useFiles();
    const uploading = useUploadingStore();
    const uploadProgress = useUploadAggregateProgress();
    const deleting = useDeletingStore();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [paging, setPaging] = useState({ offset: 0, limit: 40, total: 0, hasMore: true, loadingMore: false });
    const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);
    const [showFileDetails, setShowFileDetails] = useState(false);
    // In selectMode we never open the detailed viewer
    const [openedFile, setOpenedFile] = useState<FileMetadata | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [loadingFileContent, setLoadingFileContent] = useState(false);
    const [showFileDetailsInViewer, setShowFileDetailsInViewer] = useState(false);
    const [isPickingDocument, setIsPickingDocument] = useState(false);
    const [viewMode, setViewMode] = useState<'all' | 'photos' | 'videos' | 'documents' | 'audio'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'date' | 'size' | 'name' | 'type'>('date');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [pendingFiles, setPendingFiles] = useState<Array<{ file: File | Blob; preview?: string; size: number; name: string; type: string }>>([]);
    const [showUploadPreview, setShowUploadPreview] = useState(false);
    // Derived filtered and sorted files (avoid setState loops)
    const filteredFiles = useMemo(() => {
        let filteredByMode = files;
        if (viewMode === 'photos') {
            filteredByMode = files.filter(file => file.contentType.startsWith('image/'));
        } else if (viewMode === 'videos') {
            filteredByMode = files.filter(file => file.contentType.startsWith('video/'));
        } else if (viewMode === 'documents') {
            filteredByMode = files.filter(file =>
                file.contentType.includes('pdf') ||
                file.contentType.includes('document') ||
                file.contentType.includes('text') ||
                file.contentType.includes('msword') ||
                file.contentType.includes('excel') ||
                file.contentType.includes('spreadsheet') ||
                file.contentType.includes('presentation') ||
                file.contentType.includes('powerpoint')
            );
        } else if (viewMode === 'audio') {
            filteredByMode = files.filter(file => file.contentType.startsWith('audio/'));
        }

        let filtered = filteredByMode;
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filteredByMode.filter(file =>
                file.filename.toLowerCase().includes(query) ||
                file.contentType.toLowerCase().includes(query) ||
                (file.metadata?.description && file.metadata.description.toLowerCase().includes(query))
            );
        }

        // Sort files
        const sorted = [...filtered].sort((a, b) => {
            let comparison = 0;
            if (sortBy === 'date') {
                const dateA = new Date(a.uploadDate || 0).getTime();
                const dateB = new Date(b.uploadDate || 0).getTime();
                comparison = dateA - dateB;
            } else if (sortBy === 'size') {
                comparison = (a.length || 0) - (b.length || 0);
            } else if (sortBy === 'name') {
                comparison = (a.filename || '').localeCompare(b.filename || '');
            } else if (sortBy === 'type') {
                comparison = (a.contentType || '').localeCompare(b.contentType || '');
            }
            return sortOrder === 'asc' ? comparison : -comparison;
        });

        return sorted;
    }, [files, searchQuery, viewMode, sortBy, sortOrder]);
    const [photoDimensions, setPhotoDimensions] = useState<{ [key: string]: { width: number, height: number } }>({});
    const [loadingDimensions, setLoadingDimensions] = useState(false);
    const uploadStartRef = useRef<number | null>(null);
    const MIN_BANNER_MS = 600;
    // Selection state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedIds));
    const [lastSelectedFileId, setLastSelectedFileId] = useState<string | null>(null);
    const scrollViewRef = useRef<ScrollView>(null);
    const photoScrollViewRef = useRef<ScrollView>(null);
    const itemRefs = useRef<Map<string, number>>(new Map()); // Track item positions
    const containerRef = useRef<View>(null);
    useEffect(() => {
        if (initialSelectedIds && initialSelectedIds.length) {
            setSelectedIds(new Set(initialSelectedIds));
        }
    }, [initialSelectedIds]);

    const toggleSelect = useCallback(async (file: FileMetadata) => {
        // Allow selection in regular mode for bulk operations
        // if (!selectMode) return;
        if (disabledMimeTypes.length) {
            const blocked = disabledMimeTypes.some(mt => file.contentType === mt || file.contentType.startsWith(mt.endsWith('/') ? mt : mt + '/'));
            if (blocked) {
                toast.error('This file type cannot be selected');
                return;
            }
        }

        // Update file visibility if it differs from defaultVisibility
        const fileVisibility = (file.metadata as any)?.visibility || 'private';
        if (fileVisibility !== defaultVisibility) {
            try {
                await oxyServices.assetUpdateVisibility(file.id, defaultVisibility);
            } catch (error) {
                // Continue anyway - selection shouldn't fail if visibility update fails
            }
        }

        // Track the selected file for scrolling
        setLastSelectedFileId(file.id);

        // Link file to entity if linkContext is provided
        if (linkContext) {
            try {
                await oxyServices.assetLink(
                    file.id,
                    linkContext.app,
                    linkContext.entityType,
                    linkContext.entityId,
                    defaultVisibility,
                    (linkContext as any).webhookUrl
                );
            } catch (error) {
                // Continue anyway - selection shouldn't fail if linking fails
            }
        }

        if (!multiSelect) {
            onSelect?.(file);
            if (afterSelect === 'back') {
                goBack?.();
            } else if (afterSelect === 'close') {
                onClose?.();
            }
            return;
        }
        setSelectedIds(prev => {
            const next = new Set(prev);
            const already = next.has(file.id);
            if (!already) {
                if (maxSelection && next.size >= maxSelection) {
                    toast.error(`You can select up to ${maxSelection}`);
                    return prev;
                }
                next.add(file.id);
            } else {
                next.delete(file.id);
            }
            return next;
        });
    }, [selectMode, multiSelect, onSelect, onClose, goBack, disabledMimeTypes, maxSelection, afterSelect, defaultVisibility, oxyServices, linkContext]);

    const confirmMultiSelection = useCallback(async () => {
        if (!selectMode || !multiSelect) return;
        const map: Record<string, FileMetadata> = {};
        files.forEach(f => { map[f.id] = f; });
        const chosen = Array.from(selectedIds).map(id => map[id]).filter(Boolean);

        // Update visibility and link files if needed
        const updatePromises = chosen.map(async (file) => {
            // Update visibility if needed
            const fileVisibility = (file.metadata as any)?.visibility || 'private';
            if (fileVisibility !== defaultVisibility) {
                try {
                    await oxyServices.assetUpdateVisibility(file.id, defaultVisibility);
                } catch (error) {
                    // Visibility update failed, continue with selection
                }
            }

            // Link file to entity if linkContext provided
            if (linkContext) {
                try {
                    await oxyServices.assetLink(
                        file.id,
                        linkContext.app,
                        linkContext.entityType,
                        linkContext.entityId,
                        defaultVisibility,
                        (linkContext as any).webhookUrl
                    );
                } catch (error) {
                    // File linking failed, continue with selection
                }
            }
        });

        // Wait for all updates (but don't block on failures)
        await Promise.allSettled(updatePromises);

        onConfirmSelection?.(chosen);
        onClose?.();
    }, [selectMode, multiSelect, selectedIds, files, onConfirmSelection, onClose, defaultVisibility, oxyServices, linkContext]);

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
    const getSafeDownloadUrlCallback = useCallback(
        (file: FileMetadata, variant: string = 'thumb') => {
            return getSafeDownloadUrl(file, variant, (fileId: string, variant?: string) => oxyServices.getFileDownloadUrl(fileId, variant));
        },
        [oxyServices]
    );

    // Use centralized theme styles hook for consistency
    const colorScheme = useColorScheme();
    const baseThemeStyles = useThemeStyles(theme, colorScheme);
    // FileManagementScreen uses a slightly different light background
    const themeStyles = useMemo(() => ({
        ...baseThemeStyles,
        backgroundColor: baseThemeStyles.isDarkTheme ? baseThemeStyles.backgroundColor : '#f2f2f2',
    }), [baseThemeStyles]);

    // Extract commonly used theme variables
    const backgroundColor = themeStyles.backgroundColor;
    const borderColor = themeStyles.borderColor;

    const targetUserId = userId || user?.id;

    const storeSetUploading = useFileStore(s => s.setUploading);
    const storeSetUploadProgress = useFileStore(s => s.setUploadProgress);
    const storeSetDeleting = useFileStore(s => s.setDeleting);

    const loadFiles = useCallback(async (mode: 'initial' | 'refresh' | 'silent' | 'more' = 'initial') => {
        if (!targetUserId) return;

        try {
            if (mode === 'refresh') {
                setRefreshing(true);
            } else if (mode === 'initial') {
                setLoading(true);
                setPaging(p => ({ ...p, offset: 0, hasMore: true }));
            } else if (mode === 'more') {
                // Prevent duplicate fetches
                setPaging(p => ({ ...p, loadingMore: true }));
            }
            const currentPaging = mode === 'more' ? (prevPagingRef.current ?? paging) : paging;
            const effectiveOffset = mode === 'more' ? currentPaging.offset + currentPaging.limit : 0;
            const response = await oxyServices.listUserFiles(currentPaging.limit, effectiveOffset);
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
            if (mode === 'more') {
                // append
                useFileStore.getState().setFiles(assets, { merge: true });
                setPaging(p => ({
                    ...p,
                    offset: effectiveOffset,
                    total: response.total || (effectiveOffset + assets.length),
                    hasMore: response.hasMore,
                    loadingMore: false,
                }));
            } else {
                useFileStore.getState().setFiles(assets, { merge: false });
                setPaging(p => ({
                    ...p,
                    offset: 0,
                    total: response.total || assets.length,
                    hasMore: response.hasMore,
                    loadingMore: false,
                }));
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to load files');
        } finally {
            setLoading(false);
            setRefreshing(false);
            setPaging(p => ({ ...p, loadingMore: false }));
        }
    }, [targetUserId, oxyServices, paging]);

    // Keep a ref to avoid stale closure when calculating next offset
    const prevPagingRef = useRef(paging);
    useEffect(() => { prevPagingRef.current = paging; }, [paging]);

    // (removed effect; filteredFiles is memoized)

    // Load photo dimensions for justified grid - unified approach using Image.getSize
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
                        const downloadUrl = getSafeDownloadUrlCallback(photo, 'thumb');

                        // Unified approach using Image.getSize (works on all platforms)
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
            // Photo dimensions loading failed, continue without dimensions
        } finally {
            setLoadingDimensions(false);
        }
    }, [getSafeDownloadUrlCallback, photoDimensions]);

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

    const processFileUploads = async (selectedFiles: File[]): Promise<FileMetadata[]> => {
        if (selectedFiles.length === 0) return [];
        if (!targetUserId) return []; // Guard clause to ensure userId is defined
        const uploadedFiles: FileMetadata[] = [];
        try {
            storeSetUploadProgress({ current: 0, total: selectedFiles.length });
            const maxSize = 50 * 1024 * 1024; // 50MB
            const oversizedFiles = selectedFiles.filter(file => file.size > maxSize);
            if (oversizedFiles.length > 0) {
                const fileList = oversizedFiles.map(f => f.name).join(', ');
                toast.error(`The following files are too large (max 50MB): ${fileList}`);
                return [];
            }
            let successCount = 0;
            let failureCount = 0;
            const errors: string[] = [];
            for (let i = 0; i < selectedFiles.length; i++) {
                storeSetUploadProgress({ current: i + 1, total: selectedFiles.length });
                const raw = selectedFiles[i];
                const fileName = raw.name || `file-${i + 1}`;
                const optimisticId = `temp-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`; // Unique ID per file

                try {
                    // Validate file before upload
                    if (!raw || !raw.name || raw.size === undefined || raw.size <= 0) {
                        const errorMsg = `Invalid file: ${fileName}`;
                        console.error('Upload validation failed:', { file: raw, error: errorMsg });
                        failureCount++;
                        errors.push(`${fileName}: Invalid file (missing name or size)`);
                        continue;
                    }

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

                    const result = await uploadFileRaw(raw, targetUserId, oxyServices, defaultVisibility);

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
                        uploadedFiles.push(merged);
                        successCount++;
                    } else {
                        // Fallback: will reconcile on later list refresh
                        useFileStore.getState().updateFile(optimisticId, { metadata: { uploading: false } as any });
                        console.warn('Upload completed but no file data returned:', { fileName, result });
                        // Still count as success if upload didn't throw
                        successCount++;
                    }
                } catch (error: any) {
                    failureCount++;
                    const errorMessage = error.message || error.toString() || 'Upload failed';
                    const fullError = `${fileName}: ${errorMessage}`;
                    errors.push(fullError);
                    console.error('File upload failed:', {
                        fileName,
                        fileSize: raw.size,
                        fileType: raw.type,
                        error: errorMessage,
                        stack: error.stack
                    });

                    // Remove optimistic file on error (use the same optimisticId from above)
                    useFileStore.getState().removeFile(optimisticId);
                }
            }

            // Show success/error messages
            if (successCount > 0) {
                toast.success(`${successCount} file(s) uploaded successfully`);
            }
            if (failureCount > 0) {
                // Show detailed error message with first few errors
                const errorDetails = errors.length > 0
                    ? `\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? `\n...and ${errors.length - 3} more` : ''}`
                    : '';
                toast.error(`${failureCount} file(s) failed to upload${errorDetails}`);
            }
            // Silent background refresh to ensure metadata/variants updated
            setTimeout(() => { loadFiles('silent'); }, 1200);
        } catch (error: any) {
            toast.error(error.message || 'Failed to upload files');
        } finally {
            storeSetUploadProgress(null);
        }
        return uploadedFiles;
    };

    const handleFileSelection = useCallback(async (selectedFiles: File[] | any[]) => {
        const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
        const processedFiles: Array<{ file: File | Blob; preview?: string; size: number; name: string; type: string }> = [];

        for (const file of selectedFiles) {
            // Validate file has required properties
            if (!file) {
                console.error('Invalid file: file is null or undefined');
                toast.error('Invalid file: file is missing');
                continue;
            }

            if (!file.name || typeof file.name !== 'string') {
                console.error('Invalid file: missing or invalid name property', file);
                toast.error('Invalid file: missing file name');
                continue;
            }

            if (file.size === undefined || file.size === null || isNaN(file.size)) {
                console.error('Invalid file: missing or invalid size property', file);
                toast.error(`Invalid file "${file.name || 'unknown'}": missing file size`);
                continue;
            }

            if (file.size <= 0) {
                console.error('Invalid file: file size is zero or negative', file);
                toast.error(`File "${file.name}" is empty`);
                continue;
            }

            // Validate file size
            if (file.size > MAX_FILE_SIZE) {
                toast.error(`"${file.name}" is too large. Maximum file size is ${formatFileSize(MAX_FILE_SIZE)}`);
                continue;
            }

            // Ensure file has a type property
            const fileType = file.type || 'application/octet-stream';

            // Generate preview for images - unified approach
            let preview: string | undefined;
            if (fileType.startsWith('image/')) {
                // Try to use file URI from expo-document-picker if available (works on all platforms)
                const fileUri = (file as any).uri;
                if (fileUri && typeof fileUri === 'string' &&
                    (fileUri.startsWith('file://') || fileUri.startsWith('content://') ||
                        fileUri.startsWith('http://') || fileUri.startsWith('https://') ||
                        fileUri.startsWith('blob:'))) {
                    preview = fileUri;
                } else {
                    // Fallback: create blob URL if possible (works on web)
                    try {
                        if (file instanceof File || file instanceof Blob) {
                            preview = URL.createObjectURL(file);
                        }
                    } catch (error: any) {
                        console.warn('Failed to create preview URL:', error);
                        // Preview is optional, continue without it
                    }
                }
            }

            processedFiles.push({
                file,
                preview,
                size: file.size,
                name: file.name,
                type: fileType
            });
        }

        if (processedFiles.length === 0) {
            toast.error('No valid files to upload');
            return;
        }

        // Show preview modal for user to review files before upload
        setPendingFiles(processedFiles);
        setShowUploadPreview(true);
    }, []);

    const handleConfirmUpload = async () => {
        if (pendingFiles.length === 0) return;

        setShowUploadPreview(false);
        uploadStartRef.current = Date.now();
        storeSetUploading(true);
        storeSetUploadProgress(null);

        try {
            const filesToUpload = pendingFiles.map(pf => pf.file as File);
            storeSetUploadProgress({ current: 0, total: filesToUpload.length });
            const uploadedFiles = await processFileUploads(filesToUpload);

            // Cleanup preview URLs
            pendingFiles.forEach(pf => {
                if (pf.preview) {
                    URL.revokeObjectURL(pf.preview);
                }
            });
            setPendingFiles([]);

            // If in selectMode, automatically select the uploaded file(s)
            if (selectMode && uploadedFiles.length > 0) {
                // Wait a bit for the file store to update and ensure file is available
                setTimeout(() => {
                    const fileToSelect = uploadedFiles[0];
                    if (!multiSelect && fileToSelect) {
                        // Single select mode - directly call onSelect callback
                        onSelect?.(fileToSelect);
                        if (afterSelect === 'back') {
                            goBack?.();
                        } else if (afterSelect === 'close') {
                            onClose?.();
                        }
                    } else if (multiSelect) {
                        // Multi-select mode - add all uploaded files to selection
                        uploadedFiles.forEach(file => {
                            if (!selectedIds.has(file.id)) {
                                setSelectedIds(prev => new Set(prev).add(file.id));
                            }
                        });
                    }
                }, 500);
            }

            endUpload();
        } catch (error: any) {
            toast.error(error.message || 'Failed to upload files');
            endUpload();
        }
    };

    const handleCancelUpload = () => {
        // Cleanup preview URLs
        pendingFiles.forEach(pf => {
            if (pf.preview) {
                URL.revokeObjectURL(pf.preview);
            }
        });
        setPendingFiles([]);
        setShowUploadPreview(false);
    };

    const removePendingFile = (index: number) => {
        const file = pendingFiles[index];
        if (file.preview) {
            URL.revokeObjectURL(file.preview);
        }
        const updated = pendingFiles.filter((_, i) => i !== index);
        setPendingFiles(updated);
        if (updated.length === 0) {
            setShowUploadPreview(false);
        }
    };

    /**
     * Handle file upload - opens document picker and processes selected files
     * Expo 54 compatible - works on web, iOS, and Android
     */
    const handleFileUpload = async () => {
        // Prevent concurrent document picker calls
        if (isPickingDocument) {
            toast.error('Please wait for the current file selection to complete');
            return;
        }

        try {
            setIsPickingDocument(true);
            
            // Dynamically import expo-document-picker (Expo 54 supports it on all platforms)
            const DocumentPicker = await import('expo-document-picker').catch(() => null);

            if (!DocumentPicker || !DocumentPicker.getDocumentAsync) {
                toast.error('File picker not available. Please install expo-document-picker');
                return;
            }

            // Use getDocumentAsync directly - it will handle platform availability
            const result = await DocumentPicker.getDocumentAsync({
                type: '*/*',
                multiple: true,
                copyToCacheDirectory: true,
            });

            if (result.canceled) {
                setIsPickingDocument(false);
                return;
            }

            if (!result.assets || result.assets.length === 0) {
                setIsPickingDocument(false);
                toast.error('No files were selected');
                return;
            }

            // Convert expo document picker results to File-like objects
            // According to Expo 54 docs, expo-document-picker returns assets with:
            // - uri: file URI (file://, content://, or blob URL)
            // - name: file name
            // - size: file size in bytes
            // - mimeType: MIME type of the file
            // - file: (optional) native File object (usually only on web)
            const files: File[] = [];
            const errors: string[] = [];

            // Process files in parallel for better performance
            // This allows multiple files to be converted simultaneously
            const conversionPromises = result.assets.map((doc, index) =>
                convertDocumentPickerAssetToFile(doc, index)
                    .then((file) => {
                        if (file) {
                            // Validate file has required properties before adding
                            if (!file.name || file.size === undefined) {
                                errors.push(`File "${doc.name || 'file'}" is invalid: missing required properties`);
                                return null;
                            }
                            return file;
                        }
                        return null;
                    })
                    .catch((error: any) => {
                        errors.push(`File "${doc.name || 'file'}": ${error.message || 'Failed to process'}`);
                        return null;
                    })
            );

            const convertedFiles = await Promise.all(conversionPromises);

            // Filter out null values
            for (const file of convertedFiles) {
                if (file) {
                    files.push(file);
                }
            }

            // Show errors if any
            if (errors.length > 0) {
                const errorMessage = errors.slice(0, 3).join('\n') + (errors.length > 3 ? `\n...and ${errors.length - 3} more` : '');
                toast.error(`Failed to load some files:\n${errorMessage}`);
            }

            // Process successfully converted files
            if (files.length > 0) {
                await handleFileSelection(files);
            } else {
                // Files were selected but none could be converted
                toast.error('No files could be processed. Please try selecting files again.');
            }
        } catch (error: any) {
            console.error('File upload error:', error);
            if (error.message?.includes('expo-document-picker') || error.message?.includes('Different document picking in progress')) {
                if (error.message?.includes('Different document picking in progress')) {
                    toast.error('Please wait for the current file selection to complete');
                } else {
                    toast.error('File picker not available. Please install expo-document-picker');
                }
            } else {
                toast.error(error.message || 'Failed to select files');
            }
        } finally {
            // Always reset the picking state, even if there was an error
            setIsPickingDocument(false);
        }
    };

    const handleFileDelete = async (fileId: string, filename: string) => {
        // Use platform-aware confirmation dialog
        const confirmed = await confirmAction(
            `Are you sure you want to delete "${filename}"? This action cannot be undone.`,
            'Delete File',
            'Delete',
            'Cancel'
        );

        if (!confirmed) {
            return;
        }

        try {
            storeSetDeleting(fileId);
            await oxyServices.deleteFile(fileId);

            toast.success('File deleted successfully');

            // Reload files after successful deletion
            // Optimistic remove
            useFileStore.getState().removeFile(fileId);
            // Silent background reconcile
            setTimeout(() => loadFiles('silent'), 800);
        } catch (error: any) {

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

    const handleBulkDelete = useCallback(async () => {
        if (selectedIds.size === 0) return;

        const fileMap: Record<string, FileMetadata> = {};
        files.forEach(f => { fileMap[f.id] = f; });
        const selectedFiles = Array.from(selectedIds).map(id => fileMap[id]).filter(Boolean);

        const confirmed = await confirmAction(
            `Are you sure you want to delete ${selectedFiles.length} file(s)? This action cannot be undone.`,
            'Delete Files',
            'Delete',
            'Cancel'
        );

        if (!confirmed) return;

        try {
            const deletePromises = Array.from(selectedIds).map(async (fileId) => {
                try {
                    await oxyServices.deleteFile(fileId);
                    useFileStore.getState().removeFile(fileId);
                    return { success: true, fileId };
                } catch (error: any) {
                    return { success: false, fileId, error };
                }
            });

            const results = await Promise.allSettled(deletePromises);
            const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failed = results.length - successful;

            if (successful > 0) {
                toast.success(`${successful} file(s) deleted successfully`);
            }
            if (failed > 0) {
                toast.error(`${failed} file(s) failed to delete`);
            }

            setSelectedIds(new Set());
            setTimeout(() => loadFiles('silent'), 800);
        } catch (error: any) {
            toast.error(error.message || 'Failed to delete files');
        }
    }, [selectedIds, files, oxyServices, loadFiles]);

    const handleBulkVisibilityChange = useCallback(async (visibility: 'private' | 'public' | 'unlisted') => {
        if (selectedIds.size === 0) return;

        try {
            const updatePromises = Array.from(selectedIds).map(async (fileId) => {
                try {
                    await oxyServices.assetUpdateVisibility(fileId, visibility);
                    return { success: true, fileId };
                } catch (error: any) {
                    return { success: false, fileId, error };
                }
            });

            const results = await Promise.allSettled(updatePromises);
            const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failed = results.length - successful;

            if (successful > 0) {
                toast.success(`${successful} file(s) visibility updated to ${visibility}`);
                // Update file metadata in store
                Array.from(selectedIds).forEach(fileId => {
                    useFileStore.getState().updateFile(fileId, {
                        metadata: { ...files.find(f => f.id === fileId)?.metadata, visibility }
                    } as any);
                });
            }
            if (failed > 0) {
                toast.error(`${failed} file(s) failed to update visibility`);
            }

            setTimeout(() => loadFiles('silent'), 800);
        } catch (error: any) {
            toast.error(error.message || 'Failed to update visibility');
        }
    }, [selectedIds, oxyServices, files, loadFiles]);

    // Unified download function - works on all platforms
    const handleFileDownload = async (fileId: string, filename: string) => {
        try {
            // Try to use the download URL with a simple approach
            // On web, this creates a download link. On mobile, it opens the URL.
            const downloadUrl = oxyServices.getFileDownloadUrl(fileId);

            // For web platforms, use link download
            if (typeof window !== 'undefined' && window.document) {
                try {
                    // Try simple link download first
                    const link = document.createElement('a');
                    link.href = downloadUrl;
                    link.download = filename;
                    link.target = '_blank';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    toast.success('File download started');
                } catch (linkError) {
                    // Fallback to authenticated download
                    const blob = await oxyServices.getFileContentAsBlob(fileId);
                    const url = URL.createObjectURL(blob);

                    const link = document.createElement('a');
                    link.href = url;
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    // Clean up the blob URL
                    URL.revokeObjectURL(url);
                    toast.success('File downloaded successfully');
                }
            } else {
                // For mobile, open the URL (user can save from browser)
                // Note: This is a simplified approach - for full mobile support,
                // consider using expo-file-system or react-native-fs
                toast.info('Please use your browser to download the file');
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to download file');
        }
    };


    const handleFileOpen = async (file: FileMetadata) => {
        if (selectMode) {
            toggleSelect(file);
            return;
        }
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
        const downloadUrl = getSafeDownloadUrlCallback(photo, 'thumb');

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
                    fileManagementStyles.simplePhotoItem,
                    {
                        width: itemWidth,
                        height: itemWidth,
                        marginRight: (index + 1) % itemsPerRow === 0 ? 0 : 4,
                        ...(selectMode && selectedIds.has(photo.id) ? { borderWidth: 2, borderColor: themeStyles.primaryColor } : {})
                    }
                ]}
                onPress={() => handleFileOpen(photo)}
                activeOpacity={0.8}
            >
                <View style={fileManagementStyles.simplePhotoContainer}>
                    <ExpoImage
                        source={{ uri: downloadUrl }}
                        style={fileManagementStyles.simplePhotoImage}
                        contentFit="cover"
                        transition={120}
                        cachePolicy="memory-disk"
                        onError={() => {
                            // Photo failed to load, will show placeholder
                        }}
                        accessibilityLabel={photo.filename}
                    />
                    {selectMode && (
                        <View style={fileManagementStyles.selectionBadge}>
                            <Ionicons name={selectedIds.has(photo.id) ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selectedIds.has(photo.id) ? themeStyles.primaryColor : themeStyles.textColor} />
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        );
    }, [oxyServices, containerWidth, selectMode, selectedIds, themeStyles.primaryColor, themeStyles.textColor]);

    const renderJustifiedPhotoItem = useCallback((photo: FileMetadata, width: number, height: number, isLast: boolean) => {
        const downloadUrl = getSafeDownloadUrlCallback(photo, 'thumb');

        return (
            <TouchableOpacity
                key={photo.id}
                style={[
                    fileManagementStyles.justifiedPhotoItem,
                    {
                        width,
                        height,
                        ...(selectMode && selectedIds.has(photo.id) ? { borderWidth: 2, borderColor: themeStyles.primaryColor } : {}),
                        ...(selectMode && multiSelect && selectedIds.size > 0 && !selectedIds.has(photo.id) ? { opacity: 0.4 } : {}),
                    },
                ]}
                onPress={() => handleFileOpen(photo)}
                activeOpacity={0.8}
            >
                <View style={fileManagementStyles.justifiedPhotoContainer}>
                    <ExpoImage
                        source={{ uri: downloadUrl }}
                        style={fileManagementStyles.justifiedPhotoImage}
                        contentFit="cover"
                        transition={120}
                        cachePolicy="memory-disk"
                        onError={() => {
                            // Photo failed to load, will show placeholder
                        }}
                        accessibilityLabel={photo.filename}
                    />
                    {selectMode && (
                        <View style={fileManagementStyles.selectionBadge}>
                            <Ionicons name={selectedIds.has(photo.id) ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selectedIds.has(photo.id) ? themeStyles.primaryColor : themeStyles.textColor} />
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        );
    }, [oxyServices, selectMode, selectedIds, multiSelect, themeStyles.primaryColor, themeStyles.textColor]);

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
                style={[fileManagementStyles.fileItem, { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor }, selectMode && selectedIds.has(file.id) && { borderColor: themeStyles.primaryColor, borderWidth: 2 }]}
            >
                <TouchableOpacity
                    style={fileManagementStyles.fileContent}
                    onPress={() => handleFileOpen(file)}
                >
                    {/* Preview Thumbnail */}
                    <View style={fileManagementStyles.filePreviewContainer}>
                        {hasPreview ? (
                            <View style={fileManagementStyles.filePreview}>
                                {isImage && (
                                    <ExpoImage
                                        source={{ uri: getSafeDownloadUrlCallback(file, 'thumb') }}
                                        style={fileManagementStyles.previewImage}
                                        contentFit="cover"
                                        transition={120}
                                        cachePolicy="memory-disk"
                                        onError={() => {
                                            // Image preview failed to load
                                        }}
                                        accessibilityLabel={file.filename}
                                    />
                                )}
                                {isPDF && (
                                    <View style={fileManagementStyles.pdfPreview}>
                                        <Ionicons name="document" size={32} color={themeStyles.primaryColor} />
                                        <Text style={[fileManagementStyles.pdfLabel, { color: themeStyles.primaryColor }]}>PDF</Text>
                                    </View>
                                )}
                                {isVideo && (
                                    <View style={fileManagementStyles.videoPreviewWrapper}>
                                        <ExpoImage
                                            source={{ uri: getSafeDownloadUrlCallback(file, 'thumb') }}
                                            style={fileManagementStyles.videoPosterImage}
                                            contentFit="cover"
                                            transition={120}
                                            cachePolicy="memory-disk"
                                            onError={(_: any) => {
                                                // If thumbnail not available, we still show icon overlay
                                            }}
                                            accessibilityLabel={file.filename + ' video thumbnail'}
                                        />
                                        <View style={fileManagementStyles.videoOverlay}>
                                            <Ionicons name="play" size={24} color="#FFFFFF" />
                                        </View>
                                    </View>
                                )}
                                {/* Fallback icon (hidden by default for images) */}
                                <View
                                    style={[fileManagementStyles.fallbackIcon, { display: isImage ? 'none' : 'flex' }]}
                                >
                                    <Ionicons
                                        name={getFileIcon(file.contentType) as any}
                                        size={32}
                                        color={themeStyles.primaryColor}
                                    />
                                </View>

                                {selectMode && (
                                    <View style={fileManagementStyles.selectionBadge}>
                                        <Ionicons name={selectedIds.has(file.id) ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selectedIds.has(file.id) ? themeStyles.primaryColor : themeStyles.textColor} />
                                    </View>
                                )}
                            </View>
                        ) : (
                            <View style={fileManagementStyles.fileIconContainer}>
                                <Ionicons
                                    name={getFileIcon(file.contentType) as any}
                                    size={32}
                                    color={themeStyles.primaryColor}
                                />
                            </View>
                        )}
                    </View>

                    <View style={fileManagementStyles.fileInfo}>
                        <Text style={[fileManagementStyles.fileName, { color: themeStyles.textColor }]} numberOfLines={1}>
                            {file.filename}
                        </Text>
                        <Text style={[fileManagementStyles.fileDetails, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {formatFileSize(file.length)} • {new Date(file.uploadDate).toLocaleDateString()}
                        </Text>
                        {file.metadata?.description && (
                            <Text
                                style={[fileManagementStyles.fileDescription, { color: themeStyles.isDarkTheme ? '#AAAAAA' : '#888888' }]}
                                numberOfLines={2}
                            >
                                {file.metadata.description}
                            </Text>
                        )}
                    </View>
                </TouchableOpacity>

                {!selectMode && (
                    <View style={fileManagementStyles.fileActions}>
                        {/* Preview button for supported files */}
                        {hasPreview && (
                            <TouchableOpacity
                                style={[fileManagementStyles.actionButton, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}
                                onPress={() => handleFileOpen(file)}
                            >
                                <Ionicons name="eye" size={20} color={themeStyles.primaryColor} />
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            style={[fileManagementStyles.actionButton, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}
                            onPress={() => handleFileDownload(file.id, file.filename)}
                        >
                            <Ionicons name="download" size={20} color={themeStyles.primaryColor} />
                        </TouchableOpacity>

                        {/* Always show delete button for debugging */}
                        <TouchableOpacity
                            style={[fileManagementStyles.actionButton, { backgroundColor: themeStyles.isDarkTheme ? '#400000' : '#FFEBEE' }]}
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
                )}
            </View>
        );
    };

    // GroupedSection-based file items (for 'all' view) replacing legacy flat list look
    const groupedFileItems = useMemo(() => {
        // filteredFiles is already sorted, so just use it directly
        const sortedFiles = filteredFiles;

        // Store file positions for scrolling
        sortedFiles.forEach((file, index) => {
            itemRefs.current.set(file.id, index);
        });

        return sortedFiles.map((file) => {
            const isImage = file.contentType.startsWith('image/');
            const isPDF = file.contentType.includes('pdf');
            const isVideo = file.contentType.startsWith('video/');
            const hasPreview = isImage || isPDF || isVideo;
            const isSelected = selectedIds.has(file.id);

            // Create customIcon for preview thumbnails (36x36 to match GroupedItem iconContainer)
            let customIcon: React.ReactNode | undefined;
            if (hasPreview) {
                if (isImage) {
                    customIcon = (
                        <View style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden' }}>
                            <ExpoImage
                                source={{ uri: getSafeDownloadUrlCallback(file, 'thumb') }}
                                style={{ width: 36, height: 36 }}
                                contentFit="cover"
                                transition={120}
                                cachePolicy="memory-disk"
                                onError={() => {
                                    // Image preview failed to load - will fallback to icon
                                }}
                                accessibilityLabel={file.filename}
                            />
                        </View>
                    );
                } else if (isVideo) {
                    customIcon = (
                        <View style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000000', position: 'relative' }}>
                            <ExpoImage
                                source={{ uri: getSafeDownloadUrlCallback(file, 'thumb') }}
                                style={{ width: 36, height: 36 }}
                                contentFit="cover"
                                transition={120}
                                cachePolicy="memory-disk"
                                onError={(_: any) => {
                                    // If thumbnail not available, we still show icon overlay
                                }}
                                accessibilityLabel={file.filename + ' video thumbnail'}
                            />
                            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' }}>
                                <Ionicons name="play" size={16} color="#FFFFFF" />
                            </View>
                        </View>
                    );
                } else if (isPDF) {
                    customIcon = (
                        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF6B6B20' }}>
                            <Ionicons name="document" size={20} color={themeStyles.primaryColor} />
                        </View>
                    );
                }
            }

            return {
                id: file.id,
                customIcon: customIcon,
                icon: !hasPreview ? getFileIcon(file.contentType) : undefined,
                iconColor: themeStyles.primaryColor,
                title: file.filename,
                subtitle: `${formatFileSize(file.length)} • ${new Date(file.uploadDate).toLocaleDateString()}`,
                theme: theme as 'light' | 'dark',
                onPress: () => {
                    // Support selection in regular mode with long press or if already selecting
                    if (!selectMode && selectedIds.size > 0) {
                        // If already in selection mode (some files selected), toggle selection
                        toggleSelect(file);
                    } else {
                        handleFileOpen(file);
                    }
                },
                onLongPress: !selectMode ? () => {
                    // Enable selection mode on long press
                    if (selectedIds.size === 0) {
                        setSelectedIds(new Set([file.id]));
                    } else {
                        toggleSelect(file);
                    }
                } : undefined,
                showChevron: false,
                dense: true,
                multiRow: !!file.metadata?.description,
                selected: (selectMode || selectedIds.size > 0) && isSelected,
                // Hide action buttons when selecting (in selectMode or bulk operations mode)
                customContent: (!selectMode && selectedIds.size === 0) ? (
                    <View style={fileManagementStyles.groupedActions}>
                        {(isImage || isVideo || file.contentType.includes('pdf')) && (
                            <TouchableOpacity
                                style={[fileManagementStyles.groupedActionBtn, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}
                                onPress={() => handleFileOpen(file)}
                            >
                                <Ionicons name="eye" size={18} color={themeStyles.primaryColor} />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            style={[fileManagementStyles.groupedActionBtn, { backgroundColor: themeStyles.isDarkTheme ? '#333333' : '#F0F0F0' }]}
                            onPress={() => handleFileDownload(file.id, file.filename)}
                        >
                            <Ionicons name="download" size={18} color={themeStyles.primaryColor} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[fileManagementStyles.groupedActionBtn, { backgroundColor: themeStyles.isDarkTheme ? '#400000' : '#FFEBEE' }]}
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
                ) : undefined,
                customContentBelow: file.metadata?.description ? (
                    <Text style={[fileManagementStyles.groupedDescription, { color: themeStyles.isDarkTheme ? '#AAAAAA' : '#666666' }]} numberOfLines={2}>
                        {file.metadata.description}
                    </Text>
                ) : undefined,
            } as any;
        });
    }, [filteredFiles, theme, themeStyles, deleting, handleFileDownload, handleFileDelete, handleFileOpen, getSafeDownloadUrlCallback, selectMode, selectedIds]);

    // Scroll to selected file after selection
    useEffect(() => {
        if (lastSelectedFileId && selectMode) {
            if (viewMode === 'all' && scrollViewRef.current) {
                // Find the index of the selected file
                const itemIndex = itemRefs.current.get(lastSelectedFileId);

                if (itemIndex !== undefined && itemIndex >= 0) {
                    // Estimate item height (GroupedItem with dense mode is approximately 60-70px)
                    // Account for description rows which add extra height
                    const baseItemHeight = 65;
                    const descriptionHeight = 30; // Approximate height for description
                    // Use filteredFiles which is already sorted according to user's selection
                    const sortedFiles = filteredFiles;

                    // Calculate total height up to this item
                    let scrollPosition = 0;
                    for (let i = 0; i <= itemIndex && i < sortedFiles.length; i++) {
                        const file = sortedFiles[i];
                        scrollPosition += baseItemHeight;
                        if (file.metadata?.description) {
                            scrollPosition += descriptionHeight;
                        }
                    }

                    // Add header, controls, search, and stats height (approximately 250px)
                    const headerHeight = 250;
                    const finalScrollPosition = headerHeight + scrollPosition - 150; // Offset to show item near top

                    // Use requestAnimationFrame to ensure DOM is updated before scrolling
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            scrollViewRef.current?.scrollTo({
                                y: Math.max(0, finalScrollPosition),
                                animated: true,
                            });
                        });
                    });
                }
            } else if (viewMode === 'photos' && photoScrollViewRef.current) {
                // For photo grid, find the photo index
                const photos = filteredFiles.filter(file => file.contentType.startsWith('image/'));
                const photoIndex = photos.findIndex(p => p.id === lastSelectedFileId);

                if (photoIndex >= 0) {
                    // Estimate photo item height based on grid layout
                    // Calculate items per row
                    let itemsPerRow = 3;
                    if (containerWidth > 768) itemsPerRow = 6;
                    else if (containerWidth > 480) itemsPerRow = 4;

                    const scrollContainerPadding = 32;
                    const gaps = (itemsPerRow - 1) * 4;
                    const availableWidth = containerWidth - scrollContainerPadding;
                    const itemWidth = (availableWidth - gaps) / itemsPerRow;

                    // Calculate row and approximate scroll position
                    const row = Math.floor(photoIndex / itemsPerRow);
                    const headerHeight = 250;
                    const finalScrollPosition = headerHeight + (row * (itemWidth + 4)) - 150;

                    // Use requestAnimationFrame to ensure DOM is updated before scrolling
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            photoScrollViewRef.current?.scrollTo({
                                y: Math.max(0, finalScrollPosition),
                                animated: true,
                            });
                        });
                    });
                }
            }
        }
    }, [lastSelectedFileId, selectMode, viewMode, filteredFiles, containerWidth]);

    // Clear selected file ID after scroll animation completes
    useEffect(() => {
        if (lastSelectedFileId && scrollViewRef.current) {
            const timeoutId = setTimeout(() => {
                setLastSelectedFileId(null);
            }, 600); // Allow time for scroll animation to complete

            return () => clearTimeout(timeoutId);
        }
    }, [lastSelectedFileId]);

    const renderPhotoItem = (photo: FileMetadata, index: number) => {
        const downloadUrl = getSafeDownloadUrlCallback(photo, 'thumb');

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
                    fileManagementStyles.photoItem,
                    {
                        width: itemWidth,
                        height: itemWidth,
                    }
                ]}
                onPress={() => handleFileOpen(photo)}
                activeOpacity={0.8}
            >
                <View style={fileManagementStyles.photoContainer}>
                    <ExpoImage
                        source={{ uri: downloadUrl }}
                        style={fileManagementStyles.photoImage}
                        contentFit="cover"
                        transition={120}
                        cachePolicy="memory-disk"
                        onError={() => {
                            // Image preview failed to load
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
                <View style={fileManagementStyles.emptyState}>
                    <Ionicons name="images-outline" size={64} color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'} />
                    <Text style={[fileManagementStyles.emptyStateTitle, { color: themeStyles.textColor }]}>No Photos Yet</Text>
                    <Text style={[fileManagementStyles.emptyStateDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}> {
                        user?.id === targetUserId
                            ? `Upload photos to get started. You can select multiple photos at once.`
                            : "This user hasn't uploaded any photos yet"
                    } </Text>
                    {user?.id === targetUserId && (
                        <TouchableOpacity
                            style={[fileManagementStyles.emptyStateButton, { backgroundColor: themeStyles.primaryColor }]}
                            onPress={handleFileUpload}
                            disabled={uploading || isPickingDocument}
                        >
                            {uploading ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : isPickingDocument ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                                <>
                                    <Ionicons name="cloud-upload" size={20} color="#FFFFFF" />
                                    <Text style={fileManagementStyles.emptyStateButtonText}>Upload Photos</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    )}
                </View>
            );
        }

        return (
            <ScrollView
                ref={photoScrollViewRef}
                style={fileManagementStyles.scrollView}
                contentContainerStyle={fileManagementStyles.photoScrollContainer}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => loadFiles('refresh')}
                        tintColor={themeStyles.primaryColor}
                    />
                }
                showsVerticalScrollIndicator={false}
                onScroll={({ nativeEvent }) => {
                    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
                    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
                    if (distanceFromBottom < 200 && !paging.loadingMore && paging.hasMore) {
                        loadFiles('more');
                    }
                }}
                scrollEventThrottle={250}
            >
                {loadingDimensions && (
                    <View style={fileManagementStyles.dimensionsLoadingIndicator}>
                        <ActivityIndicator size="small" color={themeStyles.primaryColor} />
                        <Text style={[fileManagementStyles.dimensionsLoadingText, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>Loading photo layout...</Text>
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

    // Inline justified grid removed (moved to components/photogrid/JustifiedPhotoGrid.tsx)



    const renderEmptyState = () => (
        <View style={fileManagementStyles.emptyState}>
            <Ionicons name="folder-open-outline" size={64} color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'} />
            <Text style={[fileManagementStyles.emptyStateTitle, { color: themeStyles.textColor }]}>No Files Yet</Text>
            <Text style={[fileManagementStyles.emptyStateDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                {user?.id === targetUserId
                    ? `Upload files to get started. You can select multiple files at once.`
                    : "This user hasn't uploaded any files yet"
                }
            </Text>
            {user?.id === targetUserId && (
                <TouchableOpacity
                    style={[fileManagementStyles.emptyStateButton, { backgroundColor: themeStyles.primaryColor }]}
                    onPress={handleFileUpload}
                    disabled={uploading || isPickingDocument}
                >
                    {uploading ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : isPickingDocument ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                        <>
                            <Ionicons name="cloud-upload" size={20} color="#FFFFFF" />
                            <Text style={fileManagementStyles.emptyStateButtonText}>Upload Files</Text>
                        </>
                    )}
                </TouchableOpacity>
            )}
        </View>
    );

    // Professional Skeleton Loading Component with Advanced Shimmer Effect
    const SkeletonLoader = React.memo(() => {
        const shimmerAnim = useRef(new Animated.Value(0)).current;
        const skeletonContainerWidth = containerWidth || 400;

        useEffect(() => {
            const shimmer = Animated.loop(
                Animated.timing(shimmerAnim, {
                    toValue: 1,
                    duration: 2000,
                    easing: Easing.linear,
                    useNativeDriver: true,
                })
            );
            shimmer.start();
            return () => shimmer.stop();
        }, [shimmerAnim]);

        // Create a sweeping shimmer effect
        const shimmerTranslateX = shimmerAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [-skeletonContainerWidth * 2, skeletonContainerWidth * 2],
        });

        const SkeletonBox = ({ width, height, borderRadius = 8, style, delay = 0 }: { width: number | string; height: number; borderRadius?: number; style?: any; delay?: number }) => {
            const delayedTranslateX = shimmerAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [-skeletonContainerWidth * 2 + delay, skeletonContainerWidth * 2 + delay],
            });

            return (
                <View
                    style={[
                        {
                            width,
                            height,
                            borderRadius,
                            backgroundColor: themeStyles.isDarkTheme ? '#1E1E1E' : '#F5F5F5',
                            overflow: 'hidden',
                            position: 'relative',
                        },
                        style,
                    ]}
                >
                    {/* Base background */}
                    <View
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: themeStyles.isDarkTheme ? '#1E1E1E' : '#F5F5F5',
                        }}
                    />
                    {/* Shimmer gradient effect */}
                    <Animated.View
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            transform: [{ translateX: delayedTranslateX }],
                        }}
                    >
                        <View
                            style={{
                                width: skeletonContainerWidth,
                                height: '100%',
                                backgroundColor: themeStyles.isDarkTheme
                                    ? 'rgba(255, 255, 255, 0.08)'
                                    : 'rgba(255, 255, 255, 0.8)',
                                shadowColor: themeStyles.isDarkTheme ? '#000' : '#FFF',
                                shadowOffset: { width: 0, height: 0 },
                                shadowOpacity: 0.3,
                                shadowRadius: 10,
                            }}
                        />
                    </Animated.View>
                </View>
            );
        };

        // Skeleton file item matching GroupedSection structure
        const SkeletonFileItem = ({ index }: { index: number }) => (
            <View
                style={[
                    {
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        backgroundColor: themeStyles.isDarkTheme ? '#121212' : '#FFFFFF',
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: themeStyles.borderColor,
                    },
                ]}
            >
                {/* Icon/Image skeleton */}
                <SkeletonBox width={44} height={44} borderRadius={8} delay={index * 50} />

                {/* Content skeleton */}
                <View style={{ flex: 1, marginLeft: 12, justifyContent: 'center' }}>
                    <SkeletonBox
                        width={index % 3 === 0 ? '85%' : index % 3 === 1 ? '70%' : '90%'}
                        height={16}
                        style={{ marginBottom: 8 }}
                        delay={index * 50 + 20}
                    />
                    <SkeletonBox
                        width={index % 2 === 0 ? '50%' : '60%'}
                        height={12}
                        delay={index * 50 + 40}
                    />
                </View>
            </View>
        );

        return (
            <View style={[fileManagementStyles.container, { backgroundColor }]}>
                {/* Header Skeleton */}
                <View style={[fileManagementStyles.header, { borderBottomColor: themeStyles.borderColor, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                    <SkeletonBox width={44} height={44} borderRadius={12} />
                    <View style={[fileManagementStyles.headerTitleContainer, { flex: 1 }]}>
                        <SkeletonBox width={140} height={20} style={{ marginBottom: 6 }} />
                        <SkeletonBox width={100} height={14} />
                    </View>
                    <SkeletonBox width={44} height={44} borderRadius={12} />
                </View>

                {/* Controls Bar Skeleton */}
                <View style={fileManagementStyles.controlsBar}>
                    <SkeletonBox width={100} height={36} borderRadius={18} />
                    <SkeletonBox width={44} height={44} borderRadius={22} />
                </View>

                {/* Search Bar Skeleton */}
                <View style={[fileManagementStyles.searchContainer, {
                    backgroundColor: themeStyles.colors.card,
                }]}>
                    <SkeletonBox width="100%" height={44} borderRadius={12} />
                </View>

                {/* Stats Container Skeleton */}
                <View style={[fileManagementStyles.statsContainer, {
                    backgroundColor: themeStyles.colors.card,
                }]}>
                    {[1, 2, 3].map((i) => (
                        <View key={i} style={fileManagementStyles.statItem}>
                            <SkeletonBox width={50} height={20} style={{ marginBottom: 4 }} delay={i * 30} />
                            <SkeletonBox width={40} height={14} delay={i * 30 + 15} />
                        </View>
                    ))}
                </View>

                {/* File List Skeleton - Matching GroupedSection */}
                <ScrollView
                    style={fileManagementStyles.scrollView}
                    contentContainerStyle={fileManagementStyles.scrollContainer}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={{
                        backgroundColor: themeStyles.colors.card,
                        borderRadius: 18,
                        overflow: 'hidden',
                        marginTop: 8,
                    }}>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                            <SkeletonFileItem key={i} index={i} />
                        ))}
                    </View>
                </ScrollView>
            </View>
        );
    });

    if (loading) {
        return <SkeletonLoader />;
    }

    // If a file is opened, show the file viewer
    if (!selectMode && openedFile) {
        return (
            <>
                <FileViewer
                    file={openedFile}
                    fileContent={fileContent}
                    loadingFileContent={loadingFileContent}
                    showFileDetailsInViewer={showFileDetailsInViewer}
                    onToggleDetails={() => setShowFileDetailsInViewer(!showFileDetailsInViewer)}
                    onClose={handleCloseFile}
                    onDownload={handleFileDownload}
                    onDelete={handleFileDelete}
                    themeStyles={themeStyles}
                    isOwner={user?.id === targetUserId}
                />
                <FileDetailsModal
                    visible={showFileDetails}
                    file={selectedFile}
                    onClose={() => setShowFileDetails(false)}
                    onDownload={handleFileDownload}
                    onDelete={handleFileDelete}
                    themeStyles={themeStyles}
                    isOwner={user?.id === targetUserId}
                />
            </>
        );
    }

    // If upload preview is showing, render it inline instead of the file list
    if (showUploadPreview) {
        return (
            <View style={fileManagementStyles.container}>
                <Header
                    title="Review Files"
                    subtitle={`${pendingFiles.length} file${pendingFiles.length !== 1 ? 's' : ''} ready to upload`}
                    onBack={handleCancelUpload}
                    showBackButton
                    variant="minimal"
                    elevation="none"
                    titleAlignment="left"
                />
                <UploadPreview
                    visible={true}
                    pendingFiles={pendingFiles}
                    onConfirm={handleConfirmUpload}
                    onCancel={handleCancelUpload}
                    onRemoveFile={removePendingFile}
                    themeStyles={themeStyles}
                    inline={true}
                />
            </View>
        );
    }

    return (
        <View style={fileManagementStyles.container}>
            <Header
                title={selectMode ? (multiSelect ? `${selectedIds.size}${maxSelection ? '/' + maxSelection : ''} Selected` : 'Select a File') : (viewMode === 'photos' ? 'Photos' : 'File Management')}
                subtitle={selectMode ? (multiSelect ? `${filteredFiles.length} available` : 'Tap to select') : `${filteredFiles.length} ${filteredFiles.length === 1 ? 'item' : 'items'}`}
                rightActions={selectMode && multiSelect ? [
                    {
                        key: 'clear',
                        text: 'Clear',
                        onPress: () => setSelectedIds(new Set()),
                        disabled: selectedIds.size === 0,
                    },
                    {
                        key: 'confirm',
                        text: 'Confirm',
                        onPress: confirmMultiSelection,
                        disabled: selectedIds.size === 0,
                    }
                ] : !selectMode && selectedIds.size > 0 ? [
                    {
                        key: 'clear',
                        text: 'Clear',
                        onPress: () => setSelectedIds(new Set()),
                    },
                    {
                        key: 'delete',
                        text: `Delete (${selectedIds.size})`,
                        onPress: handleBulkDelete,
                        icon: 'trash',
                    },
                    {
                        key: 'visibility',
                        text: 'Visibility',
                        onPress: () => {
                            // Show visibility options menu
                            Alert.alert(
                                'Change Visibility',
                                `Change visibility for ${selectedIds.size} file(s)?`,
                                [
                                    { text: 'Cancel', style: 'cancel' },
                                    { text: 'Private', onPress: () => handleBulkVisibilityChange('private') },
                                    { text: 'Public', onPress: () => handleBulkVisibilityChange('public') },
                                    { text: 'Unlisted', onPress: () => handleBulkVisibilityChange('unlisted') },
                                ]
                            );
                        },
                        icon: 'eye',
                    }
                ] : undefined}
                onBack={onClose || goBack}

                showBackButton
                variant="minimal"
                elevation="none"
                titleAlignment="left"
            />

            <View style={fileManagementStyles.controlsBar}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={fileManagementStyles.viewModeScroll}
                >
                    <View style={[
                        fileManagementStyles.viewModeToggle,
                        {
                            backgroundColor: themeStyles.colors.card,
                        }
                    ]}>
                        <AnimatedButton
                            isSelected={viewMode === 'all'}
                            onPress={() => setViewMode('all')}
                            icon={viewMode === 'all' ? 'folder' : 'folder-outline'}
                            primaryColor={themeStyles.primaryColor}
                            textColor={themeStyles.textColor}
                            style={fileManagementStyles.viewModeButton}
                        />
                        <AnimatedButton
                            isSelected={viewMode === 'photos'}
                            onPress={() => setViewMode('photos')}
                            icon={viewMode === 'photos' ? 'image-multiple' : 'image-multiple-outline'}
                            primaryColor={themeStyles.primaryColor}
                            textColor={themeStyles.textColor}
                            style={fileManagementStyles.viewModeButton}
                        />
                        <AnimatedButton
                            isSelected={viewMode === 'videos'}
                            onPress={() => setViewMode('videos')}
                            icon={viewMode === 'videos' ? 'video' : 'video-outline'}
                            primaryColor={themeStyles.primaryColor}
                            textColor={themeStyles.textColor}
                            style={fileManagementStyles.viewModeButton}
                        />
                        <AnimatedButton
                            isSelected={viewMode === 'documents'}
                            onPress={() => setViewMode('documents')}
                            icon={viewMode === 'documents' ? 'file-document' : 'file-document-outline'}
                            primaryColor={themeStyles.primaryColor}
                            textColor={themeStyles.textColor}
                            style={fileManagementStyles.viewModeButton}
                        />
                        <AnimatedButton
                            isSelected={viewMode === 'audio'}
                            onPress={() => setViewMode('audio')}
                            icon={viewMode === 'audio' ? 'music-note' : 'music-note-outline'}
                            primaryColor={themeStyles.primaryColor}
                            textColor={themeStyles.textColor}
                            style={fileManagementStyles.viewModeButton}
                        />
                    </View>
                </ScrollView>
                <TouchableOpacity
                    style={[fileManagementStyles.sortButton, {
                        backgroundColor: themeStyles.colors.card,
                    }]}
                    onPress={() => {
                        // Cycle through sort options: date -> size -> name -> type -> date
                        const sortOrder: Array<'date' | 'size' | 'name' | 'type'> = ['date', 'size', 'name', 'type'];
                        const currentIndex = sortOrder.indexOf(sortBy);
                        const nextIndex = (currentIndex + 1) % sortOrder.length;
                        setSortBy(sortOrder[nextIndex]);
                        // Toggle order when cycling back to date
                        if (nextIndex === 0) {
                            setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                        }
                    }}
                >
                    <MaterialCommunityIcons
                        name={
                            sortBy === 'date' ? 'calendar' :
                                sortBy === 'size' ? 'sort-numeric-variant' :
                                    sortBy === 'name' ? 'sort-alphabetical-variant' : 'file-document-outline'
                        }
                        size={16}
                        color={themeStyles.textColor}
                    />
                    <MaterialCommunityIcons
                        name={sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'}
                        size={14}
                        color={themeStyles.colors.secondaryText}
                    />
                </TouchableOpacity>
                {user?.id === targetUserId && (!selectMode || (selectMode && allowUploadInSelectMode)) && (
                    <TouchableOpacity
                        style={[fileManagementStyles.uploadButton, { backgroundColor: themeStyles.primaryColor }]}
                        onPress={handleFileUpload}
                        disabled={uploading || isPickingDocument}
                    >
                        {uploading ? (
                            <View style={fileManagementStyles.uploadProgress}>
                                <ActivityIndicator size="small" color="#FFFFFF" />
                                {uploadProgress && (
                                    <Text style={fileManagementStyles.uploadProgressText}>
                                        {uploadProgress.current}/{uploadProgress.total}
                                    </Text>
                                )}
                            </View>
                        ) : isPickingDocument ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                            <Ionicons name="add" size={22} color="#FFFFFF" />
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {/* Search Bar */}
            {files.length > 0 && (viewMode === 'all' || files.some(f => f.contentType.startsWith('image/'))) && (
                <View style={[
                    fileManagementStyles.searchContainer,
                    {
                        backgroundColor: themeStyles.colors.card,
                    }
                ]}>
                    <Ionicons name="search" size={22} color={themeStyles.colors.icon} />
                    <TextInput
                        style={[fileManagementStyles.searchInput, { color: themeStyles.textColor }]}
                        placeholder={viewMode === 'photos' ? 'Search photos...' : 'Search files...'}
                        placeholderTextColor={themeStyles.colors.secondaryText}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity
                            onPress={() => setSearchQuery('')}
                            style={fileManagementStyles.searchClearButton}
                        >
                            <Ionicons name="close-circle" size={22} color={themeStyles.colors.icon} />
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* File Stats */}
            {files.length > 0 && (
                <View style={[
                    fileManagementStyles.statsContainer,
                    {
                        backgroundColor: themeStyles.colors.card,
                    }
                ]}>
                    <View style={fileManagementStyles.statItem}>
                        <Text style={[fileManagementStyles.statValue, { color: themeStyles.textColor }]}>{filteredFiles.length}</Text>
                        <Text style={[fileManagementStyles.statLabel, { color: themeStyles.colors.secondaryText }]}>
                            {searchQuery.length > 0 ? 'Found' : (filteredFiles.length === 1 ? (viewMode === 'photos' ? 'Photo' : 'File') : (viewMode === 'photos' ? 'Photos' : 'Files'))}
                        </Text>
                    </View>
                    <View style={fileManagementStyles.statItem}>
                        <Text style={[fileManagementStyles.statValue, { color: themeStyles.textColor }]}>
                            {formatFileSize(filteredFiles.reduce((total, file) => total + file.length, 0))}
                        </Text>
                        <Text style={[fileManagementStyles.statLabel, { color: themeStyles.colors.secondaryText }]}>
                            {searchQuery.length > 0 ? 'Size' : 'Total Size'}
                        </Text>
                    </View>
                    {searchQuery.length > 0 && (
                        <View style={fileManagementStyles.statItem}>
                            <Text style={[fileManagementStyles.statValue, { color: themeStyles.textColor }]}>{files.length}</Text>
                            <Text style={[fileManagementStyles.statLabel, { color: themeStyles.colors.secondaryText }]}>
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
                    ref={scrollViewRef}
                    style={fileManagementStyles.scrollView}
                    contentContainerStyle={fileManagementStyles.scrollContainer}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => loadFiles('refresh')}
                            tintColor={themeStyles.primaryColor}
                        />
                    }
                    onScroll={({ nativeEvent }) => {
                        const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
                        const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
                        if (distanceFromBottom < 200 && !paging.loadingMore && paging.hasMore) {
                            loadFiles('more');
                        }
                    }}
                    scrollEventThrottle={250}
                >
                    {filteredFiles.length === 0 && searchQuery.length > 0 ? (
                        <View style={fileManagementStyles.emptyState}>
                            <Ionicons name="search" size={64} color={themeStyles.isDarkTheme ? '#666666' : '#CCCCCC'} />
                            <Text style={[fileManagementStyles.emptyStateTitle, { color: themeStyles.textColor }]}>No Results Found</Text>
                            <Text style={[fileManagementStyles.emptyStateDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                No files match your search for "{searchQuery}"
                            </Text>
                            <TouchableOpacity
                                style={[fileManagementStyles.emptyStateButton, { backgroundColor: themeStyles.primaryColor }]}
                                onPress={() => setSearchQuery('')}
                            >
                                <Ionicons name="refresh" size={20} color="#FFFFFF" />
                                <Text style={fileManagementStyles.emptyStateButtonText}>Clear Search</Text>
                            </TouchableOpacity>
                        </View>
                    ) : filteredFiles.length === 0 ? renderEmptyState() : (
                        <>
                            <GroupedSection items={groupedFileItems} />
                            {paging.loadingMore && (
                                <View style={fileManagementStyles.loadingMoreBar}>
                                    <ActivityIndicator size="small" color={themeStyles.primaryColor} />
                                    <Text style={[fileManagementStyles.loadingMoreText, { color: themeStyles.textColor }]}>Loading more...</Text>
                                </View>
                            )}
                        </>
                    )}
                </ScrollView>
            )}

            {!selectMode && (
                <FileDetailsModal
                    visible={showFileDetails}
                    file={selectedFile}
                    onClose={() => setShowFileDetails(false)}
                    onDownload={handleFileDownload}
                    onDelete={handleFileDelete}
                    themeStyles={themeStyles}
                    isOwner={user?.id === targetUserId}
                />
            )}

            {/* Uploading banner overlay with progress */}
            {!selectMode && uploading && (
                <View style={[fileManagementStyles.uploadBannerContainer, { pointerEvents: 'none' }]}>
                    <View style={[fileManagementStyles.uploadBanner, { backgroundColor: themeStyles.isDarkTheme ? '#222831EE' : '#FFFFFFEE', borderColor: themeStyles.borderColor }]}>
                        <Ionicons name="cloud-upload" size={18} color={themeStyles.primaryColor} />
                        <View style={fileManagementStyles.uploadBannerContent}>
                            <Text style={[fileManagementStyles.uploadBannerText, { color: themeStyles.textColor }]}>
                                Uploading{uploadProgress ? ` ${uploadProgress.current}/${uploadProgress.total}` : '...'}
                            </Text>
                            {uploadProgress && uploadProgress.total > 0 && (
                                <View style={[fileManagementStyles.uploadProgressBarContainer, { backgroundColor: themeStyles.isDarkTheme ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
                                    <View
                                        style={[
                                            fileManagementStyles.uploadProgressBar,
                                            {
                                                width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                                                backgroundColor: themeStyles.primaryColor
                                            }
                                        ]}
                                    />
                                </View>
                            )}
                        </View>
                        <ActivityIndicator size="small" color={themeStyles.primaryColor} />
                    </View>
                </View>
            )}

            {/* Selection bar removed; actions are now in header */}
            {/* Global loadingMore bar removed; now inline in scroll areas */}
        </View>
    );
};

// Styles have been moved to components/fileManagement/styles.ts

export default FileManagementScreen;

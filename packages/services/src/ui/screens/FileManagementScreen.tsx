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
    Animated,
    Easing,
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
import JustifiedPhotoGrid from '../components/photogrid/JustifiedPhotoGrid';
import { GroupedSection } from '../components';

// Exporting props & callback types so external callers (e.g. showBottomSheet config objects) can annotate
export type OnConfirmFileSelection = (files: FileMetadata[]) => void;

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

// Add this helper function near the top (after imports):
async function uploadFileRaw(file: File | Blob, userId: string, oxyServices: any, visibility?: 'private' | 'public' | 'unlisted') {
    return await oxyServices.uploadRawFile(file, visibility);
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
}) => {
    const { user, oxyServices } = useOxy();
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
    const [viewMode, setViewMode] = useState<'all' | 'photos' | 'videos' | 'documents' | 'audio'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'date' | 'size' | 'name' | 'type'>('date');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
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
    const [isDragging, setIsDragging] = useState(false);
    const [photoDimensions, setPhotoDimensions] = useState<{ [key: string]: { width: number, height: number } }>({});
    const [loadingDimensions, setLoadingDimensions] = useState(false);
    const [hoveredPreview, setHoveredPreview] = useState<string | null>(null);
    const uploadStartRef = useRef<number | null>(null);
    const MIN_BANNER_MS = 600;
    // Selection state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedIds));
    const [lastSelectedFileId, setLastSelectedFileId] = useState<string | null>(null);
    const scrollViewRef = useRef<ScrollView>(null);
    const photoScrollViewRef = useRef<ScrollView>(null);
    const itemRefs = useRef<Map<string, number>>(new Map()); // Track item positions
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
            // Photo dimensions loading failed, continue without dimensions
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
        
        const confirmed = window.confirm(
            `Are you sure you want to delete ${selectedFiles.length} file(s)? This action cannot be undone.`
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
                // Use the public download URL method
                const downloadUrl = oxyServices.getFileDownloadUrl(fileId);

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
                        ...(selectMode && selectedIds.has(photo.id) ? { borderWidth: 2, borderColor: themeStyles.primaryColor } : {})
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
                        onError={() => {
                            // Photo failed to load, will show placeholder
                        }}
                        accessibilityLabel={photo.filename}
                    />
                    {selectMode && (
                        <View style={styles.selectionBadge}>
                            <Ionicons name={selectedIds.has(photo.id) ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selectedIds.has(photo.id) ? themeStyles.primaryColor : themeStyles.textColor} />
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        );
    }, [oxyServices, containerWidth, selectMode, selectedIds, themeStyles.primaryColor, themeStyles.textColor]);

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
                        ...(selectMode && selectedIds.has(photo.id) ? { borderWidth: 2, borderColor: themeStyles.primaryColor } : {}),
                        ...(selectMode && multiSelect && selectedIds.size > 0 && !selectedIds.has(photo.id) ? { opacity: 0.4 } : {}),
                    },
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
                        onError={() => {
                            // Photo failed to load, will show placeholder
                        }}
                        accessibilityLabel={photo.filename}
                    />
                    {selectMode && (
                        <View style={styles.selectionBadge}>
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
                style={[styles.fileItem, { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor }, selectMode && selectedIds.has(file.id) && { borderColor: themeStyles.primaryColor, borderWidth: 2 }]}
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
                                        onError={() => {
                                            // Image preview failed to load
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
                                {!selectMode && Platform.OS === 'web' && hoveredPreview === file.id && isImage && (
                                    <View style={styles.previewOverlay}>
                                        <Ionicons name="eye" size={24} color="#FFFFFF" />
                                    </View>
                                )}
                                {selectMode && (
                                    <View style={styles.selectionBadge}>
                                        <Ionicons name={selectedIds.has(file.id) ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selectedIds.has(file.id) ? themeStyles.primaryColor : themeStyles.textColor} />
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

                {!selectMode && (
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
                )}
            </View>
        );
    };

    // GroupedSection-based file items (for 'all' view) replacing legacy flat list look
    const groupedFileItems = useMemo(() => {
        const sortedFiles = filteredFiles
            .filter(f => true)
            .sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
        
        // Store file positions for scrolling
        sortedFiles.forEach((file, index) => {
            itemRefs.current.set(file.id, index);
        });
        
        return sortedFiles.map((file) => {
                const isImage = file.contentType.startsWith('image/');
                const isVideo = file.contentType.startsWith('video/');
                const hasPreview = isImage || isVideo;
                const previewUrl = hasPreview ? (isVideo ? getSafeDownloadUrl(file, 'poster') : getSafeDownloadUrl(file, 'thumb')) : undefined;
                const isSelected = selectedIds.has(file.id);
                return {
                    id: file.id,
                    image: previewUrl,
                    imageSize: 44,
                    icon: !previewUrl ? getFileIcon(file.contentType) : undefined,
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
                    ) : undefined,
                    customContentBelow: file.metadata?.description ? (
                        <Text style={[styles.groupedDescription, { color: themeStyles.isDarkTheme ? '#AAAAAA' : '#666666' }]} numberOfLines={2}>
                            {file.metadata.description}
                        </Text>
                    ) : undefined,
                } as any;
            });
    }, [filteredFiles, theme, themeStyles, deleting, handleFileDownload, handleFileDelete, handleFileOpen, getSafeDownloadUrl, selectMode, selectedIds]);

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
                    const sortedFiles = filteredFiles
                        .filter(f => true)
                        .sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
                    
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
                ref={photoScrollViewRef}
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

    // Inline justified grid removed (moved to components/photogrid/JustifiedPhotoGrid.tsx)

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
                                onError={() => {
                                    // Image failed to load
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
            <View style={[styles.container, { backgroundColor }]}>
                {/* Header Skeleton */}
                <View style={[styles.header, { borderBottomColor: themeStyles.borderColor, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                    <SkeletonBox width={44} height={44} borderRadius={12} />
                    <View style={[styles.headerTitleContainer, { flex: 1 }]}>
                        <SkeletonBox width={140} height={20} style={{ marginBottom: 6 }} />
                        <SkeletonBox width={100} height={14} />
                    </View>
                    <SkeletonBox width={44} height={44} borderRadius={12} />
                </View>

                {/* Controls Bar Skeleton */}
                <View style={styles.controlsBar}>
                    <SkeletonBox width={100} height={36} borderRadius={18} />
                    <SkeletonBox width={44} height={44} borderRadius={22} />
                </View>

                {/* Search Bar Skeleton */}
                <View style={[styles.searchContainer, { 
                    backgroundColor: themeStyles.isDarkTheme ? '#1A1A1A' : '#FFFFFF', 
                    borderColor: themeStyles.borderColor,
                    borderWidth: StyleSheet.hairlineWidth,
                }]}>
                    <SkeletonBox width="100%" height={44} borderRadius={12} />
                </View>

                {/* Stats Container Skeleton */}
                <View style={[styles.statsContainer, { 
                    backgroundColor: themeStyles.isDarkTheme ? '#1A1A1A' : '#FFFFFF', 
                    borderColor: themeStyles.borderColor,
                    borderWidth: StyleSheet.hairlineWidth,
                }]}>
                    {[1, 2, 3].map((i) => (
                        <View key={i} style={styles.statItem}>
                            <SkeletonBox width={50} height={20} style={{ marginBottom: 4 }} delay={i * 30} />
                            <SkeletonBox width={40} height={14} delay={i * 30 + 15} />
                        </View>
                    ))}
                </View>

                {/* File List Skeleton - Matching GroupedSection */}
                <ScrollView 
                    style={styles.scrollView} 
                    contentContainerStyle={styles.scrollContainer}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={{
                        backgroundColor: themeStyles.isDarkTheme ? '#121212' : '#FFFFFF',
                        borderRadius: 12,
                        overflow: 'hidden',
                        marginHorizontal: 16,
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
                theme={theme}
                showBackButton
                variant="minimal"
                elevation="none"
                titleAlignment="left"
            />

            <View style={styles.controlsBar}>
                <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    style={styles.viewModeScroll}
                >
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
                        <TouchableOpacity
                            style={[
                                styles.viewModeButton,
                                viewMode === 'videos' && { backgroundColor: themeStyles.primaryColor }
                            ]}
                            onPress={() => setViewMode('videos')}
                        >
                            <Ionicons
                                name="videocam"
                                size={18}
                                color={viewMode === 'videos' ? '#FFFFFF' : themeStyles.textColor}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.viewModeButton,
                                viewMode === 'documents' && { backgroundColor: themeStyles.primaryColor }
                            ]}
                            onPress={() => setViewMode('documents')}
                        >
                            <Ionicons
                                name="document-text"
                                size={18}
                                color={viewMode === 'documents' ? '#FFFFFF' : themeStyles.textColor}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.viewModeButton,
                                viewMode === 'audio' && { backgroundColor: themeStyles.primaryColor }
                            ]}
                            onPress={() => setViewMode('audio')}
                        >
                            <Ionicons
                                name="musical-notes"
                                size={18}
                                color={viewMode === 'audio' ? '#FFFFFF' : themeStyles.textColor}
                            />
                        </TouchableOpacity>
                    </View>
                </ScrollView>
                <TouchableOpacity
                    style={[styles.sortButton, { 
                        backgroundColor: themeStyles.isDarkTheme ? '#181818' : '#FFFFFF',
                        borderColor: themeStyles.isDarkTheme ? '#2A2A2A' : '#E8E9EA',
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
                    <Ionicons
                        name={sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'}
                        size={18}
                        color={themeStyles.textColor}
                    />
                    <Ionicons
                        name={
                            sortBy === 'date' ? 'calendar' :
                            sortBy === 'size' ? 'resize' :
                            sortBy === 'name' ? 'text' : 'document'
                        }
                        size={16}
                        color={themeStyles.textColor}
                        style={{ marginLeft: 4 }}
                    />
                </TouchableOpacity>
                {user?.id === targetUserId && (!selectMode || (selectMode && allowUploadInSelectMode)) && (
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
                    ref={scrollViewRef}
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContainer}
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
                        <>
                            <GroupedSection items={groupedFileItems} theme={theme as 'light' | 'dark'} />
                            {paging.loadingMore && (
                                <View style={styles.loadingMoreBar}>
                                    <ActivityIndicator size="small" color={themeStyles.primaryColor} />
                                    <Text style={[styles.loadingMoreText, { color: themeStyles.textColor }]}>Loading more...</Text>
                                </View>
                            )}
                        </>
                    )}
                </ScrollView>
            )}

            {!selectMode && renderFileDetailsModal()}

            {/* Uploading banner overlay */}
            {!selectMode && uploading && (
                <View style={[styles.uploadBannerContainer, { pointerEvents: 'none' }]}>
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

            {/* Selection bar removed; actions are now in header */}
            {/* Global loadingMore bar removed; now inline in scroll areas */}

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
    selectionBadge: {
        position: 'absolute',
        top: 4,
        right: 4,
        backgroundColor: 'rgba(0,0,0,0.4)',
        borderRadius: 12,
        padding: 2,
    },
    selectionBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 12,
        backgroundColor: 'rgba(0,0,0,0.55)',
        gap: 12,
    },
    selectionBarButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    selectionBarButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '600',
    },
    loadingMoreBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        gap: 8,
    },
    loadingMoreText: {
        fontSize: 13,
        fontWeight: '500',
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
        backgroundColor: '#e5f1ff',
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
    viewModeScroll: {
        flex: 1,
        maxWidth: '80%',
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
    sortButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 20,
        borderWidth: 1,
        minWidth: 44,
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
    skeletonFileItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        gap: 12,
    },
    skeletonFileInfo: {
        flex: 1,
        justifyContent: 'center',
    },
});

export default FileManagementScreen;

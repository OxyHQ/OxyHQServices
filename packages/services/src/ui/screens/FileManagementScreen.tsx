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
    AccessibilityInfo,
    useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import type { FileManagementScreenProps } from '../types/fileManagement';
import { Dialog, toast, useDialogControl } from '@oxyhq/bloom';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { FileMetadata } from '@oxyhq/core';
import { useFileStore, useFiles, useUploading as useUploadingStore, useUploadAggregateProgress, useDeleting as useDeletingStore } from '../stores/fileStore';
import Header from '../components/Header';
import JustifiedPhotoGrid from '../components/photogrid/JustifiedPhotoGrid';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import { useUploadFile } from '../hooks/mutations/useAccountMutations';
import {
    formatFileSize,
    getFileIcon,
} from '../utils/fileManagement';
import { useResolvedFileUrls, fileThumbSource } from '../hooks/useResolvedFileUrls';
import { FileViewer } from '../components/fileManagement/FileViewer';
import { FileDetailsModal } from '../components/fileManagement/FileDetailsModal';
import { UploadPreview } from '../components/fileManagement/UploadPreview';
import { getErrorMessage } from './fileManagement/shared';
import { useFileUploadState } from './fileManagement/hooks/useFileUploadState';
import PhotoPickerView from './fileManagement/PhotoPickerSection';
import FileListSection, { type FileListItem } from './fileManagement/FileListSection';
import UploadBar from './fileManagement/UploadBar';

// Genuinely-inline-only styles: `viewModeButton` is spread into an Animated.View
// style array (interpolated backgroundColor), and the photo tiles are
// `expo-image` (no className remap). Everything else uses NativeWind classNames.
const screenStyles = StyleSheet.create({
    viewModeButton: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        minWidth: 36,
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 1,
    },
    photoImage: { width: '100%', height: '100%', borderRadius: 8 },
    justifiedPhotoImage: { width: '100%', height: '100%', borderRadius: 6 },
});

// Animated button component for smooth transitions
const AnimatedButton: React.FC<{
    isSelected: boolean;
    onPress: () => void;
    icon: string;
    primaryColor: string;
    textColor: string;
    style: Record<string, unknown>;
    accessibilityLabel: string;
}> = ({ isSelected, onPress, icon, primaryColor, textColor, style, accessibilityLabel }) => {
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

    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ selected: isSelected }}
        >
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
                        name={icon as React.ComponentProps<typeof MaterialCommunityIcons>['name']}
                        size={16}
                        color={isSelected ? '#FFFFFF' : textColor}
                    />
                </Animated.View>
            </Animated.View>
        </TouchableOpacity>
    );
};

const FileManagementScreen: React.FC<FileManagementScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
    userId,
    containerWidth,
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
    // Use useOxy() hook for OxyContext values. Files are owned by the ACTIVE
    // account (the org/project/bot when switched, else the personal user): the
    // default file owner and every "is this mine?" ownership check resolve
    // against `user`, so switching shows/manages that account's files.
    const { user, oxyServices } = useOxy();
    const { t } = useI18n();
    const uploadFileMutation = useUploadFile();
    // Prompt controls
    const fileDeleteDialog = useDialogControl();
    const bulkDeleteDialog = useDialogControl();
    const visibilityChangeDialog = useDialogControl();
    const [pendingDeleteFile, setPendingDeleteFile] = useState<{ id: string; name: string } | null>(null);
    const files = useFiles();
    const { width: windowWidth } = useWindowDimensions();
    // Prefer an explicit sheet width from the router; fall back to the window
    // so photo grids never size against a hardcoded 400px default.
    const safeContainerWidth: number =
        typeof containerWidth === 'number' && containerWidth > 0
            ? containerWidth
            : windowWidth;
    const uploading = useUploadingStore();
    const uploadProgress = useUploadAggregateProgress();
    const deleting = useDeletingStore();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [paging, setPaging] = useState({ offset: 0, limit: 40, total: 0, hasMore: true, loadingMore: false });
    const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);
    const fileDetailsControl = useDialogControl();
    // In selectMode we never open the detailed viewer
    const [openedFile, setOpenedFile] = useState<FileMetadata | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [loadingFileContent, setLoadingFileContent] = useState(false);
    const [showFileDetailsInViewer, setShowFileDetailsInViewer] = useState(false);
    const [reduceMotion, setReduceMotion] = useState(false);

    // Detect reduce-motion preference once on mount + subscribe to changes.
    // Used by `PhotoPickerView` to skip cell stagger animations.
    useEffect(() => {
        let cancelled = false;
        AccessibilityInfo.isReduceMotionEnabled()
            .then((enabled) => {
                if (!cancelled) setReduceMotion(enabled);
            })
            .catch(() => {
                // Defaults to false; no action needed.
            });
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
            setReduceMotion(enabled);
        });
        return () => {
            cancelled = true;
            sub.remove();
        };
    }, []);

    // Image-only picker mode: when the consumer restricts to image MIME types
    // (e.g. avatar picker), photos grid is the more useful default view.
    const isImageOnlyPicker = useMemo(() => {
        if (!selectMode) return false;
        if (disabledMimeTypes.length === 0) return false;
        const blocksVideos = disabledMimeTypes.some(mt => mt === 'video/' || mt.startsWith('video/'));
        const blocksAudio = disabledMimeTypes.some(mt => mt === 'audio/' || mt.startsWith('audio/'));
        const blocksDocs = disabledMimeTypes.some(mt =>
            mt === 'application/pdf' ||
            mt === 'application/' ||
            mt.startsWith('application/')
        );
        return blocksVideos && blocksAudio && blocksDocs;
    }, [disabledMimeTypes, selectMode]);

    const [viewMode, setViewMode] = useState<'all' | 'photos' | 'videos' | 'documents' | 'audio'>(
        isImageOnlyPicker ? 'photos' : 'all',
    );
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
                (file.metadata?.description?.toLowerCase().includes(query))
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
    // Selection state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedIds));
    const [lastSelectedFileId, setLastSelectedFileId] = useState<string | null>(null);
    const scrollViewRef = useRef<ScrollView>(null);
    const photoScrollViewRef = useRef<ScrollView>(null);
    const containerRef = useRef<View>(null);
    useEffect(() => {
        if (initialSelectedIds?.length) {
            setSelectedIds(new Set(initialSelectedIds));
        }
    }, [initialSelectedIds]);

    const toggleSelect = useCallback(async (file: FileMetadata) => {
        // Allow selection in regular mode for bulk operations
        // if (!selectMode) return;
        if (disabledMimeTypes.length) {
            const blocked = disabledMimeTypes.some(mt => file.contentType === mt || file.contentType.startsWith(mt.endsWith('/') ? mt : `${mt}/`));
            if (blocked) {
                toast.error(t('fileManagement.toasts.fileTypeBlocked'));
                return;
            }
        }

        // Update file visibility if it differs from defaultVisibility
        const fileVisibility = (file.metadata as Record<string, unknown> | undefined)?.visibility || 'private';
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
                    linkContext.webhookUrl
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
                    toast.error(t('fileManagement.toasts.maxSelection', { max: maxSelection }));
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
            const fileVisibility = (file.metadata as Record<string, unknown> | undefined)?.visibility || 'private';
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
                        linkContext.webhookUrl
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

    // Private-safe thumbnail URLs for the currently-shown files, resolved in
    // ONE batch per page (not N per-tile) and cached by React Query. Uploads
    // default to private, so the synchronous public-CDN URL would 404 for
    // every private thumbnail.
    const resolvedThumbUrls = useResolvedFileUrls(oxyServices, filteredFiles, user?.id);

    // Image source for a grid tile: the resolved private-safe URL for a
    // persisted file, or the locally-picked preview for an in-flight optimistic
    // entry. Never builds an asset URL from a `temp-…`/uploading id.
    const thumbSourceFor = useCallback(
        (file: FileMetadata): string | undefined => fileThumbSource(file, resolvedThumbUrls),
        [resolvedThumbUrls],
    );

    const bloomTheme = useTheme();
    const { colors } = bloomTheme;
    // FileManagementScreen uses a slightly elevated page background.
    const backgroundColor = colors.backgroundSecondary;
    const borderColor = colors.border;

    const targetUserId = userId || user?.id;

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
            const assets: FileMetadata[] = (response.files || []).map((f: { id: string; originalName?: string; sha256?: string; mime?: string; size?: number; createdAt?: string; metadata?: Record<string, unknown>; variants?: unknown[] }) => ({
                id: f.id,
                filename: f.originalName ?? f.sha256 ?? '',
                contentType: f.mime ?? '',
                length: f.size ?? 0,
                chunkSize: 0,
                uploadDate: f.createdAt ?? '',
                metadata: f.metadata ?? {},
                variants: (f.variants ?? []) as FileMetadata['variants'],
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
        } catch (error: unknown) {
            toast.error(getErrorMessage(error) || t('fileManagement.toasts.loadFailed'));
        } finally {
            setLoading(false);
            setRefreshing(false);
            setPaging(p => ({ ...p, loadingMore: false }));
        }
    }, [targetUserId, oxyServices, paging]);

    // Self-contained document-picking + upload-preview state and handlers.
    const {
        isPickingDocument,
        pendingFiles,
        showUploadPreview,
        handleFileUpload,
        handleConfirmUpload,
        handleCancelUpload,
        removePendingFile,
    } = useFileUploadState({
        targetUserId,
        uploadFileMutation,
        defaultVisibility,
        selectMode,
        multiSelect,
        afterSelect,
        onSelect,
        goBack,
        onClose,
        selectedIds,
        setSelectedIds,
        loadFiles,
        t,
    });

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
                        const downloadUrl = thumbSourceFor(photo);
                        // URL not resolved yet — skip (do NOT record fallback
                        // dims) so this photo is re-measured once its private-safe
                        // URL resolves. Measuring the broken public URL is exactly
                        // the bug we are fixing.
                        if (!downloadUrl) {
                            return;
                        }

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
    }, [thumbSourceFor, photoDimensions]);

    // Re-measure photo dimensions when their private-safe URLs resolve. The
    // justified grid's own trigger fires on the photo SET, not on URL
    // availability, so newly-resolved private tiles would otherwise keep their
    // skipped (unmeasured) state and render with fallback geometry.
    useEffect(() => {
        if (viewMode !== 'photos') return;
        const photos = filteredFiles.filter((file) => file.contentType.startsWith('image/'));
        if (photos.length > 0) {
            loadPhotoDimensions(photos);
        }
    }, [resolvedThumbUrls, viewMode, filteredFiles, loadPhotoDimensions]);

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

    const confirmFileDelete = useCallback((fileId: string, filename: string) => {
        setPendingDeleteFile({ id: fileId, name: filename });
        fileDeleteDialog.open();
    }, [fileDeleteDialog]);

    const handleFileDelete = useCallback(async () => {
        if (!pendingDeleteFile) return;
        const { id: fileId } = pendingDeleteFile;

        try {
            storeSetDeleting(fileId);
            await oxyServices.deleteFile(fileId);

            toast.success(t('fileManagement.toasts.deleteSuccess'));

            // Reload files after successful deletion
            // Optimistic remove
            useFileStore.getState().removeFile(fileId);
            // Silent background reconcile
            setTimeout(() => loadFiles('silent'), 800);
        } catch (error: unknown) {

            // Provide specific error messages
            if (getErrorMessage(error)?.includes('File not found') || getErrorMessage(error)?.includes('404')) {
                toast.error(t('fileManagement.toasts.fileNotFound'));
                // Still reload files to refresh the list
                setTimeout(() => loadFiles('silent'), 800);
            } else if (getErrorMessage(error)?.includes('permission') || getErrorMessage(error)?.includes('403')) {
                toast.error(t('fileManagement.toasts.noPermission'));
            } else {
                toast.error(getErrorMessage(error) || t('fileManagement.toasts.deleteFailed'));
            }
        } finally {
            storeSetDeleting(null);
            setPendingDeleteFile(null);
        }
    }, [pendingDeleteFile, storeSetDeleting, oxyServices, loadFiles, t]);

    const confirmBulkDelete = useCallback(() => {
        if (selectedIds.size === 0) return;
        bulkDeleteDialog.open();
    }, [selectedIds.size, bulkDeleteDialog]);

    const handleBulkDelete = useCallback(async () => {
        if (selectedIds.size === 0) return;

        try {
            const deletePromises = Array.from(selectedIds).map(async (fileId) => {
                try {
                    await oxyServices.deleteFile(fileId);
                    useFileStore.getState().removeFile(fileId);
                    return { success: true, fileId };
                } catch (error: unknown) {
                    return { success: false, fileId, error };
                }
            });

            const results = await Promise.allSettled(deletePromises);
            const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failed = results.length - successful;

            if (successful > 0) {
                toast.success(t('fileManagement.toasts.bulkDeleteSuccess', { count: successful }));
            }
            if (failed > 0) {
                toast.error(t('fileManagement.toasts.bulkDeleteFailed', { count: failed }));
            }

            setSelectedIds(new Set());
            setTimeout(() => loadFiles('silent'), 800);
        } catch (error: unknown) {
            toast.error(getErrorMessage(error) || t('fileManagement.toasts.bulkDeleteError'));
        }
    }, [selectedIds, files, oxyServices, loadFiles]);

    const handleBulkVisibilityChange = useCallback(async (visibility: 'private' | 'public' | 'unlisted') => {
        if (selectedIds.size === 0) return;

        try {
            const updatePromises = Array.from(selectedIds).map(async (fileId) => {
                try {
                    await oxyServices.assetUpdateVisibility(fileId, visibility);
                    return { success: true, fileId };
                } catch (error: unknown) {
                    return { success: false, fileId, error };
                }
            });

            const results = await Promise.allSettled(updatePromises);
            const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failed = results.length - successful;

            if (successful > 0) {
                toast.success(t('fileManagement.toasts.visibilitySuccess', { count: successful, visibility }));
                // Update file metadata in store
                Array.from(selectedIds).forEach(fileId => {
                    useFileStore.getState().updateFile(fileId, {
                        metadata: { ...files.find(f => f.id === fileId)?.metadata, visibility } as Partial<FileMetadata>['metadata']
                    });
                });
            }
            if (failed > 0) {
                toast.error(t('fileManagement.toasts.visibilityFailed', { count: failed }));
            }

            setTimeout(() => loadFiles('silent'), 800);
        } catch (error: unknown) {
            toast.error(getErrorMessage(error) || t('fileManagement.toasts.visibilityError'));
        }
    }, [selectedIds, oxyServices, files, loadFiles]);

    // Unified download function - works on all platforms
    const handleFileDownload = async (fileId: string, filename: string) => {
        try {
            // Resolve an authenticated, private-safe URL. The synchronous
            // `getFileDownloadUrl` yields the public CDN origin, which 404s for
            // private assets (the default visibility).
            const downloadUrl = await oxyServices.getFileDownloadUrlAsync(fileId);

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
                    toast.success(t('fileManagement.toasts.downloadStarted'));
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
                    toast.success(t('fileManagement.toasts.downloadSuccess'));
                }
            } else {
                // For mobile, open the URL (user can save from browser)
                // Note: This is a simplified approach - for full mobile support,
                // consider using expo-file-system or react-native-fs
                toast.info(t('fileManagement.toasts.downloadMobile'));
            }
        } catch (error: unknown) {
            toast.error(getErrorMessage(error) || t('fileManagement.toasts.downloadFailed'));
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
                        // For images, PDFs, videos, and audio, we render the URL
                        // directly. Resolve the authenticated, private-safe URL —
                        // the synchronous public-CDN URL 404s for private assets.
                        const downloadUrl = await oxyServices.getFileDownloadUrlAsync(file.id);
                        setFileContent(downloadUrl);
                    } else {
                        // For text files, get the content using authenticated request
                        const content = await oxyServices.getFileContentAsText(file.id);
                        setFileContent(content);
                    }
                } catch (error: unknown) {
                    if (getErrorMessage(error)?.includes('404') || getErrorMessage(error)?.includes('not found')) {
                        toast.error(t('fileManagement.toasts.fileNotFoundContent'));
                    } else {
                        toast.error(t('fileManagement.toasts.loadContentFailed'));
                    }
                    setFileContent(null);
                }
            } else {
                // For non-viewable files, don't load content
                setFileContent(null);
            }
        } catch (error: unknown) {
            toast.error(getErrorMessage(error) || t('fileManagement.toasts.openFailed'));
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
        fileDetailsControl.open();
    };

    const renderJustifiedPhotoItem = useCallback((photo: FileMetadata, width: number, height: number, isLast: boolean) => {
        const downloadUrl = thumbSourceFor(photo);

        return (
            <TouchableOpacity
                key={photo.id}
                className="rounded-[6px] overflow-hidden relative"
                style={{
                    width,
                    height,
                    ...(selectMode && selectedIds.has(photo.id) ? { borderWidth: 2, borderColor: colors.primary } : {}),
                    ...(selectMode && multiSelect && selectedIds.size > 0 && !selectedIds.has(photo.id) ? { opacity: 0.4 } : {}),
                }}
                onPress={() => handleFileOpen(photo)}
                activeOpacity={0.8}
            >
                <View className="w-full h-full relative rounded-[6px] overflow-hidden">
                    <ExpoImage
                        source={{ uri: downloadUrl }}
                        style={screenStyles.justifiedPhotoImage}
                        contentFit="cover"
                        transition={120}
                        cachePolicy="memory-disk"
                        onError={() => {
                            // Photo failed to load, will show placeholder
                        }}
                        accessibilityLabel={photo.filename}
                    />
                    {selectMode && (
                        <View className="absolute top-[4px] right-[4px] rounded-[12px] p-[2px]" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
                            <Ionicons name={selectedIds.has(photo.id) ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selectedIds.has(photo.id) ? colors.primary : colors.text} />
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        );
    }, [thumbSourceFor, selectMode, selectedIds, multiSelect, colors.primary, colors.text]);

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

    // SettingsListItem-based file items (for 'all' view)
    const groupedFileItems: FileListItem[] = useMemo(() => {
        // filteredFiles is already sorted, so just use it directly
        const sortedFiles = filteredFiles;

        return sortedFiles.map((file) => {
            const isImage = file.contentType.startsWith('image/');
            const isPDF = file.contentType.includes('pdf');
            const isVideo = file.contentType.startsWith('video/');
            const hasPreview = isImage || isPDF || isVideo;
            const isSelected = selectedIds.has(file.id);

            // Create icon for preview thumbnails (36x36)
            let fileIcon: React.ReactNode | undefined;
            if (hasPreview) {
                if (isImage) {
                    fileIcon = (
                        <View style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden' }}>
                            <ExpoImage
                                source={{ uri: thumbSourceFor(file) }}
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
                    fileIcon = (
                        <View style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000000', position: 'relative' }}>
                            <ExpoImage
                                source={{ uri: thumbSourceFor(file) }}
                                style={{ width: 36, height: 36 }}
                                contentFit="cover"
                                transition={120}
                                cachePolicy="memory-disk"
                                onError={(_: unknown) => {
                                    // If thumbnail not available, we still show icon overlay
                                }}
                                accessibilityLabel={`${file.filename} video thumbnail`}
                            />
                            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' }}>
                                <Ionicons name="play" size={16} color="#FFFFFF" />
                            </View>
                        </View>
                    );
                } else if (isPDF) {
                    fileIcon = (
                        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF6B6B20' }}>
                            <Ionicons name="document" size={20} color={colors.primary} />
                        </View>
                    );
                }
            }

            return {
                id: file.id,
                icon: fileIcon ?? (!hasPreview ? <Ionicons name={getFileIcon(file.contentType)} size={20} color={colors.primary} /> : undefined),
                title: file.filename,
                description: `${formatFileSize(file.length)} • ${new Date(file.uploadDate).toLocaleDateString()}`,
                onPress: () => {
                    // Support selection in regular mode with long press or if already selecting
                    if (!selectMode && selectedIds.size > 0) {
                        // If already in selection mode (some files selected), toggle selection
                        toggleSelect(file);
                    } else {
                        handleFileOpen(file);
                    }
                },
                // Hide action buttons when selecting (in selectMode or bulk operations mode)
                rightElement: (!selectMode && selectedIds.size === 0) ? (
                    <View className="flex-row items-center gap-[6px] ml-[12px]">
                        {(isImage || isVideo || file.contentType.includes('pdf')) && (
                            <TouchableOpacity
                                className="w-[34px] h-[34px] rounded-[8px] items-center justify-center"
                                style={{ backgroundColor: colors.backgroundSecondary }}
                                onPress={() => handleFileOpen(file)}
                            >
                                <Ionicons name="eye" size={18} color={colors.primary} />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            className="w-[34px] h-[34px] rounded-[8px] items-center justify-center"
                            style={{ backgroundColor: colors.backgroundSecondary }}
                            onPress={() => handleFileDownload(file.id, file.filename)}
                        >
                            <Ionicons name="download" size={18} color={colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            className="w-[34px] h-[34px] rounded-[8px] items-center justify-center"
                            style={{ backgroundColor: colors.negativeSubtle }}
                            onPress={() => confirmFileDelete(file.id, file.filename)}
                            disabled={deleting === file.id}
                        >
                            {deleting === file.id ? (
                                <ActivityIndicator size="small" color={colors.error} />
                            ) : (
                                <Ionicons name="trash" size={18} color={colors.error} />
                            )}
                        </TouchableOpacity>
                    </View>
                ) : undefined,
            };
        });
    }, [filteredFiles, theme, deleting, handleFileDownload, confirmFileDelete, handleFileOpen, thumbSourceFor, selectMode, selectedIds]);

    // Scroll to selected file after selection
    useEffect(() => {
        if (lastSelectedFileId && selectMode) {
            if (viewMode === 'all' && scrollViewRef.current) {
                // Find the index of the selected file (filteredFiles is already sorted)
                const itemIndex = filteredFiles.findIndex(file => file.id === lastSelectedFileId);

                if (itemIndex >= 0) {
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
                    // Rough scroll estimate for the justified grid (3 photos/row; variable row heights).
                    const itemsPerRow = 3;
                    const estimatedRowHeight = 150;
                    const rowGap = 4;
                    const row = Math.floor(photoIndex / itemsPerRow);
                    const finalScrollPosition = row * (estimatedRowHeight + rowGap) - 100;

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
    }, [lastSelectedFileId, selectMode, viewMode, filteredFiles, safeContainerWidth]);

    // Clear selected file ID after scroll animation completes
    useEffect(() => {
        if (lastSelectedFileId && scrollViewRef.current) {
            const timeoutId = setTimeout(() => {
                setLastSelectedFileId(null);
            }, 600); // Allow time for scroll animation to complete

            return () => clearTimeout(timeoutId);
        }
    }, [lastSelectedFileId]);

    const renderPhotoGrid = useCallback(() => {
        const photos = filteredFiles.filter(file => file.contentType.startsWith('image/'));

        if (photos.length === 0) {
            return (
                <View className="items-center py-[40px] px-[24px]">
                    <Ionicons name="images-outline" size={64} color={colors.textTertiary} />
                    <Text className="text-[24px] font-bold mt-[16px] mb-[8px]" style={{ color: colors.text }}>{t('fileManagement.emptyPhotos.title')}</Text>
                    <Text className="text-[16px] text-center leading-[24px] mb-[32px]" style={{ color: colors.textSecondary }}> {
                        user?.id === targetUserId
                            ? t('fileManagement.emptyPhotos.ownDescription')
                            : t('fileManagement.emptyPhotos.otherDescription')
                    } </Text>
                    {user?.id === targetUserId && (
                        <TouchableOpacity
                            className="flex-row items-center px-[24px] py-[12px] rounded-[24px] gap-[8px]"
                            style={{ backgroundColor: colors.primary }}
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
                                    <Text className="text-white text-[16px] font-semibold">{t('fileManagement.uploadPhotos')}</Text>
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
                className="flex-1"
                contentContainerClassName="p-[10px]"
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => loadFiles('refresh')}
                        tintColor={colors.primary}
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
                    <View className="flex-row items-center justify-center py-[16px] gap-[8px]">
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text className="text-[14px] italic" style={{ color: colors.textSecondary }}>{t('fileManagement.loadingPhotoLayout')}</Text>
                    </View>
                )}

                <JustifiedPhotoGrid
                    photos={photos}
                    photoDimensions={photoDimensions}
                    loadPhotoDimensions={loadPhotoDimensions}
                    createJustifiedRows={createJustifiedRows}
                    renderJustifiedPhotoItem={renderJustifiedPhotoItem}
                    textColor={colors.text}
                    containerWidth={
                        typeof containerWidth === 'number' && containerWidth > 0
                            ? containerWidth
                            : undefined
                    }
                />
            </ScrollView>
        );
    }, [
        filteredFiles,
        colors,
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
        containerWidth,
    ]);

    // Inline justified grid removed (moved to components/photogrid/JustifiedPhotoGrid.tsx)



    const renderEmptyState = () => (
        <View className="items-center py-[40px] px-[24px]">
            <Ionicons name="folder-open-outline" size={64} color={colors.textTertiary} />
            <Text className="text-[24px] font-bold mt-[16px] mb-[8px]" style={{ color: colors.text }}>{t('fileManagement.emptyFiles.title')}</Text>
            <Text className="text-[16px] text-center leading-[24px] mb-[32px]" style={{ color: colors.textSecondary }}>
                {user?.id === targetUserId
                    ? t('fileManagement.emptyFiles.ownDescription')
                    : t('fileManagement.emptyFiles.otherDescription')
                }
            </Text>
            {user?.id === targetUserId && (
                <TouchableOpacity
                    className="flex-row items-center px-[24px] py-[12px] rounded-[24px] gap-[8px]"
                    style={{ backgroundColor: colors.primary }}
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
                            <Text className="text-white text-[16px] font-semibold">{t('fileManagement.uploadFiles')}</Text>
                        </>
                    )}
                </TouchableOpacity>
            )}
        </View>
    );

    // Professional Skeleton Loading Component with Advanced Shimmer Effect
    const SkeletonLoader = React.memo(() => {
        const shimmerAnim = useRef(new Animated.Value(0)).current;
        const skeletonContainerWidth = safeContainerWidth;

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

        const SkeletonBox = ({ width, height, borderRadius = 8, style, delay = 0 }: { width: number | string; height: number; borderRadius?: number; style?: Record<string, unknown>; delay?: number }) => {
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
                            backgroundColor: colors.backgroundSecondary,
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
                            backgroundColor: colors.backgroundSecondary,
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
                                backgroundColor: bloomTheme.isDark
                                    ? 'rgba(255, 255, 255, 0.08)'
                                    : 'rgba(255, 255, 255, 0.8)',
                                shadowColor: bloomTheme.isDark ? '#000' : '#FFF',
                                shadowOffset: { width: 0, height: 0 },
                                shadowOpacity: 0.3,
                                shadowRadius: 10,
                            }}
                        />
                    </Animated.View>
                </View>
            );
        };

        // Skeleton file item matching SettingsListItem structure
        const SkeletonFileItem = ({ index }: { index: number }) => (
            <View
                style={[
                    {
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        backgroundColor: colors.background,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.border,
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
            <View className="flex-1" style={{ backgroundColor }}>
                {/* Header Skeleton */}
                <View
                    className="flex-row items-center justify-between px-[16px] py-[12px] relative"
                    style={{ borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }}
                >
                    <SkeletonBox width={44} height={44} borderRadius={12} />
                    <View className="flex-1 items-center justify-center mx-[16px]">
                        <SkeletonBox width={140} height={20} style={{ marginBottom: 6 }} />
                        <SkeletonBox width={100} height={14} />
                    </View>
                    <SkeletonBox width={44} height={44} borderRadius={12} />
                </View>

                {/* Controls Bar Skeleton */}
                <View className="flex-row items-center justify-between px-[12px] py-[12px] gap-[12px]">
                    <SkeletonBox width={100} height={36} borderRadius={18} />
                    <SkeletonBox width={44} height={44} borderRadius={22} />
                </View>

                {/* Search Bar Skeleton */}
                <View
                    className="flex-row items-center px-[14px] py-[10px] mx-[12px] mb-[12px] rounded-full gap-[10px]"
                    style={{ backgroundColor: colors.card }}
                >
                    <SkeletonBox width="100%" height={44} borderRadius={12} />
                </View>

                {/* Stats Container Skeleton */}
                <View
                    className="flex-row px-[14px] py-[10px] mx-[12px] mb-[12px] rounded-[18px]"
                    style={{ backgroundColor: colors.card }}
                >
                    {[1, 2, 3].map((i) => (
                        <View key={i} className="flex-1 items-center py-[4px]">
                            <SkeletonBox width={50} height={20} style={{ marginBottom: 4 }} delay={i * 30} />
                            <SkeletonBox width={40} height={14} delay={i * 30 + 15} />
                        </View>
                    ))}
                </View>

                {/* File List Skeleton - Matching SettingsListItem */}
                <ScrollView
                    className="flex-1"
                    contentContainerClassName="px-[12px] pt-0 pb-[12px]"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={{
                        backgroundColor: colors.card,
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

    // Dedicated flagship-style photo picker view used in the avatar-picker
    // context (selectMode + image-only filter). The picker is intentionally
    // minimal: black backdrop, edge-to-edge grid, translucent header. The
    // standalone file manager (non-picker browse) keeps the existing UI.
    if (isImageOnlyPicker && !showUploadPreview) {
        const photosOnly = filteredFiles.filter(
            (file) => file.contentType.startsWith('image/'),
        );
        const isOwner = user?.id === targetUserId;
        const allowUpload = isOwner && allowUploadInSelectMode;

        return (
            <>
                <PhotoPickerView
                    photos={photosOnly}
                    selectedIds={selectedIds}
                    multiSelect={multiSelect}
                    maxSelection={maxSelection}
                    allowUpload={allowUpload}
                    refreshing={refreshing}
                    uploading={uploading}
                    isPickingDocument={isPickingDocument}
                    uploadProgress={uploadProgress}
                    hasMore={paging.hasMore}
                    loadingMore={paging.loadingMore}
                    reduceMotion={reduceMotion}
                    getThumbUrl={thumbSourceFor}
                    primaryColor={colors.primary}
                    isOwner={isOwner}
                    onTogglePhoto={toggleSelect}
                    onPreviewPhoto={(file) => showFileDetailsModal(file)}
                    onUpload={handleFileUpload}
                    onRefresh={() => loadFiles('refresh')}
                    onLoadMore={() => loadFiles('more')}
                    onCancel={() => {
                        if (onClose) onClose();
                        else goBack?.();
                    }}
                    onConfirm={confirmMultiSelection}
                    t={t}
                />
                {/* Long-press preview surfaces the existing details modal. */}
                <FileDetailsModal
                    control={fileDetailsControl}
                    file={selectedFile}
                    onDownload={handleFileDownload}
                    onDelete={confirmFileDelete}
                    isOwner={isOwner}
                />
            </>
        );
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
                    onDelete={confirmFileDelete}
                    isOwner={user?.id === targetUserId}
                />
                <FileDetailsModal
                    control={fileDetailsControl}
                    file={selectedFile}
                    onDownload={handleFileDownload}
                    onDelete={confirmFileDelete}
                    isOwner={user?.id === targetUserId}
                />
            </>
        );
    }

    // If upload preview is showing, render it inline instead of the file list
    if (showUploadPreview) {
        return (
            <View className="flex-1">
                <Header
                    title={t('fileManagement.reviewFiles')}
                    subtitle={t('fileManagement.readyToUpload', { count: pendingFiles.length })}
                    onBack={handleCancelUpload}
                    showBackButton
                    variant="minimal"
                    elevation="none"
                    titleAlignment="left"
                />
                <UploadPreview
                    pendingFiles={pendingFiles}
                    onConfirm={handleConfirmUpload}
                    onCancel={handleCancelUpload}
                    onRemoveFile={removePendingFile}
                    inline={true}
                />
            </View>
        );
    }

    return (
        <View className="flex-1">
            <Header
                title={selectMode ? (multiSelect ? (maxSelection ? t('fileManagement.selectedWithMax', { count: selectedIds.size, max: maxSelection }) : t('fileManagement.selected', { count: selectedIds.size })) : t('fileManagement.selectFile')) : (viewMode === 'photos' ? t('fileManagement.photos') : t('fileManagement.title'))}
                subtitle={selectMode ? (multiSelect ? t('fileManagement.available', { count: filteredFiles.length }) : t('fileManagement.tapToSelect')) : (filteredFiles.length === 1 ? t('fileManagement.itemCount', { count: filteredFiles.length }) : t('fileManagement.itemCount_plural', { count: filteredFiles.length }))}
                actions={selectMode && multiSelect ? [
                    {
                        key: 'clear',
                        text: t('fileManagement.clear'),
                        onPress: () => setSelectedIds(new Set()),
                        disabled: selectedIds.size === 0,
                    },
                    {
                        key: 'confirm',
                        text: t('fileManagement.confirm'),
                        onPress: confirmMultiSelection,
                        disabled: selectedIds.size === 0,
                    }
                ] : !selectMode && selectedIds.size > 0 ? [
                    {
                        key: 'clear',
                        text: t('fileManagement.clear'),
                        onPress: () => setSelectedIds(new Set()),
                    },
                    {
                        key: 'delete',
                        text: t('fileManagement.delete', { count: selectedIds.size }),
                        onPress: confirmBulkDelete,
                        icon: 'delete',
                    },
                    {
                        key: 'visibility',
                        text: t('fileManagement.visibility'),
                        onPress: () => {
                            visibilityChangeDialog.open();
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

            <View className="flex-row items-center justify-between px-[12px] py-[12px] gap-[12px]">
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    className="flex-1"
                    style={{ maxWidth: '80%' }}
                >
                    <View
                        className="flex-row rounded-full p-[2px] overflow-hidden"
                        style={{ backgroundColor: colors.card }}
                    >
                        <AnimatedButton
                            isSelected={viewMode === 'all'}
                            onPress={() => setViewMode('all')}
                            icon={viewMode === 'all' ? 'folder' : 'folder-outline'}
                            primaryColor={colors.primary}
                            textColor={colors.text}
                            style={screenStyles.viewModeButton}
                            accessibilityLabel={t('fileManagement.a11y.viewAll') || 'Show all files'}
                        />
                        <AnimatedButton
                            isSelected={viewMode === 'photos'}
                            onPress={() => setViewMode('photos')}
                            icon={viewMode === 'photos' ? 'image-multiple' : 'image-multiple-outline'}
                            primaryColor={colors.primary}
                            textColor={colors.text}
                            style={screenStyles.viewModeButton}
                            accessibilityLabel={t('fileManagement.a11y.viewPhotos') || 'Show photos only'}
                        />
                        {!isImageOnlyPicker && (
                            <>
                                <AnimatedButton
                                    isSelected={viewMode === 'videos'}
                                    onPress={() => setViewMode('videos')}
                                    icon={viewMode === 'videos' ? 'video' : 'video-outline'}
                                    primaryColor={colors.primary}
                                    textColor={colors.text}
                                    style={screenStyles.viewModeButton}
                                    accessibilityLabel={t('fileManagement.a11y.viewVideos') || 'Show videos only'}
                                />
                                <AnimatedButton
                                    isSelected={viewMode === 'documents'}
                                    onPress={() => setViewMode('documents')}
                                    icon={viewMode === 'documents' ? 'file-document' : 'file-document-outline'}
                                    primaryColor={colors.primary}
                                    textColor={colors.text}
                                    style={screenStyles.viewModeButton}
                                    accessibilityLabel={t('fileManagement.a11y.viewDocuments') || 'Show documents only'}
                                />
                                <AnimatedButton
                                    isSelected={viewMode === 'audio'}
                                    onPress={() => setViewMode('audio')}
                                    icon={viewMode === 'audio' ? 'music-note' : 'music-note-outline'}
                                    primaryColor={colors.primary}
                                    textColor={colors.text}
                                    style={screenStyles.viewModeButton}
                                    accessibilityLabel={t('fileManagement.a11y.viewAudio') || 'Show audio only'}
                                />
                            </>
                        )}
                    </View>
                </ScrollView>
                <TouchableOpacity
                    className="flex-row items-center justify-center px-[10px] py-[6px] rounded-full min-w-[36px] gap-[4px]"
                    style={{ backgroundColor: colors.card }}
                    accessibilityRole="button"
                    accessibilityLabel={t('fileManagement.a11y.sortBy', {
                        field: sortBy,
                        order: sortOrder === 'asc' ? 'ascending' : 'descending',
                    }) || `Sort by ${sortBy}, ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
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
                        color={colors.text}
                    />
                    <MaterialCommunityIcons
                        name={sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'}
                        size={14}
                        color={colors.textSecondary}
                    />
                </TouchableOpacity>
                {user?.id === targetUserId && (!selectMode || (selectMode && allowUploadInSelectMode)) && (
                    <TouchableOpacity
                        className={`h-[44px] rounded-[22px] items-center justify-center ${isImageOnlyPicker ? 'w-auto min-w-[44px] px-[14px]' : 'w-[44px]'}`}
                        style={{ backgroundColor: colors.primary }}
                        onPress={handleFileUpload}
                        disabled={uploading || isPickingDocument}
                        accessibilityRole="button"
                        accessibilityLabel={
                            isImageOnlyPicker
                                ? (t('fileManagement.a11y.uploadFromDevice') || 'Upload photo from device')
                                : (t('fileManagement.a11y.uploadFile') || 'Upload file')
                        }
                        accessibilityState={{ busy: uploading || isPickingDocument }}
                    >
                        {uploading ? (
                            <View className="items-center justify-center">
                                <ActivityIndicator size="small" color="#FFFFFF" />
                                {uploadProgress && (
                                    <Text className="text-white text-[10px] font-semibold mt-[2px]">
                                        {uploadProgress.current}/{uploadProgress.total}
                                    </Text>
                                )}
                            </View>
                        ) : isPickingDocument ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : isImageOnlyPicker ? (
                            <View className="flex-row items-center gap-[6px]">
                                <Ionicons name="cloud-upload" size={18} color="#FFFFFF" />
                                <Text className="text-white text-[14px] font-semibold" numberOfLines={1}>
                                    {t('fileManagement.upload') || 'Upload'}
                                </Text>
                            </View>
                        ) : (
                            <Ionicons name="add" size={22} color="#FFFFFF" />
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {/* Search Bar */}
            {files.length > 0 && (viewMode === 'all' || files.some(f => f.contentType.startsWith('image/'))) && (
                <View
                    className="flex-row items-center px-[14px] py-[10px] mx-[12px] mb-[12px] rounded-full gap-[10px]"
                    style={{ backgroundColor: colors.card }}
                >
                    <Ionicons name="search" size={22} color={colors.icon} />
                    <TextInput
                        className="flex-1 text-[16px] leading-[20px]"
                        style={{ color: colors.text }}
                        placeholder={viewMode === 'photos' ? t('fileManagement.searchPhotos') : t('fileManagement.searchFiles')}
                        placeholderTextColor={colors.textSecondary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity
                            onPress={() => setSearchQuery('')}
                            className="p-[4px] rounded-[12px] items-center justify-center"
                        >
                            <Ionicons name="close-circle" size={22} color={colors.icon} />
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* File Stats */}
            {files.length > 0 && (
                <View
                    className="flex-row px-[14px] py-[10px] mx-[12px] mb-[12px] rounded-[18px]"
                    style={{ backgroundColor: colors.card }}
                >
                    <View className="flex-1 items-center py-[4px]">
                        <Text className="text-[20px] font-extrabold leading-[24px]" style={{ color: colors.text, letterSpacing: -0.5 }}>{filteredFiles.length}</Text>
                        <Text className="text-[12px] font-medium mt-[2px]" style={{ color: colors.textSecondary, letterSpacing: 0.2 }}>
                            {searchQuery.length > 0 ? t('fileManagement.found') : (filteredFiles.length === 1 ? (viewMode === 'photos' ? t('fileManagement.photo') : t('fileManagement.file')) : (viewMode === 'photos' ? t('fileManagement.photos_stat') : t('fileManagement.files')))}
                        </Text>
                    </View>
                    <View className="flex-1 items-center py-[4px]">
                        <Text className="text-[20px] font-extrabold leading-[24px]" style={{ color: colors.text, letterSpacing: -0.5 }}>
                            {formatFileSize(filteredFiles.reduce((total, file) => total + file.length, 0))}
                        </Text>
                        <Text className="text-[12px] font-medium mt-[2px]" style={{ color: colors.textSecondary, letterSpacing: 0.2 }}>
                            {searchQuery.length > 0 ? t('fileManagement.size') : t('fileManagement.totalSize')}
                        </Text>
                    </View>
                    {searchQuery.length > 0 && (
                        <View className="flex-1 items-center py-[4px]">
                            <Text className="text-[20px] font-extrabold leading-[24px]" style={{ color: colors.text, letterSpacing: -0.5 }}>{files.length}</Text>
                            <Text className="text-[12px] font-medium mt-[2px]" style={{ color: colors.textSecondary, letterSpacing: 0.2 }}>
                                {t('fileManagement.total')}
                            </Text>
                        </View>
                    )}
                </View>
            )}

            {/* File List */}
            {viewMode === 'photos' ? (
                renderPhotoGrid()
            ) : (
                <FileListSection
                    scrollViewRef={scrollViewRef}
                    filteredFiles={filteredFiles}
                    searchQuery={searchQuery}
                    items={groupedFileItems}
                    paging={paging}
                    refreshing={refreshing}
                    colors={colors}
                    t={t}
                    onRefresh={() => loadFiles('refresh')}
                    onLoadMore={() => loadFiles('more')}
                    onClearSearch={() => setSearchQuery('')}
                    renderEmptyState={renderEmptyState}
                />
            )}

            {!selectMode && (
                <FileDetailsModal
                    control={fileDetailsControl}
                    file={selectedFile}
                    onDownload={handleFileDownload}
                    onDelete={confirmFileDelete}
                    isOwner={user?.id === targetUserId}
                />
            )}

            {/* Uploading banner overlay with progress */}
            {!selectMode && uploading && (
                <UploadBar
                    uploadProgress={uploadProgress}
                    isDark={bloomTheme.isDark}
                    colors={colors}
                    t={t}
                />
            )}

            {/* Selection bar removed; actions are now in header */}
            {/* Global loadingMore bar removed; now inline in scroll areas */}
            <Dialog
                control={fileDeleteDialog}
                title={t('fileManagement.deleteFile') || 'Delete File'}
                description={pendingDeleteFile ? t('fileManagement.confirms.deleteFile', { filename: pendingDeleteFile.name }) : ''}
                actions={[
                    { label: t('fileManagement.confirm') || 'Delete', color: 'destructive', onPress: handleFileDelete },
                    { label: t('common.cancel') || 'Cancel', color: 'cancel' },
                ]}
            />
            <Dialog
                control={bulkDeleteDialog}
                title={t('fileManagement.deleteFiles') || 'Delete Files'}
                description={t('fileManagement.confirms.deleteFiles', { count: selectedIds.size })}
                actions={[
                    { label: t('fileManagement.confirm') || 'Delete', color: 'destructive', onPress: handleBulkDelete },
                    { label: t('common.cancel') || 'Cancel', color: 'cancel' },
                ]}
            />
            <Dialog
                control={visibilityChangeDialog}
                title={t('fileManagement.changeVisibility') || 'Change Visibility'}
                description={t('fileManagement.changeVisibilityConfirm', { count: selectedIds.size })}
                actions={[
                    { label: t('fileManagement.private') || 'Private', onPress: () => handleBulkVisibilityChange('private') },
                    { label: t('fileManagement.public') || 'Public', onPress: () => handleBulkVisibilityChange('public') },
                    { label: t('fileManagement.unlisted') || 'Unlisted', onPress: () => handleBulkVisibilityChange('unlisted') },
                    { label: t('common.cancel') || 'Cancel', color: 'cancel' },
                ]}
            />
        </View>
    );
};

export default FileManagementScreen;

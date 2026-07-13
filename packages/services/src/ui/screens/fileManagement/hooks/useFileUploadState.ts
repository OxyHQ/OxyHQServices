import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { toast } from '@oxyhq/bloom';
import type { AssetUploadInput, FileMetadata } from '@oxyhq/core';
import { useFileStore } from '../../../stores/fileStore';
import type { useUploadFile } from '../../../hooks/mutations/useAccountMutations';
import { convertDocumentPickerAssetToFile, formatFileSize } from '../../../utils/fileManagement';
import {
    type PendingUploadFile,
    type UploadCandidate,
    candidateName,
    candidateSize,
    candidateType,
    candidateUri,
    getErrorMessage,
    loadDocumentPicker,
} from '../shared';

/** Dependencies threaded into the upload-state hook from the orchestrator. */
export interface UseFileUploadStateParams {
    targetUserId?: string;
    uploadFileMutation: ReturnType<typeof useUploadFile>;
    defaultVisibility: 'private' | 'public' | 'unlisted';
    selectMode: boolean;
    multiSelect: boolean;
    afterSelect: 'close' | 'back' | 'none';
    onSelect?: (file: FileMetadata) => void;
    goBack?: () => void;
    onClose?: () => void;
    selectedIds: Set<string>;
    setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    loadFiles: (mode?: 'initial' | 'refresh' | 'silent' | 'more') => Promise<void> | void;
    t: (key: string, vars?: Record<string, string | number>) => string;
}

/** Public surface returned to the orchestrator. */
export interface UseFileUploadStateResult {
    isPickingDocument: boolean;
    pendingFiles: PendingUploadFile[];
    showUploadPreview: boolean;
    handleFileUpload: () => Promise<void>;
    handleConfirmUpload: () => Promise<void>;
    handleCancelUpload: () => void;
    removePendingFile: (index: number) => void;
}

/**
 * Owns the self-contained document-picking + upload-preview state and handlers
 * extracted from FileManagementScreen. Behaviour is preserved verbatim — the
 * orchestrator simply threads in the values these handlers depend on and
 * consumes the returned state/handlers.
 */
export const useFileUploadState = ({
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
}: UseFileUploadStateParams): UseFileUploadStateResult => {
    const [isPickingDocument, setIsPickingDocument] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<PendingUploadFile[]>([]);
    const [showUploadPreview, setShowUploadPreview] = useState(false);

    const uploadStartRef = useRef<number | null>(null);
    const MIN_BANNER_MS = 600;

    const storeSetUploading = useFileStore(s => s.setUploading);
    const storeSetUploadProgress = useFileStore(s => s.setUploadProgress);

    const endUpload = useCallback(() => {
        const started = uploadStartRef.current;
        const elapsed = started ? Date.now() - started : MIN_BANNER_MS;
        const remaining = elapsed < MIN_BANNER_MS ? MIN_BANNER_MS - elapsed : 0;
        setTimeout(() => {
            useFileStore.getState().setUploading(false);
            uploadStartRef.current = null;
        }, remaining);
    }, []);

    const processFileUploads = async (selectedFiles: UploadCandidate[]): Promise<FileMetadata[]> => {
        if (selectedFiles.length === 0) return [];
        if (!targetUserId) return []; // Guard clause to ensure userId is defined
        const uploadedFiles: FileMetadata[] = [];
        try {
            storeSetUploadProgress({ current: 0, total: selectedFiles.length });
            const maxSize = 50 * 1024 * 1024; // 50MB
            const oversizedFiles = selectedFiles.filter(file => candidateSize(file) > maxSize);
            if (oversizedFiles.length > 0) {
                const fileList = oversizedFiles.map(f => candidateName(f, 'file')).join(', ');
                toast.error(t('fileManagement.toasts.filesTooLarge', { files: fileList }));
                return [];
            }
            let successCount = 0;
            let failureCount = 0;
            const errors: string[] = [];
            for (let i = 0; i < selectedFiles.length; i++) {
                storeSetUploadProgress({ current: i + 1, total: selectedFiles.length });
                const raw = selectedFiles[i];
                const fileName = candidateName(raw, `file-${i + 1}`);
                const fileSize = candidateSize(raw);
                const fileType = candidateType(raw);
                const optimisticId = `temp-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`; // Unique ID per file

                try {
                    // Validate file before upload
                    if (!raw || !fileName || fileSize <= 0) {
                        const errorMsg = `Invalid file: ${fileName}`;
                        if (__DEV__) {
                            console.error('Upload validation failed:', { file: raw, error: errorMsg });
                        }
                        failureCount++;
                        errors.push(`${fileName}: Invalid file (missing name or size)`);
                        continue;
                    }

                    const optimisticFile: FileMetadata = {
                        id: optimisticId,
                        filename: fileName,
                        contentType: fileType,
                        length: fileSize,
                        chunkSize: 0,
                        uploadDate: new Date().toISOString(),
                        metadata: { uploading: true },
                        variants: [],
                    };
                    useFileStore.getState().addFile(optimisticFile, { prepend: true });

                    // Use the mutation hook with authentication handling
                    const result = await uploadFileMutation.mutateAsync({
                        file: raw as AssetUploadInput,
                        visibility: defaultVisibility,
                    });

                    // Attempt to refresh file list incrementally – fetch single file metadata if API allows
                    const f = result?.file ?? result?.files?.[0];
                    if (f) {
                        const merged: FileMetadata = {
                            id: f.id,
                            filename: f.originalName || f.sha256 || fileName,
                            contentType: f.mime || fileType,
                            length: f.size || fileSize,
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
                        useFileStore.getState().updateFile(optimisticId, { metadata: { uploading: false } as Partial<FileMetadata>['metadata'] });
                        if (__DEV__) {
                            console.warn('Upload completed but no file data returned:', { fileName, result });
                        }
                        // Still count as success if upload didn't throw
                        successCount++;
                    }
                } catch (error: unknown) {
                    failureCount++;
                    const errorMessage = getErrorMessage(error) || 'Upload failed';
                    const fullError = `${fileName}: ${errorMessage}`;
                    errors.push(fullError);
                    if (__DEV__) {
                        console.error('File upload failed:', {
                            fileName,
                            fileSize,
                            fileType,
                            error: errorMessage,
                            stack: (error instanceof Error) ? error.stack : undefined
                        });
                    }

                    // Remove optimistic file on error (use the same optimisticId from above)
                    useFileStore.getState().removeFile(optimisticId);
                }
            }

            // Show success/error messages
            if (successCount > 0) {
                toast.success(t('fileManagement.toasts.uploadSuccess', { count: successCount }));
            }
            if (failureCount > 0) {
                // Show detailed error message with first few errors
                const errorDetails = errors.length > 0
                    ? `\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? `\n...and ${errors.length - 3} more` : ''}`
                    : '';
                toast.error(`${t('fileManagement.toasts.uploadFailed', { count: failureCount })}${errorDetails}`);
            }
            // Silent background refresh to ensure metadata/variants updated
            setTimeout(() => { loadFiles('silent'); }, 1200);
        } catch (error: unknown) {
            toast.error(getErrorMessage(error) || t('fileManagement.toasts.uploadError'));
        } finally {
            storeSetUploadProgress(null);
        }
        return uploadedFiles;
    };

    const handleFileSelection = useCallback(async (selectedFiles: UploadCandidate[]) => {
        const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
        const processedFiles: PendingUploadFile[] = [];

        for (const file of selectedFiles) {
            // Validate file has required properties
            if (!file) {
                if (__DEV__) {
                    console.error('Invalid file: file is null or undefined');
                }
                toast.error(t('fileManagement.toasts.invalidFileMissing'));
                continue;
            }

            const name = candidateName(file, '');
            if (!name) {
                if (__DEV__) {
                    console.error('Invalid file: missing or invalid name property', file);
                }
                toast.error(t('fileManagement.toasts.invalidFileName'));
                continue;
            }

            const size = (file as { size?: number }).size;
            if (size === undefined || size === null || Number.isNaN(size)) {
                if (__DEV__) {
                    console.error('Invalid file: missing or invalid size property', file);
                }
                toast.error(t('fileManagement.toasts.invalidFileSize', { name }));
                continue;
            }

            if (size <= 0) {
                if (__DEV__) {
                    console.error('Invalid file: file size is zero or negative', file);
                }
                toast.error(t('fileManagement.toasts.fileEmpty', { name }));
                continue;
            }

            // Validate file size
            if (size > MAX_FILE_SIZE) {
                toast.error(t('fileManagement.toasts.fileTooLarge', { name, maxSize: formatFileSize(MAX_FILE_SIZE) }));
                continue;
            }

            const fileType = candidateType(file);

            // Generate preview for images - unified approach
            let preview: string | undefined;
            if (fileType.startsWith('image/')) {
                // Try to use file URI from expo-document-picker if available (works on all platforms)
                const fileUri = candidateUri(file);
                if (fileUri &&
                    (fileUri.startsWith('file://') || fileUri.startsWith('content://') ||
                        fileUri.startsWith('http://') || fileUri.startsWith('https://') ||
                        fileUri.startsWith('blob:'))) {
                    preview = fileUri;
                } else {
                    // Fallback: create blob URL if possible (works on web only)
                    try {
                        if ((typeof File !== 'undefined' && file instanceof File) ||
                            (typeof Blob !== 'undefined' && file instanceof Blob)) {
                            preview = URL.createObjectURL(file as Blob);
                        }
                    } catch (error: unknown) {
                        if (__DEV__) {
                            console.warn('Failed to create preview URL:', error);
                        }
                        // Preview is optional, continue without it
                    }
                }
            }

            processedFiles.push({
                file,
                preview,
                size,
                name,
                type: fileType
            });
        }

        if (processedFiles.length === 0) {
            toast.error(t('fileManagement.toasts.noValidFiles'));
            return;
        }

        // Show preview modal for user to review files before upload
        setPendingFiles(processedFiles);
        setShowUploadPreview(true);
    }, [t]);

    const handleConfirmUpload = async () => {
        if (pendingFiles.length === 0) return;

        setShowUploadPreview(false);
        uploadStartRef.current = Date.now();
        storeSetUploading(true);
        storeSetUploadProgress(null);

        try {
            const filesToUpload = pendingFiles.map(pf => pf.file);
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
        } catch (error: unknown) {
            toast.error(getErrorMessage(error) || t('fileManagement.toasts.uploadError'));
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
            toast.error(t('fileManagement.toasts.waitForSelection'));
            return;
        }

        try {
            setIsPickingDocument(true);

            // Lazy load expo-document-picker
            const picker = await loadDocumentPicker();

            // Use expo-document-picker (works on all platforms including web)
            // On web, it uses the native file input and provides File objects directly
            const result = await picker.getDocumentAsync({
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
                toast.error(t('fileManagement.toasts.noFilesSelected'));
                return;
            }

            // Convert expo document picker results to File-like objects
            // According to Expo 54 docs, expo-document-picker returns assets with:
            // - uri: file URI (file://, content://, or blob URL)
            // - name: file name
            // - size: file size in bytes
            // - mimeType: MIME type of the file
            // - file: (optional) native File object (usually only on web)
            const files: UploadCandidate[] = [];
            const errors: string[] = [];

            // Process files in parallel for better performance
            // This allows multiple files to be converted simultaneously
            const conversionPromises = result.assets.map((doc, index) =>
                convertDocumentPickerAssetToFile(doc, index)
                    .then((file): UploadCandidate | null => {
                        if (file) {
                            // Validate file has required properties before adding
                            if (!file.name || (file as { size?: number }).size === undefined) {
                                errors.push(`File "${doc.name || 'file'}" is invalid: missing required properties`);
                                return null;
                            }
                            return file;
                        }
                        return null;
                    })
                    .catch((error: unknown) => {
                        errors.push(`File "${doc.name || 'file'}": ${getErrorMessage(error) || 'Failed to process'}`);
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
                toast.error(t('fileManagement.toasts.loadSomeFailed', { errors: errorMessage }));
            }

            // Process successfully converted files
            if (files.length > 0) {
                await handleFileSelection(files);
            } else {
                // Files were selected but none could be converted
                toast.error(t('fileManagement.toasts.noFilesProcessed'));
            }
        } catch (error: unknown) {
            if (__DEV__) {
                console.error('File upload error:', error);
            }
            if (getErrorMessage(error)?.includes('expo-document-picker') || getErrorMessage(error)?.includes('Different document picking in progress')) {
                if (getErrorMessage(error)?.includes('Different document picking in progress')) {
                    toast.error(t('fileManagement.toasts.waitForSelection'));
                } else {
                    toast.error(t('fileManagement.toasts.filePickerNotAvailable'));
                }
            } else {
                toast.error(getErrorMessage(error) || t('fileManagement.toasts.selectFilesFailed'));
            }
        } finally {
            // Always reset the picking state, even if there was an error
            setIsPickingDocument(false);
        }
    };

    return {
        isPickingDocument,
        pendingFiles,
        showUploadPreview,
        handleFileUpload,
        handleConfirmUpload,
        handleCancelUpload,
        removePendingFile,
    };
};

export default useFileUploadState;

import { Alert } from 'react-native';
import type { FileMetadata } from '../../models/interfaces';
import { File as ExpoFile } from 'expo-file-system';
import { toast } from '../../lib/sonner';
import type { RouteName } from '../navigation/routes';
import { updateAvatarVisibility } from './avatarUtils';

/**
 * Format file size in bytes to human-readable string
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get icon name for file based on content type
 */
export function getFileIcon(contentType: string): string {
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'videocam';
    if (contentType.startsWith('audio/')) return 'musical-notes';
    if (contentType.includes('pdf')) return 'document-text';
    if (contentType.includes('word') || contentType.includes('doc')) return 'document';
    if (contentType.includes('excel') || contentType.includes('sheet')) return 'grid';
    if (contentType.includes('zip') || contentType.includes('archive')) return 'archive';
    return 'document-outline';
}

/**
 * Unified confirmation dialog - uses Alert.alert for all platforms
 */
export function confirmAction(
    message: string,
    title?: string,
    confirmText: string = 'OK',
    cancelText: string = 'Cancel'
): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(
            title || 'Confirm',
            message,
            [
                {
                    text: cancelText,
                    style: 'cancel',
                    onPress: () => resolve(false),
                },
                {
                    text: confirmText,
                    onPress: () => resolve(true),
                },
            ],
            { cancelable: true, onDismiss: () => resolve(false) }
        );
    });
}

/**
 * Convert DocumentPicker asset to File object
 * Handles both web (native File API) and mobile (URI-based) file sources
 * Expo 54 compatible - works across all platforms
 */
export async function convertDocumentPickerAssetToFile(
    doc: { file?: File | Blob; uri?: string; name?: string | null; mimeType?: string | null; size?: number | null },
    index: number
): Promise<File | null> {
    try {
        let file: File | null = null;

        // Priority 1: Use doc.file if available (web native File API)
        // This is the most efficient path as it doesn't require fetching
        if (doc.file && doc.file instanceof globalThis.File) {
            file = doc.file as File;
            // Ensure file has required properties
            if (!file.name && doc.name) {
                // Create new File with proper name if missing
                file = new globalThis.File([file], doc.name, { type: file.type || doc.mimeType || 'application/octet-stream' });
            }
            // Preserve URI for preview if available (useful for mobile previews)
            if (doc.uri) {
                (file as any).uri = doc.uri;
            }
            return file;
        }

        // Priority 2: Use uri to create File using Expo 54 FileSystem API
        // This path handles mobile file URIs (file://, content://) and web blob URLs
        if (doc.uri) {
            try {
                // Check if it's a web blob URL - use fetch for those
                if (doc.uri.startsWith('blob:') || doc.uri.startsWith('http://') || doc.uri.startsWith('https://')) {
                    const response = await fetch(doc.uri);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch file: ${response.statusText}`);
                    }
                    const blob = await response.blob();
                    const fileName = doc.name || `file-${index + 1}`;
                    const fileType = doc.mimeType || blob.type || 'application/octet-stream';
                    file = new globalThis.File([blob], fileName, { type: fileType });
                    // Preserve URI for preview
                    (file as any).uri = doc.uri;
                    return file;
                }

                // For mobile file URIs (file://, content://), use fetch to get blob
                // React Native's Blob doesn't support Uint8Array directly, so we use fetch
                const fileName = doc.name || `file-${index + 1}`;
                const fileType = doc.mimeType || 'application/octet-stream';
                
                // Use fetch to get the file as a blob (works with file:// and content:// URIs in React Native)
                const response = await fetch(doc.uri);
                if (!response.ok) {
                    throw new Error(`Failed to fetch file: ${response.statusText}`);
                }
                const blob = await response.blob();
                file = new globalThis.File([blob], fileName, { type: fileType });
                // Preserve URI for preview (especially important for mobile)
                (file as any).uri = doc.uri;
                return file;
            } catch (error: any) {
                console.error('Failed to read file from URI:', error);
                throw new Error(`Failed to load file: ${error.message || 'Unknown error'}`);
            }
        }

        // No file or URI available - this shouldn't happen with Expo 54
        throw new Error('Missing file data (no file or uri property)');
    } catch (error: any) {
        console.error('Error converting document to file:', error);
        throw error;
    }
}

/**
 * Helper to safely request a thumbnail variant only for image mime types.
 * Prevents backend warnings: "Variant thumb not supported for mime application/pdf".
 * 
 * @param file - File metadata
 * @param variant - Variant type (default: 'thumb')
 * @param getFileDownloadUrl - Function to get download URL from oxyServices
 */
export function getSafeDownloadUrl(
    file: FileMetadata,
    variant: string = 'thumb',
    getFileDownloadUrl: (fileId: string, variant?: string) => string
): string {
    const isImage = file.contentType.startsWith('image/');
    const isVideo = file.contentType.startsWith('video/');

    // Prefer explicit variant key if variants metadata present
    if (file.variants && file.variants.length > 0) {
        // For videos, try 'poster' regardless of requested variant
        if (isVideo) {
            const poster = file.variants.find(v => v.type === 'poster');
            if (poster) return getFileDownloadUrl(file.id, 'poster');
        }
        if (isImage) {
            const desired = file.variants.find(v => v.type === variant);
            if (desired) return getFileDownloadUrl(file.id, variant);
        }
    }

    if (isImage) {
        return getFileDownloadUrl(file.id, variant);
    }
    if (isVideo) {
        // Fallback to poster if backend supports implicit generation
        try {
            return getFileDownloadUrl(file.id, 'poster');
        } catch {
            return getFileDownloadUrl(file.id);
        }
    }
    // Other mime types: no variant
    return getFileDownloadUrl(file.id);
}

/**
 * Upload file raw - helper function for file uploads
 */
export async function uploadFileRaw(
    file: File | Blob,
    userId: string,
    oxyServices: any,
    visibility?: 'private' | 'public' | 'unlisted'
) {
    return await oxyServices.uploadRawFile(file, visibility);
}

/**
 * Configuration for creating an avatar picker handler
 */
export interface AvatarPickerConfig {
    /** Navigation function from BaseScreenProps */
    navigate?: (screen: RouteName, props?: Record<string, unknown>) => void;
    /** OxyServices instance */
    oxyServices: any;
    /** TanStack Query mutation for updating profile */
    updateProfileMutation: {
        mutateAsync: (updates: { avatar: string }) => Promise<any>;
    };
    /** Callback to update local avatar state */
    onAvatarSelected?: (fileId: string) => void;
    /** i18n translation function */
    t: (key: string) => string | undefined;
    /** Optional context name for logging (e.g., 'AccountSettings', 'WelcomeNewUser') */
    contextName?: string;
}

/**
 * Creates a reusable avatar picker handler function.
 * 
 * This function navigates to the FileManagement screen and handles:
 * - Image file validation
 * - File visibility update to public
 * - Profile avatar update via mutation
 * - Success/error toast notifications
 * 
 * @example
 * ```tsx
 * const openAvatarPicker = createAvatarPickerHandler({
 *   navigate,
 *   oxyServices,
 *   updateProfileMutation,
 *   onAvatarSelected: setAvatarFileId,
 *   t,
 *   contextName: 'AccountSettings'
 * });
 * 
 * <TouchableOpacity onPress={openAvatarPicker}>
 *   <Text>Change Avatar</Text>
 * </TouchableOpacity>
 * ```
 */
export function createAvatarPickerHandler(config: AvatarPickerConfig): () => void {
    const {
        navigate,
        oxyServices,
        updateProfileMutation,
        onAvatarSelected,
        t,
        contextName = 'AvatarPicker'
    } = config;

    return () => {
        if (!navigate) {
            console.warn(`[${contextName}] navigate function is not available`);
            return;
        }

        navigate('FileManagement', {
            selectMode: true,
            multiSelect: false,
            disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
            afterSelect: 'none', // Don't navigate away - stay on current screen
            onSelect: async (file: any) => {
                if (!file.contentType.startsWith('image/')) {
                    toast.error(t('editProfile.toasts.selectImage') || 'Please select an image file');
                    return;
                }
                
                try {
                    // Update file visibility to public for avatar
                    await updateAvatarVisibility(file.id, oxyServices, contextName);

                    // Update local state if callback provided
                    if (onAvatarSelected) {
                        onAvatarSelected(file.id);
                    }

                    // Update user using TanStack Query mutation
                    await updateProfileMutation.mutateAsync({ avatar: file.id });
                    
                    toast.success(t('editProfile.toasts.avatarUpdated') || 'Avatar updated');
                } catch (e: any) {
                    toast.error(e.message || t('editProfile.toasts.updateAvatarFailed') || 'Failed to update avatar');
                }
            }
        });
    };
}


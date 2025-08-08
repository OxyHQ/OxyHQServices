import { useCallback } from 'react';
import { useAssetStore } from '../stores/assetStore';
import { OxyServices } from '../../core/OxyServices';
import { 
  Asset, 
  AssetLinkRequest, 
  AssetUnlinkRequest, 
  AssetUploadProgress 
} from '../../models/interfaces';

// Create a singleton instance for the hook
let oxyInstance: OxyServices | null = null;

export const setOxyAssetInstance = (instance: OxyServices) => {
  oxyInstance = instance;
};

/**
 * Hook for managing assets with Zustand store integration
 */
export const useAssets = () => {
  const {
    assets,
    uploadProgress,
    loading,
    errors,
    setAsset,
    setAssets,
    removeAsset,
    setUploadProgress,
    removeUploadProgress,
    addLink,
    removeLink,
    setUploading,
    setLinking,
    setDeleting,
    setUploadError,
    setLinkError,
    setDeleteError,
    clearErrors,
    getAssetsByApp,
    getAssetsByEntity,
    getAssetUsageCount,
    isAssetLinked,
    reset
  } = useAssetStore();

  // Upload asset with progress tracking
  const upload = useCallback(async (
    file: File, 
    metadata?: Record<string, any>
  ): Promise<Asset | null> => {
    if (!oxyInstance) {
      throw new Error('OxyServices instance not configured. Call setOxyAssetInstance first.');
    }

    try {
      clearErrors();
      setUploading(true);
      
      // Calculate SHA256 for progress tracking
      const sha256 = await oxyInstance.calculateSHA256(file);
      
      // Initialize progress tracking
      const initialProgress: AssetUploadProgress = {
        fileId: '', // Will be set after init
        uploaded: 0,
        total: file.size,
        percentage: 0,
        status: 'uploading'
      };
      
      // Upload with progress callback
      const result = await oxyInstance.assetUpload(file, metadata, (percentage) => {
        if (initialProgress.fileId) {
          setUploadProgress(initialProgress.fileId, {
            ...initialProgress,
            uploaded: Math.round((percentage / 100) * file.size),
            percentage,
            status: percentage < 100 ? 'uploading' : 'processing'
          });
        }
      });

      // Update progress with final status
      if (result.file && initialProgress.fileId) {
        setUploadProgress(initialProgress.fileId, {
          ...initialProgress,
          fileId: result.file.id,
          uploaded: file.size,
          percentage: 100,
          status: 'complete'
        });
        
        // Remove progress after a short delay
        setTimeout(() => {
          removeUploadProgress(result.file.id);
        }, 2000);
      }

      // Add asset to store
      if (result.file) {
        setAsset(result.file);
        return result.file;
      }
      
      return null;
    } catch (error: any) {
      setUploadError(error.message || 'Upload failed');
      throw error;
    } finally {
      setUploading(false);
    }
  }, [
    clearErrors, 
    setUploading, 
    setUploadProgress, 
    removeUploadProgress, 
    setAsset, 
    setUploadError
  ]);

  // Link asset to entity
  const link = useCallback(async (
    assetId: string, 
    app: string, 
    entityType: string, 
    entityId: string
  ): Promise<void> => {
    if (!oxyInstance) {
      throw new Error('OxyServices instance not configured. Call setOxyAssetInstance first.');
    }

    try {
      clearErrors();
      setLinking(true);
      
      const result = await oxyInstance.assetLink(assetId, app, entityType, entityId);
      
      if (result.file) {
        setAsset(result.file);
      } else {
        // If API doesn't return full file, update store optimistically
        addLink(assetId, {
          app,
          entityType,
          entityId,
          createdBy: '', // Will be filled by server
          createdAt: new Date().toISOString()
        });
      }
    } catch (error: any) {
      setLinkError(error.message || 'Link failed');
      throw error;
    } finally {
      setLinking(false);
    }
  }, [clearErrors, setLinking, setAsset, addLink, setLinkError]);

  // Unlink asset from entity
  const unlink = useCallback(async (
    assetId: string, 
    app: string, 
    entityType: string, 
    entityId: string
  ): Promise<void> => {
    if (!oxyInstance) {
      throw new Error('OxyServices instance not configured. Call setOxyAssetInstance first.');
    }

    try {
      clearErrors();
      setLinking(true);
      
      const result = await oxyInstance.assetUnlink(assetId, app, entityType, entityId);
      
      if (result.file) {
        setAsset(result.file);
      } else {
        // Update store optimistically
        removeLink(assetId, app, entityType, entityId);
      }
    } catch (error: any) {
      setLinkError(error.message || 'Unlink failed');
      throw error;
    } finally {
      setLinking(false);
    }
  }, [clearErrors, setLinking, setAsset, removeLink, setLinkError]);

  // Get asset URL
  const getUrl = useCallback(async (
    assetId: string, 
    variant?: string, 
    expiresIn?: number
  ): Promise<string> => {
    if (!oxyInstance) {
      throw new Error('OxyServices instance not configured. Call setOxyAssetInstance first.');
    }

    try {
      const result = await oxyInstance.assetGetUrl(assetId, variant, expiresIn);
      return result.url;
    } catch (error: any) {
      throw error;
    }
  }, []);

  // Get asset metadata
  const getAsset = useCallback(async (assetId: string): Promise<Asset> => {
    if (!oxyInstance) {
      throw new Error('OxyServices instance not configured. Call setOxyAssetInstance first.');
    }

    try {
      const result = await oxyInstance.assetGet(assetId);
      if (result.file) {
        setAsset(result.file);
        return result.file;
      }
      throw new Error('Asset not found');
    } catch (error: any) {
      throw error;
    }
  }, [setAsset]);

  // Delete asset
  const deleteAsset = useCallback(async (
    assetId: string, 
    force: boolean = false
  ): Promise<void> => {
    if (!oxyInstance) {
      throw new Error('OxyServices instance not configured. Call setOxyAssetInstance first.');
    }

    try {
      clearErrors();
      setDeleting(true);
      
      await oxyInstance.assetDelete(assetId, force);
      removeAsset(assetId);
    } catch (error: any) {
      setDeleteError(error.message || 'Delete failed');
      throw error;
    } finally {
      setDeleting(false);
    }
  }, [clearErrors, setDeleting, removeAsset, setDeleteError]);

  // Restore asset from trash
  const restore = useCallback(async (assetId: string): Promise<void> => {
    if (!oxyInstance) {
      throw new Error('OxyServices instance not configured. Call setOxyAssetInstance first.');
    }

    try {
      const result = await oxyInstance.assetRestore(assetId);
      if (result.file) {
        setAsset(result.file);
      }
    } catch (error: any) {
      throw error;
    }
  }, [setAsset]);

  // Get variants
  const getVariants = useCallback(async (assetId: string) => {
    if (!oxyInstance) {
      throw new Error('OxyServices instance not configured. Call setOxyAssetInstance first.');
    }

    try {
      return await oxyInstance.assetGetVariants(assetId);
    } catch (error: any) {
      throw error;
    }
  }, []);

  return {
    // State
    assets: Object.values(assets),
    uploadProgress,
    loading,
    errors,
    
    // Actions
    upload,
    link,
    unlink,
    getUrl,
    getAsset,
    deleteAsset,
    restore,
    getVariants,
    
    // Utility methods
    getAssetsByApp,
    getAssetsByEntity,
    getAssetUsageCount,
    isAssetLinked,
    
    // Store management
    clearErrors,
    reset
  };
};
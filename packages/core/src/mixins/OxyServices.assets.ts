import type { AccountStorageUsageResponse, AssetUrlResponse, AssetVariant } from '../models/interfaces';
import type { OxyServicesBase } from '../OxyServices.base';

export function OxyServicesAssetsMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Delete file
     */
    async deleteFile(fileId: string): Promise<any> {
      try {
        return await this.makeRequest('DELETE', `/assets/${encodeURIComponent(fileId)}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get file download URL (synchronous - uses stream endpoint for images to avoid ORB blocking)
     */
    getFileDownloadUrl(fileId: string, variant?: string, expiresIn?: number): string {
      const base = this.getBaseURL();
      const params = new URLSearchParams();
      if (variant) params.set('variant', variant);
      if (expiresIn) params.set('expiresIn', String(expiresIn));
      params.set('fallback', 'placeholderVisible');
      const token = this.getClient().getAccessToken();
      if (token) params.set('token', token);

      const qs = params.toString();
      return `${base}/assets/${encodeURIComponent(fileId)}/stream${qs ? `?${qs}` : ''}`;
    }

    /**
     * Get file download URL asynchronously (returns signed URL directly from CDN)
     */
    async getFileDownloadUrlAsync(fileId: string, variant?: string, expiresIn?: number): Promise<string> {
      try {
        const url = await this.fetchAssetDownloadUrl(
          fileId,
          variant,
          this.getAssetUrlCacheTTL(expiresIn),
          expiresIn
        );

        return url || this.getFileDownloadUrl(fileId, variant, expiresIn);
      } catch (error) {
        return this.getFileDownloadUrl(fileId, variant, expiresIn);
      }
    }

    /**
     * List user files
     */
    async listUserFiles(limit?: number, offset?: number): Promise<{ files: any[]; total: number; hasMore: boolean }> {
      try {
        const paramsObj: any = {};
        if (limit) paramsObj.limit = limit;
        if (offset) paramsObj.offset = offset;
        return await this.makeRequest('GET', '/assets', paramsObj, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get account storage usage (server-side usage aggregated from assets)
     */
    async getAccountStorageUsage(): Promise<AccountStorageUsageResponse> {
      try {
        return await this.makeRequest<AccountStorageUsageResponse>('GET', '/storage/usage', undefined, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get file content as text
     */
    async getFileContentAsText(fileId: string, variant?: string): Promise<string> {
      try {
        const downloadUrl = await this.fetchAssetDownloadUrl(
          fileId,
          variant,
          this.getAssetUrlCacheTTL()
        );

        if (!downloadUrl) {
          throw new Error('No download URL returned for asset');
        }

        return await this.fetchAssetContent(downloadUrl, 'text');
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get file content as blob
     */
    async getFileContentAsBlob(fileId: string, variant?: string): Promise<Blob> {
      try {
        const downloadUrl = await this.fetchAssetDownloadUrl(
          fileId,
          variant,
          this.getAssetUrlCacheTTL()
        );

        if (!downloadUrl) {
          throw new Error('No download URL returned for asset');
        }

        return await this.fetchAssetContent(downloadUrl, 'blob');
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get batch access to multiple files
     */
    async getBatchFileAccess(fileIds: string[], context?: string): Promise<Record<string, any>> {
      try {
        return await this.makeRequest('POST', '/assets/batch-access', { 
          fileIds, 
          context 
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get download URLs for multiple files efficiently
     */
    async getFileDownloadUrls(fileIds: string[], context?: string): Promise<Record<string, string>> {
      const response: any = await this.getBatchFileAccess(fileIds, context);
      const urls: Record<string, string> = {};
      const results = response.results || {};
      for (const [id, result] of Object.entries(results as Record<string, any>)) {
        if (result.allowed && result.url) {
          urls[id] = result.url;
        }
      }
      return urls;
    }

    /**
     * Upload raw file data
     */
    async uploadRawFile(file: File | Blob, visibility?: 'private' | 'public' | 'unlisted', metadata?: Record<string, any>): Promise<any> {
      return this.assetUpload(file as File, visibility, metadata);
    }

    /**
     * Upload file using Central Asset Service
     */
    async assetUpload(file: File, visibility?: 'private' | 'public' | 'unlisted', metadata?: Record<string, any>, onProgress?: (progress: number) => void): Promise<any> {
      const fileName = file.name || 'unknown';
      const fileSize = file.size;
      
      try {
        const formData = new FormData();
        // Convert File to Blob to avoid read-only 'name' property error in Expo 54
        // This is a known issue in Expo SDK 52+ where FormData tries to set the read-only 'name' property
        let fileBlob: Blob;
        if (file instanceof Blob) {
          // Already a Blob, use directly
          fileBlob = file;
        } else if (typeof (file as any).blob === 'function') {
          // Use async blob() method if available (Expo 54+ recommended approach)
          fileBlob = await (file as any).blob();
        } else {
          // Fallback: create Blob from File (works in all environments)
          fileBlob = new Blob([file], { type: (file as any).type || 'application/octet-stream' });
        }
        formData.append('file', fileBlob, fileName);
        if (visibility) {
          formData.append('visibility', visibility);
        }
        if (metadata) {
          formData.append('metadata', JSON.stringify(metadata));
        }

        const response = await this.getClient().request<{ file: any }>({
          method: 'POST',
          url: '/assets/upload',
          data: formData,
          cache: false,
        });

        if (onProgress && response) {
          onProgress(100);
        }

        return response;
      } catch (error) {
        console.error('File upload error:', error);
        
        let errorMessage = 'File upload failed';
        
        if (error instanceof Error) {
          errorMessage = error.message || errorMessage;
        } else if (error && typeof error === 'object') {
          if ('message' in error) {
            errorMessage = String((error as any).message) || errorMessage;
          } else if ('error' in error && typeof (error as any).error === 'string') {
            errorMessage = (error as any).error;
          } else if ('data' in error && (error as any).data?.message) {
            errorMessage = String((error as any).data.message);
          }
        } else if (error) {
          errorMessage = String(error) || errorMessage;
        }
        
        const contextError = error as Error & { fileContext?: Record<string, unknown> };
        if (!contextError.fileContext) {
          contextError.fileContext = {
            fileName,
            fileSize,
          };
        }
        
        if (error instanceof Error && error.message) {
          const handledError = this.handleError(contextError);
          if (!handledError.message || handledError.message.trim() === 'An unexpected error occurred') {
            handledError.message = errorMessage;
          }
          throw handledError;
        }
        
        const newError = new Error(errorMessage);
        (newError as any).fileContext = contextError.fileContext;
        throw this.handleError(newError);
      }
    }

    /**
     * Link asset to an entity
     */
    async assetLink(fileId: string, app: string, entityType: string, entityId: string, visibility?: 'private' | 'public' | 'unlisted', webhookUrl?: string): Promise<any> {
      try {
        const body: any = { app, entityType, entityId };
        if (visibility) body.visibility = visibility;
        if (webhookUrl) body.webhookUrl = webhookUrl;
        return await this.makeRequest('POST', `/assets/${fileId}/links`, body, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Unlink asset from an entity
     */
    async assetUnlink(fileId: string, app: string, entityType: string, entityId: string): Promise<any> {
      try {
        return await this.makeRequest('DELETE', `/assets/${fileId}/links`, {
          app,
          entityType,
          entityId
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get asset metadata
     */
    async assetGet(fileId: string): Promise<any> {
      try {
        return await this.makeRequest('GET', `/assets/${fileId}`, undefined, {
          cache: true,
          cacheTTL: 5 * 60 * 1000,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get asset URL (CDN or signed URL)
     */
    async assetGetUrl(fileId: string, variant?: string, expiresIn?: number): Promise<AssetUrlResponse> {
      try {
        const params: any = {};
        if (variant) params.variant = variant;
        if (expiresIn) params.expiresIn = expiresIn;
        
        return await this.makeRequest<AssetUrlResponse>('GET', `/assets/${fileId}/url`, params, {
          cache: true,
          cacheTTL: 10 * 60 * 1000,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Restore asset from trash
     */
    async assetRestore(fileId: string): Promise<any> {
      try {
        return await this.makeRequest('POST', `/assets/${fileId}/restore`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Delete asset with optional force
     */
    async assetDelete(fileId: string, force: boolean = false): Promise<any> {
      try {
        const params: any = force ? { force: 'true' } : undefined;
        return await this.makeRequest('DELETE', `/assets/${fileId}`, params, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get list of available variants for an asset
     */
    async assetGetVariants(fileId: string): Promise<AssetVariant[]> {
      try {
        const assetData = await this.assetGet(fileId);
        return assetData.file?.variants || [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Update asset visibility
     */
    async assetUpdateVisibility(fileId: string, visibility: 'private' | 'public' | 'unlisted'): Promise<any> {
      try {
        return await this.makeRequest('PATCH', `/assets/${fileId}/visibility`, {
          visibility
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async uploadAvatar(file: File, userId: string, app: string = 'profiles'): Promise<any> {
      try {
        const asset = await this.assetUpload(file, 'public');
        await this.assetLink(asset.file.id, app, 'avatar', userId, 'public');
        return asset;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async uploadProfileBanner(file: File, userId: string, app: string = 'profiles'): Promise<any> {
      try {
        const asset = await this.assetUpload(file, 'public');
        await this.assetLink(asset.file.id, app, 'profile-banner', userId, 'public');
        return asset;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    public getAssetUrlCacheTTL(expiresIn?: number) {
      const desiredTtlMs = (expiresIn ?? 3600) * 1000;
      return Math.min(desiredTtlMs, 10 * 60 * 1000);
    }

    public async fetchAssetDownloadUrl(
      fileId: string,
      variant?: string,
      cacheTTL?: number,
      expiresIn?: number
    ): Promise<string | null> {
      const params: any = {};
      if (variant) params.variant = variant;
      if (expiresIn) params.expiresIn = expiresIn;

      const urlRes = await this.makeRequest<{ url: string }>(
        'GET',
        `/assets/${encodeURIComponent(fileId)}/url`,
        Object.keys(params).length ? params : undefined,
        {
          cache: true,
          cacheTTL: cacheTTL ?? 10 * 60 * 1000,
        }
      );

      return urlRes?.url || null;
    }

    public async fetchAssetContent(url: string, type: 'text'): Promise<string>;
    public async fetchAssetContent(url: string, type: 'blob'): Promise<Blob>;
    public async fetchAssetContent(url: string, type: 'text' | 'blob') {
      const response = await fetch(url, { credentials: 'include' });
      if (!response?.ok) {
        throw new Error(`Failed to fetch asset content (status ${response?.status})`);
      }
      return type === 'text' ? response.text() : response.blob();
    }
  };
}

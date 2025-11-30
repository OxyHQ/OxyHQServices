/**
 * Asset & File Methods Mixin
 */
import type { AssetInitResponse, AssetUrlResponse, AssetVariant } from '../../models/interfaces';
import type { OxyServicesBase } from '../OxyServices.base';

export function OxyServicesAssetsMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
    // ============================================================================
    // FILE METHODS (Convenience wrappers using Asset Service)
    // ============================================================================

    /**
     * Delete file
     */
    async deleteFile(fileId: string): Promise<any> {
      try {
        // Central Asset Service delete with force=true behavior controlled by caller via assetDelete
        return await this.makeRequest('DELETE', `/api/assets/${encodeURIComponent(fileId)}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get file download URL (synchronous - uses stream endpoint for images to avoid ORB blocking)
     * The stream endpoint serves images directly with proper CORS headers, avoiding browser ORB blocking
     * For better performance with signed URLs, use getFileDownloadUrlAsync when possible
     */
    getFileDownloadUrl(fileId: string, variant?: string, expiresIn?: number): string {
      const base = this.getBaseURL();
      const params = new URLSearchParams();
      if (variant) params.set('variant', variant);
      if (expiresIn) params.set('expiresIn', String(expiresIn));
      params.set('fallback', 'placeholderVisible');
      const token = this.getClient().getAccessToken();
      if (token) params.set('token', token);

      // Use stream endpoint which serves images directly with proper CORS headers
      // This avoids ERR_BLOCKED_BY_ORB errors that occur with redirect-based endpoints
      const qs = params.toString();
      return `${base}/api/assets/${encodeURIComponent(fileId)}/stream${qs ? `?${qs}` : ''}`;
    }

    /**
     * Get file download URL asynchronously (returns signed URL directly from CDN)
     * This is more efficient than the synchronous version as it avoids redirects
     * Use this when you can handle async operations (e.g., in useEffect, useMemo with async)
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
        // Fallback to synchronous method on error
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
        return await this.makeRequest('GET', '/api/assets', paramsObj, {
          cache: false, // Don't cache file lists - always get fresh data
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
     * Returns URLs and access status for each file
     */
    async getBatchFileAccess(fileIds: string[], context?: string): Promise<Record<string, any>> {
      try {
        return await this.makeRequest('POST', '/api/assets/batch-access', { 
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
      // response.results is the map
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
      // Switch to Central Asset Service upload flow
      return this.assetUpload(file as File, visibility, metadata);
    }

    // ============================================================================
    // CENTRAL ASSET SERVICE METHODS
    // ============================================================================

    /**
     * Convert File or Blob to ArrayBuffer - platform agnostic
     * Works on both web (uses native arrayBuffer) and React Native (uses expo-file-system)
     */
    async fileToArrayBuffer(file: File | Blob): Promise<ArrayBuffer> {
      // Try native arrayBuffer (web)
      if (typeof file.arrayBuffer === 'function') {
        return await file.arrayBuffer();
      }
      
      // React Native/Expo path: use expo-file-system for cleaner solution
      const uri = (file as any).uri;
      if (uri && typeof uri === 'string') {
        try {
          // Try to use expo-file-system (Expo 54 recommended approach)
          const FileSystem = await import('expo-file-system').catch(() => null);
          if (FileSystem && FileSystem.default) {
            // Read file as Base64 using Expo's native file system API
            const FileSystemModule = FileSystem.default;
            const base64String = await FileSystemModule.readAsStringAsync(uri, {
              encoding: (FileSystemModule as any).EncodingType?.Base64 || 'base64',
            });
            
            // Convert Base64 to ArrayBuffer
            const binaryString = atob(base64String);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
          }
        } catch (expoError: any) {
          // If expo-file-system fails, fall back to fetch
          console.warn('expo-file-system not available, falling back to fetch:', expoError.message);
        }
        
        // Fallback: use fetch if expo-file-system is not available
        try {
          const response = await fetch(uri);
          if (!response.ok) {
            throw new Error(`Failed to fetch file from URI: ${response.statusText}`);
          }
          return await response.arrayBuffer();
        } catch (fetchError: any) {
          throw new Error(`Failed to read file from URI: ${fetchError.message || 'Unknown error'}`);
        }
      }
      
      // Final fallback: create blob URL and fetch (for web Blobs without URI)
      try {
        const blobUrl = URL.createObjectURL(file);
        try {
          const response = await fetch(blobUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch file from blob URL: ${response.statusText}`);
          }
          return await response.arrayBuffer();
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } catch (error: any) {
        throw new Error(`Failed to convert file to ArrayBuffer: ${error.message || 'Unknown error'}`);
      }
    }

    /**
     * Calculate SHA256 hash of file content - platform agnostic
     * Uses crypto.subtle for web, expo-crypto for React Native/Expo
     */
    async calculateSHA256(file: File | Blob): Promise<string> {
      const buffer = await this.fileToArrayBuffer(file);
      
      // Try native crypto.subtle first (web and modern environments)
      if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
        try {
          const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (error: any) {
          // Fall through to expo-crypto if crypto.subtle fails
          console.warn('crypto.subtle failed, trying expo-crypto:', error.message);
        }
      }
      
      // Try expo-crypto (Expo/React Native) - optional dependency
      try {
        // Dynamically import expo-crypto (optional peer dependency)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const CryptoModule = await import('expo-crypto' as any).catch(() => null);
        if (CryptoModule) {
          const Crypto = CryptoModule.default || CryptoModule;
          if (Crypto && typeof Crypto.digestStringAsync === 'function') {
            // Convert ArrayBuffer to base64 string for expo-crypto
            const bytes = new Uint8Array(buffer);
            const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
            const base64 = typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary).toString('base64');
            
            // expo-crypto's digestStringAsync with BASE64 encoding
            const algorithm = (Crypto as any).CryptoDigestAlgorithm?.SHA256 || 'SHA256';
            const encoding = (Crypto as any).CryptoEncoding?.BASE64 || 'base64';
            return await Crypto.digestStringAsync(algorithm, base64, { encoding });
          }
        }
      } catch (expoError: any) {
        // Continue to error if expo-crypto not available
        // This is expected if expo-crypto is not installed
      }
      
      throw new Error('No crypto implementation available. For React Native/Expo, install expo-crypto: npx expo install expo-crypto');
    }

    /**
     * Initialize asset upload - returns pre-signed URL and file ID
     */
    async assetInit(sha256: string, size: number, mime: string): Promise<AssetInitResponse> {
      try {
        return await this.makeRequest<AssetInitResponse>('POST', '/api/assets/init', {
          sha256,
          size,
          mime
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Complete asset upload - commit metadata and trigger variant generation
     */
    async assetComplete(fileId: string, originalName: string, size: number, mime: string, visibility?: 'private' | 'public' | 'unlisted', metadata?: Record<string, any>): Promise<any> {
      try {
        return await this.makeRequest('POST', '/api/assets/complete', {
          fileId,
          originalName,
          size,
          mime,
          visibility,
          metadata
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Upload file using Central Asset Service
     */
    async assetUpload(file: File, visibility?: 'private' | 'public' | 'unlisted', metadata?: Record<string, any>, onProgress?: (progress: number) => void): Promise<any> {
      try {
        // Calculate SHA256
        const sha256 = await this.calculateSHA256(file);
        
        // Initialize upload
        const initResponse = await this.assetInit(sha256, file.size, file.type);

        // Try presigned URL first
        try {
          await this.uploadToPresignedUrl(initResponse.uploadUrl, file, onProgress);
        } catch (e) {
          // Fallback: direct upload via API to avoid CORS issues
          const fd = new FormData();
          fd.append('file', file);
          // Use httpService directly for FormData uploads (bypasses caching for special handling)
          await this.getClient().request({
            method: 'POST',
            url: `/api/assets/${encodeURIComponent(initResponse.fileId)}/upload-direct`,
            data: fd,
            cache: false,
          });
        }

        // Complete upload
        return await this.assetComplete(
          initResponse.fileId,
          file.name,
          file.size,
          file.type,
          visibility,
          metadata
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Upload file to pre-signed URL
     */
    public async uploadToPresignedUrl(url: string, file: File, onProgress?: (progress: number) => void): Promise<void> {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && onProgress) {
            const progress = (event.loaded / event.total) * 100;
            onProgress(progress);
          }
        });
        
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });
        
        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed'));
        });
        
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });
    }

    /**
     * Link asset to an entity
     */
    async assetLink(fileId: string, app: string, entityType: string, entityId: string, visibility?: 'private' | 'public' | 'unlisted', webhookUrl?: string): Promise<any> {
      try {
        const body: any = { app, entityType, entityId };
        if (visibility) body.visibility = visibility;
        if (webhookUrl) body.webhookUrl = webhookUrl;
        return await this.makeRequest('POST', `/api/assets/${fileId}/links`, body, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Unlink asset from an entity
     */
    async assetUnlink(fileId: string, app: string, entityType: string, entityId: string): Promise<any> {
      try {
        return await this.makeRequest('DELETE', `/api/assets/${fileId}/links`, {
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
        return await this.makeRequest('GET', `/api/assets/${fileId}`, undefined, {
          cache: true,
          cacheTTL: 5 * 60 * 1000, // 5 minutes cache
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
        
        return await this.makeRequest<AssetUrlResponse>('GET', `/api/assets/${fileId}/url`, params, {
          cache: true,
          cacheTTL: 10 * 60 * 1000, // 10 minutes cache for URLs
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
        return await this.makeRequest('POST', `/api/assets/${fileId}/restore`, undefined, { cache: false });
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
        return await this.makeRequest('DELETE', `/api/assets/${fileId}`, params, { cache: false });
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
     * @param fileId - The file ID
     * @param visibility - New visibility level ('private', 'public', or 'unlisted')
     * @returns Updated asset information
     */
    async assetUpdateVisibility(fileId: string, visibility: 'private' | 'public' | 'unlisted'): Promise<any> {
      try {
        return await this.makeRequest('PATCH', `/api/assets/${fileId}/visibility`, {
          visibility
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Helper: Upload and link avatar with automatic public visibility
     * @param file - The avatar file
     * @param userId - User ID to link to
     * @param app - App name (defaults to 'profiles')
     * @returns The uploaded and linked asset
     */
    async uploadAvatar(file: File, userId: string, app: string = 'profiles'): Promise<any> {
      try {
        // Upload as public
        const asset = await this.assetUpload(file, 'public');
        
        // Link to user profile as avatar
        await this.assetLink(asset.file.id, app, 'avatar', userId, 'public');
        
        return asset;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Helper: Upload and link profile banner with automatic public visibility
     * @param file - The banner file
     * @param userId - User ID to link to
     * @param app - App name (defaults to 'profiles')
     * @returns The uploaded and linked asset
     */
    async uploadProfileBanner(file: File, userId: string, app: string = 'profiles'): Promise<any> {
      try {
        // Upload as public
        const asset = await this.assetUpload(file, 'public');
        
        // Link to user profile as banner
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
        `/api/assets/${encodeURIComponent(fileId)}/url`,
        Object.keys(params).length ? params : undefined,
        {
          cache: true,
          cacheTTL: cacheTTL ?? 10 * 60 * 1000, // default 10 minutes cache for URLs
        }
      );

      return urlRes?.url || null;
    }

    public async fetchAssetContent(url: string, type: 'text'): Promise<string>;
    public async fetchAssetContent(url: string, type: 'blob'): Promise<Blob>;
    public async fetchAssetContent(url: string, type: 'text' | 'blob') {
      const response = await fetch(url);
      if (!response?.ok) {
        throw new Error(`Failed to fetch asset content (status ${response?.status})`);
      }
      return type === 'text' ? response.text() : response.blob();
    }
  };
}

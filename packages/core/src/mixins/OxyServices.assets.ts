import type { AccountStorageUsageResponse, AssetUploadInput, AssetUrlResponse, AssetVariant, RNFileDescriptor, ServiceAssetMetadata, ServiceAssetMetadataBySha } from '../models/interfaces';
import type { OxyServicesBase } from '../OxyServices.base';
import { isReactNative } from '@oxyhq/protocol';
import { logger } from '../logger';
import { extractErrorStatus } from '../utils/errorUtils';

/**
 * Maximum number of ids sent per `POST /assets/service/by-ids` request. Matches
 * the server-side batch cap (the route rejects empty or > 100 id arrays with a
 * 400); larger inputs are split into multiple chunked calls and merged. Mirrors
 * `getUsersByIds`'s `USERS_BY_IDS_CHUNK_SIZE`.
 */
const SERVICE_ASSET_METADATA_CHUNK_SIZE = 100;

/**
 * Maximum number of content hashes sent per `POST /assets/service/by-sha256`
 * request. Matches the server-side cap (the route rejects empty or > 100 hash
 * arrays with a 400); larger inputs are chunked and merged. Same ceiling as
 * {@link SERVICE_ASSET_METADATA_CHUNK_SIZE} for the forward id lookup.
 */
const SERVICE_ASSET_METADATA_BY_SHA_CHUNK_SIZE = 100;

/**
 * Lowercase hex SHA-256 digest matcher (exactly 64 hex chars). The reverse
 * lookup drops non-conforming hashes client-side so a single malformed value
 * never 400s an otherwise-valid chunk on the server.
 */
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export function OxyServicesAssetsMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Service-token request, implemented by the auth mixin earlier in the
     * composition pipeline (see `mixins/index.ts`). The assets mixin is typed
     * against `OxyServicesBase`, which does not carry the auth mixin's methods,
     * so this `declare` surfaces the inherited runtime method to TypeScript
     * without re-implementing it. Used by
     * {@link getServiceAssetMetadataByIds} to authenticate the server-to-server
     * `/assets/service/by-ids` bulk fetch with a bearer service token.
     */
    declare makeServiceRequest: <R = unknown>(
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      url: string,
      data?: unknown,
      userId?: string,
    ) => Promise<R>;

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
     * Build a synchronous, `<img src>`-ready file URL from an Oxy asset id.
     *
     * This method must never embed the caller's general access token in the
     * returned URL. The URL is commonly rendered into DOM attributes, browser
     * network panels, caches, and logs. Public asset URLs use the clean CDN
     * origin; callers that need authorized/private access should use
     * {@link getFileDownloadUrlAsync}, which asks the API for a scoped download
     * URL instead of exposing the in-memory bearer token in a query string.
     */
    getFileDownloadUrl(fileId: string, variant?: string, expiresIn?: number): string {
      // Never embed the in-memory bearer token: this URL is rendered into DOM
      // attributes, browser network panels, caches, and logs. Public assets get
      // the clean CDN origin; private/authorized access goes through
      // `getFileDownloadUrlAsync`.
      if (!expiresIn) {
        const variantQs = variant ? `?variant=${encodeURIComponent(variant)}` : '';
        return `${this.getCloudURL()}/${encodeURIComponent(fileId)}${variantQs}`;
      }

      const base = this.getBaseURL();
      const params = new URLSearchParams();
      if (variant) params.set('variant', variant);
      params.set('expiresIn', String(expiresIn));
      params.set('fallback', 'placeholderVisible');

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
     * Resolve many Oxy asset ids to their content-addressed metadata in one
     * round-trip per chunk via `POST /assets/service/by-ids` (body `{ ids }`).
     *
     * Returns each asset's `sha256`, `mime`, byte `size`, and `status` — built
     * for server-to-server callers (e.g. Mention's MTN Protocol blob-ref
     * resolution) that need the content hash for an asset id. Ids are
     * deduplicated and validated (empty/blank ids dropped) before being split
     * into chunks of {@link SERVICE_ASSET_METADATA_CHUNK_SIZE} (the server-side
     * cap). The server omits unknown/deleted ids from each chunk's `data`, so
     * the merged result may be shorter than the requested id list and the caller
     * is expected to map by `id`.
     *
     * **Service-token auth (required).** `/assets/service/by-ids` is guarded by
     * `serviceAuthMiddleware` + the `files:read` scope and is called via
     * `makeServiceRequest`, which attaches `Authorization: Bearer <serviceToken>`
     * (the same client that calls `POST /assets/service/cache`). The calling
     * client MUST be service-configured (`configureServiceAuth(apiKey,
     * apiSecret)`) before invoking this method; otherwise `getServiceToken()`
     * throws because no credentials are available. A plain user-session request
     * is rejected by the route's service-auth guard.
     *
     * Resilience: chunks are independent. A failed chunk is logged and skipped —
     * the method returns every entry that resolved successfully rather than
     * discarding the whole call on one chunk's failure. An empty/whitespace-only
     * input resolves immediately with `[]` and performs no network call.
     *
     * Not cached at the SDK layer: it's a POST keyed on a multi-id body (low hit
     * rate), mirroring the sibling service/POST methods which never cache.
     */
    async getServiceAssetMetadataByIds(ids: string[]): Promise<ServiceAssetMetadata[]> {
      const uniqueIds = Array.from(
        new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
      );
      if (uniqueIds.length === 0) {
        return [];
      }

      const chunks: string[][] = [];
      for (let i = 0; i < uniqueIds.length; i += SERVICE_ASSET_METADATA_CHUNK_SIZE) {
        chunks.push(uniqueIds.slice(i, i + SERVICE_ASSET_METADATA_CHUNK_SIZE));
      }

      // Run chunks concurrently; a single chunk failure must not sink the rest.
      const settled = await Promise.all(
        chunks.map(async (chunk): Promise<ServiceAssetMetadata[]> => {
          try {
            const entries = await this.makeServiceRequest<ServiceAssetMetadata[]>(
              'POST',
              '/assets/service/by-ids',
              { ids: chunk },
            );
            return Array.isArray(entries) ? entries : [];
          } catch (error: unknown) {
            logger.warn('getServiceAssetMetadataByIds: chunk failed, continuing with remaining chunks', {
              method: 'getServiceAssetMetadataByIds',
              chunkSize: chunk.length,
              status: extractErrorStatus(error),
              error: error instanceof Error ? error.message : String(error),
            });
            return [];
          }
        }),
      );

      return settled.flat();
    }

    /**
     * Reverse content-address lookup: resolve many content `sha256` digests to
     * the servable Oxy asset holding each, in one round-trip per chunk via
     * `POST /assets/service/by-sha256` (body `{ sha256s }`).
     *
     * This is the INVERSE of {@link getServiceAssetMetadataByIds}: given a
     * record's `blob.sha256`, it returns the asset's `id`, `mime`, byte `size`,
     * `status`, and — for active, public, CDN-reachable assets only — a public
     * `url` (`cloud.oxy.so`). Built for server-to-server callers (e.g. Mention's
     * MTN materializer / node-blob sync) that hold a content hash and need to
     * map it back to a servable asset. Hashes are lowercased, validated against
     * a 64-char hex pattern (malformed entries dropped client-side), and
     * deduplicated before being split into chunks of
     * {@link SERVICE_ASSET_METADATA_BY_SHA_CHUNK_SIZE} (the server-side cap). The
     * server omits unknown/deleted hashes from each chunk's `data`, so the
     * merged result may be shorter than the requested list and the caller is
     * expected to map by `sha256`.
     *
     * **Service-token auth (required).** `/assets/service/by-sha256` is guarded
     * by `serviceAuthMiddleware` + the `files:read` scope and is called via
     * `makeServiceRequest` (`Authorization: Bearer <serviceToken>`, `cache:false`).
     * The calling client MUST be service-configured (`configureServiceAuth`)
     * before invoking; a plain user-session request is rejected by the route's
     * service-auth guard.
     *
     * Resilience: chunks are independent. A failed chunk is logged and skipped —
     * every entry that resolved is still returned. An empty input (or one whose
     * every value is malformed) resolves immediately with `[]` and performs no
     * network call.
     *
     * Not cached at the SDK layer: it's a POST keyed on a multi-hash body (low
     * hit rate), mirroring the sibling service/POST methods which never cache.
     */
    async getServiceAssetMetadataBySha256(sha256s: string[]): Promise<ServiceAssetMetadataBySha[]> {
      const uniqueShas = Array.from(
        new Set(
          sha256s
            .filter((sha): sha is string => typeof sha === 'string')
            .map((sha) => sha.trim().toLowerCase())
            .filter((sha) => SHA256_HEX_PATTERN.test(sha)),
        ),
      );
      if (uniqueShas.length === 0) {
        return [];
      }

      const chunks: string[][] = [];
      for (let i = 0; i < uniqueShas.length; i += SERVICE_ASSET_METADATA_BY_SHA_CHUNK_SIZE) {
        chunks.push(uniqueShas.slice(i, i + SERVICE_ASSET_METADATA_BY_SHA_CHUNK_SIZE));
      }

      // Run chunks concurrently; a single chunk failure must not sink the rest.
      const settled = await Promise.all(
        chunks.map(async (chunk): Promise<ServiceAssetMetadataBySha[]> => {
          try {
            const entries = await this.makeServiceRequest<ServiceAssetMetadataBySha[]>(
              'POST',
              '/assets/service/by-sha256',
              { sha256s: chunk },
            );
            return Array.isArray(entries) ? entries : [];
          } catch (error: unknown) {
            logger.warn('getServiceAssetMetadataBySha256: chunk failed, continuing with remaining chunks', {
              method: 'getServiceAssetMetadataBySha256',
              chunkSize: chunk.length,
              status: extractErrorStatus(error),
              error: error instanceof Error ? error.message : String(error),
            });
            return [];
          }
        }),
      );

      return settled.flat();
    }

    /**
     * Upload raw file data
     */
    async uploadRawFile(file: AssetUploadInput, visibility?: 'private' | 'public' | 'unlisted', metadata?: Record<string, any>): Promise<any> {
      return this.assetUpload(file, visibility, metadata);
    }

    /**
     * Upload file using Central Asset Service.
     *
     * Accepts either a web File/Blob or a React Native file descriptor
     * ({uri, type, name, size}). RN descriptors are passed directly to
     * FormData.append, which handles them natively.
     */
    async assetUpload(file: AssetUploadInput, visibility?: 'private' | 'public' | 'unlisted', metadata?: Record<string, any>, onProgress?: (progress: number) => void): Promise<any> {
      const fileName = 'name' in file && file.name ? file.name : 'unknown';
      const fileSize = 'size' in file && file.size ? file.size : 0;

      try {
        const formData = new FormData();

        if (typeof File !== 'undefined' && file instanceof File) {
          formData.append('file', file, fileName);
        } else if (typeof Blob !== 'undefined' && file instanceof Blob) {
          formData.append('file', file, fileName);
        } else if ('uri' in file && typeof (file as RNFileDescriptor).uri === 'string') {
          const descriptor = file as RNFileDescriptor;

          if (isReactNative()) {
            // React Native file descriptor — RN's FormData handles {uri, type, name} natively.
            // It reads the file from disk during the multipart request — no in-JS Blob
            // conversion (which would fail on Hermes for ArrayBuffer-backed Blobs).
            formData.append('file', descriptor as unknown as Blob, fileName);
          } else {
            // Web (browser/Node): the browser's FormData cannot read bytes from a plain
            // { uri } object — it would serialize "[object Object]" and the server would
            // store a 0-byte asset. Materialize the uri into a real Blob first. `fetch`
            // resolves blob:, data:, and http(s): uris on web, so all picker outputs work.
            const res = await fetch(descriptor.uri);
            if (!res.ok) {
              throw new Error(`Failed to read file from uri (status ${res.status})`);
            }
            const fetched = await res.blob();
            // Preserve the descriptor's declared MIME type when the fetched blob has none.
            const blob =
              fetched.type === '' && descriptor.type
                ? new Blob([fetched], { type: descriptor.type })
                : fetched;
            if (blob.size === 0) {
              throw new Error('Cannot upload an empty file');
            }
            formData.append('file', blob, fileName);
          }
        } else {
          throw new Error('Unsupported file input: expected File, Blob, or { uri, type?, name?, size? } descriptor');
        }
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
        logger.error('File upload error', error, { component: 'OxyServices.assets' });

        let errorMessage = 'File upload failed';
        
        if (error instanceof Error) {
          errorMessage = error.message || errorMessage;
        } else if (error && typeof error === 'object') {
          const errObj = error as Record<string, unknown>;
          if ('message' in errObj) {
            errorMessage = String(errObj.message) || errorMessage;
          } else if (typeof errObj.error === 'string') {
            errorMessage = errObj.error;
          } else if (errObj.data && typeof errObj.data === 'object') {
            const dataObj = errObj.data as Record<string, unknown>;
            if (dataObj.message) {
              errorMessage = String(dataObj.message);
            }
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
        
        const newError: Error & { fileContext?: Record<string, unknown> } = new Error(errorMessage);
        newError.fileContext = contextError.fileContext;
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
        const result = await this.makeRequest('POST', `/assets/${fileId}/restore`, undefined, { cache: false });
        // The asset metadata (trash state) changed — bust its cached read.
        this.clearCacheEntry(`GET:/assets/${fileId}`);
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Delete asset with optional force
     */
    async assetDelete(fileId: string, force = false): Promise<any> {
      try {
        const params: any = force ? { force: 'true' } : undefined;
        const result = await this.makeRequest('DELETE', `/assets/${fileId}`, params, { cache: false });
        // Bust the cached metadata and every cached URL variant for the asset.
        this.clearCacheEntry(`GET:/assets/${fileId}`);
        this.clearCacheByPrefix(`GET:/assets/${fileId}/url`);
        return result;
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
        const result = await this.makeRequest('PATCH', `/assets/${fileId}/visibility`, {
          visibility
        }, { cache: false });
        // Visibility changes both the asset metadata and the resolved URL
        // (public CDN vs signed). Bust the metadata read and every cached URL
        // variant (keyed on variant/expiresIn params).
        this.clearCacheEntry(`GET:/assets/${fileId}`);
        this.clearCacheByPrefix(`GET:/assets/${fileId}/url`);
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async uploadAvatar(file: AssetUploadInput, userId: string, app = 'profiles'): Promise<any> {
      try {
        const asset = await this.assetUpload(file, 'public');
        await this.assetLink(asset.file.id, app, 'avatar', userId, 'public');
        return asset;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    async uploadProfileBanner(file: AssetUploadInput, userId: string, app = 'profiles'): Promise<any> {
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
      const response = await fetch(url, {
        credentials: shouldSendAssetCredentials(url, this.getBaseURL()) ? 'include' : 'omit',
      });
      if (!response?.ok) {
        throw new Error(`Failed to fetch asset content (status ${response?.status})`);
      }
      return type === 'text' ? response.text() : response.blob();
    }
  };
}

/**
 * Only send ambient credentials (cookies) when the asset URL is same-origin with
 * the configured API base. Caller-supplied cross-origin asset URLs must not leak
 * the user's cookies to arbitrary hosts.
 */
function shouldSendAssetCredentials(url: string, baseURL: string): boolean {
  try {
    return new URL(url).origin === new URL(baseURL).origin;
  } catch {
    return false;
  }
}

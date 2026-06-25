import crypto from 'crypto';
import { lookup } from 'dns/promises';
import net from 'net';
import { Readable, Transform } from 'stream';
import mongoose from 'mongoose';
import { File, IFile, IFileLink, IFileVariant, FileVisibility } from '../models/File';
import { S3Service } from './s3Service';
import {
  FEDERATION_CACHE_OWNER_ID,
  FEDERATION_MEDIA_CACHE_PURPOSE,
  isAllowedCacheMime,
} from '../constants/federationCache';
import { VariantService } from './variantService';
import {
  buildCdnUrl,
  cdnUrlForStorageKey,
  applyPublicPrefix,
  stripPublicPrefix,
  isPublicKey,
  storageKeyForVisibility,
} from '../config/cdn';
import { logger } from '../utils/logger';
import path from 'path';
import {
  AssetInitResponse,
  AssetCompleteRequest,
  AssetLinkRequest,
  AssetDeleteSummary,
} from '../types/asset.types';

import { mediaPrivacyService } from './mediaPrivacyService';
import { MediaAccessContext } from '../types/mediaPrivacy.types';
import fileCache from '../utils/fileCache';

/**
 * A readable stream that may also emit the HTTP `'aborted'` event. Express
 * requests (`IncomingMessage`) are `Readable` AND emit `'aborted'` when the
 * client disconnects; `Readable`'s own typings do not declare that event, so
 * we widen the listener overloads here instead of casting.
 */
type AbortableReadable = Readable & {
  on(event: 'aborted', listener: () => void): AbortableReadable;
  removeListener(event: 'aborted', listener: () => void): AbortableReadable;
};

interface StreamedMediaOptions {
  ownerUserId: string;
  purpose: IFile['purpose'];
  visibility: FileVisibility;
  metadata: Record<string, any>;
  tempPrefix: string;
  logLabel: string;
}

const FEDERATION_AVATAR_OWNER_ID = '__federation__';
const FEDERATION_REPAIR_MAX_BYTES = 10 * 1024 * 1024;
const FEDERATION_REPAIR_MAX_REDIRECTS = 3;
const FEDERATION_REPAIR_USER_AGENT = 'OxyHQ/1.0 (Federation Asset Repair)';

export class AssetService {
  private variantService: VariantService;

  constructor(private s3Service: S3Service) {
    this.variantService = new VariantService(s3Service);
  }

  private isDuplicateKeyError(error: unknown): boolean {
    const err = error as { code?: number; message?: string } | null;
    return err?.code === 11000 || Boolean(err?.message?.includes('E11000'));
  }

  private async findFileBySha(sha256: string): Promise<IFile | null> {
    return File.findOne({ sha256 });
  }

  private async reviveDeletedDirectUploadFile(
    file: IFile,
    userId: string,
    size: number,
    mimeType: string,
    originalName: string,
    visibility?: FileVisibility,
    metadata?: Record<string, any>
  ): Promise<IFile> {
    file.status = 'active';
    file.ownerUserId = userId;
    file.purpose = 'user';
    file.size = size;
    file.mime = mimeType;
    file.ext = this.getExtensionFromMime(mimeType);
    file.originalName = originalName;
    file.visibility = visibility || 'private';
    file.metadata = metadata || {};
    file.links = [];
    file.variants = [];

    await file.save();
    fileCache.invalidate(file._id.toString());
    fileCache.set(file._id.toString(), file);
    return file;
  }

  private async reviveDeletedStreamedMediaFile(
    file: IFile,
    size: number,
    mimeType: string,
    originalName: string,
    options: StreamedMediaOptions
  ): Promise<IFile> {
    file.status = 'active';
    file.ownerUserId = options.ownerUserId;
    file.purpose = options.purpose;
    file.size = size;
    file.mime = mimeType;
    file.ext = this.getExtensionFromMime(mimeType);
    file.originalName = originalName;
    file.visibility = options.visibility;
    file.metadata = options.metadata;
    file.links = [];
    file.variants = [];

    await file.save();
    fileCache.invalidate(file._id.toString());
    fileCache.set(file._id.toString(), file);
    return file;
  }

  private isPrivateIpAddress(address: string): boolean {
    const ipVersion = net.isIP(address);
    if (ipVersion === 4) {
      const parts = address.split('.').map(Number);
      const [a, b] = parts;
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
      );
    }

    if (ipVersion === 6) {
      const normalized = address.toLowerCase();
      return (
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80:')
      );
    }

    return false;
  }

  private async validateFederationRepairUrl(url: URL): Promise<boolean> {
    if (url.protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      this.isPrivateIpAddress(hostname)
    ) {
      return false;
    }

    try {
      const addresses = await lookup(hostname, { all: true, verbatim: false });
      return addresses.length > 0 && addresses.every(({ address }) => !this.isPrivateIpAddress(address));
    } catch (error) {
      logger.warn('Failed to resolve federation repair URL host', {
        host: hostname,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private getFederationRepairRemoteUrl(file: IFile): string | null {
    const metadata = file.metadata || {};
    const remoteUrl = metadata.remoteUrl;
    if (typeof remoteUrl !== 'string' || remoteUrl.length === 0) {
      return null;
    }

    const ownerUserId = file.ownerUserId?.toString();
    const isFederationAvatar = ownerUserId === FEDERATION_AVATAR_OWNER_ID
      && metadata.source === 'federation'
      && metadata.role === 'avatar';
    const isFederationCache = ownerUserId === FEDERATION_CACHE_OWNER_ID
      && file.purpose === FEDERATION_MEDIA_CACHE_PURPOSE;
    const isFederationMedia = metadata.source === 'federation'
      && file.visibility === 'public';

    return isFederationAvatar || isFederationCache || isFederationMedia ? remoteUrl : null;
  }

  private async fetchFederationRepairImage(remoteUrl: string): Promise<{ buffer: Buffer; mime: string } | null> {
    let currentUrl: URL;
    try {
      currentUrl = new URL(remoteUrl);
    } catch {
      return null;
    }

    for (let redirects = 0; redirects <= FEDERATION_REPAIR_MAX_REDIRECTS; redirects += 1) {
      if (!(await this.validateFederationRepairUrl(currentUrl))) {
        logger.warn('Blocked unsafe federation repair URL', { url: currentUrl.toString() });
        return null;
      }

      const response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
          'User-Agent': FEDERATION_REPAIR_USER_AGENT,
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return null;
        }
        currentUrl = new URL(location, currentUrl);
        continue;
      }

      if (!response.ok) {
        logger.warn('Federation repair download failed', {
          url: currentUrl.toString(),
          status: response.status,
        });
        return null;
      }

      const rawContentType = response.headers.get('content-type') || '';
      const mime = rawContentType.split(';')[0].trim().toLowerCase();
      if (!mime.startsWith('image/') || !isAllowedCacheMime(mime)) {
        logger.warn('Federation repair rejected non-image content', {
          url: currentUrl.toString(),
          contentType: rawContentType,
        });
        return null;
      }

      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > FEDERATION_REPAIR_MAX_BYTES) {
        logger.warn('Federation repair image is too large', {
          url: currentUrl.toString(),
          declaredLength,
        });
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0 || buffer.length > FEDERATION_REPAIR_MAX_BYTES) {
        logger.warn('Federation repair image has invalid size', {
          url: currentUrl.toString(),
          size: buffer.length,
        });
        return null;
      }

      return { buffer, mime };
    }

    logger.warn('Federation repair exceeded redirect limit', { url: remoteUrl });
    return null;
  }

  private async restoreMissingDirectUploadContent(
    file: IFile,
    fileBuffer: Buffer,
    mimeType: string,
    logLabel: string,
  ): Promise<boolean> {
    if (await this.s3Service.fileExists(file.storageKey)) {
      return false;
    }

    logger.warn('Active file metadata points to a missing storage object; restoring from direct upload bytes', {
      fileId: file._id.toString(),
      sha256: file.sha256,
      storageKey: file.storageKey,
      logLabel,
    });

    await this.s3Service.uploadBuffer(file.storageKey, fileBuffer, {
      contentType: file.mime || mimeType,
    });

    if (file.size !== fileBuffer.length) {
      file.size = fileBuffer.length;
      await file.save();
    }

    fileCache.invalidate(file._id.toString());
    fileCache.set(file._id.toString(), file);
    return true;
  }

  private async restoreMissingStreamedMediaContent(
    file: IFile,
    sourceKey: string,
    logLabel: string,
  ): Promise<boolean> {
    if (await this.s3Service.fileExists(file.storageKey)) {
      return false;
    }

    logger.warn('Active file metadata points to a missing storage object; restoring from streamed upload bytes', {
      fileId: file._id.toString(),
      sha256: file.sha256,
      storageKey: file.storageKey,
      sourceKey,
      logLabel,
    });

    await this.s3Service.copyFile(sourceKey, file.storageKey);
    fileCache.invalidate(file._id.toString());
    fileCache.set(file._id.toString(), file);
    return true;
  }

  private async prepareExistingDirectUploadFile(
    file: IFile,
    userId: string,
    visibility?: FileVisibility,
    metadata?: Record<string, any>
  ): Promise<IFile> {
    const wasCacheFile = file.purpose === FEDERATION_MEDIA_CACHE_PURPOSE;
    if (!wasCacheFile) {
      return file;
    }

    file.ownerUserId = userId;
    file.purpose = 'user';
    if (visibility) {
      file.visibility = visibility;
    }
    file.metadata = {
      ...(file.metadata || {}),
      ...(metadata || {}),
      promotedFromFederationCache: true,
    };

    await file.save();
    fileCache.invalidate(file._id.toString());
    fileCache.set(file._id.toString(), file);
    return file;
  }

  private async prepareExistingStreamedMediaFile(file: IFile, options: StreamedMediaOptions): Promise<IFile> {
    if (options.purpose === FEDERATION_MEDIA_CACHE_PURPOSE) {
      return file;
    }

    let changed = false;
    const wasCacheFile = file.purpose === FEDERATION_MEDIA_CACHE_PURPOSE;
    if (wasCacheFile) {
      file.ownerUserId = options.ownerUserId;
      file.purpose = options.purpose;
      changed = true;
    }
    if (file.visibility !== options.visibility) {
      file.visibility = options.visibility;
      changed = true;
    }
    file.metadata = {
      ...(file.metadata || {}),
      ...options.metadata,
      ...(wasCacheFile ? { promotedFromFederationCache: true } : {}),
    };
    changed = true;

    if (!changed) {
      return file;
    }

    await file.save();
    fileCache.invalidate(file._id.toString());
    fileCache.set(file._id.toString(), file);
    return file;
  }

  async ensureVariant(fileId: string, variantType: string, file?: IFile): Promise<IFileVariant> {
    const fileObj = file || await this.getFile(fileId);
    if (!fileObj) {
      throw new Error('File not found');
    }

    const existing = fileObj.variants.find(v => v.type === variantType && v.readyAt);
    if (existing) {
      if (await this.s3Service.fileExists(existing.key)) {
        return existing;
      }

      logger.warn('Ready variant metadata points to a missing storage object; regenerating', {
        fileId: fileObj._id.toString(),
        variantType,
        key: existing.key,
      });
      fileObj.variants = fileObj.variants.filter(v => !(v.type === variantType && v.key === existing.key));
    }

    if (fileObj.mime.startsWith('image/')) {
      const variant = await this.variantService.ensureImageVariant(fileObj, variantType);
      return variant;
    }

    if (fileObj.mime.startsWith('video/') && variantType === 'poster') {
      const variant = await this.variantService.ensureVideoPoster(fileObj);
      return variant;
    }

    throw new Error(`Variant ${variantType} not supported for mime ${fileObj.mime}`);
  }

  /**
   * List files owned by a user (excluding deleted)
   */
  async listFilesByUser(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ files: IFile[]; total: number }> {
    try {
      const query = { ownerUserId: userId, status: { $ne: 'deleted' } } as const;
      const [files, total] = await Promise.all([
        File.find(query)
          .sort({ createdAt: -1 })
          .skip(offset)
          .limit(limit),
        File.countDocuments(query)
      ]);

      return { files, total };
    } catch (error) {
      logger.error('Error listing files by user:', error);
      throw error;
    }
  }

  /**
   * Initialize file upload - returns pre-signed URL and file ID
   */
  async initUpload(
    userId: string, 
    expectedSha256: string,
    expectedSize: number,
    expectedMime: string
  ): Promise<AssetInitResponse> {
    try {
      // Check if file already exists by SHA256
      const existingFile = await this.findFileBySha(expectedSha256);

      if (existingFile) {
        const storageKey = existingFile.storageKey || this.generateStorageKey(expectedSha256, expectedMime);
        let uploadUrl = '';
        if (existingFile.status === 'deleted') {
          existingFile.status = 'active';
          existingFile.ownerUserId = userId;
          existingFile.purpose = 'user';
          existingFile.size = expectedSize;
          existingFile.mime = expectedMime;
          existingFile.ext = this.getExtensionFromMime(expectedMime);
          existingFile.visibility = 'private';
          existingFile.links = [];
          existingFile.variants = [];
          await existingFile.save();
          fileCache.invalidate(existingFile._id.toString());
          fileCache.set(existingFile._id.toString(), existingFile);
        }
        const objectExists = await this.s3Service.fileExists(storageKey);
        const requesterOwnsExisting = existingFile.ownerUserId?.toString() === userId;
        if (!objectExists && requesterOwnsExisting) {
          logger.warn('Existing asset record has no storage object; returning upload URL for the existing key', {
            fileId: existingFile._id.toString(),
            sha256: expectedSha256,
            storageKey,
          });
          // Only the file owner may receive a repair PUT URL for an existing
          // record, and only when the object is missing. Signing a live
          // deduplicated object's key would let any authenticated user who
          // knows the SHA-256 overwrite another user's asset bytes.
          uploadUrl = await this.s3Service.getPresignedUploadUrl(storageKey, {
            contentType: expectedMime,
            expiresIn: 3600
          });
        } else if (!objectExists) {
          logger.warn('Existing asset record has no storage object; not returning repair URL to non-owner', {
            fileId: existingFile._id.toString(),
            sha256: expectedSha256,
            storageKey,
            requesterUserId: userId,
            ownerUserId: existingFile.ownerUserId,
          });
        }

        logger.info('File already exists, returning existing', {
          sha256: expectedSha256,
          fileId: existingFile._id
        });

        return {
          uploadUrl,
          fileId: existingFile._id.toString(),
          sha256: expectedSha256
        };
      }

      // Create new file record
      const ext = this.getExtensionFromMime(expectedMime);
      const storageKey = this.generateStorageKey(expectedSha256, expectedMime);
      
      const file = new File({
        sha256: expectedSha256,
        size: expectedSize,
        mime: expectedMime,
        ext,
        ownerUserId: userId,
        status: 'active',
        storageKey,
        links: [],
        variants: []
      });

      await file.save();

      // Generate pre-signed upload URL
      // Do not include metadata in the presigned URL signature; clients aren't required to send it
      const uploadUrl = await this.s3Service.getPresignedUploadUrl(storageKey, {
        contentType: expectedMime,
        expiresIn: 3600
      });

      logger.info('Asset upload initialized', { 
        fileId: file._id, 
        sha256: expectedSha256,
        storageKey 
      });

      return {
        uploadUrl,
        fileId: file._id.toString(),
        sha256: expectedSha256
      };
    } catch (error) {
      logger.error('Error initializing asset upload:', error);
      throw new Error('Failed to initialize asset upload');
    }
  }

  /**
   * Upload file directly - calculates SHA256 on backend
   */
  async uploadFileDirect(
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
    visibility?: FileVisibility,
    metadata?: Record<string, any>
  ): Promise<IFile> {
    try {
      // Calculate SHA256 hash on backend
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const size = fileBuffer.length;

      // Check if file already exists by SHA256
      const existingFile = await this.findFileBySha(sha256);

      if (existingFile) {
        const restored = await this.restoreMissingDirectUploadContent(
          existingFile,
          fileBuffer,
          mimeType,
          'direct upload',
        );
        const wasDeleted = existingFile.status === 'deleted';
        const preparedFile = wasDeleted
          ? await this.reviveDeletedDirectUploadFile(
            existingFile,
            userId,
            size,
            mimeType,
            originalName,
            visibility,
            metadata,
          )
          : await this.prepareExistingDirectUploadFile(
            existingFile,
            userId,
            visibility,
            metadata,
          );
        if (restored || wasDeleted) {
          this.queueVariantGeneration(preparedFile);
        }
        logger.info('File already exists, returning existing', { 
          sha256, 
          fileId: preparedFile._id
        });
        
        // File already exists, return existing file
        return preparedFile;
      }

      // Create new file record
      const ext = this.getExtensionFromMime(mimeType);
      const resolvedVisibility: FileVisibility = visibility || 'private';
      const storageKey = this.generateStorageKey(sha256, mimeType, resolvedVisibility);

      const file = new File({
        sha256,
        size,
        mime: mimeType,
        ext,
        ownerUserId: userId,
        status: 'active',
        storageKey,
        originalName,
        visibility: resolvedVisibility,
        metadata: metadata || {},
        links: [],
        variants: []
      });

      try {
        await file.save();
      } catch (error) {
        if (this.isDuplicateKeyError(error)) {
          const racedFile = await this.findFileBySha(sha256);
          if (racedFile) {
            const restored = await this.restoreMissingDirectUploadContent(
              racedFile,
              fileBuffer,
              mimeType,
              'direct upload duplicate race',
            );
            const wasDeleted = racedFile.status === 'deleted';
            const preparedFile = wasDeleted
              ? await this.reviveDeletedDirectUploadFile(
                racedFile,
                userId,
                size,
                mimeType,
                originalName,
                visibility,
                metadata,
              )
              : await this.prepareExistingDirectUploadFile(
                racedFile,
                userId,
                visibility,
                metadata,
              );
            if (restored || wasDeleted) {
              this.queueVariantGeneration(preparedFile);
            }
            logger.info('File already exists after concurrent upload, returning existing', {
              sha256,
              fileId: preparedFile._id,
            });
            return preparedFile;
          }
        }
        throw error;
      }

      // Upload to S3
      await this.s3Service.uploadBuffer(storageKey, fileBuffer, {
        contentType: mimeType
      });

      // Queue variant generation
      this.queueVariantGeneration(file);

      logger.info('File uploaded directly', { 
        fileId: file._id, 
        sha256,
        size,
        originalName
      });

      return file;
    } catch (error) {
      logger.error('Error uploading file directly:', error);
      throw error;
    }
  }

  /**
   * Stream a remote/federated media file into the reserved cache namespace.
   *
   * Unlike {@link uploadFileDirect}, the bytes are never buffered in memory:
   * the source stream is piped to S3 via the multipart `Upload` manager while
   * a parallel hash computes the SHA-256 for content addressing and dedup.
   *
   * Hardening: the asset is force-owned by {@link FEDERATION_CACHE_OWNER_ID}
   * and stamped with {@link FEDERATION_MEDIA_CACHE_PURPOSE}; callers cannot
   * override the owner or purpose. Visibility is `public` so the existing
   * public download/stream routes can serve cached media without auth.
   *
   * Abort handling: when the client disconnects or the request times out the
   * source emits `'aborted'`/`'close'` before completion. We abort the in-flight
   * S3 multipart upload and delete the partial temp object so a cancelled
   * upload never leaks orphaned parts.
   *
   * @throws if more than `maxBytes` are streamed (the partial S3 object is
   *         cleaned up before the error propagates).
   */
  async uploadCachedMediaStream(
    source: AbortableReadable,
    mimeType: string,
    originalName: string,
    maxBytes: number
  ): Promise<IFile> {
    return this.uploadStreamedMedia(source, mimeType, originalName, maxBytes, {
      ownerUserId: FEDERATION_CACHE_OWNER_ID,
      purpose: FEDERATION_MEDIA_CACHE_PURPOSE,
      visibility: 'public',
      metadata: {},
      tempPrefix: 'cache/incoming',
      logLabel: 'Cached media',
    });
  }

  /**
   * Stream a federated media file into normal, durable public asset storage owned
   * by the resolved federated Oxy user. This is intentionally NOT tagged as
   * federation-media-cache, so the cache eviction job can never delete post media
   * referenced by persisted Mention posts.
   */
  async uploadFederatedMediaStream(
    source: AbortableReadable,
    mimeType: string,
    originalName: string,
    maxBytes: number,
    ownerUserId: string,
    metadata?: Record<string, any>
  ): Promise<IFile> {
    return this.uploadStreamedMedia(source, mimeType, originalName, maxBytes, {
      ownerUserId,
      purpose: 'user',
      visibility: 'public',
      metadata: {
        source: 'federation',
        ...(metadata || {}),
      },
      tempPrefix: 'federation/incoming',
      logLabel: 'Federated media',
    });
  }

  private async uploadStreamedMedia(
    source: AbortableReadable,
    mimeType: string,
    originalName: string,
    maxBytes: number,
    options: StreamedMediaOptions
  ): Promise<IFile> {
    const hash = crypto.createHash('sha256');
    let size = 0;

    // Insert a hashing + byte-cap stage directly into the pipeline. Because it
    // is part of the pipe chain, S3 backpressure naturally throttles the
    // source, every byte is hashed exactly once in order, and exceeding the
    // cap destroys the chain so the upload aborts instead of buffering.
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) {
          const error = new Error('Cached media exceeds the maximum allowed size');
          error.name = 'CacheMediaTooLargeError';
          callback(error);
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    source.on('error', (err) => {
      meter.destroy(err instanceof Error ? err : new Error(String(err)));
    });
    const body = source.pipe(meter);

    // Stream first into a temporary key — the content-addressed key is only
    // known once the full SHA-256 is computed.
    const tempKey = `${options.tempPrefix}/${crypto.randomUUID()}`;

    // Wire client/timeout abort: cancel the S3 upload and drop the temp object
    // if the request is torn down before the upload finishes. `completed`
    // guards against the handlers firing cleanup after a successful upload.
    const abortController = new AbortController();
    let completed = false;
    const onSourceAbort = (): void => {
      // 'close' also fires on normal completion (after the body is fully read);
      // only treat it as a client/timeout abort if the stream did NOT end cleanly.
      if (!completed && !source.readableEnded) {
        abortController.abort();
      }
    };
    source.on('aborted', onSourceAbort);
    source.on('close', onSourceAbort);

    const deleteTempKey = async (reason: string): Promise<void> => {
      try {
        await this.s3Service.deleteFile(tempKey);
      } catch (cleanupError) {
        logger.warn(reason, {
          tempKey,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    };

    try {
      await this.s3Service.uploadStream(tempKey, body, {
        contentType: mimeType,
        abortSignal: abortController.signal,
      });
      completed = true;
    } catch (error) {
      // Best-effort cleanup of any partial multipart object (thrown error,
      // size-cap breach, or client/timeout abort all land here).
      await deleteTempKey('Failed to clean up partial cache upload');
      source.removeListener('aborted', onSourceAbort);
      source.removeListener('close', onSourceAbort);
      throw error;
    }

    source.removeListener('aborted', onSourceAbort);
    source.removeListener('close', onSourceAbort);

    const sha256 = hash.digest('hex');

    // Dedup: if this exact content already exists (cache or otherwise), reuse
    // it and drop the temp object.
    const existingFile = await this.findFileBySha(sha256);
    if (existingFile) {
      let restored = false;
      try {
        restored = await this.restoreMissingStreamedMediaContent(
          existingFile,
          tempKey,
          options.logLabel,
        );
      } finally {
        await deleteTempKey(`Failed to clean up deduplicated ${options.logLabel.toLowerCase()} upload`);
      }
      const wasDeleted = existingFile.status === 'deleted';
      const preparedFile = wasDeleted
        ? await this.reviveDeletedStreamedMediaFile(
          existingFile,
          size,
          mimeType,
          originalName,
          options,
        )
        : await this.prepareExistingStreamedMediaFile(existingFile, options);
      if (restored || wasDeleted) {
        this.queueVariantGeneration(preparedFile);
      }
      logger.info(`${options.logLabel} already exists, returning existing`, {
        sha256,
        fileId: preparedFile._id,
      });
      return preparedFile;
    }

    // Promote the temp object to its content-addressed key (server-side copy,
    // no RAM), then drop the temp object. Federation/cache media is always
    // `public`, so its content-addressed key lands under the CDN-reachable
    // `public/` prefix (decided centrally by `generateStorageKey`).
    const ext = this.getExtensionFromMime(mimeType);
    const storageKey = this.generateStorageKey(sha256, mimeType, options.visibility);
    await this.s3Service.copyFile(tempKey, storageKey);
    await deleteTempKey('Failed to delete temp key after cache promotion');

    // `visibility: 'public'` is an app-level ACL meaning "served without a user
    // session via the presigned-redirect stream route (GET /:id/stream)". It is
    // NOT an S3 ACL: the underlying object stays bucket-private and is only
    // reachable through short-lived presigned URLs, exactly like every other
    // public asset. We deliberately do not set `publicRead` on the upload —
    // making the raw S3 object public would let it be fetched/listed directly,
    // bypassing the stream route's access checks.
    const file = new File({
      sha256,
      size,
      mime: mimeType,
      ext,
      ownerUserId: options.ownerUserId,
      purpose: options.purpose,
      status: 'active',
      storageKey,
      originalName,
      visibility: options.visibility,
      metadata: options.metadata,
      links: [],
      variants: [],
    });

    try {
      await file.save();
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        const racedFile = await this.findFileBySha(sha256);
        if (racedFile) {
          let restored = false;
          try {
            restored = await this.restoreMissingStreamedMediaContent(
              racedFile,
              storageKey,
              `${options.logLabel} duplicate race`,
            );
          } finally {
            if (racedFile.storageKey !== storageKey) {
              try {
                await this.s3Service.deleteFile(storageKey);
              } catch (cleanupError) {
                logger.warn(`Failed to clean up duplicate ${options.logLabel.toLowerCase()} storage object`, {
                  storageKey,
                  error: cleanupError,
                });
              }
            }
          }
          const wasDeleted = racedFile.status === 'deleted';
          const preparedFile = wasDeleted
            ? await this.reviveDeletedStreamedMediaFile(
              racedFile,
              size,
              mimeType,
              originalName,
              options,
            )
            : await this.prepareExistingStreamedMediaFile(racedFile, options);
          if (restored || wasDeleted) {
            this.queueVariantGeneration(preparedFile);
          }
          logger.info(`${options.logLabel} already exists after concurrent upload, returning existing`, {
            sha256,
            fileId: preparedFile._id,
          });
          return preparedFile;
        }
      }
      throw error;
    }

    logger.info(`${options.logLabel} uploaded via stream`, {
      fileId: file._id,
      sha256,
      size,
      mime: mimeType,
    });

    return file;
  }

  /**
   * Delete a cached-media asset created via {@link uploadCachedMediaStream}.
   *
   * Hard scoping: the asset MUST belong to the reserved cache owner AND carry
   * the cache purpose, otherwise the call is rejected so a service token can
   * never delete user-owned media. The boolean return distinguishes
   * "not found" from "found but out of scope".
   */
  async deleteCachedMedia(fileId: string): Promise<{ deleted: boolean; outOfScope: boolean }> {
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      return { deleted: false, outOfScope: false };
    }

    const file = await File.findById(fileId);
    if (!file || file.status === 'deleted') {
      return { deleted: false, outOfScope: false };
    }

    const inCacheNamespace =
      file.purpose === FEDERATION_MEDIA_CACHE_PURPOSE &&
      file.ownerUserId === FEDERATION_CACHE_OWNER_ID;

    if (!inCacheNamespace) {
      logger.warn('Refusing to delete non-cache asset via cache endpoint', {
        fileId,
        purpose: file.purpose,
        ownerUserId: file.ownerUserId,
      });
      return { deleted: false, outOfScope: true };
    }

    await this.s3Service.deleteFile(file.storageKey);
    for (const variant of file.variants) {
      try {
        await this.s3Service.deleteFile(variant.key);
      } catch (error) {
        logger.warn('Failed to delete cache variant', { variant: variant.key, error });
      }
    }

    file.status = 'deleted';
    await file.save();
    fileCache.invalidate(fileId);

    logger.info('Cached media deleted', { fileId });

    return { deleted: true, outOfScope: false };
  }

  /**
   * Complete file upload - commit metadata and trigger variant generation
   */
  async completeUpload(request: AssetCompleteRequest): Promise<IFile> {
    try {
      const file = await File.findById(request.fileId);
      if (!file) {
        throw new Error('File not found');
      }

      // Verify file exists in storage
      const exists = await this.s3Service.fileExists(file.storageKey);
      if (!exists) {
        throw new Error('File not found in storage');
      }

      // Update file metadata
      file.originalName = request.originalName;
      file.size = request.size;
      file.mime = request.mime;
      file.metadata = request.metadata || {};
      
      // Set visibility if provided
      if (request.visibility) {
        file.visibility = request.visibility;
      }

      await file.save();
      fileCache.invalidate(file._id.toString());
      fileCache.set(file._id.toString(), file);

      // Align the object's S3 prefix with its (now-known) visibility so public
      // uploads are immediately CDN-reachable. `initUpload` generated a private
      // key before visibility was known, so a public asset's bytes start under
      // the non-public prefix; relocate them under `public/` here.
      await this.relocateAllForVisibility(file);

      // Variant generation reads `file.storageKey` (now relocated) and writes
      // variant keys under the prefix matching `file.visibility`.
      this.queueVariantGeneration(file);

      logger.info('Asset upload completed', {
        fileId: file._id,
        originalName: request.originalName,
        visibility: file.visibility
      });

      return file;
    } catch (error) {
      logger.error('Error completing asset upload:', error);
      throw error;
    }
  }

  /**
   * Link file to an entity
   */
  async linkFile(fileId: string, linkRequest: AssetLinkRequest): Promise<IFile> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      if (file.status === 'deleted') {
        throw new Error('Cannot link to deleted file');
      }

      // Check if link already exists
      const existingLink = file.links.find(link => 
        link.app === linkRequest.app &&
        link.entityType === linkRequest.entityType &&
        link.entityId === linkRequest.entityId
      );

      if (existingLink) {
        logger.warn('Link already exists', { fileId, linkRequest });
        return file;
      }

      // Add new link
      const newLink: IFileLink = {
        app: linkRequest.app,
        entityType: linkRequest.entityType,
        entityId: linkRequest.entityId,
        createdBy: linkRequest.createdBy,
        createdAt: new Date(),
        webhookUrl: linkRequest.webhookUrl
      };

      file.links.push(newLink);

      // Auto-set visibility based on entity type
      const previousVisibility = file.visibility;
      if (linkRequest.visibility) {
        file.visibility = linkRequest.visibility;
      } else {
        // Auto-detect public entities (avatar, profile content, etc.)
        file.visibility = this.inferVisibilityFromEntityType(
          linkRequest.app,
          linkRequest.entityType
        );
      }

      if (file.status === 'trash' && file.links.length > 0) {
        file.status = 'active';
      }

      await file.save();
      fileCache.invalidate(fileId);
      fileCache.set(fileId, file);

      // Linking an asset to a public entity (e.g. an avatar) flips its
      // visibility to `public`; relocate its bytes under the CDN-reachable
      // `public/` prefix so the new public asset serves from the CDN.
      if (file.visibility !== previousVisibility) {
        await this.relocateAllForVisibility(file);
      }

      logger.info('File linked successfully', {
        fileId,
        linkRequest,
        totalLinks: file.links.length
      });

      return file;
    } catch (error) {
      logger.error('Error linking file:', error);
      throw error;
    }
  }

  /**
   * Send webhook notifications to links that have webhookUrl set.
   * Non-blocking: failures are logged but do not throw.
   */
  private async notifyLinks(file: IFile, event: 'visibility_changed' | 'deleted', details: Record<string, any>): Promise<void> {
    try {
      const axios = (await import('axios')).default;
      const notifyPromises = file.links
        .filter(l => l.webhookUrl)
        .map(async (link) => {
          const url = link.webhookUrl!;
          const payload = {
            event,
            fileId: file._id.toString(),
            visibility: file.visibility,
            status: file.status,
            link: {
              app: link.app,
              entityType: link.entityType,
              entityId: link.entityId
            },
            details,
            timestamp: new Date().toISOString()
          };

          try {
            await axios.post(url, payload, { timeout: 5000 });
            logger.info('Webhook delivered', { url, fileId: file._id, event });
          } catch (err) {
            logger.warn('Failed to deliver webhook', { url, fileId: file._id, event, error: err instanceof Error ? err.message : String(err) });
          }
        });

      await Promise.allSettled(notifyPromises);
    } catch (err) {
      logger.error('Error in notifyLinks helper:', err);
    }
  }

  /**
   * Unlink file from an entity
   */
  async unlinkFile(
    fileId: string, 
    app: string, 
    entityType: string, 
    entityId: string
  ): Promise<IFile> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      // Remove the specified link
      file.links = file.links.filter(link => !(
        link.app === app &&
        link.entityType === entityType &&
        link.entityId === entityId
      ));

      // If no links remain, move to trash
      if (file.links.length === 0 && file.status === 'active') {
        file.status = 'trash';
      }

      await file.save();
      fileCache.invalidate(fileId);
      fileCache.set(fileId, file);

      logger.info('File unlinked successfully', { 
        fileId, 
        app, 
        entityType, 
        entityId, 
        remainingLinks: file.links.length 
      });

      return file;
    } catch (error) {
      logger.error('Error unlinking file:', error);
      throw error;
    }
  }

  /**
   * Get multiple files by ID
   */
  async getFilesByIds(fileIds: string[]): Promise<IFile[]> {
    return File.find({ _id: { $in: fileIds } });
  }

  /**
   * Get file by ID with full metadata
   */
  async getFile(fileId: string): Promise<IFile | null> {
    try {
      if (fileId.startsWith('temp-')) {
        return null;
      }
      
      if (!mongoose.Types.ObjectId.isValid(fileId)) {
        return null;
      }

      const cached = fileCache.get(fileId);
      if (cached) {
        return cached;
      }

      const file = await File.findById(fileId).lean() as IFile | null;
      if (file) {
        fileCache.set(fileId, file);
        return file;
      }
      return null;
    } catch (error) {
      logger.error('Error getting file', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Fetch the raw bytes of a file from the storage backend.
   * Returns null if the file does not exist or is not in active state.
   * Used by the outbound email transporter to attach blobs to RFC822 messages.
   */
  async getFileBuffer(fileId: string): Promise<Buffer | null> {
    const file = await this.getFile(fileId);
    if (!file || file.status === 'deleted') return null;
    return this.s3Service.downloadBuffer(file.storageKey);
  }

  async fileContentExists(fileId: string, file?: IFile): Promise<boolean> {
    const fileObj = file || await this.getFile(fileId);
    if (!fileObj || fileObj.status === 'deleted') return false;
    return this.s3Service.fileExists(fileObj.storageKey);
  }

  async repairMissingFederationFileContent(file: IFile): Promise<boolean> {
    if (!file || file.status === 'deleted') {
      return false;
    }
    if (await this.s3Service.fileExists(file.storageKey)) {
      return true;
    }

    const remoteUrl = this.getFederationRepairRemoteUrl(file);
    if (!remoteUrl) {
      return false;
    }

    try {
      const repaired = await this.fetchFederationRepairImage(remoteUrl);
      if (!repaired) {
        return false;
      }

      await this.s3Service.uploadBuffer(file.storageKey, repaired.buffer, {
        contentType: repaired.mime,
      });

      const setFields: Partial<IFile> = {
        size: repaired.buffer.length,
        mime: repaired.mime,
        ext: this.getExtensionFromMime(repaired.mime),
      };
      await File.updateOne({ _id: file._id }, { $set: setFields });

      file.size = setFields.size as number;
      file.mime = setFields.mime as string;
      file.ext = setFields.ext as string;
      fileCache.invalidate(file._id.toString());
      fileCache.set(file._id.toString(), file);
      this.queueVariantGeneration(file);

      logger.info('Repaired missing federation asset storage from remote URL', {
        fileId: file._id.toString(),
        storageKey: file.storageKey,
        mime: repaired.mime,
        size: repaired.buffer.length,
      });
      return true;
    } catch (error) {
      logger.warn('Failed to repair missing federation asset storage', {
        fileId: file._id.toString(),
        storageKey: file.storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Compute the visibility-aligned target for an S3 key: under the `public/`
   * prefix for public visibility, without it otherwise.
   */
  private targetKeyForVisibility(key: string, visibility: FileVisibility): string {
    return visibility === 'public' ? applyPublicPrefix(key) : stripPublicPrefix(key);
  }

  /**
   * Delete a legacy backfilled CDN copy for a non-public object key. Older
   * public files may have DB keys outside `public/` while a backfill-created
   * `public/<key>` copy exists for CDN serving; visibility downgrades and
   * deletes must remove that deterministic public copy even when the stored key
   * itself does not need relocation. Best-effort: a failure is logged, not
   * thrown.
   */
  private async deleteBackfilledPublicCopy(key: string): Promise<void> {
    if (isPublicKey(key)) {
      return;
    }

    const publicKey = applyPublicPrefix(key);
    if (!(await this.s3Service.fileExists(publicKey))) {
      return;
    }

    try {
      await this.s3Service.deleteFile(publicKey);
    } catch (cleanupError) {
      logger.warn('Failed to delete legacy public CDN copy after visibility downgrade', {
        sourceKey: key,
        publicKey,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
  }

  /**
   * Relocate a single S3 object so its key prefix matches `visibility`. Returns
   * the (possibly unchanged) key. Idempotent and best-effort: a missing source
   * object is logged and the original key is returned unchanged.
   */
  private async relocateObjectForVisibility(key: string, visibility: FileVisibility): Promise<string> {
    const targetKey = this.targetKeyForVisibility(key, visibility);
    if (visibility !== 'public') {
      await this.deleteBackfilledPublicCopy(key);
    }

    if (targetKey === key) {
      return key;
    }

    if (!(await this.s3Service.fileExists(key))) {
      logger.warn('Cannot relocate object for visibility change; source missing', {
        sourceKey: key,
        targetKey,
        visibility,
      });
      return key;
    }

    await this.s3Service.copyFile(key, targetKey);
    try {
      await this.s3Service.deleteFile(key);
    } catch (cleanupError) {
      logger.warn('Failed to delete source object after visibility relocation', {
        sourceKey: key,
        targetKey,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
    return targetKey;
  }

  /**
   * Relocate the original object and every variant so all keys match the file's
   * current visibility, persisting the rewritten keys. Used when visibility
   * actually flips (`public` ↔ `private`/`unlisted`) so existing CDN-served
   * objects stop being reachable when made private, and become reachable when
   * made public.
   */
  private async relocateAllForVisibility(file: IFile): Promise<void> {
    const newOriginalKey = await this.relocateObjectForVisibility(file.storageKey, file.visibility);
    let changed = newOriginalKey !== file.storageKey;
    file.storageKey = newOriginalKey;

    for (const variant of file.variants) {
      const newVariantKey = await this.relocateObjectForVisibility(variant.key, file.visibility);
      if (newVariantKey !== variant.key) {
        variant.key = newVariantKey;
        changed = true;
      }
    }

    if (changed) {
      await file.save();
      fileCache.invalidate(file._id.toString());
      fileCache.set(file._id.toString(), file);
      logger.info('Relocated asset objects to match visibility', {
        fileId: file._id.toString(),
        visibility: file.visibility,
        storageKey: file.storageKey,
        variantCount: file.variants.length,
      });
    }
  }

  /**
   * Resolve the public CDN URL for a file (or one of its variants), or `null`
   * when the asset is NOT servable via the public CDN.
   *
   * Returns a `cloud.oxy.so` URL only when BOTH hold:
   *   1. the file's visibility is `public`, AND
   *   2. the servable object physically lives under the CDN-reachable `public/`
   *      prefix in S3.
   *
   * Private/unlisted assets always return `null` so they can never leak through
   * the public CDN. A public asset whose bytes are not yet under `public/`
   * (legacy objects awaiting the S3 backfill) also returns `null`, so the caller
   * falls back to streaming through our own origin — never to a raw S3 URL.
   *
   * No client URL produced here is ever an `amazonaws.com` URL.
   */
  async getPublicCdnUrl(file: IFile, variant?: string): Promise<string | null> {
    if (file.visibility !== 'public') {
      return null;
    }

    let storageKey = file.storageKey;
    if (variant) {
      const ensured = await this.ensureVariant(file._id.toString(), variant, file);
      storageKey = ensured.key;
    }

    // The variant/original key already encodes visibility (public objects are
    // written under `public/`). When it is, verify the object is present and
    // serve it via the CDN.
    if (isPublicKey(storageKey)) {
      if (await this.s3Service.fileExists(storageKey)) {
        return cdnUrlForStorageKey(storageKey);
      }
      return null;
    }

    // Legacy public object stored at a non-public key. It becomes CDN-reachable
    // only once copied under the `public/` prefix (one-shot S3 backfill). Probe
    // for the backfilled object; serve via CDN if present, otherwise signal the
    // caller to stream through our origin.
    const publicKey = applyPublicPrefix(storageKey);
    if (await this.s3Service.fileExists(publicKey)) {
      return buildCdnUrl(stripPublicPrefix(publicKey));
    }

    return null;
  }

  /**
   * Resolve the client-facing URL for an asset (or one of its variants).
   *
   * Returns a public CDN (`cloud.oxy.so`) URL when the asset is public AND its
   * bytes are CDN-reachable. Returns `null` when the asset must instead be
   * served through our own origin — private/unlisted assets, or a public object
   * not yet copied under the `public/` prefix. Callers MUST treat `null` as
   * "stream through `/assets/:id/stream`" and never as an error condition.
   *
   * This method NEVER returns a raw S3 (`amazonaws.com`) URL — public goes to
   * the CDN, everything else goes through our origin.
   */
  async getFileUrl(
    fileId: string,
    variant?: string,
    _expiresIn: number = 3600,
    file?: IFile
  ): Promise<string | null> {
    const fileObj = file || await this.getFile(fileId);
    if (!fileObj) {
      return null;
    }

    return this.getPublicCdnUrl(fileObj, variant);
  }

  /**
   * Get deletion impact summary
   */
  async getDeletionSummary(fileId: string): Promise<AssetDeleteSummary> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      const affectedApps = [...new Set(file.links.map(link => link.app))];
      const wouldDelete = file.links.length === 0;
      const variants = file.variants.map(v => v.type);

      return {
        fileId,
        wouldDelete,
        affectedApps,
        remainingLinks: file.links.length,
        variants
      };
    } catch (error) {
      logger.error('Error getting deletion summary:', error);
      throw error;
    }
  }

  /**
   * Delete file permanently
   */
  async deleteFile(fileId: string, force: boolean = false, requestingUserId?: string): Promise<void> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      // Authorization Check
      if (requestingUserId && file.ownerUserId.toString() !== requestingUserId) {
        throw new Error('Unauthorized: You do not own this file');
      }

      if (!force && file.links.length > 0) {
        // Verify if links are actually active (optional enhancement)
        // For now, strict check
        throw new Error('Cannot delete file with active links. Use force=true to override.');
      }

      // Delete from storage, including any legacy CDN copy produced by the
      // public-asset backfill while the DB key stayed non-public.
      await this.s3Service.deleteFile(file.storageKey);
      await this.deleteBackfilledPublicCopy(file.storageKey);

      // Delete variants from storage
      for (const variant of file.variants) {
        try {
          await this.s3Service.deleteFile(variant.key);
          await this.deleteBackfilledPublicCopy(variant.key);
        } catch (error) {
          logger.warn('Failed to delete variant', { variant: variant.key, error });
        }
      }

      file.status = 'deleted';
      await file.save();
      fileCache.invalidate(fileId);

      // Notify linked apps that file was deleted
      await this.notifyLinks(file, 'deleted', { force });

      logger.info('File deleted permanently', { 
        fileId, 
        force, 
        linksRemoved: file.links.length 
      });
    } catch (error) {
      logger.error('Error deleting file:', error);
      throw error;
    }
  }

  /**
   * Restore file from trash
   */
  async restoreFile(fileId: string): Promise<IFile> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      if (file.status !== 'trash') {
        throw new Error('File is not in trash');
      }

      file.status = 'active';
      await file.save();
      fileCache.invalidate(fileId);
      fileCache.set(fileId, file);

      logger.info('File restored from trash', { fileId });

      return file;
    } catch (error) {
      logger.error('Error restoring file:', error);
      throw error;
    }
  }

  /**
   * Calculate SHA256 hash for content addressing
   */
  static calculateSHA256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Infer file visibility based on entity type
   * Automatically marks certain entity types as public (e.g., avatars, profile content)
   */
  private inferVisibilityFromEntityType(app: string, entityType: string): FileVisibility {
    // Public entity types that should be accessible without authentication
    const publicEntityTypes = [
      'avatar',
      'profile-avatar',
      'user-avatar',
      'profile-banner',
      'profile-cover',
      'public-profile-content'
    ];
    
    if (publicEntityTypes.includes(entityType.toLowerCase())) {
      return 'public';
    }
    
    // Default to private for all other types
    return 'private';
  }

  /**
   * Update file visibility
   */
  async updateFileVisibility(fileId: string, visibility: FileVisibility): Promise<IFile> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      // Only update if visibility is actually changing
      if (file.visibility === visibility) {
        return file;
      }

      file.visibility = visibility;
      await file.save();
      fileCache.invalidate(fileId);
      fileCache.set(fileId, file);

      // Relocate the object + variants so their S3 prefix matches the new
      // visibility: a now-private asset's bytes leave the CDN-reachable
      // `public/` prefix; a now-public asset's bytes move under it.
      await this.relocateAllForVisibility(file);

      // Notify linked apps about visibility change
      try {
        await this.notifyLinks(file, 'visibility_changed', { visibility });
      } catch (err) {
        logger.error('Failed to notify links after visibility change', err);
      }

      return file;
    } catch (error) {
      logger.error('Error updating file visibility:', error);
      throw error;
    }
  }

  /**
   * Check if a user can access a file
   */
  async canUserAccessFile(file: IFile, userId?: string, context?: MediaAccessContext): Promise<boolean> {
    // Use the centralized MediaPrivacyService for comprehensive checks
    const result = await mediaPrivacyService.checkMediaAccess(file, userId, context);
    return result.allowed;
  }

  /**
   * Generate storage key using SHA256 for content addressing.
   *
   * Public assets are placed under the CDN-reachable `public/` prefix so they
   * can be served via CloudFront (`cloud.oxy.so`); private/unlisted assets stay
   * private to S3 and are only reachable through the access-gated origin stream
   * route. The public-vs-private placement decision lives in one place
   * (`storageKeyForVisibility` in `config/cdn.ts`).
   *
   * `visibility` defaults to `private` for the two-phase upload flow
   * (`initUpload`), where the storage key (and its presigned PUT URL) must be
   * generated before the client declares visibility at `completeUpload`.
   */
  private generateStorageKey(sha256: string, mime: string, visibility: FileVisibility = 'private'): string {
    const ext = this.getExtensionFromMime(mime);
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');

    // Content-addressed path: content/{year}/{month}/{first2chars}/{sha256}.{ext}
    const prefix = sha256.substring(0, 2);
    const baseKey = `content/${year}/${month}/${prefix}/${sha256}${ext}`;
    return storageKeyForVisibility(baseKey, visibility);
  }

  /**
   * Get file extension from MIME type
   */
  private getExtensionFromMime(mime: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/mpeg': '.mpeg',
      'video/quicktime': '.mov',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/json': '.json',
      'application/zip': '.zip'
    };

    return mimeToExt[mime] || '';
  }

  /**
   * Queue variant generation
   */
  private async queueVariantGeneration(file: IFile): Promise<void> {
    try {
      logger.info('Starting variant generation', { 
        fileId: file._id, 
        mime: file.mime 
      });

      // For now, generate variants synchronously
      // In production, this would be queued to a background worker
      await this.variantService.generateVariants(file._id.toString());
      
      logger.info('Variant generation completed', { 
        fileId: file._id 
      });
    } catch (error) {
      logger.error('Error in variant generation:', error);
      // Don't throw error here to avoid failing the upload
    }
  }
}

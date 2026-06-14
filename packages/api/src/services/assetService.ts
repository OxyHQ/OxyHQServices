import crypto from 'crypto';
import { Readable, Transform } from 'stream';
import mongoose from 'mongoose';
import { File, IFile, IFileLink, IFileVariant, FileVisibility } from '../models/File';
import { S3Service } from './s3Service';
import {
  FEDERATION_CACHE_OWNER_ID,
  FEDERATION_MEDIA_CACHE_PURPOSE,
} from '../constants/federationCache';
import { VariantService } from './variantService';
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

export class AssetService {
  private variantService: VariantService;

  constructor(private s3Service: S3Service) {
    this.variantService = new VariantService(s3Service);
  }

  async ensureVariant(fileId: string, variantType: string, file?: IFile): Promise<IFileVariant> {
    const fileObj = file || await this.getFile(fileId);
    if (!fileObj) {
      throw new Error('File not found');
    }

    const existing = fileObj.variants.find(v => v.type === variantType && v.readyAt);
    if (existing) {
      return existing;
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
      const existingFile = await File.findOne({ 
        sha256: expectedSha256, 
        status: { $ne: 'deleted' } 
      });

      if (existingFile) {
        logger.info('File already exists, returning existing', { 
          sha256: expectedSha256, 
          fileId: existingFile._id 
        });
        
        // File already exists, return existing info
        // We still need to provide an upload URL in case the client wants to verify
        const storageKey = this.generateStorageKey(expectedSha256, expectedMime);
        // Do not include metadata in the presigned URL signature; clients aren't required to send it
        const uploadUrl = await this.s3Service.getPresignedUploadUrl(storageKey, {
          contentType: expectedMime,
          expiresIn: 3600
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
      const existingFile = await File.findOne({ 
        sha256, 
        status: { $ne: 'deleted' } 
      });

      if (existingFile) {
        logger.info('File already exists, returning existing', { 
          sha256, 
          fileId: existingFile._id 
        });
        
        // File already exists, return existing file
        return existingFile;
      }

      // Create new file record
      const ext = this.getExtensionFromMime(mimeType);
      const storageKey = this.generateStorageKey(sha256, mimeType);
      
      const file = new File({
        sha256,
        size,
        mime: mimeType,
        ext,
        ownerUserId: userId,
        status: 'active',
        storageKey,
        originalName,
        visibility: visibility || 'private',
        metadata: metadata || {},
        links: [],
        variants: []
      });

      await file.save();

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
    const tempKey = `cache/incoming/${crypto.randomUUID()}`;

    // Wire client/timeout abort: cancel the S3 upload and drop the temp object
    // if the request is torn down before the upload finishes. `completed`
    // guards against the handlers firing cleanup after a successful upload.
    const abortController = new AbortController();
    let completed = false;
    const onSourceAbort = (): void => {
      if (!completed) {
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
    const existingFile = await File.findOne({ sha256, status: { $ne: 'deleted' } });
    if (existingFile) {
      await deleteTempKey('Failed to clean up deduplicated cache upload');
      logger.info('Cached media already exists, returning existing', {
        sha256,
        fileId: existingFile._id,
      });
      return existingFile;
    }

    // Promote the temp object to its content-addressed key (server-side copy,
    // no RAM), then drop the temp object.
    const ext = this.getExtensionFromMime(mimeType);
    const storageKey = this.generateStorageKey(sha256, mimeType);
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
      ownerUserId: FEDERATION_CACHE_OWNER_ID,
      purpose: FEDERATION_MEDIA_CACHE_PURPOSE,
      status: 'active',
      storageKey,
      originalName,
      visibility: 'public',
      metadata: {},
      links: [],
      variants: [],
    });

    await file.save();

    logger.info('Cached media uploaded via stream', {
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

  async getFileUrl(
    fileId: string,
    variant?: string,
    expiresIn: number = 3600,
    file?: IFile
  ): Promise<string> {
    try {
      const fileObj = file || await this.getFile(fileId);
      if (!fileObj) {
        throw new Error('File not found');
      }

      let storageKey = fileObj.storageKey;

      if (variant) {
        const ensured = await this.ensureVariant(fileObj._id.toString(), variant, fileObj);
        storageKey = ensured.key;
      }

      const url = await this.s3Service.getPresignedDownloadUrl(storageKey, expiresIn);
      return url;
    } catch (error) {
      logger.error('Error getting file URL:', error);
      throw error;
    }
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

      // Delete from storage
      await this.s3Service.deleteFile(file.storageKey);

      // Delete variants from storage
      for (const variant of file.variants) {
        try {
          await this.s3Service.deleteFile(variant.key);
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
   * Generate storage key using SHA256 for content addressing
   */
  private generateStorageKey(sha256: string, mime: string): string {
    const ext = this.getExtensionFromMime(mime);
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Content-addressed path: content/{year}/{month}/{first2chars}/{sha256}.{ext}
    const prefix = sha256.substring(0, 2);
    return `content/${year}/${month}/${prefix}/${sha256}${ext}`;
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
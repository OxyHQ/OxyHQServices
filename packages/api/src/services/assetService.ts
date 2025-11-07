import crypto from 'crypto';
import mongoose from 'mongoose';
import { File, IFile, IFileLink, IFileVariant, FileVisibility } from '../models/File';
import { S3Service } from './s3Service';
import { VariantService } from './variantService';
import { logger } from '../utils/logger';
import path from 'path';

export interface AssetInitResponse {
  uploadUrl: string;
  fileId: string;
  sha256: string;
}

export interface AssetCompleteRequest {
  fileId: string;
  originalName: string;
  size: number;
  mime: string;
  visibility?: FileVisibility;
  metadata?: Record<string, any>;
}

export interface AssetLinkRequest {
  app: string;
  entityType: string;
  entityId: string;
  createdBy: string;
  visibility?: FileVisibility;
}

export interface AssetDeleteSummary {
  fileId: string;
  wouldDelete: boolean;
  affectedApps: string[];
  remainingLinks: number;
  variants: string[];
}

export class AssetService {
  private variantService: VariantService;

  constructor(private s3Service: S3Service) {
    this.variantService = new VariantService(s3Service);
  }

  /**
   * Ensure a specific variant exists for a file; generate it if missing.
   */
  async ensureVariant(fileId: string, variantType: string): Promise<IFileVariant> {
    const file = await File.findById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    // If already recorded and object exists, return it
    const existing = file.variants.find(v => v.type === variantType && v.readyAt);
    if (existing) {
      const exists = await this.s3Service.fileExists(existing.key);
      if (exists) return existing;
    }

    if (file.mime.startsWith('image/')) {
      const variant = await this.variantService.ensureImageVariant(file, variantType);
      return variant;
    }

    // Future: support video/pdf variants
    throw new Error(`Variant ${variantType} not supported for mime ${file.mime}`);
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

      // Queue variant generation (implement this later)
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
        createdAt: new Date()
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
      
      // If file was in trash and now has links, restore it
      if (file.status === 'trash' && file.links.length > 0) {
        file.status = 'active';
      }
      
      await file.save();

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
   * Get file by ID with full metadata
   * Also handles legacy storage keys for backward compatibility
   */
  async getFile(fileId: string): Promise<IFile | null> {
    try {
      // Validate that fileId is a valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(fileId)) {
        logger.warn('Invalid ObjectId provided to getFile, checking if it\'s a legacy storage key:', { fileId });
        
        // Try to find by storage key (for legacy data)
        const fileByStorageKey = await File.findOne({ storageKey: fileId });
        if (fileByStorageKey) {
          logger.info('Found file by legacy storage key:', { fileId, actualId: fileByStorageKey._id });
          return fileByStorageKey;
        }
        
        logger.warn('File not found by ID or storage key:', { fileId });
        return null;
      }
      const file = await File.findById(fileId);
      return file;
    } catch (error) {
      logger.error('Error getting file:', error);
      throw error;
    }
  }

  /**
   * Get file URL (CDN or signed URL)
   * Also handles legacy storage keys for backward compatibility
   */
  async getFileUrl(
    fileId: string, 
    variant?: string, 
    expiresIn: number = 3600
  ): Promise<string> {
    try {
      // Use getFile which handles both ObjectIds and legacy storage keys
      const file = await this.getFile(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      let storageKey = file.storageKey;

      // If variant requested, ensure or find variant key
      if (variant) {
        const ensured = await this.ensureVariant(file._id.toString(), variant);
        storageKey = ensured.key;
      }

      // Verify object exists before generating URL to avoid redirecting to 404
      const exists = await this.s3Service.fileExists(storageKey);
      if (!exists) {
        throw new Error('File not found in storage');
      }

      // For now, return presigned URL
      // Later this will check if file is public and return CDN URL
      const url = await this.s3Service.getPresignedDownloadUrl(storageKey, expiresIn);

      logger.debug('Generated file URL', { fileId, actualId: file._id, variant, storageKey });

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
  async deleteFile(fileId: string, force: boolean = false): Promise<void> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      if (!force && file.links.length > 0) {
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

      // Mark as deleted in database
      file.status = 'deleted';
      await file.save();

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

      file.visibility = visibility;
      await file.save();

      logger.info('File visibility updated', { 
        fileId, 
        visibility 
      });

      return file;
    } catch (error) {
      logger.error('Error updating file visibility:', error);
      throw error;
    }
  }

  /**
   * Check if a user can access a file
   */
  canUserAccessFile(file: IFile, userId?: string): boolean {
    // Public files are accessible by everyone
    if (file.visibility === 'public') {
      return true;
    }

    // Unlisted files are accessible with direct link
    if (file.visibility === 'unlisted') {
      return true;
    }

    // Private files require authentication and ownership
    if (!userId) {
      return false;
    }

    return file.ownerUserId === userId;
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
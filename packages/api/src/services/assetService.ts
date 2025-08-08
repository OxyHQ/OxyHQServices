import crypto from 'crypto';
import { File, IFile, IFileLink, IFileVariant } from '../models/File';
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
  metadata?: Record<string, any>;
}

export interface AssetLinkRequest {
  app: string;
  entityType: string;
  entityId: string;
  createdBy: string;
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
      const uploadUrl = await this.s3Service.getPresignedUploadUrl(storageKey, {
        contentType: expectedMime,
        expiresIn: 3600,
        metadata: {
          fileId: file._id.toString(),
          sha256: expectedSha256,
          userId
        }
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
      
      await file.save();

      // Queue variant generation (implement this later)
      this.queueVariantGeneration(file);

      logger.info('Asset upload completed', { 
        fileId: file._id, 
        originalName: request.originalName 
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
   */
  async getFile(fileId: string): Promise<IFile | null> {
    try {
      const file = await File.findById(fileId);
      return file;
    } catch (error) {
      logger.error('Error getting file:', error);
      throw error;
    }
  }

  /**
   * Get file URL (CDN or signed URL)
   */
  async getFileUrl(
    fileId: string, 
    variant?: string, 
    expiresIn: number = 3600
  ): Promise<string> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      let storageKey = file.storageKey;

      // If variant requested, find variant key
      if (variant) {
        const variantInfo = file.variants.find(v => v.type === variant);
        if (variantInfo && variantInfo.readyAt) {
          storageKey = variantInfo.key;
        } else {
          throw new Error(`Variant ${variant} not found or not ready`);
        }
      }

      // For now, return presigned URL
      // Later this will check if file is public and return CDN URL
      const url = await this.s3Service.getPresignedDownloadUrl(storageKey, expiresIn);

      logger.debug('Generated file URL', { fileId, variant, storageKey });

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
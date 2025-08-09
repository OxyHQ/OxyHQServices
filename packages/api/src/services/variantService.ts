import { File, IFile, IFileVariant } from '../models/File';
import { S3Service } from './s3Service';
import { logger } from '../utils/logger';
import sharp from 'sharp';
import path from 'path';

export interface VariantConfig {
  type: string;
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png';
}

export class VariantService {
  private readonly imageVariants: VariantConfig[] = [
    { type: 'thumb', width: 256, height: 256, quality: 82, format: 'webp' },
    { type: 'w320', width: 320, quality: 82, format: 'webp' },
    { type: 'w640', width: 640, quality: 82, format: 'webp' },
    { type: 'w1280', width: 1280, quality: 82, format: 'webp' },
    { type: 'w2048', width: 2048, quality: 82, format: 'webp' }
  ];

  constructor(private s3Service: S3Service) {}

  /**
   * Generate variants for a file
   */
  async generateVariants(fileId: string): Promise<void> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      logger.info('Starting variant generation', { 
        fileId, 
        mime: file.mime,
        size: file.size 
      });

      // Check if variants already exist (for content-addressed files)
      const existingFile = await File.findOne({
        sha256: file.sha256,
        'variants.0': { $exists: true },
        _id: { $ne: file._id }
      });

      if (existingFile && existingFile.variants.length > 0) {
        // Reuse existing variants
  file.variants = existingFile.variants;
  await this.commitVariants(file);
        
        logger.info('Reused existing variants for duplicate content', { 
          fileId, 
          sourceFileId: existingFile._id,
          variantCount: existingFile.variants.length
        });
        return;
      }

      // Generate new variants based on file type
      if (file.mime.startsWith('image/')) {
        await this.generateImageVariants(file);
      } else if (file.mime.startsWith('video/')) {
        await this.generateVideoVariants(file);
      } else if (file.mime === 'application/pdf') {
        await this.generatePdfVariants(file);
      }

      logger.info('Variant generation completed', { 
        fileId, 
        variantCount: file.variants.length 
      });
    } catch (error) {
      logger.error('Error generating variants:', error);
      throw error;
    }
  }

  /**
   * Generate all standard image variants using Sharp.
   */
  private async generateImageVariants(file: IFile): Promise<void> {
    try {
      logger.info('Generating image variants', { fileId: file._id });

      const originalBuffer = await this.s3Service.downloadBuffer(file.storageKey);
      const base = sharp(originalBuffer, { failOn: 'none' });
      const meta = await base.metadata();

      const variants: IFileVariant[] = [];
      for (const config of this.imageVariants) {
        const variantKey = this.generateVariantKey(file.sha256, config.type, config.format || 'webp');

        const width = config.width || meta.width || 1280;
        const height = config.height; // let sharp maintain aspect by only setting width unless both provided
        let pipeline = sharp(originalBuffer, { failOn: 'none' }).rotate();
        pipeline = pipeline.resize({ width, height, fit: 'inside', withoutEnlargement: true });

        // Set format and quality
        const format = (config.format || 'webp');
  if (format === 'webp') pipeline = pipeline.webp({ quality: config.quality ?? 82 });
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: config.quality ?? 82 });
  if (format === 'png') pipeline = pipeline.png();

        const out = await pipeline.toBuffer();
        await this.s3Service.uploadBuffer(variantKey, out, {
          contentType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
        });

        variants.push({
          type: config.type,
          key: variantKey,
          width,
          height: height || Math.round((meta.height || width) * (width / (meta.width || width))),
          readyAt: new Date(),
          size: out.length,
          metadata: { format, quality: config.quality }
        });

        logger.debug('Generated image variant', { fileId: file._id, type: config.type, key: variantKey });
      }

  file.variants = variants;
  await this.commitVariants(file);

      logger.info('Image variants generated', { fileId: file._id, variantCount: variants.length });
    } catch (error) {
      logger.error('Error generating image variants:', error);
      throw error;
    }
  }

  /**
   * Generate video variants (placeholder implementation)
   */
  private async generateVideoVariants(file: IFile): Promise<void> {
    // This would use FFmpeg to generate different bitrates and HLS streams
    // For now, just generate a poster image
    
    try {
      logger.info('Generating video variants (poster only)', { fileId: file._id });

      // Generate poster frame at 1 second
      const posterKey = this.generateVariantKey(file.sha256, 'poster', 'jpg');
      
      // This is a placeholder - would need FFmpeg integration
      // For now, we'll skip actual video processing
      
      const variants: IFileVariant[] = [{
        type: 'poster',
        key: posterKey,
        width: 1280,
        height: 720,
        readyAt: new Date(),
        metadata: { type: 'poster', position: '00:00:01' }
      }];

  file.variants = variants;
  await this.commitVariants(file);

      logger.info('Video variants generated (placeholder)', {
        fileId: file._id,
        variantCount: variants.length
      });
    } catch (error) {
      logger.error('Error generating video variants:', error);
      throw error;
    }
  }

  /**
   * Generate PDF variants (first page thumbnail)
   */
  private async generatePdfVariants(file: IFile): Promise<void> {
    // This would use pdf2pic or similar to generate thumbnails
    // For now, this is a placeholder
    
    try {
      logger.info('Generating PDF variants (placeholder)', { fileId: file._id });

      const thumbnailKey = this.generateVariantKey(file.sha256, 'thumb', 'jpg');
      
      // Placeholder variant
      const variants: IFileVariant[] = [{
        type: 'thumb',
        key: thumbnailKey,
        width: 256,
        height: 256,
        readyAt: new Date(),
        metadata: { page: 1 }
      }];

  file.variants = variants;
  await this.commitVariants(file);

      logger.info('PDF variants generated (placeholder)', {
        fileId: file._id,
        variantCount: variants.length
      });
    } catch (error) {
      logger.error('Error generating PDF variants:', error);
      throw error;
    }
  }

  /**
   * Generate variant storage key
   */
  private generateVariantKey(sha256: string, variantType: string, format: string): string {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const prefix = sha256.substring(0, 2);
    
    return `variants/${year}/${month}/${prefix}/${sha256}/${variantType}.${format}`;
  }

  /**
   * Get available variants for a file
   */
  async getVariants(fileId: string): Promise<IFileVariant[]> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      return file.variants.filter(variant => variant.readyAt);
    } catch (error) {
      logger.error('Error getting variants:', error);
      throw error;
    }
  }

  /**
   * Check if variant exists and is ready
   */
  async isVariantReady(fileId: string, variantType: string): Promise<boolean> {
    try {
      const file = await File.findById(fileId);
      if (!file) {
        return false;
      }

      const variant = file.variants.find(v => v.type === variantType);
      return !!(variant && variant.readyAt);
    } catch (error) {
      logger.error('Error checking variant readiness:', error);
      return false;
    }
  }

  /**
   * Ensure a specific image variant exists, generate via Sharp if missing.
   */
  async ensureImageVariant(file: IFile, variantType: string): Promise<IFileVariant> {
    // If already present and object exists, return
    const existing = file.variants.find(v => v.type === variantType && v.readyAt);
    if (existing) {
      const ok = await this.s3Service.fileExists(existing.key);
      if (ok) return existing;
    }

    // Map variantType to config
    const config = this.imageVariants.find(v => v.type === variantType);
    if (!config) {
      throw new Error(`Unsupported image variant: ${variantType}`);
    }

    const originalBuffer = await this.s3Service.downloadBuffer(file.storageKey);
    let pipeline = sharp(originalBuffer, { failOn: 'none' }).rotate();
    pipeline = pipeline.resize({ width: config.width, height: config.height, fit: 'inside', withoutEnlargement: true });
    const format = (config.format || 'webp');
  if (format === 'webp') pipeline = pipeline.webp({ quality: config.quality ?? 82 });
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: config.quality ?? 82 });
  if (format === 'png') pipeline = pipeline.png();

    const out = await pipeline.toBuffer();
    const key = this.generateVariantKey(file.sha256, variantType, format);
    await this.s3Service.uploadBuffer(key, out, {
      contentType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
    });

    const imgMeta = await sharp(out).metadata();
    const variant: IFileVariant = {
      type: variantType,
      key,
      width: imgMeta.width || config.width || 0,
      height: imgMeta.height || config.height || 0,
      readyAt: new Date(),
      size: out.length,
      metadata: { format, quality: config.quality }
    };

    // Upsert in DB
    const idx = file.variants.findIndex(v => v.type === variantType);
    if (idx >= 0) file.variants[idx] = variant;
    else file.variants.push(variant);
    try {
      await this.commitVariants(file);
    } catch (error) {
      logger.warn('Failed committing single ensured variant, retrying fetch & update', { fileId: file._id, variantType, error });
      // Retry once with fresh document to mitigate race conditions
      const fresh = await File.findById(file._id);
      if (fresh) {
        const idx2 = fresh.variants.findIndex(v => v.type === variantType);
        if (idx2 >= 0) fresh.variants[idx2] = variant; else fresh.variants.push(variant);
        try {
          await File.updateOne({ _id: fresh._id }, { $set: { variants: fresh.variants } });
        } catch (err2) {
          logger.error('Retry failed committing ensured variant', { fileId: file._id, variantType, error: err2 });
        }
      }
    }

    return variant;
  }
}

// Helper methods appended to class
export interface VariantCommitRetryOptions {
  retries?: number;
  delayMs?: number;
}

// Extend class with private method via declaration merging pattern
declare module './variantService' {
  interface VariantService {
    commitVariants(file: IFile, options?: VariantCommitRetryOptions): Promise<void>;
  }
}

VariantService.prototype.commitVariants = async function(file: IFile, options: VariantCommitRetryOptions = {}): Promise<void> {
  const { retries = 2, delayMs = 60 } = options;
  let attempt = 0;
  // We only update the variants field to avoid version key conflicts; using updateOne bypasses optimistic concurrency
  while (attempt <= retries) {
    try {
      await File.updateOne({ _id: file._id }, { $set: { variants: file.variants } }).exec();
      return;
    } catch (err: any) {
      if (String(err?.name) === 'VersionError' && attempt < retries) {
        logger.warn('VersionError committing variants, retrying', { fileId: file._id, attempt });
        await new Promise(res => setTimeout(res, delayMs * (attempt + 1)));
        // Refresh variants from DB to merge if needed
        const fresh = await File.findById(file._id);
        if (fresh) {
          // Simple merge preferring in-memory variants by type
            const merged: IFileVariant[] = [];
            const byType: Record<string, IFileVariant> = {};
            for (const v of fresh.variants) byType[v.type] = v;
            for (const v of file.variants) byType[v.type] = v; // overwrite with latest
            for (const k of Object.keys(byType)) merged.push(byType[k]);
            file.variants = merged;
        }
        attempt++;
        continue;
      }
      logger.error('Failed to commit variants', { fileId: file._id, attempt, error: err });
      throw err;
    }
  }
};

// Note: This implementation uses a placeholder for Sharp
// In a real deployment, you would install Sharp with: npm install sharp
// For now, we'll create a mock implementation to avoid build issues
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import {
  S3Config,
  UploadOptions as S3UploadOptions,
  FileInfo,
  PresignedUrlOptions,
} from '../types/s3.types';
import { logger } from '../utils/logger';

// Extend UploadOptions with service-specific fields
export interface UploadOptions extends S3UploadOptions {
  publicRead?: boolean;
  folder?: string;
}

export class S3Service {
  private s3Client: S3Client;
  private bucketName: string;
  private endpointUrl?: string;
  private region: string;

  constructor(config: S3Config) {
    const clientConfig: any = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };

    // Add custom endpoint for DigitalOcean Spaces or other S3-compatible services
    if (config.endpointUrl) {
      clientConfig.endpoint = config.endpointUrl;
      clientConfig.forcePathStyle = false; // Try without forcing path style first
      clientConfig.useAccelerateEndpoint = false;
      clientConfig.useArnRegion = false;
    }

    logger.debug('S3Client Configuration', {
      region: clientConfig.region,
      endpoint: clientConfig.endpoint,
      forcePathStyle: clientConfig.forcePathStyle,
    });

    this.s3Client = new S3Client(clientConfig);
    this.bucketName = config.bucketName;
    this.endpointUrl = config.endpointUrl;
    this.region = config.region;
  }

  /**
   * Upload a file to S3
   */
  async uploadFile(
    key: string,
    filePath: string | Buffer,
    options: UploadOptions = {}
  ): Promise<FileInfo> {
    try {
      let body: Buffer | NodeJS.ReadableStream;
      let contentType = options.contentType;

      if (typeof filePath === 'string') {
        body = createReadStream(filePath);
        contentType = contentType || this.getContentTypeFromPath(filePath);
      } else {
        body = filePath;
        contentType = contentType || 'application/octet-stream';
      }

      const { finalKey, metadata, acl } = this.prepareObjectOptions(key, options);

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: finalKey,
        Body: body as any, // Type assertion for compatibility
        ContentType: contentType,
        Metadata: metadata,
        ACL: acl,
      });

      const response = await this.s3Client.send(command);

      return {
        key: finalKey,
        size: 0, // Will be updated below
        lastModified: new Date(),
        contentType,
        metadata: metadata || {},
        url: options.publicRead ? this.generatePublicUrl(finalKey) : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to upload file to S3: ${error}`);
    }
  }

  /**
   * Upload file from buffer
   */
  async uploadBuffer(
    key: string,
    buffer: Buffer,
    options: UploadOptions = {}
  ): Promise<FileInfo> {
    try {
      const contentType = options.contentType || 'application/octet-stream';
      const { finalKey, metadata, acl } = this.prepareObjectOptions(key, options);

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: finalKey,
        Body: buffer,
        ContentType: contentType,
        Metadata: metadata,
        ACL: acl,
      });

      await this.s3Client.send(command);

      return {
        key: finalKey,
        size: buffer.length,
        lastModified: new Date(),
        contentType,
        metadata: metadata || {},
        url: options.publicRead ? this.generatePublicUrl(finalKey) : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to upload buffer to S3: ${error}`);
    }
  }

  /**
   * Download a file from S3 to local path
   */
  async downloadFile(key: string, localPath: string): Promise<void> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        throw new Error('File not found or empty');
      }

      const writeStream = createWriteStream(localPath);
      await pipeline(response.Body.transformToWebStream() as any, writeStream);
    } catch (error) {
      throw new Error(`Failed to download file from S3: ${error}`);
    }
  }

  /**
   * Download a file from S3 as buffer
   */
  async downloadBuffer(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        throw new Error('File not found or empty');
      }

      const chunks: Uint8Array[] = [];
      const reader = response.Body.transformToWebStream().getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      throw new Error(`Failed to download buffer from S3: ${error}`);
    }
  }

  /**
   * Get an object stream with metadata for streaming to clients
   */
  async getObjectStream(key: string): Promise<{
    body: NodeJS.ReadableStream,
    contentType?: string,
    contentLength?: number,
    lastModified?: Date,
    metadata?: Record<string, string>
  }> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    const response: any = await this.s3Client.send(command);
    if (!response.Body) {
      throw new Error('File not found or empty');
    }

    // AWS SDK v3 returns a Body with transformToWebStream in browsers; in Node it is a Readable
    const body: NodeJS.ReadableStream = typeof response.Body.pipe === 'function'
      ? response.Body
      : (response.Body.transformToWebStream && (response.Body as any).transformToWebStream()) as any;

    const length = response.ContentLength != null ? Number(response.ContentLength) : undefined;
    const metadata: Record<string, string> = {};
    if (response.Metadata) {
      for (const [k, v] of Object.entries(response.Metadata)) {
        if (v != null) metadata[k] = String(v);
      }
    }

    return {
      body,
      contentType: response.ContentType,
      contentLength: length,
      lastModified: response.LastModified,
      metadata,
    };
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error) {
      throw new Error(`Failed to delete file from S3: ${error}`);
    }
  }

  /**
   * Generate a presigned URL for file upload
   */
  async getPresignedUploadUrl(
    key: string,
    options: PresignedUrlOptions = {}
  ): Promise<string> {
    try {
      const { expiresIn = 3600, contentType = 'application/octet-stream', metadata } = options;
      
      // Sanitize metadata to ensure all values are strings
      const sanitizedMetadata: Record<string, string> = {};
      if (metadata) {
        for (const [key, value] of Object.entries(metadata)) {
          if (value !== null && value !== undefined) {
            sanitizedMetadata[key] = String(value);
          }
        }
      }
      
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ContentType: contentType,
        Metadata: Object.keys(sanitizedMetadata).length > 0 ? sanitizedMetadata : undefined,
      });

      return getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      throw new Error(`Failed to generate presigned upload URL: ${error}`);
    }
  }

  /**
   * Generate a presigned URL for file download
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresIn: number = 3600
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      throw new Error(`Failed to generate presigned download URL: ${error}`);
    }
  }

  /**
   * List files in a directory
   */
  async listFiles(prefix: string = '', maxKeys: number = 1000): Promise<FileInfo[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: maxKeys,
      });

      const response = await this.s3Client.send(command);
      
      if (!response.Contents) {
        return [];
      }

      return response.Contents.map((item) => ({
        key: item.Key!,
        size: item.Size || 0,
        lastModified: item.LastModified!,
        bucket: this.bucketName,
      }));
    } catch (error) {
      throw new Error(`Failed to list files from S3: ${error}`);
    }
  }

  /**
   * Check if a file exists
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      // Prefer HEAD to check existence without downloading
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error: any) {
      const name = error?.name || error?.Code || error?.code;
      const status = error?.$metadata?.httpStatusCode;
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
        return false;
      }
      // Some S3-compatible services return 404 via code property
      if (String(status).startsWith('4')) {
        return false;
      }
      return false;
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(key: string): Promise<FileInfo | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      
      return {
        key,
        size: parseInt(response.ContentLength?.toString() || '0'),
        lastModified: response.LastModified!,
        contentType: response.ContentType,
        metadata: response.Metadata,
        bucket: this.bucketName,
      };
    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Copy file from one key to another
   */
  async copyFile(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      const command = new CopyObjectCommand({
        Bucket: this.bucketName,
        Key: destinationKey,
        CopySource: `${this.bucketName}/${sourceKey}`,
      });

      await this.s3Client.send(command);
    } catch (error) {
      throw new Error(`Failed to copy file in S3: ${error}`);
    }
  }

  /**
   * Move file (copy + delete)
   */
  async moveFile(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      await this.copyFile(sourceKey, destinationKey);
      await this.deleteFile(sourceKey);
    } catch (error) {
      throw new Error(`Failed to move file in S3: ${error}`);
    }
  }

  /**
   * Upload multiple files
   */
  async uploadMultipleFiles(
    files: Array<{ key: string; filePath: string | Buffer; options?: UploadOptions }>
  ): Promise<FileInfo[]> {
    const uploadPromises = files.map(({ key, filePath, options }) =>
      typeof filePath === 'string' 
        ? this.uploadFile(key, filePath, options)
        : this.uploadBuffer(key, filePath, options)
    );

    return Promise.all(uploadPromises);
  }

  /**
   * Delete multiple files
   */
  async deleteMultipleFiles(keys: string[]): Promise<void> {
    const deletePromises = keys.map(key => this.deleteFile(key));
    await Promise.all(deletePromises);
  }

  /**
   * Generate a unique file key
   */
  generateUniqueKey(originalName: string, folder?: string): string {
    const extension = path.extname(originalName);
    const baseName = path.basename(originalName, extension);
    const uniqueId = uuidv4();
    const key = `${baseName}-${uniqueId}${extension}`;
    
    return folder ? `${folder}/${key}` : key;
  }

  /**
   * Get content type from file path
   */
  private getContentTypeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.csv': 'text/csv',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.zip': 'application/zip',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Get public URL for a file (if bucket is public)
   */
  getPublicUrl(key: string): string {
    if (this.endpointUrl) {
      // For DigitalOcean Spaces or other S3-compatible services
      const baseUrl = this.endpointUrl.replace('https://', '');
      return `https://${this.bucketName}.${baseUrl}/${key}`;
    } else {
      // For AWS S3
      return `https://${this.bucketName}.s3.amazonaws.com/${key}`;
    }
  }

  /**
   * Generate URL for public read files
   */
  private generatePublicUrl(key: string): string {
    if (this.endpointUrl) {
      // For DigitalOcean Spaces or other S3-compatible services
      const baseUrl = this.endpointUrl.replace('https://', '');
      return `https://${this.bucketName}.${baseUrl}/${key}`;
    } else {
      // For AWS S3
      return `https://${this.bucketName}.s3.amazonaws.com/${key}`;
    }
  }

  /**
   * Validate file size
   */
  validateFileSize(size: number, maxSize: number): boolean {
    return size <= maxSize;
  }

  /**
   * Validate file type
   */
  validateFileType(filename: string, allowedTypes: string[]): boolean {
    const ext = path.extname(filename).toLowerCase();
    return allowedTypes.includes(ext);
  }

  private prepareObjectOptions(key: string, options: UploadOptions) {
    return {
      finalKey: this.buildFinalKey(key, options.folder),
      metadata: this.sanitizeMetadata(options.metadata),
      acl: options.publicRead ? 'public-read' as const : 'private' as const,
    };
  }

  private buildFinalKey(key: string, folder?: string) {
    return folder ? `${folder}/${key}` : key;
  }

  private sanitizeMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) return undefined;

    const sanitized: Record<string, string> = {};
    for (const [metaKey, value] of Object.entries(metadata)) {
      if (value === null || value === undefined) continue;
      sanitized[metaKey] = String(value);
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }
}

// Export a factory function for easier configuration
export function createS3Service(config: S3Config): S3Service {
  return new S3Service(config);
}

// No additional type exports needed - interfaces are already exported 

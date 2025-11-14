/**
 * S3 Service Types
 * 
 * Centralized type definitions for S3 storage operations.
 */

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region: string;
  endpointUrl?: string;
}

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  acl?: 'private' | 'public-read';
}

export interface FileInfo {
  key: string;
  size: number;
  lastModified?: Date;
  contentType?: string;
  metadata?: Record<string, string>;
  url?: string;
  bucket?: string; // Optional - service knows bucket from config
  etag?: string;
  location?: string;
}

export interface PresignedUrlOptions {
  expiresIn?: number;
  contentType?: string;
  metadata?: Record<string, string>;
}


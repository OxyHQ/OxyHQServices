/**
 * File Utilities
 * 
 * Shared utility functions for file handling across API routes.
 * Follows DRY principles and provides consistent error handling.
 */

import { Response } from 'express';
import { S3Service } from '../services/s3Service';
import { logger } from './logger';
import path from 'path';

/**
 * Standard error responses
 */
export const FileErrors = {
  NO_KEY: { status: 400, error: 'File key is required' },
  NOT_FOUND: { status: 404, error: 'File not found' },
  ACCESS_DENIED: { status: 403, error: 'Access denied' },
  DOWNLOAD_FAILED: { status: 500, error: 'Failed to download file' },
  METADATA_FAILED: { status: 500, error: 'Failed to get file metadata' },
} as const;

/**
 * Validate user access to a file based on key prefix
 * 
 * @param key - File key in S3
 * @param userId - User ID to validate
 * @returns true if user has access, false otherwise
 */
export function validateUserFileAccess(key: string, userId: string): boolean {
  const userPrefix = `users/${userId}/`;
  return key.startsWith(userPrefix);
}

/**
 * Send an error response with consistent format
 * 
 * @param res - Express response object
 * @param error - Error configuration
 * @param message - Optional custom message
 */
export function sendFileError(
  res: Response,
  error: { status: number; error: string },
  message?: string
): void {
  res.status(error.status).json({
    error: error.error,
    ...(message && { message }),
  });
}

/**
 * Handle file download with proper headers and error handling
 * Consolidates common download logic to avoid duplication
 * 
 * @param options - Download options
 * @returns Promise that resolves when download is complete
 */
export interface DownloadFileOptions {
  key: string;
  userId: string;
  s3Service: S3Service;
  res: Response;
  attachment?: boolean;
}

export async function handleFileDownload({
  key,
  userId,
  s3Service,
  res,
  attachment = true,
}: DownloadFileOptions): Promise<void> {
  try {
    // Validate user access
    if (!validateUserFileAccess(key, userId)) {
      logger.warn('Download access denied: key not in user folder', { userId, key });
      sendFileError(res, FileErrors.ACCESS_DENIED);
      return;
    }

    // Get file metadata
    const metadata = await s3Service.getFileMetadata(key);
    if (!metadata) {
      sendFileError(res, FileErrors.NOT_FOUND);
      return;
    }

    // Download file
    const buffer = await s3Service.downloadBuffer(key);

    // Set response headers
    const contentType = metadata.contentType || 'application/octet-stream';
    const filename = path.basename(key);
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    
    if (attachment) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }
    
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    logger.info(`File downloaded: ${key} by user ${userId}`);
    res.send(buffer);
  } catch (error: any) {
    logger.error('File download error:', error);
    sendFileError(res, FileErrors.DOWNLOAD_FAILED, error.message);
  }
}

/**
 * Extract file key from request (supports both path params and query params)
 * 
 * @param params - Request params object
 * @param query - Request query object
 * @returns File key or undefined
 */
export function extractFileKey(
  params: { key?: string },
  query: { key?: unknown }
): string | undefined {
  return params.key || (typeof query.key === 'string' ? query.key : undefined);
}

/**
 * Generate user-scoped storage key
 * Ensures files are always stored in user's namespace
 * 
 * @param userId - User ID
 * @param key - Original key or filename
 * @returns Scoped key
 */
export function scopeKeyToUser(userId: string, key: string): string {
  const userPrefix = `users/${userId}/`;
  
  // If key already has the user prefix, return as-is
  if (key.startsWith(userPrefix)) {
    return key;
  }
  
  // Remove leading slash if present
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  
  return `${userPrefix}${cleanKey}`;
}

/**
 * Parse pagination parameters with validation and defaults
 * 
 * @param query - Request query object
 * @returns Validated pagination parameters
 */
export interface PaginationParams {
  limit: number;
  offset: number;
}

export function parsePaginationParams(query: {
  limit?: unknown;
  offset?: unknown;
}): PaginationParams {
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
  const offset = Math.max(0, Number(query.offset) || 0);
  
  return { limit, offset };
}

/**
 * Check if a MIME type represents a media file
 * 
 * @param mimeType - MIME type string
 * @returns true if media file, false otherwise
 */
export function isMediaMimeType(mimeType: string): boolean {
  const mediaTypes = ['image/', 'video/', 'audio/'];
  return mediaTypes.some(type => mimeType.startsWith(type));
}

/**
 * Format file size in human-readable format
 * 
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

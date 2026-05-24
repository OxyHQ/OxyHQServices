/**
 * Variant Service Types
 * 
 * Centralized type definitions for file variant operations.
 */

export interface VariantConfig {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png';
}

export interface VariantCommitRetryOptions {
  maxRetries?: number;
  retryDelay?: number;
}


/**
 * Environment Configuration Validation
 * 
 * Validates required environment variables on startup to fail fast
 * with clear error messages rather than failing at runtime.
 * 
 * Big tech practice: Validate configuration early and provide actionable errors.
 */

import { logger } from '../utils/logger';

/**
 * Required environment variables
 */
export interface RequiredEnvVars {
  // Database
  MONGODB_URI: string;
  
  // Authentication
  ACCESS_TOKEN_SECRET: string;
  REFRESH_TOKEN_SECRET: string;
  
  // AWS/S3 Configuration
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_S3_BUCKET: string;
  AWS_ENDPOINT_URL?: string; // Optional for S3-compatible services
  
  // Server
  PORT?: string;
  NODE_ENV?: string;
}

/**
 * Optional environment variables with defaults
 */
export const ENV_DEFAULTS = {
  PORT: '3001',
  NODE_ENV: 'development',
  AWS_REGION: 'us-east-1',
} as const;

/**
 * Configuration errors
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Validate that required environment variables are set
 * 
 * @throws {ConfigurationError} If required variables are missing
 */
export function validateRequiredEnvVars(): void {
  const required: (keyof RequiredEnvVars)[] = [
    'MONGODB_URI',
    'ACCESS_TOKEN_SECRET',
    'REFRESH_TOKEN_SECRET',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_BUCKET',
  ];

  const missing: string[] = [];
  const warnings: string[] = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  // Check for commonly misconfigured variables
  if (process.env.MONGODB_URI && !process.env.MONGODB_URI.startsWith('mongodb')) {
    warnings.push('MONGODB_URI should start with "mongodb://" or "mongodb+srv://"');
  }

  if (process.env.AWS_S3_BUCKET && process.env.AWS_S3_BUCKET.includes('/')) {
    warnings.push('AWS_S3_BUCKET should be just the bucket name, not a full path');
  }

  // Log warnings
  if (warnings.length > 0) {
    logger.warn('Environment configuration warnings:', { warnings });
  }

  // Throw error if any required variables are missing
  if (missing.length > 0) {
    const errorMessage = [
      'Missing required environment variables:',
      ...missing.map(key => `  - ${key}`),
      '',
      'Please set these variables in your .env file or environment.',
      'See .env.example for reference.',
    ].join('\n');

    throw new ConfigurationError(errorMessage);
  }
}

/**
 * Get environment variable with default fallback
 * 
 * @param key - Environment variable key
 * @param defaultValue - Default value if not set
 * @returns Environment variable value or default
 */
export function getEnvVar(key: string, defaultValue?: string): string {
  return process.env[key] || defaultValue || '';
}

/**
 * Get environment variable as number
 * 
 * @param key - Environment variable key
 * @param defaultValue - Default value if not set or invalid
 * @returns Parsed number or default
 */
export function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get environment variable as boolean
 * 
 * @param key - Environment variable key
 * @param defaultValue - Default value if not set
 * @returns Boolean value
 */
export function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  
  return ['true', '1', 'yes'].includes(value.toLowerCase());
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Get sanitized configuration for logging (without sensitive data)
 */
export function getSanitizedConfig(): Record<string, string> {
  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: process.env.PORT || ENV_DEFAULTS.PORT,
    AWS_REGION: process.env.AWS_REGION || ENV_DEFAULTS.AWS_REGION,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || '',
    AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL || 'default',
    MONGODB_URI: process.env.MONGODB_URI ? maskConnectionString(process.env.MONGODB_URI) : '',
  };
}

/**
 * Mask sensitive parts of connection strings for logging
 * 
 * @param connectionString - Connection string to mask
 * @returns Masked connection string
 */
function maskConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = '***';
    }
    if (url.username) {
      // Keep first and last character of username
      const username = url.username;
      if (username.length > 2) {
        url.username = username[0] + '***' + username[username.length - 1];
      }
    }
    return url.toString();
  } catch {
    // If URL parsing fails, just mask the entire string after the protocol
    return connectionString.replace(/:\/\/.*@/, '://***:***@');
  }
}

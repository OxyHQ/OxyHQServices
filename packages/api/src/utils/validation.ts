/**
 * Shared validation utilities for API
 * Consolidates validation logic used across controllers and routes
 */

import mongoose from 'mongoose';

/**
 * Validates if a string is a valid MongoDB ObjectId
 * Uses mongoose's built-in validation for accurate checking
 */
export function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Validates required fields in an object
 * Throws ValidationError if any required fields are missing
 */
export function validateRequiredFields(
  data: Record<string, unknown>,
  fields: string[]
): void {
  const missing = fields.filter(field => {
    const value = data[field];
    return value === undefined || value === null || value === '';
  });
  
  if (missing.length > 0) {
    throw new (require('./error').ValidationError)(
      `Missing required fields: ${missing.join(', ')}`
    );
  }
}

/**
 * Validates pagination parameters
 * Returns normalized limit and offset with defaults
 * Handles Express query parameter types (string | ParsedQs | array | undefined)
 */
export function validatePagination(
  limit?: unknown,
  offset?: unknown,
  maxLimit: number = 100,
  defaultLimit: number = 50
): { limit: number; offset: number } {
  // Convert to string first, then parse
  const limitStr = limit !== undefined ? String(limit) : undefined;
  const offsetStr = offset !== undefined ? String(offset) : undefined;
  
  const parsedLimit = limitStr !== undefined 
    ? Math.min(Math.max(parseInt(limitStr, 10) || defaultLimit, 1), maxLimit)
    : defaultLimit;
  
  const parsedOffset = offsetStr !== undefined
    ? Math.max(parseInt(offsetStr, 10) || 0, 0)
    : 0;
  
  return { limit: parsedLimit, offset: parsedOffset };
}


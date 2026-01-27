/**
 * Shared validation utilities for API
 * Consolidates validation logic used across controllers and routes
 */

import mongoose from 'mongoose';
import User from '../models/User';
import { NotFoundError, BadRequestError, ValidationError } from './error';
import { logger } from './logger';

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
    throw new ValidationError(
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

/**
 * Resolves a user ID to a MongoDB ObjectId
 * Accepts both ObjectId strings and publicKey strings
 * @param userId - User ID (can be ObjectId or publicKey)
 * @returns MongoDB ObjectId as string
 * @throws BadRequestError if userId is invalid or user not found
 */
export async function resolveUserIdToObjectId(userId: string): Promise<string> {
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    logger.warn('resolveUserIdToObjectId: Empty or invalid userId provided', { userId });
    throw new BadRequestError('User ID is required');
  }

  const trimmedUserId = userId.trim();

  // Check if it's a valid ObjectId
  if (mongoose.Types.ObjectId.isValid(trimmedUserId)) {
    // Verify the ObjectId is exactly 24 hex characters (MongoDB ObjectId format)
    if (trimmedUserId.length === 24 && /^[0-9a-fA-F]{24}$/.test(trimmedUserId)) {
      return trimmedUserId;
    }
  }

  // If not a valid ObjectId, treat it as a publicKey and look up the user
  logger.debug('resolveUserIdToObjectId: Treating userId as publicKey', { userId: trimmedUserId });
  const user = await User.findOne({ publicKey: trimmedUserId }).select('_id').lean();

  if (!user || !user._id) {
    logger.warn('resolveUserIdToObjectId: User not found for publicKey', { userId: trimmedUserId });
    throw new NotFoundError('User not found');
  }

  return user._id.toString();
}


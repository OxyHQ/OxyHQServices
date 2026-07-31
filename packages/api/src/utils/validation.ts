/**
 * Shared validation utilities for API
 * Consolidates validation logic used across controllers and routes
 */

import mongoose from 'mongoose';
import User from '../models/User';
import { NotFoundError, BadRequestError, ValidationError } from './error';
import { logger } from './logger';

/**
 * Does this string have the shape of an account identifier?
 *
 * TWO formats are live and both are permanent. Rows that predate the Postgres
 * migration keep their 24-hex Mongo ObjectId verbatim — they are published in
 * DIDs, in the signing input of every signed record, and in URLs cached by
 * remote fediverse instances, so they can never be rewritten. Rows created
 * after it get a uuid v7.
 *
 * Accepting only the first is a CUTOVER BUG, not a stricter check: every
 * account created after the migration would fail a guard written for the old
 * shape, and the caller's `false` branch is usually a 404 or — worse, as in the
 * media-privacy guards this replaced — a silent "not blocked".
 */
const OBJECT_ID_FORMAT = /^[0-9a-f]{24}$/i;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidObjectId(id: string): boolean {
  return OBJECT_ID_FORMAT.test(id) || UUID_FORMAT.test(id);
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
  maxLimit = 100,
  defaultLimit = 50
): { limit: number; offset: number } {
  // Convert to string first, then parse
  const limitStr = limit !== undefined ? String(limit) : undefined;
  const offsetStr = offset !== undefined ? String(offset) : undefined;
  
  const parsedLimit = limitStr !== undefined 
    ? Math.min(Math.max(Number.parseInt(limitStr, 10) || defaultLimit, 1), maxLimit)
    : defaultLimit;
  
  const parsedOffset = offsetStr !== undefined
    ? Math.max(Number.parseInt(offsetStr, 10) || 0, 0)
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

  // An id-shaped value is the id. Both formats count: 24-hex for rows that
  // predate the Postgres migration, uuid v7 for rows created after it. Matching
  // only the first sends every post-cutover account down the publicKey branch
  // below, where it misses and throws NotFound.
  if (isValidObjectId(trimmedUserId)) {
    return trimmedUserId;
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


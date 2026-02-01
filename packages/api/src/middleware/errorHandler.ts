/**
 * Global Error Handler Middleware
 *
 * Catches all errors and returns a consistent JSON response
 * using the ApiError format: { error, message, details? }
 */

import type { Request, Response, NextFunction } from 'express';
import { ApiError, InternalServerError } from '../utils/error';
import { logger } from '../utils/logger';

/**
 * Express error-handling middleware (must have 4 parameters).
 *
 * - ApiError instances are serialised directly via `toJSON()`.
 * - Unknown errors are wrapped in InternalServerError; the raw message
 *   is only exposed outside production.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    logger.error(`ApiError [${err.statusCode}] ${err.code}: ${err.message}`);
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Wrap unknown errors
  const message =
    process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err instanceof Error
        ? err.message
        : String(err);

  logger.error('Unhandled error:', err);

  const wrapped = new InternalServerError(message);
  res.status(wrapped.statusCode).json(wrapped.toJSON());
}

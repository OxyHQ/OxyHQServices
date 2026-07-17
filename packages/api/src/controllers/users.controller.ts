/**
 * Users Controller
 * 
 * Controller for user-related operations that require more complex logic
 * or don't fit into the standard service pattern.
 */

import type { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { logger } from '../utils/logger';
import { BadRequestError, InternalServerError } from '../utils/error';
import { sendSuccess } from '../utils/asyncHandler';
import { sanitizeSearchQuery } from '../utils/sanitize';
import { PUBLIC_USER_PROFILE_SELECT } from '../utils/publicUserProjection';

export class UsersController {
  /**
   * POST /users/search
   * 
   * Search for users by username or name
   * 
   * @body {string} query - Search query string
   * @returns {User[]} Array of matching users (max 5)
   */
  async searchUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { query } = req.body;

      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        throw new BadRequestError('Search query is required and must be a non-empty string');
      }

      // Strip a single leading `@` (and trim) BEFORE sanitizing so a handle-style
      // query matches the STORED username: an atproto handle
      // `@adamrbjack.bsky.social` finds `adamrbjack.bsky.social@bsky.social`, and
      // a Mastodon `@user@host` matches `user@host`. Only ONE leading `@` is
      // removed — a mid-string `@` (the `user@host` separator) is preserved.
      const strippedQuery = query.trim().replace(/^@/, '');

      // Sanitize search query (length limit + HTML escaping)
      const sanitizedQuery = sanitizeSearchQuery(strippedQuery);

      // Search for users where username or name matches the query.
      // Exclude archived accounts (dead federated actors marked gone via
      // POST /federation/actor-gone, plus archived org/project accounts) so
      // they never surface as 0-post ghost search hits. Only `archived` is
      // filtered — active accounts (the default) all still match.
      // Also exclude users in the punitive `restricted` reputation tier
      // (lifetime total < 0 OR abuseScore >= threshold). `reputationTier` is
      // absent until `recalculateBalance` first runs, and Mongo treats a missing
      // field as NOT equal to 'restricted', so untiered/new users still match —
      // only actively-restricted users are hidden.
      const users = await User.find({
        accountStatus: { $ne: 'archived' },
        reputationTier: { $ne: 'restricted' },
        $or: [
          { username: { $regex: sanitizedQuery, $options: 'i' } },
          { 'name.first': { $regex: sanitizedQuery, $options: 'i' } },
          { 'name.last': { $regex: sanitizedQuery, $options: 'i' } },
        ],
      })
        .select(PUBLIC_USER_PROFILE_SELECT)
        .limit(5)
        .lean();

      logger.debug('User search performed', {
        query: sanitizedQuery,
        resultsCount: users.length,
      });

      sendSuccess(res, users);
    } catch (error) {
      // Re-throw known errors
      if (error instanceof BadRequestError || error instanceof InternalServerError) {
        throw error;
      }

      // Log and wrap unexpected errors
      logger.error('Error in searchUsers:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new InternalServerError('Failed to search users');
    }
  }
}

export default new UsersController(); 
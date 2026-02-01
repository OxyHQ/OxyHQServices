/**
 * Users Controller
 * 
 * Controller for user-related operations that require more complex logic
 * or don't fit into the standard service pattern.
 */

import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { logger } from '../utils/logger';
import { BadRequestError, InternalServerError } from '../utils/error';
import { sendSuccess } from '../utils/asyncHandler';
import { sanitizeSearchQuery } from '../utils/sanitize';

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

      // Sanitize search query (length limit + HTML escaping)
      const sanitizedQuery = sanitizeSearchQuery(query);

      // Search for users where username or name matches the query
      const users = await User.find({
        $or: [
          { username: { $regex: sanitizedQuery, $options: 'i' } },
          { 'name.first': { $regex: sanitizedQuery, $options: 'i' } },
          { 'name.last': { $regex: sanitizedQuery, $options: 'i' } },
        ],
      })
        .select('username name avatar email description')
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
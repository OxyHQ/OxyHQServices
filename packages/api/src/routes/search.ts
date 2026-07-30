import express, { type Request, type Response } from "express";
import User from "../models/User";
import { logger } from '../utils/logger';
import { sanitizeSearchQuery } from '../utils/sanitize';
import {
  buildPeopleSearchNativeFirstStages,
  buildPeopleSearchOrClause,
  peopleSearchMongoMatch,
} from '../utils/profileQuery';
import { validate } from '../middleware/validate';
import { searchQuerySchema } from '../schemas/search.schemas';
import { PUBLIC_USER_PROFILE_SELECT } from '../utils/publicUserProjection';
import { formatUserResponse } from '../utils/userTransform';

const router = express.Router();

type ValidatedSearchQuery = {
  query?: string;
  type?: 'all' | 'users';
  page: number;
  limit: number;
};

router.get("/", validate({ query: searchQuerySchema }), async (req: Request, res: Response) => {
  try {
    const { query, type = "all", page, limit } = req.query as unknown as ValidatedSearchQuery;
    const skip = (page - 1) * limit;

    // Strip a single leading `@` before sanitizing so handle-style queries match
    // stored usernames (same rule as GET /profiles/search and POST /users/search).
    const stripped = ((query as string) || '').trim().replace(/^@/, '');
    const sanitized = sanitizeSearchQuery(stripped);
    const searchQuery = { $regex: sanitized, $options: "i" };

    const results: {
      users: NonNullable<ReturnType<typeof formatUserResponse>>[];
      pagination: { page: number; limit: number; hasMore: boolean };
    } = { users: [], pagination: { page, limit, hasMore: false } };

    if (type === "all" || type === "users") {
      const users = await User.aggregate([
        {
          $match: {
            ...peopleSearchMongoMatch,
            $or: buildPeopleSearchOrClause(searchQuery, { includeLocations: true }),
          },
        },
        ...buildPeopleSearchNativeFirstStages(),
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            password: 0,
            refreshToken: 0,
            _nativePriority: 0,
            _reputationRank: 0,
          },
        },
      ]);

      results.users = users
        .map((user) => formatUserResponse(user))
        .filter((user): user is NonNullable<typeof user> => user !== null);
      results.pagination.hasMore = users.length === limit;
    }

    res.json(results);
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({
      message: "Error performing search",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

export default router;

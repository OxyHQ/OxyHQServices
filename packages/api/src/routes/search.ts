import express, { Request, Response } from "express";
import User from "../models/User";
import { logger } from '../utils/logger';
import { sanitizeSearchQuery } from '../utils/sanitize';
import { validate } from '../middleware/validate';
import { searchQuerySchema } from '../schemas/search.schemas';

const router = express.Router();

router.get("/", validate({ query: searchQuerySchema }), async (req: Request, res: Response) => {
  try {
    const { query, type = "all" } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip = (page - 1) * limit;

    const sanitized = sanitizeSearchQuery((query as string) || '');
    const searchQuery = { $regex: sanitized, $options: "i" };

    const results: any = { users: [], pagination: { page, limit, hasMore: false } };

    if (type === "all" || type === "users") {
      const users = await User.find({
        $or: [
          { username: searchQuery },
          { 'name.first': searchQuery },
          { 'name.last': searchQuery },
          { description: searchQuery },
          { location: searchQuery }
        ]
      })
      .select('username name description avatar location')
      .skip(skip)
      .limit(limit);

      results.users = users.map(user => ({
        ...user.toObject(),
        name: user.name || { first: '', last: '' },
        description: user.description || '',
        avatar: user.avatar || ''
      }));
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
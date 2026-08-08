/**
 * The app store's public reads (`/store`).
 *
 * Unauthenticated on purpose: a storefront is what somebody looks at before
 * they have an account, and every row these endpoints return is already public
 * — a published listing, an application's name and icon, and reviews their
 * authors wrote to be read.
 *
 * Only `published` listings and `visible` reviews are served. A draft, a
 * rejected page and a hidden review are absent rather than marked, so no client
 * has to be trusted to filter them.
 */

import { Router, type Request, type Response } from 'express';
import { asyncHandler, sendPaginated, sendSuccess } from '../utils/asyncHandler';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimiter';
import { NotFoundError } from '../utils/error';
import { storeListingsQuery, storeReviewsQuery, storeSlugParams } from '../schemas/store.schemas';
import {
  getPublishedListing,
  listCategories,
  listPublishedListings,
  listReviews,
} from '../services/store.service';

const router = Router();

const WINDOW_1_MIN = 60 * 1000;

/**
 * Uniquely prefixed, per the shared-store rule: a limiter without its own
 * prefix shares a counter with every other one on the same Redis and halves
 * both budgets.
 */
const readLimiter = rateLimit({
  prefix: 'rl:store:read:',
  windowMs: WINDOW_1_MIN,
  max: 240,
});

/** GET /store/categories — the shelves, in curated order. */
router.get(
  '/categories',
  readLimiter,
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await listCategories());
  })
);

/** GET /store/apps — published listings, newest first, optionally one shelf. */
router.get(
  '/apps',
  readLimiter,
  validate({ query: storeListingsQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { category, limit, offset } = req.query as unknown as {
      category?: string;
      limit: number;
      offset: number;
    };
    const { items, total } = await listPublishedListings({ categorySlug: category, limit, offset });
    sendPaginated(res, items, total, limit, offset);
  })
);

/** GET /store/apps/:slug — one page, or 404 if it is not published. */
router.get(
  '/apps/:slug',
  readLimiter,
  validate({ params: storeSlugParams }),
  asyncHandler(async (req: Request, res: Response) => {
    const listing = await getPublishedListing(req.params.slug);
    // The same answer for "no such app" and "not published": whether a draft
    // exists is not something an unauthenticated caller gets to learn.
    if (!listing) throw new NotFoundError('App not found');
    sendSuccess(res, listing);
  })
);

/** GET /store/apps/:slug/reviews — visible reviews, with the publisher's reply. */
router.get(
  '/apps/:slug/reviews',
  readLimiter,
  validate({ params: storeSlugParams, query: storeReviewsQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { limit, offset, sort } = req.query as unknown as {
      limit: number;
      offset: number;
      sort: 'recent' | 'rating';
    };
    const result = await listReviews({ slug: req.params.slug, limit, offset, sort });
    if (!result) throw new NotFoundError('App not found');
    sendPaginated(res, result.items, result.total, limit, offset);
  })
);

export default router;

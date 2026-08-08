import { z } from 'zod';

/** A store URL segment: the listing's own `slug`, never an application id. */
export const storeSlugParams = z.object({
  slug: z.string().trim().min(1).max(120),
});

/**
 * GET /store/apps
 *
 * `category` is a category SLUG for the same reason the path carries a listing
 * slug: an id in a query string is an id in somebody's bookmark.
 */
export const storeListingsQuery = z.object({
  category: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /store/apps/:slug/reviews */
export const storeReviewsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  /** Newest first by default; `rating` surfaces the strongest opinions. */
  sort: z.enum(['recent', 'rating']).default('recent'),
});

/** How long a review may be. Generous — the limit is against abuse, not prose. */
const REVIEW_BODY_MAX = 5000;
const REVIEW_TITLE_MAX = 120;

/**
 * PUT /store/apps/:slug/review
 *
 * `rating` repeats the database's `between 1 and 5` on purpose: the CHECK is
 * what makes the bound true of the data, and this is what makes a bad request a
 * 400 rather than a 500 out of the driver.
 *
 * Title and body accept `null` as well as absent, because clearing a title you
 * once wrote has to be expressible — the two are stored the same way.
 */
export const storeReviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(REVIEW_TITLE_MAX).nullish(),
  body: z.string().trim().max(REVIEW_BODY_MAX).nullish(),
});

/** A review id in the path, for the publisher's reply. */
export const storeReviewParams = z.object({
  reviewId: z.string().trim().min(1).max(64),
});

/**
 * PUT /store/reviews/:reviewId/reply
 *
 * `min(1)` after the trim: a reply is the publisher speaking, so an empty one
 * is a delete, and `DELETE` is where that is spelled.
 */
export const storeReplyBody = z.object({
  body: z.string().trim().min(1).max(REVIEW_BODY_MAX),
});

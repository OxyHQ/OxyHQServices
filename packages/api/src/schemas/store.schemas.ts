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

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

/**
 * PUT /applications/:appId/listing
 *
 * A whole page, not a patch: the console edits one form, and a partial update
 * would make "clear the tagline" and "leave the tagline alone" the same
 * request.
 *
 * `status` is deliberately absent. Moving a page through review is a
 * transition with its own route and its own guard, so a publisher cannot
 * publish themselves by putting a field in a body.
 */
export const storeListingBody = z.object({
  /**
   * The public URL segment. Lowercase, digits and hyphens, because it is what
   * every link to the page carries and a slug that needs escaping is a slug
   * that will be copied wrong.
   */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single hyphens'),
  tagline: z.string().trim().max(160).nullish(),
  description: z.string().trim().max(20000).nullish(),
  /** A category SLUG, never its id: an id in a form is an id in a bug report. */
  categorySlug: z.string().trim().min(1).max(120).nullish(),
  supportUrl: z.string().trim().url().max(2048).nullish(),
  supportEmail: z.string().trim().email().max(320).nullish(),
});

/** GET /store/moderation/listings — the review queue. */
export const storeModerationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** An application id in the path, for the moderation decisions. */
export const storeModerationParams = z.object({
  applicationId: z.string().trim().min(1).max(64),
});

/**
 * The app store (`/store`).
 *
 * The reads are unauthenticated on purpose: a storefront is what somebody looks
 * at before they have an account, and every row they return is already public —
 * a published listing, an application's name and icon, and reviews their
 * authors wrote to be read.
 *
 * Only `published` listings and `visible` reviews are served. A draft, a
 * rejected page and a hidden review are absent rather than marked, so no client
 * has to be trusted to filter them.
 *
 * The writes carry their own `authMiddleware` and `csrfProtection` per route
 * rather than a mount-wide one, because this router serves both and a blanket
 * middleware would either lock the storefront or leave the writes open. Reading
 * a route here tells you what guards it.
 */

import { Router, type Request, type Response } from 'express';
import { asyncHandler, sendPaginated, sendSuccess } from '../utils/asyncHandler';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { requireStaff } from '../middleware/requireStaff';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimiter';
import { NotFoundError, UnauthorizedError } from '../utils/error';
import {
  storeListingsQuery,
  storeModerationParams,
  storeModerationQuery,
  storeReplyBody,
  storeReviewBody,
  storeReviewParams,
  storeReviewsQuery,
  storeSlugParams,
} from '../schemas/store.schemas';
import {
  approveListing,
  deleteOwnReview,
  deleteReply,
  getOwnReview,
  getPublishedListing,
  listCategories,
  listListingsAwaitingReview,
  listPublishedListings,
  listReviews,
  rejectListing,
  upsertReply,
  upsertReview,
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

/**
 * Writes are keyed on the ACCOUNT, not the IP: one review per app per person is
 * already a constraint, so the budget that matters is how fast one person can
 * churn reviews across apps — and an IP key would throttle a whole office
 * network to one reviewer.
 */
const writeLimiter = rateLimit({
  prefix: 'rl:store:write:',
  windowMs: WINDOW_1_MIN,
  max: 20,
  keyGenerator: (req) => (req as AuthRequest).user?._id?.toString() ?? req.ip ?? 'unknown',
});

function requireUserId(req: AuthRequest): string {
  const userId = req.user?._id?.toString();
  if (!userId) throw new UnauthorizedError('Authentication required');
  return userId;
}

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

// ============================================================================
// Writes
//
// Who may review: any signed-in Oxy account. Not `users.verified`, which is a
// standing badge an administrator sets — gating reviews on it would mean almost
// nobody could write one. Whether the reviewer has actually authorized the app
// is answered by `app_grants` and shown as `authorUsesApp` on the public list,
// which is the trust signal a reader wants and one nobody can award themselves.
// ============================================================================

/** GET /store/apps/:slug/review — the caller's own review, or null. */
router.get(
  '/apps/:slug/review',
  readLimiter,
  authMiddleware,
  validate({ params: storeSlugParams }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    sendSuccess(res, await getOwnReview({ slug: req.params.slug, userId: requireUserId(req) }));
  })
);

/**
 * PUT /store/apps/:slug/review — write or rewrite the caller's review.
 *
 * `PUT` because a person has one review of an app and this sets it. A `POST`
 * would promise a second resource on the second call, which the table's unique
 * constraint would then refuse.
 */
router.put(
  '/apps/:slug/review',
  writeLimiter,
  authMiddleware,
  csrfProtection,
  validate({ params: storeSlugParams, body: storeReviewBody }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { rating, title, body } = req.body as { rating: number; title?: string | null; body?: string | null };
    const review = await upsertReview({
      slug: req.params.slug,
      userId: requireUserId(req),
      rating,
      title,
      body,
    });
    sendSuccess(res, review);
  })
);

/** DELETE /store/apps/:slug/review — withdraw the caller's own review. */
router.delete(
  '/apps/:slug/review',
  writeLimiter,
  authMiddleware,
  csrfProtection,
  validate({ params: storeSlugParams }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await deleteOwnReview({ slug: req.params.slug, userId: requireUserId(req) });
    res.status(204).end();
  })
);

/**
 * PUT /store/reviews/:reviewId/reply — the publisher's answer.
 *
 * Addressed by review id rather than under the listing's slug: the reply
 * belongs to the review, which belongs to the application, and a listing can be
 * renamed or withdrawn out from under it.
 */
router.put(
  '/reviews/:reviewId/reply',
  writeLimiter,
  authMiddleware,
  csrfProtection,
  validate({ params: storeReviewParams, body: storeReplyBody }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const reply = await upsertReply({
      reviewId: req.params.reviewId,
      authorUserId: requireUserId(req),
      body: (req.body as { body: string }).body,
    });
    sendSuccess(res, reply);
  })
);

/** DELETE /store/reviews/:reviewId/reply — withdraw it. Same gate. */
router.delete(
  '/reviews/:reviewId/reply',
  writeLimiter,
  authMiddleware,
  csrfProtection,
  validate({ params: storeReviewParams }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await deleteReply({ reviewId: req.params.reviewId, authorUserId: requireUserId(req) });
    res.status(204).end();
  })
);

// ============================================================================
// Moderation
//
// Staff only. A publisher edits their page and hands it in — those routes hang
// off `/applications/:appId/listing`, beside the credentials and webhooks the
// same permission guards. Granting the review is the STORE's judgement, and a
// publisher who could grant it would make the queue decorative, so it lives
// here and behind `requireStaff`.
// ============================================================================

/** GET /store/moderation/listings — the queue, oldest submission first. */
router.get(
  '/moderation/listings',
  readLimiter,
  authMiddleware,
  requireStaff,
  validate({ query: storeModerationQuery }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { limit, offset } = req.query as unknown as { limit: number; offset: number };
    const { items, total } = await listListingsAwaitingReview({ limit, offset });
    sendPaginated(res, items, total, limit, offset);
  })
);

/** POST /store/moderation/listings/:applicationId/approve — publish it. */
router.post(
  '/moderation/listings/:applicationId/approve',
  writeLimiter,
  authMiddleware,
  requireStaff,
  csrfProtection,
  validate({ params: storeModerationParams }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    sendSuccess(res, await approveListing(req.params.applicationId));
  })
);

/** POST /store/moderation/listings/:applicationId/reject — send it back. */
router.post(
  '/moderation/listings/:applicationId/reject',
  writeLimiter,
  authMiddleware,
  requireStaff,
  csrfProtection,
  validate({ params: storeModerationParams }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    sendSuccess(res, await rejectListing(req.params.applicationId));
  })
);

export default router;

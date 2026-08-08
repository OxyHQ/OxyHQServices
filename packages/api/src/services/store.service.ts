/**
 * The app store's reads.
 *
 * Every query here joins a listing to the `applications` row it decorates,
 * because the store owns the page and the platform owns the app: the name, the
 * icon and the legal links come from the application, and the shelf, the copy
 * and the pictures from the listing. Nothing is duplicated between them, so
 * nothing can disagree.
 *
 * ## The rating is computed
 *
 * There is no stored average or count — see `db/schema/appListings.ts` for why.
 * These queries aggregate `app_reviews` on the index that exists for it
 * (`application_id, status, created_at`), filtered to `visible`, so a hidden
 * review stops counting the moment it is hidden rather than when some counter
 * is next repaired.
 */

import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../config/postgres';
import { appCategories } from '../db/schema/appCategories';
import { appGrants } from '../db/schema/appGrants';
import { appListingScreenshots } from '../db/schema/appListingScreenshots';
import { appListings } from '../db/schema/appListings';
import { appReviewReplies } from '../db/schema/appReviewReplies';
import { appReviews, type AppReviewStatus } from '../db/schema/appReviews';
import { applications } from '../db/schema/applications';
import { users } from '../db/schema/users';
import { accountService } from './account.service';
import { appPermissionsForAccountRole } from '../utils/accountRoles';
import { ForbiddenError, NotFoundError } from '../utils/error';

/** What a card needs, and nothing more. */
export interface StoreListingSummary {
  slug: string;
  name: string;
  tagline: string | null;
  icon: string | null;
  category: { slug: string; label: string } | null;
  rating: { average: number | null; count: number };
}

export interface StoreListingDetail extends StoreListingSummary {
  description: string | null;
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  supportUrl: string | null;
  supportEmail: string | null;
  publishedAt: Date | null;
  screenshots: { id: string; fileId: string; platform: string; caption: string | null }[];
  /** 1..5 → how many visible reviews gave it. Absent keys are zero. */
  ratingBreakdown: Record<number, number>;
}

/**
 * Ratings for a set of applications, in ONE query.
 *
 * A per-listing aggregate would be a query per card, which is the shape that
 * turns a 24-item page into 25 round trips. `inArray` over the same index the
 * reviews list uses answers all of them at once.
 */
async function ratingsFor(applicationIds: string[]): Promise<Map<string, { average: number | null; count: number }>> {
  if (applicationIds.length === 0) return new Map();

  const rows = await getDb()
    .select({
      applicationId: appReviews.applicationId,
      average: sql<string>`avg(${appReviews.rating})`,
      total: count(),
    })
    .from(appReviews)
    .where(and(inArray(appReviews.applicationId, applicationIds), eq(appReviews.status, 'visible')))
    .groupBy(appReviews.applicationId);

  return new Map(
    rows.map((row) => [
      row.applicationId,
      // `avg` comes back as a numeric string; rounding here rather than in the
      // client keeps every surface showing the same 4.6.
      { average: row.average === null ? null : Math.round(Number(row.average) * 10) / 10, count: Number(row.total) },
    ])
  );
}

/** Published listings, newest first, optionally on one shelf. */
export async function listPublishedListings(options: {
  categorySlug?: string;
  limit: number;
  offset: number;
}): Promise<{ items: StoreListingSummary[]; total: number }> {
  const db = getDb();
  const filters = [eq(appListings.status, 'published')];

  if (options.categorySlug) {
    const [category] = await db
      .select({ id: appCategories.id })
      .from(appCategories)
      .where(eq(appCategories.slug, options.categorySlug))
      .limit(1);
    // An unknown shelf is an empty shelf, not every app on the store.
    if (!category) return { items: [], total: 0 };
    filters.push(eq(appListings.categoryId, category.id));
  }

  const where = and(...filters);

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        applicationId: appListings.applicationId,
        slug: appListings.slug,
        tagline: appListings.tagline,
        name: applications.name,
        icon: applications.icon,
        categorySlug: appCategories.slug,
        categoryLabel: appCategories.label,
      })
      .from(appListings)
      .innerJoin(applications, eq(applications.id, appListings.applicationId))
      .leftJoin(appCategories, eq(appCategories.id, appListings.categoryId))
      .where(where)
      .orderBy(desc(appListings.publishedAt), asc(appListings.id))
      .limit(options.limit)
      .offset(options.offset),
    db.select({ value: count() }).from(appListings).where(where),
  ]);

  const ratings = await ratingsFor(rows.map((row) => row.applicationId));

  return {
    items: rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      tagline: row.tagline,
      icon: row.icon,
      category: row.categorySlug ? { slug: row.categorySlug, label: row.categoryLabel! } : null,
      rating: ratings.get(row.applicationId) ?? { average: null, count: 0 },
    })),
    total: Number(totals?.value ?? 0),
  };
}

/** One page. Returns null when the slug is unknown or the listing is not published. */
export async function getPublishedListing(slug: string): Promise<StoreListingDetail | null> {
  const db = getDb();

  const [row] = await db
    .select({
      id: appListings.id,
      applicationId: appListings.applicationId,
      slug: appListings.slug,
      tagline: appListings.tagline,
      description: appListings.description,
      supportUrl: appListings.supportUrl,
      supportEmail: appListings.supportEmail,
      publishedAt: appListings.publishedAt,
      name: applications.name,
      icon: applications.icon,
      websiteUrl: applications.websiteUrl,
      privacyPolicyUrl: applications.privacyPolicyUrl,
      termsUrl: applications.termsUrl,
      categorySlug: appCategories.slug,
      categoryLabel: appCategories.label,
    })
    .from(appListings)
    .innerJoin(applications, eq(applications.id, appListings.applicationId))
    .leftJoin(appCategories, eq(appCategories.id, appListings.categoryId))
    .where(and(eq(appListings.slug, slug), eq(appListings.status, 'published')))
    .limit(1);

  if (!row) return null;

  const [screenshots, breakdown, ratings] = await Promise.all([
    db
      .select({
        id: appListingScreenshots.id,
        fileId: appListingScreenshots.fileId,
        platform: appListingScreenshots.platform,
        caption: appListingScreenshots.caption,
      })
      .from(appListingScreenshots)
      .where(eq(appListingScreenshots.listingId, row.id))
      .orderBy(asc(appListingScreenshots.position), asc(appListingScreenshots.id)),
    db
      .select({ rating: appReviews.rating, total: count() })
      .from(appReviews)
      .where(and(eq(appReviews.applicationId, row.applicationId), eq(appReviews.status, 'visible')))
      .groupBy(appReviews.rating),
    ratingsFor([row.applicationId]),
  ]);

  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    icon: row.icon,
    websiteUrl: row.websiteUrl,
    privacyPolicyUrl: row.privacyPolicyUrl,
    termsUrl: row.termsUrl,
    supportUrl: row.supportUrl,
    supportEmail: row.supportEmail,
    publishedAt: row.publishedAt,
    category: row.categorySlug ? { slug: row.categorySlug, label: row.categoryLabel! } : null,
    rating: ratings.get(row.applicationId) ?? { average: null, count: 0 },
    ratingBreakdown: Object.fromEntries(breakdown.map((entry) => [entry.rating, Number(entry.total)])),
    screenshots,
  };
}

export interface StoreReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: Date;
  author: { id: string; username: string | null };
  reply: { body: string; createdAt: Date } | null;
  /**
   * Whether this author has ever authorized the application — read from
   * `app_grants` at request time rather than stored on the review, which is the
   * whole reason `app_reviews` carries no such column: a flag written at insert
   * would be true then and wrong from the next revocation onwards.
   *
   * It is not a claim that they still use it, and it is false for a first-party
   * app nobody has to consent to, so a client should render its absence as
   * nothing at all rather than as a demotion.
   */
  authorUsesApp: boolean;
}

/**
 * Visible reviews for a published listing.
 *
 * Replies are fetched for the page's reviews in one query rather than joined,
 * because most reviews have none and a LEFT JOIN would carry the reply columns
 * on every row to say so.
 */
export async function listReviews(options: {
  slug: string;
  limit: number;
  offset: number;
  sort: 'recent' | 'rating';
}): Promise<{ items: StoreReview[]; total: number } | null> {
  const db = getDb();

  const [listing] = await db
    .select({ applicationId: appListings.applicationId })
    .from(appListings)
    .where(and(eq(appListings.slug, options.slug), eq(appListings.status, 'published')))
    .limit(1);

  if (!listing) return null;

  const where = and(eq(appReviews.applicationId, listing.applicationId), eq(appReviews.status, 'visible'));
  const order =
    options.sort === 'rating'
      ? [desc(appReviews.rating), desc(appReviews.createdAt), asc(appReviews.id)]
      : [desc(appReviews.createdAt), asc(appReviews.id)];

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: appReviews.id,
        rating: appReviews.rating,
        title: appReviews.title,
        body: appReviews.body,
        createdAt: appReviews.createdAt,
        authorId: users.id,
        authorUsername: users.username,
      })
      .from(appReviews)
      .innerJoin(users, eq(users.id, appReviews.userId))
      .where(where)
      .orderBy(...order)
      .limit(options.limit)
      .offset(options.offset),
    db.select({ value: count() }).from(appReviews).where(where),
  ]);

  // Both are per-PAGE lookups keyed on the rows just read, so neither grows
  // with the number of reviews the app has.
  const [replies, grants] = rows.length
    ? await Promise.all([
        db
          .select({
            reviewId: appReviewReplies.reviewId,
            body: appReviewReplies.body,
            createdAt: appReviewReplies.createdAt,
          })
          .from(appReviewReplies)
          .where(inArray(appReviewReplies.reviewId, rows.map((row) => row.id))),
        db
          .select({ userId: appGrants.userId })
          .from(appGrants)
          .where(
            and(
              eq(appGrants.applicationId, listing.applicationId),
              inArray(appGrants.userId, rows.map((row) => row.authorId))
            )
          ),
      ])
    : [[], []];

  const replyByReview = new Map(replies.map((reply) => [reply.reviewId, reply]));
  const authorsWithGrant = new Set(grants.map((grant) => grant.userId));

  return {
    items: rows.map((row) => {
      const reply = replyByReview.get(row.id);
      return {
        id: row.id,
        rating: row.rating,
        title: row.title,
        body: row.body,
        createdAt: row.createdAt,
        author: { id: row.authorId, username: row.authorUsername },
        reply: reply ? { body: reply.body, createdAt: reply.createdAt } : null,
        authorUsesApp: authorsWithGrant.has(row.authorId),
      };
    }),
    total: Number(totals?.value ?? 0),
  };
}

/** The shelves, in their curated order. */
export async function listCategories(): Promise<{ slug: string; label: string; description: string | null }[]> {
  return getDb()
    .select({ slug: appCategories.slug, label: appCategories.label, description: appCategories.description })
    .from(appCategories)
    .orderBy(asc(appCategories.order), asc(appCategories.id));
}

// ============================================================================
// Writes
//
// The reads above answer `null` because "this slug is not a published listing"
// is the only way they fail. A write has several distinct outcomes — no such
// page, nothing of yours to delete, not yours to answer — and one sentinel
// cannot say which, so these throw the error that names the outcome and the
// routes stay free of translation.
// ============================================================================

/** A review as its own author sees it, whatever its moderation state. */
export interface StoreOwnReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  /** Its own author is told when their review is hidden; the public list is not. */
  status: AppReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** The columns an author is served for their own review. */
const OWN_REVIEW_COLUMNS = {
  id: appReviews.id,
  rating: appReviews.rating,
  title: appReviews.title,
  body: appReviews.body,
  status: appReviews.status,
  createdAt: appReviews.createdAt,
  updatedAt: appReviews.updatedAt,
} as const;

/** The application behind a published listing, or a 404. */
async function requirePublishedApplicationId(slug: string): Promise<string> {
  const [listing] = await getDb()
    .select({ applicationId: appListings.applicationId })
    .from(appListings)
    .where(and(eq(appListings.slug, slug), eq(appListings.status, 'published')))
    .limit(1);
  // The same answer a read gives: whether an unpublished page exists under this
  // slug is not something a write attempt gets to reveal either.
  if (!listing) throw new NotFoundError('App not found');
  return listing.applicationId;
}

/**
 * Write the caller's review of an app, creating it or replacing what they said
 * before.
 *
 * One statement, because `unique(application_id, user_id)` is what actually
 * enforces one-review-per-person: a read-then-insert passes its own check
 * twice under concurrency and the second insert is the one that raises. The
 * conflict clause turns that race into the edit the person asked for.
 *
 * Editing does NOT reset moderation — a hidden review stays hidden when its
 * author rewrites it, or hiding one would be undone by whoever wrote it.
 */
export async function upsertReview(options: {
  slug: string;
  userId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
}): Promise<StoreOwnReview> {
  const applicationId = await requirePublishedApplicationId(options.slug);

  // Absent stays absent and blank becomes absent: an empty string is a value,
  // and `app_reviews` keeps "wrote no title" as NULL rather than as `''`.
  const title = options.title?.trim() || null;
  const body = options.body?.trim() || null;

  const [row] = await getDb()
    .insert(appReviews)
    .values({ applicationId, userId: options.userId, rating: options.rating, title, body })
    .onConflictDoUpdate({
      target: [appReviews.applicationId, appReviews.userId],
      set: { rating: options.rating, title, body, updatedAt: new Date() },
    })
    .returning(OWN_REVIEW_COLUMNS);

  return row;
}

/** The caller's own review of an app, or null if they have not written one. */
export async function getOwnReview(options: {
  slug: string;
  userId: string;
}): Promise<StoreOwnReview | null> {
  const applicationId = await requirePublishedApplicationId(options.slug);

  const [row] = await getDb()
    .select(OWN_REVIEW_COLUMNS)
    .from(appReviews)
    .where(and(eq(appReviews.applicationId, applicationId), eq(appReviews.userId, options.userId)))
    .limit(1);

  return row ?? null;
}

/**
 * Withdraw the caller's own review.
 *
 * A real delete, not a status change: `removed` is a moderator's verdict about
 * someone's words, and an author taking their own words back is not that.
 */
export async function deleteOwnReview(options: { slug: string; userId: string }): Promise<void> {
  const applicationId = await requirePublishedApplicationId(options.slug);

  const deleted = await getDb()
    .delete(appReviews)
    .where(and(eq(appReviews.applicationId, applicationId), eq(appReviews.userId, options.userId)))
    .returning({ id: appReviews.id });

  if (deleted.length === 0) throw new NotFoundError('You have not reviewed this app');
}

/**
 * Authorise `userId` to answer `reviewId` on the publisher's behalf.
 *
 * The right to reply is not a store concept: it is `app:update` over the
 * application's owning account, resolved through the same
 * `AccountMember` graph — with inheritance, per-member revokes and all — that
 * governs every other write to that application. So a store listing cannot
 * become a second, weaker way to act as somebody's app.
 */
async function requirePublisherAccess(reviewId: string, userId: string): Promise<void> {
  const [review] = await getDb()
    .select({ ownerAccountId: applications.ownerAccountId })
    .from(appReviews)
    .innerJoin(applications, eq(applications.id, appReviews.applicationId))
    .where(eq(appReviews.id, reviewId))
    .limit(1);

  if (!review) throw new NotFoundError('Review not found');

  const access = await accountService.resolveEffectiveAccess(userId, review.ownerAccountId);
  if (!access || !appPermissionsForAccountRole(access.role).includes('app:update')) {
    throw new ForbiddenError('You cannot reply on behalf of this app');
  }
}

export interface StoreReply {
  id: string;
  reviewId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Post or rewrite the publisher's answer to a review.
 *
 * `unique(review_id)` is why this is an upsert rather than an insert: one
 * answer per review is the shape the table declares, and two people holding
 * `app:update` pressing reply at once must not produce two.
 *
 * `author_user_id` is overwritten with whoever wrote the current text, because
 * attribution that survived an edit by a colleague would name the wrong person.
 */
export async function upsertReply(options: {
  reviewId: string;
  authorUserId: string;
  body: string;
}): Promise<StoreReply> {
  await requirePublisherAccess(options.reviewId, options.authorUserId);

  const [row] = await getDb()
    .insert(appReviewReplies)
    .values({ reviewId: options.reviewId, authorUserId: options.authorUserId, body: options.body })
    .onConflictDoUpdate({
      target: appReviewReplies.reviewId,
      set: { body: options.body, authorUserId: options.authorUserId, updatedAt: new Date() },
    })
    .returning({
      id: appReviewReplies.id,
      reviewId: appReviewReplies.reviewId,
      body: appReviewReplies.body,
      createdAt: appReviewReplies.createdAt,
      updatedAt: appReviewReplies.updatedAt,
    });

  return row;
}

/** Withdraw the publisher's answer. Same gate as writing it. */
export async function deleteReply(options: {
  reviewId: string;
  authorUserId: string;
}): Promise<void> {
  await requirePublisherAccess(options.reviewId, options.authorUserId);

  const deleted = await getDb()
    .delete(appReviewReplies)
    .where(eq(appReviewReplies.reviewId, options.reviewId))
    .returning({ id: appReviewReplies.id });

  if (deleted.length === 0) throw new NotFoundError('This review has no reply');
}

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
import { appListingScreenshots } from '../db/schema/appListingScreenshots';
import { appListings } from '../db/schema/appListings';
import { appReviewReplies } from '../db/schema/appReviewReplies';
import { appReviews } from '../db/schema/appReviews';
import { applications } from '../db/schema/applications';
import { users } from '../db/schema/users';

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

  const replies = rows.length
    ? await db
        .select({
          reviewId: appReviewReplies.reviewId,
          body: appReviewReplies.body,
          createdAt: appReviewReplies.createdAt,
        })
        .from(appReviewReplies)
        .where(inArray(appReviewReplies.reviewId, rows.map((row) => row.id)))
    : [];
  const replyByReview = new Map(replies.map((reply) => [reply.reviewId, reply]));

  return {
    items: rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt,
      author: { id: row.authorId, username: row.authorUsername },
      reply: replyByReview.get(row.id)
        ? { body: replyByReview.get(row.id)!.body, createdAt: replyByReview.get(row.id)!.createdAt }
        : null,
    })),
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

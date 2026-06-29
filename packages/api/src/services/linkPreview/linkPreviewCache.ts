import { createHash } from 'node:crypto';
import type { LinkPreview } from '@oxyhq/contracts';
import { getRedisClient } from '../../config/redis';
import { logger } from '../../utils/logger';
import {
  LINK_PREVIEW_HOT_TTL_SECONDS,
  LINK_PREVIEW_LOCK_TTL_SECONDS,
  LINK_PREVIEW_NEG_TTL_SECONDS,
  LINK_PREVIEW_READ_BUDGET_MS,
} from './constants';

/**
 * Redis (Valkey) hot cache + negative cache + single-flight lock for the
 * link-preview service. Mirrors Mention's `linkPreviewCache` / `negativeCache`:
 *
 *  - Uses the shared {@link getRedisClient} singleton — never opens a socket.
 *  - Degrades to a NO-OP whenever Redis is unavailable (`REDIS_URL` unset or the
 *    server is down): reads miss, writes are dropped, the lock is granted. Mongo
 *    remains the durable source of truth, so the service still works without
 *    Redis (just without the hot-path short-circuit).
 *  - Stores already-SERIALIZED client DTOs, so a value read back is safe to
 *    return verbatim (it can never contain a server-only origin URL).
 */

/** Positive entry (serialized `LinkPreview` DTO). */
const HOT_PREFIX = 'linkpreview:meta:';
/** Negative marker (URL resolved to no usable preview / failed). */
const NEG_PREFIX = 'linkpreview:neg:';
/** Single-flight resolve lock. */
const LOCK_PREFIX = 'linkpreview:lock:';

/** SHA-256 the URL so the key length is bounded and a raw URL is not stored verbatim. */
function keyFor(prefix: string, url: string): string {
  return `${prefix}${createHash('sha256').update(url).digest('hex')}`;
}

/** A connected, ready ioredis client, or `null` when Redis is unavailable. */
function readyClient(): ReturnType<typeof getRedisClient> {
  const redis = getRedisClient();
  if (!redis || redis.status !== 'ready') return null;
  return redis;
}

/**
 * Whether a resolved preview is worth caching as a POSITIVE entry (ported from
 * Mention). A preview with no image, no description, and a title that is just
 * the raw URL / bare hostname is NOT a usable preview — it renders as a bare
 * link yet would stick for the full positive TTL, blocking re-resolution. Such
 * hollow results are marked NEGATIVE (short TTL → auto-recovers) instead.
 */
export function isUsablePreview(p: {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
}): boolean {
  if (p.image && p.image.trim().length > 0) return true;
  if (p.description && p.description.trim().length > 0) return true;

  const title = p.title?.trim();
  if (!title) return false;

  // A title that is itself a URL (or starts like one) is not a usable preview.
  if (/^(https?:\/\/|www\.)/i.test(title)) return false;

  // A title equal to the URL's host is the hostname fallback, not real metadata.
  if (p.url) {
    try {
      const host = new URL(p.url).hostname.toLowerCase();
      const titleLower = title.toLowerCase();
      if (titleLower === host || titleLower === host.replace(/^www\./, '')) {
        return false;
      }
    } catch {
      // Unparseable url — the title is non-URL text, so treat it as usable.
    }
  }

  return true;
}

/**
 * Read a single cached preview:
 *  - a `LinkPreview` on a positive hit,
 *  - `'negative'` when the URL is known to have no usable preview,
 *  - `null` on a miss (caller should warm in the background).
 */
async function getHotPreview(url: string): Promise<LinkPreview | 'negative' | null> {
  const redis = readyClient();
  if (!redis) return null;
  try {
    const [hit, neg] = await Promise.all([
      redis.get(keyFor(HOT_PREFIX, url)),
      redis.exists(keyFor(NEG_PREFIX, url)),
    ]);
    if (hit) {
      try {
        return JSON.parse(hit) as LinkPreview;
      } catch {
        return null; // corrupt → re-warm
      }
    }
    if (neg === 1) return 'negative';
    return null;
  } catch (error) {
    logger.debug('[linkPreviewCache] hot read failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Read a single URL's cached preview (exposed for the single-URL GET path). */
export async function readHotPreview(url: string): Promise<LinkPreview | 'negative' | null> {
  return getHotPreview(url);
}

/**
 * Batch-read previews for many URLs under one hard time budget.
 *
 * Returns:
 *  - `previews`: URL → DTO for positive hits AND for negatives (negatives map to
 *    a `status:'empty'` DTO so the batch always answers every URL without
 *    re-warming a known-dead URL),
 *  - `misses`: URLs that are true cache MISSES — the caller resolves these from
 *    Mongo and/or warms them.
 */
export async function readHotPreviews(
  urls: string[],
): Promise<{ previews: Map<string, LinkPreview>; misses: string[] }> {
  const previews = new Map<string, LinkPreview>();
  const misses: string[] = [];
  if (urls.length === 0) return { previews, misses };

  const deadline = Date.now() + LINK_PREVIEW_READ_BUDGET_MS;

  await Promise.all(
    urls.map(async (url) => {
      if (Date.now() >= deadline) {
        misses.push(url);
        return;
      }
      const cached = await getHotPreview(url);
      if (cached === 'negative') {
        previews.set(url, { url, status: 'empty' });
        return;
      }
      if (cached) {
        previews.set(url, cached);
      } else {
        misses.push(url);
      }
    }),
  );

  return { previews, misses };
}

/** Store a resolved preview DTO with the hot TTL. A failure is a logged no-op. */
export async function storeHotPreview(url: string, preview: LinkPreview): Promise<void> {
  const redis = readyClient();
  if (!redis) return;
  try {
    await redis.set(
      keyFor(HOT_PREFIX, url),
      JSON.stringify(preview),
      'EX',
      LINK_PREVIEW_HOT_TTL_SECONDS,
    );
  } catch (error) {
    logger.debug('[linkPreviewCache] hot store failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Record that a URL has no usable preview / failed to resolve. Logged no-op on failure. */
export async function markNegative(url: string): Promise<void> {
  const redis = readyClient();
  if (!redis) return;
  try {
    await redis.set(keyFor(NEG_PREFIX, url), '1', 'EX', LINK_PREVIEW_NEG_TTL_SECONDS);
  } catch (error) {
    logger.debug('[linkPreviewCache] negative marker write failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Acquire the single-flight resolve lock for a URL. Returns `true` when this
 * caller may proceed to resolve, `false` when another caller already holds it.
 * Without Redis the lock is always granted (the in-process warm queue's pending
 * set provides dedup in that mode).
 */
export async function acquireResolveLock(url: string): Promise<boolean> {
  const redis = readyClient();
  if (!redis) return true;
  try {
    const result = await redis.set(
      keyFor(LOCK_PREFIX, url),
      '1',
      'EX',
      LINK_PREVIEW_LOCK_TTL_SECONDS,
      'NX',
    );
    return result === 'OK';
  } catch (error) {
    logger.debug('[linkPreviewCache] lock acquire failed; proceeding', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/** Release the single-flight resolve lock. Logged no-op on failure. */
export async function releaseResolveLock(url: string): Promise<void> {
  const redis = readyClient();
  if (!redis) return;
  try {
    await redis.del(keyFor(LOCK_PREFIX, url));
  } catch (error) {
    logger.debug('[linkPreviewCache] lock release failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

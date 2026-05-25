/**
 * Login Lockout Service
 *
 * Tracks per-account failed authentication attempts and applies a sliding-
 * window lockout after a configurable threshold. Used to mitigate credential-
 * stuffing and online password-guessing attacks (H7).
 *
 * Backed by Redis when available (so the limit holds across API instances)
 * and falls back to an in-memory Map keyed by `(scope, identifier)` otherwise.
 *
 * Important: callers must NOT leak the lockout state to unauthenticated
 * callers. Always return the same generic credential error and set
 * `Retry-After` only when known to be lockout-induced.
 */

import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_SECONDS = 15 * 60; // 15 minutes
const REDIS_KEY_PREFIX = 'login_lockout:';

interface InMemoryBucket {
  count: number;
  /** Epoch ms after which the bucket resets. */
  resetAt: number;
}

const inMemoryBuckets = new Map<string, InMemoryBucket>();

/** Periodic sweep of expired in-memory buckets to bound memory usage. */
const SWEEP_INTERVAL_MS = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of inMemoryBuckets) {
    if (bucket.resetAt <= now) {
      inMemoryBuckets.delete(key);
    }
  }
}, SWEEP_INTERVAL_MS).unref();

export interface LockoutCheck {
  /** True if the caller is currently locked out. */
  locked: boolean;
  /** Seconds until the next attempt is allowed (only set when `locked`). */
  retryAfterSeconds?: number;
  /** Current failure count for telemetry. */
  attempts: number;
}

export interface LockoutOptions {
  /** Logical scope (e.g. `login`, `2fa-login`). Used to namespace counters. */
  scope: string;
  /** Per-identifier (username, userId, etc.) — case-insensitive. */
  identifier: string;
  /** Max attempts within the window before locking (default: 5). */
  maxAttempts?: number;
  /** Window length in seconds (default: 900 = 15min). */
  windowSeconds?: number;
}

function buildKey(scope: string, identifier: string): string {
  return `${REDIS_KEY_PREFIX}${scope}:${identifier.toLowerCase()}`;
}

/**
 * Check whether the given (scope, identifier) is currently locked out.
 * Performs no mutation; safe to call before doing the credential check.
 */
export async function isLockedOut(options: LockoutOptions): Promise<LockoutCheck> {
  const max = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const key = buildKey(options.scope, options.identifier);

  const redis = getRedisClient();
  if (redis) {
    try {
      const [countStr, ttlSec] = await Promise.all([redis.get(key), redis.ttl(key)]);
      const count = countStr ? parseInt(countStr, 10) : 0;
      if (count >= max) {
        const retryAfter = ttlSec > 0 ? ttlSec : windowSeconds;
        return { locked: true, retryAfterSeconds: retryAfter, attempts: count };
      }
      return { locked: false, attempts: count };
    } catch (error) {
      logger.warn('[LoginLockout] Redis read failed, falling back to memory', {
        error: error instanceof Error ? error.message : String(error),
        scope: options.scope,
      });
      // Fall through to in-memory path
    }
  }

  const now = Date.now();
  const bucket = inMemoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    return { locked: false, attempts: 0 };
  }
  if (bucket.count >= max) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
      attempts: bucket.count,
    };
  }
  return { locked: false, attempts: bucket.count };
}

/**
 * Record a failed authentication attempt. Returns the post-increment state
 * so the caller can immediately react if the threshold was reached.
 */
export async function recordFailure(options: LockoutOptions): Promise<LockoutCheck> {
  const max = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const key = buildKey(options.scope, options.identifier);

  const redis = getRedisClient();
  if (redis) {
    try {
      // INCR then EXPIRE atomically via pipeline. Only set TTL when this is
      // the first increment in the window so further failures don't extend it.
      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, windowSeconds, 'NX');
      const results = await pipeline.exec();

      if (!results || results.length < 1) {
        throw new Error('Redis pipeline returned no results');
      }
      const [incrErr, incrValue] = results[0];
      if (incrErr) {
        throw incrErr;
      }
      const count = typeof incrValue === 'number'
        ? incrValue
        : parseInt(String(incrValue ?? '0'), 10);

      if (count >= max) {
        const ttlSec = await redis.ttl(key);
        return {
          locked: true,
          retryAfterSeconds: ttlSec > 0 ? ttlSec : windowSeconds,
          attempts: count,
        };
      }
      return { locked: false, attempts: count };
    } catch (error) {
      logger.warn('[LoginLockout] Redis write failed, falling back to memory', {
        error: error instanceof Error ? error.message : String(error),
        scope: options.scope,
      });
      // Fall through to in-memory path
    }
  }

  const now = Date.now();
  const existing = inMemoryBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const fresh: InMemoryBucket = {
      count: 1,
      resetAt: now + windowSeconds * 1000,
    };
    inMemoryBuckets.set(key, fresh);
    return { locked: false, attempts: fresh.count };
  }

  existing.count += 1;
  if (existing.count >= max) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
      attempts: existing.count,
    };
  }
  return { locked: false, attempts: existing.count };
}

/**
 * Reset the failure counter after a successful authentication. Required so
 * a user who eventually authenticates correctly is not stuck behind a
 * lingering lockout window.
 */
export async function clearFailures(options: Pick<LockoutOptions, 'scope' | 'identifier'>): Promise<void> {
  const key = buildKey(options.scope, options.identifier);

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(key);
      return;
    } catch (error) {
      logger.warn('[LoginLockout] Redis delete failed, falling back to memory', {
        error: error instanceof Error ? error.message : String(error),
        scope: options.scope,
      });
    }
  }

  inMemoryBuckets.delete(key);
}

/** Test-only helper to wipe in-memory state between specs. */
export function _resetInMemoryStateForTests(): void {
  inMemoryBuckets.clear();
}

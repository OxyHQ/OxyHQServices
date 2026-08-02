import type { OxyUserChangeReason } from '@oxyhq/contracts';
import { publishOxyUserInvalidation } from '@oxyhq/core/server';

import { getRedisClient } from '../config/redis';
import type { IUser } from '../models/User';
import { logger } from './logger';

const DEFAULT_TTL = 5 * 60; // 5 minutes in seconds
const MAX_LOCAL_SIZE = 10000;
const LOG_COMPONENT = 'UserCache';

class UserCache {
  private local: Map<string, { user: IUser; timestamp: number; ttl: number }> = new Map();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupLocal(), 60_000);
    this.cleanupTimer.unref?.();
  }

  get(userId: string): IUser | null {
    if (!userId) return null;

    const local = this.getLocal(userId);
    if (local) return local;

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      // Warm-fill from Redis is best-effort and runs in the background.
      // We never let a Redis hiccup (network blip, corrupt blob) escape
      // into the unhandled-rejection sink — both the I/O step and the
      // JSON parse step are guarded independently so a malformed cache
      // entry doesn't poison the local map.
      redis.get(`user:${userId}`).then(data => {
        if (!data) return;
        let parsed: IUser | null = null;
        try {
          parsed = JSON.parse(data) as IUser;
        } catch (parseError) {
          logger.warn('userCache: failed to parse Redis blob; skipping warm-fill', {
            component: LOG_COMPONENT,
            userId,
            err: parseError instanceof Error ? parseError.message : String(parseError),
          });
          return;
        }
        if (parsed) {
          this.setLocal(userId, parsed);
        }
      }).catch((err) => {
        logger.warn('userCache: Redis warm-fill failed', {
          component: LOG_COMPONENT,
          userId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return null;
  }

  set(userId: string, user: IUser, ttl?: number): void {
    if (!userId || !user) return;
    const ttlSec = ttl ? Math.ceil(ttl / 1000) : DEFAULT_TTL;
    this.setLocal(userId, user, ttl);

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      redis.setex(`user:${userId}`, ttlSec, JSON.stringify(user)).catch((err) => {
        logger.warn('userCache: Redis setex failed', {
          component: LOG_COMPONENT,
          userId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /**
   * Drop this user from the local map and from Redis, and — when the change is
   * one consumers care about — broadcast it so every other Oxy backend can drop
   * its own copy instead of waiting out a TTL.
   *
   * This method is the chokepoint the whole ecosystem's identity freshness hangs
   * off, and it got that job by already having it: every route that mutates user
   * state already calls it, and the house rule already requires new ones to. A
   * second "and also notify" call at each of those ~25 sites would be one more
   * thing to forget, which is exactly how the staleness this fixes came about.
   *
   * @param userId - The user whose cached record is now wrong.
   * @param reason - What kind of change this was. DEFAULTS to `'profile'`, the
   *   broadcast-worthy one, so a caller that does not classify itself
   *   over-broadcasts (a wasted eviction) rather than under-broadcasts (stale
   *   identity nobody can see is stale). Only high-frequency, non-identity
   *   churn should opt down to `'graph'`.
   */
  invalidate(userId: string, reason: OxyUserChangeReason = 'profile'): void {
    if (!userId) return;
    this.local.delete(userId);

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      redis.del(`user:${userId}`).catch((err) => {
        logger.warn('userCache: Redis del failed', {
          component: LOG_COMPONENT,
          userId,
          err: err instanceof Error ? err.message : String(err),
        });
      });

      // Fire-and-forget: this runs after a committed write, on the request path.
      // The helper swallows its own failures, and a lost message costs a consumer
      // its TTL — never correctness — so nothing here may surface as an error.
      // `getRedisClient()` is never put in subscriber mode (the Socket.IO adapter
      // takes `duplicate()`s), so PUBLISH on it is legal.
      publishOxyUserInvalidation(redis, userId, reason, (err: unknown) => {
        logger.warn('userCache: invalidation publish failed', {
          component: LOG_COMPONENT,
          userId,
          reason,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  // --- Local cache helpers ---

  private getLocal(userId: string): IUser | null {
    const cached = this.local.get(userId);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.local.delete(userId);
      return null;
    }
    return cached.user;
  }

  private setLocal(userId: string, user: IUser, ttl?: number): void {
    if (this.local.size >= MAX_LOCAL_SIZE) {
      const entries = Array.from(this.local.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const count = Math.floor(MAX_LOCAL_SIZE * 0.1);
      for (let i = 0; i < count; i++) {
        this.local.delete(entries[i][0]);
      }
    }
    this.local.set(userId, {
      user,
      timestamp: Date.now(),
      ttl: ttl || DEFAULT_TTL * 1000,
    });
  }

  private cleanupLocal(): void {
    const now = Date.now();
    for (const [key, cached] of this.local.entries()) {
      if (now - cached.timestamp > cached.ttl) {
        this.local.delete(key);
      }
    }
  }

  clear(): void {
    this.local.clear();
  }

  getStats(): { size: number; maxSize: number } {
    return { size: this.local.size, maxSize: MAX_LOCAL_SIZE };
  }

  stop(): void {
    clearInterval(this.cleanupTimer);
  }
}

const userCache = new UserCache();
export default userCache;

/**
 * Two-tier cache (process-local map + Redis) for the authenticated account
 * document — the value `middleware/auth.ts` attaches to `req.user`.
 *
 * `session.service` is the ONLY writer and the only reader of `get`/`set`; the
 * ~20 other importers call `invalidate` alone. That is what makes the value's
 * type a decision made in one place: it is whatever
 * `userService.readAccountDocument` returns.
 *
 * KNOWN BOUNDARY, unchanged by the Postgres port and called out because the
 * type now names it: the Redis tier round-trips through JSON, so a `Date` read
 * back from Redis is an ISO STRING while the same field read from the local map
 * (or straight from the database) is a `Date`. No consumer of `req.user` reads a
 * date field — the request path reads `_id`, `id`, `isStaff` and `email` — so
 * this costs nothing today. Anything that starts reading a timestamp off
 * `req.user` must normalize it rather than assume `Date`.
 */

import { getRedisClient } from '../config/redis';
import type { AccountDocument } from '../services/user.service';
import { logger } from './logger';

const DEFAULT_TTL = 5 * 60; // 5 minutes in seconds
const MAX_LOCAL_SIZE = 10000;
const LOG_COMPONENT = 'UserCache';

class UserCache {
  private local: Map<string, { user: AccountDocument; timestamp: number; ttl: number }> = new Map();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupLocal(), 60_000);
    this.cleanupTimer.unref?.();
  }

  get(userId: string): AccountDocument | null {
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
        let parsed: AccountDocument | null = null;
        try {
          parsed = JSON.parse(data) as AccountDocument;
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

  set(userId: string, user: AccountDocument, ttl?: number): void {
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

  invalidate(userId: string): void {
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
    }
  }

  // --- Local cache helpers ---

  private getLocal(userId: string): AccountDocument | null {
    const cached = this.local.get(userId);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.local.delete(userId);
      return null;
    }
    return cached.user;
  }

  private setLocal(userId: string, user: AccountDocument, ttl?: number): void {
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

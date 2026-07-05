import { getRedisClient } from '../config/redis';
import { logger } from './logger';

// Short, security-relevant TTL. Deliberately shorter than userCache's 5min:
// the approved-clients allow-list is part of the OAuth-consent/device-first
// trust boundary, so we keep cross-task staleness tightly bounded.
const DEFAULT_TTL = 60_000; // 60s in ms
const REDIS_KEY = 'approved:origins';
const LOCAL_KEY = 'approved:origins';
const LOG_COMPONENT = 'ApprovedClientsCache';

/**
 * Cached approved-clients snapshot. `origins` is the full approved-clients
 * allow-list (dev/native + trusted-Application origins + manual escape-hatch
 * rows); `trusted` is the strict subset of first-party/official/internal
 * origins the API classifies as never requiring per-user OAuth consent (see
 * `isTrustedApplication`). Both derive from ONE Mongo read and are cached
 * together as a single entry.
 */
export interface ApprovedClientsData {
  origins: string[];
  trusted: string[];
}

/**
 * In-process cache for NON-AUTHORITATIVE approved-client list reads.
 *
 * Collapses redundant `Application` reads for consumers that need the
 * approved-origin/trusted-origin snapshot into at most one Mongo read per TTL
 * window. The approved set is tiny and changes rarely (create / update /
 * delete only), so the whole origin list is cached as a single entry.
 *
 * SECURITY BOUNDARY: this cache is safe ONLY for list/catalog-style callers
 * that can tolerate a short refresh delay. Security-sensitive AUTHORIZATION
 * checks must BYPASS this cache and read the canonical registry
 * (`dynamicOriginRegistry` / `isTrustedApplication`) directly — oxy-api runs
 * as multiple ECS Fargate tasks, so this in-process Map is per-task: an
 * `invalidate()` on task A clears only task A's cache, and other tasks would
 * otherwise serve the stale list until their own 60s TTL expires.
 * Authorization reading the registry live closes that cross-task staleness
 * window. The TTL still caps staleness for the non-authoritative readers at
 * 60s; the best-effort Redis tier shortens it further when Valkey is
 * reachable.
 *
 * NOTE: as of the wave-2 FedCM/SSO deletion, `invalidate()` is called from
 * `routes/applications.ts` on every Application create/update/delete, but no
 * current code path calls `getApprovedData()` to actually read the cache —
 * its only consumer (the FedCM IdP worker's approved-clients fetch) was
 * deleted along with FedCM. Left in place rather than removed here since
 * deleting a class + its call sites is a logic change, not a comment fix;
 * flag for a follow-up dead-code pass if no future consumer claims it.
 */
class ApprovedClientsCache {
  private local: Map<string, { data: ApprovedClientsData; timestamp: number; ttl: number }> = new Map();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupLocal(), 60_000);
    this.cleanupTimer.unref?.();
  }

  /**
   * Return the cached approved-clients snapshot (`{ origins, trusted }`) when a
   * fresh local entry exists, otherwise invoke `loader()` (the uncached Mongo
   * read), store the result, and return it. The loader is fail-soft (returns the
   * dev/native fallback on Mongo error) so a cache miss never throws here.
   */
  async getApprovedData(loader: () => Promise<ApprovedClientsData>): Promise<ApprovedClientsData> {
    const local = this.getLocal();
    if (local) return local;

    const data = await loader();
    this.setLocal(data);
    return data;
  }

  /**
   * Clear the cached list everywhere this task can reach: the local entry and
   * the best-effort Redis tier. Called from `routes/applications.ts` on
   * Application create/update/delete (see the dead-consumer note above).
   */
  invalidate(): void {
    this.local.delete(LOCAL_KEY);

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      redis.del(REDIS_KEY).catch((err) => {
        logger.warn('approvedClientsCache: Redis del failed', {
          component: LOG_COMPONENT,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  // --- Local cache helpers ---

  private getLocal(): ApprovedClientsData | null {
    const cached = this.local.get(LOCAL_KEY);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.local.delete(LOCAL_KEY);
      return null;
    }
    return cached.data;
  }

  private setLocal(data: ApprovedClientsData): void {
    this.local.set(LOCAL_KEY, {
      data,
      timestamp: Date.now(),
      ttl: DEFAULT_TTL,
    });

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      const ttlSec = Math.ceil(DEFAULT_TTL / 1000);
      redis.setex(REDIS_KEY, ttlSec, JSON.stringify(data)).catch((err) => {
        logger.warn('approvedClientsCache: Redis setex failed', {
          component: LOG_COMPONENT,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
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

  stop(): void {
    clearInterval(this.cleanupTimer);
  }
}

const approvedClientsCache = new ApprovedClientsCache();
export default approvedClientsCache;

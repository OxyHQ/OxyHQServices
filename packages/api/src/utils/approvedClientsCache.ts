import { getRedisClient } from '../config/redis';
import { logger } from './logger';

// Short, security-relevant TTL. Deliberately shorter than userCache's 5min:
// the approved-clients allow-list is part of the SSO/FedCM trust boundary, so
// we keep cross-task staleness tightly bounded.
const DEFAULT_TTL = 60_000; // 60s in ms
const REDIS_KEY = 'approved:origins';
const LOCAL_KEY = 'approved:origins';
const LOG_COMPONENT = 'ApprovedClientsCache';

/**
 * In-process cache for the FedCM approved-clients allow-list.
 *
 * Collapses the 3-5 redundant `FedCMClient` reads per SSO/FedCM sign-in
 * (preflight + POST in `ssoExchangeCors`, `issueSsoCode`, `exchangeIdToken`,
 * and `getUserGrantedOrigins` on cold boot) into at most one Mongo read per
 * TTL window. The approved set is tiny and changes rarely (create / delete /
 * seed only), so the whole origin list is cached as a single entry.
 *
 * MULTI-TASK CAVEAT: oxy-api runs as multiple ECS Fargate tasks, so this
 * in-process Map is per-task. A revoke (`removeApprovedClient`) on task A
 * clears only task A's cache; other tasks serve the stale list until their own
 * 60s TTL expires. This is acceptable for a rarely-changing allow-list, and
 * revocation is ALSO enforced fail-closed elsewhere: the FedCM exchange
 * re-checks approval against this same list, and the SSO code exchange is
 * origin-bound + single-use. The TTL caps worst-case cross-task staleness at
 * 60s; the best-effort Redis tier shortens it further when Valkey is reachable.
 */
class ApprovedClientsCache {
  private local: Map<string, { origins: string[]; timestamp: number; ttl: number }> = new Map();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupLocal(), 60_000);
  }

  /**
   * Return the cached approved-origins list when a fresh local entry exists,
   * otherwise invoke `loader()` (the uncached Mongo read), store the result,
   * and return it. The loader is fail-soft (returns `[]` on Mongo error) so a
   * cache miss never throws here.
   */
  async getApprovedOrigins(loader: () => Promise<string[]>): Promise<string[]> {
    const local = this.getLocal();
    if (local) return local;

    const origins = await loader();
    this.setLocal(origins);
    return origins;
  }

  /**
   * Membership test against the cached approved-origins list. One source of
   * truth — no separate per-origin cache to keep coherent.
   */
  async isApproved(origin: string, loader: () => Promise<string[]>): Promise<boolean> {
    const origins = await this.getApprovedOrigins(loader);
    return origins.includes(origin);
  }

  /**
   * Clear the cached list everywhere this task can reach: the local entry and
   * the best-effort Redis tier. Called by the only mutators of the allow-list
   * (`addApprovedClient`, `removeApprovedClient`, `seedApprovedClients`).
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

  private getLocal(): string[] | null {
    const cached = this.local.get(LOCAL_KEY);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.local.delete(LOCAL_KEY);
      return null;
    }
    return cached.origins;
  }

  private setLocal(origins: string[]): void {
    this.local.set(LOCAL_KEY, {
      origins,
      timestamp: Date.now(),
      ttl: DEFAULT_TTL,
    });

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      const ttlSec = Math.ceil(DEFAULT_TTL / 1000);
      redis.setex(REDIS_KEY, ttlSec, JSON.stringify(origins)).catch((err) => {
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

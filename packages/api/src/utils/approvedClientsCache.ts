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
 * In-process cache for non-authoritative FedCM approved-client list reads.
 *
 * This cache is safe only for list/catalog-style callers that can tolerate a
 * short refresh delay. Security-sensitive authorization checks must bypass it
 * and read the canonical registry directly, because oxy-api runs multiple ECS
 * tasks and a revoke handled by one task cannot synchronously clear another
 * task's local memory.
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

import { logger } from './logger';
import { IUser } from '../models/User';

interface CachedUser {
  user: IUser;
  timestamp: number;
  ttl: number;
}

interface UserCacheConfig {
  maxSize: number;
  defaultTTL: number; // in milliseconds
  cleanupInterval: number; // in milliseconds
}

class UserCache {
  private cache: Map<string, CachedUser> = new Map();
  private config: UserCacheConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<UserCacheConfig> = {}) {
    this.config = {
      maxSize: 10000,
      defaultTTL: 5 * 60 * 1000, // 5 minutes
      cleanupInterval: 60 * 1000, // 1 minute
      ...config
    };

    this.startCleanupTimer();
  }

  /**
   * Get user from cache
   * 
   * @param userId - The user ID to lookup
   * @returns Cached user object or null if not found/expired
   */
  get(userId: string): IUser | null {
    if (!userId) return null;

    const cached = this.cache.get(userId);

    if (!cached) {
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      this.cache.delete(userId);
      return null;
    }

    return cached.user;
  }

  /**
   * Store user in cache
   * 
   * Optimized for high-scale usage with efficient eviction strategy.
   * Automatically evicts oldest entries when cache is full.
   * 
   * @param userId - The user ID to use as cache key
   * @param user - The user object to cache
   * @param ttl - Optional custom TTL in milliseconds (defaults to config defaultTTL)
   */
  set(userId: string, user: IUser, ttl?: number): void {
    if (!userId || !user) return;

    if (this.cache.size >= this.config.maxSize) {
      const evictCount = Math.max(1, Math.floor(this.config.maxSize * 0.1));
      this.evictOldest(evictCount);
    }

    this.cache.set(userId, {
      user,
      timestamp: Date.now(),
      ttl: ttl || this.config.defaultTTL
    });
  }

  /**
   * Invalidate user from cache
   * 
   * @param userId - The user ID to invalidate from cache
   */
  invalidate(userId: string): void {
    if (userId) {
      this.cache.delete(userId);
    }
  }

  /**
   * Remove the oldest cache entry(ies)
   * 
   * Optimized for performance: When evicting multiple entries, sorts once and evicts in batch.
   * This is more efficient than multiple O(n) scans.
   * 
   * @param count - Number of entries to evict (default: 1)
   */
  private evictOldest(count: number = 1): void {
    if (count <= 0 || this.cache.size === 0) {
      return;
    }

    // For single eviction, use simple scan (O(n))
    // For multiple evictions, sort once and evict batch (O(n log n) but only when needed)
    if (count === 1) {
      let oldestKey: string | null = null;
      let oldestTimestamp = Infinity;

      for (const [key, cached] of this.cache.entries()) {
        if (cached.timestamp < oldestTimestamp) {
          oldestTimestamp = cached.timestamp;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    } else {
      // Batch eviction: Sort entries by timestamp and evict oldest N
      // More efficient than N separate scans
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toEvict = entries.slice(0, Math.min(count, entries.length));
      for (const [key] of toEvict) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > cached.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize
    };
  }

  /**
   * Stop cleanup timer (for testing/shutdown)
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// Export singleton instance
const userCache = new UserCache();
export default userCache;


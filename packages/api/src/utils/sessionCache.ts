import { logger } from './logger';
import { ISession } from '../models/Session';

interface CachedSession {
  session: ISession;
  userId?: string;
  timestamp: number;
  ttl: number;
}

interface SessionCacheConfig {
  maxSize: number;
  defaultTTL: number; // in milliseconds
  cleanupInterval: number; // in milliseconds
  lastActiveUpdateThreshold: number; // Only update lastActive if this much time has passed (ms)
}

class SessionCache {
  private cache: Map<string, CachedSession> = new Map();
  private config: SessionCacheConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private pendingLastActiveUpdates: Map<string, Date> = new Map();

  constructor(config: Partial<SessionCacheConfig> = {}) {
    this.config = {
      maxSize: 5000,
      defaultTTL: 5 * 60 * 1000, // 5 minutes
      cleanupInterval: 60 * 1000, // 1 minute
      lastActiveUpdateThreshold: 60 * 1000, // 1 minute
      ...config
    };

    this.startCleanupTimer();
  }

  /**
   * Generate cache key for session lookup
   */
  private generateKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  /**
   * Get session from cache
   */
  get(sessionId: string): ISession | null {
    const key = this.generateKey(sessionId);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Cache hit - no need to log (this is the expected/normal case)
    // Only log cache misses for debugging
    return cached.session;
  }

  /**
   * Store session in cache
   */
  set(sessionId: string, session: ISession, ttl?: number): void {
    const key = this.generateKey(sessionId);

    // Remove oldest entries if cache is full
    if (this.cache.size >= this.config.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      session,
      userId: session.userId?.toString(),
      timestamp: Date.now(),
      ttl: ttl || this.config.defaultTTL
    });

    logger.debug(`Cached session: ${sessionId.substring(0, 8)}...`);
  }

  /**
   * Invalidate session from cache
   */
  invalidate(sessionId: string): void {
    const key = this.generateKey(sessionId);
    this.cache.delete(key);
    this.pendingLastActiveUpdates.delete(sessionId);
    logger.debug(`Invalidated cache for session: ${sessionId.substring(0, 8)}...`);
  }

  /**
   * Invalidate all sessions for a user
   */
  invalidateUserSessions(userId: string): void {
    let count = 0;
    for (const [key, cached] of this.cache.entries()) {
      if (cached.userId === userId) {
        this.cache.delete(key);
        this.pendingLastActiveUpdates.delete(cached.session.sessionId);
        count++;
      }
    }
    logger.debug(`Invalidated ${count} cached sessions for user: ${userId}`);
  }

  /**
   * Track pending lastActive update to avoid excessive database writes
   */
  shouldUpdateLastActive(sessionId: string): boolean {
    const lastUpdate = this.pendingLastActiveUpdates.get(sessionId);
    if (!lastUpdate) {
      this.pendingLastActiveUpdates.set(sessionId, new Date());
      return true;
    }

    const timeSinceLastUpdate = Date.now() - lastUpdate.getTime();
    if (timeSinceLastUpdate >= this.config.lastActiveUpdateThreshold) {
      this.pendingLastActiveUpdates.set(sessionId, new Date());
      return true;
    }

    return false;
  }

  /**
   * Clear pending lastActive update tracking
   */
  clearPendingLastActive(sessionId: string): void {
    this.pendingLastActiveUpdates.delete(sessionId);
  }

  /**
   * Remove the oldest cache entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, cached] of this.cache.entries()) {
      if (cached.timestamp < oldestTimestamp) {
        oldestTimestamp = cached.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const cached = this.cache.get(oldestKey);
      if (cached) {
        this.pendingLastActiveUpdates.delete(cached.session.sessionId);
      }
      this.cache.delete(oldestKey);
      logger.debug('Evicted oldest session from cache');
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
        this.pendingLastActiveUpdates.delete(cached.session.sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired sessions from cache`);
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
    this.pendingLastActiveUpdates.clear();
    logger.debug('Session cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; pendingUpdates: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      pendingUpdates: this.pendingLastActiveUpdates.size
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
const sessionCache = new SessionCache();
export default sessionCache;


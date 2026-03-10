import { getRedisClient } from '../config/redis';
import { IUser } from '../models/User';

const DEFAULT_TTL = 5 * 60; // 5 minutes in seconds
const MAX_LOCAL_SIZE = 10000;

class UserCache {
  private local: Map<string, { user: IUser; timestamp: number; ttl: number }> = new Map();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupLocal(), 60_000);
  }

  get(userId: string): IUser | null {
    if (!userId) return null;

    const local = this.getLocal(userId);
    if (local) return local;

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      redis.get(`user:${userId}`).then(data => {
        if (data) {
          this.setLocal(userId, JSON.parse(data));
        }
      }).catch(() => {});
    }

    return null;
  }

  set(userId: string, user: IUser, ttl?: number): void {
    if (!userId || !user) return;
    const ttlSec = ttl ? Math.ceil(ttl / 1000) : DEFAULT_TTL;
    this.setLocal(userId, user, ttl);

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      redis.setex(`user:${userId}`, ttlSec, JSON.stringify(user)).catch(() => {});
    }
  }

  invalidate(userId: string): void {
    if (!userId) return;
    this.local.delete(userId);

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      redis.del(`user:${userId}`).catch(() => {});
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

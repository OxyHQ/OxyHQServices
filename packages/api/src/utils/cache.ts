import { createClient, RedisClientType } from 'redis';
import { logger } from './logger';

class CacheService {
  private client: RedisClientType | null = null;
  private isConnected: boolean = false;
  private isRedisAvailable: boolean = false;
  private isRedisConfigured: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    
    // Only initialize Redis if REDIS_URL is provided
    if (redisUrl && redisUrl !== 'redis://localhost:6379') {
      this.isRedisConfigured = true;
      this.isRedisAvailable = true;
      
      this.client = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              this.isRedisAvailable = false;
              return new Error('Redis connection failed');
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      this.client.on('error', (err) => {
        // Only log Redis errors if Redis is actually configured
        if (this.isRedisConfigured) {
          logger.error('Redis Client Error:', err);
        }
        this.isConnected = false;
        this.isRedisAvailable = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis connected successfully');
        this.isConnected = true;
        this.isRedisAvailable = true;
      });

      this.client.on('disconnect', () => {
        if (this.isRedisConfigured) {
          logger.warn('Redis disconnected');
        }
        this.isConnected = false;
      });
    } else {
      // Redis not configured, disable all Redis functionality
      this.isRedisConfigured = false;
      this.isRedisAvailable = false;
      logger.info('Redis not configured, caching disabled');
    }
  }

  async connect(): Promise<void> {
    if (!this.isRedisConfigured || !this.isRedisAvailable || !this.client) {
      return; // Silently return if Redis is not configured
    }
    
    if (!this.isConnected) {
      try {
        await this.client.connect();
      } catch (error) {
        this.isRedisAvailable = false;
        // Don't log connection errors if Redis is not properly configured
        if (this.isRedisConfigured) {
          logger.error('Failed to connect to Redis:', error);
        }
        throw error;
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isRedisConfigured || !this.isRedisAvailable || !this.client) {
      return null;
    }
    
    try {
      await this.connect();
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      // Only log errors if Redis is actually configured
      if (this.isRedisConfigured) {
        logger.error(`Cache get error for key ${key}:`, error);
      }
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.isRedisConfigured || !this.isRedisAvailable || !this.client) {
      return;
    }
    
    try {
      await this.connect();
      const serializedValue = JSON.stringify(value);
      if (ttl) {
        await this.client.setEx(key, ttl, serializedValue);
      } else {
        await this.client.set(key, serializedValue);
      }
    } catch (error) {
      // Only log errors if Redis is actually configured
      if (this.isRedisConfigured) {
        logger.error(`Cache set error for key ${key}:`, error);
      }
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isRedisConfigured || !this.isRedisAvailable || !this.client) {
      return;
    }
    
    try {
      await this.connect();
      await this.client.del(key);
    } catch (error) {
      // Only log errors if Redis is actually configured
      if (this.isRedisConfigured) {
        logger.error(`Cache delete error for key ${key}:`, error);
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isRedisConfigured || !this.isRedisAvailable || !this.client) {
      return false;
    }
    
    try {
      await this.connect();
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      // Only log errors if Redis is actually configured
      if (this.isRedisConfigured) {
        logger.error(`Cache exists error for key ${key}:`, error);
      }
      return false;
    }
  }

  async flush(): Promise<void> {
    if (!this.isRedisConfigured || !this.isRedisAvailable || !this.client) {
      return;
    }
    
    try {
      await this.connect();
      await this.client.flushAll();
    } catch (error) {
      // Only log errors if Redis is actually configured
      if (this.isRedisConfigured) {
        logger.error('Cache flush error:', error);
      }
    }
  }

  // Cache middleware for Express routes
  cacheMiddleware(ttl: number = 300) {
    const cacheService = this;
    return async (req: any, res: any, next: any) => {
      if (req.method !== 'GET') {
        return next();
      }

      const key = `cache:${req.originalUrl}`;
      
      try {
        const cached = await cacheService.get(key);
        if (cached) {
          return res.json(cached);
        }
      } catch (error) {
        // Only log errors if Redis is actually configured
        if (cacheService.isRedisConfigured) {
          logger.error('Cache middleware error:', error);
        }
      }

      // Store original send method
      const originalSend = res.json;
      
      // Override send method to cache response
      res.json = function(data: any) {
        cacheService.set(key, data, ttl).catch((err: any) => {
          // Only log errors if Redis is actually configured
          if (cacheService.isRedisConfigured) {
            logger.error('Failed to cache response:', err);
          }
        });
        return originalSend.call(this, data);
      };

      next();
    };
  }

  // User-specific cache keys
  getUserKey(userId: string, type: string): string {
    return `user:${userId}:${type}`;
  }

  // Invalidate user cache
  async invalidateUserCache(userId: string): Promise<void> {
    if (!this.isRedisConfigured || !this.isRedisAvailable || !this.client) {
      return;
    }
    
    try {
      await this.connect();
      const keys = await this.client.keys(`user:${userId}:*`);
      if (keys.length > 0) {
        await this.client.del(keys);
        logger.info(`Invalidated ${keys.length} cache entries for user ${userId}`);
      }
    } catch (error) {
      // Only log errors if Redis is actually configured
      if (this.isRedisConfigured) {
        logger.error(`Failed to invalidate user cache for ${userId}:`, error);
      }
    }
  }

  // Check if Redis is available
  isAvailable(): boolean {
    return this.isRedisConfigured && this.isRedisAvailable;
  }
}

// Export singleton instance
export const cacheService = new CacheService();

// Graceful shutdown
process.on('SIGINT', async () => {
  await cacheService.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cacheService.disconnect();
  process.exit(0);
}); 
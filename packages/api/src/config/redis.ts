import Redis from 'ioredis';
import { logger } from '../utils/logger';

let redis: Redis | null = null;

/**
 * Get a shared Redis/Valkey client.
 * Returns null when REDIS_URL is not set — all consumers
 * should gracefully fall back to in-memory stores.
 */
export function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) return null;

  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
    });

    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('error', (err) => logger.error('Redis error:', err));
    redis.on('close', () => logger.warn('Redis connection closed'));

    redis.connect().catch((err) => {
      logger.error('Redis initial connect failed:', err);
    });
  }

  return redis;
}

/**
 * Gracefully close the Redis connection (for shutdown hooks).
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

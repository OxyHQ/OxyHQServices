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

      // Send TCP keepalive every 30s to prevent idle connection drops.
      // DigitalOcean managed Valkey drops idle connections at ~300s.
      keepAlive: 30000,

      enableReadyCheck: true,

      retryStrategy(times: number) {
        if (times > 20) return null;
        return Math.min(times * 200, 5000);
      },

      reconnectOnError(err: Error) {
        return err.message.includes('READONLY');
      },
    });

    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('ready', () => logger.info('Redis ready'));
    redis.on('error', (err) => logger.error('Redis error:', err));
    redis.on('close', () => logger.warn('Redis connection closed'));
    redis.on('reconnecting', (ms: number) =>
      logger.info('Redis reconnecting', { retryIn: ms })
    );

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

import Redis, { type RedisOptions } from 'ioredis';
import { logger } from '../utils/logger';

let redis: Redis | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Get a shared Redis/Valkey client.
 * Returns null when REDIS_URL is not set — all consumers
 * should gracefully fall back to in-memory stores.
 */
export function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) return null;

  if (!redis) {
    const url = process.env.REDIS_URL;
    const opts: RedisOptions = {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableReadyCheck: true,
      keepAlive: 10000,
      tls: url.startsWith('rediss://') ? {} : undefined,

      retryStrategy(times: number) {
        if (times > 20) return null;
        return Math.min(times * 200, 5000);
      },

      reconnectOnError(err: Error) {
        return err.message.includes('READONLY');
      },
    };

    redis = new Redis(url, opts);

    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('ready', () => {
      logger.info('Redis ready');
      startPingInterval();
    });
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
 * Send PING every 60s to prevent managed Valkey idle timeout (default 300s).
 * TCP keepalive alone doesn't count as application-level activity.
 */
function startPingInterval(): void {
  if (pingInterval) return;
  pingInterval = setInterval(async () => {
    if (redis && redis.status === 'ready') {
      try {
        await redis.ping();
      } catch {
        // Reconnection is handled by ioredis automatically
      }
    }
  }, 60_000);
}

/**
 * Gracefully close the Redis connection (for shutdown hooks).
 */
export async function closeRedis(): Promise<void> {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

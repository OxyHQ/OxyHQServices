/**
 * Dedicated ioredis connections for BullMQ.
 *
 * BullMQ has hard requirements that the shared cache client in
 * `src/config/redis.ts` does NOT satisfy:
 *   - `maxRetriesPerRequest` MUST be `null` (BullMQ manages its own retries and
 *     uses long-running blocking commands like BRPOPLPUSH).
 *   - A `Worker` needs its OWN blocking connection, separate from the `Queue`'s
 *     connection, because the worker blocks on the connection while waiting for
 *     jobs and would otherwise starve the queue's regular commands.
 *
 * We therefore create dedicated connections here rather than reusing
 * `getRedisClient()`. The `rediss://` TLS handling and retry-backoff style are
 * mirrored from the cache client so operational behaviour stays consistent.
 */

import Redis, { type RedisOptions } from 'ioredis';
import { logger } from '../utils/logger';

/**
 * Maximum reconnection attempts before ioredis gives up. Mirrors the cache
 * client in `src/config/redis.ts`.
 */
const MAX_RECONNECT_ATTEMPTS = 20;
const RECONNECT_BACKOFF_STEP_MS = 200;
const RECONNECT_BACKOFF_CAP_MS = 5000;
const KEEP_ALIVE_MS = 10_000;

/**
 * Every connection we create is tracked here so `closeConnections()` can shut
 * them all down gracefully on process exit.
 */
const connections = new Set<Redis>();

/**
 * Build the BullMQ-compatible ioredis options from `REDIS_URL`.
 *
 * The critical difference from the cache client is `maxRetriesPerRequest: null`.
 */
function buildOptions(url: string): RedisOptions {
  return {
    // BullMQ requirement — must be null, never a finite number.
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableReadyCheck: true,
    keepAlive: KEEP_ALIVE_MS,
    tls: url.startsWith('rediss://') ? {} : undefined,

    retryStrategy(times: number) {
      if (times > MAX_RECONNECT_ATTEMPTS) return null;
      return Math.min(times * RECONNECT_BACKOFF_STEP_MS, RECONNECT_BACKOFF_CAP_MS);
    },

    reconnectOnError(err: Error) {
      return err.message.includes('READONLY');
    },
  };
}

/**
 * Create a fresh, tracked ioredis connection for BullMQ.
 *
 * `role` is used only for log context (e.g. `queue` vs `worker`). Connection
 * errors are logged via the `error` handler and never crash the process; the
 * caller decides whether the absence of a working queue is fatal (it is not).
 *
 * @throws Error if `REDIS_URL` is not set — callers must gate on
 *   `isQueueEnabled()` before constructing connections.
 */
export function createQueueConnection(role: string): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('createQueueConnection called without REDIS_URL set');
  }

  const client = new Redis(url, buildOptions(url));

  client.on('error', (err: Error) =>
    logger.error('BullMQ Redis error', { role, error: err.message })
  );
  client.on('close', () => logger.warn('BullMQ Redis connection closed', { role }));
  client.on('reconnecting', (ms: number) =>
    logger.info('BullMQ Redis reconnecting', { role, retryIn: ms })
  );
  client.on('ready', () => logger.info('BullMQ Redis ready', { role }));

  connections.add(client);
  return client;
}

/**
 * Gracefully close every connection created by `createQueueConnection`.
 * Safe to call when no connections exist. Errors per-connection are logged and
 * do not prevent the remaining connections from closing.
 */
export async function closeConnections(): Promise<void> {
  const open = Array.from(connections);
  connections.clear();

  await Promise.all(
    open.map(async (client) => {
      try {
        await client.quit();
      } catch (err) {
        logger.warn('BullMQ Redis quit failed, forcing disconnect', {
          error: err instanceof Error ? err.message : String(err),
        });
        client.disconnect();
      }
    })
  );
}

import expressRateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RedisReply } from 'rate-limit-redis';
import { getRedisClient } from '../config/redis';
import type { Request } from 'express';

interface RateLimitOptions {
  /**
   * Required: unique key prefix for the Redis store of THIS limiter. When
   * multiple limiters share a single Redis store without prefixes, a request
   * that flows through more than one of them increments the same counter
   * multiple times (express-rate-limit emits `ERR_ERL_DOUBLE_COUNT` and the
   * effective per-IP budget is silently halved). Use a short, stable, unique
   * string per call site, e.g. `'auth:challenge:'`, `'fedcm:nonce:'`.
   */
  prefix: string;
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
}

function makeStore(prefix: string) {
  const redis = getRedisClient();
  if (!redis) return {};
  return {
    store: new RedisStore({
      prefix,
      sendCommand: (...args: string[]) =>
        redis.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
    }),
  };
}

export function rateLimit(options: RateLimitOptions) {
  return expressRateLimit({
    ...makeStore(options.prefix),
    windowMs: options.windowMs,
    max: options.max,
    message: options.message || 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    ...(options.keyGenerator ? { keyGenerator: options.keyGenerator } : {}),
  });
}

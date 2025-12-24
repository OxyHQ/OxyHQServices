import type { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs: number; // time window in ms
  max: number; // max number of requests within window
  keyGenerator?: (req: Request) => string; // custom key (defaults to IP)
  message?: string; // optional error message
  statusCode?: number; // optional status code
}

type Bucket = {
  count: number;
  first: number; // timestamp of first request
};

const buckets = new Map<string, Bucket>();

export function rateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    keyGenerator = (req: Request) => req.ip || 'unknown',
    message = 'Too many requests, please try again later.',
    statusCode = 429,
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const now = Date.now();

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { count: 1, first: now });
      return next();
    }

    // Reset bucket if window has passed
    if (now - existing.first > windowMs) {
      buckets.set(key, { count: 1, first: now });
      return next();
    }

    existing.count += 1;

    if (existing.count > max) {
      const retryAfter = Math.ceil((existing.first + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(statusCode).json({ error: message });
    }

    return next();
  };
}

// Periodic cleanup to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.first > maxAge) {
      buckets.delete(key);
    }
  }
}, 30 * 60 * 1000);
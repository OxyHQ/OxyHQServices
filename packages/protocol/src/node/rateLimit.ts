/**
 * A small, dependency-free fixed-window per-IP rate limiter for the node app's
 * owner-authorized write routes.
 *
 * The node is a single-writer model (only the owner key may write), so the
 * limiter is a defence-in-depth budget on the unauthenticated edge — it caps the
 * request rate BEFORE signature verification so a flood of bogus envelopes can't
 * pin CPU on crypto. It is intentionally process-local (a single node serves one
 * owner's repo); there is no shared store to coordinate.
 *
 * Fixed-window counting keyed on `req.ip`: each key gets `max` requests per
 * `windowMs`; the window resets lazily on the first request after it elapses.
 * A stale-key sweep bounds memory so a churn of distinct IPs cannot grow the map
 * unboundedly.
 */

import type { Request, Response, NextFunction } from 'express';

/** A request-rate budget: at most `max` requests per `windowMs`. */
export interface RateLimitConfig {
  /** The rolling window length, in milliseconds. */
  readonly windowMs: number;
  /** The maximum number of requests permitted within one window. */
  readonly max: number;
}

/** Default budget for owner write routes (generous — single-writer model). */
export const DEFAULT_WRITE_RATE_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 60 };

interface WindowCounter {
  /** Epoch ms when the current window started. */
  start: number;
  /** Requests counted in the current window. */
  count: number;
}

/**
 * Build an Express middleware enforcing a fixed-window per-IP rate limit.
 * Exceeding the budget responds `429 { error: 'rate_limited' }` and does not call
 * `next`. The `key` is `req.ip` (Express's resolved client IP).
 */
export function createRateLimiter(config: RateLimitConfig) {
  const windows = new Map<string, WindowCounter>();
  // Sweep keys whose window has fully elapsed, bounded so a churn of distinct
  // IPs cannot grow the map without limit. Runs at most once per window.
  let lastSweep = 0;

  function sweep(now: number): void {
    if (now - lastSweep < config.windowMs) {
      return;
    }
    lastSweep = now;
    for (const [key, counter] of windows) {
      if (now - counter.start >= config.windowMs) {
        windows.delete(key);
      }
    }
  }

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    sweep(now);

    const key = req.ip ?? 'unknown';
    const counter = windows.get(key);
    if (!counter || now - counter.start >= config.windowMs) {
      windows.set(key, { start: now, count: 1 });
      next();
      return;
    }

    if (counter.count >= config.max) {
      const retryAfterSec = Math.ceil((counter.start + config.windowMs - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfterSec, 1)));
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

    counter.count += 1;
    next();
  };
}

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
 *
 * Bounded memory (defence against a key-rotation DoS — spoofed IPs / many DIDs
 * growing the map without limit → memory exhaustion):
 *  - An ACTIVE periodic sweep on an `unref()`'d interval deletes every entry
 *    whose window has fully elapsed, so keys that are never touched again do not
 *    leak forever (lazy expiry-on-access alone cannot reclaim them). The
 *    interval is `unref()`'d so it never keeps the node process alive, and
 *    {@link RateLimiter.stop} clears it for a clean lifecycle teardown.
 *  - A hard cap on the number of tracked keys ({@link RateLimitConfig.maxEntries})
 *    evicts the OLDEST window (insertion-order LRU) when exceeded — a synchronous
 *    backstop against a burst that arrives between sweeps.
 */

import type { Request, Response, NextFunction } from 'express';

// The package's `lib` includes `DOM` (the isomorphic root code uses Web Crypto),
// so the ambient `setInterval` overload TypeScript picks for a bare call is the
// browser one returning `number` — which has no `.unref()`. This `node/` subpath
// is Node-only; reach the Node timer globals through their `@types/node`
// signatures so the handle is correctly `NodeJS.Timeout` (no cast, no shadowing).
// Resolved at call time (not captured at module load) so test fake-timers that
// swap the globals still drive the sweep.
function nodeSetInterval(handler: () => void, ms: number): NodeJS.Timeout {
  const set: (handler: () => void, ms: number) => NodeJS.Timeout = globalThis.setInterval;
  return set(handler, ms);
}
function nodeClearInterval(timer: NodeJS.Timeout): void {
  const clear: (timer: NodeJS.Timeout) => void = globalThis.clearInterval;
  clear(timer);
}

/** A request-rate budget: at most `max` requests per `windowMs`. */
export interface RateLimitConfig {
  /** The rolling window length, in milliseconds. */
  readonly windowMs: number;
  /** The maximum number of requests permitted within one window. */
  readonly max: number;
  /**
   * Hard cap on the number of distinct keys (client identifiers) tracked at
   * once. When the map exceeds this, the oldest-inserted window is evicted as a
   * synchronous backstop against a burst of distinct keys arriving between
   * sweeps. Defaults to {@link DEFAULT_MAX_RATE_LIMIT_ENTRIES}.
   */
  readonly maxEntries?: number;
}

/** Default budget for owner write routes (generous — single-writer model). */
export const DEFAULT_WRITE_RATE_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 60 };

/**
 * Default hard cap on tracked keys. Sized so the map's worst-case footprint
 * stays small (each entry is a short string key + two numbers) while never
 * evicting a legitimately active key for the single-writer node — the owner
 * drives traffic from a handful of IPs, far below this ceiling.
 */
export const DEFAULT_MAX_RATE_LIMIT_ENTRIES = 10_000;

interface WindowCounter {
  /** Epoch ms when the current window started. */
  start: number;
  /** Requests counted in the current window. */
  count: number;
}

/**
 * The Express middleware returned by {@link createRateLimiter}, carrying a
 * {@link stop} hook so the owning app can clear the background sweep on shutdown.
 */
export interface RateLimiter {
  (req: Request, res: Response, next: NextFunction): void;
  /**
   * Stop the background sweep timer. Idempotent. Called by the node app's
   * graceful-shutdown path; not required for process exit (the timer is
   * `unref()`'d) but keeps long-lived test harnesses leak-free.
   */
  stop(): void;
}

/**
 * Build an Express middleware enforcing a fixed-window per-IP rate limit.
 * Exceeding the budget responds `429 { error: 'rate_limited' }` and does not call
 * `next`. The `key` is `req.ip` (Express's resolved client IP).
 *
 * The returned middleware owns a background sweep timer; call {@link RateLimiter.stop}
 * to release it (e.g. on app shutdown).
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const windows = new Map<string, WindowCounter>();
  const maxEntries = config.maxEntries ?? DEFAULT_MAX_RATE_LIMIT_ENTRIES;

  // Active sweep: delete every entry whose window has fully elapsed. Running on
  // a timer (rather than only on request arrival) reclaims keys that are never
  // touched again, so a churn of distinct IPs cannot leak memory once traffic
  // for those keys stops. One pass per window is sufficient: an entry lives at
  // most `2 * windowMs` before a sweep removes it.
  function sweepExpired(): void {
    const now = Date.now();
    for (const [key, counter] of windows) {
      if (now - counter.start >= config.windowMs) {
        windows.delete(key);
      }
    }
  }

  const sweepTimer = nodeSetInterval(sweepExpired, config.windowMs);
  // Never let the sweep keep the node process alive on its own.
  sweepTimer.unref();

  function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const counter = windows.get(key);

    if (!counter || now - counter.start >= config.windowMs) {
      // Hard cap backstop: if a burst of distinct keys outran the sweep, evict
      // the oldest-inserted window before admitting a new key. A `Map` preserves
      // insertion order, so its first key is the oldest tracked entry.
      if (!counter && windows.size >= maxEntries) {
        const oldest = windows.keys().next().value;
        if (oldest !== undefined) {
          windows.delete(oldest);
        }
      }
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
  }

  // Attach the lifecycle hook to the middleware, yielding the `RateLimiter`
  // callable-with-`stop` without a cast.
  return Object.assign(rateLimit, {
    stop(): void {
      nodeClearInterval(sweepTimer);
    },
  });
}

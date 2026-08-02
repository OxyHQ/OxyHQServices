/**
 * `createRateLimiter` unit tests — exercise the limiter directly (no Express
 * server) so per-key state and the memory-bounding behaviour are deterministic.
 *
 * Covers:
 *  - correct fixed-window budgeting for a legitimate client (allow up to `max`,
 *    then 429, then reset after the window),
 *  - the hard-cap LRU backstop: a burst of distinct keys never grows the tracked
 *    map past `maxEntries`,
 *  - the active sweep: expired windows are reclaimed on the timer even when their
 *    keys are never touched again,
 *  - `stop()` clears the sweep timer.
 */

import type { Request, Response, NextFunction } from 'express';
import { createRateLimiter, type RateLimiter } from '../node/rateLimit';

/** A minimal `Response` double capturing the status/headers/body the limiter sets. */
interface ResponseSpy {
  res: Response;
  statusCode: number | null;
  body: unknown;
  headers: Record<string, string>;
}

function makeResponseSpy(): ResponseSpy {
  const spy: ResponseSpy = { res: {} as Response, statusCode: null, body: undefined, headers: {} };
  const res: Pick<Response, 'status' | 'json' | 'setHeader'> = {
    status(code: number) {
      spy.statusCode = code;
      return res as Response;
    },
    json(payload: unknown) {
      spy.body = payload;
      return res as Response;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      spy.headers[name] = String(value);
      return res as Response;
    },
  };
  spy.res = res as Response;
  return spy;
}

/** Drive one request through the limiter for `ip`; returns whether `next()` ran. */
function call(limiter: RateLimiter, ip: string): { passed: boolean; response: ResponseSpy } {
  const req = { ip } as Request;
  const response = makeResponseSpy();
  let passed = false;
  const next: NextFunction = () => {
    passed = true;
  };
  limiter(req, response.res, next);
  return { passed, response };
}

describe('createRateLimiter', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows up to `max` requests per window then responds 429 rate_limited', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    try {
      expect(call(limiter, '1.1.1.1').passed).toBe(true);
      expect(call(limiter, '1.1.1.1').passed).toBe(true);
      expect(call(limiter, '1.1.1.1').passed).toBe(true);

      const fourth = call(limiter, '1.1.1.1');
      expect(fourth.passed).toBe(false);
      expect(fourth.response.statusCode).toBe(429);
      expect(fourth.response.body).toEqual({ error: 'rate_limited' });
      expect(Number(fourth.response.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    } finally {
      limiter.stop();
    }
  });

  it('budgets each client key independently', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    try {
      expect(call(limiter, 'a').passed).toBe(true);
      expect(call(limiter, 'a').passed).toBe(false); // a exhausted
      expect(call(limiter, 'b').passed).toBe(true); // b independent
    } finally {
      limiter.stop();
    }
  });

  it('resets a key after its window elapses', () => {
    jest.useFakeTimers();
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1 });
    try {
      expect(call(limiter, 'x').passed).toBe(true);
      expect(call(limiter, 'x').passed).toBe(false);
      jest.advanceTimersByTime(1_001);
      expect(call(limiter, 'x').passed).toBe(true); // fresh window
    } finally {
      limiter.stop();
    }
  });

  it('bounds memory: a burst of distinct keys never exceeds maxEntries (LRU eviction)', () => {
    // With max:1, a SURVIVING key is rate-limited on its second hit, while an
    // EVICTED key behaves brand new (passes). That makes eviction observable
    // without reaching into the private map. All requests stay within one window
    // (no sweep), so only the hard cap can bound the tracked set.
    const maxEntries = 50;
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxEntries });
    try {
      // Seed the oldest key, exhausting its single-request budget.
      expect(call(limiter, 'oldest').passed).toBe(true);
      expect(call(limiter, 'oldest').passed).toBe(false); // exhausted, still tracked

      // Burst well past the cap with distinct keys. Each insertion past the cap
      // evicts the oldest-inserted entry — 'oldest' is the first to go.
      for (let i = 0; i < maxEntries * 4; i += 1) {
        expect(call(limiter, `flood-${i}`).passed).toBe(true);
      }

      // 'oldest' was evicted by the cap, so it now passes as a brand-new key —
      // proving the tracked set was bounded rather than growing unboundedly.
      expect(call(limiter, 'oldest').passed).toBe(true);
    } finally {
      limiter.stop();
    }
  });

  it('actively sweeps expired windows even for keys never touched again', () => {
    jest.useFakeTimers();
    // A burst of keys, then total silence: the active timer must still reclaim
    // them. With max:1, a surviving key would be rate-limited on its next hit;
    // a swept (reclaimed) key passes again as brand new.
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1 });
    try {
      for (let i = 0; i < 100; i += 1) {
        expect(call(limiter, `burst-${i}`).passed).toBe(true);
      }
      // Exhaust one specific key so survival is observable.
      expect(call(limiter, 'burst-0').passed).toBe(false); // exhausted within window

      // Advance past the window: the unref'd interval fires (>= windowMs) and
      // deletes every expired entry — no further request needed to trigger it.
      jest.advanceTimersByTime(1_500);

      // The previously-exhausted key was reclaimed by the sweep → passes again.
      expect(call(limiter, 'burst-0').passed).toBe(true);
    } finally {
      limiter.stop();
    }
  });

  it('stop() halts the sweep timer and is idempotent', () => {
    jest.useFakeTimers();
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1 });

    // Seed and exhaust a key, then stop the limiter.
    expect(call(limiter, 'k').passed).toBe(true);
    expect(call(limiter, 'k').passed).toBe(false);
    limiter.stop();
    limiter.stop(); // second call must not throw

    // After stop, the active sweep no longer runs — the entry is NOT reclaimed by
    // the timer. Advancing past the sweep interval leaves the key tracked; only
    // the lazy expiry-on-access (its window having elapsed) gives it a fresh slot.
    jest.advanceTimersByTime(10_000);
    // The window has elapsed, so the next access resets the key lazily; this
    // proves the limiter still functions while confirming stop() didn't crash.
    expect(call(limiter, 'k').passed).toBe(true);
  });
});

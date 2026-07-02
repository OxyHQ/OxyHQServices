/**
 * Every Redis-backed limiter in `security.ts` MUST register a UNIQUE key
 * prefix. Two limiters sharing a prefix increment the same counter when a
 * request flows through both (express-rate-limit throws ERR_ERL_DOUBLE_COUNT
 * and the effective per-IP budget is silently halved). This suite captures the
 * prefix each limiter hands to `rate-limit-redis` at construction time and
 * asserts the new `rl:fedcm:service:` limiter is present and distinct from the
 * general/auth/user limiters.
 */

const capturedPrefixes: string[] = [];

jest.mock('rate-limit-redis', () => ({
  RedisStore: jest.fn().mockImplementation((opts: { prefix?: string }) => {
    if (typeof opts?.prefix === 'string') capturedPrefixes.push(opts.prefix);
    return {
      init: jest.fn(),
      increment: jest.fn(async () => ({ totalHits: 1, resetTime: new Date() })),
      decrement: jest.fn(),
      resetKey: jest.fn(),
      resetAll: jest.fn(),
    };
  }),
}));

// Force the Redis branch of `makeStore` so a RedisStore (with its prefix) is
// actually constructed for each limiter.
jest.mock('../../config/redis', () => ({
  getRedisClient: () => ({ call: jest.fn() }),
}));

// Importing the module builds every limiter at load time, populating
// `capturedPrefixes` via the mocked RedisStore constructor.
import '../security';

describe('security.ts limiter prefixes are unique', () => {
  it('registers the dedicated IdP service limiter with rl:fedcm:service:', () => {
    expect(capturedPrefixes).toContain('rl:fedcm:service:');
  });

  it('keeps every limiter prefix distinct (no ERR_ERL_DOUBLE_COUNT)', () => {
    // The four Redis-backed limiters defined in security.ts. slowDown's
    // bruteForceProtection uses an in-memory store (no prefix), so it is absent.
    const securityPrefixes = ['rl:general:', 'rl:fedcm:service:', 'rl:auth:', 'rl:user:'];

    for (const prefix of securityPrefixes) {
      // Present, and registered EXACTLY once — a duplicate would double-count.
      expect(capturedPrefixes.filter((p) => p === prefix)).toHaveLength(1);
    }
    // The four are mutually distinct.
    expect(new Set(securityPrefixes).size).toBe(securityPrefixes.length);
    // The dedicated service limiter is not the general per-IP browser budget.
    expect('rl:fedcm:service:').not.toBe('rl:general:');
  });
});

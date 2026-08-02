/**
 * Regression: email proxy rate limiting must never persist raw client IPs in Redis.
 * The route relies on rateLimit()'s default keyGenerator (hashedIpKey).
 */
import type { Request } from 'express';
import { hashedIpKey } from '../../utils/ipKey';
import { rateLimit } from '../../middleware/rateLimiter';

jest.mock('../../middleware/rateLimiter', () => {
  const actual = jest.requireActual('../../middleware/rateLimiter');
  return {
    ...actual,
    rateLimit: jest.fn((options: { keyGenerator?: (req: Request) => string }) => {
      capturedKeyGenerator = options.keyGenerator;
      return actual.rateLimit(options);
    }),
  };
});

let capturedKeyGenerator: ((req: Request) => string) | undefined;

describe('emailProxy route rate limiter', () => {
  beforeEach(() => {
    capturedKeyGenerator = undefined;
    jest.resetModules();
  });

  it('does not register a custom keyGenerator that stores raw IPs', async () => {
    await import('../emailProxy');

    // Undefined → rateLimit factory falls back to hashedIpKey (privacy invariant).
    expect(capturedKeyGenerator).toBeUndefined();
  });

  it('hashedIpKey never embeds the raw client IP', () => {
    process.env.DEVICE_ID_SALT = 'test-salt-0123456789abcdef';
    const ip = '203.0.113.42';
    const key = hashedIpKey({ ip } as Request);
    expect(key).not.toContain(ip);
    expect(key).toMatch(/^[a-f0-9]{24}$/);
  });
});

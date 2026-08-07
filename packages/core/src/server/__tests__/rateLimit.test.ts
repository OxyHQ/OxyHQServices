import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { OxyServices } from '../../OxyServices';

const rateLimitMock = jest.fn();

jest.mock('express-rate-limit', () => ({
  __esModule: true,
  default: (...args: unknown[]) => rateLimitMock(...args),
}));

import { createOxyRateLimit } from '../rateLimit';

interface CapturedRateLimitOptions {
  max: (req: Request) => number;
  keyGenerator: (req: Request) => string;
  skip: (req: Request) => boolean;
}

interface RateLimitTestRequest extends Request {
  userId?: string | null;
  user?: { id?: string; _id?: string } | null;
  sessionId?: string | null;
  serviceApp?: { appId?: string } | null;
  serviceActingAs?: { userId?: string } | null;
  observedMax?: number;
  observedKey?: string;
}

const HEX24 = /^[0-9a-f]{24}$/;

function makeOxy(authHandler: RequestHandler): OxyServices {
  return {
    auth: jest.fn(() => authHandler),
  } as unknown as OxyServices;
}

function makeRequest(overrides: Partial<RateLimitTestRequest> = {}): RateLimitTestRequest {
  const ip = overrides.ip ?? '203.0.113.9';
  return {
    method: 'GET',
    path: '/api/test',
    ip,
    socket: { remoteAddress: ip },
    ...overrides,
  } as RateLimitTestRequest;
}

/**
 * Stand-in for the real `oxy.auth({ optional: true })` on a request carrying no
 * `Bearer` header: it writes nulls unconditionally. That write is what used to
 * erase an identity resolved by a preceding middleware.
 */
function anonymousResolver(req: RateLimitTestRequest, _res: Response, next: NextFunction): void {
  req.userId = null;
  req.user = null;
  next();
}

/** Run the anonymous limiter for a bare IP and return the store key it produced. */
function keyForIp(ip: string): string {
  const oxy = makeOxy((_req: Request, _res: Response, next: NextFunction) => next());
  const req = makeRequest({ ip });
  createOxyRateLimit(oxy)(req, {} as Response, jest.fn());
  if (typeof req.observedKey !== 'string') {
    throw new Error('key generator did not run');
  }
  return req.observedKey;
}

describe('@oxyhq/core/server rate limiter', () => {
  const originalEnv = {
    IP_HASH_SALT: process.env.IP_HASH_SALT,
    DEVICE_ID_SALT: process.env.DEVICE_ID_SALT,
  };

  beforeEach(() => {
    // Isolate salt resolution from any ambient env so key assertions are deterministic.
    delete process.env.IP_HASH_SALT;
    delete process.env.DEVICE_ID_SALT;
    rateLimitMock.mockImplementation((options: CapturedRateLimitOptions) => {
      return (req: RateLimitTestRequest, _res: Response, next: NextFunction) => {
        req.observedMax = options.max(req);
        req.observedKey = options.keyGenerator(req);
        next();
      };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (originalEnv.IP_HASH_SALT === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = originalEnv.IP_HASH_SALT;
    if (originalEnv.DEVICE_ID_SALT === undefined) delete process.env.DEVICE_ID_SALT;
    else process.env.DEVICE_ID_SALT = originalEnv.DEVICE_ID_SALT;
  });

  it('buckets an unauthenticated request by hashed IP on the anonymous quota', () => {
    const oxy = makeOxy(anonymousResolver);
    const req = makeRequest();
    const next = jest.fn();

    createOxyRateLimit(oxy, { authenticatedMax: 5000, anonymousMax: 600 })(
      req,
      {} as Response,
      next,
    );

    expect(req.observedMax).toBe(600);
    // Anonymous callers are bucketed by a hashed key, NEVER the raw IP.
    expect(req.observedKey).toMatch(HEX24);
    expect(req.observedKey).not.toContain('203.0.113.9');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses authenticated quota and per-user keys for server-validated sessions', () => {
    const oxy = makeOxy((req: RateLimitTestRequest, _res: Response, next: NextFunction) => {
      req.userId = 'validated-user';
      req.user = { id: 'validated-user' };
      req.sessionId = 'validated-session';
      next();
    });
    const req = makeRequest();

    createOxyRateLimit(oxy, { authenticatedMax: 5000, anonymousMax: 600 })(
      req,
      {} as Response,
      jest.fn(),
    );

    expect(req.observedMax).toBe(5000);
    // Authenticated identities are keyed by the user id verbatim — NOT hashed.
    expect(req.observedKey).toBe('user:validated-user');
  });

  it('continues through the anonymous limiter if optional auth returns an error', () => {
    const oxy = makeOxy((_req: Request, _res: Response, next: NextFunction) => {
      next(new Error('token rejected'));
    });
    const req = makeRequest();
    const next = jest.fn();

    createOxyRateLimit(oxy, { authenticatedMax: 5000, anonymousMax: 600 })(
      req,
      {} as Response,
      next,
    );

    expect(req.observedMax).toBe(600);
    expect(req.observedKey).toMatch(HEX24);
    expect(req.observedKey).not.toContain('203.0.113.9');
    expect(next).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Idempotency. An application may run a SECOND authentication scheme of its
  // own (Allo authenticates Matrix Authentication Service tokens under an
  // `Authorization: MatrixBearer …` scheme). Mounted ahead of the limiter, the
  // identity it resolves must survive: the limiter previously re-ran the raw
  // `oxy.auth({ optional: true })`, which found no `Bearer` header and wrote
  // `req.userId = null` over it, dropping the request into the shared
  // anonymous per-IP bucket behind the load balancer.
  // -------------------------------------------------------------------------

  describe('idempotent session resolution', () => {
    it('keeps an identity a preceding middleware already resolved', () => {
      const resolver = jest.fn(anonymousResolver);
      const oxy = makeOxy(resolver);
      const req = makeRequest({ userId: 'mas-user', user: { id: 'mas-user' } });

      createOxyRateLimit(oxy, { authenticatedMax: 5000, anonymousMax: 600 })(
        req,
        {} as Response,
        jest.fn(),
      );

      expect(resolver).not.toHaveBeenCalled();
      expect(req.userId).toBe('mas-user');
      expect(req.observedMax).toBe(5000);
      expect(req.observedKey).toBe('user:mas-user');
    });

    it('keeps a preceding identity carried only on user._id', () => {
      const resolver = jest.fn(anonymousResolver);
      const oxy = makeOxy(resolver);
      const req = makeRequest({ user: { _id: 'mongo-user' } });

      createOxyRateLimit(oxy, { authenticatedMax: 5000, anonymousMax: 600 })(
        req,
        {} as Response,
        jest.fn(),
      );

      expect(resolver).not.toHaveBeenCalled();
      expect(req.observedKey).toBe('user:mongo-user');
    });

    it('still resolves the session when no preceding middleware set one', () => {
      const resolver = jest.fn((req: RateLimitTestRequest, _res: Response, next: NextFunction) => {
        req.userId = 'validated-user';
        req.user = { id: 'validated-user' };
        req.sessionId = 'validated-session';
        next();
      });
      const oxy = makeOxy(resolver as unknown as RequestHandler);
      const req = makeRequest();

      createOxyRateLimit(oxy)(req, {} as Response, jest.fn());

      expect(resolver).toHaveBeenCalledTimes(1);
      expect(req.observedKey).toBe('user:validated-user');
    });

    it('skips both session resolution and limiting on exempt paths', () => {
      const resolver = jest.fn(anonymousResolver);
      const oxy = makeOxy(resolver);
      const req = makeRequest({ path: '/health' });
      const next = jest.fn();

      createOxyRateLimit(oxy)(req, {} as Response, next);

      expect(resolver).not.toHaveBeenCalled();
      expect(req.observedKey).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('service tokens', () => {
    it('buckets a service token acting as itself under the app', () => {
      const oxy = makeOxy((req: RateLimitTestRequest, _res: Response, next: NextFunction) => {
        req.userId = null;
        req.user = null;
        req.serviceApp = { appId: 'app-1' };
        next();
      });
      const req = makeRequest();

      createOxyRateLimit(oxy, { authenticatedMax: 5000, anonymousMax: 600 })(
        req,
        {} as Response,
        jest.fn(),
      );

      expect(req.observedMax).toBe(5000);
      expect(req.observedKey).toBe('service:app-1');
    });

    it('buckets a delegated service request under the delegated user', () => {
      const oxy = makeOxy((req: RateLimitTestRequest, _res: Response, next: NextFunction) => {
        req.userId = 'delegated-user';
        req.user = { id: 'delegated-user' };
        req.serviceApp = { appId: 'app-1' };
        req.serviceActingAs = { userId: 'delegated-user' };
        next();
      });
      const req = makeRequest();

      createOxyRateLimit(oxy, { authenticatedMax: 5000, anonymousMax: 600 })(
        req,
        {} as Response,
        jest.fn(),
      );

      expect(req.observedMax).toBe(5000);
      expect(req.observedKey).toBe('user:delegated-user');
    });
  });

  describe('anonymous key hashing', () => {
    it('produces a deterministic 24-hex key that never contains the raw IP', () => {
      const first = keyForIp('203.0.113.9');
      const second = keyForIp('203.0.113.9');

      expect(first).toMatch(HEX24);
      expect(first).toBe(second);
      expect(first).not.toContain('203.0.113.9');
    });

    it('produces different keys for different IPv4 addresses', () => {
      expect(keyForIp('203.0.113.9')).not.toBe(keyForIp('198.51.100.7'));
    });

    it('buckets IPv6 addresses in the same /56 to the same key', () => {
      // 2001:db8:abcd:ee11 and 2001:db8:abcd:eeff share the /56 prefix (top byte of
      // the 4th hextet is 0xee for both); the differing bits are host bits.
      const a = keyForIp('2001:db8:abcd:ee11::1');
      const b = keyForIp('2001:db8:abcd:eeff::9999');

      expect(a).toMatch(HEX24);
      expect(a).toBe(b);
    });

    it('produces different keys for IPv6 addresses in different /56 prefixes', () => {
      const sameFiftySix = keyForIp('2001:db8:abcd:ee11::1');
      const otherFiftySix = keyForIp('2001:db8:abcd:ff11::1');

      expect(sameFiftySix).not.toBe(otherFiftySix);
    });

    it('salts the hash with IP_HASH_SALT so keys are not portable across salts', () => {
      const unsalted = keyForIp('203.0.113.9');

      process.env.IP_HASH_SALT = 'salt-a';
      const saltedA = keyForIp('203.0.113.9');

      process.env.IP_HASH_SALT = 'salt-b';
      const saltedB = keyForIp('203.0.113.9');

      expect(saltedA).toMatch(HEX24);
      expect(saltedA).not.toBe(unsalted);
      expect(saltedB).not.toBe(saltedA);
    });

    it('prefers IP_HASH_SALT over DEVICE_ID_SALT', () => {
      process.env.DEVICE_ID_SALT = 'device-salt';
      const deviceOnly = keyForIp('203.0.113.9');

      process.env.IP_HASH_SALT = 'ip-salt';
      const ipPreferred = keyForIp('203.0.113.9');

      expect(ipPreferred).not.toBe(deviceOnly);
    });

    it('falls back to the literal "unknown" key when no IP is resolvable', () => {
      const oxy = makeOxy((_req: Request, _res: Response, next: NextFunction) => next());
      const req = makeRequest({ ip: undefined, socket: {} as Request['socket'] });
      createOxyRateLimit(oxy)(req, {} as Response, jest.fn());

      expect(req.observedKey).toBe('unknown');
    });
  });
});

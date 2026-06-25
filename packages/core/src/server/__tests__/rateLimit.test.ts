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

function makeOxy(authHandler: RequestHandler): OxyServices {
  return {
    auth: jest.fn(() => authHandler),
  } as unknown as OxyServices;
}

function makeRequest(overrides: Partial<RateLimitTestRequest> = {}): RateLimitTestRequest {
  return {
    method: 'GET',
    path: '/api/test',
    ip: '203.0.113.9',
    socket: { remoteAddress: '203.0.113.9' },
    ...overrides,
  } as RateLimitTestRequest;
}

describe('@oxyhq/core/server rate limiter', () => {
  beforeEach(() => {
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
  });

  it('does not trust locally decoded non-session JWT identities for quota or bucket keys', () => {
    const oxy = makeOxy((req: RateLimitTestRequest, _res: Response, next: NextFunction) => {
      req.userId = 'attacker-controlled-user';
      req.user = { id: 'attacker-controlled-user' };
      next();
    });
    const req = makeRequest();
    const next = jest.fn();

    createOxyRateLimit(oxy, { authenticatedMax: 5000, anonymousMax: 600 })(
      req,
      {} as Response,
      next,
    );

    expect(req.observedMax).toBe(600);
    expect(req.observedKey).toBe('203.0.113.9');
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
    expect(req.observedKey).toBe('203.0.113.9');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

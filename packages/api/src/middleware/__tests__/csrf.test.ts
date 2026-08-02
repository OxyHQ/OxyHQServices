import type { Request, Response } from 'express';
import { verifyCsrfToken } from '../csrf';

const mockWarn = jest.fn();

jest.mock('../../utils/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockWarn(...args),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

function createResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function runVerify(req: Partial<Request>) {
  const res = createResponse();
  const next = jest.fn();

  verifyCsrfToken(
    {
      method: 'POST',
      headers: {},
      cookies: {},
      path: '/users/target/follow',
      ip: '127.0.0.1',
      ...req,
    } as Request,
    res,
    next,
  );

  return { res, next };
}

describe('verifyCsrfToken', () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  it('allows state-changing requests with an explicit bearer token and no CSRF header', () => {
    const { res, next } = runVerify({
      headers: {
        authorization: 'Bearer user-session-token',
      },
      cookies: {
        csrf_token: 'cookie-token',
      },
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects cookie-authenticated requests when header and cookie tokens differ in length', () => {
    const { res, next } = runVerify({
      cookies: {
        csrf_token: 'short',
      },
      headers: {
        'x-csrf-token': 'much-longer-header-token-value',
      },
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({
      message: 'Invalid CSRF token',
      code: 'CSRF_TOKEN_INVALID',
    });
  });

  it('still rejects cookie-authenticated state-changing requests without a CSRF header', () => {
    const { res, next } = runVerify({
      cookies: {
        csrf_token: 'cookie-token',
      },
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({
      message: 'CSRF token missing',
      code: 'CSRF_TOKEN_MISSING',
    });
  });

  // Regression contract for the server-to-server bulk hydration endpoint
  // (`POST /users/by-ids`), which Mention calls with a SERVICE TOKEN in the
  // Authorization header and no cookie jar. The bearer skip MUST pass it, while
  // an ambient cookie-credentialed browser write to the same path with no CSRF
  // header MUST still be rejected. This locks the contract that lets Mention's
  // bulk path be safely re-enabled.
  describe('POST /users/by-ids (service-to-service contract)', () => {
    it('passes a service-token/bearer POST with no cookie and no CSRF header', () => {
      const { res, next } = runVerify({
        path: '/by-ids',
        headers: { authorization: 'Bearer service-token' },
        cookies: {},
      });

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects a cookie-only POST to the same path with no CSRF header', () => {
      const { res, next } = runVerify({
        path: '/by-ids',
        headers: {},
        cookies: { csrf_token: 'cookie-token' },
      });

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.body).toEqual({
        message: 'CSRF token missing',
        code: 'CSRF_TOKEN_MISSING',
      });
    });
  });
});

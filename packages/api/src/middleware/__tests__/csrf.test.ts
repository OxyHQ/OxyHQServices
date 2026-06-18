import { Request, Response } from 'express';
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
});

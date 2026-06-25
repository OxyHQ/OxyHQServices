/**
 * optionalUserOrServiceAuth + resolveViewerId — the dual-auth viewer resolution
 * for the recommendation surface.
 *
 * The token-verification primitives (`verifyServiceToken` from ./auth,
 * `authenticateRequestNonBlocking` from ./authUtils) are mocked so we exercise
 * the REAL middleware/resolver branching without a DB or real JWTs.
 *
 * Asserts:
 *  - a VALID service token attaches `req.serviceApp` (non-blocking),
 *  - an INVALID/expired token attaches NO principal (anonymous) — never rejected,
 *  - a service token + `user:read` + valid `X-Oxy-User-Id` → that viewer id,
 *  - a service token WITHOUT `user:read` ignores the header (anonymous),
 *  - a malformed / missing `X-Oxy-User-Id` → anonymous,
 *  - a USER token resolves to its OWN session user and IGNORES `X-Oxy-User-Id`
 *    (anti-impersonation),
 *  - no token → anonymous.
 */

// The global mongoose mock (jest.setup.cjs) omits `Types`, which optionalAuth's
// resolveViewerId uses (`Types.ObjectId.isValid`). Restore the REAL mongoose.
jest.mock('mongoose', () => jest.requireActual('mongoose'));
// jest.setup.cjs globally stubs jsonwebtoken (verify always returns a fixed
// user and never throws). getMediaViewerUserId's whole contract is real
// signature verification + ignoreExpiration, so restore the REAL jsonwebtoken.
jest.mock('jsonwebtoken', () => jest.requireActual('jsonwebtoken'));
import { Types } from 'mongoose';
import type { Response } from 'express';

const mockVerifyServiceToken = jest.fn();
jest.mock('../auth', () => ({
  __esModule: true,
  verifyServiceToken: (...args: unknown[]) => mockVerifyServiceToken(...args),
}));

const mockAuthNonBlocking = jest.fn();
// Fully mock authUtils (rather than requireActual) so loading optionalAuth does
// NOT pull in the real session.service → Session model chain, which the global
// mongoose mock cannot construct. We provide only the two members optionalAuth
// consumes: a pure bearer extractor and the non-blocking authenticator.
jest.mock('../authUtils', () => ({
  __esModule: true,
  extractTokenFromRequest: (req: { headers: Record<string, string | undefined> }): string | undefined => {
    const auth = req.headers.authorization;
    return auth && auth.startsWith('Bearer ') ? auth.substring(7) : undefined;
  },
  authenticateRequestNonBlocking: (...args: unknown[]) => mockAuthNonBlocking(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import jwt from 'jsonwebtoken';
import {
  optionalUserOrServiceAuth,
  resolveViewerId,
  getMediaViewerUserId,
  type OptionalUserOrServiceRequest,
} from '../optionalAuth';

function makeReq(overrides: Partial<OptionalUserOrServiceRequest> = {}): OptionalUserOrServiceRequest {
  return {
    headers: {},
    ...overrides,
  } as OptionalUserOrServiceRequest;
}

function runMiddleware(req: OptionalUserOrServiceRequest): Promise<void> {
  const res = {} as Response;
  return new Promise((resolve) => {
    void optionalUserOrServiceAuth(req, res, () => resolve());
  });
}

const VIEWER_ID = new Types.ObjectId().toHexString();
const OTHER_ID = new Types.ObjectId().toHexString();

beforeEach(() => {
  mockVerifyServiceToken.mockReset();
  mockAuthNonBlocking.mockReset();
  mockAuthNonBlocking.mockResolvedValue({ user: null, source: null });
});

describe('optionalUserOrServiceAuth', () => {
  it('attaches req.serviceApp for a VALID service token and does not consult user-session auth', async () => {
    mockVerifyServiceToken.mockReturnValue({
      ok: true,
      payload: { type: 'service', appId: 'app1', appName: 'Mention', credentialId: 'c', scopes: ['user:read'] },
    });
    const req = makeReq({ headers: { authorization: 'Bearer svc' } });

    await runMiddleware(req);

    expect(req.serviceApp?.appId).toBe('app1');
    expect(req.user).toBeUndefined();
    expect(mockAuthNonBlocking).not.toHaveBeenCalled();
  });

  it('falls back to user-session auth when the token is NOT a service token', async () => {
    mockVerifyServiceToken.mockReturnValue({ ok: false, reason: 'not_service' });
    mockAuthNonBlocking.mockResolvedValue({ user: { _id: VIEWER_ID }, source: 'header' });
    const req = makeReq({ headers: { authorization: 'Bearer user' } });

    await runMiddleware(req);

    expect(req.serviceApp).toBeUndefined();
    expect(req.user?._id).toBe(VIEWER_ID);
  });

  it('attaches NO principal for an INVALID token (anonymous, never rejected)', async () => {
    mockVerifyServiceToken.mockReturnValue({ ok: false, reason: 'invalid' });
    mockAuthNonBlocking.mockResolvedValue({ user: null, source: 'header' });
    const req = makeReq({ headers: { authorization: 'Bearer garbage' } });

    await runMiddleware(req);

    expect(req.serviceApp).toBeUndefined();
    expect(req.user).toBeUndefined();
  });

  it('attaches NO principal for an EXPIRED token (anonymous)', async () => {
    mockVerifyServiceToken.mockReturnValue({ ok: false, reason: 'expired' });
    mockAuthNonBlocking.mockResolvedValue({ user: null, source: 'header' });
    const req = makeReq({ headers: { authorization: 'Bearer expired' } });

    await runMiddleware(req);

    expect(req.serviceApp).toBeUndefined();
    expect(req.user).toBeUndefined();
  });

  it('treats a request with no Authorization header as anonymous (user-session path yields null)', async () => {
    const req = makeReq();
    await runMiddleware(req);
    expect(req.serviceApp).toBeUndefined();
    expect(req.user).toBeUndefined();
    // verifyServiceToken is never called without a token.
    expect(mockVerifyServiceToken).not.toHaveBeenCalled();
  });
});

describe('resolveViewerId', () => {
  it('resolves the SESSION user for a user-token request and IGNORES X-Oxy-User-Id (anti-impersonation)', () => {
    const req = makeReq({
      user: { _id: VIEWER_ID } as OptionalUserOrServiceRequest['user'],
      headers: { 'x-oxy-user-id': OTHER_ID },
    });
    expect(resolveViewerId(req)).toBe(VIEWER_ID);
  });

  it('resolves X-Oxy-User-Id for a service token holding user:read', () => {
    const req = makeReq({
      serviceApp: { type: 'service', appId: 'a', appName: 'n', credentialId: 'c', scopes: ['user:read'] },
      headers: { 'x-oxy-user-id': VIEWER_ID },
    });
    expect(resolveViewerId(req)).toBe(VIEWER_ID);
  });

  it('returns undefined for a service token WITHOUT user:read even with a valid header', () => {
    const req = makeReq({
      serviceApp: { type: 'service', appId: 'a', appName: 'n', credentialId: 'c', scopes: ['files:write'] },
      headers: { 'x-oxy-user-id': VIEWER_ID },
    });
    expect(resolveViewerId(req)).toBeUndefined();
  });

  it('returns undefined for a service token with a MALFORMED X-Oxy-User-Id', () => {
    const req = makeReq({
      serviceApp: { type: 'service', appId: 'a', appName: 'n', credentialId: 'c', scopes: ['user:read'] },
      headers: { 'x-oxy-user-id': 'not-an-objectid' },
    });
    expect(resolveViewerId(req)).toBeUndefined();
  });

  it('returns undefined for a service token with NO X-Oxy-User-Id (acts as itself)', () => {
    const req = makeReq({
      serviceApp: { type: 'service', appId: 'a', appName: 'n', credentialId: 'c', scopes: ['user:read'] },
      headers: {},
    });
    expect(resolveViewerId(req)).toBeUndefined();
  });

  it('returns undefined when no principal is present', () => {
    expect(resolveViewerId(makeReq())).toBeUndefined();
  });
});

/**
 * getMediaViewerUserId — resolves the viewer for `<img src>`/`<a download>`
 * media URLs that cannot carry an Authorization header but DO carry the
 * SDK-issued access token in `?token=`. Uses the REAL `jsonwebtoken` (not
 * mocked) signed with a test ACCESS_TOKEN_SECRET.
 */
describe('getMediaViewerUserId (private media owner-from-query-token)', () => {
  const SECRET = 'test-access-secret';
  let prevSecret: string | undefined;

  function makeMediaReq(
    query: Record<string, unknown>,
    user?: { _id: string },
  ): OptionalUserOrServiceRequest {
    return { headers: {}, query, user } as unknown as OptionalUserOrServiceRequest;
  }

  beforeAll(() => {
    prevSecret = process.env.ACCESS_TOKEN_SECRET;
    process.env.ACCESS_TOKEN_SECRET = SECRET;
  });

  afterAll(() => {
    if (prevSecret === undefined) {
      delete process.env.ACCESS_TOKEN_SECRET;
    } else {
      process.env.ACCESS_TOKEN_SECRET = prevSecret;
    }
  });

  it('prefers the authenticated session user and ignores the query token', () => {
    const otherToken = jwt.sign({ userId: 'attacker' }, SECRET);
    const req = makeMediaReq({ token: otherToken }, { _id: 'session-owner' });
    expect(getMediaViewerUserId(req)).toBe('session-owner');
  });

  it('resolves the owner from a valid ?token= when no session user is present', () => {
    const token = jwt.sign({ userId: 'owner-123', type: 'access' }, SECRET, { expiresIn: '15m' });
    expect(getMediaViewerUserId(makeMediaReq({ token }))).toBe('owner-123');
  });

  it('still resolves the owner from an EXPIRED token (stale cached <img> URL)', () => {
    // Signed 1h ago with a 15m TTL → already expired, but the owner must still
    // be able to render their own private media from a cached URL.
    const token = jwt.sign({ userId: 'owner-123', iat: Math.floor(1_700_000_000) }, SECRET, {
      expiresIn: '15m',
    });
    // Re-sign as definitively expired.
    const expired = jwt.sign({ userId: 'owner-123', exp: 1, iat: 1 }, SECRET);
    expect(getMediaViewerUserId(makeMediaReq({ token: expired }))).toBe('owner-123');
    expect(getMediaViewerUserId(makeMediaReq({ token }))).toBe('owner-123');
  });

  it('returns undefined for a token signed with the WRONG secret (forged)', () => {
    const forged = jwt.sign({ userId: 'attacker' }, 'wrong-secret');
    expect(getMediaViewerUserId(makeMediaReq({ token: forged }))).toBeUndefined();
  });

  it('returns undefined for a garbage / malformed token', () => {
    expect(getMediaViewerUserId(makeMediaReq({ token: 'not-a-jwt' }))).toBeUndefined();
  });

  it('returns undefined when no token and no session user are present', () => {
    expect(getMediaViewerUserId(makeMediaReq({}))).toBeUndefined();
  });

  it('returns undefined when ACCESS_TOKEN_SECRET is not configured', () => {
    const token = jwt.sign({ userId: 'owner-123' }, SECRET);
    delete process.env.ACCESS_TOKEN_SECRET;
    expect(getMediaViewerUserId(makeMediaReq({ token }))).toBeUndefined();
    process.env.ACCESS_TOKEN_SECRET = SECRET;
  });
});

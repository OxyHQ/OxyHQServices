/**
 * optionalUserOrServiceAuth + resolveViewerId — the dual-auth viewer resolution
 * for the recommendation surface.
 *
 * The token-verification primitives (`verifyServiceToken` from ./serviceToken,
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
import { Types } from 'mongoose';
import type { Response } from 'express';

const mockVerifyServiceToken = jest.fn();
jest.mock('../serviceToken', () => ({
  __esModule: true,
  verifyServiceToken: (...args: unknown[]) => mockVerifyServiceToken(...args),
}));

const mockAuthNonBlocking = jest.fn();
const mockValidateSessionToken = jest.fn();
const mockDecodeToken = jest.fn();
// Fully mock authUtils (rather than requireActual) so loading optionalAuth does
// NOT pull in the real session.service → Session model chain, which the global
// mongoose mock cannot construct. We provide only the members optionalAuth
// consumes: a pure bearer extractor, non-blocking authenticator, and session validator.
jest.mock('../authUtils', () => ({
  __esModule: true,
  decodeToken: (...args: unknown[]) => mockDecodeToken(...args),
  extractTokenFromRequest: (req: { headers: Record<string, string | undefined> }): string | undefined => {
    const auth = req.headers.authorization;
    return auth && auth.startsWith('Bearer ') ? auth.substring(7) : undefined;
  },
  authenticateRequestNonBlocking: (...args: unknown[]) => mockAuthNonBlocking(...args),
  validateSessionToken: (...args: unknown[]) => mockValidateSessionToken(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

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
  mockValidateSessionToken.mockReset();
  mockValidateSessionToken.mockResolvedValue(null);
  mockDecodeToken.mockReset();
  mockDecodeToken.mockReturnValue(null);
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
 * media URLs that cannot carry an Authorization header but DO carry an
 * SDK-issued access token in `?token=`. Query tokens must validate through the
 * normal session-token path so expiry, sessionId, and active-session checks are
 * enforced.
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

  it('prefers the authenticated session user and ignores the query token', async () => {
    mockValidateSessionToken.mockResolvedValue({ _id: 'attacker' });
    const req = makeMediaReq({ token: 'valid-attacker-token' }, { _id: 'session-owner' });
    await expect(getMediaViewerUserId(req)).resolves.toBe('session-owner');
    expect(mockValidateSessionToken).not.toHaveBeenCalled();
  });

  it('resolves the owner from an active access-session ?token= when no session user is present', async () => {
    mockDecodeToken.mockReturnValue({ type: 'access', sessionId: 'session-123', userId: 'owner-123' });
    mockValidateSessionToken.mockResolvedValue({ _id: 'owner-123' });
    await expect(getMediaViewerUserId(makeMediaReq({ token: 'active-access-token' }))).resolves.toBe('owner-123');
    expect(mockDecodeToken).toHaveBeenCalledWith('active-access-token');
    expect(mockValidateSessionToken).toHaveBeenCalledWith('active-access-token');
  });

  it('returns undefined for an expired access token instead of ignoring expiration', async () => {
    mockValidateSessionToken.mockResolvedValue(null);
    await expect(getMediaViewerUserId(makeMediaReq({ token: 'expired-access-token' }))).resolves.toBeUndefined();
    expect(mockDecodeToken).toHaveBeenCalledWith('expired-access-token');
    expect(mockValidateSessionToken).not.toHaveBeenCalled();
  });

  it('returns undefined for a 2FA challenge JWT that is not an access session', async () => {
    mockValidateSessionToken.mockResolvedValue(null);
    await expect(getMediaViewerUserId(makeMediaReq({ token: '2fa-challenge-login-token' }))).resolves.toBeUndefined();
    expect(mockDecodeToken).toHaveBeenCalledWith('2fa-challenge-login-token');
    expect(mockValidateSessionToken).not.toHaveBeenCalled();
  });

  it('returns undefined for a JWT without type access even when it has a userId', async () => {
    mockDecodeToken.mockReturnValue({ userId: 'owner-123', purpose: '2fa_challenge' });
    await expect(getMediaViewerUserId(makeMediaReq({ token: 'non-access-token' }))).resolves.toBeUndefined();
    expect(mockValidateSessionToken).not.toHaveBeenCalled();
  });

  it('returns undefined for an access JWT without a sessionId', async () => {
    mockDecodeToken.mockReturnValue({ type: 'access', userId: 'owner-123' });
    await expect(getMediaViewerUserId(makeMediaReq({ token: 'no-session-token' }))).resolves.toBeUndefined();
    expect(mockValidateSessionToken).not.toHaveBeenCalled();
  });

  it('returns undefined for a revoked/logged-out session token', async () => {
    mockDecodeToken.mockReturnValue({ type: 'access', sessionId: 'session-123', userId: 'owner-123' });
    mockValidateSessionToken.mockResolvedValue(null);
    await expect(getMediaViewerUserId(makeMediaReq({ token: 'revoked-session-token' }))).resolves.toBeUndefined();
    expect(mockValidateSessionToken).toHaveBeenCalledWith('revoked-session-token');
  });

  it('returns undefined for a garbage / malformed token', async () => {
    mockDecodeToken.mockReturnValue(null);
    await expect(getMediaViewerUserId(makeMediaReq({ token: 'not-a-jwt' }))).resolves.toBeUndefined();
    expect(mockValidateSessionToken).not.toHaveBeenCalled();
  });

  it('returns undefined when no token and no session user are present', async () => {
    await expect(getMediaViewerUserId(makeMediaReq({}))).resolves.toBeUndefined();
    expect(mockValidateSessionToken).not.toHaveBeenCalled();
  });

  it('returns undefined when ACCESS_TOKEN_SECRET is not configured', async () => {
    delete process.env.ACCESS_TOKEN_SECRET;
    await expect(getMediaViewerUserId(makeMediaReq({ token: 'active-access-token' }))).resolves.toBeUndefined();
    expect(mockValidateSessionToken).not.toHaveBeenCalled();
    process.env.ACCESS_TOKEN_SECRET = SECRET;
  });
});

/**
 * User-token authentication security regression tests
 *
 * Locks in the fix for the `oxy.auth()` authentication bypass.
 *
 * Before the fix, `auth()` decoded the bearer JWT with `jwtDecode` (which does
 * NOT verify a signature) and, when the payload carried no `sessionId`, trusted
 * the decoded `userId` claim outright:
 *
 *   req.userId = userId;                 // straight from an unverified claim
 *   req.user   = { id: userId } as User;
 *
 * That let anyone authenticate as anyone on every Oxy backend mounting
 * `oxy.auth()` / `createOxyAuthMiddleware()` by hand-rolling a JWT with a
 * `userId` claim, a future `exp`, and a garbage signature. No network call
 * happened on that path at all.
 *
 * Two distinct holes are covered here:
 *
 *   1. **Session-less user tokens were trusted.** Every user access token the
 *      Oxy API mints carries a `sessionId` (`utils/sessionUtils.ts`
 *      `generateSessionTokens`). The only session-less user JWTs it issues are
 *      the 2FA challenge token and the account-recovery token — both
 *      PRE-authentication. Accepting them as a session was an escalation even
 *      without forgery. There is therefore no legitimate session-less user
 *      token, and the path is now refused outright rather than gated behind a
 *      flag.
 *
 *   2. **The session path trusted the claimed user id.** `GET
 *      /session/validate/:sessionId` is unauthenticated and returns whichever
 *      user owns the session; it does not bind the bearer token. `auth()` then
 *      set `req.userId` from the JWT claim rather than from the validated
 *      session, so a caller holding ANY live session id could pair it with a
 *      forged `userId` and become that user. `authSocket()` already guarded
 *      this; the HTTP middleware did not.
 *
 * These tests exercise a real `OxyServices` instance with `validateSession`
 * stubbed, so the middleware's own logic runs end to end without the network.
 */

import crypto from 'node:crypto';
import { OxyServices } from '../../OxyServices';
import type { User } from '../../models/interfaces';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserTokenClaims {
  userId?: string;
  id?: string;
  sessionId?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

const b64url = (input: Buffer | string): string => {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const ONE_HOUR_FROM_NOW = (): number => Math.floor(Date.now() / 1000) + 3600;

/** A JWT whose signature is invented. Structurally valid, cryptographically worthless. */
const forgeToken = (claims: UserTokenClaims, signature = 'AAAAcompletely-invented-signature'): string => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: ONE_HOUR_FROM_NOW(), ...claims }));
  return `${header}.${payload}.${signature}`;
};

/** An `alg: none` JWT — the classic unsigned-token attack. */
const forgeAlgNoneToken = (claims: UserTokenClaims): string => {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: ONE_HOUR_FROM_NOW(), ...claims }));
  return `${header}.${payload}.`;
};

/**
 * A genuinely signed session access token, byte-identical in shape to what
 * `jsonwebtoken.sign()` produces in the API's `generateSessionTokens`.
 * The middleware never checks this signature for user tokens — security comes
 * from the session round-trip — but signing it keeps the fixtures honest about
 * what production actually sends.
 */
const signSessionToken = (claims: UserTokenClaims, secret: string): string => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      exp: ONE_HOUR_FROM_NOW(),
      type: 'access',
      deviceId: 'device-1',
      ...claims,
    }),
  );
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${payload}.${signature}`;
};

interface MockReq {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  userId?: string | null;
  user?: unknown;
  accessToken?: string;
  sessionId?: string | null;
  serviceApp?: unknown;
  serviceActingAs?: unknown;
}

interface MockRes {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
  status(code: number): MockRes;
  json(body: unknown): MockRes;
}

const makeReq = (overrides: Partial<MockReq> = {}): MockReq => ({
  method: 'GET',
  path: '/api/whoami',
  headers: {},
  query: {},
  ...overrides,
});

const makeRes = (): MockRes => ({
  statusCode: 0,
  body: undefined,
  headersSent: false,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(body: unknown) {
    this.body = body;
    this.headersSent = true;
    return this;
  },
});

/** Run the middleware against the loose Express shape it declares internally. */
const run = async (
  middleware: ReturnType<OxyServices['auth']>,
  req: MockReq,
  res: MockRes,
  next: jest.Mock,
): Promise<void> => {
  await middleware(req as unknown as never, res as unknown as never, next as unknown as never);
};

const VICTIM_ID = '507f1f77bcf86cd799439011';
const ATTACKER_ID = '507f1f77bcf86cd799439022';
const ACCESS_TOKEN_SECRET = 'test-access-token-secret-not-production';

const asUser = (id: string): User => ({ id }) as User;

// ---------------------------------------------------------------------------
// Hole 1 — session-less user tokens must never authenticate
// ---------------------------------------------------------------------------

describe('user tokens without a sessionId are refused', () => {
  let oxy: OxyServices;
  let validateSpy: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    // Any call here would mean the middleware went to the network on a path
    // that must be decided locally. Assertions below check it never happens.
    validateSpy = jest.spyOn(oxy, 'validateSession');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects a forged token whose signature is garbage', async () => {
    const req = makeReq({ headers: { authorization: `Bearer ${forgeToken({ userId: VICTIM_ID })}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'SESSION_REQUIRED' });
    expect(req.userId).toBeUndefined();
    expect(req.user).toBeUndefined();
    expect(validateSpy).not.toHaveBeenCalled();
  });

  it('rejects a token with an empty signature segment', async () => {
    const req = makeReq({ headers: { authorization: `Bearer ${forgeToken({ userId: VICTIM_ID }, '')}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(req.userId).toBeUndefined();
  });

  it('rejects an alg:none token', async () => {
    const req = makeReq({ headers: { authorization: `Bearer ${forgeAlgNoneToken({ userId: VICTIM_ID })}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'SESSION_REQUIRED' });
    expect(req.userId).toBeUndefined();
  });

  it('rejects a session-less token that carries the id claim instead of userId', async () => {
    const req = makeReq({ headers: { authorization: `Bearer ${forgeToken({ id: VICTIM_ID })}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(req.userId).toBeUndefined();
  });

  it("rejects the API's 2FA challenge token, which is genuinely signed but pre-authentication", async () => {
    // controllers/session.controller.ts mints exactly this shape after the
    // password step and BEFORE the second factor. It is signed with
    // ACCESS_TOKEN_SECRET and has no sessionId.
    const loginToken = signSessionToken({ userId: VICTIM_ID, purpose: '2fa_challenge' }, ACCESS_TOKEN_SECRET);
    const req = makeReq({ headers: { authorization: `Bearer ${loginToken}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'SESSION_REQUIRED' });
    expect(req.userId).toBeUndefined();
  });

  it("rejects the API's account-recovery token", async () => {
    const recoveryToken = signSessionToken(
      { type: 'recovery', recoveryId: 'rec-1', userId: VICTIM_ID },
      ACCESS_TOKEN_SECRET,
    );
    const req = makeReq({ headers: { authorization: `Bearer ${recoveryToken}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(req.userId).toBeUndefined();
  });

  it('never loads a user profile for a session-less token, even with loadUser', async () => {
    const getCurrentUserSpy = jest.spyOn(oxy, 'getCurrentUser');
    const req = makeReq({ headers: { authorization: `Bearer ${forgeToken({ userId: VICTIM_ID })}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth({ loadUser: true }), req, res, next);

    expect(res.statusCode).toBe(401);
    expect(getCurrentUserSpy).not.toHaveBeenCalled();
  });

  it('treats a session-less token as anonymous under optional auth, never as the claimed user', async () => {
    const req = makeReq({ headers: { authorization: `Bearer ${forgeToken({ userId: VICTIM_ID })}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth({ optional: true }), req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headersSent).toBe(false);
    expect(req.userId).toBeNull();
    expect(req.user).toBeNull();
  });

  it('reports SESSION_REQUIRED through a custom onError handler', async () => {
    const onError = jest.fn();
    const req = makeReq({ headers: { authorization: `Bearer ${forgeToken({ userId: VICTIM_ID })}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth({ onError }), req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.headersSent).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'SESSION_REQUIRED', status: 401 }));
  });
});

// ---------------------------------------------------------------------------
// Hole 2 — the identity must come from the validated session, not the claim
// ---------------------------------------------------------------------------

describe('session-backed user tokens bind identity to the validated session', () => {
  let oxy: OxyServices;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects a token pairing a live session with a forged userId claim', async () => {
    // The attacker holds their OWN valid session and swaps the userId claim.
    jest.spyOn(oxy, 'validateSession').mockResolvedValue({
      valid: true,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      lastActivity: new Date().toISOString(),
      user: asUser(ATTACKER_ID),
    });

    const token = forgeToken({ userId: VICTIM_ID, sessionId: 'attacker-session' });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'SESSION_USER_MISMATCH' });
    expect(req.userId).toBeUndefined();
  });

  it('rejects a session whose validation returns no user', async () => {
    jest.spyOn(oxy, 'validateSession').mockResolvedValue({
      valid: true,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      lastActivity: new Date().toISOString(),
    } as unknown as Awaited<ReturnType<OxyServices['validateSession']>>);

    const token = forgeToken({ userId: VICTIM_ID, sessionId: 'session-1' });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(req.userId).toBeUndefined();
  });

  it('accepts a matching session and takes the id from the server, not the token', async () => {
    jest.spyOn(oxy, 'validateSession').mockResolvedValue({
      valid: true,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      lastActivity: new Date().toISOString(),
      user: asUser(VICTIM_ID),
    });

    const token = signSessionToken({ userId: VICTIM_ID, sessionId: 'session-1' }, ACCESS_TOKEN_SECRET);
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headersSent).toBe(false);
    expect(req.userId).toBe(VICTIM_ID);
    expect(req.sessionId).toBe('session-1');
    expect(req.accessToken).toBe(token);
    expect(req.user).toEqual({ id: VICTIM_ID });
  });

  it('accepts a session identified by the raw Mongo _id shape', async () => {
    jest.spyOn(oxy, 'validateSession').mockResolvedValue({
      valid: true,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      lastActivity: new Date().toISOString(),
      user: { _id: VICTIM_ID } as unknown as User,
    });

    const token = signSessionToken({ userId: VICTIM_ID, sessionId: 'session-1' }, ACCESS_TOKEN_SECRET);
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe(VICTIM_ID);
  });

  it('attaches the full validated profile when loadUser is set', async () => {
    const fullUser = { id: VICTIM_ID, username: 'victim', email: 'victim@example.com' } as User;
    jest.spyOn(oxy, 'validateSession').mockResolvedValue({
      valid: true,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      lastActivity: new Date().toISOString(),
      user: fullUser,
    });

    const token = signSessionToken({ userId: VICTIM_ID, sessionId: 'session-1' }, ACCESS_TOKEN_SECRET);
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth({ loadUser: true }), req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(fullUser);
  });

  it('rejects an invalid session', async () => {
    jest.spyOn(oxy, 'validateSession').mockResolvedValue({
      valid: false,
    } as unknown as Awaited<ReturnType<OxyServices['validateSession']>>);

    const token = signSessionToken({ userId: VICTIM_ID, sessionId: 'revoked' }, ACCESS_TOKEN_SECRET);
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'INVALID_SESSION' });
  });

  it('rejects an expired token before any session round-trip', async () => {
    const validateSpy = jest.spyOn(oxy, 'validateSession');
    const token = forgeToken({ userId: VICTIM_ID, sessionId: 'session-1', exp: Math.floor(Date.now() / 1000) - 1 });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth(), req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(validateSpy).not.toHaveBeenCalled();
  });

  it('falls back to anonymous, not to the claim, when optional auth hits a mismatch', async () => {
    jest.spyOn(oxy, 'validateSession').mockResolvedValue({
      valid: true,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      lastActivity: new Date().toISOString(),
      user: asUser(ATTACKER_ID),
    });

    const token = forgeToken({ userId: VICTIM_ID, sessionId: 'attacker-session' });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = jest.fn();

    await run(oxy.auth({ optional: true }), req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBeNull();
    expect(req.user).toBeNull();
  });
});

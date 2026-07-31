/**
 * POST /auth/session/deliver/:authorizeCode
 * POST /auth/session/opened/:authorizeCode
 * GET  /auth/session/status/:sessionToken  (delivery-progress projection)
 *
 * Phase 4 automatic Commons delivery, exercised end to end through the REAL
 * route + REAL delivery service with only the data layer and the push transport
 * mocked.
 *
 * The security contract these tests exist to pin:
 *
 *  - `deliver` REQUIRES a bearer, and the bearer is the control, not a
 *    convenience: the delivery target is the AUTHENTICATED user, never anything
 *    from the request body or the bound request. Oxy can therefore never be made
 *    to push a sign-in prompt at someone by typing their username into an
 *    unauthenticated browser.
 *  - Only installs of an `Application` carrying the staff-controlled
 *    `identity:approval` capability are targeted. No capable install ⇒ zero
 *    targets, no send, and a 200 (the client falls back to QR).
 *  - The response is counts only, and the push payload is exactly
 *    `{ type, approvalUrl }`.
 *  - `opened` needs no bearer (the public approval handle is the credential), is
 *    idempotent, pending-only, and never moves `status`.
 *  - Progress travels as TIMESTAMPS on the status endpoint; the socket emission
 *    is a payload-free wake signal.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockAuthSessionFindOne = jest.fn();
const mockAuthSessionUpdateOne = jest.fn();
const mockApplicationFind = jest.fn();
const mockApplicationFindById = jest.fn();
const mockPushTokenFind = jest.fn();
const mockSendPushToTokens = jest.fn();
const mockEmitAuthSessionUpdate = jest.fn();
const mockEmitAuthSessionProgress = jest.fn();

/** Identity the mocked bearer middleware resolves for an authenticated request. */
const mockBearerUser = { current: 'user-1' };

jest.mock('../../middleware/auth', () => ({
  // Behaves like the real middleware for the one property under test: without an
  // Authorization header there is no authenticated principal and the request is
  // rejected before the handler runs.
  authMiddleware: (
    req: { headers: Record<string, string | undefined>; user?: unknown },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.headers.authorization) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }
    req.user = { _id: mockBearerUser.current, username: 'ada', publicKey: 'pk-1' };
    next();
  },
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  AuthSession: { findOne: mockAuthSessionFindOne, updateOne: mockAuthSessionUpdateOne },
  default: { findOne: mockAuthSessionFindOne, updateOne: mockAuthSessionUpdateOne },
}));
jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { find: mockApplicationFind, findById: mockApplicationFindById, findOne: jest.fn() },
  default: { find: mockApplicationFind, findById: mockApplicationFindById, findOne: jest.fn() },
}));
jest.mock('../../models/PushToken', () => ({
  __esModule: true,
  PushToken: { find: mockPushTokenFind },
  default: { find: mockPushTokenFind },
}));
jest.mock('../../services/push.service', () => ({
  __esModule: true,
  pushService: { sendPushToTokens: mockSendPushToTokens, sendPushNotification: jest.fn() },
  default: { sendPushToTokens: mockSendPushToTokens, sendPushNotification: jest.fn() },
}));
jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: (...args: unknown[]) => mockEmitAuthSessionUpdate(...args),
  emitAuthSessionProgress: (...args: unknown[]) => mockEmitAuthSessionProgress(...args),
}));

// Remaining static imports of routes/auth.ts — mocked so the real Mongoose
// schemas never run under the global mongoose mock.
jest.mock('../../models/Session', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../models/AuthCode', () => ({ __esModule: true, AuthCode: { create: jest.fn() }, default: { create: jest.fn() } }));
jest.mock('../../models/ApplicationCredential', () => ({ __esModule: true, ApplicationCredential: { findOne: jest.fn() }, default: { findOne: jest.fn() } }));
jest.mock('../../models/User', () => ({ __esModule: true, User: { findOne: jest.fn(), findById: jest.fn() }, default: { findOne: jest.fn(), findById: jest.fn() } }));
jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
}));
jest.mock('../../services/authSession.service', () => ({
  claimAuthSession: jest.fn(),
  authorizeSessionWithSignedChallenge: jest.fn(),
  authorizeSessionWithBearer: jest.fn(),
  finalizeOAuthAuthorization: jest.fn(),
  resolveOAuthContext: jest.fn(() => null),
  verifyDelegatedSubject: jest.fn(),
}));
jest.mock('../../services/session.service', () => ({ __esModule: true, default: { createSession: jest.fn() } }));
jest.mock('../../services/oauthCode.service', () => ({ issueAuthCode: jest.fn(), exchangeAuthCode: jest.fn(), AUTH_CODE_TTL_MS: 60_000 }));
jest.mock('../../services/signature.service', () => ({ __esModule: true, default: { verifyChallengeResponse: jest.fn(), isValidPublicKey: jest.fn() } }));
jest.mock('../../utils/userTransform', () => ({ formatUserResponse: jest.fn() }));
jest.mock('../../controllers/session.controller', () => ({
  SessionController: {
    register: jest.fn(), signUp: jest.fn(), signIn: jest.fn(), requestChallenge: jest.fn(),
    verifyChallenge: jest.fn(), requestPasswordReset: jest.fn(), verifyRecoveryCode: jest.fn(),
    resetPassword: jest.fn(), getUserByPublicKey: jest.fn(),
  },
}));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import authRouter from '../auth';
import { closePostgres, connectPostgres, getDb } from '../../config/postgres';
import { applications as applicationsTable } from '../../db/schema/applications';
import { authSessions } from '../../db/schema/authSessions';
import { users } from '../../db/schema/users';
import { errorHandler } from '../../middleware/errorHandler';
import { IDENTITY_APPROVAL_CAPABILITY } from '../../utils/applicationCapabilities';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function request(
  server: http.Server,
  method: 'GET' | 'POST',
  path: string,
  options: { bearer?: string; payload?: Record<string, unknown> } = {},
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(options.payload ?? {});
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
  };
  if (options.bearer) {
    headers.authorization = `Bearer ${options.bearer}`;
  }

  return new Promise((resolve, reject) => {
    const req = http.request({ method, host: '127.0.0.1', port: address.port, path, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** `.select(...).lean()` chain used by the delivery lookups. */
function chain<T>(rows: T[]) {
  return { select: () => ({ lean: () => Promise.resolve(rows) }) };
}

function pendingSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionToken: 'secret-session-token',
    authorizeCode: 'code-1',
    status: 'pending',
    expiresAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  };
}

let server: http.Server;

/**
 * A pending request in REAL Postgres.
 *
 * The delivery service is still Mongo-backed and is mocked above; the status
 * endpoint is ported and reads `auth_sessions`, so the progress projection is
 * asserted against a stored row rather than a stubbed document.
 */
async function storedPendingRequest(
  overrides: Partial<typeof authSessions.$inferInsert> = {},
): Promise<string> {
  const [owner] = await getDb().insert(users).values({}).returning({ id: users.id });
  const [app] = await getDb()
    .insert(applicationsTable)
    .values({ name: `App ${randomUUID()}`, ownerAccountId: owner.id })
    .returning({ id: applicationsTable.id });
  const sessionToken = `at_${randomUUID().replace(/-/g, '')}`;
  await getDb()
    .insert(authSessions)
    .values({
      sessionToken,
      authorizeCode: randomUUID().replace(/-/g, ''),
      applicationId: app.id,
      expiresAt: new Date(Date.now() + 3_600_000),
      status: 'pending',
      ...overrides,
    });
  return sessionToken;
}

beforeAll(async () => {
  await connectPostgres();
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closePostgres();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockBearerUser.current = 'user-1';
  mockAuthSessionUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockSendPushToTokens.mockResolvedValue({ targeted: 1, accepted: 1 });
});

describe('POST /auth/session/deliver/:authorizeCode — bearer is the control', () => {
  it('rejects an unauthenticated caller before any lookup', async () => {
    const res = await request(server, 'POST', '/auth/session/deliver/code-1');

    expect(res.status).toBe(401);
    expect(mockAuthSessionFindOne).not.toHaveBeenCalled();
    expect(mockSendPushToTokens).not.toHaveBeenCalled();
  });

  it('targets the AUTHENTICATED identity, never a user named in the body', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([{ token: 'tok-vault' }]));

    const res = await request(server, 'POST', '/auth/session/deliver/code-1', {
      bearer: 'token',
      payload: { userId: 'victim-42', username: 'victim', identityUserId: 'victim-42' },
    });

    expect(res.status).toBe(200);
    expect(mockPushTokenFind).toHaveBeenCalledWith({
      userId: 'user-1',
      applicationId: { $in: ['app-commons'] },
    });
    expect(mockSendPushToTokens.mock.calls[0][0]).toMatchObject({ userId: 'user-1' });
  });
});

describe('POST /auth/session/deliver/:authorizeCode — capability-scoped targeting', () => {
  it('delivers to the identity\'s capable installs and answers with counts only', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([{ token: 'tok-vault-1' }, { token: 'tok-vault-2' }]));
    mockSendPushToTokens.mockResolvedValue({ targeted: 2, accepted: 2 });

    const res = await request(server, 'POST', '/auth/session/deliver/code-1', { bearer: 'token' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ delivered: true, targets: 2 });

    expect(mockApplicationFind).toHaveBeenCalledWith({
      status: 'active',
      capabilities: IDENTITY_APPROVAL_CAPABILITY,
    });

    const push = mockSendPushToTokens.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(push.data).toEqual({
      type: 'oxy_commons_auth_request',
      approvalUrl: 'oxycommons://approve?v=1&code=code-1',
    });

    // The secret sessionToken is never exposed to the client on this path.
    expect(JSON.stringify(res.body)).not.toContain('secret-session-token');
  });

  it('yields zero targets and sends nothing when the install lacks the capability', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    // The user HAS a vault install, but no application carries the capability,
    // so the capability-scoped query resolves no eligible install.
    mockApplicationFind.mockReturnValue(chain([]));

    const res = await request(server, 'POST', '/auth/session/deliver/code-1', { bearer: 'token' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ delivered: false, targets: 0 });
    expect(mockSendPushToTokens).not.toHaveBeenCalled();
    expect(mockEmitAuthSessionProgress).not.toHaveBeenCalled();
  });

  it('yields zero targets when this identity has no capable install of its own', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([]));

    const res = await request(server, 'POST', '/auth/session/deliver/code-1', { bearer: 'token' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ delivered: false, targets: 0 });
    expect(mockSendPushToTokens).not.toHaveBeenCalled();
  });
});

describe('POST /auth/session/deliver/:authorizeCode — failures never break the flow', () => {
  it('answers 200 with a well-formed body when the push transport fails', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([{ token: 'tok-vault' }]));
    mockSendPushToTokens.mockRejectedValue(new Error('expo unreachable'));

    const res = await request(server, 'POST', '/auth/session/deliver/code-1', { bearer: 'token' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ delivered: false, targets: 1 });
    expect(mockEmitAuthSessionProgress).not.toHaveBeenCalled();
  });

  it('404s an unknown authorizeCode', async () => {
    mockAuthSessionFindOne.mockResolvedValue(null);

    const res = await request(server, 'POST', '/auth/session/deliver/nope', { bearer: 'token' });

    expect(res.status).toBe(404);
    expect(mockSendPushToTokens).not.toHaveBeenCalled();
  });

  it('400s a request that is no longer pending', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession({ status: 'authorized' }));

    const res = await request(server, 'POST', '/auth/session/deliver/code-1', { bearer: 'token' });

    expect(res.status).toBe(400);
    expect(mockSendPushToTokens).not.toHaveBeenCalled();
  });
});

describe('POST /auth/session/deliver/:authorizeCode — progress signalling', () => {
  it('wakes the waiting originator with a payload-free signal on its secret channel', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([{ token: 'tok-vault' }]));

    await request(server, 'POST', '/auth/session/deliver/code-1', { bearer: 'token' });

    expect(mockEmitAuthSessionProgress).toHaveBeenCalledTimes(1);
    expect(mockEmitAuthSessionProgress).toHaveBeenCalledWith('secret-session-token');
    // Progress never travels as a status on the socket.
    expect(mockEmitAuthSessionUpdate).not.toHaveBeenCalled();
  });

  it('records pushSentAt as a timestamp, leaving status untouched', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());
    mockApplicationFind.mockReturnValue(chain([{ _id: 'app-commons' }]));
    mockPushTokenFind.mockReturnValue(chain([{ token: 'tok-vault' }]));

    await request(server, 'POST', '/auth/session/deliver/code-1', { bearer: 'token' });

    const [filter, update] = mockAuthSessionUpdateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(filter).toEqual({ authorizeCode: 'code-1', status: 'pending', pushSentAt: null });
    expect(Object.keys(update.$set)).toEqual(['pushSentAt']);
  });
});

describe('POST /auth/session/opened/:authorizeCode', () => {
  it('needs no bearer — the public approval handle is the credential', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());

    const res = await request(server, 'POST', '/auth/session/opened/code-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true });
    expect(mockEmitAuthSessionProgress).toHaveBeenCalledWith('secret-session-token');
  });

  it('writes openedAt once, pending-only and unexpired-only, never status', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession());

    await request(server, 'POST', '/auth/session/opened/code-1');

    const [filter, update] = mockAuthSessionUpdateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(filter).toMatchObject({ authorizeCode: 'code-1', status: 'pending', openedAt: null });
    expect(filter.expiresAt).toEqual({ $gt: expect.any(Date) });
    expect(Object.keys(update.$set)).toEqual(['openedAt']);
  });

  it('is idempotent: a repeat call succeeds and emits nothing', async () => {
    mockAuthSessionFindOne.mockResolvedValue(pendingSession({ openedAt: new Date() }));
    mockAuthSessionUpdateOne.mockResolvedValue({ modifiedCount: 0 });

    const res = await request(server, 'POST', '/auth/session/opened/code-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true });
    expect(mockEmitAuthSessionProgress).not.toHaveBeenCalled();
  });

  it('404s an unknown authorizeCode', async () => {
    mockAuthSessionFindOne.mockResolvedValue(null);

    const res = await request(server, 'POST', '/auth/session/opened/nope');

    expect(res.status).toBe(404);
    expect(mockAuthSessionUpdateOne).not.toHaveBeenCalled();
  });
});

describe('GET /auth/session/status/:sessionToken — delivery progress projection', () => {
  it('exposes pushSentAt and openedAt while leaving the status machine alone', async () => {
    const pushSentAt = new Date('2026-07-27T10:00:00.000Z');
    const openedAt = new Date('2026-07-27T10:00:05.000Z');
    const sessionToken = await storedPendingRequest({ pushSentAt, openedAt });

    const res = await request(server, 'GET', `/auth/session/status/${sessionToken}`);

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    // Progress is TIMESTAMPS beside the state machine, never inside it: neither
    // "pushed" nor "opened" is a status a waiting client could misread as an
    // authorization.
    expect(data.status).toBe('pending');
    expect(data.authorized).toBe(false);
    expect(data.pushSentAt).toBe('2026-07-27T10:00:00.000Z');
    expect(data.openedAt).toBe('2026-07-27T10:00:05.000Z');
    // …and the stored row still says pending too.
    const [row] = await getDb()
      .select({ status: authSessions.status })
      .from(authSessions)
      .where(eq(authSessions.sessionToken, sessionToken))
      .limit(1);
    expect(row.status).toBe('pending');
  });

  it('emits null timestamps for a request that was never pushed or opened', async () => {
    const sessionToken = await storedPendingRequest();

    const res = await request(server, 'GET', `/auth/session/status/${sessionToken}`);

    const data = res.body.data as Record<string, unknown>;
    expect(data.pushSentAt).toBeNull();
    expect(data.openedAt).toBeNull();
  });
});

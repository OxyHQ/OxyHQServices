/**
 * `GET|POST /auth/oauth/userinfo` — OpenID Connect Core §5.3.
 *
 * This is how a relying party (Matrix Authentication Service with
 * `fetch_userinfo: true`) learns WHO the upstream account is, so the shape is
 * load-bearing:
 *
 *  - the body is FLAT (§5.3.2), never the API's `{ data: … }` envelope;
 *  - `sub` is the immutable user id, never the mutable username (§2 requires
 *    `sub` to be stable and never reassigned);
 *  - claims Oxy cannot prove are absent — notably `email_verified`;
 *  - it is bearer-authenticated, and both GET and POST are accepted (§5.3.1).
 *
 * `formatUserResponse` is the REAL transform here, so the claim mapping is
 * exercised against the real user DTO rather than a stub of it.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const ISSUER = 'https://api.oxy.test';
process.env.OAUTH_ISSUER = ISSUER;

const mockAuthMiddleware = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
  AuthSession: { findOne: jest.fn() },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('../../services/authSession.service', () => ({
  claimAuthSession: jest.fn(),
  authorizeSessionWithSignedChallenge: jest.fn(),
}));

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: jest.fn(), findOne: jest.fn() },
  default: { create: jest.fn(), findOne: jest.fn() },
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: jest.fn() },
  default: { findOne: jest.fn() },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findOne: jest.fn() },
  default: { findOne: jest.fn() },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn(), findById: jest.fn() },
  default: { findOne: jest.fn(), findById: jest.fn() },
}));

jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
}));

jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: jest.fn(),
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: jest.fn(), getSession: jest.fn(), refreshTokens: jest.fn() },
}));

jest.mock('../../services/deviceLogin.service', () => ({
  finalizeDeviceLogin: jest.fn(),
}));

jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: {
    isValidPublicKey: jest.fn(),
    verifyChallengeResponse: jest.fn(),
    verifyRegistrationSignature: jest.fn(),
    verifySignature: jest.fn(),
    generateChallenge: jest.fn(),
    shortenPublicKey: jest.fn(),
  },
}));

jest.mock('../../controllers/session.controller', () => ({
  SessionController: {
    register: jest.fn(),
    signUp: jest.fn(),
    signIn: jest.fn(),
    requestChallenge: jest.fn(),
    verifyChallenge: jest.fn(),
    requestPasswordReset: jest.fn(),
    verifyRecoveryCode: jest.fn(),
    resetPassword: jest.fn(),
    getUserByPublicKey: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../socialAuth', () => ({
  __esModule: true,
  default: express.Router(),
}));

import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';

const UPDATED_AT = new Date('2026-01-02T03:04:05.000Z');

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

async function request(method: 'GET' | 'POST'): Promise<HttpResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path: '/auth/oauth/userinfo',
        headers: { authorization: 'Bearer an-access-token' },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: raw.length > 0 ? JSON.parse(raw) : {},
            });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function authenticateAs(user: Record<string, unknown>): void {
  mockAuthMiddleware.mockImplementation(
    (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = user;
      next();
    },
  );
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  authenticateAs({
    _id: '507f1f77bcf86cd799439011',
    username: 'tester',
    email: 'tester@example.com',
    avatar: 'avatar-file-id',
    name: { first: 'Ada', last: 'Lovelace' },
    updatedAt: UPDATED_AT,
  });
});

describe('GET /auth/oauth/userinfo', () => {
  it('returns the OIDC standard claims FLAT, with no { data } envelope', async () => {
    const res = await request('GET');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('data');
    expect(res.body).toEqual({
      sub: '507f1f77bcf86cd799439011',
      preferred_username: 'tester',
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
      picture: `${ISSUER}/assets/avatar-file-id/stream?variant=thumb`,
      email: 'tester@example.com',
      updated_at: Math.floor(UPDATED_AT.getTime() / 1000),
    });
  });

  it('uses the immutable user id as `sub`, never the username', async () => {
    const res = await request('GET');
    expect(res.body.sub).toBe('507f1f77bcf86cd799439011');
    expect(res.body.sub).not.toBe('tester');
  });

  it('never asserts email_verified, which Oxy does not track', async () => {
    const res = await request('GET');
    expect(res.body).not.toHaveProperty('email_verified');
  });

  it('omits claims the account does not have rather than sending nulls', async () => {
    authenticateAs({ _id: '507f1f77bcf86cd799439011', username: 'handleonly' });

    const res = await request('GET');

    expect(res.body).toEqual({ sub: '507f1f77bcf86cd799439011', preferred_username: 'handleonly' });
  });

  it('passes an already-absolute avatar URL through untouched', async () => {
    authenticateAs({
      _id: '507f1f77bcf86cd799439011',
      username: 'tester',
      avatar: 'https://cdn.example.com/a.png',
    });

    const res = await request('GET');

    expect(res.body.picture).toBe('https://cdn.example.com/a.png');
  });

  it('is not cacheable', async () => {
    const res = await request('GET');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('rejects an unauthenticated request', async () => {
    mockAuthMiddleware.mockImplementation(
      (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      },
    );

    const res = await request('GET');

    expect(res.status).toBe(401);
  });
});

describe('POST /auth/oauth/userinfo', () => {
  it('is accepted as well as GET (OIDC Core §5.3.1)', async () => {
    const res = await request('POST');

    expect(res.status).toBe(200);
    expect(res.body.sub).toBe('507f1f77bcf86cd799439011');
  });
});

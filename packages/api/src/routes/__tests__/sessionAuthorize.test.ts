/**
 * /auth/session/authorize/:sessionToken tests (C2 regression coverage)
 *
 * Pre-fix this route trusted the `x-session-id` header alone to identify
 * the authorising user — anyone with a captured session ID could approve
 * cross-app sign-ins on the victim's behalf.
 *
 * The route now requires `Authorization: Bearer <accessToken>` via
 * `authMiddleware`. These tests:
 *  - call without any Authorization header → expect 401, AuthSession
 *    must not be modified;
 *  - call with x-session-id but NO bearer token → still 401;
 *  - call with a valid bearer token → AuthSession is authorised by the
 *    bearer principal (NOT by anything read from x-session-id).
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockAuthSessionFindOne = jest.fn();
const mockCreateSession = jest.fn();
const mockEmitAuthSessionUpdate = jest.fn();
const mockApplicationFindOne = jest.fn();
const mockApplicationFindById = jest.fn();
const mockApplicationCredentialFindOne = jest.fn();
const mockAuthCodeCreate = jest.fn();

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
  default: { findOne: mockAuthSessionFindOne },
  AuthSession: { findOne: mockAuthSessionFindOne },
}));

// Session model — the auth route file imports it for use by
// `/auth/session/claim`. We don't exercise that path in this suite,
// but the bare default-export is required so the module loads.
jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

// authSession.service is consumed by `/auth/session/claim` only; we
// mock it to avoid the model import chain.
jest.mock('../../services/authSession.service', () => ({
  claimAuthSession: jest.fn(),
}));

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: mockAuthCodeCreate },
  default: { create: mockAuthCodeCreate },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findOne: mockApplicationFindOne, findById: mockApplicationFindById },
  default: { findOne: mockApplicationFindOne, findById: mockApplicationFindById },
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: mockApplicationCredentialFindOne },
  default: { findOne: mockApplicationCredentialFindOne },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn(), findById: jest.fn() },
  default: { findOne: jest.fn(), findById: jest.fn() },
}));

jest.mock('../../models/RefreshToken', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  RefreshToken: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
}));

jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: jest.fn(),
}));

jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: mockEmitAuthSessionUpdate,
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: mockCreateSession },
}));

jest.mock('../../services/oauthCode.service', () => ({
  issueAuthCode: jest.fn(),
  exchangeAuthCode: jest.fn(),
  AUTH_CODE_TTL_MS: 60_000,
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

interface JsonResponse {
  status: number;
  body: { error?: string; message?: string };
}

async function requestJson(
  server: http.Server,
  method: string,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {}
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = raw.length > 0 ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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
});

describe('POST /auth/session/authorize/:sessionToken (C2)', () => {
  it('returns 401 when no Authorization header is present (even with x-session-id)', async () => {
    // Simulate the unauthenticated path: authMiddleware rejects.
    mockAuthMiddleware.mockImplementationOnce(
      (_req: unknown, res: { status: (n: number) => { json: (v: unknown) => unknown } }) => {
        res.status(401).json({ error: 'Authentication required', message: 'Invalid or missing authorization header' });
      }
    );

    const res = await requestJson(server, 'POST', '/auth/session/authorize/token-abc', {}, {
      // Legacy header — must be ignored now.
      'x-session-id': 'stolen-session-id',
    });

    expect(res.status).toBe(401);
    // AuthSession lookup must NOT have happened — the middleware bounced us.
    expect(mockAuthSessionFindOne).not.toHaveBeenCalled();
  });

  it('uses the authenticated user from the bearer token (not x-session-id)', async () => {
    const authenticatedUserId = '64f7c2a1b8e9d3f4a1c2b3d4';
    mockAuthMiddleware.mockImplementationOnce(
      (req: { user?: unknown }, _res: unknown, next: () => void) => {
        req.user = {
          _id: { toString: () => authenticatedUserId },
          publicKey: 'pk-of-real-user',
          username: 'real-user',
        };
        next();
      }
    );

    const authSession = {
      sessionToken: 'token-abc',
      applicationId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3aa' },
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockAuthSessionFindOne.mockResolvedValueOnce(authSession);

    // The authorize handler loads the bound Application for the device label.
    mockApplicationFindById.mockResolvedValueOnce({ name: 'Acme Widgets' });

    mockCreateSession.mockResolvedValueOnce({
      sessionId: 'new-sess',
      deviceId: 'dev-1',
      expiresAt: new Date(Date.now() + 60_000),
      accessToken: 'new-token',
    });

    const res = await requestJson(
      server,
      'POST',
      '/auth/session/authorize/token-abc',
      {},
      {
        Authorization: 'Bearer valid-bearer-token',
        // Should be ignored entirely.
        'x-session-id': 'stolen-session-id',
      }
    );

    expect(res.status).toBe(200);
    expect(mockCreateSession).toHaveBeenCalledWith(
      authenticatedUserId, // taken from the BEARER token, not the header
      expect.anything(),
      expect.objectContaining({ deviceName: 'Acme Widgets App' })
    );
    expect(authSession.save).toHaveBeenCalled();
  });
});

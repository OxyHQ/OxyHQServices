/**
 * /auth/session/authorize-code/:authorizeCode tests
 *
 * Bearer-authed sibling of `/auth/session/authorize/:sessionToken` (see
 * `sessionAuthorize.test.ts`), keyed on the PUBLIC `authorizeCode` instead of
 * the secret `sessionToken` — for an approver (e.g. the auth.oxy.so passkey
 * hub) that authenticates via bearer token but never holds the secret. These
 * tests mirror the sibling's C2 coverage (bearer-only authorization) plus the
 * authorizeCode-specific lookup behavior.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

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

// authSession.service is consumed by `/auth/session/claim` and
// `/auth/session/authorize-signed` only; mocked to avoid the model import chain.
jest.mock('../../services/authSession.service', () => ({
  claimAuthSession: jest.fn(),
  authorizeSessionWithSignedChallenge: jest.fn(),
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

// auth.ts statically imports the AppGrant model (OAuth consent
// grants); mock them so the real Mongoose schema does not run under the global
// mongoose mock (which lacks Schema.Types).
jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
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

describe('POST /auth/session/authorize-code/:authorizeCode', () => {
  it('returns 401 when no Authorization header is present', async () => {
    mockAuthMiddleware.mockImplementationOnce(
      (_req: unknown, res: { status: (n: number) => { json: (v: unknown) => unknown } }) => {
        res.status(401).json({ error: 'Authentication required', message: 'Invalid or missing authorization header' });
      }
    );

    const res = await requestJson(server, 'POST', '/auth/session/authorize-code/code-abc', {});

    expect(res.status).toBe(401);
    // AuthSession lookup must NOT have happened — the middleware bounced us.
    expect(mockAuthSessionFindOne).not.toHaveBeenCalled();
  });

  it('authorizes the session by the PUBLIC authorizeCode, never the secret sessionToken', async () => {
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
      sessionToken: 'secret-token-only-the-opener-holds',
      applicationId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3aa' },
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockAuthSessionFindOne.mockResolvedValueOnce(authSession);
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
      '/auth/session/authorize-code/code-abc',
      {},
      { Authorization: 'Bearer valid-bearer-token' }
    );

    expect(res.status).toBe(200);
    // Looked up by authorizeCode + pending, not by sessionToken.
    expect(mockAuthSessionFindOne).toHaveBeenCalledWith({ authorizeCode: 'code-abc', status: 'pending' });
    expect(mockCreateSession).toHaveBeenCalledWith(
      authenticatedUserId,
      expect.anything(),
      expect.objectContaining({ deviceName: 'Acme Widgets App' })
    );
    expect(authSession.status).toBe('authorized');
    expect(authSession.save).toHaveBeenCalled();
    // The waiting originator is woken on ITS secret sessionToken channel, which
    // this caller never saw or transmitted.
    expect(mockEmitAuthSessionUpdate).toHaveBeenCalledWith(
      'secret-token-only-the-opener-holds',
      expect.objectContaining({ status: 'authorized', sessionId: 'new-sess' }),
    );
  });

  it('returns 404 when the authorizeCode is unknown or already processed', async () => {
    mockAuthMiddleware.mockImplementationOnce(
      (req: { user?: unknown }, _res: unknown, next: () => void) => {
        req.user = { _id: { toString: () => 'user-1' }, username: 'someone' };
        next();
      }
    );
    mockAuthSessionFindOne.mockResolvedValueOnce(null);

    const res = await requestJson(
      server,
      'POST',
      '/auth/session/authorize-code/unknown-code',
      {},
      { Authorization: 'Bearer valid-bearer-token' }
    );

    expect(res.status).toBe(404);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});

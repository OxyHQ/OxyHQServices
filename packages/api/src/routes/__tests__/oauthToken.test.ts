/**
 * POST /auth/oauth/token — authorization-code exchange tests.
 *
 * Pins the zero-cookie contract: a successful exchange always returns
 * `deviceId` + `deviceSecret` (never `refresh_token`), and fails closed when
 * device-secret minting does not succeed.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockApplicationCredentialFindOne = jest.fn();
const mockApplicationFindOne = jest.fn();
const mockApplicationSave = jest.fn();
const mockExchangeAuthCode = jest.fn();
const mockUserFindById = jest.fn();
const mockCreateSession = jest.fn();
const mockFinalizeDeviceLogin = jest.fn();
const mockFormatUserResponse = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: jest.fn(),
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
  authorizeSessionWithBearer: jest.fn(),
}));

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: jest.fn() },
  default: { create: jest.fn() },
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: mockApplicationCredentialFindOne },
  default: { findOne: mockApplicationCredentialFindOne },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findOne: mockApplicationFindOne },
  default: { findOne: mockApplicationFindOne },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: mockUserFindById },
  default: { findById: mockUserFindById },
}));

jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: (...args: unknown[]) => mockFormatUserResponse(...args),
}));

jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: jest.fn(),
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    createSession: (...args: unknown[]) => mockCreateSession(...args),
  },
}));

jest.mock('../../services/deviceLogin.service', () => ({
  finalizeDeviceLogin: (...args: unknown[]) => mockFinalizeDeviceLogin(...args),
}));

jest.mock('../../services/oauthCode.service', () => ({
  issueAuthCode: jest.fn(),
  exchangeAuthCode: (...args: unknown[]) => mockExchangeAuthCode(...args),
  AUTH_CODE_TTL_MS: 60_000,
  canonicalizeOAuthRedirectUri: (uri: string) => uri,
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

jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
}));

import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: {
    data?: Record<string, unknown>;
    error?: string;
    message?: string;
  };
}

async function requestJson(
  server: http.Server,
  payload: Record<string, unknown>,
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port: address.port,
        path: '/auth/oauth/token',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = raw.length > 0 ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const APP_ID = '507f1f77bcf86cd799439011';
const CLIENT_ID = 'oxy_dk_test_client';
const REDIRECT_URI = 'https://app.example/callback';

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

  mockApplicationCredentialFindOne.mockResolvedValue({
    publicKey: CLIENT_ID,
    status: 'active',
    applicationId: APP_ID,
    secretHash: null,
  });
  mockApplicationFindOne.mockResolvedValue({
    _id: { toString: () => APP_ID },
    status: 'active',
    name: 'Test App',
    save: mockApplicationSave,
  });
  mockExchangeAuthCode.mockResolvedValue({
    ok: true,
    code: { userId: 'user-1', deviceId: 'device-from-code' },
  });
  mockUserFindById.mockResolvedValue({
    _id: { toString: () => 'user-1' },
    username: 'tester',
  });
  mockCreateSession.mockResolvedValue({
    sessionId: 'sess-1',
    deviceId: 'device-1',
    accessToken: 'access-token-1',
  });
  mockFinalizeDeviceLogin.mockResolvedValue({ deviceSecret: 'device-secret-1' });
  mockFormatUserResponse.mockReturnValue({ id: 'user-1', username: 'tester' });
  mockApplicationSave.mockResolvedValue(undefined);
});

describe('POST /auth/oauth/token', () => {
  it('returns device-first session fields on a PKCE public-client exchange', async () => {
    const res = await requestJson(server, {
      code: 'auth-code-1',
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: 'pkce-verifier',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      access_token: 'access-token-1',
      token_type: 'Bearer',
      session_id: 'sess-1',
      deviceId: 'device-1',
      deviceSecret: 'device-secret-1',
      user: { id: 'user-1', username: 'tester' },
    });
    expect(res.body.data).not.toHaveProperty('refresh_token');
    expect(mockExchangeAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({
        rawCode: 'auth-code-1',
        appId: APP_ID,
        redirectUri: REDIRECT_URI,
        clientSecretProvided: false,
        codeVerifier: 'pkce-verifier',
      }),
    );
  });

  it('returns 401 when the authorization code exchange fails', async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({ ok: false, reason: 'invalid_grant' });

    const res = await requestJson(server, {
      code: 'bad-code',
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: 'pkce-verifier',
    });

    expect(res.status).toBe(401);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns 500 when deviceSecret minting fails (fail-closed)', async () => {
    mockFinalizeDeviceLogin.mockResolvedValueOnce({});

    const res = await requestJson(server, {
      code: 'auth-code-1',
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: 'pkce-verifier',
    });

    expect(res.status).toBe(500);
    expect(res.body.data).toBeUndefined();
  });
});

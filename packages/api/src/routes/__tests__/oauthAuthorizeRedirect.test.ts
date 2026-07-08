/**
 * POST /auth/oauth/authorize — redirect_uri allowlist tests (issue #216,
 * ported to the Application model set for issue #213).
 *
 * The authorize endpoint resolves the `clientId` to an active
 * ApplicationCredential (by publicKey) → its Application, then validates the
 * supplied `redirect_uri` against the Application's `redirectUris` allowlist
 * using an EXACT, constant-time match (RFC 6749 §3.1.2). These tests pin that
 * behaviour so the Console↔OAuth field normalisation cannot regress it:
 *  - an exactly-registered URI is accepted (code minted);
 *  - a URI that differs only by a trailing slash is rejected (no prefix /
 *    normalised matching);
 *  - an unrelated URI is rejected;
 *  - any one of several registered URIs is accepted;
 *  - a registered localhost callback URI is accepted.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockApplicationCredentialFindOne = jest.fn();
const mockApplicationFindOne = jest.fn();
const mockIssueAuthCode = jest.fn();

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
  User: { findOne: jest.fn(), findById: jest.fn() },
  default: { findOne: jest.fn(), findById: jest.fn() },
}));


jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: jest.fn(),
}));

jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: jest.fn(),
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: jest.fn() },
}));

jest.mock('../../services/oauthCode.service', () => {
  const actual = jest.requireActual('../../services/oauthCode.service') as typeof import('../../services/oauthCode.service');
  return {
    ...actual,
    issueAuthCode: (...args: unknown[]) => mockIssueAuthCode(...args),
    exchangeAuthCode: jest.fn(),
  };
});

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
  body: { code?: string; redirectUri?: string; error?: string; message?: string; data?: { code?: string; redirectUri?: string } };
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
  // Default: authenticated user.
  mockAuthMiddleware.mockImplementation(
    (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { _id: { toString: () => 'user-1' } };
      next();
    }
  );
  mockIssueAuthCode.mockResolvedValue({ code: 'raw-code-123' });
  // Default: a valid active credential pointing at application `app-1`.
  mockApplicationCredentialFindOne.mockResolvedValue({
    _id: { toString: () => 'cred-1' },
    publicKey: 'oxy_dk_client',
    applicationId: 'app-1',
    status: 'active',
  });
});

function appWithRedirectUris(redirectUris: string[]) {
  return {
    _id: { toString: () => 'app-1' },
    status: 'active',
    redirectUris,
  };
}

describe('POST /auth/oauth/authorize — redirect_uri allowlist (#216)', () => {
  it('accepts an exactly-registered redirect_uri and mints a code', async () => {
    mockApplicationFindOne.mockResolvedValueOnce(
      appWithRedirectUris(['https://app.example.com/callback'])
    );

    const res = await requestJson(
      server,
      'POST',
      '/auth/oauth/authorize',
      { clientId: 'oxy_dk_client', redirectUri: 'https://app.example.com/callback' },
      { Authorization: 'Bearer t' }
    );

    expect(res.status).toBe(200);
    expect(mockIssueAuthCode).toHaveBeenCalledTimes(1);
    expect(mockIssueAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: 'https://app.example.com/callback' })
    );
  });

  it('rejects a redirect_uri that differs only by a trailing slash (exact match preserved)', async () => {
    mockApplicationFindOne.mockResolvedValueOnce(
      appWithRedirectUris(['https://app.example.com/callback'])
    );

    const res = await requestJson(
      server,
      'POST',
      '/auth/oauth/authorize',
      { clientId: 'oxy_dk_client', redirectUri: 'https://app.example.com/callback/' },
      { Authorization: 'Bearer t' }
    );

    expect(res.status).toBe(403);
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
  });

  it('rejects an unrelated redirect_uri', async () => {
    mockApplicationFindOne.mockResolvedValueOnce(
      appWithRedirectUris(['https://app.example.com/callback'])
    );

    const res = await requestJson(
      server,
      'POST',
      '/auth/oauth/authorize',
      { clientId: 'oxy_dk_client', redirectUri: 'https://evil.example.com/callback' },
      { Authorization: 'Bearer t' }
    );

    expect(res.status).toBe(403);
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
  });

  it('accepts any one of several registered redirect URIs', async () => {
    mockApplicationFindOne.mockResolvedValueOnce(
      appWithRedirectUris([
        'https://app.example.com/callback',
        'https://app.example.com/alt-callback',
        'https://staging.example.com/callback',
      ])
    );

    const res = await requestJson(
      server,
      'POST',
      '/auth/oauth/authorize',
      { clientId: 'oxy_dk_client', redirectUri: 'https://staging.example.com/callback' },
      { Authorization: 'Bearer t' }
    );

    expect(res.status).toBe(200);
    expect(mockIssueAuthCode).toHaveBeenCalledTimes(1);
  });

  it('accepts a registered localhost callback redirect_uri', async () => {
    mockApplicationFindOne.mockResolvedValueOnce(
      appWithRedirectUris(['http://localhost:3000/callback'])
    );

    const res = await requestJson(
      server,
      'POST',
      '/auth/oauth/authorize',
      { clientId: 'oxy_dk_client', redirectUri: 'http://localhost:3000/callback' },
      { Authorization: 'Bearer t' }
    );

    expect(res.status).toBe(200);
    expect(mockIssueAuthCode).toHaveBeenCalledTimes(1);
  });

  it('rejects when the app has no registered redirect URIs', async () => {
    mockApplicationFindOne.mockResolvedValueOnce(appWithRedirectUris([]));

    const res = await requestJson(
      server,
      'POST',
      '/auth/oauth/authorize',
      { clientId: 'oxy_dk_client', redirectUri: 'https://app.example.com/callback' },
      { Authorization: 'Bearer t' }
    );

    expect(res.status).toBe(403);
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
  });
});

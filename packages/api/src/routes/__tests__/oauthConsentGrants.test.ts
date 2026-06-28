/**
 * Tests for the OAuth consent decision + connected-apps (grants) endpoints:
 *  - GET    /auth/oauth/consent          → trusted / granted / scope_changed / new
 *  - GET    /auth/grants                 → list connected apps
 *  - DELETE /auth/grants/:applicationId  → revoke (AppGrant + matching FedCMGrant)
 *
 * Mounts the real authRouter and stubs only the data sources. `normaliseOrigin`
 * (utils/origin) is the REAL helper so the FedCM-origin derivation on revoke is
 * exercised end-to-end.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockApplicationCredentialFindOne = jest.fn();
const mockApplicationFindOne = jest.fn();
const mockApplicationFindById = jest.fn();
const mockApplicationFind = jest.fn();
const mockAppGrantFindOne = jest.fn();
const mockAppGrantFind = jest.fn();
const mockAppGrantFindOneAndUpdate = jest.fn();
const mockAppGrantDeleteOne = jest.fn();
const mockFedCMGrantDeleteMany = jest.fn();
const mockSessionUpdateMany = jest.fn();

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

jest.mock('../../utils/validation', () => ({
  isValidObjectId: (id: string) => /^[a-f0-9]{24}$/i.test(id),
}));

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
  AuthSession: { findOne: jest.fn() },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateMany: mockSessionUpdateMany },
}));

jest.mock('../../services/authSession.service', () => ({
  claimAuthSession: jest.fn(),
  authorizeSessionWithSignedChallenge: jest.fn(),
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
  Application: {
    findOne: mockApplicationFindOne,
    findById: mockApplicationFindById,
    find: mockApplicationFind,
  },
  default: {
    findOne: mockApplicationFindOne,
    findById: mockApplicationFindById,
    find: mockApplicationFind,
  },
}));

jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: {
    findOne: mockAppGrantFindOne,
    find: mockAppGrantFind,
    findOneAndUpdate: mockAppGrantFindOneAndUpdate,
    deleteOne: mockAppGrantDeleteOne,
  },
  default: {
    findOne: mockAppGrantFindOne,
    find: mockAppGrantFind,
    findOneAndUpdate: mockAppGrantFindOneAndUpdate,
    deleteOne: mockAppGrantDeleteOne,
  },
}));

jest.mock('../../models/FedCMGrant', () => ({
  __esModule: true,
  FedCMGrant: { deleteMany: mockFedCMGrantDeleteMany },
  default: { deleteMany: mockFedCMGrantDeleteMany },
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
  emitAuthSessionUpdate: jest.fn(),
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: jest.fn() },
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
  body: {
    data?: {
      consentRequired?: boolean;
      reason?: string;
      revoked?: boolean;
      [k: string]: unknown;
    } & Array<unknown>;
    error?: string;
    message?: string;
  };
}

async function requestJson(
  server: http.Server,
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw.length > 0 ? JSON.parse(raw) : {} });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** ApplicationCredential.findOne returns a flat doc (no chaining). */
function credential(applicationId: string) {
  return { _id: { toString: () => 'cred-1' }, applicationId, status: 'active' };
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
  mockAuthMiddleware.mockImplementation(
    (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { _id: { toString: () => '507f1f77bcf86cd799439011' } };
      next();
    }
  );
});

describe('GET /auth/oauth/consent', () => {
  const REDIRECT = 'https://app.example.com/callback';

  function consentUrl(scope?: string) {
    const params = new URLSearchParams({ clientId: 'oxy_dk_client', redirectUri: REDIRECT });
    if (scope) params.set('scope', scope);
    return `/auth/oauth/consent?${params.toString()}`;
  }

  it('auto-approves a TRUSTED app (reason: trusted) regardless of scopes', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(credential('app-1'));
    mockApplicationFindOne.mockResolvedValue({
      _id: { toString: () => 'app-1' },
      status: 'active',
      isOfficial: true,
      redirectUris: [REDIRECT],
    });

    const res = await requestJson(server, 'GET', consentUrl('a b c'), { Authorization: 'Bearer t' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ consentRequired: false, reason: 'trusted' });
    // A trusted app must never hit the grant store.
    expect(mockAppGrantFindOne).not.toHaveBeenCalled();
  });

  it('skips consent when a prior grant covers the requested scopes (reason: granted)', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(credential('app-1'));
    mockApplicationFindOne.mockResolvedValue({
      _id: { toString: () => 'app-1' },
      status: 'active',
      type: 'third_party',
      redirectUris: [REDIRECT],
    });
    mockAppGrantFindOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ scopes: ['profile:read', 'email:read'] }) }),
    });

    const res = await requestJson(server, 'GET', consentUrl('profile:read'), { Authorization: 'Bearer t' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ consentRequired: false, reason: 'granted' });
  });

  it('requires consent when a new scope is requested (reason: scope_changed)', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(credential('app-1'));
    mockApplicationFindOne.mockResolvedValue({
      _id: { toString: () => 'app-1' },
      status: 'active',
      type: 'third_party',
      redirectUris: [REDIRECT],
    });
    mockAppGrantFindOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ scopes: ['profile:read'] }) }),
    });

    const res = await requestJson(
      server,
      'GET',
      consentUrl('profile:read email:read'),
      { Authorization: 'Bearer t' }
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ consentRequired: true, reason: 'scope_changed' });
  });

  it('requires consent for a third-party app with no prior grant (reason: new)', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(credential('app-1'));
    mockApplicationFindOne.mockResolvedValue({
      _id: { toString: () => 'app-1' },
      status: 'active',
      type: 'third_party',
      redirectUris: [REDIRECT],
    });
    mockAppGrantFindOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) }),
    });

    const res = await requestJson(server, 'GET', consentUrl('profile:read'), { Authorization: 'Bearer t' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ consentRequired: true, reason: 'new' });
  });

  it('rejects an unregistered redirect_uri with 403 (exact match)', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(credential('app-1'));
    mockApplicationFindOne.mockResolvedValue({
      _id: { toString: () => 'app-1' },
      status: 'active',
      type: 'third_party',
      redirectUris: ['https://app.example.com/other'],
    });

    const res = await requestJson(server, 'GET', consentUrl(), { Authorization: 'Bearer t' });

    expect(res.status).toBe(403);
  });

  it('rejects an unknown client with 400', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(null);

    const res = await requestJson(server, 'GET', consentUrl(), { Authorization: 'Bearer t' });

    expect(res.status).toBe(400);
  });
});

describe('GET /auth/grants', () => {
  it('lists the user grants joined with application name + logo', async () => {
    mockAppGrantFind.mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: () =>
            Promise.resolve([
              {
                applicationId: { toString: () => 'app-1' },
                scopes: ['profile:read'],
                firstGrantedAt: new Date('2026-01-01T00:00:00.000Z'),
                lastUsedAt: new Date('2026-02-01T00:00:00.000Z'),
              },
              {
                applicationId: { toString: () => 'missing-app' },
                scopes: ['email:read'],
                firstGrantedAt: new Date('2026-01-01T00:00:00.000Z'),
                lastUsedAt: new Date('2026-01-15T00:00:00.000Z'),
              },
            ]),
        }),
      }),
    });
    mockApplicationFind.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve([
            { _id: { toString: () => 'app-1' }, name: 'Third Party App', icon: 'file-123' },
          ]),
      }),
    });

    const res = await requestJson(server, 'GET', '/auth/grants', { Authorization: 'Bearer t' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        applicationId: 'app-1',
        name: 'Third Party App',
        logoUrl: 'file-123',
        scopes: ['profile:read'],
        firstGrantedAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);
    // The grant whose application no longer exists is dropped.
    expect((res.body.data ?? []).length).toBe(1);
  });
});

describe('DELETE /auth/grants/:applicationId', () => {
  const APP_ID = '507f1f77bcf86cd799439abc';

  it('revokes the AppGrant and matching FedCMGrant origins', async () => {
    mockAppGrantDeleteOne.mockResolvedValue({ deletedCount: 1 });
    mockSessionUpdateMany.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mockApplicationFindById.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve({ name: 'Third Party', redirectUris: ['https://app.example.com/cb', 'https://app.example.com/cb2'] }),
      }),
    });
    mockFedCMGrantDeleteMany.mockResolvedValue({ deletedCount: 2 });

    const res = await requestJson(server, 'DELETE', `/auth/grants/${APP_ID}`, { Authorization: 'Bearer t' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ revoked: true });
    expect(mockAppGrantDeleteOne).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: APP_ID })
    );
    expect(mockSessionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
        $or: [
          { oauthApplicationId: APP_ID },
          { 'deviceInfo.deviceName': 'Third Party OAuth' },
        ],
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ isActive: false }),
      })
    );
    // Only ONE deduped origin is derived from the two redirectUris.
    expect(mockFedCMGrantDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ clientOrigin: { $in: ['https://app.example.com'] } })
    );
  });

  it('is idempotent when no grant exists and the app has no redirect origins', async () => {
    mockAppGrantDeleteOne.mockResolvedValue({ deletedCount: 0 });
    mockSessionUpdateMany.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    mockApplicationFindById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) }),
    });

    const res = await requestJson(server, 'DELETE', `/auth/grants/${APP_ID}`, { Authorization: 'Bearer t' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ revoked: true });
    expect(mockSessionUpdateMany).toHaveBeenCalled();
    expect(mockFedCMGrantDeleteMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid applicationId with 400', async () => {
    const res = await requestJson(server, 'DELETE', '/auth/grants/not-an-objectid', { Authorization: 'Bearer t' });

    expect(res.status).toBe(400);
    expect(mockAppGrantDeleteOne).not.toHaveBeenCalled();
  });
});

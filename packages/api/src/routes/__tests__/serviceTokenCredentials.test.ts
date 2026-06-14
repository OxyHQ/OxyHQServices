/**
 * POST /auth/service-token — ApplicationCredential resolution, rotation grace
 * window, expiry/revocation, and minted-JWT claims (issue #215).
 *
 * The service-token endpoint resolves the supplied `apiKey` (= credential
 * publicKey) to an ApplicationCredential, validates the `apiSecret` against the
 * stored SHA-256 hash in constant time, and mints a 1-hour service JWT. It uses
 * the shared `isCredentialUsable` predicate so a credential is accepted when it
 * is `active`, OR `deprecated` but still within its rotation grace window
 * (`expiresAt` in the future); `revoked` and grace-expired credentials are
 * rejected. The minted JWT carries `appId` (Application `_id`) and
 * `credentialId` (the minting ApplicationCredential `_id`).
 *
 * These tests exercise the route end-to-end over real HTTP with the genuine
 * `isCredentialUsable` predicate (only `ApplicationCredential.findOne` and the
 * application lookup are stubbed), then verify the minted JWT by decoding it
 * with the configured secret.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

process.env.ACCESS_TOKEN_SECRET = 'test-access-token-secret';

// The global jest.setup.cjs stubs `jsonwebtoken` (sign → fixed string). This
// suite mints a real service JWT and decodes its claims, so restore the genuine
// module here. The static `import jwt from 'jsonwebtoken'` above then resolves
// to the real export.
jest.mock('jsonwebtoken', () => jest.requireActual('jsonwebtoken'));

const mockApplicationCredentialFindOne = jest.fn();
const mockApplicationFindOne = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/originGuard', () => ({
  requireSameSiteOrigin: (_req: unknown, _res: unknown, next: () => void) => next(),
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

interface ServiceTokenData {
  token?: string;
  expiresIn?: number;
  appName?: string;
}

interface JsonResponse {
  status: number;
  body: { data?: ServiceTokenData; error?: string; message?: string };
}

async function requestJson(
  server: http.Server,
  method: string,
  path: string,
  payload: unknown
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
        },
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
    req.write(body);
    req.end();
  });
}

const API_KEY = 'oxy_dk_service_client';
const PLAINTEXT_SECRET = 'plaintext-service-secret';
const SECRET_HASH = crypto.createHash('sha256').update(PLAINTEXT_SECRET).digest('hex');
const APP_ID = 'app-service-1';
const CRED_ID = 'cred-service-1';

interface StubCredential {
  _id: { toString: () => string };
  publicKey: string;
  applicationId: { toString: () => string };
  type: string;
  status: string;
  secretHash?: string;
  scopes: string[];
  expiresAt?: Date;
  lastUsedAt?: Date;
  save: jest.Mock;
}

function stubCredential(overrides: Partial<StubCredential> = {}): StubCredential {
  return {
    _id: { toString: () => CRED_ID },
    publicKey: API_KEY,
    applicationId: { toString: () => APP_ID },
    type: 'service',
    status: 'active',
    secretHash: SECRET_HASH,
    scopes: ['user:read'],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function stubApp(): { _id: { toString: () => string }; name: string; scopes: string[]; save: jest.Mock } {
  return {
    _id: { toString: () => APP_ID },
    name: 'Service App',
    scopes: ['user:read'],
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function decodeServiceJwt(token: string): {
  type?: string;
  appId?: string;
  appName?: string;
  credentialId?: string;
  scopes?: string[];
} {
  return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET as string) as {
    type?: string;
    appId?: string;
    appName?: string;
    credentialId?: string;
    scopes?: string[];
  };
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
  mockApplicationFindOne.mockResolvedValue(stubApp());
});

describe('POST /auth/service-token — credential resolution + JWT claims (#215)', () => {
  it('mints a token for an active service credential with the correct secret', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(stubCredential());

    const res = await requestJson(server, 'POST', '/auth/service-token', {
      apiKey: API_KEY,
      apiSecret: PLAINTEXT_SECRET,
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.data?.token).toBe('string');
    expect(res.body.data?.appName).toBe('Service App');
  });

  it('embeds appId (Application _id) and credentialId in the minted JWT', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(stubCredential());

    const res = await requestJson(server, 'POST', '/auth/service-token', {
      apiKey: API_KEY,
      apiSecret: PLAINTEXT_SECRET,
    });

    expect(res.status).toBe(200);
    const claims = decodeServiceJwt(res.body.data?.token as string);
    expect(claims.type).toBe('service');
    expect(claims.appId).toBe(APP_ID);
    expect(claims.credentialId).toBe(CRED_ID);
    expect(claims.scopes).toEqual(['user:read']);
  });

  it('accepts a deprecated credential still within its rotation grace window (old secret keeps working)', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(
      stubCredential({
        status: 'deprecated',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
    );

    const res = await requestJson(server, 'POST', '/auth/service-token', {
      apiKey: API_KEY,
      apiSecret: PLAINTEXT_SECRET,
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.data?.token).toBe('string');
  });

  it('rejects a deprecated credential whose grace window has expired', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(
      stubCredential({
        status: 'deprecated',
        expiresAt: new Date(Date.now() - 1000),
      })
    );

    const res = await requestJson(server, 'POST', '/auth/service-token', {
      apiKey: API_KEY,
      apiSecret: PLAINTEXT_SECRET,
    });

    expect(res.status).toBe(401);
  });

  it('rejects an active credential whose explicit expiresAt is in the past', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(
      stubCredential({
        status: 'active',
        expiresAt: new Date(Date.now() - 1000),
      })
    );

    const res = await requestJson(server, 'POST', '/auth/service-token', {
      apiKey: API_KEY,
      apiSecret: PLAINTEXT_SECRET,
    });

    expect(res.status).toBe(401);
  });

  it('rejects a revoked credential immediately (excluded by the status query)', async () => {
    // The route queries `status: { $ne: 'revoked' }`; a revoked credential is
    // therefore not returned at all.
    mockApplicationCredentialFindOne.mockResolvedValue(null);

    const res = await requestJson(server, 'POST', '/auth/service-token', {
      apiKey: API_KEY,
      apiSecret: PLAINTEXT_SECRET,
    });

    expect(res.status).toBe(401);
  });

  it('rejects an invalid secret (timing-safe hash comparison fails)', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(stubCredential());

    const res = await requestJson(server, 'POST', '/auth/service-token', {
      apiKey: API_KEY,
      apiSecret: 'wrong-secret',
    });

    expect(res.status).toBe(401);
  });

  it('rejects a non-service credential with 403', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(
      stubCredential({ type: 'confidential' })
    );

    const res = await requestJson(server, 'POST', '/auth/service-token', {
      apiKey: API_KEY,
      apiSecret: PLAINTEXT_SECRET,
    });

    expect(res.status).toBe(403);
  });

  it('rejects when the owning application is inactive', async () => {
    mockApplicationCredentialFindOne.mockResolvedValue(stubCredential());
    mockApplicationFindOne.mockResolvedValue(null);

    const res = await requestJson(server, 'POST', '/auth/service-token', {
      apiKey: API_KEY,
      apiSecret: PLAINTEXT_SECRET,
    });

    expect(res.status).toBe(401);
  });
});

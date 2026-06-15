/**
 * Application-identity resolution for cross-app auth sessions (issue #214).
 *
 * Cross-app/device auth sessions can now be associated with a REAL registered
 * `Application` record (not only a free-form `appId` string), and the API
 * exposes sanitized public application metadata for the consent UI:
 *
 *  - POST /auth/session/create resolves `clientId` (→ ApplicationCredential →
 *    Application) OR `applicationId` (→ Application) and stores the canonical
 *    `applicationId` on the AuthSession. Unknown refs → 400; non-active apps
 *    (suspended/deleted/pending_review) → 403. Legacy `appId`-only callers are
 *    unchanged.
 *  - GET /auth/session/status/:sessionToken embeds a sanitized `application`
 *    object (or null) without leaking secrets/owner internals.
 *  - GET /auth/oauth/client/:clientId is a PUBLIC (no-bearer) lookup of the
 *    sanitized metadata; generic 404 for unknown/revoked/inactive clients.
 *
 * These tests use the REAL request validation (`validate`) and the REAL
 * `serializeApplication` util so the wire shape is pinned; only the Mongoose
 * models / services are mocked (matching sessionAuthorize.test.ts style).
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockAuthSessionFindOne = jest.fn();
const mockAuthSessionCreate = jest.fn();
const mockApplicationFindOne = jest.fn();
const mockApplicationFindById = jest.fn();
const mockApplicationCredentialFindOne = jest.fn();
const mockUserFindById = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Use the REAL validate middleware so the schema (clientId/applicationId
// optional, appId required) is actually exercised.
jest.unmock('../../middleware/validate');

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: mockAuthSessionFindOne, create: mockAuthSessionCreate },
  AuthSession: { findOne: mockAuthSessionFindOne, create: mockAuthSessionCreate },
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

// The global jest.setup mongoose mock omits `Types.ObjectId`, so the real
// `isValidObjectId` (which calls `mongoose.Types.ObjectId.isValid`) would throw.
// Provide a faithful 24-hex check so the create handler's ObjectId guard runs.
jest.mock('../../utils/validation', () => ({
  isValidObjectId: (id: string) => /^[a-fA-F0-9]{24}$/.test(id),
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
  User: { findOne: jest.fn(), findById: mockUserFindById },
  default: { findOne: jest.fn(), findById: mockUserFindById },
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

interface PublicApplicationBody {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  websiteUrl?: string;
  type: string;
  isOfficial: boolean;
  isInternal: boolean;
  scopes: string[];
  developerName?: string;
}

interface SessionStatusData {
  status: string;
  appId: string;
  application: PublicApplicationBody | null;
  sessionToken: string;
}

interface SessionCreateData {
  sessionToken: string;
  status: string;
}

interface JsonResponse {
  status: number;
  body: {
    error?: string;
    message?: string;
    data?: Partial<SessionStatusData> & Partial<SessionCreateData> & { application?: PublicApplicationBody | null };
  };
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
  // No pre-existing session token by default.
  mockAuthSessionFindOne.mockResolvedValue(null);
  // AuthSession.create echoes back the persisted doc.
  mockAuthSessionCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    ...doc,
    expiresAt: doc.expiresAt instanceof Date ? doc.expiresAt : new Date(Date.now() + 60_000),
    status: doc.status ?? 'pending',
  }));
});

// A chainable User.findById(...).select(...).lean() mock.
function mockOwner(owner: { username?: string; name?: { first?: string; last?: string } } | null) {
  mockUserFindById.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(owner) }),
  });
}

const OFFICIAL_APP_ID = '64f7c2a1b8e9d3f4a1c2b300';
const THIRD_PARTY_APP_ID = '64f7c2a1b8e9d3f4a1c2b301';

function officialApp() {
  return {
    _id: { toString: () => OFFICIAL_APP_ID },
    name: 'Oxy Accounts',
    description: 'First-party account manager',
    icon: 'https://cloud.oxy.so/icons/accounts.png',
    type: 'first_party',
    status: 'active',
    isOfficial: true,
    isInternal: false,
    scopes: ['user:read'],
    createdByUserId: { toString: () => 'staff-1' },
  };
}

function thirdPartyApp() {
  return {
    _id: { toString: () => THIRD_PARTY_APP_ID },
    name: 'Acme Widgets',
    description: 'A third-party integration',
    icon: 'https://cdn.acme.example/icon.png',
    websiteUrl: 'https://acme.example',
    type: 'third_party',
    status: 'active',
    isOfficial: false,
    isInternal: false,
    scopes: ['files:read', 'user:read'],
    createdByUserId: { toString: () => 'owner-1' },
  };
}

function usableCredential(applicationId: string) {
  return {
    _id: { toString: () => 'cred-1' },
    publicKey: 'oxy_dk_client',
    applicationId: { toString: () => applicationId },
    status: 'active',
  };
}

describe('POST /auth/session/create — application resolution (#214)', () => {
  it('(a) resolves a valid clientId and stores the canonical applicationId', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential(THIRD_PARTY_APP_ID));
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-1',
      appId: 'acme.example',
      clientId: 'oxy_dk_client',
    });

    expect(res.status).toBe(200);
    expect(mockApplicationCredentialFindOne).toHaveBeenCalledWith({
      publicKey: 'oxy_dk_client',
      status: { $ne: 'revoked' },
    });
    expect(mockAuthSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'acme.example',
        applicationId: expect.objectContaining({ toString: expect.any(Function) }),
      })
    );
    const created = mockAuthSessionCreate.mock.calls[0][0] as { applicationId: { toString: () => string } };
    expect(created.applicationId.toString()).toBe(THIRD_PARTY_APP_ID);
  });

  it('(b) resolves a valid applicationId directly', async () => {
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-2',
      appId: 'acme.example',
      applicationId: THIRD_PARTY_APP_ID,
    });

    expect(res.status).toBe(200);
    expect(mockApplicationFindById).toHaveBeenCalledWith(THIRD_PARTY_APP_ID);
    const created = mockAuthSessionCreate.mock.calls[0][0] as { applicationId: { toString: () => string } };
    expect(created.applicationId.toString()).toBe(THIRD_PARTY_APP_ID);
  });

  it('(c1) returns 400 for an unknown clientId', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-3',
      appId: 'acme.example',
      clientId: 'oxy_dk_missing',
    });

    expect(res.status).toBe(400);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(c2) returns 400 for an unknown applicationId', async () => {
    mockApplicationFindById.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-4',
      appId: 'acme.example',
      applicationId: '64f7c2a1b8e9d3f4a1c2b3ff',
    });

    expect(res.status).toBe(400);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(c3) returns 400 for a malformed applicationId (invalid ObjectId, never queried)', async () => {
    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-5',
      appId: 'acme.example',
      applicationId: 'not-an-objectid',
    });

    expect(res.status).toBe(400);
    expect(mockApplicationFindById).not.toHaveBeenCalled();
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(d) returns 403 for a suspended app', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential(THIRD_PARTY_APP_ID));
    mockApplicationFindById.mockResolvedValueOnce({ ...thirdPartyApp(), status: 'suspended' });

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-6',
      appId: 'acme.example',
      clientId: 'oxy_dk_client',
    });

    expect(res.status).toBe(403);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(e1) returns 403 for a deleted app', async () => {
    mockApplicationFindById.mockResolvedValueOnce({ ...thirdPartyApp(), status: 'deleted' });

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-7',
      appId: 'acme.example',
      applicationId: THIRD_PARTY_APP_ID,
    });

    expect(res.status).toBe(403);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(e2) returns 403 for a pending_review app', async () => {
    mockApplicationFindById.mockResolvedValueOnce({ ...thirdPartyApp(), status: 'pending_review' });

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-8',
      appId: 'acme.example',
      applicationId: THIRD_PARTY_APP_ID,
    });

    expect(res.status).toBe(403);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(h) legacy create with only a free appId stores no applicationId and still 200', async () => {
    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-legacy',
      appId: 'free.form.label',
    });

    expect(res.status).toBe(200);
    expect(mockApplicationCredentialFindOne).not.toHaveBeenCalled();
    expect(mockApplicationFindById).not.toHaveBeenCalled();
    const created = mockAuthSessionCreate.mock.calls[0][0] as { appId: string; applicationId: unknown };
    expect(created.appId).toBe('free.form.label');
    expect(created.applicationId).toBeNull();
  });
});

describe('GET /auth/session/status/:sessionToken — embedded application (#214)', () => {
  it('(f1) embeds sanitized metadata for an official app (no developerName)', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'tok-status-official',
      appId: 'accounts.oxy.so',
      applicationId: { toString: () => OFFICIAL_APP_ID },
      status: 'pending',
      authorizedSessionId: null,
      authorizedBy: null,
      authorizedUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    });
    mockApplicationFindById.mockResolvedValueOnce(officialApp());

    const res = await requestJson(server, 'GET', '/auth/session/status/tok-status-official', null);

    expect(res.status).toBe(200);
    const app = res.body.data?.application as PublicApplicationBody;
    expect(app).toMatchObject({
      id: OFFICIAL_APP_ID,
      name: 'Oxy Accounts',
      type: 'first_party',
      isOfficial: true,
      isInternal: false,
      scopes: ['user:read'],
    });
    // Official apps never carry developer attribution.
    expect(app.developerName).toBeUndefined();
    // Owner lookup must be skipped for official apps.
    expect(mockUserFindById).not.toHaveBeenCalled();
    // Legacy fields preserved.
    expect(res.body.data?.appId).toBe('accounts.oxy.so');
  });

  it('(f2) embeds developerName + websiteUrl for a third-party app', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'tok-status-third',
      appId: 'acme.example',
      applicationId: { toString: () => THIRD_PARTY_APP_ID },
      status: 'authorized',
      authorizedSessionId: 'sess-1',
      authorizedBy: 'pk-1',
      authorizedUserId: { toString: () => 'user-1' },
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    });
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());
    mockOwner({ name: { first: 'Ada', last: 'Lovelace' }, username: 'ada' });

    const res = await requestJson(server, 'GET', '/auth/session/status/tok-status-third', null);

    expect(res.status).toBe(200);
    const app = res.body.data?.application as PublicApplicationBody;
    expect(app).toMatchObject({
      id: THIRD_PARTY_APP_ID,
      name: 'Acme Widgets',
      type: 'third_party',
      isOfficial: false,
      websiteUrl: 'https://acme.example',
      developerName: 'Ada Lovelace',
    });
    expect(app.scopes).toEqual(['files:read', 'user:read']);
  });

  it('(f3) returns application:null when the bound app was later deleted', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'tok-status-gone',
      appId: 'acme.example',
      applicationId: { toString: () => THIRD_PARTY_APP_ID },
      status: 'pending',
      authorizedSessionId: null,
      authorizedBy: null,
      authorizedUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    });
    // App not active / removed.
    mockApplicationFindById.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'GET', '/auth/session/status/tok-status-gone', null);

    expect(res.status).toBe(200);
    expect(res.body.data?.application).toBeNull();
    // Legacy label still present.
    expect(res.body.data?.appId).toBe('acme.example');
  });

  it('(h) returns application:null for a legacy session with no applicationId', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'tok-status-legacy',
      appId: 'free.form.label',
      applicationId: null,
      status: 'pending',
      authorizedSessionId: null,
      authorizedBy: null,
      authorizedUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    });

    const res = await requestJson(server, 'GET', '/auth/session/status/tok-status-legacy', null);

    expect(res.status).toBe(200);
    expect(res.body.data?.application).toBeNull();
    expect(mockApplicationFindById).not.toHaveBeenCalled();
    expect(res.body.data?.appId).toBe('free.form.label');
  });
});

describe('GET /auth/oauth/client/:clientId — public metadata lookup (#214)', () => {
  it('(g1) returns sanitized metadata for an active app', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential(THIRD_PARTY_APP_ID));
    mockApplicationFindOne.mockResolvedValueOnce(thirdPartyApp());
    mockOwner({ name: { first: 'Ada', last: 'Lovelace' }, username: 'ada' });

    const res = await requestJson(server, 'GET', '/auth/oauth/client/oxy_dk_client', null);

    expect(res.status).toBe(200);
    const app = res.body.data?.application as PublicApplicationBody;
    expect(app).toMatchObject({
      id: THIRD_PARTY_APP_ID,
      name: 'Acme Widgets',
      type: 'third_party',
      isOfficial: false,
      developerName: 'Ada Lovelace',
    });
    // Sanitized — no secret/owner-id/capabilities leakage.
    const leaked = app as unknown as Record<string, unknown>;
    expect(leaked.createdByUserId).toBeUndefined();
    expect(leaked.webhookSecret).toBeUndefined();
    expect(leaked.capabilities).toBeUndefined();
    expect(leaked.redirectUris).toBeUndefined();
  });

  it('(g2) returns 404 for an unknown clientId', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'GET', '/auth/oauth/client/oxy_dk_unknown', null);

    expect(res.status).toBe(404);
  });

  it('(g3) returns 404 for a revoked credential', async () => {
    // A revoked credential is filtered out by the `status: { $ne: 'revoked' }`
    // query, so findOne resolves null.
    mockApplicationCredentialFindOne.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'GET', '/auth/oauth/client/oxy_dk_revoked', null);

    expect(res.status).toBe(404);
    expect(mockApplicationFindOne).not.toHaveBeenCalled();
  });

  it('(g4) returns 404 when the credential is usable but the app is inactive', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential(THIRD_PARTY_APP_ID));
    // status:'active' query yields nothing for a suspended/deleted app.
    mockApplicationFindOne.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'GET', '/auth/oauth/client/oxy_dk_client', null);

    expect(res.status).toBe(404);
  });

  it('(g5) returns 404 when the credential is expired (rotation grace elapsed)', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce({
      _id: { toString: () => 'cred-exp' },
      publicKey: 'oxy_dk_client',
      applicationId: { toString: () => THIRD_PARTY_APP_ID },
      status: 'deprecated',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await requestJson(server, 'GET', '/auth/oauth/client/oxy_dk_client', null);

    expect(res.status).toBe(404);
    expect(mockApplicationFindOne).not.toHaveBeenCalled();
  });
});

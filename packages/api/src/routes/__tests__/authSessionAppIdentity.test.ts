/**
 * Application-identity resolution for cross-app auth sessions (issue #214).
 *
 * Every cross-app/device auth session is ALWAYS bound to a REAL registered
 * `Application` record. There is NO free-form `appId` label — the caller must
 * identify the app via `clientId` or `applicationId`. The API exposes sanitized
 * public application metadata for the consent UI:
 *
 *  - POST /auth/session/create resolves `clientId` (→ ApplicationCredential →
 *    Application) OR `applicationId` (→ Application) and stores the canonical
 *    `applicationId` on the AuthSession. No app reference → 400; unknown refs →
 *    400; non-active apps (suspended/deleted/pending_review) → 403.
 *  - GET /auth/session/status/:sessionToken ALWAYS embeds a sanitized
 *    `application` object (null only if the app was hard-deleted) and NEVER an
 *    `appId`, without leaking secrets/owner internals.
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
const mockAuthorizeSigned = jest.fn();
const mockEmitAuthSessionUpdate = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Use the REAL validate middleware so the schema (one of clientId/applicationId
// required) is actually exercised.
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
  authorizeSessionWithSignedChallenge: (...args: unknown[]) => mockAuthorizeSigned(...args),
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
  emitAuthSessionUpdate: (...args: unknown[]) => mockEmitAuthSessionUpdate(...args),
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
import { sessionStatusSchema, safeParseContract } from '@oxyhq/contracts';

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
    redirectUris: ['https://accounts.oxy.so/__oxy/sso-callback'],
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
  it('(a) resolves a valid clientId and stores the canonical applicationId (no appId)', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential(THIRD_PARTY_APP_ID));
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-1',
      clientId: 'oxy_dk_client',
    });

    expect(res.status).toBe(200);
    expect(mockApplicationCredentialFindOne).toHaveBeenCalledWith({
      publicKey: 'oxy_dk_client',
      status: { $ne: 'revoked' },
    });
    const created = mockAuthSessionCreate.mock.calls[0][0] as { applicationId: { toString: () => string }; appId?: unknown };
    expect(created.applicationId.toString()).toBe(THIRD_PARTY_APP_ID);
    // No free-form label is ever persisted.
    expect(created.appId).toBeUndefined();
  });

  it('(b) resolves a valid applicationId directly', async () => {
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-2',
      applicationId: THIRD_PARTY_APP_ID,
    });

    expect(res.status).toBe(200);
    expect(mockApplicationFindById).toHaveBeenCalledWith(THIRD_PARTY_APP_ID);
    const created = mockAuthSessionCreate.mock.calls[0][0] as { applicationId: { toString: () => string } };
    expect(created.applicationId.toString()).toBe(THIRD_PARTY_APP_ID);
  });

  it('(b1) permits an official app only from a registered redirect origin', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential(OFFICIAL_APP_ID));
    mockApplicationFindById.mockResolvedValueOnce(officialApp());

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-official-ok',
      clientId: 'oxy_dk_client',
    }, { origin: 'https://accounts.oxy.so' });

    expect(res.status).toBe(200);
    const created = mockAuthSessionCreate.mock.calls[0][0] as { applicationId: { toString: () => string } };
    expect(created.applicationId.toString()).toBe(OFFICIAL_APP_ID);
  });

  it('(b2) rejects an official app from an unregistered browser origin', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential(OFFICIAL_APP_ID));
    mockApplicationFindById.mockResolvedValueOnce(officialApp());

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-official-bad-origin',
      clientId: 'oxy_dk_client',
    }, { origin: 'https://evil.example' });

    expect(res.status).toBe(403);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(b3) rejects an official app from a browser Referer context with no matching Origin', async () => {
    // A browser context is detectable (Referer present) but the Origin does not
    // match a registered redirect — official branding must not be granted.
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential(OFFICIAL_APP_ID));
    mockApplicationFindById.mockResolvedValueOnce(officialApp());

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-official-bad-referer',
      clientId: 'oxy_dk_client',
    }, { referer: 'https://evil.example/login' });

    expect(res.status).toBe(403);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(b4) accepts an official app from a native client that carries no Origin/Referer', async () => {
    // Native (Expo deviceFlowSignIn) requests attach neither Origin nor Referer.
    // They cannot prove an origin and must NOT be rejected for lacking one — the
    // device-flow consent screen still authorises every session interactively.
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential(OFFICIAL_APP_ID));
    mockApplicationFindById.mockResolvedValueOnce(officialApp());

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-official-native',
      clientId: 'oxy_dk_client',
    });

    expect(res.status).toBe(200);
    const created = mockAuthSessionCreate.mock.calls[0][0] as { applicationId: { toString: () => string } };
    expect(created.applicationId.toString()).toBe(OFFICIAL_APP_ID);
  });

  it('(c0) returns 400 when NEITHER clientId nor applicationId is supplied', async () => {
    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-none',
    });

    expect(res.status).toBe(400);
    expect(mockApplicationCredentialFindOne).not.toHaveBeenCalled();
    expect(mockApplicationFindById).not.toHaveBeenCalled();
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(c1) returns 400 for an unknown clientId', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-3',
      clientId: 'oxy_dk_missing',
    });

    expect(res.status).toBe(400);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(c2) returns 400 for an unknown applicationId', async () => {
    mockApplicationFindById.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-4',
      applicationId: '64f7c2a1b8e9d3f4a1c2b3ff',
    });

    expect(res.status).toBe(400);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(c3) returns 400 for a malformed applicationId (invalid ObjectId, never queried)', async () => {
    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-5',
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
      clientId: 'oxy_dk_client',
    });

    expect(res.status).toBe(403);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(e1) returns 403 for a deleted app', async () => {
    mockApplicationFindById.mockResolvedValueOnce({ ...thirdPartyApp(), status: 'deleted' });

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-7',
      applicationId: THIRD_PARTY_APP_ID,
    });

    expect(res.status).toBe(403);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(e2) returns 403 for a pending_review app', async () => {
    mockApplicationFindById.mockResolvedValueOnce({ ...thirdPartyApp(), status: 'pending_review' });

    const res = await requestJson(server, 'POST', '/auth/session/create', {
      sessionToken: 'tok-create-8',
      applicationId: THIRD_PARTY_APP_ID,
    });

    expect(res.status).toBe(403);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('(h) returns a public authorizeCode + qrPayload and persists boundOrigin (C2)', async () => {
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());

    const res = await requestJson(
      server,
      'POST',
      '/auth/session/create',
      { sessionToken: 'tok-create-qr', applicationId: THIRD_PARTY_APP_ID },
      { origin: 'https://acme.example' },
    );

    expect(res.status).toBe(200);
    const data = res.body.data as { sessionToken: string; authorizeCode: string; qrPayload: string; status: string };
    expect(data.sessionToken).toBe('tok-create-qr'); // secret echoed to its originator only
    expect(data.status).toBe('pending');
    expect(data.authorizeCode).toMatch(/^[a-f0-9]{32}$/);
    // QR contract: `oxycommons://approve?...&code=<authorizeCode>` — path segment
    // `approve` + param `code` are part of Commons' deep-link router contract.
    expect(data.qrPayload).toContain('oxycommons://approve?');
    expect(data.qrPayload).toContain(`code=${data.authorizeCode}`);
    expect(data.qrPayload).toContain(`app=${THIRD_PARTY_APP_ID}`);
    expect(data.qrPayload).toContain('origin=https%3A%2F%2Facme.example');
    // The QR carries the PUBLIC authorizeCode, never the secret sessionToken.
    expect(data.qrPayload).not.toContain('tok-create-qr');

    const created = mockAuthSessionCreate.mock.calls[0][0] as { boundOrigin?: string; authorizeCode?: string };
    expect(created.boundOrigin).toBe('https://acme.example');
    expect(created.authorizeCode).toBe(data.authorizeCode);
  });
});

describe('POST /auth/session/authorize-signed/:authorizeCode — route mapping (C2)', () => {
  it('maps an ok outcome to 200 and notifies the originator over the socket', async () => {
    mockAuthorizeSigned.mockResolvedValueOnce({
      ok: true,
      sessionToken: 'secret-token',
      sessionId: 'sess-1',
      userId: 'user-1',
      username: 'nate',
      publicKey: 'pk-1',
    });

    const res = await requestJson(server, 'POST', '/auth/session/authorize-signed/code-1', {
      publicKey: 'pk-1',
      challenge: 'c',
      signature: 's',
      timestamp: Date.now(),
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ success: true, sessionId: 'sess-1' });
    expect(mockEmitAuthSessionUpdate).toHaveBeenCalledWith(
      'secret-token',
      expect.objectContaining({ status: 'authorized', sessionId: 'sess-1', userId: 'user-1', publicKey: 'pk-1' }),
    );
  });

  it('maps a 401 failure outcome without emitting', async () => {
    mockAuthorizeSigned.mockResolvedValueOnce({ ok: false, status: 401, message: 'Invalid signature' });

    const res = await requestJson(server, 'POST', '/auth/session/authorize-signed/code-1', {
      publicKey: 'pk-1',
      challenge: 'c',
      signature: 's',
      timestamp: Date.now(),
    });

    expect(res.status).toBe(401);
    expect(mockEmitAuthSessionUpdate).not.toHaveBeenCalled();
  });

  it('maps a 404 failure outcome', async () => {
    mockAuthorizeSigned.mockResolvedValueOnce({ ok: false, status: 404, message: 'User not found' });

    const res = await requestJson(server, 'POST', '/auth/session/authorize-signed/code-1', {
      publicKey: 'pk-1',
      challenge: 'c',
      signature: 's',
      timestamp: Date.now(),
    });

    expect(res.status).toBe(404);
  });
});

describe('GET /auth/session/status/:sessionToken — embedded application (#214)', () => {
  it('(f1) embeds sanitized metadata for an official app (no developerName, no appId)', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'tok-status-official',
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
    // `appId` must NEVER appear in the response.
    expect(res.body.data).not.toHaveProperty('appId');
    // The producer output MUST conform to the shared @oxyhq/contracts shape.
    // This is the PENDING device-session shape (sessionId/publicKey/userId all
    // null) that previously broke the auth app's drifted local schema.
    expect(safeParseContract(sessionStatusSchema, res.body.data)).not.toBeNull();
  });

  it('(f2) embeds developerName + websiteUrl for a third-party app', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'tok-status-third',
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
    expect(res.body.data).not.toHaveProperty('appId');
    // AUTHORIZED shape (string sessionId/publicKey/userId) MUST conform too.
    expect(safeParseContract(sessionStatusSchema, res.body.data)).not.toBeNull();
  });

  it('(f3) returns application:null when the bound app was later hard-deleted (never appId)', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'tok-status-gone',
      applicationId: { toString: () => THIRD_PARTY_APP_ID },
      status: 'pending',
      authorizedSessionId: null,
      authorizedBy: null,
      authorizedUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    });
    // App hard-deleted / removed.
    mockApplicationFindById.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'GET', '/auth/session/status/tok-status-gone', null);

    expect(res.status).toBe(200);
    // `application` is present in the payload, defensively null.
    expect(res.body.data).toHaveProperty('application', null);
    expect(res.body.data).not.toHaveProperty('appId');
    // `application: null` (unresolved app) MUST conform to the contract.
    expect(safeParseContract(sessionStatusSchema, res.body.data)).not.toBeNull();
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

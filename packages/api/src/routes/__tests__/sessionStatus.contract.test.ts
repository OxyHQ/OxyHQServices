/**
 * PRODUCER drift-guard for `GET /auth/session/status/:sessionToken`.
 *
 * Phase B of centralizing the session-status contract. The API is the FAITHFUL
 * PRODUCER of `@oxyhq/contracts`'s `sessionStatusSchema`. These tests exercise
 * the REAL route handler (over an in-process HTTP server, with only the Mongoose
 * models / services mocked) and assert that the producer's `{ data: ... }` inner
 * object PARSES against the shared contract. If the route ever drifts from the
 * contract again — e.g. emits a shape the auth app's consent UI cannot parse —
 * these tests fail.
 *
 * The class of bug that motivated this contract: the auth app's LOCAL
 * `sessionStatusSchema` typed `sessionId` as a non-nullable `z.string().optional()`.
 * The producer emits `sessionId: authorizedSessionId || null`, so a PENDING
 * device session carries `sessionId: null` — `.optional()` permits
 * `undefined`/missing but REJECTS `null`, so the whole response collapsed to
 * `null` and the consent screen showed "Unable to identify the requesting
 * application". The PENDING case below is that EXACT shape (sessionId / publicKey
 * / userId all `null`) and MUST parse against the shared contract.
 *
 * The wire shape is pinned via the REAL `serializePublicApplication` util and the
 * REAL response-building expressions in the route (`authorizedSessionId || null`,
 * etc.) — no hand-copied fixture. Only the data layer is mocked (matching
 * `authSessionAppIdentity.test.ts` / `sessionAuthorize.test.ts` style).
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { sessionStatusSchema, safeParseContract } from '@oxyhq/contracts';

const mockAuthSessionFindOne = jest.fn();
const mockApplicationFindById = jest.fn();
const mockUserFindById = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Use the REAL validate middleware so the params schema is actually exercised.
jest.unmock('../../middleware/validate');

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: mockAuthSessionFindOne },
  AuthSession: { findOne: mockAuthSessionFindOne },
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

jest.mock('../../utils/validation', () => ({
  isValidObjectId: (id: string) => /^[a-fA-F0-9]{24}$/.test(id),
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findOne: jest.fn(), findById: mockApplicationFindById },
  default: { findOne: jest.fn(), findById: mockApplicationFindById },
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: jest.fn() },
  default: { findOne: jest.fn() },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn(), findById: mockUserFindById },
  default: { findOne: jest.fn(), findById: mockUserFindById },
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
  body: { data?: Record<string, unknown> };
}

async function getStatus(server: http.Server, sessionToken: string): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        host: '127.0.0.1',
        port: address.port,
        path: `/auth/session/status/${sessionToken}`,
        headers: { 'content-type': 'application/json' },
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

// A chainable User.findById(...).select(...).lean() mock for developer-name lookup.
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
    privacyPolicyUrl: 'https://acme.example/privacy',
    termsUrl: 'https://acme.example/terms',
    type: 'third_party',
    status: 'active',
    isOfficial: false,
    isInternal: false,
    scopes: ['files:read', 'user:read'],
    createdByUserId: { toString: () => 'owner-1' },
  };
}

describe('GET /auth/session/status/:sessionToken → @oxyhq/contracts sessionStatusSchema (producer contract)', () => {
  it('PENDING device session (sessionId/publicKey/userId all null, application resolved) parses', async () => {
    // This is the EXACT shape that broke the auth app's drifted local schema:
    // a not-yet-authorized session carries null for every authorized-* field.
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'tok-pending',
      applicationId: { toString: () => OFFICIAL_APP_ID },
      status: 'pending',
      authorizedSessionId: null,
      authorizedBy: null,
      authorizedUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    });
    mockApplicationFindById.mockResolvedValueOnce(officialApp());

    const res = await getStatus(server, 'tok-pending');

    expect(res.status).toBe(200);
    // The producer ALWAYS emits the keys, with null values for a pending session.
    expect(res.body.data).toMatchObject({
      status: 'pending',
      authorized: false,
      sessionId: null,
      publicKey: null,
      userId: null,
    });
    expect(res.body.data?.application).not.toBeNull();

    const parsed = safeParseContract(sessionStatusSchema, res.body.data);
    expect(parsed).not.toBeNull();
    expect(parsed?.sessionId).toBeNull();
    expect(parsed?.publicKey).toBeNull();
    expect(parsed?.userId).toBeNull();
    expect(parsed?.application?.id).toBe(OFFICIAL_APP_ID);
  });

  it('AUTHORIZED session (string sessionId/publicKey/userId, application present) parses', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'tok-authorized',
      applicationId: { toString: () => THIRD_PARTY_APP_ID },
      status: 'authorized',
      authorizedSessionId: 'sess_64f7c2a1b8e9d3f4a1c2b3d4',
      authorizedBy: '02a1b2c3d4e5f6',
      authorizedUserId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3d4' },
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    });
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());
    mockOwner({ name: { first: 'Ada', last: 'Lovelace' }, username: 'ada' });

    const res = await getStatus(server, 'tok-authorized');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'authorized',
      authorized: true,
      sessionId: 'sess_64f7c2a1b8e9d3f4a1c2b3d4',
      publicKey: '02a1b2c3d4e5f6',
      userId: '64f7c2a1b8e9d3f4a1c2b3d4',
    });

    const parsed = safeParseContract(sessionStatusSchema, res.body.data);
    expect(parsed).not.toBeNull();
    expect(parsed?.sessionId).toBe('sess_64f7c2a1b8e9d3f4a1c2b3d4');
    expect(parsed?.userId).toBe('64f7c2a1b8e9d3f4a1c2b3d4');
    // developerName is attached for non-official apps.
    expect(parsed?.application?.developerName).toBe('Ada Lovelace');
    // Legal URLs flow through the serializer to the consent UI contract.
    expect(parsed?.application?.privacyPolicyUrl).toBe('https://acme.example/privacy');
    expect(parsed?.application?.termsUrl).toBe('https://acme.example/terms');
  });

  it('application:null (bound app unresolved / hard-deleted) parses', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'tok-noapp',
      applicationId: { toString: () => THIRD_PARTY_APP_ID },
      status: 'pending',
      authorizedSessionId: null,
      authorizedBy: null,
      authorizedUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    });
    // App hard-deleted / no longer active → handler returns application: null.
    mockApplicationFindById.mockResolvedValueOnce(null);

    const res = await getStatus(server, 'tok-noapp');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('application', null);

    const parsed = safeParseContract(sessionStatusSchema, res.body.data);
    expect(parsed).not.toBeNull();
    expect(parsed?.application).toBeNull();
  });
});

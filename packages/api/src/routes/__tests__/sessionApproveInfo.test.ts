/**
 * GET /auth/session/approve-info/:authorizeCode tests (C2).
 *
 * PUBLIC endpoint the Commons vault calls after scanning the QR. It returns the
 * server-RESOLVED, sanitized Application identity (so a spoofed-name QR still
 * shows the true app) + boundOrigin + scopes + status, and NEVER the secret
 * `sessionToken`. Uses the REAL `serializeApplication`; only models are mocked.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

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
jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: mockAuthSessionFindOne },
  AuthSession: { findOne: mockAuthSessionFindOne },
}));
jest.mock('../../models/Session', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../services/authSession.service', () => ({
  claimAuthSession: jest.fn(),
  authorizeSessionWithSignedChallenge: jest.fn(),
}));
jest.mock('../../models/AuthCode', () => ({ __esModule: true, AuthCode: { create: jest.fn() }, default: { create: jest.fn() } }));
jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findOne: jest.fn(), findById: mockApplicationFindById },
  default: { findOne: jest.fn(), findById: mockApplicationFindById },
}));
jest.mock('../../models/ApplicationCredential', () => ({ __esModule: true, ApplicationCredential: { findOne: jest.fn() }, default: { findOne: jest.fn() } }));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn(), findById: mockUserFindById },
  default: { findOne: jest.fn(), findById: mockUserFindById },
}));
jest.mock('../../models/RefreshToken', () => ({ __esModule: true, default: {}, RefreshToken: {} }));
jest.mock('../../utils/userTransform', () => ({ formatUserResponse: jest.fn() }));
jest.mock('../../utils/authSessionSocket', () => ({ emitAuthSessionUpdate: jest.fn() }));
jest.mock('../../services/session.service', () => ({ __esModule: true, default: { createSession: jest.fn() } }));
jest.mock('../../services/oauthCode.service', () => ({ issueAuthCode: jest.fn(), exchangeAuthCode: jest.fn(), AUTH_CODE_TTL_MS: 60_000 }));
jest.mock('../../services/signature.service', () => ({ __esModule: true, default: { verifyChallengeResponse: jest.fn(), isValidPublicKey: jest.fn() } }));
jest.mock('../../controllers/session.controller', () => ({
  SessionController: {
    register: jest.fn(), signUp: jest.fn(), signIn: jest.fn(), requestChallenge: jest.fn(),
    verifyChallenge: jest.fn(), requestPasswordReset: jest.fn(), verifyRecoveryCode: jest.fn(),
    resetPassword: jest.fn(), getUserByPublicKey: jest.fn(),
  },
}));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../socialAuth', () => ({ __esModule: true, default: express.Router() }));

// auth.ts statically imports the AppGrant + FedCMGrant models (OAuth consent
// grants); mock them so the real Mongoose schema does not run under the global
// mongoose mock (which lacks Schema.Types).
jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
}));
jest.mock('../../models/FedCMGrant', () => ({
  __esModule: true,
  FedCMGrant: { deleteMany: jest.fn(), deleteOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn() },
  default: { deleteMany: jest.fn(), deleteOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn() },
}));
import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse { status: number; body: Record<string, unknown>; }

async function get(server: http.Server, path: string): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: address.port, path }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }));
    }).on('error', reject);
  });
}

const THIRD_PARTY_APP_ID = '64f7c2a1b8e9d3f4a1c2b301';
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

let server: http.Server;
beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});
afterAll((done) => { server.close(done); });
beforeEach(() => { jest.clearAllMocks(); });

describe('GET /auth/session/approve-info/:authorizeCode', () => {
  it('returns the resolved sanitized app, scopes, origin, and status — never the sessionToken', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce({
      sessionToken: 'SECRET-do-not-leak',
      authorizeCode: 'code-1',
      applicationId: { toString: () => THIRD_PARTY_APP_ID },
      boundOrigin: 'https://acme.example',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
    });
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());
    mockUserFindById.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve({ name: { first: 'Ada', last: 'Lovelace' }, username: 'ada' }) }) });

    const res = await get(server, '/auth/session/approve-info/code-1');

    expect(res.status).toBe(200);
    const data = res.body.data as {
      application: { id: string; name: string; developerName?: string };
      scopes: string[];
      boundOrigin: string;
      status: string;
    };
    expect(data.application).toMatchObject({ id: THIRD_PARTY_APP_ID, name: 'Acme Widgets', developerName: 'Ada Lovelace' });
    expect(data.scopes).toEqual(['files:read', 'user:read']);
    expect(data.boundOrigin).toBe('https://acme.example');
    expect(data.status).toBe('pending');
    // The secret sessionToken must NEVER appear anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain('SECRET-do-not-leak');
  });

  it('returns 404 for an unknown authorizeCode', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(null);
    const res = await get(server, '/auth/session/approve-info/nope');
    expect(res.status).toBe(404);
  });
});

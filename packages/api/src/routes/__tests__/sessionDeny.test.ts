/**
 * POST /auth/session/deny/:authorizeCode tests (C2).
 *
 * The Commons vault never holds the secret `sessionToken`, so it denies a
 * pending approval by the PUBLIC `authorizeCode`. Only a PENDING session is
 * cancelled (a knower of the public code must not be able to cancel an
 * already-authorized session); the waiting originator is notified on the secret
 * sessionToken socket channel.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockAuthSessionFindOne = jest.fn();
const mockEmitAuthSessionUpdate = jest.fn();

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
jest.mock('../../models/Application', () => ({ __esModule: true, Application: { findOne: jest.fn(), findById: jest.fn() }, default: { findOne: jest.fn(), findById: jest.fn() } }));
jest.mock('../../models/ApplicationCredential', () => ({ __esModule: true, ApplicationCredential: { findOne: jest.fn() }, default: { findOne: jest.fn() } }));
jest.mock('../../models/User', () => ({ __esModule: true, User: { findOne: jest.fn(), findById: jest.fn() }, default: { findOne: jest.fn(), findById: jest.fn() } }));
jest.mock('../../models/RefreshToken', () => ({ __esModule: true, default: {}, RefreshToken: {} }));
jest.mock('../../utils/userTransform', () => ({ formatUserResponse: jest.fn() }));
jest.mock('../../utils/authSessionSocket', () => ({ emitAuthSessionUpdate: (...args: unknown[]) => mockEmitAuthSessionUpdate(...args) }));
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

async function post(server: http.Server, path: string): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = '{}';
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'POST', host: '127.0.0.1', port: address.port, path, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }));
      },
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
afterAll((done) => { server.close(done); });
beforeEach(() => { jest.clearAllMocks(); });

describe('POST /auth/session/deny/:authorizeCode', () => {
  it('cancels a pending session and notifies the originator', async () => {
    const session = { sessionToken: 'secret-token', status: 'pending', save: jest.fn().mockResolvedValue(undefined) };
    mockAuthSessionFindOne.mockResolvedValueOnce(session);

    const res = await post(server, '/auth/session/deny/code-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true });
    expect(session.status).toBe('cancelled');
    expect(session.save).toHaveBeenCalledTimes(1);
    expect(mockEmitAuthSessionUpdate).toHaveBeenCalledWith('secret-token', { status: 'cancelled' });
  });

  it('returns 404 for an unknown authorizeCode', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(null);
    const res = await post(server, '/auth/session/deny/nope');
    expect(res.status).toBe(404);
    expect(mockEmitAuthSessionUpdate).not.toHaveBeenCalled();
  });

  it('does not cancel an already-authorized session (no emit, no save)', async () => {
    const session = { sessionToken: 'secret-token', status: 'authorized', save: jest.fn() };
    mockAuthSessionFindOne.mockResolvedValueOnce(session);

    const res = await post(server, '/auth/session/deny/code-1');

    expect(res.status).toBe(200);
    expect(session.status).toBe('authorized');
    expect(session.save).not.toHaveBeenCalled();
    expect(mockEmitAuthSessionUpdate).not.toHaveBeenCalled();
  });
});

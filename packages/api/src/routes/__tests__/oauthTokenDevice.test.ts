/**
 * POST /auth/oauth/token — device attribution / one-session-per-account-per-device.
 *
 * The token grant used to be the last mint path that never threaded a device
 * attribution — it called `createSession(userId, req, { deviceName })` with no
 * deviceId, so every exchange orphaned a fresh UA/IP-derived device (the cleanest
 * reproduction of "an RP shows a different account list"). These tests pin the
 * seal:
 *  - a resolved device whose account is ALREADY registered on it → REUSE the
 *    registered session (no fresh createSession), response carries its tokens;
 *  - a resolved device with no registered session → createSession threads the
 *    deviceId + the fresh session is registered into the device set (add-only);
 *  - no resolvable device → createSession is called WITHOUT a deviceId and the
 *    device-set machinery is never touched (we do not invent an attribution).
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockExchangeAuthCode = jest.fn();
const mockApplicationCredentialFindOne = jest.fn();
const mockApplicationFindOne = jest.fn();
const mockUserFindById = jest.fn();
const mockIsCredentialUsable = jest.fn(() => true);
const mockFormatUserResponse = jest.fn(() => ({ id: 'user-1', username: 'u1' }));

const mockResolveLoginDeviceId = jest.fn();
const mockResolveRegisteredSession = jest.fn();
const mockAddAccount = jest.fn();
const mockCreateSession = jest.fn();
const mockGetSession = jest.fn();
const mockBroadcast = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Passthrough validate so the raw body (including the additive optional
// `deviceToken` field) reaches the handler untouched.
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
  User: { findOne: jest.fn(), findById: mockUserFindById },
  default: { findOne: jest.fn(), findById: mockUserFindById },
}));

jest.mock('../../models/RefreshToken', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  RefreshToken: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
}));

jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
}));

jest.mock('../../utils/credentialUsability', () => ({
  isCredentialUsable: (...a: unknown[]) => mockIsCredentialUsable(...a),
}));

jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: (...a: unknown[]) => mockFormatUserResponse(...a),
}));

jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: jest.fn(),
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    createSession: (...a: unknown[]) => mockCreateSession(...a),
    getSession: (...a: unknown[]) => mockGetSession(...a),
  },
}));

jest.mock('../../services/deviceSession.service', () => {
  // auth.ts destructures the NAMED `deviceSessionService` from a lazy
  // `await import('../services/deviceSession.service.js')` — expose both.
  const svc = {
    resolveRegisteredSession: (...a: unknown[]) => mockResolveRegisteredSession(...a),
    addAccount: (...a: unknown[]) => mockAddAccount(...a),
  };
  return { __esModule: true, default: svc, deviceSessionService: svc };
});

jest.mock('../../services/deviceLogin.service', () => ({
  resolveLoginDeviceId: (...a: unknown[]) => mockResolveLoginDeviceId(...a),
}));

jest.mock('../../utils/socket', () => ({
  broadcastDeviceState: (...a: unknown[]) => mockBroadcast(...a),
}));

jest.mock('../../services/oauthCode.service', () => ({
  issueAuthCode: jest.fn(),
  exchangeAuthCode: (...a: unknown[]) => mockExchangeAuthCode(...a),
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
    register: jest.fn(), signUp: jest.fn(), signIn: jest.fn(),
    requestChallenge: jest.fn(), verifyChallenge: jest.fn(),
    requestPasswordReset: jest.fn(), verifyRecoveryCode: jest.fn(),
    resetPassword: jest.fn(), getUserByPublicKey: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../socialAuth', () => ({ __esModule: true, default: express.Router() }));

import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: {
    data?: { access_token?: string; refresh_token?: string; session_id?: string };
    error?: string;
    message?: string;
  };
}

async function requestJson(server: http.Server, path: string, payload: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST', host: '127.0.0.1', port: address.port, path,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }); }
          catch (err) { reject(err); }
        });
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

beforeEach(() => {
  jest.clearAllMocks();
  mockIsCredentialUsable.mockReturnValue(true);
  mockFormatUserResponse.mockReturnValue({ id: 'user-1', username: 'u1' });
  mockApplicationCredentialFindOne.mockResolvedValue({ publicKey: 'oxy_dk_client', applicationId: 'app-1', status: 'active' });
  mockApplicationFindOne.mockResolvedValue({ _id: { toString: () => 'app-1' }, name: 'Test App', save: jest.fn().mockResolvedValue(undefined) });
  mockUserFindById.mockResolvedValue({ _id: { toString: () => 'user-1' } });
  mockExchangeAuthCode.mockResolvedValue({ ok: true, code: { userId: 'user-1' } });
});

const BODY = { code: 'raw-code', clientId: 'oxy_dk_client', redirectUri: 'https://rp.example/cb', codeVerifier: 'v'.repeat(43) };

describe('POST /auth/oauth/token — device attribution', () => {
  it('REUSES the registered session (no fresh mint) when the account is already on the resolved device', async () => {
    mockResolveLoginDeviceId.mockResolvedValueOnce('central-device');
    mockResolveRegisteredSession.mockResolvedValueOnce({
      sessionId: 'registered-sess', deviceId: 'central-device', accessToken: 'x', expiresAt: new Date(),
    });
    mockGetSession.mockResolvedValueOnce({
      sessionId: 'registered-sess', accessToken: 'reg-access', refreshToken: 'reg-refresh',
    });

    const res = await requestJson(server, '/auth/oauth/token', { ...BODY, deviceToken: 'dt' });

    expect(res.status).toBe(200);
    // Resolved the device from the presented deviceToken, then reused the doc's session.
    expect(mockResolveLoginDeviceId).toHaveBeenCalledWith(expect.anything(), 'dt');
    expect(mockResolveRegisteredSession).toHaveBeenCalledWith('central-device', 'user-1');
    // No fresh mint, no re-registration — the account was already registered.
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockAddAccount).not.toHaveBeenCalled();
    // Response carries the REGISTERED session's tokens (central deviceId claim).
    expect(res.body.data?.access_token).toBe('reg-access');
    expect(res.body.data?.refresh_token).toBe('reg-refresh');
    expect(res.body.data?.session_id).toBe('registered-sess');
  });

  it('threads the resolved deviceId into a fresh mint and registers it (add-only) when nothing is registered yet', async () => {
    mockResolveLoginDeviceId.mockResolvedValueOnce('central-device');
    mockResolveRegisteredSession.mockResolvedValueOnce(null);
    mockCreateSession.mockResolvedValueOnce({
      sessionId: 'fresh-sess', deviceId: 'central-device', accessToken: 'fresh-access', refreshToken: 'fresh-refresh',
    });
    mockAddAccount.mockResolvedValueOnce({ state: { deviceId: 'central-device' }, changed: true });

    const res = await requestJson(server, '/auth/oauth/token', { ...BODY, deviceToken: 'dt' });

    expect(res.status).toBe(200);
    // Fresh mint carries the resolved central deviceId.
    expect(mockCreateSession).toHaveBeenCalledWith('user-1', expect.anything(), { deviceName: 'Test App OAuth', deviceId: 'central-device' });
    // The fresh session is registered into the device set (add-only) and broadcast.
    expect(mockAddAccount).toHaveBeenCalledWith('central-device', { accountId: 'user-1', sessionId: 'fresh-sess' }, { activate: 'if-empty' });
    expect(mockBroadcast).toHaveBeenCalledWith({ deviceId: 'central-device' });
    expect(res.body.data?.access_token).toBe('fresh-access');
    expect(res.body.data?.session_id).toBe('fresh-sess');
  });

  it('does NOT invent a device attribution when none resolves (createSession without deviceId; device set untouched)', async () => {
    mockResolveLoginDeviceId.mockResolvedValueOnce(null);
    mockCreateSession.mockResolvedValueOnce({
      sessionId: 'ua-sess', deviceId: 'ua-derived', accessToken: 'ua-access', refreshToken: 'ua-refresh',
    });

    const res = await requestJson(server, '/auth/oauth/token', BODY);

    expect(res.status).toBe(200);
    // No deviceId threaded — pre-existing UA/IP attribution preserved.
    expect(mockCreateSession).toHaveBeenCalledWith('user-1', expect.anything(), { deviceName: 'Test App OAuth' });
    expect(mockResolveRegisteredSession).not.toHaveBeenCalled();
    expect(mockAddAccount).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(res.body.data?.access_token).toBe('ua-access');
  });
});

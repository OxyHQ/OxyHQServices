/**
 * POST /auth/session/claim tests (device-flow token exchange)
 *
 * This route accepts the 128-bit `sessionToken` (held only by the
 * originating client, never echoed back to observers) as the credential,
 * exactly as in RFC 8628 §3.4. Tests cover:
 *  - missing sessionToken              -> 400 (validation)
 *  - unknown sessionToken              -> 401 invalid_grant
 *  - not-yet-authorized sessionToken   -> 401 invalid_grant (no `pending` claims)
 *  - cancelled sessionToken            -> 401 invalid_grant
 *  - expired sessionToken              -> 401 invalid_grant
 *  - already-consumed sessionToken     -> 401 invalid_grant (replay prevention)
 *  - happy path                        -> 200 with accessToken+sessionId+user
 *
 * Race-condition coverage is in `services/__tests__/authSession.service.test.ts`.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockClaimAuthSession = jest.fn();
const mockGetAccessToken = jest.fn();
const mockUserFindById = jest.fn();
const mockSessionFindOne = jest.fn();
const mockFormatUserResponse = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: jest.fn(),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/validate', () => {
  return {
    validate: (...args: unknown[]) =>
      // Pass through; rely on the route handler to surface 400s itself.
      // For these tests we only care about the claim-service outcomes.
      (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

jest.mock('../../services/authSession.service', () => ({
  claimAuthSession: (...args: unknown[]) => mockClaimAuthSession(...args),
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
    // Other methods that the route file imports transitively — never
    // invoked from /session/claim, but required so the module loads.
    createSession: jest.fn(),
  },
}));

jest.mock('../../services/oauthCode.service', () => {
  const nodeCrypto = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    issueAuthCode: jest.fn(),
    exchangeAuthCode: jest.fn(),
    AUTH_CODE_TTL_MS: 60_000,
    // Hashing helpers used elsewhere in the OAuth-code flow of auth.ts.
    sha256Hex: (value: string) => nodeCrypto.createHash('sha256').update(value).digest('hex'),
    base64UrlEncode: (buf: Buffer) => buf.toString('base64url'),
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

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockUserFindById(...args), findOne: jest.fn() },
  default: { findById: (...args: unknown[]) => mockUserFindById(...args), findOne: jest.fn() },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: { findOne: (...args: unknown[]) => mockSessionFindOne(...args) },
}));

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
  AuthSession: { findOne: jest.fn() },
}));

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: jest.fn() },
  default: { create: jest.fn() },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findOne: jest.fn() },
  default: { findOne: jest.fn() },
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: jest.fn() },
  default: { findOne: jest.fn() },
}));

// The claim handler now (phase 2c) dynamically imports deviceSessionService to
// additively mint a rotating deviceSecret. Mock it — default: no secret (the
// device carries no doc), so the base response shape is unchanged.
const mockIssueDeviceSecret = jest.fn();
jest.mock('../../services/deviceSession.service', () => {
  const svc = { issueDeviceSecret: (...a: unknown[]) => mockIssueDeviceSecret(...a) };
  return { __esModule: true, default: svc, deviceSessionService: svc };
});

jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: (...args: unknown[]) => mockFormatUserResponse(...args),
}));

jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
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
  body: Record<string, unknown>;
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
});

describe('POST /auth/session/claim', () => {
  it('rejects unknown sessionToken with 401 invalid_grant', async () => {
    mockClaimAuthSession.mockResolvedValueOnce({ ok: false, reason: 'not_found' });

    const res = await requestJson(server, 'POST', '/auth/session/claim', {
      sessionToken: 'unknown-token',
    });

    expect(res.status).toBe(401);
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('rejects pending sessionToken (not yet authorized) with 401 invalid_grant', async () => {
    mockClaimAuthSession.mockResolvedValueOnce({ ok: false, reason: 'pending' });

    const res = await requestJson(server, 'POST', '/auth/session/claim', {
      sessionToken: 'still-pending',
    });

    expect(res.status).toBe(401);
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('rejects expired sessionToken with 401 invalid_grant', async () => {
    mockClaimAuthSession.mockResolvedValueOnce({ ok: false, reason: 'expired' });

    const res = await requestJson(server, 'POST', '/auth/session/claim', {
      sessionToken: 'expired-token',
    });

    expect(res.status).toBe(401);
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('rejects cancelled sessionToken with 401 invalid_grant', async () => {
    mockClaimAuthSession.mockResolvedValueOnce({ ok: false, reason: 'cancelled' });

    const res = await requestJson(server, 'POST', '/auth/session/claim', {
      sessionToken: 'cancelled-token',
    });

    expect(res.status).toBe(401);
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('rejects replayed (already-consumed) sessionToken with 401 invalid_grant', async () => {
    mockClaimAuthSession.mockResolvedValueOnce({ ok: false, reason: 'already_consumed' });

    const res = await requestJson(server, 'POST', '/auth/session/claim', {
      sessionToken: 'replayed-token',
    });

    expect(res.status).toBe(401);
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('returns tokens and user on successful claim', async () => {
    const userId = '64f7c2a1b8e9d3f4a1c2b3d4';
    const sessionId = 'sess-new';
    const expiresAt = new Date(Date.now() + 60_000);

    mockClaimAuthSession.mockResolvedValueOnce({
      ok: true,
      authSession: {
        sessionToken: 'good-token',
        authorizedSessionId: sessionId,
        authorizedUserId: { toString: () => userId },
        applicationId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3ab' },
      },
    });

    mockGetAccessToken.mockResolvedValueOnce({
      accessToken: 'access-jwt',
      expiresAt,
    });

    mockUserFindById.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({ _id: userId, username: 'alice' }),
    });

    mockSessionFindOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          deviceId: 'dev-1',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      }),
    });

    mockFormatUserResponse.mockReturnValueOnce({ id: userId, username: 'alice' });

    const res = await requestJson(server, 'POST', '/auth/session/claim', {
      sessionToken: 'good-token',
    });

    expect(res.status).toBe(200);
    // sendSuccess wraps the body in { data: ... }. Post zero-cookie cutover the
    // claim no longer returns any refresh token — the client restores via the
    // rotating deviceSecret + `POST /session/device/token` instead.
    expect(res.body).toEqual({
      data: {
        accessToken: 'access-jwt',
        sessionId,
        deviceId: 'dev-1',
        expiresAt: expiresAt.toISOString(),
        user: { id: userId, username: 'alice' },
      },
    });
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(mockGetAccessToken).toHaveBeenCalledWith(sessionId);
    // No device doc for this session → no deviceSecret in the base response.
    expect(res.body.data.deviceSecret).toBeUndefined();
  });

  it('includes a rotating deviceSecret when the claimed session carries a device doc (phase 2c)', async () => {
    const userId = '64f7c2a1b8e9d3f4a1c2b3d4';
    const sessionId = 'sess-with-device';
    const expiresAt = new Date(Date.now() + 60_000);

    mockClaimAuthSession.mockResolvedValueOnce({
      ok: true,
      authSession: {
        sessionToken: 'good-token',
        authorizedSessionId: sessionId,
        authorizedUserId: { toString: () => userId },
        applicationId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3ab' },
      },
    });
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'access-jwt', expiresAt });
    mockUserFindById.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ _id: userId, username: 'alice' }) });
    mockSessionFindOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ deviceId: 'dev-9', expiresAt: new Date(Date.now() + 60 * 60 * 1000) }),
      }),
    });
    mockFormatUserResponse.mockReturnValueOnce({ id: userId, username: 'alice' });
    mockIssueDeviceSecret.mockResolvedValueOnce('claim-device-secret');

    const res = await requestJson(server, 'POST', '/auth/session/claim', { sessionToken: 'good-token' });

    expect(res.status).toBe(200);
    expect(mockIssueDeviceSecret).toHaveBeenCalledWith('dev-9');
    expect(res.body.data.deviceSecret).toBe('claim-device-secret');
  });

  it('still succeeds without a deviceSecret when the mint throws (best-effort)', async () => {
    const userId = '64f7c2a1b8e9d3f4a1c2b3d4';
    const sessionId = 'sess-mint-fail';
    const expiresAt = new Date(Date.now() + 60_000);

    mockClaimAuthSession.mockResolvedValueOnce({
      ok: true,
      authSession: {
        sessionToken: 'good-token',
        authorizedSessionId: sessionId,
        authorizedUserId: { toString: () => userId },
        applicationId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3ab' },
      },
    });
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'access-jwt', expiresAt });
    mockUserFindById.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ _id: userId, username: 'alice' }) });
    mockSessionFindOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ deviceId: 'dev-9', expiresAt: new Date(Date.now() + 60 * 60 * 1000) }),
      }),
    });
    mockFormatUserResponse.mockReturnValueOnce({ id: userId, username: 'alice' });
    mockIssueDeviceSecret.mockRejectedValueOnce(new Error('db down'));

    const res = await requestJson(server, 'POST', '/auth/session/claim', { sessionToken: 'good-token' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBe('access-jwt');
    expect(res.body.data.deviceSecret).toBeUndefined();
  });

  it('rejects with 401 if the access token cannot be issued', async () => {
    mockClaimAuthSession.mockResolvedValueOnce({
      ok: true,
      authSession: {
        sessionToken: 'good-token',
        authorizedSessionId: 'sess-missing',
        authorizedUserId: { toString: () => 'uid' },
        applicationId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3ac' },
      },
    });
    mockGetAccessToken.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'POST', '/auth/session/claim', {
      sessionToken: 'good-token',
    });

    expect(res.status).toBe(401);
  });

  it('rejects with 401 if the underlying Session has disappeared', async () => {
    mockClaimAuthSession.mockResolvedValueOnce({
      ok: true,
      authSession: {
        sessionToken: 'good-token',
        authorizedSessionId: 'sess-vanished',
        authorizedUserId: { toString: () => 'uid' },
        applicationId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3ad' },
      },
    });
    mockGetAccessToken.mockResolvedValueOnce({
      accessToken: 'at',
      expiresAt: new Date(),
    });
    mockUserFindById.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({ _id: 'uid', username: 'alice' }),
    });
    mockSessionFindOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    const res = await requestJson(server, 'POST', '/auth/session/claim', {
      sessionToken: 'good-token',
    });

    expect(res.status).toBe(401);
  });
});

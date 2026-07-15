/**
 * WebAuthn authentication ceremony tests (Fase B/b1).
 *
 * Covers login/options (username-first vs usernameless) and login/verify: the
 * credential resolution by public id, the atomic challenge burn, the signature
 * counter-regression guard (including the `newCounter === 0` NON-regression), the
 * unknown-credential / expired-challenge rejections, and the assertion that a
 * successful login mints a session whose response shape is byte-identical to
 * `POST /auth/verify`.
 *
 * `@simplewebauthn/server` is mocked at the module boundary to drive the verify
 * RESULT — real assertion verification is NOT weakened (production calls the real
 * verifier). The session mint is mocked to the SAME `buildSessionAuthResponse`
 * shape `/auth/verify` returns.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const AUTH_CHALLENGE = 'authentication-challenge-abc';
const OXY_ORIGIN = 'https://accounts.oxy.so';
const CRED_ID = 'existing-credential-id';
const USER_ID = '507f1f77bcf86cd799439011';

let mockCredDoc: {
  _id: string;
  credentialID: string;
  credentialPublicKey: Buffer;
  counter: number;
  userId: string;
  transports?: string[];
  lastUsedAt?: Date;
  save: jest.Mock;
} | null;

const mockChallengeCreate = jest.fn();
const mockChallengeFindOneAndUpdate = jest.fn();
const mockCredFindOne = jest.fn();
const mockCredFind = jest.fn();
const mockUserFindOne = jest.fn();
const mockUserFindById = jest.fn();
const mockCreateSession = jest.fn();
const mockFinalizeDeviceLogin = jest.fn();
const mockLogSignIn = jest.fn();
const mockLogSuspicious = jest.fn();
const mockVerifyAuthentication = jest.fn();
const mockGenerateAuthOptions = jest.fn();

function leanValue(value: unknown) {
  return { lean: () => Promise.resolve(value) };
}
function selectLean(value: unknown) {
  return { select: () => leanValue(value) };
}

jest.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: (...args: unknown[]) => mockGenerateAuthOptions(...args),
  verifyAuthenticationResponse: (...args: unknown[]) => mockVerifyAuthentication(...args),
}));

jest.mock('@simplewebauthn/server/helpers', () => ({
  decodeClientDataJSON: () => ({ origin: OXY_ORIGIN, challenge: AUTH_CHALLENGE, type: 'webauthn.get' }),
  isoUint8Array: { fromUTF8String: (s: string) => new TextEncoder().encode(s) },
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/authUtils', () => ({
  extractTokenFromRequest: () => undefined,
  decodeToken: () => null,
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {
    findOne: (...args: unknown[]) => mockUserFindOne(...args),
    findById: (...args: unknown[]) => mockUserFindById(...args),
  },
  buildAuthMethod: (type: string, metadata?: Record<string, unknown>) => ({ type, linkedAt: new Date(), metadata }),
}));

jest.mock('../../models/WebauthnCredential', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockCredFindOne(...args),
    find: (...args: unknown[]) => mockCredFind(...args),
  },
}));

jest.mock('../../models/WebauthnChallenge', () => ({
  __esModule: true,
  default: {
    create: (...args: unknown[]) => mockChallengeCreate(...args),
    findOneAndUpdate: (...args: unknown[]) => mockChallengeFindOneAndUpdate(...args),
  },
}));

jest.mock('../../models/Notification', () => ({ __esModule: true, default: class { save = jest.fn(); } }));

jest.mock('../../utils/userCache', () => ({ __esModule: true, default: { invalidate: jest.fn() } }));

jest.mock('../../controllers/session.controller', () => ({
  __esModule: true,
  buildSessionAuthResponse: (
    session: { sessionId: string; deviceId: string; expiresAt: Date; accessToken?: string },
    user: { _id: { toString(): string }; username?: string; avatar?: string },
  ) => ({
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    expiresAt: session.expiresAt.toISOString(),
    accessToken: session.accessToken,
    user: { id: user._id.toString(), username: user.username, avatar: user.avatar },
  }),
  sessionCreateOptionsFromBody: (body: { deviceName?: string; deviceFingerprint?: string; deviceId?: string }) => ({
    deviceName: body.deviceName,
    deviceFingerprint: body.deviceFingerprint,
    ...(body.deviceId ? { deviceId: body.deviceId } : {}),
  }),
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: (...args: unknown[]) => mockCreateSession(...args) },
}));

jest.mock('../../services/deviceLogin.service', () => ({
  __esModule: true,
  finalizeDeviceLogin: (...args: unknown[]) => mockFinalizeDeviceLogin(...args),
}));

jest.mock('../../services/securityActivityService', () => ({
  __esModule: true,
  default: {
    logSignIn: (...args: unknown[]) => mockLogSignIn(...args),
    logSuspiciousActivity: (...args: unknown[]) => mockLogSuspicious(...args),
  },
}));

import webauthnRouter from '../webauthn';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function request(server: http.Server, method: string, path: string, payload?: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: body !== undefined
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** A minimal AuthenticationResponseJSON-shaped payload; the verifier is mocked. */
function authenticationResponse() {
  return {
    id: CRED_ID,
    rawId: CRED_ID,
    type: 'public-key',
    clientExtensionResults: {},
    response: { clientDataJSON: 'stub', authenticatorData: 'stub', signature: 'stub' },
  };
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/webauthn', webauthnRouter);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCredDoc = {
    _id: 'cred-doc-1',
    credentialID: CRED_ID,
    credentialPublicKey: Buffer.from([1, 2, 3, 4]),
    counter: 5,
    userId: USER_ID,
    transports: ['internal'],
    save: jest.fn().mockResolvedValue(undefined),
  };

  mockGenerateAuthOptions.mockResolvedValue({ challenge: AUTH_CHALLENGE, allowCredentials: [], rpId: 'localhost' });
  mockChallengeCreate.mockResolvedValue({});
  // Default: challenge burns successfully (username-first / first attempt matches).
  mockChallengeFindOneAndUpdate.mockImplementation(() => leanValue({ _id: 'ch1', challenge: AUTH_CHALLENGE }));
  mockCredFindOne.mockImplementation(() => Promise.resolve(mockCredDoc));
  mockCredFind.mockReturnValue(selectLean([]));
  mockUserFindOne.mockReturnValue(selectLean(null));
  mockUserFindById.mockResolvedValue({ _id: USER_ID, username: 'loginuser', avatar: undefined });
  mockCreateSession.mockResolvedValue({
    sessionId: 'sess-1',
    deviceId: 'dev-1',
    accessToken: 'access-token-1',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date(),
    deviceInfo: { deviceName: 'Test Device', deviceType: 'web', platform: 'web' },
  });
  mockFinalizeDeviceLogin.mockResolvedValue({ deviceSecret: 'device-secret-1' });
  mockLogSignIn.mockResolvedValue(undefined);
  mockLogSuspicious.mockResolvedValue(undefined);
  mockVerifyAuthentication.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });
});

describe('POST /webauthn/login/options', () => {
  it('a supplied username does NOT leak the account: empty allowCredentials, unbound challenge, no DB lookup', async () => {
    // Arrange the store so that IF the handler looked the user up it would find a
    // matching account with a credential — proving the handler ignores it.
    mockUserFindOne.mockReturnValue(selectLean({ _id: USER_ID }));
    mockCredFind.mockReturnValue(selectLean([{ credentialID: CRED_ID, transports: ['internal'] }]));

    const res = await request(server, 'POST', '/webauthn/login/options', { username: 'loginuser' });

    expect(res.status).toBe(200);
    // Discoverable-only: never emit the user's credentialIDs.
    const opts = mockGenerateAuthOptions.mock.calls[0][0] as { allowCredentials: unknown[]; userVerification?: string };
    expect(opts.allowCredentials).toHaveLength(0);
    expect(opts.userVerification).toBe('required');
    // Challenge is not bound to any account.
    const stored = mockChallengeCreate.mock.calls[0][0] as { type: string; userId?: string };
    expect(stored.type).toBe('authentication');
    expect(stored.userId).toBeUndefined();
    // No account-existence-dependent branching or timing: the user/credential
    // lookups must NOT run at all.
    expect(mockUserFindOne).not.toHaveBeenCalled();
    expect(mockCredFind).not.toHaveBeenCalled();
  });

  it('usernameless (discoverable): empty allowCredentials and an unbound challenge', async () => {
    const res = await request(server, 'POST', '/webauthn/login/options', {});
    expect(res.status).toBe(200);
    const opts = mockGenerateAuthOptions.mock.calls[0][0] as { allowCredentials: unknown[] };
    expect(opts.allowCredentials).toHaveLength(0);
    const stored = mockChallengeCreate.mock.calls[0][0] as { userId?: string };
    expect(stored.userId).toBeUndefined();
    expect(mockUserFindOne).not.toHaveBeenCalled();
    expect(mockCredFind).not.toHaveBeenCalled();
  });
});

describe('POST /webauthn/login/verify', () => {
  it('mints a session with the byte-identical AuthSuccess shape of /auth/verify', async () => {
    const res = await request(server, 'POST', '/webauthn/login/verify', { response: authenticationResponse() });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'deviceId', 'deviceSecret', 'expiresAt', 'sessionId', 'user']);
    expect(res.body.deviceSecret).toBe('device-secret-1');
    expect(res.body.accessToken).toBe('access-token-1');
    expect(res.body.user).toMatchObject({ id: USER_ID, username: 'loginuser' });
    // Counter advanced and persisted.
    expect(mockCredDoc?.counter).toBe(6);
    expect(mockCredDoc?.save).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it('accepts a platform authenticator that never increments (newCounter === 0, stored 0)', async () => {
    if (mockCredDoc) mockCredDoc.counter = 0;
    mockVerifyAuthentication.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 0 } });

    const res = await request(server, 'POST', '/webauthn/login/verify', { response: authenticationResponse() });

    expect(res.status).toBe(200);
    expect(mockCredDoc?.counter).toBe(0);
    expect(mockLogSuspicious).not.toHaveBeenCalled();
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it('rejects a genuine counter regression (401 + security log, no session)', async () => {
    if (mockCredDoc) mockCredDoc.counter = 10;
    mockVerifyAuthentication.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 4 } });

    const res = await request(server, 'POST', '/webauthn/login/verify', { response: authenticationResponse() });

    expect(res.status).toBe(401);
    expect(mockLogSuspicious).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockCredDoc?.save).not.toHaveBeenCalled();
  });

  it('rejects an unknown credential with 401', async () => {
    mockCredDoc = null;
    mockCredFindOne.mockResolvedValue(null);
    const res = await request(server, 'POST', '/webauthn/login/verify', { response: authenticationResponse() });
    expect(res.status).toBe(401);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects an expired/burned challenge with 401', async () => {
    mockChallengeFindOneAndUpdate.mockImplementation(() => leanValue(null));
    const res = await request(server, 'POST', '/webauthn/login/verify', { response: authenticationResponse() });
    expect(res.status).toBe(401);
    expect(mockVerifyAuthentication).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects when the assertion does not verify', async () => {
    mockVerifyAuthentication.mockResolvedValue({ verified: false, authenticationInfo: { newCounter: 6 } });
    const res = await request(server, 'POST', '/webauthn/login/verify', { response: authenticationResponse() });
    expect(res.status).toBe(401);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});

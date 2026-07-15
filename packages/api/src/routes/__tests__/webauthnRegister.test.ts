/**
 * WebAuthn registration ceremony tests (Fase B/b1).
 *
 * Exercises the Oxy orchestration around `@simplewebauthn/server`: username
 * availability at options time, the atomic (flow-bound) challenge burn, the
 * linking branch (push credential + authMethods + invalidate cache), the signup
 * branch (create account + credential, run the shared session mint), and the
 * duplicate-credential / expired-challenge rejections.
 *
 * `@simplewebauthn/server` is mocked at the MODULE BOUNDARY so the test can drive
 * the verification RESULT — production still calls the real verifier; nothing
 * about real attestation verification is weakened here. The session mint is
 * mocked to the SAME `AuthSuccess` shape `/auth/verify` returns (see
 * `buildSessionAuthResponse`), so the signup branch's response shape is locked.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const REG_CHALLENGE = 'registration-challenge-abc';
const OXY_ORIGIN = 'https://accounts.oxy.so';
const NEW_CRED_ID = 'new-credential-id-xyz';
const LINK_USER_ID = '507f1f77bcf86cd799439011';
const NEW_USER_ID = '507f1f77bcf86cd7994390aa';

// ---- controllable mock state ----------------------------------------------
let mockBearerUserId: string | null = null;
let mockBurnResult: unknown = { _id: 'c1', challenge: REG_CHALLENGE, type: 'registration' };
let mockCredCreateError: { code?: number } | null = null;

const mockChallengeCreate = jest.fn();
const mockChallengeFindOneAndUpdate = jest.fn();
const mockCredFind = jest.fn();
const mockCredCreate = jest.fn();
const mockUserFindById = jest.fn();
const mockUserFindOne = jest.fn();
const mockUserFindByIdAndDelete = jest.fn();
const mockUserSave = jest.fn();
const mockInvalidate = jest.fn();
const mockCreateSession = jest.fn();
const mockFinalizeDeviceLogin = jest.fn();
const mockLogSignIn = jest.fn();
const mockVerifyRegistration = jest.fn();

let mockNewUserDoc: { _id: string; username?: string; avatar?: string; authMethods: unknown[]; save: jest.Mock };

function leanValue(value: unknown) {
  return { lean: () => Promise.resolve(value) };
}
function selectLean(value: unknown) {
  return { select: () => leanValue(value) };
}

// ---- module mocks ----------------------------------------------------------
jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({
    challenge: REG_CHALLENGE,
    rp: { name: 'Oxy', id: 'localhost' },
    user: { id: 'x', name: 'x', displayName: '' },
    pubKeyCredParams: [],
    excludeCredentials: [],
  })),
  verifyRegistrationResponse: (...args: unknown[]) => mockVerifyRegistration(...args),
}));

jest.mock('@simplewebauthn/server/helpers', () => ({
  decodeClientDataJSON: () => ({ origin: OXY_ORIGIN, challenge: REG_CHALLENGE, type: 'webauthn.create' }),
  isoUint8Array: { fromUTF8String: (s: string) => new TextEncoder().encode(s) },
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/authUtils', () => ({
  extractTokenFromRequest: (req: { headers: Record<string, string> }) =>
    req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined,
  decodeToken: () => (mockBearerUserId ? { userId: mockBearerUserId, type: 'access' } : null),
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: class {
    _id = NEW_USER_ID;
    username?: string;
    avatar?: string;
    authMethods: unknown[] = [];
    constructor(init: { username?: string; authMethods?: unknown[] }) {
      this.username = init.username;
      this.authMethods = init.authMethods ?? [];
      mockNewUserDoc = this as unknown as typeof mockNewUserDoc;
    }
    save = mockUserSave;
    static findById = (...args: unknown[]) => mockUserFindById(...args);
    static findOne = (...args: unknown[]) => mockUserFindOne(...args);
    static findByIdAndDelete = (...args: unknown[]) => mockUserFindByIdAndDelete(...args);
  },
  buildAuthMethod: (type: string, metadata?: Record<string, unknown>) => ({ type, linkedAt: new Date(), metadata }),
}));

jest.mock('../../models/WebauthnCredential', () => ({
  __esModule: true,
  default: {
    find: (...args: unknown[]) => mockCredFind(...args),
    create: (...args: unknown[]) => mockCredCreate(...args),
  },
}));

jest.mock('../../models/WebauthnChallenge', () => ({
  __esModule: true,
  default: {
    create: (...args: unknown[]) => mockChallengeCreate(...args),
    findOneAndUpdate: (...args: unknown[]) => mockChallengeFindOneAndUpdate(...args),
  },
}));

jest.mock('../../models/Notification', () => ({
  __esModule: true,
  default: class {
    save = jest.fn().mockResolvedValue(undefined);
  },
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: (...args: unknown[]) => mockInvalidate(...args) },
}));

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
  default: { logSignIn: (...args: unknown[]) => mockLogSignIn(...args), logSuspiciousActivity: jest.fn() },
}));

import webauthnRouter from '../webauthn';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function request(
  server: http.Server,
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: {
          ...(body !== undefined
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
            : {}),
          ...headers,
        },
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

/** A minimal RegistrationResponseJSON-shaped payload; the verifier is mocked. */
function registrationResponse() {
  return {
    id: NEW_CRED_ID,
    rawId: NEW_CRED_ID,
    type: 'public-key',
    clientExtensionResults: {},
    response: { clientDataJSON: 'stub', attestationObject: 'stub' },
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
  mockBearerUserId = null;
  mockBurnResult = { _id: 'c1', challenge: REG_CHALLENGE, type: 'registration' };
  mockCredCreateError = null;

  mockChallengeCreate.mockResolvedValue({});
  mockChallengeFindOneAndUpdate.mockImplementation(() => leanValue(mockBurnResult));
  mockCredFind.mockReturnValue(selectLean([]));
  mockCredCreate.mockImplementation(async () => {
    if (mockCredCreateError) throw mockCredCreateError;
    return {};
  });
  mockUserSave.mockResolvedValue(undefined);
  mockUserFindById.mockReturnValue({ _id: LINK_USER_ID, username: 'linker', authMethods: [], save: mockUserSave });
  mockUserFindOne.mockReturnValue(selectLean(null));
  mockUserFindByIdAndDelete.mockResolvedValue(undefined);
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
  mockVerifyRegistration.mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: { id: NEW_CRED_ID, publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ['internal'] },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  });
});

describe('POST /webauthn/register/options', () => {
  it('signup branch: validates username availability and persists a registration challenge', async () => {
    const res = await request(server, 'POST', '/webauthn/register/options', { username: 'freshuser' });
    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe(REG_CHALLENGE);
    expect(mockChallengeCreate).toHaveBeenCalledTimes(1);
    const stored = mockChallengeCreate.mock.calls[0][0] as { type: string; userId?: string };
    expect(stored.type).toBe('registration');
    expect(stored.userId).toBeUndefined(); // signup challenge is not bound to a user
  });

  it('rejects a taken username with 409 (no challenge stored)', async () => {
    mockUserFindOne.mockReturnValue(selectLean({ _id: 'someone' }));
    const res = await request(server, 'POST', '/webauthn/register/options', { username: 'taken' });
    expect(res.status).toBe(409);
    expect(mockChallengeCreate).not.toHaveBeenCalled();
  });

  it('requires a username in the signup branch', async () => {
    const res = await request(server, 'POST', '/webauthn/register/options', {});
    expect(res.status).toBe(400);
  });
});

describe('POST /webauthn/register/verify — signup branch', () => {
  it('creates the account + credential + webauthn authMethod and returns the AuthSuccess mint shape', async () => {
    const res = await request(server, 'POST', '/webauthn/register/verify', {
      username: 'freshuser',
      deviceName: 'My Laptop',
      response: registrationResponse(),
    });

    expect(res.status).toBe(200);
    // Byte-identical shape to POST /auth/verify: buildSessionAuthResponse + deviceSecret.
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'deviceId', 'deviceSecret', 'expiresAt', 'sessionId', 'user']);
    expect(res.body.deviceSecret).toBe('device-secret-1');
    expect(res.body.accessToken).toBe('access-token-1');
    // Same nested user shape as /auth/verify (avatar omitted when undefined, as JSON does).
    expect(res.body.user).toMatchObject({ id: NEW_USER_ID, username: 'freshuser' });

    // Account + credential were created; a webauthn authMethod was stamped.
    expect(mockUserSave).toHaveBeenCalledTimes(1);
    expect(mockCredCreate).toHaveBeenCalledTimes(1);
    const credArg = mockCredCreate.mock.calls[0][0] as { credentialID: string; name: string; deviceType: string };
    expect(credArg.credentialID).toBe(NEW_CRED_ID);
    expect(credArg.name).toBe('My Laptop');
    expect(mockNewUserDoc.authMethods).toHaveLength(1);
    expect((mockNewUserDoc.authMethods[0] as { type: string }).type).toBe('webauthn');
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it('rolls back the account when the credential insert collides (duplicate) → 409', async () => {
    mockCredCreateError = { code: 11000 };
    const res = await request(server, 'POST', '/webauthn/register/verify', {
      username: 'freshuser',
      response: registrationResponse(),
    });
    expect(res.status).toBe(409);
    expect(mockUserFindByIdAndDelete).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects a burned/expired challenge with 401 (no account created)', async () => {
    mockBurnResult = null; // findOneAndUpdate matches nothing
    const res = await request(server, 'POST', '/webauthn/register/verify', {
      username: 'freshuser',
      response: registrationResponse(),
    });
    expect(res.status).toBe(401);
    expect(mockUserSave).not.toHaveBeenCalled();
    expect(mockCredCreate).not.toHaveBeenCalled();
  });

  it('rejects when the attestation does not verify', async () => {
    mockVerifyRegistration.mockResolvedValue({ verified: false });
    const res = await request(server, 'POST', '/webauthn/register/verify', {
      username: 'freshuser',
      response: registrationResponse(),
    });
    expect(res.status).toBe(400);
    expect(mockCredCreate).not.toHaveBeenCalled();
  });
});

describe('POST /webauthn/register/verify — linking branch', () => {
  it('links the passkey to the bearer account (credential + authMethod + cache invalidate)', async () => {
    mockBearerUserId = LINK_USER_ID;
    const linkDoc = { _id: LINK_USER_ID, username: 'linker', authMethods: [] as unknown[], save: mockUserSave };
    mockUserFindById.mockReturnValue(linkDoc);

    const res = await request(
      server,
      'POST',
      '/webauthn/register/verify',
      { deviceName: 'YubiKey', response: registrationResponse() },
      { authorization: 'Bearer valid-token' },
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockCredCreate).toHaveBeenCalledTimes(1);
    expect(linkDoc.authMethods).toHaveLength(1);
    expect((linkDoc.authMethods[0] as { type: string }).type).toBe('webauthn');
    expect(mockInvalidate).toHaveBeenCalledWith(LINK_USER_ID);
    // Linking does NOT mint a new session.
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('binds the burn to the caller: a linking challenge query carries the user id', async () => {
    mockBearerUserId = LINK_USER_ID;
    mockUserFindById.mockReturnValue({ _id: LINK_USER_ID, username: 'linker', authMethods: [], save: mockUserSave });
    await request(
      server,
      'POST',
      '/webauthn/register/verify',
      { response: registrationResponse() },
      { authorization: 'Bearer valid-token' },
    );
    const query = mockChallengeFindOneAndUpdate.mock.calls[0][0] as { userId: unknown };
    expect(query.userId).toBe(LINK_USER_ID);
  });

  it('rejects a duplicate passkey on link with 409', async () => {
    mockBearerUserId = LINK_USER_ID;
    mockUserFindById.mockReturnValue({ _id: LINK_USER_ID, username: 'linker', authMethods: [], save: mockUserSave });
    mockCredCreateError = { code: 11000 };
    const res = await request(
      server,
      'POST',
      '/webauthn/register/verify',
      { response: registrationResponse() },
      { authorization: 'Bearer valid-token' },
    );
    expect(res.status).toBe(409);
  });
});

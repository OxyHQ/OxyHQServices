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

// The username-first decoy is keyed on DEVICE_ID_SALT (fail-closed if empty — see
// `decoyAllowCredentials`). Pin a fixed, non-empty salt so the decoy is
// deterministic under test and the count/length/transports assertions below are
// stable rather than dependent on the ambient environment.
process.env.DEVICE_ID_SALT = 'test-device-id-salt-for-webauthn-decoy-anti-enum';

/** Decoded byte length of a base64url credential id. */
function decodedByteLength(id: string): number {
  return Buffer.from(id, 'base64url').length;
}

let mockCredDoc: {
  _id: string;
  credentialID: string;
  credentialPublicKey: Buffer;
  counter: number;
  userId: string;
  transports?: string[];
  userVerified?: boolean;
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
    userVerified: false,
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
  mockVerifyAuthentication.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6, userVerified: true } });
});

interface AuthOptionsArg {
  allowCredentials: { id: string; transports?: string[] }[];
  userVerification?: string;
}

describe('POST /webauthn/login/options', () => {
  it('username-first (KNOWN username): returns that user\'s allowCredentials + a challenge bound to the account', async () => {
    mockUserFindOne.mockReturnValue(selectLean({ _id: USER_ID }));
    mockCredFind.mockReturnValue(selectLean([{ credentialID: CRED_ID, transports: ['usb', 'nfc'] }]));

    const res = await request(server, 'POST', '/webauthn/login/options', { username: 'loginuser' });

    expect(res.status).toBe(200);
    const opts = mockGenerateAuthOptions.mock.calls[0][0] as AuthOptionsArg;
    // The user's real credential id is surfaced so a non-discoverable hardware key
    // can be invoked by the browser.
    expect(opts.allowCredentials).toEqual([{ id: CRED_ID, transports: ['usb', 'nfc'] }]);
    expect(opts.userVerification).toBe('preferred');
    // Challenge is bound to the resolved account (so verify can reject a foreign key).
    const stored = mockChallengeCreate.mock.calls[0][0] as { type: string; userId?: unknown };
    expect(stored.type).toBe('authentication');
    expect(String(stored.userId)).toBe(USER_ID);
    // The user + credential lookups both ran (same work as the not-found path).
    expect(mockUserFindOne).toHaveBeenCalledTimes(1);
    expect(mockCredFind).toHaveBeenCalledTimes(1);
  });

  it('username-first (UNKNOWN username): returns a decoy allow-list of the same shape — never empty, never the real user\'s id, no non-existence tell', async () => {
    // The account does not exist and the (throwaway-id) credential query returns none.
    mockUserFindOne.mockReturnValue(selectLean(null));
    mockCredFind.mockReturnValue(selectLean([]));

    const res = await request(server, 'POST', '/webauthn/login/options', { username: 'ghostuser' });

    expect(res.status).toBe(200);
    const opts = mockGenerateAuthOptions.mock.calls[0][0] as AuthOptionsArg;
    // Non-empty and masked to 1 OR 2 entries (a real account with 1–2 passkeys must
    // be indistinguishable — a fixed count-of-1 would leak "≥2 passkeys" via count).
    expect(opts.allowCredentials.length).toBeGreaterThanOrEqual(1);
    expect(opts.allowCredentials.length).toBeLessThanOrEqual(2);
    for (const cred of opts.allowCredentials) {
      expect(typeof cred.id).toBe('string');
      expect(cred.id.length).toBeGreaterThan(0);
      // NOT any real credential id.
      expect(cred.id).not.toBe(CRED_ID);
      // Realistic credential-id length (16–64 bytes), covering both short platform
      // passkeys and long roaming/hardware-key ids — no fixed tell-tale size.
      expect(decodedByteLength(cred.id)).toBeGreaterThanOrEqual(16);
      expect(decodedByteLength(cred.id)).toBeLessThanOrEqual(64);
      // transports is either a real-looking array or omitted entirely (like real
      // credentials that advertise none) — never some other shape.
      if (cred.transports !== undefined) {
        expect(Array.isArray(cred.transports)).toBe(true);
        expect(cred.transports.length).toBeGreaterThan(0);
      }
    }
    // Distinct ids when the decoy has two entries (like a real multi-passkey account).
    if (opts.allowCredentials.length === 2) {
      expect(opts.allowCredentials[0].id).not.toBe(opts.allowCredentials[1].id);
    }
    // A bound challenge is still stored (non-null userId), so nothing about the
    // response reveals that the account does not exist.
    const stored = mockChallengeCreate.mock.calls[0][0] as { type: string; userId?: unknown };
    expect(stored.type).toBe('authentication');
    expect(stored.userId).toBeDefined();
    // SAME work as the found path: user lookup + one credential query both ran (no
    // account-existence-dependent early return / timing oracle).
    expect(mockUserFindOne).toHaveBeenCalledTimes(1);
    expect(mockCredFind).toHaveBeenCalledTimes(1);
  });

  it('the decoy COUNT is masked (not always 1): across a spread of usernames both 1- and 2-entry decoys appear', async () => {
    // A fixed count-of-1 decoy made `count === 2` a clean "this public username has
    // ≥2 passkeys" oracle. The count is now a deterministic 1 OR 2 keyed on the salt,
    // so surveying enough usernames must surface BOTH lengths.
    mockUserFindOne.mockReturnValue(selectLean(null));
    mockCredFind.mockReturnValue(selectLean([]));

    const observedCounts = new Set<number>();
    for (let i = 0; i < 16; i += 1) {
      await request(server, 'POST', '/webauthn/login/options', { username: `probe${i}` });
    }
    for (const call of mockGenerateAuthOptions.mock.calls) {
      observedCounts.add((call[0] as AuthOptionsArg).allowCredentials.length);
    }
    // Deterministic under the fixed test salt: probe0..15 yield both 1 and 2.
    expect(observedCounts.has(1)).toBe(true);
    expect(observedCounts.has(2)).toBe(true);
  });

  it('the decoy sometimes OMITS transports (deterministically) so [{id}] vs [{id,transports}] is not a tell', async () => {
    mockUserFindOne.mockReturnValue(selectLean(null));
    mockCredFind.mockReturnValue(selectLean([]));

    let sawOmitted = false;
    let sawPresent = false;
    for (let i = 0; i < 30 && !(sawOmitted && sawPresent); i += 1) {
      await request(server, 'POST', '/webauthn/login/options', { username: `shape${i}` });
    }
    for (const call of mockGenerateAuthOptions.mock.calls) {
      for (const cred of (call[0] as AuthOptionsArg).allowCredentials) {
        if (cred.transports === undefined) sawOmitted = true;
        else sawPresent = true;
      }
    }
    expect(sawOmitted).toBe(true);
    expect(sawPresent).toBe(true);
  });

  it('fails closed (500) when DEVICE_ID_SALT is empty — never emits an attacker-computable decoy', async () => {
    // An empty salt would make the decoy precomputable, defeating anti-enumeration.
    mockUserFindOne.mockReturnValue(selectLean(null));
    mockCredFind.mockReturnValue(selectLean([]));
    const original = process.env.DEVICE_ID_SALT;
    delete process.env.DEVICE_ID_SALT;
    try {
      const res = await request(server, 'POST', '/webauthn/login/options', { username: 'ghostuser' });
      expect(res.status).toBe(500);
      // No challenge is stored on the fail-closed path.
      expect(mockChallengeCreate).not.toHaveBeenCalled();
    } finally {
      process.env.DEVICE_ID_SALT = original;
    }
  });

  it('the decoy is DETERMINISTIC: the same unknown username yields the same decoy id across requests', async () => {
    mockUserFindOne.mockReturnValue(selectLean(null));
    mockCredFind.mockReturnValue(selectLean([]));

    await request(server, 'POST', '/webauthn/login/options', { username: 'ghostuser' });
    await request(server, 'POST', '/webauthn/login/options', { username: 'ghostuser' });

    const first = (mockGenerateAuthOptions.mock.calls[0][0] as AuthOptionsArg).allowCredentials[0].id;
    const second = (mockGenerateAuthOptions.mock.calls[1][0] as AuthOptionsArg).allowCredentials[0].id;
    // Stable across polls (a per-request-random decoy would itself be the tell).
    expect(second).toBe(first);
  });

  it('username-first (KNOWN account with NO passkey): returns a decoy, not an empty allow-list', async () => {
    // A real account that simply has not enrolled a passkey must look identical to
    // an unknown username — otherwise the empty allow-list would leak "exists".
    mockUserFindOne.mockReturnValue(selectLean({ _id: USER_ID }));
    mockCredFind.mockReturnValue(selectLean([]));

    const res = await request(server, 'POST', '/webauthn/login/options', { username: 'loginuser' });

    expect(res.status).toBe(200);
    const opts = mockGenerateAuthOptions.mock.calls[0][0] as AuthOptionsArg;
    // Masked decoy (1–2 entries), never the empty allow-list that would leak "exists".
    expect(opts.allowCredentials.length).toBeGreaterThanOrEqual(1);
    expect(opts.allowCredentials.length).toBeLessThanOrEqual(2);
    for (const cred of opts.allowCredentials) {
      expect(cred.id).not.toBe(CRED_ID);
    }
  });

  it('usernameless (discoverable): empty allowCredentials and an unbound challenge, no lookups', async () => {
    const res = await request(server, 'POST', '/webauthn/login/options', {});
    expect(res.status).toBe(200);
    const opts = mockGenerateAuthOptions.mock.calls[0][0] as AuthOptionsArg;
    expect(opts.allowCredentials).toHaveLength(0);
    const stored = mockChallengeCreate.mock.calls[0][0] as { userId?: unknown };
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
    // Assurance level refreshed from this ceremony (stored false → verified true).
    expect(mockCredDoc?.userVerified).toBe(true);
    expect(mockCredDoc?.save).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    // Possession-only assertions are accepted — UV is not required at verify.
    const verifyArg = mockVerifyAuthentication.mock.calls[0][0] as { requireUserVerification: boolean };
    expect(verifyArg.requireUserVerification).toBe(false);
  });

  it('accepts a possession-only (userVerified:false) assertion and records the flag', async () => {
    // A stored credential that had verified previously authenticates presence-only
    // now (e.g. a U2F key with no PIN) → still succeeds, flag refreshed to false.
    if (mockCredDoc) mockCredDoc.userVerified = true;
    mockVerifyAuthentication.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6, userVerified: false } });

    const res = await request(server, 'POST', '/webauthn/login/verify', { response: authenticationResponse() });

    expect(res.status).toBe(200);
    expect(mockCredDoc?.userVerified).toBe(false);
    expect(mockCredDoc?.save).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it('accepts a platform authenticator that never increments (newCounter === 0, stored 0)', async () => {
    if (mockCredDoc) mockCredDoc.counter = 0;
    mockVerifyAuthentication.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 0, userVerified: true } });

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

  it('rejects a non-string credential id (NoSQL operator injection) with 400 before any query runs', async () => {
    const malicious = authenticationResponse();
    // Attacker sends a Mongo operator object instead of the base64url id.
    (malicious as { id: unknown }).id = { $ne: null };
    const res = await request(server, 'POST', '/webauthn/login/verify', { response: malicious });
    expect(res.status).toBe(400);
    // The value must be rejected BEFORE it can reach a query — no credential
    // lookup, no challenge burn, no session.
    expect(mockCredFindOne).not.toHaveBeenCalled();
    expect(mockChallengeFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects an expired/burned challenge with 401', async () => {
    mockChallengeFindOneAndUpdate.mockImplementation(() => leanValue(null));
    const res = await request(server, 'POST', '/webauthn/login/verify', { response: authenticationResponse() });
    expect(res.status).toBe(401);
    expect(mockVerifyAuthentication).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects a credential whose owner does NOT match a username-bound challenge (cross-user)', async () => {
    // The stored challenge was issued for a DIFFERENT account (OTHER_USER). The
    // presented credential is owned by USER_ID. The owner-bound burn only matches
    // when its queried userId equals the stored owner, so neither the owner-bound
    // attempt (USER_ID) nor the discoverable fallback (null) can burn it.
    const OTHER_USER = '507f1f77bcf86cd7994390ff';
    mockChallengeFindOneAndUpdate.mockImplementation((query: { userId?: unknown }) =>
      leanValue(query.userId === OTHER_USER ? { _id: 'ch-other', challenge: AUTH_CHALLENGE } : null),
    );

    const res = await request(server, 'POST', '/webauthn/login/verify', { response: authenticationResponse() });

    expect(res.status).toBe(401);
    // The handler DID attempt an owner-bound burn keyed on the credential's owner…
    const ownerBoundQuery = mockChallengeFindOneAndUpdate.mock.calls[0][0] as { userId?: unknown };
    expect(ownerBoundQuery.userId).toBe(USER_ID);
    // …and a discoverable (userId:null) fallback — both missed the OTHER_USER row.
    const discoverableQuery = mockChallengeFindOneAndUpdate.mock.calls[1][0] as { userId?: unknown };
    expect(discoverableQuery.userId).toBeNull();
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

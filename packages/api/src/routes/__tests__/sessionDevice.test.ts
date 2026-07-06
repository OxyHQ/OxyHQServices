import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockGetState = jest.fn();
const mockAddAccount = jest.fn();
const mockSwitchActive = jest.fn();
const mockSignout = jest.fn();
const mockResolveActiveToken = jest.fn();
const mockBroadcast = jest.fn();
const mockDecodeToken = jest.fn();
const mockGetSession = jest.fn();
const mockGetStateByCookieKey = jest.fn();
const mockConvergeAccountOntoDevice = jest.fn();
const mockMigrateSessionToDevice = jest.fn();
const mockGetStateBySecret = jest.fn();
const mockIssueDeviceSecret = jest.fn();
const mockIsLockedOut = jest.fn();
const mockRecordFailure = jest.fn();
const mockClearFailures = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...a: unknown[]) => mockAuthMiddleware(...a),
}));
jest.mock('../../middleware/originGuard', () => ({
  requireSameSiteOrigin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/rateLimiter', () => ({ rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
jest.mock('../../middleware/authUtils', () => ({
  decodeToken: (...a: unknown[]) => mockDecodeToken(...a),
  extractTokenFromRequest: () => 'tkn',
}));
jest.mock('../../services/deviceSession.service', () => ({
  __esModule: true,
  default: {
    getState: (...a: unknown[]) => mockGetState(...a),
    addAccount: (...a: unknown[]) => mockAddAccount(...a),
    switchActive: (...a: unknown[]) => mockSwitchActive(...a),
    signout: (...a: unknown[]) => mockSignout(...a),
    resolveActiveToken: (...a: unknown[]) => mockResolveActiveToken(...a),
    getStateByCookieKey: (...a: unknown[]) => mockGetStateByCookieKey(...a),
    convergeAccountOntoDevice: (...a: unknown[]) => mockConvergeAccountOntoDevice(...a),
    getStateBySecret: (...a: unknown[]) => mockGetStateBySecret(...a),
    issueDeviceSecret: (...a: unknown[]) => mockIssueDeviceSecret(...a),
  },
}));
jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    getSession: (...a: unknown[]) => mockGetSession(...a),
    migrateSessionToDevice: (...a: unknown[]) => mockMigrateSessionToDevice(...a),
  },
}));
jest.mock('../../services/loginLockout.service', () => ({
  isLockedOut: (...a: unknown[]) => mockIsLockedOut(...a),
  recordFailure: (...a: unknown[]) => mockRecordFailure(...a),
  clearFailures: (...a: unknown[]) => mockClearFailures(...a),
}));
jest.mock('../../utils/socket', () => ({ broadcastDeviceState: (...a: unknown[]) => mockBroadcast(...a) }));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import sessionDeviceRouter from '../sessionDevice';
import { errorHandler } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

const STATE = { deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: 1, updatedAt: 1720000000000 };

async function requestJson(server: http.Server, method: string, path: string, payload?: unknown, extraHeaders?: Record<string, string>) {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? '' : JSON.stringify(payload);
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request({ method, host: '127.0.0.1', port: address.port, path,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), Authorization: 'Bearer t', ...(extraHeaders ?? {}) } },
      (res) => { let raw = ''; res.on('data', c => { raw += c; }); res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }); }); });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

let server: http.Server;
beforeAll((done) => {
  mockAuthMiddleware.mockImplementation((req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user?: unknown }).user = { _id: { toString: () => '64b0000000000000000000aa' }, id: '64b0000000000000000000aa' };
    next();
  });
  mockDecodeToken.mockReturnValue({ sessionId: 's1', deviceId: 'd1' });
  const app = express();
  app.use(express.json());
  app.use('/session/device', sessionDeviceRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});
afterAll((done) => { server.close(done); });
beforeEach(() => {
  jest.clearAllMocks();
  mockResolveActiveToken.mockResolvedValue({ accessToken: 'jwt-active', expiresAt: '2026-07-07T00:00:00.000Z' });
  // Default to an active first-party session; individual tests override this
  // to exercise managed sessions or the expired/revoked (null) 401 path.
  mockGetSession.mockResolvedValue({ operatedByUserId: null });
  // Default: device is not locked out. Tests override for the 429 path.
  mockIsLockedOut.mockResolvedValue({ locked: false, attempts: 0 });
  mockRecordFailure.mockResolvedValue({ locked: false, attempts: 1 });
  mockClearFailures.mockResolvedValue(undefined);
});

describe('GET /session/device/state', () => {
  it('returns the device state', async () => {
    mockGetState.mockResolvedValueOnce(STATE);
    const res = await requestJson(server, 'GET', '/session/device/state');
    expect(res.status).toBe(200);
    expect(res.body.data.state).toEqual(STATE);
    expect(res.body.data.activeToken).toEqual({ accessToken: 'jwt-active', expiresAt: '2026-07-07T00:00:00.000Z' });
    expect(mockGetState).toHaveBeenCalledWith('d1');
  });

  it('does NOT converge (plain read) when no oxy_device cookie is present', async () => {
    mockGetState.mockResolvedValueOnce(STATE);
    const res = await requestJson(server, 'GET', '/session/device/state');
    expect(res.status).toBe(200);
    expect(mockGetStateByCookieKey).not.toHaveBeenCalled();
    expect(mockMigrateSessionToDevice).not.toHaveBeenCalled();
    expect(mockConvergeAccountOntoDevice).not.toHaveBeenCalled();
    expect(mockGetState).toHaveBeenCalledWith('d1');
  });

  it('does NOT converge (plain read) when the cookie resolves to the SAME device as the JWT', async () => {
    mockGetStateByCookieKey.mockResolvedValueOnce({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0, updatedAt: 1 });
    mockGetState.mockResolvedValueOnce(STATE);
    const res = await requestJson(server, 'GET', '/session/device/state', undefined, { Cookie: 'oxy_device=cookiesecret' });
    expect(res.status).toBe(200);
    expect(mockMigrateSessionToDevice).not.toHaveBeenCalled();
    expect(mockConvergeAccountOntoDevice).not.toHaveBeenCalled();
    expect(mockGetState).toHaveBeenCalledWith('d1');
    expect(res.body.data.state).toEqual(STATE);
  });

  it('CONVERGES on read: migrates the session onto the cookie device when the cookie deviceId differs from the JWT claim', async () => {
    // JWT claims deviceId 'd1'; the oxy_device cookie resolves to the canonical
    // 'cookie-dev'. A switcher that only READS state must still converge — POST
    // /add is never called on this path.
    mockGetStateByCookieKey.mockResolvedValueOnce({ deviceId: 'cookie-dev', accounts: [], activeAccountId: null, revision: 0, updatedAt: 1 });
    mockMigrateSessionToDevice.mockResolvedValueOnce({ accessToken: 'fresh-cookie-token', expiresAt: new Date(), migrated: true });
    const convergedState = { deviceId: 'cookie-dev', accounts: [{ accountId: '64b0000000000000000000aa', sessionId: 's1', authuser: 0 }], activeAccountId: '64b0000000000000000000aa', revision: 10, updatedAt: 2 };
    const oldState = { deviceId: 'd1', accounts: [], activeAccountId: null, revision: 9, updatedAt: 3 };
    mockConvergeAccountOntoDevice.mockResolvedValueOnce({ cookieState: convergedState, oldState, changed: true });
    mockResolveActiveToken.mockResolvedValueOnce({ accessToken: 'fresh-cookie-token', expiresAt: '2026-07-07T00:00:00.000Z' });

    const res = await requestJson(server, 'GET', '/session/device/state', undefined, { Cookie: 'oxy_device=cookiesecret' });

    expect(res.status).toBe(200);
    // Session re-minted onto the cookie device, then the account converged.
    expect(mockMigrateSessionToDevice).toHaveBeenCalledWith('s1', 'cookie-dev');
    expect(mockConvergeAccountOntoDevice).toHaveBeenCalledWith('cookie-dev', 'd1', { accountId: '64b0000000000000000000aa', sessionId: 's1' });
    // BOTH device rooms broadcast on a real migration.
    expect(mockBroadcast).toHaveBeenCalledWith(convergedState);
    expect(mockBroadcast).toHaveBeenCalledWith(oldState);
    // The normal read path is short-circuited — getState never runs.
    expect(mockGetState).not.toHaveBeenCalled();
    // Response carries the converged state + fresh cookie-device token to plant.
    expect(res.body.data.state).toEqual(convergedState);
    expect(res.body.data.activeToken.accessToken).toBe('fresh-cookie-token');
  });

  it('does NOT converge (plain read) when the cookie mismatches but the session is expired/revoked (getSession returns null)', async () => {
    mockGetStateByCookieKey.mockResolvedValueOnce({ deviceId: 'cookie-dev', accounts: [], activeAccountId: null, revision: 0, updatedAt: 1 });
    // Dead session — nothing live to converge; fall through to the plain read.
    mockGetSession.mockResolvedValueOnce(null);
    mockGetState.mockResolvedValueOnce(STATE);

    const res = await requestJson(server, 'GET', '/session/device/state', undefined, { Cookie: 'oxy_device=cookiesecret' });

    expect(res.status).toBe(200);
    expect(mockMigrateSessionToDevice).not.toHaveBeenCalled();
    expect(mockConvergeAccountOntoDevice).not.toHaveBeenCalled();
    expect(mockGetState).toHaveBeenCalledWith('d1');
  });
});

describe('POST /session/device/switch', () => {
  it('switches active account and broadcasts', async () => {
    mockSwitchActive.mockResolvedValueOnce({ ok: true, state: STATE });
    const res = await requestJson(server, 'POST', '/session/device/switch', { accountId: 'a1' });
    expect(res.status).toBe(200);
    expect(mockSwitchActive).toHaveBeenCalledWith('d1', 'a1');
    expect(mockBroadcast).toHaveBeenCalledWith(STATE);
    expect(res.body.data.state).toEqual(STATE);
    expect(res.body.data.activeToken.accessToken).toBe('jwt-active');
  });

  it('404 when the account is not on the device', async () => {
    mockSwitchActive.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    const res = await requestJson(server, 'POST', '/session/device/switch', { accountId: 'ghost' });
    expect(res.status).toBe(404);
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('403 and broadcasts the healed state when the target session is revoked (act_as membership pulled)', async () => {
    const healed = { ...STATE, accounts: [], activeAccountId: null, revision: 2 };
    mockSwitchActive.mockResolvedValueOnce({ ok: false, reason: 'unauthorized', state: healed });
    const res = await requestJson(server, 'POST', '/session/device/switch', { accountId: 'org1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Account not authorized');
    // switchActive healed the device set (dropped the revoked account); the
    // route broadcasts that healed state so the device's other tabs converge.
    expect(mockBroadcast).toHaveBeenCalledWith(healed);
  });
});

describe('POST /session/device/signout', () => {
  it('signs out one account and broadcasts', async () => {
    const after = { ...STATE, accounts: [], activeAccountId: null, revision: 2 };
    mockSignout.mockResolvedValueOnce(after);
    const res = await requestJson(server, 'POST', '/session/device/signout', { accountId: 'a1' });
    expect(res.status).toBe(200);
    expect(mockSignout).toHaveBeenCalledWith('d1', { accountId: 'a1' });
    expect(mockBroadcast).toHaveBeenCalledWith(after);
    expect(res.body.data.state).toEqual(after);
  });

  it('signs out all when { all: true }', async () => {
    const after = { ...STATE, accounts: [], activeAccountId: null, revision: 2 };
    mockSignout.mockResolvedValueOnce(after);
    const res = await requestJson(server, 'POST', '/session/device/signout', { all: true });
    expect(res.status).toBe(200);
    expect(mockSignout).toHaveBeenCalledWith('d1', { all: true });
  });
});

describe('POST /session/device/add', () => {
  it('adds an account and broadcasts when the state changed', async () => {
    mockAddAccount.mockResolvedValueOnce({ state: STATE, changed: true });
    const res = await requestJson(server, 'POST', '/session/device/add', {});
    expect(res.status).toBe(200);
    expect(mockGetSession).toHaveBeenCalledWith('s1', true);
    expect(mockAddAccount).toHaveBeenCalledWith('d1', { accountId: '64b0000000000000000000aa', sessionId: 's1' });
    expect(mockBroadcast).toHaveBeenCalledWith(STATE);
    expect(res.body.data.state).toEqual(STATE);
    expect(res.body.data.activeToken.accessToken).toBe('jwt-active');
  });

  it('does NOT broadcast on an idempotent re-register (changed=false) but still returns the current state', async () => {
    mockAddAccount.mockResolvedValueOnce({ state: STATE, changed: false });
    const res = await requestJson(server, 'POST', '/session/device/add', {});
    expect(res.status).toBe(200);
    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(res.body.data.state).toEqual(STATE);
    expect(res.body.data.activeToken.accessToken).toBe('jwt-active');
  });

  it('passes the operator id through to addAccount for a managed-account session', async () => {
    mockGetSession.mockResolvedValueOnce({ operatedByUserId: { toString: () => 'op1' } });
    mockAddAccount.mockResolvedValueOnce({ state: STATE, changed: true });
    const res = await requestJson(server, 'POST', '/session/device/add', {});
    expect(res.status).toBe(200);
    expect(mockAddAccount).toHaveBeenCalledWith('d1', { accountId: '64b0000000000000000000aa', sessionId: 's1', operatedByUserId: 'op1' });
  });

  it('does not forward operatedByUserId for an ordinary first-party session', async () => {
    mockGetSession.mockResolvedValueOnce({ operatedByUserId: null });
    mockAddAccount.mockResolvedValueOnce({ state: STATE, changed: true });
    await requestJson(server, 'POST', '/session/device/add', {});
    expect(mockAddAccount).toHaveBeenCalledWith('d1', { accountId: '64b0000000000000000000aa', sessionId: 's1' });
  });

  it('401s and never adds the account when the session is expired/revoked (getSession returns null)', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await requestJson(server, 'POST', '/session/device/add', {});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid session');
    expect(mockAddAccount).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });
});

describe('POST /session/device/add — cookie-device convergence', () => {
  it('migrates the session onto the cookie device when the cookie deviceId differs from the JWT claim', async () => {
    // JWT claims deviceId 'd1' (mockDecodeToken default); cookie resolves to the
    // canonical 'cookie-dev'. The session must MOVE onto the cookie device.
    mockGetStateByCookieKey.mockResolvedValueOnce({ deviceId: 'cookie-dev', accounts: [], activeAccountId: null, revision: 0, updatedAt: 1 });
    mockMigrateSessionToDevice.mockResolvedValueOnce({ accessToken: 'fresh-cookie-token', expiresAt: new Date(), migrated: true });
    const convergedState = { deviceId: 'cookie-dev', accounts: [{ accountId: '64b0000000000000000000aa', sessionId: 's1', authuser: 0 }], activeAccountId: '64b0000000000000000000aa', revision: 1, updatedAt: 2 };
    const oldState = { deviceId: 'd1', accounts: [], activeAccountId: null, revision: 9, updatedAt: 3 };
    mockConvergeAccountOntoDevice.mockResolvedValueOnce({ cookieState: convergedState, oldState, changed: true });
    // The migrated session's fresh token is served via resolveActiveToken.
    mockResolveActiveToken.mockResolvedValueOnce({ accessToken: 'fresh-cookie-token', expiresAt: '2026-07-07T00:00:00.000Z' });

    const res = await requestJson(server, 'POST', '/session/device/add', {}, { Cookie: 'oxy_device=cookiesecret' });

    expect(res.status).toBe(200);
    // Session re-minted onto the cookie device, then the account converged.
    expect(mockMigrateSessionToDevice).toHaveBeenCalledWith('s1', 'cookie-dev');
    expect(mockConvergeAccountOntoDevice).toHaveBeenCalledWith('cookie-dev', 'd1', { accountId: '64b0000000000000000000aa', sessionId: 's1' });
    // BOTH device rooms broadcast on a real migration.
    expect(mockBroadcast).toHaveBeenCalledWith(convergedState);
    expect(mockBroadcast).toHaveBeenCalledWith(oldState);
    // Plain (non-converging) addAccount NOT used.
    expect(mockAddAccount).not.toHaveBeenCalled();
    // The response carries the fresh cookie-device token for the client to plant.
    expect(res.body.data.state).toEqual(convergedState);
    expect(res.body.data.activeToken.accessToken).toBe('fresh-cookie-token');
  });

  it('does NOT converge (uses the plain add path) when the cookie resolves to the SAME device as the JWT', async () => {
    mockGetStateByCookieKey.mockResolvedValueOnce({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0, updatedAt: 1 });
    mockAddAccount.mockResolvedValueOnce({ state: STATE, changed: true });

    const res = await requestJson(server, 'POST', '/session/device/add', {}, { Cookie: 'oxy_device=cookiesecret' });

    expect(res.status).toBe(200);
    expect(mockMigrateSessionToDevice).not.toHaveBeenCalled();
    expect(mockConvergeAccountOntoDevice).not.toHaveBeenCalled();
    expect(mockAddAccount).toHaveBeenCalledWith('d1', { accountId: '64b0000000000000000000aa', sessionId: 's1' });
  });

  it('does NOT converge when no oxy_device cookie is present (plain add path)', async () => {
    mockAddAccount.mockResolvedValueOnce({ state: STATE, changed: true });

    const res = await requestJson(server, 'POST', '/session/device/add', {});

    expect(res.status).toBe(200);
    expect(mockGetStateByCookieKey).not.toHaveBeenCalled();
    expect(mockConvergeAccountOntoDevice).not.toHaveBeenCalled();
    expect(mockAddAccount).toHaveBeenCalledWith('d1', { accountId: '64b0000000000000000000aa', sessionId: 's1' });
  });
});

describe('POST /session/device/token (phase 2c — public deviceSecret mint)', () => {
  const SECRET_STATE = {
    deviceId: 'd1',
    accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }],
    activeAccountId: 'a1',
    revision: 3,
    updatedAt: 1720000000000,
  };

  it('mints a short access token and rotates the device secret on a valid secret', async () => {
    mockGetStateBySecret.mockResolvedValueOnce(SECRET_STATE);
    mockResolveActiveToken.mockResolvedValueOnce({ accessToken: 'jwt-mint', expiresAt: '2026-07-07T00:00:00.000Z' });
    mockIssueDeviceSecret.mockResolvedValueOnce('next-secret-value');

    const res = await requestJson(server, 'POST', '/session/device/token', { deviceId: 'd1', deviceSecret: 'raw-secret' });

    expect(res.status).toBe(200);
    expect(mockGetStateBySecret).toHaveBeenCalledWith('d1', 'raw-secret');
    expect(mockClearFailures).toHaveBeenCalledWith({ scope: 'device-token', identifier: 'd1' });
    expect(mockIssueDeviceSecret).toHaveBeenCalledWith('d1');
    expect(res.body.data).toEqual({
      accessToken: 'jwt-mint',
      expiresAt: '2026-07-07T00:00:00.000Z',
      nextDeviceSecret: 'next-secret-value',
      state: SECRET_STATE,
    });
    expect(mockRecordFailure).not.toHaveBeenCalled();
    // Telemetry: the mint is attributed to the secret lane.
    expect(logger.info).toHaveBeenCalledWith('device.token.mint', { mint_source: 'secret', deviceId: 'd1' });
  });

  it('401 invalid_device_secret and records a failure on an unknown/mismatched secret', async () => {
    mockGetStateBySecret.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'POST', '/session/device/token', { deviceId: 'd1', deviceSecret: 'bad' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_device_secret');
    expect(mockRecordFailure).toHaveBeenCalledWith({ scope: 'device-token', identifier: 'd1' });
    expect(mockIssueDeviceSecret).not.toHaveBeenCalled();
    expect(mockClearFailures).not.toHaveBeenCalled();
  });

  it('429 when the device is locked out — never touches the secret', async () => {
    mockIsLockedOut.mockResolvedValueOnce({ locked: true, retryAfterSeconds: 42, attempts: 5 });

    const res = await requestJson(server, 'POST', '/session/device/token', { deviceId: 'd1', deviceSecret: 'x' });

    expect(res.status).toBe(429);
    expect(mockGetStateBySecret).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it('401 no_active_session WITHOUT rotating when the secret is valid but the session is dead', async () => {
    mockGetStateBySecret.mockResolvedValueOnce(SECRET_STATE);
    mockResolveActiveToken.mockResolvedValueOnce(null);

    const res = await requestJson(server, 'POST', '/session/device/token', { deviceId: 'd1', deviceSecret: 'raw-secret' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('no_active_session');
    // Valid secret → failures cleared, but the secret is NOT rotated: the client
    // must re-auth and keeps its still-valid secret.
    expect(mockClearFailures).toHaveBeenCalledWith({ scope: 'device-token', identifier: 'd1' });
    expect(mockIssueDeviceSecret).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it('accepts an in-grace (previous) secret — the route trusts getStateBySecret and rotates', async () => {
    mockGetStateBySecret.mockResolvedValueOnce(SECRET_STATE);
    mockResolveActiveToken.mockResolvedValueOnce({ accessToken: 'jwt-grace', expiresAt: '2026-07-07T00:00:00.000Z' });
    mockIssueDeviceSecret.mockResolvedValueOnce('rotated-again');

    const res = await requestJson(server, 'POST', '/session/device/token', { deviceId: 'd1', deviceSecret: 'previous-secret' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBe('jwt-grace');
    expect(res.body.data.nextDeviceSecret).toBe('rotated-again');
  });

  it('400 when the body shape is invalid (missing deviceSecret)', async () => {
    const res = await requestJson(server, 'POST', '/session/device/token', { deviceId: 'd1' });
    expect(res.status).toBe(400);
    expect(mockGetStateBySecret).not.toHaveBeenCalled();
    expect(mockIsLockedOut).not.toHaveBeenCalled();
  });
});

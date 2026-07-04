/**
 * Device-first auth router tests (`/auth/device/*` + `/auth/refresh-token`).
 *
 * Covers:
 *  - bootstrap: 303 redirect + `oxy_device` Set-Cookie + `#oxy_boot=` fragment
 *    (reason:'session' with a code) for a trusted return_to; 400 for an
 *    untrusted / invalid return_to.
 *  - web-session: same-site happy (session bundle) + no_session shape; 403 for a
 *    non-trusted caller.
 *  - exchange: burn happy → bundle; Origin mismatch → 403; replay/expired → 410.
 *  - refresh-token: rotate happy; failure → 401.
 *  - device/token: bearer → deviceToken; missing device binding → 400.
 *  - resolve: X-Oxy-Internal gate (404 without) + device-set feed with it.
 *
 * Every service is mocked; `deviceCookie` + `origin` + contracts schemas +
 * `registrableApex` run for real.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/originGuard', () => ({
  requireSameSiteOrigin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockDecodeToken = jest.fn();
jest.mock('../../middleware/authUtils', () => ({
  extractTokenFromRequest: () => 'tok',
  decodeToken: (...a: unknown[]) => mockDecodeToken(...a),
}));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockIsTrustedOrigin = jest.fn(() => true);
jest.mock('../../config/dynamicOriginRegistry', () => ({
  isTrustedOrigin: (...a: unknown[]) => mockIsTrustedOrigin(...a),
}));

let internalOk = false;
jest.mock('../../utils/internalSecret', () => ({
  hasValidInternalSecret: () => internalOk,
}));

const mockGetStateByCookieKey = jest.fn();
const mockEnsureDeviceForCookie = jest.fn();
const mockAddAccount = jest.fn();
jest.mock('../../services/deviceSession.service', () => ({
  __esModule: true,
  default: {
    getStateByCookieKey: (...a: unknown[]) => mockGetStateByCookieKey(...a),
    ensureDeviceForCookie: (...a: unknown[]) => mockEnsureDeviceForCookie(...a),
    addAccount: (...a: unknown[]) => mockAddAccount(...a),
  },
}));

const mockValidateSessionById = jest.fn();
const mockGetAccessToken = jest.fn();
jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    validateSessionById: (...a: unknown[]) => mockValidateSessionById(...a),
    getAccessToken: (...a: unknown[]) => mockGetAccessToken(...a),
  },
}));

const mockIssueDeviceToken = jest.fn(async () => 'device-token-abcdefghijklmnopqrst');
jest.mock('../../services/deviceToken.service', () => ({
  issueDeviceToken: (...a: unknown[]) => mockIssueDeviceToken(...a),
  NATIVE_ORIGIN: 'native',
}));

const mockMintBootCode = jest.fn();
const mockRedeemBootCode = jest.fn();
jest.mock('../../services/deviceBootCode.service', () => ({
  mintBootCode: (...a: unknown[]) => mockMintBootCode(...a),
  redeemBootCode: (...a: unknown[]) => mockRedeemBootCode(...a),
}));

const mockIssueRefreshToken = jest.fn(async () => ({
  token: 'refresh-token-abcdefghijklmnopqrst',
  family: 'fam',
  expiresAt: new Date(Date.now() + 60_000),
}));
const mockRotateRefreshToken = jest.fn();
jest.mock('../../services/refreshToken.service', () => ({
  issueRefreshToken: (...a: unknown[]) => mockIssueRefreshToken(...a),
  rotateRefreshToken: (...a: unknown[]) => mockRotateRefreshToken(...a),
}));

jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: (u: { _id?: string; id?: string; username?: string } | null) =>
    u ? { id: u._id ?? u.id ?? 'uid', username: u.username ?? 'bob', name: {} } : null,
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import deviceAuthRouter from '../deviceAuth';
import { errorHandler } from '../../middleware/errorHandler';

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

let server: http.Server;

async function request(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Res> {
  const address = server.address() as AddressInfo;
  const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string | number> = { ...(opts.headers ?? {}) };
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method, host: '127.0.0.1', port: address.port, path, headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = raw.length > 0 ? JSON.parse(raw) : {};
          } catch {
            parsed = { _raw: raw };
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function decodeFragment(location: string): Record<string, unknown> {
  const marker = '#oxy_boot=';
  const idx = location.indexOf(marker);
  const b64 = location.slice(idx + marker.length);
  return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
}

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/auth', deviceAuthRouter);
  app.use(errorHandler);
  server = app.listen(0, done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so queued `mockResolvedValueOnce`
  // implementations never leak between tests; re-establish the always-on
  // defaults afterwards.
  jest.resetAllMocks();
  internalOk = false;
  mockIsTrustedOrigin.mockReturnValue(true);
  mockIssueDeviceToken.mockResolvedValue('device-token-abcdefghijklmnopqrst');
  mockIssueRefreshToken.mockResolvedValue({
    token: 'refresh-token-abcdefghijklmnopqrst',
    family: 'fam',
    expiresAt: new Date(Date.now() + 60_000),
  });
});

describe('GET /auth/device/bootstrap', () => {
  it('303s with an oxy_device cookie and a session fragment (code) for a known device + active session', async () => {
    mockGetStateByCookieKey.mockResolvedValueOnce({
      deviceId: 'd1',
      activeAccountId: 'u1',
      accounts: [{ accountId: 'u1', sessionId: 's1' }],
    });
    mockValidateSessionById.mockResolvedValueOnce({ session: {} });
    mockMintBootCode.mockResolvedValueOnce({ code: 'boot-code-abcdefghijklmnopqrst', expiresInSeconds: 60 });

    const res = await request(
      'GET',
      '/auth/device/bootstrap?return_to=' + encodeURIComponent('https://accounts.oxy.so/app') + '&state=st123',
      { headers: { cookie: 'oxy_device=cookiesecret' } },
    );

    expect(res.status).toBe(303);
    const setCookie = (res.headers['set-cookie'] ?? []).join(';');
    expect(setCookie).toMatch(/oxy_device=/);
    const location = res.headers.location as string;
    expect(location.startsWith('https://accounts.oxy.so/app#oxy_boot=')).toBe(true);
    const frag = decodeFragment(location);
    expect(frag).toMatchObject({ v: 1, state: 'st123', reason: 'session' });
    expect(typeof frag.code).toBe('string');
    expect(typeof frag.deviceToken).toBe('string');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('mints a new device and returns reason:new_device (no code) when no cookie is present', async () => {
    mockEnsureDeviceForCookie.mockResolvedValueOnce({ deviceId: 'd2', rawCookieKey: 'freshsecretvalue' });

    const res = await request(
      'GET',
      '/auth/device/bootstrap?return_to=' + encodeURIComponent('https://accounts.oxy.so/app') + '&state=st123',
    );

    expect(res.status).toBe(303);
    const frag = decodeFragment(res.headers.location as string);
    expect(frag.reason).toBe('new_device');
    expect(frag.code).toBeUndefined();
    expect(mockMintBootCode).not.toHaveBeenCalled();
  });

  it('400s for an untrusted return_to origin', async () => {
    mockIsTrustedOrigin.mockReturnValue(false);
    const res = await request(
      'GET',
      '/auth/device/bootstrap?return_to=' + encodeURIComponent('https://evil.example/app') + '&state=st123',
    );
    expect(res.status).toBe(400);
  });

  it('400s for a non-loopback http return_to', async () => {
    const res = await request(
      'GET',
      '/auth/device/bootstrap?return_to=' + encodeURIComponent('http://accounts.oxy.so/app') + '&state=st123',
    );
    expect(res.status).toBe(400);
  });

  it('400s when state is missing', async () => {
    const res = await request(
      'GET',
      '/auth/device/bootstrap?return_to=' + encodeURIComponent('https://accounts.oxy.so/app'),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/device/web-session', () => {
  const sameSite = { host: 'api.oxy.so', origin: 'https://accounts.oxy.so' };

  it('returns a token bundle for a same-site caller with an active session', async () => {
    mockGetStateByCookieKey.mockResolvedValueOnce({
      deviceId: 'd1',
      activeAccountId: 'u1',
      accounts: [{ accountId: 'u1', sessionId: 's1' }],
    });
    // resolveActiveSessionRef validate + buildTokenBundle (getAccessToken +
    // validateSessionById(true) for the user).
    mockValidateSessionById.mockResolvedValueOnce({ session: {} }); // resolveActiveSessionRef
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'acc', expiresAt: new Date(Date.now() + 60_000) });
    mockValidateSessionById.mockResolvedValueOnce({ session: {}, user: { _id: 'u1', username: 'bob' } });

    const res = await request('POST', '/auth/device/web-session', {
      body: {},
      headers: { ...sameSite, cookie: 'oxy_device=known' },
    });

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data.reason).toBe('session');
    expect(data.deviceToken).toBeDefined();
    const session = data.session as Record<string, unknown>;
    expect(session).toMatchObject({ sessionId: 's1', accessToken: 'acc' });
    expect(typeof session.refreshToken).toBe('string');
  });

  it('returns reason:no_session when the device has no active session', async () => {
    mockGetStateByCookieKey.mockResolvedValueOnce({ deviceId: 'd1', activeAccountId: null, accounts: [] });

    const res = await request('POST', '/auth/device/web-session', {
      body: {},
      headers: { ...sameSite, cookie: 'oxy_device=known' },
    });

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data.reason).toBe('no_session');
    expect(data.deviceToken).toBeDefined();
    expect(data.session).toBeUndefined();
  });

  it('403s a non-trusted origin', async () => {
    mockIsTrustedOrigin.mockReturnValue(false);
    const res = await request('POST', '/auth/device/web-session', {
      body: {},
      headers: { host: 'api.oxy.so', origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('allows a single-label host only on EXACT host equality (no registrable apex)', async () => {
    mockGetStateByCookieKey.mockResolvedValueOnce({ deviceId: 'd1', activeAccountId: null, accounts: [] });
    const res = await request('POST', '/auth/device/web-session', {
      body: {},
      headers: { host: 'internal-host', origin: 'https://internal-host', cookie: 'oxy_device=known' },
    });
    expect(res.status).toBe(200);
  });

  it('403s when single-label hosts differ (exact-equality fallback)', async () => {
    const res = await request('POST', '/auth/device/web-session', {
      body: {},
      headers: { host: 'host-a', origin: 'https://host-b' },
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /auth/device/exchange', () => {
  it('burns the code and returns a token bundle when the Origin matches', async () => {
    mockRedeemBootCode.mockResolvedValueOnce({ sessionId: 's1', userId: 'u1', clientOrigin: 'https://mention.earth' });
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'acc', expiresAt: new Date(Date.now() + 60_000) });
    mockValidateSessionById.mockResolvedValueOnce({ session: {}, user: { _id: 'u1', username: 'bob' } });

    const res = await request('POST', '/auth/device/exchange', {
      body: { code: 'boot-code-abcdefghijklmnopqrst' },
      headers: { origin: 'https://mention.earth' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId: 's1', accessToken: 'acc' });
    expect(typeof res.body.refreshToken).toBe('string');
  });

  it('403s on an Origin mismatch', async () => {
    mockRedeemBootCode.mockResolvedValueOnce({ sessionId: 's1', userId: 'u1', clientOrigin: 'https://mention.earth' });
    const res = await request('POST', '/auth/device/exchange', {
      body: { code: 'boot-code-abcdefghijklmnopqrst' },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('410s a replayed/expired code', async () => {
    mockRedeemBootCode.mockResolvedValueOnce(null);
    const res = await request('POST', '/auth/device/exchange', {
      body: { code: 'boot-code-abcdefghijklmnopqrst' },
      headers: { origin: 'https://mention.earth' },
    });
    expect(res.status).toBe(410);
  });
});

describe('POST /auth/refresh-token', () => {
  it('rotates the family and returns fresh tokens', async () => {
    mockRotateRefreshToken.mockResolvedValueOnce({ ok: true, token: 'next-refresh-abcdefghijklmnop', sessionId: 's1' });
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'acc', expiresAt: new Date(Date.now() + 60_000) });

    const res = await request('POST', '/auth/refresh-token', {
      body: { refreshToken: 'current-refresh-abcdefghijklmnop' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      accessToken: 'acc',
      refreshToken: 'next-refresh-abcdefghijklmnop',
      sessionId: 's1',
    });
  });

  it('401s uniformly on a rotation failure (reuse/expired/not_found)', async () => {
    mockRotateRefreshToken.mockResolvedValueOnce({ ok: false, reason: 'reuse_detected' });
    const res = await request('POST', '/auth/refresh-token', {
      body: { refreshToken: 'stale-refresh-abcdefghijklmnop' },
    });
    expect(res.status).toBe(401);
  });

  it('401s on a malformed body (no token leakage of the reason)', async () => {
    const res = await request('POST', '/auth/refresh-token', { body: { refreshToken: 'short' } });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/device/token', () => {
  it('issues a native device token from the bearer deviceId claim', async () => {
    mockDecodeToken.mockReturnValueOnce({ deviceId: 'd1', sessionId: 's1' });
    const res = await request('POST', '/auth/device/token', {
      body: {},
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    expect(res.body.deviceToken).toBeDefined();
    expect(mockIssueDeviceToken).toHaveBeenCalledWith({ deviceId: 'd1', origin: 'native', channel: 'native' });
  });

  it('400s when the bearer has no device binding', async () => {
    mockDecodeToken.mockReturnValueOnce({ sessionId: 's1' });
    const res = await request('POST', '/auth/device/token', {
      body: {},
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/device/resolve', () => {
  it('404s without a valid X-Oxy-Internal secret', async () => {
    internalOk = false;
    const res = await request('POST', '/auth/device/resolve', { body: { deviceKey: 'somedevicesecretvalue' } });
    expect(res.status).toBe(404);
  });

  it('returns the empty feed for an unknown device', async () => {
    internalOk = true;
    mockGetStateByCookieKey.mockResolvedValueOnce(null);
    const res = await request('POST', '/auth/device/resolve', {
      body: { deviceKey: 'somedevicesecretvalue' },
      headers: { 'x-oxy-internal': 'secret' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activeAccountId: null, accounts: [] });
  });

  it('returns the device account feed with minted access tokens', async () => {
    internalOk = true;
    mockGetStateByCookieKey.mockResolvedValueOnce({
      deviceId: 'd1',
      activeAccountId: 'u1',
      accounts: [{ accountId: 'u1', sessionId: 's1' }],
    });
    mockValidateSessionById.mockResolvedValueOnce({ session: {}, user: { _id: 'u1', username: 'bob' } });
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'acc', expiresAt: new Date(Date.now() + 60_000) });

    const res = await request('POST', '/auth/device/resolve', {
      body: { deviceKey: 'somedevicesecretvalue' },
      headers: { 'x-oxy-internal': 'secret' },
    });

    expect(res.status).toBe(200);
    expect(res.body.activeAccountId).toBe('u1');
    const accounts = res.body.accounts as Array<Record<string, unknown>>;
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ sessionId: 's1', accessToken: 'acc' });
    expect((accounts[0].user as Record<string, unknown>).id).toBe('u1');
  });

  it('SKIPS a corrupt/dead account (does not 500 the whole feed)', async () => {
    internalOk = true;
    mockGetStateByCookieKey.mockResolvedValueOnce({
      deviceId: 'd1',
      activeAccountId: 'u2',
      accounts: [
        { accountId: 'u1', sessionId: 's-bad' },
        { accountId: 'u2', sessionId: 's-good' },
      ],
    });
    // First account throws mid-resolve; second resolves cleanly.
    mockValidateSessionById.mockRejectedValueOnce(new Error('corrupt session'));
    mockValidateSessionById.mockResolvedValueOnce({ session: {}, user: { _id: 'u2', username: 'good' } });
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'acc2', expiresAt: new Date(Date.now() + 60_000) });

    const res = await request('POST', '/auth/device/resolve', {
      body: { deviceKey: 'somedevicesecretvalue' },
      headers: { 'x-oxy-internal': 'secret' },
    });

    expect(res.status).toBe(200);
    const accounts = res.body.accounts as Array<Record<string, unknown>>;
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ sessionId: 's-good', accessToken: 'acc2' });
    expect(res.body.activeAccountId).toBe('u2');
  });
});

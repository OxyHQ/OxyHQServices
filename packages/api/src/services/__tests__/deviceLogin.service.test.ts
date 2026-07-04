/**
 * deviceLogin.service unit tests — the shared device-first login attribution.
 *
 * Covers:
 *  - resolveLoginDeviceId precedence: oxy_device cookie > deviceToken > none.
 *  - finalizeDeviceLogin is ADD-ONLY: registers with `activate: 'if-empty'`
 *    (never steals the active account) and broadcasts only when the set changed.
 *  - refresh-token lane: attached when a device binding resolved OR the Origin is
 *    trusted-lane / absent; withheld for a third-party-lane browser Origin.
 */

import type { Request } from 'express';

const mockGetStateByCookieKey = jest.fn();
const mockAddAccount = jest.fn();
const mockEnsureDeviceForCookie = jest.fn();
jest.mock('../deviceSession.service', () => {
  const svc = {
    getStateByCookieKey: (...a: unknown[]) => mockGetStateByCookieKey(...a),
    addAccount: (...a: unknown[]) => mockAddAccount(...a),
    ensureDeviceForCookie: (...a: unknown[]) => mockEnsureDeviceForCookie(...a),
  };
  // deviceLogin.service dynamically imports the NAMED `deviceSessionService`.
  return { __esModule: true, default: svc, deviceSessionService: svc };
});

const mockIsSameSiteTrustedRequest = jest.fn(() => false);
jest.mock('../../utils/sameSite', () => ({
  isSameSiteTrustedRequest: (...a: unknown[]) => mockIsSameSiteTrustedRequest(...a),
}));

const mockResolveDeviceToken = jest.fn();
jest.mock('../deviceToken.service', () => ({
  resolveDeviceToken: (...a: unknown[]) => mockResolveDeviceToken(...a),
}));

const mockIssueRefreshToken = jest.fn(async () => ({ token: 'rt', family: 'f', expiresAt: new Date() }));
jest.mock('../refreshToken.service', () => ({
  issueRefreshToken: (...a: unknown[]) => mockIssueRefreshToken(...a),
}));

const mockBroadcast = jest.fn();
jest.mock('../../utils/socket', () => ({
  broadcastDeviceState: (...a: unknown[]) => mockBroadcast(...a),
}));

const mockIsTrustedOrigin = jest.fn(() => false);
jest.mock('../../config/dynamicOriginRegistry', () => ({
  isTrustedOrigin: (...a: unknown[]) => mockIsTrustedOrigin(...a),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { resolveLoginDeviceId, resolveLoginDevice, finalizeDeviceLogin } from '../deviceLogin.service';

function req(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockIssueRefreshToken.mockResolvedValue({ token: 'rt', family: 'f', expiresAt: new Date() });
  mockIsTrustedOrigin.mockReturnValue(false);
  mockIsSameSiteTrustedRequest.mockReturnValue(false);
});

describe('resolveLoginDevice — same-site cookie mint', () => {
  it('returns the existing binding without minting when a cookie resolves', async () => {
    mockGetStateByCookieKey.mockResolvedValueOnce({ deviceId: 'existing-dev' });
    const result = await resolveLoginDevice(req({ cookie: 'oxy_device=secret' }), undefined);
    expect(result).toEqual({ deviceId: 'existing-dev' });
    expect(mockEnsureDeviceForCookie).not.toHaveBeenCalled();
  });

  it('mints a device cookie for a same-site trusted login with no existing binding', async () => {
    mockIsSameSiteTrustedRequest.mockReturnValue(true);
    mockEnsureDeviceForCookie.mockResolvedValueOnce({ deviceId: 'new-dev', rawCookieKey: 'minted-secret' });
    const result = await resolveLoginDevice(req({ origin: 'https://accounts.oxy.so' }), undefined);
    expect(result).toEqual({ deviceId: 'new-dev', setCookieSecret: 'minted-secret' });
    expect(mockEnsureDeviceForCookie).toHaveBeenCalledTimes(1);
  });

  it('does NOT mint for a non-same-site (cross-site / untrusted) login', async () => {
    mockIsSameSiteTrustedRequest.mockReturnValue(false);
    const result = await resolveLoginDevice(req({ origin: 'https://third-party.example' }), undefined);
    expect(result).toEqual({ deviceId: null });
    expect(mockEnsureDeviceForCookie).not.toHaveBeenCalled();
  });
});

describe('resolveLoginDeviceId', () => {
  it('returns null and consults nothing when neither cookie nor deviceToken is present', async () => {
    const result = await resolveLoginDeviceId(req(), undefined);
    expect(result).toBeNull();
    expect(mockGetStateByCookieKey).not.toHaveBeenCalled();
    expect(mockResolveDeviceToken).not.toHaveBeenCalled();
  });

  it('resolves via the oxy_device cookie (winning over a deviceToken)', async () => {
    mockGetStateByCookieKey.mockResolvedValueOnce({ deviceId: 'cookie-device' });
    const result = await resolveLoginDeviceId(req({ cookie: 'oxy_device=secret' }), 'a-device-token');
    expect(result).toBe('cookie-device');
    // Cookie wins — the deviceToken is never consulted.
    expect(mockResolveDeviceToken).not.toHaveBeenCalled();
  });

  it('falls back to the deviceToken when no cookie maps to a device', async () => {
    mockResolveDeviceToken.mockResolvedValueOnce({ deviceId: 'token-device' });
    const result = await resolveLoginDeviceId(req(), 'a-device-token');
    expect(result).toBe('token-device');
    expect(mockResolveDeviceToken).toHaveBeenCalled();
  });

  it('returns null when the deviceToken does not resolve', async () => {
    mockResolveDeviceToken.mockResolvedValueOnce(null);
    expect(await resolveLoginDeviceId(req(), 'bad-token')).toBeNull();
  });
});

describe('finalizeDeviceLogin — device registration (add-only)', () => {
  it('registers with activate:if-empty and broadcasts when the set changed', async () => {
    mockAddAccount.mockResolvedValueOnce({ state: { deviceId: 'd1' }, changed: true });

    const extras = await finalizeDeviceLogin({
      req: req(),
      deviceId: 'd1',
      session: { sessionId: 's1', deviceId: 'd1' },
      userId: 'u1',
    });

    expect(mockAddAccount).toHaveBeenCalledWith(
      'd1',
      { accountId: 'u1', sessionId: 's1' },
      { activate: 'if-empty' },
    );
    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    // Device binding present → refresh token attached.
    expect(extras.refreshToken).toBe('rt');
  });

  it('does NOT broadcast when the registration was an idempotent no-op', async () => {
    mockAddAccount.mockResolvedValueOnce({ state: { deviceId: 'd1' }, changed: false });
    await finalizeDeviceLogin({
      req: req(),
      deviceId: 'd1',
      session: { sessionId: 's1', deviceId: 'd1' },
      userId: 'u1',
    });
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('threads operatedByUserId into the registration', async () => {
    mockAddAccount.mockResolvedValueOnce({ state: {}, changed: false });
    await finalizeDeviceLogin({
      req: req(),
      deviceId: 'd1',
      session: { sessionId: 's-org', deviceId: 'd1' },
      userId: 'org1',
      operatedByUserId: 'op1',
    });
    expect(mockAddAccount).toHaveBeenCalledWith(
      'd1',
      { accountId: 'org1', sessionId: 's-org', operatedByUserId: 'op1' },
      { activate: 'if-empty' },
    );
  });
});

describe('finalizeDeviceLogin — refresh-token lane', () => {
  it('attaches a refresh token when the Origin is absent (native/first-party)', async () => {
    const extras = await finalizeDeviceLogin({
      req: req(),
      deviceId: null,
      session: { sessionId: 's1', deviceId: 'd1' },
      userId: 'u1',
    });
    expect(mockAddAccount).not.toHaveBeenCalled();
    expect(extras.refreshToken).toBe('rt');
  });

  it('attaches a refresh token for a trusted-lane Origin', async () => {
    mockIsTrustedOrigin.mockReturnValue(true);
    const extras = await finalizeDeviceLogin({
      req: req({ origin: 'https://accounts.oxy.so' }),
      deviceId: null,
      session: { sessionId: 's1', deviceId: 'd1' },
      userId: 'u1',
    });
    expect(extras.refreshToken).toBe('rt');
  });

  it('withholds the refresh token for a third-party-lane browser Origin', async () => {
    mockIsTrustedOrigin.mockReturnValue(false);
    const extras = await finalizeDeviceLogin({
      req: req({ origin: 'https://third-party.example' }),
      deviceId: null,
      session: { sessionId: 's1', deviceId: 'd1' },
      userId: 'u1',
    });
    expect(extras.refreshToken).toBeUndefined();
    expect(mockIssueRefreshToken).not.toHaveBeenCalled();
  });
});

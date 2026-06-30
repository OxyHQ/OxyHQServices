/**
 * `establishDeviceRefreshSlot` + primary-session slot-registration tests.
 *
 * ROOT CAUSE these lock in: a web PRIMARY session (FedCM exchange, central `/sso`
 * return, IdP `/auth/silent` iframe, password) plants only an access token. The
 * cross-origin/credential-less restore endpoints (`/sso/exchange`, `/auth/silent`)
 * cannot set the device's `oxy_rt_<authuser>` cookie, so without an explicit
 * `POST /auth/session` the primary never joins the device refresh-cookie set:
 * `/auth/refresh-all` returns zero accounts and account-switch persistence has no
 * foundation. `establishDeviceRefreshSlot()` is the single shared primitive (on the
 * base, reused by `switchToAccount` and `AuthManager.handleAuthSuccess`) that plants
 * the slot where the cookie is visible, re-plants the rotated token, and returns the
 * authoritative `authuser`.
 *
 * `testEnvironment` is `node`, where `getPlatformOS()` resolves to `'web'`
 * (`isWeb()` is true) and `window` is undefined — so the FIRST-PARTY apex gate is
 * inert and the method exercises its happy path. Browser-only apex gating is
 * verified separately by stubbing a `window`.
 */

import { OxyServices } from '../OxyServices';
import { AuthManager } from '../AuthManager';
import type { StorageAdapter } from '../AuthManager';
import type { RefreshAllResponse, RefreshCookieResponse, User } from '../models/interfaces';
import type { SessionLoginResponse } from '../models/session';

function buildAccessToken(claims: Record<string, unknown>): string {
  const b64url = (value: string): string =>
    Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.signature`;
}

describe('OxyServices.establishDeviceRefreshSlot', () => {
  let oxy: OxyServices;
  let makeRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    oxy.httpService.setTokens('primary-token');
    makeRequestSpy = jest.spyOn(oxy, 'makeRequest');
  });

  afterEach(() => {
    makeRequestSpy.mockRestore();
  });

  it('POSTs to /auth/session, re-plants the rotated access token, and returns the server authuser', async () => {
    makeRequestSpy.mockResolvedValue({ accessToken: 'rotated-token', authuser: 2 });

    const authuser = await oxy.establishDeviceRefreshSlot();

    expect(authuser).toBe(2);
    expect(makeRequestSpy).toHaveBeenCalledWith('POST', '/auth/session', undefined, { cache: false });
    // The rotated token from /auth/session is now the active token.
    expect(oxy.getAccessToken()).toBe('rotated-token');
  });

  it('returns the authuser even when the response carries no rotated token (keeps the existing token)', async () => {
    makeRequestSpy.mockResolvedValue({ authuser: 0 });

    const authuser = await oxy.establishDeviceRefreshSlot();

    expect(authuser).toBe(0);
    expect(oxy.getAccessToken()).toBe('primary-token');
  });

  it('returns null when the server omits a numeric authuser', async () => {
    makeRequestSpy.mockResolvedValue({ accessToken: 'rotated-token' });

    const authuser = await oxy.establishDeviceRefreshSlot();

    expect(authuser).toBeNull();
  });

  it('is best-effort: a failed /auth/session resolves null and never throws', async () => {
    makeRequestSpy.mockRejectedValue(new Error('network down'));

    await expect(oxy.establishDeviceRefreshSlot()).resolves.toBeNull();
  });

  it('FIRST-PARTY gate: skips /auth/session when the page apex differs from the API apex (cross-apex RP)', async () => {
    // Simulate a cross-apex RP page (mention.earth) calling api.oxy.so.
    const rp = new OxyServices({ baseURL: 'https://api.oxy.so' });
    rp.httpService.setTokens('primary-token');
    const rpSpy = jest.spyOn(rp, 'makeRequest');
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { location: { hostname: 'mention.earth' } };
    try {
      const authuser = await rp.establishDeviceRefreshSlot();
      expect(authuser).toBeNull();
      expect(rpSpy).not.toHaveBeenCalled();
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
      rpSpy.mockRestore();
    }
  });

  it('FIRST-PARTY gate: proceeds when the page apex matches the API apex (first-party *.oxy.so)', async () => {
    const fp = new OxyServices({ baseURL: 'https://api.oxy.so' });
    fp.httpService.setTokens('primary-token');
    const fpSpy = jest.spyOn(fp, 'makeRequest').mockResolvedValue({ accessToken: 'rotated', authuser: 1 });
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { location: { hostname: 'accounts.oxy.so' } };
    try {
      const authuser = await fp.establishDeviceRefreshSlot();
      expect(authuser).toBe(1);
      expect(fpSpy).toHaveBeenCalledWith('POST', '/auth/session', undefined, { cache: false });
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
      fpSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// AuthManager.handleAuthSuccess — every web primary now joins the device set
// ---------------------------------------------------------------------------

class InMemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  raw(): Map<string, string> { return this.store; }
}

interface MockHttpService {
  setTokens: jest.Mock;
  setAuthRefreshHandler: jest.Mock;
}

interface MockServices {
  establishDeviceRefreshSlot: jest.Mock<Promise<number | null>, []>;
  getAccessToken: jest.Mock<string | null, []>;
  refreshAllSessions: jest.Mock<Promise<RefreshAllResponse>, []>;
  refreshTokenViaCookie: jest.Mock<Promise<RefreshCookieResponse | null>, [{ authuser?: number }]>;
  logoutSessionByAuthuser: jest.Mock<Promise<void>, [number]>;
  logoutAllSessionsViaCookie: jest.Mock<Promise<void>, []>;
  getCurrentUser: jest.Mock<Promise<User>, []>;
  httpService: MockHttpService;
}

const ACTIVE_AUTHUSER_KEY = 'oxy_active_authuser';

function makeMockServices(): MockServices {
  return {
    establishDeviceRefreshSlot: jest.fn(async () => null),
    getAccessToken: jest.fn(() => null),
    refreshAllSessions: jest.fn(async (): Promise<RefreshAllResponse> => ({ accounts: [] })),
    refreshTokenViaCookie: jest.fn(),
    logoutSessionByAuthuser: jest.fn(async () => undefined),
    logoutAllSessionsViaCookie: jest.fn(async () => undefined),
    getCurrentUser: jest.fn(async (): Promise<User> => ({ id: 'user-fedcm', publicKey: '0xabc', username: 'nate' } as User)),
    httpService: { setTokens: jest.fn(), setAuthRefreshHandler: jest.fn() },
  };
}

function makeManager(services: MockServices, storage: InMemoryStorage): AuthManager {
  return new AuthManager(services as unknown as OxyServices, {
    storage,
    autoRefresh: false,
    crossTabSync: false,
  });
}

function fedcmSession(): SessionLoginResponse {
  // No `authuser` claim in the FedCM-restored token — mirrors a cross-domain
  // restore whose token is not slot-bound until /auth/session runs.
  return {
    accessToken: buildAccessToken({ sessionId: 'sess-fedcm', userId: 'user-fedcm', exp: 9999999999 }),
    sessionId: 'sess-fedcm',
    deviceId: 'dev-1',
    expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: 'user-fedcm', username: 'nate', name: { displayName: 'Nate' } },
  } as SessionLoginResponse;
}

describe('AuthManager.handleAuthSuccess — primary session joins the device set', () => {
  it('establishes the device refresh slot and adopts the server-authoritative authuser', async () => {
    const services = makeMockServices();
    // /auth/session allocated slot 3 and rotated the token.
    services.establishDeviceRefreshSlot.mockResolvedValueOnce(3);
    const rotated = buildAccessToken({ sessionId: 'sess-fedcm', userId: 'user-fedcm', authuser: 3, exp: 9999999999 });
    services.getAccessToken.mockReturnValue(rotated);
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    await manager.handleAuthSuccess(fedcmSession(), 'fedcm');

    expect(services.establishDeviceRefreshSlot).toHaveBeenCalledTimes(1);
    // The authoritative slot from /auth/session is recorded as the active account.
    expect(manager.getActiveAuthuser()).toBe(3);
    expect(storage.raw().get(ACTIVE_AUTHUSER_KEY)).toBe('3');
    expect(manager.getActiveAccount()?.authuser).toBe(3);
  });

  it('falls back to the JWT-decoded authuser (then 0) when /auth/session is a no-op (native / cross-apex)', async () => {
    const services = makeMockServices();
    services.establishDeviceRefreshSlot.mockResolvedValueOnce(null);
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    // FedCM session token carries no authuser claim → falls back to slot 0.
    await manager.handleAuthSuccess(fedcmSession(), 'fedcm');

    expect(manager.getActiveAuthuser()).toBe(0);
    // getAccessToken() is only consulted for the rotated token when a slot was
    // actually established — a null slot must not re-read it.
    expect(services.getAccessToken).not.toHaveBeenCalled();
  });
});

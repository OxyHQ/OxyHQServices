/**
 * AuthManager multi-account cookie-path regression tests.
 *
 * Locks in the four new methods that route through the httpOnly
 * `oxy_rt_${authuser}` refresh cookies instead of the legacy bearer
 * `/session/token/:id` endpoint:
 *
 *   - `restoreFromCookies()` — cold-boot restore of every device-local slot
 *     via `POST /auth/refresh-all`. Picks active slot by persisted
 *     `oxy_active_authuser`, falling back to lowest authuser.
 *   - `switchAuthuser(n)` — mint a fresh access token for slot `n` via
 *     `POST /auth/refresh?authuser=N`, plant it, persist active.
 *   - `signOutAuthuser(n)` — `POST /auth/logout?authuser=N`, drop slot
 *     locally, promote lowest remaining as active (or clear).
 *   - `signOutAllViaCookies()` — `POST /auth/logout`, clear every slot,
 *     clear persisted active.
 *
 * Storage rule: the cookie path NEVER reads or writes
 * `oxy_access_token` / `oxy_refresh_token` / `oxy_session`. Only the
 * integer slot index lives in `oxy_active_authuser` (not a secret).
 */

import { AuthManager } from '../AuthManager';
import type { StorageAdapter } from '../AuthManager';
import type { OxyServices } from '../OxyServices';
import type { RefreshAllResponse } from '../models/interfaces';

const ACTIVE_AUTHUSER_KEY = 'oxy_active_authuser';

function buildAccessToken(claims: Record<string, unknown>): string {
  const b64url = (value: string): string =>
    Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.signature`;
}

class InMemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  has(key: string): boolean { return this.store.has(key); }
  raw(): Map<string, string> { return this.store; }
}

interface MockServices {
  refreshAllSessions: jest.Mock<Promise<RefreshAllResponse>, []>;
  refreshTokenViaCookie: jest.Mock;
  logoutSessionByAuthuser: jest.Mock<Promise<void>, [number]>;
  logoutAllSessionsViaCookie: jest.Mock<Promise<void>, []>;
  httpService: { setTokens: jest.Mock; onTokenRefreshed: ((t: string) => void) | undefined };
}

function makeMockServices(): MockServices {
  return {
    refreshAllSessions: jest.fn(async (): Promise<RefreshAllResponse> => ({ accounts: [] })),
    refreshTokenViaCookie: jest.fn(),
    logoutSessionByAuthuser: jest.fn(async () => undefined),
    logoutAllSessionsViaCookie: jest.fn(async () => undefined),
    httpService: { setTokens: jest.fn(), onTokenRefreshed: undefined },
  };
}

function makeManager(services: MockServices, storage: InMemoryStorage): AuthManager {
  const oxyServices = services as unknown as OxyServices;
  return new AuthManager(oxyServices, {
    storage,
    autoRefresh: false,
    crossTabSync: false,
    cookieOnly: true,
  });
}

const TOKEN_SLOT_0 = buildAccessToken({ sessionId: 'sess-slot-0', userId: 'user-0', exp: 9999999999 });
const TOKEN_SLOT_1 = buildAccessToken({ sessionId: 'sess-slot-1', userId: 'user-1', exp: 9999999999 });

const TWO_ACCOUNTS: RefreshAllResponse = {
  accounts: [
    {
      authuser: 0,
      accessToken: TOKEN_SLOT_0,
      expiresAt: '2099-01-01T00:00:00.000Z',
      sessionId: 'sess-slot-0',
      user: { id: 'user-0', username: 'alice', avatar: null, color: '#1abc9c' },
    },
    {
      authuser: 1,
      accessToken: TOKEN_SLOT_1,
      expiresAt: '2099-01-01T00:00:00.000Z',
      sessionId: 'sess-slot-1',
      user: { id: 'user-1', username: 'bob', avatar: null, color: '#3498db' },
    },
  ],
};

describe('AuthManager.restoreFromCookies', () => {
  it('plants every account in the registry, picks lowest authuser when nothing is persisted, and persists the chosen slot', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    const result = await manager.restoreFromCookies();

    expect(result.accounts).toHaveLength(2);
    expect(result.activeAuthuser).toBe(0);
    expect(manager.getActiveAuthuser()).toBe(0);

    // Active slot's access token is planted on the HTTP client.
    expect(services.httpService.setTokens).toHaveBeenCalledWith(TOKEN_SLOT_0);

    // Persisted active authuser — the ONLY storage write of the cookie path.
    expect(storage.has(ACTIVE_AUTHUSER_KEY)).toBe(true);
    expect(storage.raw().get(ACTIVE_AUTHUSER_KEY)).toBe('0');

    // Sibling slot is in the registry but its token is NOT on the HTTP
    // client (that would clobber the active slot). Stays in-memory for a
    // future switchAuthuser hot-swap.
    const sibling = manager.getAccounts().find((a) => a.authuser === 1);
    expect(sibling?.accessToken).toBe(TOKEN_SLOT_1);

    // Legacy token storage MUST stay empty in the cookie path.
    expect(storage.has('oxy_access_token')).toBe(false);
    expect(storage.has('oxy_refresh_token')).toBe(false);
    expect(storage.has('oxy_session')).toBe(false);
  });

  it('honours persisted oxy_active_authuser when it matches a returned account', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);
    const storage = new InMemoryStorage();
    storage.setItem(ACTIVE_AUTHUSER_KEY, '1');
    const manager = makeManager(services, storage);

    const result = await manager.restoreFromCookies();

    expect(result.activeAuthuser).toBe(1);
    // Slot 1's token planted, not slot 0's.
    expect(services.httpService.setTokens).toHaveBeenCalledWith(TOKEN_SLOT_1);
  });

  it('falls back to lowest authuser when persisted slot is no longer returned', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);
    const storage = new InMemoryStorage();
    storage.setItem(ACTIVE_AUTHUSER_KEY, '7'); // stale: server doesn't return slot 7
    const manager = makeManager(services, storage);

    const result = await manager.restoreFromCookies();

    expect(result.activeAuthuser).toBe(0);
    // And the persisted value is corrected to the new active.
    expect(storage.raw().get(ACTIVE_AUTHUSER_KEY)).toBe('0');
  });

  it('returns an empty result without throwing on snapshot failure', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    const result = await manager.restoreFromCookies();

    expect(result.accounts).toEqual([]);
    expect(result.activeAuthuser).toBeNull();
    expect(services.httpService.setTokens).not.toHaveBeenCalled();
  });

  it('returns an empty result when no signed-in accounts on this device', async () => {
    const services = makeMockServices();
    // Default mock already returns `{ accounts: [] }`.
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    const result = await manager.restoreFromCookies();

    expect(result.accounts).toEqual([]);
    expect(result.activeAuthuser).toBeNull();
    expect(manager.getActiveAccount()).toBeNull();
    expect(services.httpService.setTokens).not.toHaveBeenCalled();
  });
});

describe('AuthManager.switchAuthuser', () => {
  it('rotates a slot via refreshTokenViaCookie, plants its token, and persists the new active', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);
    services.refreshTokenViaCookie.mockResolvedValueOnce({
      accessToken: 'rotated-slot-1-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      authuser: 1,
    });
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    await manager.restoreFromCookies();
    expect(manager.getActiveAuthuser()).toBe(0);

    const switched = await manager.switchAuthuser(1);

    expect(services.refreshTokenViaCookie).toHaveBeenCalledWith({ authuser: 1 });
    expect(switched.authuser).toBe(1);
    expect(switched.accessToken).toBe('rotated-slot-1-token');

    expect(manager.getActiveAuthuser()).toBe(1);
    expect(services.httpService.setTokens).toHaveBeenLastCalledWith('rotated-slot-1-token');
    expect(storage.raw().get(ACTIVE_AUTHUSER_KEY)).toBe('1');

    // The registry entry for slot 1 is updated to the rotated token; slot 0
    // is untouched (its access token is still valid).
    const slot1 = manager.getAccounts().find((a) => a.authuser === 1);
    expect(slot1?.accessToken).toBe('rotated-slot-1-token');
    const slot0 = manager.getAccounts().find((a) => a.authuser === 0);
    expect(slot0?.accessToken).toBe(TOKEN_SLOT_0);
  });

  it('throws and drops the slot when the cookie is missing/expired (refresh returns null)', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);
    services.refreshTokenViaCookie.mockResolvedValueOnce(null);
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    await manager.restoreFromCookies();

    await expect(manager.switchAuthuser(1)).rejects.toThrow(/authuser=1/);

    // Slot 1 was removed from the registry; slot 0 remains and is still active.
    expect(manager.getAccounts().map((a) => a.authuser)).toEqual([0]);
    expect(manager.getActiveAuthuser()).toBe(0);
  });
});

describe('AuthManager.signOutAuthuser', () => {
  it('revokes the slot server-side, drops it from the registry, and promotes lowest remaining as active', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    await manager.restoreFromCookies();
    // Active = slot 0; sign it out.
    await manager.signOutAuthuser(0);

    expect(services.logoutSessionByAuthuser).toHaveBeenCalledWith(0);
    expect(manager.getAccounts().map((a) => a.authuser)).toEqual([1]);
    expect(manager.getActiveAuthuser()).toBe(1);
    // Slot 1's cached access token gets planted as the new active.
    expect(services.httpService.setTokens).toHaveBeenLastCalledWith(TOKEN_SLOT_1);
    expect(storage.raw().get(ACTIVE_AUTHUSER_KEY)).toBe('1');
  });

  it('clears state entirely when the last slot is signed out', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce({ accounts: [TWO_ACCOUNTS.accounts[0]] });
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    await manager.restoreFromCookies();
    await manager.signOutAuthuser(0);

    expect(manager.getAccounts()).toEqual([]);
    expect(manager.getActiveAuthuser()).toBeNull();
    expect(manager.getActiveAccount()).toBeNull();
    expect(services.httpService.setTokens).toHaveBeenLastCalledWith('');
    expect(storage.has(ACTIVE_AUTHUSER_KEY)).toBe(false);
  });

  it('signs out a non-active slot without disturbing the active one', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    await manager.restoreFromCookies();
    expect(manager.getActiveAuthuser()).toBe(0);
    services.httpService.setTokens.mockClear();

    await manager.signOutAuthuser(1);

    expect(services.logoutSessionByAuthuser).toHaveBeenCalledWith(1);
    expect(manager.getAccounts().map((a) => a.authuser)).toEqual([0]);
    expect(manager.getActiveAuthuser()).toBe(0);
    // Active slot's token must NOT be re-planted (it was never inactive).
    expect(services.httpService.setTokens).not.toHaveBeenCalled();
  });
});

describe('AuthManager.signOutAllViaCookies', () => {
  it('clears every slot, the HTTP client token, and the persisted active authuser', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    await manager.restoreFromCookies();
    await manager.signOutAllViaCookies();

    expect(services.logoutAllSessionsViaCookie).toHaveBeenCalledTimes(1);
    expect(manager.getAccounts()).toEqual([]);
    expect(manager.getActiveAuthuser()).toBeNull();
    expect(services.httpService.setTokens).toHaveBeenLastCalledWith('');
    expect(storage.has(ACTIVE_AUTHUSER_KEY)).toBe(false);
  });
});

describe('AuthManager.initialize (cookieOnly)', () => {
  it('returns the active user from restoreFromCookies and never touches localStorage tokens', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);
    const storage = new InMemoryStorage();
    const manager = makeManager(services, storage);

    const user = await manager.initialize();

    expect(user?.id).toBe('user-0');
    expect(user?.username).toBe('alice');
    expect(storage.has('oxy_access_token')).toBe(false);
    expect(storage.has('oxy_session')).toBe(false);
    expect(storage.has('oxy_user')).toBe(false);
  });

  it('returns null when no cookies AND cookieOnly mode (no legacy fallback)', async () => {
    const services = makeMockServices();
    // Default `{ accounts: [] }`.
    const storage = new InMemoryStorage();
    // Even if legacy token were present in storage, cookieOnly must skip it.
    storage.setItem('oxy_access_token', 'stale-legacy-token');
    storage.setItem('oxy_user', JSON.stringify({ id: 'legacy', username: 'legacy' }));
    const manager = makeManager(services, storage);

    const user = await manager.initialize();

    expect(user).toBeNull();
    // The legacy access token was NOT planted.
    expect(services.httpService.setTokens).not.toHaveBeenCalled();
  });
});

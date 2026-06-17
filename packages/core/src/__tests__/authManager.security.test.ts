/**
 * AuthManager hardening tests:
 *
 *   - `switchAuthuser` concurrency lock — two near-simultaneous calls share
 *     a single in-flight promise instead of double-rotating the slot's
 *     refresh-token family.
 *   - BroadcastChannel cross-tab nonce gate — forged messages from a same-
 *     origin XSS payload that doesn't know the original tab's nonce are
 *     dropped; first sighting of a new tabId is trusted (TOFU); subsequent
 *     messages from that tab must match.
 *   - Cross-tab cascade debounce — repeated `accounts_restored` broadcasts
 *     within the 2 s window only trigger ONE `/auth/refresh-all` rotation.
 *   - Legacy `/auth/refresh` fallback hydrates the user shape via
 *     `getCurrentUser()` instead of leaving the slot stuck on
 *     `{ id: '', username: '' }`.
 */

import { AuthManager } from '../AuthManager';
import type { StorageAdapter } from '../AuthManager';
import type { OxyServices } from '../OxyServices';
import type {
  RefreshAllResponse,
  RefreshCookieResponse,
  User,
} from '../models/interfaces';

class InMemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
}

function buildAccessToken(claims: Record<string, unknown>): string {
  const b64url = (value: string): string =>
    Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.signature`;
}

interface MockHttpService {
  setTokens: jest.Mock;
  setAuthRefreshHandler: jest.Mock;
}

interface MockServices {
  refreshAllSessions: jest.Mock<Promise<RefreshAllResponse>, []>;
  refreshTokenViaCookie: jest.Mock<Promise<RefreshCookieResponse | null>, [{ authuser?: number }]>;
  logoutSessionByAuthuser: jest.Mock<Promise<void>, [number]>;
  logoutAllSessionsViaCookie: jest.Mock<Promise<void>, []>;
  getCurrentUser: jest.Mock<Promise<User>, []>;
  httpService: MockHttpService;
}

function makeMockServices(): MockServices {
  return {
    refreshAllSessions: jest.fn(async (): Promise<RefreshAllResponse> => ({ accounts: [] })),
    refreshTokenViaCookie: jest.fn(),
    logoutSessionByAuthuser: jest.fn(async () => undefined),
    logoutAllSessionsViaCookie: jest.fn(async () => undefined),
    getCurrentUser: jest.fn(async (): Promise<User> => ({
      id: 'user-x',
      publicKey: '0xdeadbeef',
      username: 'hydrated',
      avatar: 'avatar-1',
      color: 'teal',
    } as User)),
    httpService: { setTokens: jest.fn(), setAuthRefreshHandler: jest.fn() },
  };
}

function makeManager(services: MockServices, options: { crossTabSync?: boolean } = {}): AuthManager {
  const storage = new InMemoryStorage();
  return new AuthManager(services as unknown as OxyServices, {
    storage,
    autoRefresh: false,
    crossTabSync: options.crossTabSync ?? false,
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

describe('AuthManager.switchAuthuser — concurrency lock', () => {
  it('coalesces two concurrent calls into a single refresh + rotation', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);

    // Return the same rotated token for any call, but make the resolution
    // explicit so the two concurrent callers genuinely overlap.
    let resolveRotation: ((value: RefreshCookieResponse) => void) | undefined;
    services.refreshTokenViaCookie.mockImplementationOnce(
      () => new Promise<RefreshCookieResponse>((resolve) => {
        resolveRotation = resolve;
      })
    );

    const manager = makeManager(services);
    await manager.restoreFromCookies();

    const p1 = manager.switchAuthuser(1);
    const p2 = manager.switchAuthuser(1);

    // Both callers MUST share the same in-flight promise object. If they
    // were two independent rotations, refreshTokenViaCookie would have
    // been invoked twice already.
    expect(services.refreshTokenViaCookie).toHaveBeenCalledTimes(1);

    if (!resolveRotation) {
      throw new Error('rotation pending callback not captured');
    }
    resolveRotation({
      accessToken: 'rotated-slot-1-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      authuser: 1,
    });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual(r2);
    expect(services.refreshTokenViaCookie).toHaveBeenCalledTimes(1);
    expect(manager.getActiveAuthuser()).toBe(1);
  });

  it('clears the in-flight slot after a failed rotation so the next call can retry', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValueOnce(TWO_ACCOUNTS);
    services.refreshTokenViaCookie
      .mockResolvedValueOnce(null) // First attempt: cookie expired.
      .mockResolvedValueOnce({
        accessToken: 'rotated-slot-1-token',
        expiresAt: '2099-01-01T00:00:00.000Z',
        authuser: 1,
      });

    const manager = makeManager(services);
    await manager.restoreFromCookies();

    await expect(manager.switchAuthuser(1)).rejects.toThrow(/authuser=1/);
    // The lock must release; a follow-up switch is permitted.
    const second = await manager.switchAuthuser(1);
    expect(second.accessToken).toBe('rotated-slot-1-token');
    expect(services.refreshTokenViaCookie).toHaveBeenCalledTimes(2);
  });
});

describe('AuthManager.switchAuthuser — hydration of unknown slots', () => {
  it('hydrates a slot with no prior user metadata via getCurrentUser()', async () => {
    const services = makeMockServices();
    // Skip restoreFromCookies — switch onto a slot the AuthManager has
    // never seen.
    services.refreshTokenViaCookie.mockResolvedValueOnce({
      accessToken: 'fresh-slot-3',
      expiresAt: '2099-01-01T00:00:00.000Z',
      authuser: 3,
    });

    const manager = makeManager(services);
    await manager.switchAuthuser(3);

    // Wait a microtask cycle so the fire-and-forget hydration completes.
    await new Promise((resolve) => setImmediate(resolve));

    expect(services.getCurrentUser).toHaveBeenCalledTimes(1);
    const slot3 = manager.getAccounts().find((a) => a.authuser === 3);
    expect(slot3?.user).not.toBeNull();
    expect(slot3?.user?.username).toBe('hydrated');
  });

  it('leaves user as null when getCurrentUser fails — UI falls back to public-key handle', async () => {
    const services = makeMockServices();
    services.refreshTokenViaCookie.mockResolvedValueOnce({
      accessToken: 'fresh-slot-3',
      expiresAt: '2099-01-01T00:00:00.000Z',
      authuser: 3,
    });
    services.getCurrentUser.mockRejectedValueOnce(new Error('network down'));

    const manager = makeManager(services);
    await manager.switchAuthuser(3);

    await new Promise((resolve) => setImmediate(resolve));

    expect(services.getCurrentUser).toHaveBeenCalledTimes(1);
    const slot3 = manager.getAccounts().find((a) => a.authuser === 3);
    // null, NOT { id: '', username: '' } — that empty-string placeholder
    // is the precise smell H6/H7 is fixing.
    expect(slot3?.user).toBeNull();
  });
});

describe('AuthManager.restoreFromCookies — debounce', () => {
  it('returns the cached registry without a network call when invoked twice within the debounce window', async () => {
    const services = makeMockServices();
    services.refreshAllSessions.mockResolvedValue(TWO_ACCOUNTS);

    const manager = makeManager(services);
    await manager.restoreFromCookies();
    expect(services.refreshAllSessions).toHaveBeenCalledTimes(1);

    // Second call inside the 2 s window — must short-circuit.
    const result = await manager.restoreFromCookies();
    expect(services.refreshAllSessions).toHaveBeenCalledTimes(1);
    expect(result.activeAuthuser).toBe(0);
    expect(result.accounts).toHaveLength(2);
  });
});

// --- Cross-tab BroadcastChannel nonce gate ----------------------------------

type ChannelListener = (event: MessageEvent) => void;

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  readonly name: string;
  onmessage: ChannelListener | null = null;
  closed = false;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    if (this.closed) return;
    // Deliver to every OTHER same-name channel (BroadcastChannel never
    // delivers to the sender). Real BroadcastChannel.onmessage receives a
    // MessageEvent with `data`, so wrap the payload accordingly.
    const event = { data } as unknown as MessageEvent;
    for (const other of FakeBroadcastChannel.instances) {
      if (other === this || other.closed || other.name !== this.name) continue;
      const listener = other.onmessage;
      if (listener) listener(event);
    }
  }

  close(): void {
    this.closed = true;
  }
}

describe('AuthManager broadcast nonce gate', () => {
  const realBC = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

  beforeEach(() => {
    FakeBroadcastChannel.instances = [];
    (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel =
      FakeBroadcastChannel as unknown as typeof BroadcastChannel;
  });

  afterEach(() => {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = realBC;
    FakeBroadcastChannel.instances = [];
  });

  function getChannel(index: number): FakeBroadcastChannel {
    const channel = FakeBroadcastChannel.instances[index];
    if (!channel) throw new Error(`No FakeBroadcastChannel at index ${index}`);
    return channel;
  }

  it('ignores forged messages whose nonce does not match a known peer', async () => {
    const servicesA = makeMockServices();
    const servicesB = makeMockServices();
    servicesB.refreshAllSessions.mockResolvedValue({ accounts: [] });

    // Tab A and Tab B both own a BroadcastChannel.
    makeManager(servicesA, { crossTabSync: true });
    const tabB = makeManager(servicesB, { crossTabSync: true });

    const channelA = getChannel(0);
    const channelB = getChannel(1);
    expect(channelA.name).toBe('oxy_auth_sync');
    expect(channelB.name).toBe('oxy_auth_sync');

    // Send a legitimate message from tabId=peer-1 with nonce=N1. Tab B
    // (the receiver under test) has never heard from this peer before, so
    // it records (peer-1 → N1) and honours the message.
    channelA.postMessage({
      type: 'accounts_restored',
      timestamp: Date.now(),
      tabId: 'peer-1',
      nonce: 'nonce-real',
    });

    // Two microtask drains: one for the inner Promise.resolve().then(), one
    // for the restoreFromCookies() call it schedules.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(servicesB.refreshAllSessions).toHaveBeenCalledTimes(1);
    servicesB.refreshAllSessions.mockClear();

    // Now a forged broadcast: same tabId, different nonce (the XSS payload
    // doesn't know the real `_broadcastNonce`).
    channelA.postMessage({
      type: 'all_signed_out',
      timestamp: Date.now(),
      tabId: 'peer-1',
      nonce: 'nonce-forged',
    });

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    // The forged `all_signed_out` MUST NOT trigger a sign-out cascade.
    expect(servicesB.httpService.setTokens).not.toHaveBeenCalledWith('');
    // And no further refresh-all rotation either.
    expect(servicesB.refreshAllSessions).not.toHaveBeenCalled();
    // Sanity: tab B keeps its lifecycle intact.
    expect(tabB.getActiveAuthuser()).toBeNull();
  });

  it('drops messages missing tabId or nonce entirely', async () => {
    const services = makeMockServices();
    makeManager(services, { crossTabSync: true });

    const channel = getChannel(0);
    // Inject a second channel as the "attacker" — same name so postMessage
    // gets delivered to the real tab.
    const attacker = new FakeBroadcastChannel('oxy_auth_sync');
    attacker.postMessage({ type: 'all_signed_out', timestamp: Date.now() });

    await new Promise((resolve) => setImmediate(resolve));
    expect(services.httpService.setTokens).not.toHaveBeenCalledWith('');
    expect(channel).toBeDefined();
  });
});

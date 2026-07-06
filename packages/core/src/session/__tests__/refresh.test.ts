import type { OxyServices } from '../../OxyServices';
import type { TokenRefreshResponse } from '@oxyhq/contracts';
import type { SessionLoginResponse } from '../../models/session';
import { refreshPersistedSession, startTokenRefreshScheduler } from '../refresh';
import { createMemoryAuthStateStore, type PersistedAuthState } from '../authStateStore';

const STORED: PersistedAuthState = {
  sessionId: 'sess-old',
  refreshToken: 'refresh-old-abcdefghij',
  userId: 'user-1',
  deviceToken: 'device-abcdefghij',
};

const ROTATED: TokenRefreshResponse = {
  accessToken: 'access-new',
  refreshToken: 'refresh-new-abcdefghij',
  expiresAt: '2030-01-01T00:00:00.000Z',
  sessionId: 'sess-new',
};

interface RefreshMockOverrides {
  refreshWithToken?: OxyServices['refreshWithToken'];
  signInWithSharedIdentity?: OxyServices['signInWithSharedIdentity'];
}

function makeOxy(overrides: RefreshMockOverrides = {}): { oxy: OxyServices; setTokens: jest.Mock } {
  const setTokens = jest.fn();
  const oxy = {
    setTokens,
    refreshWithToken: overrides.refreshWithToken ?? (async () => ROTATED),
    signInWithSharedIdentity: overrides.signInWithSharedIdentity ?? (async () => null),
  } as unknown as OxyServices;
  return { oxy, setTokens };
}

describe('refreshPersistedSession — arm 1 (refresh-token rotation)', () => {
  it('rotates, plants, persists the new family head, and returns the new token', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(STORED);
    const { oxy, setTokens } = makeOxy();

    const token = await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: false });

    expect(token).toBe('access-new');
    expect(setTokens).toHaveBeenCalledWith('access-new');
    expect(await store.load()).toEqual({
      sessionId: 'sess-new',
      refreshToken: 'refresh-new-abcdefghij',
      userId: 'user-1',
      deviceToken: 'device-abcdefghij',
      accessToken: 'access-new',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
  });

  it('carries the persisted deviceId + deviceSecret (phase 2c) forward across a rotation', async () => {
    const store = createMemoryAuthStateStore();
    await store.save({ ...STORED, deviceId: 'dev-mint', deviceSecret: 'ds-secret-orig' });
    const { oxy } = makeOxy();

    await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: false });

    const persisted = await store.load();
    expect(persisted?.deviceId).toBe('dev-mint');
    expect(persisted?.deviceSecret).toBe('ds-secret-orig');
    // The refresh family head still rotated.
    expect(persisted?.refreshToken).toBe('refresh-new-abcdefghij');
  });

  it('clears the store on a family-revoked (401) error', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(STORED);
    const { oxy } = makeOxy({
      refreshWithToken: async () => {
        throw Object.assign(new Error('revoked'), { status: 401 });
      },
    });

    const token = await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: false });

    expect(token).toBeNull();
    expect(await store.load()).toBeNull();
  });

  it('clears the store on an invalid_grant code', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(STORED);
    const { oxy } = makeOxy({
      refreshWithToken: async () => {
        throw Object.assign(new Error('bad'), { code: 'invalid_grant' });
      },
    });

    expect(await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: false })).toBeNull();
    expect(await store.load()).toBeNull();
  });

  it('KEEPS the store on a transient (500 / network) error', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(STORED);
    const { oxy } = makeOxy({
      refreshWithToken: async () => {
        throw Object.assign(new Error('server'), { status: 500 });
      },
    });

    expect(await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: false })).toBeNull();
    expect(await store.load()).toEqual(STORED);
  });
});

describe('refreshPersistedSession — arm 2 (native shared-key fallback)', () => {
  const SHARED_SESSION: SessionLoginResponse = {
    sessionId: 'sess-shared',
    deviceId: 'dev-1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    user: { id: 'user-1', username: 'u', name: {}, avatar: undefined },
    accessToken: 'access-shared',
  };

  it('re-mints via shared identity when there is no refresh token', async () => {
    const store = createMemoryAuthStateStore(); // no stored refresh token
    const signInWithSharedIdentity = jest.fn(async () => SHARED_SESSION);
    const { oxy } = makeOxy({ signInWithSharedIdentity });

    const token = await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: true });

    expect(token).toBe('access-shared');
    expect(signInWithSharedIdentity).toHaveBeenCalledTimes(1);
  });

  it('falls back to shared-key after a revoked refresh token', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(STORED);
    const signInWithSharedIdentity = jest.fn(async () => SHARED_SESSION);
    const { oxy } = makeOxy({
      refreshWithToken: async () => {
        throw Object.assign(new Error('revoked'), { status: 403 });
      },
      signInWithSharedIdentity,
    });

    const token = await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: true });

    expect(token).toBe('access-shared');
    expect(await store.load()).toBeNull(); // revoked family was cleared
    expect(signInWithSharedIdentity).toHaveBeenCalledTimes(1);
  });

  it('does NOT try shared-key when the fallback is disabled (web)', async () => {
    const store = createMemoryAuthStateStore();
    const signInWithSharedIdentity = jest.fn(async () => SHARED_SESSION);
    const { oxy } = makeOxy({ signInWithSharedIdentity });

    expect(await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: false })).toBeNull();
    expect(signInWithSharedIdentity).not.toHaveBeenCalled();
  });
});

describe('startTokenRefreshScheduler', () => {
  function makeSchedulerOxy(expiresInSeconds: number | null): {
    oxy: OxyServices;
    refreshAccessToken: jest.Mock;
  } {
    let cleared = false;
    const refreshAccessToken = jest.fn(async () => {
      cleared = true; // stop the reschedule loop after the first fire
      return null;
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const oxy = {
      getAccessToken: () => (cleared ? null : 'tok'),
      getAccessTokenExpiry: () => (expiresInSeconds === null ? null : nowSec + expiresInSeconds),
      onTokensChanged: () => () => undefined,
      httpService: { refreshAccessToken },
    } as unknown as OxyServices;
    return { oxy, refreshAccessToken };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires a refresh ~60s before expiry', async () => {
    jest.useFakeTimers();
    const { oxy, refreshAccessToken } = makeSchedulerOxy(120);
    const handle = startTokenRefreshScheduler(oxy);

    expect(refreshAccessToken).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(refreshAccessToken).toHaveBeenCalledWith('preflight');

    handle.dispose();
  });

  it('no-ops cleanly for an opaque token with no exp', () => {
    jest.useFakeTimers();
    const { oxy, refreshAccessToken } = makeSchedulerOxy(null);
    const handle = startTokenRefreshScheduler(oxy);
    jest.advanceTimersByTime(10 * 60_000);
    expect(refreshAccessToken).not.toHaveBeenCalled();
    handle.dispose();
  });

  it('backs off on repeated failure — bounded attempts, never a zero-delay busy loop', async () => {
    jest.useFakeTimers();
    // Already-expired token + a refresh that ALWAYS fails. The old code floored
    // the delay to 0 and re-armed in the finally block → a tight loop that would
    // exhaust jest's 100k-timer guard. The backoff schedule fires only a handful
    // of times per simulated minute.
    const refreshAccessToken = jest.fn(async () => null);
    const nowSec = Math.floor(Date.now() / 1000);
    const oxy = {
      getAccessToken: () => 'tok',
      getAccessTokenExpiry: () => nowSec - 10,
      onTokensChanged: () => () => undefined,
      httpService: { refreshAccessToken },
    } as unknown as OxyServices;

    const handle = startTokenRefreshScheduler(oxy);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(refreshAccessToken.mock.calls.length).toBeGreaterThan(0);
    expect(refreshAccessToken.mock.calls.length).toBeLessThan(10);
    handle.dispose();
  });

  it('resets the backoff after a successful refresh', async () => {
    jest.useFakeTimers();
    // Expiry is always ~1h from NOW, so a successful refresh genuinely pushes
    // the token out (as a real rotation would). Fail once, then succeed.
    const refreshAccessToken = jest
      .fn<Promise<string | null>, [unknown]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue('fresh');
    const oxy = {
      getAccessToken: () => 'tok',
      getAccessTokenExpiry: () => Math.floor(Date.now() / 1000) + 3600,
      onTokensChanged: () => () => undefined,
      httpService: { refreshAccessToken },
    } as unknown as OxyServices;

    const handle = startTokenRefreshScheduler(oxy);
    // First fire ~ (3600-60)s out (fails → 5s backoff), then the backoff fire
    // succeeds and re-arms ~1h out from the (now-fresh) expiry.
    await jest.advanceTimersByTimeAsync((3600 - 60) * 1000);
    await jest.advanceTimersByTimeAsync(5_000);
    const callsAfterSuccess = refreshAccessToken.mock.calls.length;
    expect(callsAfterSuccess).toBe(2); // one failure + one success
    // A further minute must NOT produce a burst — the healthy re-arm is ~1h out.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(refreshAccessToken.mock.calls.length).toBe(callsAfterSuccess);
    handle.dispose();
  });

  it('calls unref() on its timer so it never holds the event loop', () => {
    const unref = jest.fn();
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockReturnValue({ unref } as unknown as ReturnType<typeof setTimeout>);
    const { oxy } = makeSchedulerOxy(120);

    const handle = startTokenRefreshScheduler(oxy);
    expect(setTimeoutSpy).toHaveBeenCalled();
    expect(unref).toHaveBeenCalled();

    handle.dispose();
    setTimeoutSpy.mockRestore();
  });
});

import type { OxyServices } from '../../OxyServices';
import type { DeviceTokenMintResponse } from '@oxyhq/contracts';
import type { SessionLoginResponse } from '../../models/session';
import { refreshPersistedSession, startTokenRefreshScheduler } from '../refresh';
import { createMemoryAuthStateStore, type PersistedAuthState } from '../authStateStore';

/** The persisted zero-cookie mint credential the refresh reads. */
const STORED: PersistedAuthState = {
  sessionId: 'sess-old',
  userId: 'user-1',
  deviceId: 'dev-mint',
  deviceSecret: 'ds-secret-orig',
};

/** A successful `POST /session/device/token` mint (rotates the secret + active account). */
const MINT: DeviceTokenMintResponse = {
  accessToken: 'access-new',
  expiresAt: '2030-01-01T00:00:00.000Z',
  nextDeviceSecret: 'ds-next-secret',
  state: {
    deviceId: 'dev-mint',
    accounts: [{ accountId: 'user-1', sessionId: 'sess-new', authuser: 0 }],
    activeAccountId: 'user-1',
    revision: 4,
    updatedAt: 1_700_000_000_000,
  },
};

interface RefreshMockOverrides {
  mintFromDeviceSecret?: OxyServices['mintFromDeviceSecret'];
  signInWithSharedIdentity?: OxyServices['signInWithSharedIdentity'];
}

function makeOxy(overrides: RefreshMockOverrides = {}): { oxy: OxyServices; setTokens: jest.Mock } {
  const setTokens = jest.fn();
  const oxy = {
    setTokens,
    mintFromDeviceSecret: overrides.mintFromDeviceSecret ?? (async () => MINT),
    signInWithSharedIdentity: overrides.signInWithSharedIdentity ?? (async () => null),
  } as unknown as OxyServices;
  return { oxy, setTokens };
}

describe('refreshPersistedSession — arm 1 (device-secret mint)', () => {
  it('mints, plants, persists the rotated secret + active account, and returns the token', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(STORED);
    const { oxy, setTokens } = makeOxy();

    const token = await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: false });

    expect(token).toBe('access-new');
    expect(setTokens).toHaveBeenCalledWith('access-new');
    expect(await store.load()).toEqual({
      sessionId: 'sess-new',
      userId: 'user-1',
      deviceId: 'dev-mint',
      deviceSecret: 'ds-next-secret',
      accessToken: 'access-new',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
  });

  it('presents the persisted deviceId + deviceSecret to the mint', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(STORED);
    const mintFromDeviceSecret = jest.fn(async () => MINT);
    const { oxy } = makeOxy({ mintFromDeviceSecret });

    await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: false });

    expect(mintFromDeviceSecret).toHaveBeenCalledWith('dev-mint', 'ds-secret-orig');
  });

  it('drops only the secret (keeps deviceId) on a 401 and falls to shared-key when native', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(STORED);
    const SHARED: SessionLoginResponse = {
      sessionId: 'sess-shared',
      deviceId: 'dev-1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      user: { id: 'user-1', username: 'u', name: {}, avatar: undefined },
      accessToken: 'access-shared',
    };
    const signInWithSharedIdentity = jest.fn(async () => SHARED);
    const { oxy } = makeOxy({
      mintFromDeviceSecret: async () => {
        throw Object.assign(new Error('invalid_device_secret'), { status: 401 });
      },
      signInWithSharedIdentity,
    });

    const token = await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: true });

    expect(token).toBe('access-shared');
    expect(signInWithSharedIdentity).toHaveBeenCalledTimes(1);
    const persisted = await store.load();
    expect(persisted?.deviceSecret).toBeUndefined();
    expect(persisted?.deviceId).toBe('dev-mint');
  });

  it('clears the store on a 401 when there is no shared-key fallback (web)', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(STORED);
    const { oxy } = makeOxy({
      mintFromDeviceSecret: async () => {
        throw Object.assign(new Error('no_active_session'), { status: 401 });
      },
    });

    const token = await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: false });

    expect(token).toBeNull();
    expect(await store.load()).toBeNull();
  });

  it('KEEPS the store and returns null on a transient (500 / network) error', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(STORED);
    const signInWithSharedIdentity = jest.fn(async () => null);
    const { oxy } = makeOxy({
      mintFromDeviceSecret: async () => {
        throw Object.assign(new Error('server'), { status: 500 });
      },
      signInWithSharedIdentity,
    });

    // A transient failure must NOT drop the credential nor fall through to shared-key.
    expect(await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: true })).toBeNull();
    expect(await store.load()).toEqual(STORED);
    expect(signInWithSharedIdentity).not.toHaveBeenCalled();
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

  it('re-mints via shared identity when there is no persisted secret', async () => {
    const store = createMemoryAuthStateStore(); // no stored device secret
    const signInWithSharedIdentity = jest.fn(async () => SHARED_SESSION);
    const { oxy } = makeOxy({ signInWithSharedIdentity });

    const token = await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: true });

    expect(token).toBe('access-shared');
    expect(signInWithSharedIdentity).toHaveBeenCalledTimes(1);
  });

  it('does NOT try shared-key when the fallback is disabled (web)', async () => {
    const store = createMemoryAuthStateStore();
    const signInWithSharedIdentity = jest.fn(async () => SHARED_SESSION);
    const { oxy } = makeOxy({ signInWithSharedIdentity });

    expect(await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: false })).toBeNull();
    expect(signInWithSharedIdentity).not.toHaveBeenCalled();
  });

  it('returns null when the shared-key re-mint yields no session', async () => {
    const store = createMemoryAuthStateStore();
    const signInWithSharedIdentity = jest.fn(async () => null);
    const { oxy } = makeOxy({ signInWithSharedIdentity });

    expect(await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: true })).toBeNull();
    expect(signInWithSharedIdentity).toHaveBeenCalledTimes(1);
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

import type { DeviceSessionState } from '@oxyhq/contracts';
import { logger, createMemoryAuthStateStore, refreshPersistedSession } from '@oxyhq/core';
import { createTokenTransport } from '../tokenTransport';

// The device-first transport mints a fallback token by rotating the persisted
// refresh family via `refreshPersistedSession` (the ONE unified refresh path) —
// there is no `silentSignIn`/`signInWithSharedIdentity` arm anymore. Mock that
// one core function so the transport's own coalescing / logging contract can be
// exercised in isolation; keep the real `logger` + memory store.
jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return { __esModule: true, ...actual, refreshPersistedSession: jest.fn() };
});

const mockedRefresh = refreshPersistedSession as jest.MockedFunction<typeof refreshPersistedSession>;

function fakeOxy(accessToken: string | null) {
  return {
    getAccessToken: jest.fn().mockReturnValue(accessToken),
  };
}

const state: DeviceSessionState = {
  deviceId: 'device-1',
  accounts: [{ accountId: 'a1', sessionId: 'sess-a1', authuser: 0 }],
  activeAccountId: 'a1',
  revision: 1,
  updatedAt: Date.UTC(2026, 6, 1, 0, 0, 0, 0),
};

describe('createTokenTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRefresh.mockResolvedValue('minted-token');
  });

  test('no-ops when a token is already present', async () => {
    const oxy = fakeOxy('tok');
    const transport = createTokenTransport(oxy as never, createMemoryAuthStateStore());

    await transport.ensureActiveToken(state);

    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  test('mints via refreshPersistedSession when no token is present', async () => {
    const oxy = fakeOxy(null);
    const store = createMemoryAuthStateStore();
    const transport = createTokenTransport(oxy as never, store);

    await transport.ensureActiveToken(state);

    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(mockedRefresh).toHaveBeenCalledWith({ oxy, store });
  });

  test('resolves (never rejects) and logs a warning when the refresh throws', async () => {
    const oxy = fakeOxy(null);
    mockedRefresh.mockRejectedValue(new Error('mint boom'));
    const transport = createTokenTransport(oxy as never, createMemoryAuthStateStore());
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(transport.ensureActiveToken(state)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'ensureActiveToken: refresh failed',
      { component: 'TokenTransport' },
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  test('resolves cleanly when the refresh produces no session', async () => {
    const oxy = fakeOxy(null);
    mockedRefresh.mockResolvedValue(null);
    const transport = createTokenTransport(oxy as never, createMemoryAuthStateStore());

    await expect(transport.ensureActiveToken(state)).resolves.toBeUndefined();
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
  });

  test('coalesces concurrent calls into a single mint', async () => {
    const oxy = fakeOxy(null);
    let resolveMint: ((value: string | null) => void) | null = null;
    mockedRefresh.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveMint = resolve;
        }),
    );
    const transport = createTokenTransport(oxy as never, createMemoryAuthStateStore());

    const first = transport.ensureActiveToken(state);
    const second = transport.ensureActiveToken(state);

    expect(mockedRefresh).toHaveBeenCalledTimes(1);

    resolveMint?.(null);
    await Promise.all([first, second]);

    expect(mockedRefresh).toHaveBeenCalledTimes(1);

    // A later call after the in-flight mint settled starts a fresh mint.
    const third = transport.ensureActiveToken(state);
    expect(mockedRefresh).toHaveBeenCalledTimes(2);
    resolveMint?.(null);
    await third;
  });

  test('treats a throwing getAccessToken as no-token and still mints', async () => {
    const oxy = fakeOxy(null);
    oxy.getAccessToken.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const transport = createTokenTransport(oxy as never, createMemoryAuthStateStore());
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(transport.ensureActiveToken(state)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'ensureActiveToken: getAccessToken threw',
      { component: 'TokenTransport' },
      expect.any(Error),
    );
    expect(mockedRefresh).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});

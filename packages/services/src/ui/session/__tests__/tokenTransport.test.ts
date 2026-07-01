import type { DeviceSessionState } from '@oxyhq/contracts';
import { logger } from '@oxyhq/core';
import { createTokenTransport } from '../tokenTransport';
import { isWebBrowser } from '../../hooks/useWebSSO';

jest.mock('../../hooks/useWebSSO', () => ({
  isWebBrowser: jest.fn(),
}));

const mockedIsWebBrowser = isWebBrowser as jest.MockedFunction<typeof isWebBrowser>;

function fakeOxy(accessToken: string | null) {
  return {
    getAccessToken: jest.fn().mockReturnValue(accessToken),
    silentSignIn: jest.fn().mockResolvedValue(null),
    signInWithSharedIdentity: jest.fn().mockResolvedValue(null),
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
  });

  test('no-ops when a token is already present', async () => {
    const oxy = fakeOxy('tok');
    const transport = createTokenTransport(oxy as never);

    await transport.ensureActiveToken(state);

    expect(oxy.silentSignIn).not.toHaveBeenCalled();
    expect(oxy.signInWithSharedIdentity).not.toHaveBeenCalled();
  });

  test('mints via silentSignIn on web when no token is present', async () => {
    mockedIsWebBrowser.mockReturnValue(true);
    const oxy = fakeOxy(null);
    const transport = createTokenTransport(oxy as never);

    await transport.ensureActiveToken(state);

    expect(oxy.silentSignIn).toHaveBeenCalledTimes(1);
    expect(oxy.signInWithSharedIdentity).not.toHaveBeenCalled();
  });

  test('mints via signInWithSharedIdentity off web when no token is present', async () => {
    mockedIsWebBrowser.mockReturnValue(false);
    const oxy = fakeOxy(null);
    const transport = createTokenTransport(oxy as never);

    await transport.ensureActiveToken(state);

    expect(oxy.signInWithSharedIdentity).toHaveBeenCalledTimes(1);
    expect(oxy.silentSignIn).not.toHaveBeenCalled();
  });

  test('resolves (never rejects) and logs a warning when the mint throws', async () => {
    mockedIsWebBrowser.mockReturnValue(true);
    const oxy = fakeOxy(null);
    oxy.silentSignIn.mockRejectedValue(new Error('mint boom'));
    const transport = createTokenTransport(oxy as never);
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(transport.ensureActiveToken(state)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'ensureActiveToken: mint failed',
      { component: 'TokenTransport' },
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  test('resolves cleanly when the mint returns null', async () => {
    mockedIsWebBrowser.mockReturnValue(true);
    const oxy = fakeOxy(null);
    const transport = createTokenTransport(oxy as never);

    await expect(transport.ensureActiveToken(state)).resolves.toBeUndefined();
    expect(oxy.silentSignIn).toHaveBeenCalledTimes(1);
  });

  test('coalesces concurrent calls into a single mint', async () => {
    mockedIsWebBrowser.mockReturnValue(true);
    const oxy = fakeOxy(null);
    let resolveMint: ((value: null) => void) | null = null;
    oxy.silentSignIn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMint = resolve;
        }),
    );
    const transport = createTokenTransport(oxy as never);

    const first = transport.ensureActiveToken(state);
    const second = transport.ensureActiveToken(state);

    expect(oxy.silentSignIn).toHaveBeenCalledTimes(1);

    resolveMint?.(null);
    await Promise.all([first, second]);

    expect(oxy.silentSignIn).toHaveBeenCalledTimes(1);

    // A later call after the in-flight mint settled starts a fresh mint
    // (the mock reassigns `resolveMint` on the second silentSignIn call).
    const third = transport.ensureActiveToken(state);
    expect(oxy.silentSignIn).toHaveBeenCalledTimes(2);
    resolveMint?.(null);
    await third;
  });

  test('treats a throwing getAccessToken as no-token and still mints', async () => {
    mockedIsWebBrowser.mockReturnValue(true);
    const oxy = fakeOxy(null);
    oxy.getAccessToken.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const transport = createTokenTransport(oxy as never);
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(transport.ensureActiveToken(state)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'ensureActiveToken: getAccessToken threw',
      { component: 'TokenTransport' },
      expect.any(Error),
    );
    expect(oxy.silentSignIn).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});

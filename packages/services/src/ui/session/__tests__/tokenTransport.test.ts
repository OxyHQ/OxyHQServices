import type { DeviceSessionState } from '@oxyhq/contracts';
import { logger } from '@oxyhq/core';
import { createTokenTransport } from '../tokenTransport';

// The device-first transport no longer owns a private mint single-flight: it
// routes through the ONE shared `oxyServices.httpService.refreshAccessToken(...)`
// the scheduler/preflight/401 use, so concurrent lanes can never double-rotate
// the device secret. These tests exercise the transport's own no-op / error /
// swallow contract around that single call.

function fakeOxy(accessToken: string | null, refreshAccessToken = jest.fn(async () => 'minted-token')) {
  return {
    getAccessToken: jest.fn().mockReturnValue(accessToken),
    httpService: { refreshAccessToken },
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
  test('no-ops when a token is already present', async () => {
    const refreshAccessToken = jest.fn(async () => 'minted-token');
    const oxy = fakeOxy('tok', refreshAccessToken);
    const transport = createTokenTransport(oxy as never);

    await transport.ensureActiveToken(state);

    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  test('mints via the shared httpService.refreshAccessToken single-flight when no token is present', async () => {
    const refreshAccessToken = jest.fn(async () => 'minted-token');
    const oxy = fakeOxy(null, refreshAccessToken);
    const transport = createTokenTransport(oxy as never);

    await transport.ensureActiveToken(state);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).toHaveBeenCalledWith('preflight');
  });

  test('resolves (never rejects) and logs a warning when the refresh throws', async () => {
    const refreshAccessToken = jest.fn(async () => {
      throw new Error('mint boom');
    });
    const oxy = fakeOxy(null, refreshAccessToken);
    const transport = createTokenTransport(oxy as never);
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
    const refreshAccessToken = jest.fn(async () => null);
    const oxy = fakeOxy(null, refreshAccessToken);
    const transport = createTokenTransport(oxy as never);

    await expect(transport.ensureActiveToken(state)).resolves.toBeUndefined();
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  test('delegates concurrent calls to the shared single-flight (no private guard of its own)', async () => {
    // The transport keeps NO local coalescing — it forwards each call to the
    // shared `httpService.refreshAccessToken`, which owns the single-flight that
    // collapses concurrent mints into one server rotation (covered in core).
    const refreshAccessToken = jest.fn(async () => 'minted-token');
    const oxy = fakeOxy(null, refreshAccessToken);
    const transport = createTokenTransport(oxy as never);

    const first = transport.ensureActiveToken(state);
    const second = transport.ensureActiveToken(state);
    // Both concurrent callers reached the shared entry point synchronously — the
    // transport does not swallow the second behind a private guard; dedup is the
    // shared single-flight's job.
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  test('treats a throwing getAccessToken as no-token and still mints', async () => {
    const refreshAccessToken = jest.fn(async () => 'minted-token');
    const oxy = fakeOxy(null, refreshAccessToken);
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
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});

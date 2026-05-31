/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * Run-once guarantees for the @oxyhq/auth web silent-SSO hook.
 *
 * Mirrors the @oxyhq/services test: silent SSO must fire exactly once per page
 * load even across provider remounts (route churn / StrictMode), because a
 * remount storm previously became a `navigator.credentials.get` storm. The
 * guard is module-level and keyed on `origin + baseURL`.
 */

import { renderHook, waitFor } from '@testing-library/react';
import type { OxyServices, SessionLoginResponse } from '@oxyhq/core';
import { useWebSSO } from '../../src/hooks/useWebSSO';

interface StubServices {
  isFedCMSupported: jest.Mock<boolean, []>;
  silentSignInWithFedCM: jest.Mock<Promise<SessionLoginResponse | null>, []>;
  signInWithFedCM: jest.Mock<Promise<SessionLoginResponse | null>, []>;
  getBaseURL: jest.Mock<string, []>;
}

function makeServices(
  session: SessionLoginResponse | null,
  baseURL: string
): StubServices {
  return {
    isFedCMSupported: jest.fn(() => true),
    silentSignInWithFedCM: jest.fn(async () => session),
    signInWithFedCM: jest.fn(async () => session),
    getBaseURL: jest.fn(() => baseURL),
  };
}

const fakeSession: SessionLoginResponse = {
  sessionId: 'sess_1',
  deviceId: 'dev_1',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: { id: 'u1', username: 'tester' },
} as SessionLoginResponse;

describe('useWebSSO run-once guarantee (auth-sdk)', () => {
  it('fires silent SSO exactly once on mount and resolves a session', async () => {
    const services = makeServices(fakeSession, 'https://api.oxy.so/auth-once-1');
    const onSessionFound = jest.fn(async () => undefined);

    renderHook(() =>
      useWebSSO({
        oxyServices: services as unknown as OxyServices,
        onSessionFound,
        enabled: true,
      })
    );

    await waitFor(() => expect(services.silentSignInWithFedCM).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSessionFound).toHaveBeenCalledWith(fakeSession));
  });

  it('does NOT re-fire silent SSO after unmount + remount', async () => {
    const services = makeServices(null, 'https://api.oxy.so/auth-remount');
    const onSessionFound = jest.fn(async () => undefined);

    const first = renderHook(() =>
      useWebSSO({
        oxyServices: services as unknown as OxyServices,
        onSessionFound,
        enabled: true,
      })
    );
    await waitFor(() => expect(services.silentSignInWithFedCM).toHaveBeenCalledTimes(1));

    first.unmount();
    for (let i = 0; i < 5; i++) {
      const r = renderHook(() =>
        useWebSSO({
          oxyServices: services as unknown as OxyServices,
          onSessionFound,
          enabled: true,
        })
      );
      r.unmount();
    }

    expect(services.silentSignInWithFedCM).toHaveBeenCalledTimes(1);
  });
});

/**
 * useOxySignIn — headless password/2FA sign-in state machine.
 *
 * Driven standalone (no provider) with a fake `OxyServices` so the core device
 * primitives (`passwordSignIn` / `completeTwoFactorSignIn`) are controllable.
 * The persisted device-attribution token is read from the real
 * `createWebAuthStateStore` (jsdom localStorage).
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { DEVICE_TOKEN_STORAGE_KEY } from '@oxyhq/core';
import type { OxyServices } from '@oxyhq/core';
import type { LoginResult } from '@oxyhq/contracts';
import { useOxySignIn } from '../src/hooks/useOxySignIn';

function makeFakeSvc(overrides: {
  passwordSignIn?: jest.Mock;
  completeTwoFactorSignIn?: jest.Mock;
}): OxyServices {
  return {
    passwordSignIn: overrides.passwordSignIn ?? jest.fn(),
    completeTwoFactorSignIn: overrides.completeTwoFactorSignIn ?? jest.fn(),
    getAccessToken: () => 'planted-token',
  } as unknown as OxyServices;
}

const sessionArm: LoginResult = {
  sessionId: 'sess-1',
  deviceId: 'dev-1',
  expiresAt: '2999-01-01T00:00:00.000Z',
  accessToken: 'tok-1',
  refreshToken: 'rt-1',
  user: { id: 'u1', username: 'nate' },
};

describe('useOxySignIn', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('happy path: submitPassword → authorized, commits the session', async () => {
    const passwordSignIn = jest.fn(async () => sessionArm);
    const onAuthenticated = jest.fn(async () => undefined);
    const svc = makeFakeSvc({ passwordSignIn });

    const { result } = renderHook(() => useOxySignIn({ oxyServices: svc, onAuthenticated }));
    expect(result.current.phase).toBe('credentials');

    await act(async () => { await result.current.submitPassword('nate', 'pw'); });

    await waitFor(() => expect(result.current.phase).toBe('authorized'));
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
    expect(onAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', userId: 'u1', accessToken: 'tok-1', refreshToken: 'rt-1' }),
    );
  });

  it('2FA path: submitPassword → twoFactor, submitTwoFactor → authorized', async () => {
    const passwordSignIn = jest.fn(async () => ({ twoFactorRequired: true, loginToken: 'lt-1' } as LoginResult));
    const completeTwoFactorSignIn = jest.fn(async () => sessionArm);
    const onAuthenticated = jest.fn(async () => undefined);
    const svc = makeFakeSvc({ passwordSignIn, completeTwoFactorSignIn });

    const { result } = renderHook(() => useOxySignIn({ oxyServices: svc, onAuthenticated }));

    await act(async () => { await result.current.submitPassword('nate', 'pw'); });
    await waitFor(() => expect(result.current.phase).toBe('twoFactor'));
    expect(onAuthenticated).not.toHaveBeenCalled();

    await act(async () => { await result.current.submitTwoFactor({ token: '123456' }); });
    await waitFor(() => expect(result.current.phase).toBe('authorized'));
    expect(completeTwoFactorSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ loginToken: 'lt-1', token: '123456' }),
    );
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });

  it('sends the persisted device-attribution token with the login request', async () => {
    window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, 'dev-tok-1');
    const passwordSignIn = jest.fn(async () => sessionArm);
    const svc = makeFakeSvc({ passwordSignIn });

    const { result } = renderHook(() => useOxySignIn({ oxyServices: svc, onAuthenticated: jest.fn() }));
    await act(async () => { await result.current.submitPassword('nate', 'pw'); });

    expect(passwordSignIn).toHaveBeenCalledWith('nate', 'pw', { deviceToken: 'dev-tok-1' });
  });

  it('surfaces an error and keeps the credentials phase on failure', async () => {
    const passwordSignIn = jest.fn(async () => { throw new Error('Invalid credentials'); });
    const onError = jest.fn();
    const svc = makeFakeSvc({ passwordSignIn });

    const { result } = renderHook(() => useOxySignIn({ oxyServices: svc, onError }));
    await act(async () => { await result.current.submitPassword('nate', 'bad'); });

    expect(result.current.phase).toBe('credentials');
    expect(result.current.error).toBe('Invalid credentials');
    expect(result.current.isSubmitting).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

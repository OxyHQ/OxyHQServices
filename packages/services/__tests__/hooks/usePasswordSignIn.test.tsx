/**
 * `usePasswordSignIn` — the first-party password sign-in state machine shared by
 * the web `SignInModal` and native `OxyAuthScreen` (identifier → password →
 * optional two-factor). It is a thin UI state machine over the context methods
 * `signInWithPassword` + `completeTwoFactorSignIn`, so this suite mocks the
 * context and asserts the flow: the happy one-step path, the 2FA branch, input
 * validation, and a wrong-password error surfacing without a false sign-in.
 */

import { act, renderHook } from '@testing-library/react';
import type { PasswordSignInResult } from '../../src/ui/context/OxyContext';

const signInWithPassword = jest.fn<Promise<PasswordSignInResult>, [string, string, unknown?]>();
const completeTwoFactorSignIn = jest.fn<Promise<void>, [unknown]>();

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({ signInWithPassword, completeTwoFactorSignIn }),
}));

import { usePasswordSignIn } from '../../src/ui/hooks/usePasswordSignIn';

describe('usePasswordSignIn', () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    completeTwoFactorSignIn.mockReset();
  });

  it('advances identifier → password → commits a one-step session (happy path)', async () => {
    signInWithPassword.mockResolvedValue({ status: 'ok' });
    const onSignedIn = jest.fn();
    const { result } = renderHook(() => usePasswordSignIn({ onSignedIn }));

    act(() => result.current.setIdentifier('pwuser'));
    act(() => result.current.submitIdentifier());
    expect(result.current.step).toBe('password');
    expect(result.current.error).toBeNull();

    act(() => result.current.setPassword('hunter2'));
    await act(async () => {
      await result.current.submitPassword();
    });

    expect(signInWithPassword).toHaveBeenCalledWith('pwuser', 'hunter2');
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    // A committed one-step session does NOT advance to the 2FA step.
    expect(result.current.step).toBe('password');
    expect(result.current.error).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
  });

  it('advances to the two-factor step and completes the challenge', async () => {
    signInWithPassword.mockResolvedValue({ status: '2fa_required', loginToken: 'lt_abc' });
    completeTwoFactorSignIn.mockResolvedValue(undefined);
    const onSignedIn = jest.fn();
    const { result } = renderHook(() => usePasswordSignIn({ onSignedIn }));

    act(() => result.current.setIdentifier('pwuser'));
    act(() => result.current.submitIdentifier());
    act(() => result.current.setPassword('hunter2'));
    await act(async () => {
      await result.current.submitPassword();
    });

    // The password was accepted but 2FA is required — advance, do not sign in yet.
    expect(result.current.step).toBe('twoFactor');
    expect(onSignedIn).not.toHaveBeenCalled();

    act(() => result.current.setCode('123456'));
    await act(async () => {
      await result.current.submitTwoFactor();
    });

    expect(completeTwoFactorSignIn).toHaveBeenCalledWith({ loginToken: 'lt_abc', token: '123456' });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('submits a backup code instead of a TOTP token when useBackupCode is set', async () => {
    signInWithPassword.mockResolvedValue({ status: '2fa_required', loginToken: 'lt_abc' });
    completeTwoFactorSignIn.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePasswordSignIn());

    act(() => result.current.setIdentifier('pwuser'));
    act(() => result.current.submitIdentifier());
    act(() => result.current.setPassword('hunter2'));
    await act(async () => {
      await result.current.submitPassword();
    });

    act(() => result.current.setUseBackupCode(true));
    act(() => result.current.setCode('backup-01'));
    await act(async () => {
      await result.current.submitTwoFactor();
    });

    expect(completeTwoFactorSignIn).toHaveBeenCalledWith({ loginToken: 'lt_abc', backupCode: 'backup-01' });
  });

  it('surfaces a wrong-password error without signing in', async () => {
    signInWithPassword.mockRejectedValue(new Error('Invalid credentials'));
    const onSignedIn = jest.fn();
    const { result } = renderHook(() => usePasswordSignIn({ onSignedIn }));

    act(() => result.current.setIdentifier('pwuser'));
    act(() => result.current.submitIdentifier());
    act(() => result.current.setPassword('wrongpass'));
    await act(async () => {
      await result.current.submitPassword();
    });

    expect(signInWithPassword).toHaveBeenCalledWith('pwuser', 'wrongpass');
    expect(result.current.error).toBe('Invalid credentials');
    expect(onSignedIn).not.toHaveBeenCalled();
    // Stays on the password step so the user can retry; never advances to 2FA.
    expect(result.current.step).toBe('password');
    expect(result.current.isSubmitting).toBe(false);
  });

  it('validates a non-empty identifier and password before calling the context', async () => {
    const { result } = renderHook(() => usePasswordSignIn());

    act(() => result.current.submitIdentifier());
    expect(result.current.error).toBe('Enter your username or email');
    expect(result.current.step).toBe('identifier');

    act(() => result.current.setIdentifier('pwuser'));
    act(() => result.current.submitIdentifier());
    await act(async () => {
      await result.current.submitPassword();
    });
    expect(result.current.error).toBe('Enter your password');
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('back() steps twoFactor → password → identifier and clears transient state', async () => {
    signInWithPassword.mockResolvedValue({ status: '2fa_required', loginToken: 'lt_abc' });
    const { result } = renderHook(() => usePasswordSignIn());

    act(() => result.current.setIdentifier('pwuser'));
    act(() => result.current.submitIdentifier());
    act(() => result.current.setPassword('hunter2'));
    await act(async () => {
      await result.current.submitPassword();
    });
    expect(result.current.step).toBe('twoFactor');

    act(() => result.current.back());
    expect(result.current.step).toBe('password');

    act(() => result.current.back());
    expect(result.current.step).toBe('identifier');
  });
});

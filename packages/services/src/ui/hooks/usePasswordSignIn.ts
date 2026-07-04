/**
 * `usePasswordSignIn` — the first-party password sign-in state machine.
 *
 * Drives the in-app "Sign in with Oxy" password flow shared by the web
 * `SignInModal` and the native `OxyAuthScreen`: identifier → password → optional
 * two-factor. It is a thin UI state machine over the context methods
 * `signInWithPassword` + `completeTwoFactorSignIn` (which own the network call,
 * the persisted-refresh commit, and the device-set registration) — so both
 * surfaces present an identical flow without re-implementing any transport.
 *
 * On a committed session `onSignedIn` fires (the modal/screen closes); the
 * device-first cold boot / SessionClient projection then drive the app into the
 * authenticated state.
 */
import { useCallback, useMemo, useState } from 'react';
import { useOxy } from '../context/OxyContext';
import { handleAuthError } from '../utils/errorHandlers';

export type PasswordSignInStep = 'identifier' | 'password' | 'twoFactor';

export interface UsePasswordSignInOptions {
  /** Fired once a session has been committed (the surface should close). */
  onSignedIn?: () => void;
}

export interface UsePasswordSignInResult {
  step: PasswordSignInStep;
  identifier: string;
  setIdentifier: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  /** The current 2FA input — a TOTP code or a backup code, per `useBackupCode`. */
  code: string;
  setCode: (value: string) => void;
  useBackupCode: boolean;
  setUseBackupCode: (value: boolean) => void;
  error: string | null;
  isSubmitting: boolean;
  /** Advance identifier → password (validates a non-empty identifier). */
  submitIdentifier: () => void;
  /** Submit the password: commits a one-step session, or advances to 2FA. */
  submitPassword: () => Promise<void>;
  /** Submit the 2FA code / backup code and commit the session. */
  submitTwoFactor: () => Promise<void>;
  /** Step back one screen (2FA → password → identifier), clearing the error. */
  back: () => void;
  /** Reset every field back to the identifier step. */
  reset: () => void;
}

export function usePasswordSignIn(options: UsePasswordSignInOptions = {}): UsePasswordSignInResult {
  const { signInWithPassword, completeTwoFactorSignIn } = useOxy();
  const { onSignedIn } = options;

  const [step, setStep] = useState<PasswordSignInStep>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginToken, setLoginToken] = useState<string | null>(null);

  const surfaceError = useCallback((err: unknown, defaultMessage: string): void => {
    setError(handleAuthError(err, { defaultMessage, code: 'PASSWORD_SIGN_IN_ERROR' }));
  }, []);

  const submitIdentifier = useCallback(() => {
    if (!identifier.trim()) {
      setError('Enter your username or email');
      return;
    }
    setError(null);
    setStep('password');
  }, [identifier]);

  const submitPassword = useCallback(async () => {
    if (!password) {
      setError('Enter your password');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await signInWithPassword(identifier.trim(), password);
      if (result.status === '2fa_required') {
        setLoginToken(result.loginToken);
        setCode('');
        setUseBackupCode(false);
        setStep('twoFactor');
        return;
      }
      onSignedIn?.();
    } catch (err) {
      surfaceError(err, 'Sign in failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [identifier, password, signInWithPassword, onSignedIn, surfaceError]);

  const submitTwoFactor = useCallback(async () => {
    if (!loginToken) {
      setError('Your sign-in session expired. Start again.');
      setStep('password');
      return;
    }
    if (!code.trim()) {
      setError(useBackupCode ? 'Enter a backup code' : 'Enter your 6-digit code');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await completeTwoFactorSignIn({
        loginToken,
        ...(useBackupCode ? { backupCode: code.trim() } : { token: code.trim() }),
      });
      onSignedIn?.();
    } catch (err) {
      surfaceError(err, 'Verification failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [loginToken, code, useBackupCode, completeTwoFactorSignIn, onSignedIn, surfaceError]);

  const back = useCallback(() => {
    setError(null);
    setStep((current) => {
      if (current === 'twoFactor') {
        setLoginToken(null);
        setCode('');
        return 'password';
      }
      if (current === 'password') {
        setPassword('');
        return 'identifier';
      }
      return current;
    });
  }, []);

  const reset = useCallback(() => {
    setStep('identifier');
    setIdentifier('');
    setPassword('');
    setCode('');
    setUseBackupCode(false);
    setLoginToken(null);
    setError(null);
    setIsSubmitting(false);
  }, []);

  return useMemo(
    () => ({
      step,
      identifier,
      setIdentifier,
      password,
      setPassword,
      code,
      setCode,
      useBackupCode,
      setUseBackupCode,
      error,
      isSubmitting,
      submitIdentifier,
      submitPassword,
      submitTwoFactor,
      back,
      reset,
    }),
    [
      step,
      identifier,
      password,
      code,
      useBackupCode,
      error,
      isSubmitting,
      submitIdentifier,
      submitPassword,
      submitTwoFactor,
      back,
      reset,
    ],
  );
}

/**
 * useOxySignIn — the headless first-party "Sign in with Oxy" state machine.
 *
 * Drives the in-app password sign-in flow over the core device-first primitives
 * (`OxyServices.passwordSignIn` → `OxyServices.completeTwoFactorSignIn`):
 *
 *   credentials ──submitPassword──▶ authenticating ──┬─▶ authorized
 *                                                     └─▶ twoFactor ──submitTwoFactor──▶ authorized
 *
 * Direct against `api.oxy.so` — there is NO redirect to an IdP. The existing
 * device-attribution token (persisted per origin) is sent with each attempt so
 * the new session joins the same server-side DeviceSession, and the committed
 * session is registered + activated in the `SessionClient`.
 *
 * Provider integration (mirrors {@link useCommonsSignIn}): inside a
 * {@link WebOxyProvider} with no explicit options it resolves `oxyServices` from
 * context and commits through the provider's session path
 * ({@link WebOxyContextValue.commitSignInSession}). Passing explicit options
 * (standalone surfaces) overrides that — the hook never requires a provider.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { createWebAuthStateStore } from '@oxyhq/core';
import type { OxyServices } from '@oxyhq/core';
import type { LoginSessionResult } from '@oxyhq/contracts';
import { useWebOxyOptional, type CommittedSignInSession } from '../WebOxyProvider';

/**
 * Lifecycle phase of an in-app password sign-in flow. A failed attempt keeps
 * the CURRENT phase (so the user retries from the right form) and surfaces
 * `error` — there is no dedicated `error` phase. `isSubmitting` reports an
 * in-flight request within any phase.
 */
export type OxySignInPhase =
  /** Collecting identifier + password (initial). */
  | 'credentials'
  /** Password accepted; awaiting a TOTP token / backup code. */
  | 'twoFactor'
  /** Sign-in completed and committed. */
  | 'authorized';

export interface UseOxySignInOptions {
  /**
   * The OxyServices client to drive the flow. Omit inside a
   * {@link WebOxyProvider} to use the provider's instance.
   */
  oxyServices?: OxyServices;
  /**
   * Called after a session is authenticated (single-step or post-2FA). Omit
   * inside a {@link WebOxyProvider} to commit through the provider's session
   * path automatically.
   */
  onAuthenticated?: (session: CommittedSignInSession) => void | Promise<void>;
  /** Surface non-recoverable errors. */
  onError?: (error: Error) => void;
}

export interface UseOxySignInResult {
  /** Current lifecycle phase. */
  phase: OxySignInPhase;
  /** A user-facing error message, or `null`. */
  error: string | null;
  /** `true` while a request is in flight. */
  isSubmitting: boolean;
  /**
   * Submit an identifier (username or email) + password. Advances to
   * `twoFactor` when the account has 2FA enabled, otherwise `authorized`.
   */
  submitPassword: (identifier: string, password: string) => Promise<void>;
  /**
   * Complete a 2FA-gated sign-in with a TOTP `token` or a `backupCode`. Only
   * valid in the `twoFactor` phase.
   */
  submitTwoFactor: (params: { token?: string; backupCode?: string }) => Promise<void>;
  /** Reset back to the `credentials` step, clearing any error / pending 2FA. */
  reset: () => void;
}

export function useOxySignIn(options: UseOxySignInOptions = {}): UseOxySignInResult {
  const ctx = useWebOxyOptional();
  const oxyServices = options.oxyServices ?? ctx?.oxyServices;
  const onAuthenticated =
    options.onAuthenticated ?? (ctx ? ctx.commitSignInSession : undefined);

  // A localStorage-backed store instance, used ONLY to read the persisted
  // device-attribution token for the login request (the provider's own store
  // owns writes). Reads fall through to localStorage, so this observes the same
  // token the provider persisted.
  const store = useMemo(() => createWebAuthStateStore(), []);

  const [phase, setPhase] = useState<OxySignInPhase>('credentials');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loginTokenRef = useRef<string | null>(null);
  // Double-submit guard: a synchronous ref (not the async `isSubmitting` state,
  // which is stale inside these callbacks' closures) so a second submit while a
  // request is in flight is dropped rather than firing a duplicate login.
  const submittingRef = useRef(false);
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  // Keep the current phase on failure so the user retries from the right form
  // (credentials vs. 2FA); only surface the error + drop the in-flight flag.
  const fail = useCallback((message: string) => {
    submittingRef.current = false;
    setIsSubmitting(false);
    setError(message);
    onErrorRef.current?.(new Error(message));
  }, []);

  const finish = useCallback(
    async (result: LoginSessionResult, svc: OxyServices) => {
      const accessToken = result.accessToken ?? svc.getAccessToken() ?? '';
      if (!accessToken) {
        fail('Sign-in did not return an access token.');
        return;
      }
      const committed: CommittedSignInSession = {
        sessionId: result.sessionId,
        userId: result.user.id,
        accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
      };
      await onAuthenticatedRef.current?.(committed);
      loginTokenRef.current = null;
      submittingRef.current = false;
      setIsSubmitting(false);
      setPhase('authorized');
    },
    [fail],
  );

  const submitPassword = useCallback(
    async (identifier: string, password: string) => {
      if (submittingRef.current) {
        return;
      }
      if (!oxyServices) {
        fail('Sign-in is unavailable (missing Oxy client).');
        return;
      }
      submittingRef.current = true;
      setError(null);
      setIsSubmitting(true);
      try {
        const deviceToken = (await store.loadDeviceToken()) ?? undefined;
        const result = await oxyServices.passwordSignIn(identifier, password, { deviceToken });
        if ('twoFactorRequired' in result) {
          loginTokenRef.current = result.loginToken;
          submittingRef.current = false;
          setIsSubmitting(false);
          setPhase('twoFactor');
          return;
        }
        await finish(result, oxyServices);
      } catch (err) {
        fail(err instanceof Error ? err.message : 'Sign-in failed.');
      }
    },
    [oxyServices, store, finish, fail],
  );

  const submitTwoFactor = useCallback(
    async (params: { token?: string; backupCode?: string }) => {
      if (submittingRef.current) {
        return;
      }
      const loginToken = loginTokenRef.current;
      if (!oxyServices || !loginToken) {
        fail('Two-factor sign-in is not in progress.');
        return;
      }
      submittingRef.current = true;
      setError(null);
      setIsSubmitting(true);
      try {
        const deviceToken = (await store.loadDeviceToken()) ?? undefined;
        const result = await oxyServices.completeTwoFactorSignIn({
          loginToken,
          token: params.token,
          backupCode: params.backupCode,
          deviceToken,
        });
        await finish(result, oxyServices);
      } catch (err) {
        fail(err instanceof Error ? err.message : 'Two-factor verification failed.');
      }
    },
    [oxyServices, store, finish, fail],
  );

  const reset = useCallback(() => {
    loginTokenRef.current = null;
    submittingRef.current = false;
    setError(null);
    setIsSubmitting(false);
    setPhase('credentials');
  }, []);

  return { phase, error, isSubmitting, submitPassword, submitTwoFactor, reset };
}

import { useEffect, useMemo, useState } from 'react';
import { useOxy } from '@oxyhq/services';
import { KeyManager, logger } from '@oxyhq/core';

export type OnboardingStatus = 'checking' | 'none' | 'in_progress' | 'complete';

export interface OnboardingState {
  status: OnboardingStatus;
  needsAuth: boolean;
  isLoading: boolean;
  hasIdentity: boolean;
  hasUsername: boolean;
}

/**
 * Centralized hook for managing onboarding state.
 *
 * Combines three signals into a single resolved status:
 *   - `KeyManager.hasIdentity()`: identity material in secure storage
 *   - `isAuthenticated`: an active server session exists
 *   - `user.username`: the user has completed the username step
 *
 * Used by:
 *   - `_layout.tsx` for routing decisions (`needsAuth`)
 *   - `(auth)/index.tsx` to redirect existing identities away from the
 *     marketing splash on cold start
 *   - `create-identity.tsx` for flow initialization
 *
 * Correctness invariants:
 *   1. An active session implies identity exists. We never report
 *      `status === 'none'` while `isAuthenticated` is true — that would
 *      flash the welcome screen at returning users when the secure-store
 *      lookup races behind the session restore.
 *   2. `status === 'checking'` only renders while the answer is genuinely
 *      unknown. We never flip BACK to `'checking'` once resolved, which
 *      would cause the blank backdrop to re-flash mid-flow.
 *   3. The KeyManager identity check is re-run when `isAuthenticated`
 *      transitions from `false` to `true` (a fresh sign-in may have
 *      created an identity that the initial check missed). It is NOT
 *      re-run on other auth state changes, since `KeyManager.hasIdentity`
 *      uses an internal cache that is invalidated explicitly by
 *      `createIdentity` and `clearIdentity` — there's no other way for
 *      the answer to change.
 */
export function useOnboardingStatus(): OnboardingState {
  const { user, isAuthenticated, isLoading: oxyLoading } = useOxy();
  const [identityExists, setIdentityExists] = useState<boolean | null>(null);

  // We use a dedicated `isResolving` flag (rather than `identityExists === null`)
  // so a second check triggered by `isAuthenticated` flipping does NOT regress
  // us to "checking" — we keep the previously-resolved value while the next
  // check is in flight. This prevents a backdrop flash on sign-in completion.
  const [isResolving, setIsResolving] = useState(true);

  useEffect(() => {
    if (oxyLoading) return;

    // Read `isAuthenticated` for its side effect of binding into the
    // dependency list. A flip from `false` to `true` (successful sign-in)
    // can create an identity that an earlier `hasIdentity()` call missed,
    // so we must re-check. The value itself is not used in the body —
    // the check below is unconditional. Without this read, Biome's
    // exhaustive-deps rule flags `isAuthenticated` as unnecessary.
    void isAuthenticated;

    let cancelled = false;
    KeyManager.hasIdentity()
      .then((exists) => {
        if (cancelled) return;
        setIdentityExists(exists);
      })
      .catch((error) => {
        // Storage threw — typically a transient keychain unlock issue.
        // Treat as "no identity" so the welcome flow can run, but never
        // silently swallow the error.
        logger.error(
          'useOnboardingStatus: KeyManager.hasIdentity threw',
          error instanceof Error ? error : new Error(String(error)),
          { component: 'useOnboardingStatus' },
        );
        if (cancelled) return;
        setIdentityExists(false);
      })
      .finally(() => {
        if (cancelled) return;
        setIsResolving(false);
      });

    return () => {
      cancelled = true;
    };
  }, [oxyLoading, isAuthenticated]);

  const status = useMemo<OnboardingStatus>(() => {
    // Genuinely unknown — still resolving the initial answer.
    if (oxyLoading || (isResolving && identityExists === null)) {
      return 'checking';
    }

    // INVARIANT: an active session can only exist if identity material is
    // on the device. If `hasIdentity()` said "no" but the session says
    // "authenticated", the storage lookup was a transient false-negative
    // (typical at cold-start before keychain unlock). Trust the session.
    if (isAuthenticated && user) {
      return user.username ? 'complete' : 'in_progress';
    }

    if (!identityExists) {
      return 'none';
    }

    // Identity exists locally but no active session — resume onboarding.
    return 'in_progress';
  }, [identityExists, isResolving, isAuthenticated, user, oxyLoading]);

  const needsAuth = useMemo(() => {
    // The auth gate is platform-agnostic. On web, an unauthenticated visitor
    // is NOT silently parked on `(tabs)` — that produced a redirect deadlock,
    // because `(tabs)/_layout` itself redirects unauthenticated users to
    // `(auth)` while the root layout marked `(auth)` as redirect-away. The two
    // guards bounced off each other and Expo Router settled on rendering no
    // route at all (blank screen, pathname stuck at "/").
    //
    // Web sign-in still happens via FedCM silent SSO (OxyContext runs it on
    // mount). While SSO is in flight `status === 'checking'` keeps us in the
    // auth stack; if it succeeds, `isAuthenticated` flips and `status` becomes
    // `complete`/`in_progress` → `needsAuth` is false → `(tabs)` renders. If it
    // fails, `status` resolves to `none` and the welcome screen renders — a
    // real terminal state instead of an infinite loop.

    // Default to "show auth" while resolving — better to briefly show a
    // blank backdrop inside the auth stack than to flash the tab bar at
    // a user whose session is still being restored.
    if (status === 'checking') {
      return true;
    }

    return status === 'none' || status === 'in_progress';
  }, [status]);

  return {
    status,
    needsAuth,
    isLoading: isResolving || oxyLoading,
    // An active session implies identity exists — keep this in lockstep
    // with the `status` invariant above so consumers that gate on
    // `hasIdentity` (e.g. the redirect in `(auth)/index.tsx`) don't fall
    // out of sync during the transient false-negative window.
    hasIdentity: (isAuthenticated && Boolean(user)) || (identityExists ?? false),
    hasUsername: Boolean(isAuthenticated && user?.username),
  };
}

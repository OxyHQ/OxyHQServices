import { useMemo } from 'react';
import { useOxy } from '@oxyhq/services';
import { useQuery } from '@tanstack/react-query';
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
 * React Query key for the shared local-identity probe. Every consumer of
 * `useOnboardingStatus` reads THIS key, so `KeyManager.hasIdentity()` runs once
 * per app session and all consumers share one deduped result + one loading
 * state. Identity mutations (create / import / delete) invalidate this key at
 * their call sites so the probe re-runs exactly when the answer can change.
 */
export const ONBOARDING_IDENTITY_QUERY_KEY = ['onboarding', 'identity'] as const;

/**
 * Centralized hook for managing onboarding state.
 *
 * Combines three signals into a single resolved status:
 *   - `KeyManager.hasIdentity()`: identity material in secure storage
 *   - `isAuthenticated`: an active server session exists
 *   - `user.username`: the user has completed the username step
 *
 * Used by:
 *   - `_layout.tsx` for routing decisions (`needsAuth`) and splash readiness
 *   - `(auth)/index.tsx` to redirect existing identities away from the
 *     marketing splash on cold start
 *   - `create-identity.tsx` for flow initialization
 *   - `useOnboardingFlow.ts`
 *
 * The `KeyManager.hasIdentity()` probe is a SHARED React Query read
 * (`ONBOARDING_IDENTITY_QUERY_KEY`), so every consumer above shares ONE deduped
 * result and one loading state — no per-component re-probe flashing.
 *
 * Correctness invariants:
 *   1. An active session implies identity exists. We never report
 *      `status === 'none'` while `isAuthenticated` is true — that would
 *      flash the welcome screen at returning users when the secure-store
 *      lookup races behind the session restore.
 *   2. `status === 'checking'` only renders while the answer is genuinely
 *      unknown. We never flip BACK to `'checking'` once resolved: React Query
 *      keeps the previous `data` across invalidation refetches (`staleTime:
 *      Infinity`), so `identityExists` never regresses to `null`.
 *   3. The probe re-runs only when the answer can actually change — i.e. when
 *      an identity mutation invalidates `ONBOARDING_IDENTITY_QUERY_KEY`
 *      (`createIdentity` / `importIdentity` / account deletion). `hasIdentity`
 *      uses an internal cache, so there is no other way for the result to move,
 *      and the session-implies-identity invariant (#1) already covers the
 *      window between a fresh sign-in and the invalidation landing.
 */
export function useOnboardingStatus(): OnboardingState {
  const { user, isAuthenticated, isAuthResolved, isLoading: oxyLoading } = useOxy();

  const identityQuery = useQuery({
    queryKey: ONBOARDING_IDENTITY_QUERY_KEY,
    queryFn: async (): Promise<boolean> => {
      try {
        return await KeyManager.hasIdentity();
      } catch (error) {
        // Storage threw — typically a transient keychain unlock issue. Treat as
        // "no identity" so the welcome flow can run, but never silently swallow
        // the error.
        logger.error(
          'useOnboardingStatus: KeyManager.hasIdentity threw',
          error instanceof Error ? error : new Error(String(error)),
          { component: 'useOnboardingStatus' },
        );
        return false;
      }
    },
    // Defer the keychain read until the SDK provider has finished its initial
    // load; the memo below reports `'checking'` during that window regardless.
    enabled: !oxyLoading,
    // The only things that change the answer are explicit identity mutations,
    // which invalidate the key — so never auto-refetch.
    staleTime: Infinity,
    // `queryFn` already handles a keychain error (→ `false`); never retry.
    retry: false,
  });

  // Map React Query state onto the prior local-probe semantics:
  //   - `identityExists`: `boolean` once resolved, `null` while still unknown.
  //     React Query keeps the previous value across invalidation refetches, so
  //     this never regresses to `null` once resolved (invariant #2).
  //   - `isResolving`: `true` only until the FIRST probe resolves.
  const identityExists: boolean | null = identityQuery.data ?? null;
  const isResolving = identityQuery.data === undefined;

  const status = useMemo<OnboardingStatus>(() => {
    // Genuinely unknown — still resolving the initial answer. `isAuthResolved`
    // flips true only once the SDK's device-first cold boot has concluded
    // (session committed OR definitively signed out) — `runProviderColdBoot`
    // always calls `markAuthResolved()` in its `finally`, so it never hangs.
    // Until then we cannot know whether a returning user's persisted device
    // session will restore, so we stay `'checking'` (neutral backdrop) rather
    // than prematurely reporting `'in_progress'` and bouncing the user through
    // create-identity.
    if (oxyLoading || !isAuthResolved || isResolving) {
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
  }, [identityExists, isResolving, isAuthenticated, isAuthResolved, user, oxyLoading]);

  const needsAuth = useMemo(() => {
    // While the device-first cold boot is unresolved (`status === 'checking'`)
    // we default to showing the auth stack (which renders a neutral backdrop)
    // rather than flashing the tab bar at a user whose persisted device session
    // is still being restored. Once cold boot resolves, `isAuthenticated` drives
    // the outcome: an active session settles `status` to `complete` → tabs;
    // otherwise the user resolves to `none` or `in_progress` → onboarding.
    if (status === 'checking') {
      return true;
    }

    return status === 'none' || status === 'in_progress';
  }, [status]);

  return {
    status,
    needsAuth,
    isLoading: isResolving || oxyLoading || !isAuthResolved,
    // An active session implies identity exists — keep this in lockstep
    // with the `status` invariant above so consumers that gate on
    // `hasIdentity` (e.g. the redirect in `(auth)/index.tsx`) don't fall
    // out of sync during the transient false-negative window.
    hasIdentity: (isAuthenticated && Boolean(user)) || (identityExists ?? false),
    hasUsername: Boolean(isAuthenticated && user?.username),
  };
}

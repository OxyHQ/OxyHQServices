import { useEffect, useMemo } from 'react';
import { useOxy } from '@oxyhq/services';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyManager, logger } from '@oxyhq/core';
import {
  getOnboardingCompleteFromStorage,
  persistOnboardingComplete,
} from './identity/identityStore';

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
 * React Query key for the LOCAL, offline-safe "onboarding complete" milestone
 * (`getOnboardingCompleteFromStorage`). Read once per app session and shared by
 * every consumer. Identity mutations (create / import) invalidate it so it
 * re-reads exactly when the answer can change; genuine online completion writes
 * it directly via `queryClient.setQueryData` below.
 */
export const ONBOARDING_COMPLETE_QUERY_KEY = ['onboarding', 'complete'] as const;

/**
 * Centralized hook for managing onboarding state.
 *
 * Combines four signals into a single resolved status:
 *   - `KeyManager.hasIdentity()`: identity material in secure storage (LOCAL,
 *     offline-safe — a returning user's identity is detected with no network)
 *   - `getOnboardingCompleteFromStorage()`: the LOCAL, offline-safe milestone
 *     that this device finished onboarding for the current identity
 *   - `isAuthenticated`: an active server session exists
 *   - `user.username`: the user has completed the username step
 *
 * LOCAL-FIRST / OFFLINE-SAFE ROUTING (identity-loss guard): identity presence is
 * decided ONLY from the local keystore, and a returning user (local identity +
 * local completion milestone) routes to the vault EVEN WITH ZERO NETWORK. A
 * failed/absent session mint (offline, expired) can NEVER downgrade an existing
 * identity into the "create identity" flow — the create path is reachable only
 * when the local keystore genuinely has no identity. Session restore/mint is a
 * strictly background concern.
 *
 * Used by:
 *   - `_layout.tsx` for routing decisions (`needsAuth`) and splash readiness
 *   - `(auth)/index.tsx` to redirect existing identities away from the
 *     marketing splash on cold start
 *   - `create-identity.tsx` for flow initialization
 *   - `useOnboardingFlow.ts`
 *
 * The `KeyManager.hasIdentity()` probe and the onboarding-complete milestone are
 * SHARED React Query reads (`ONBOARDING_IDENTITY_QUERY_KEY` /
 * `ONBOARDING_COMPLETE_QUERY_KEY`), so every consumer above shares ONE deduped
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
  const queryClient = useQueryClient();

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

  // The LOCAL, offline-safe "onboarding complete" milestone. This is the signal
  // that lets a RETURNING user reach the vault with ZERO network: it is a plain
  // secure-store read (never a network call), so an existing identity is never
  // hidden behind a failed session mint. `getOnboardingCompleteFromStorage`
  // catches its own storage errors (→ `false`), so no wrapper is needed here.
  const completeQuery = useQuery({
    queryKey: ONBOARDING_COMPLETE_QUERY_KEY,
    queryFn: getOnboardingCompleteFromStorage,
    // Mirror the identity probe: defer until the SDK provider settles, and never
    // auto-refetch — the answer only moves on explicit identity mutations (which
    // invalidate the key) or genuine completion (which sets the data directly).
    enabled: !oxyLoading,
    staleTime: Infinity,
    retry: false,
  });

  // Map React Query state onto the prior local-probe semantics:
  //   - `identityExists`: `boolean` once resolved, `null` while still unknown.
  //     React Query keeps the previous value across invalidation refetches, so
  //     this never regresses to `null` once resolved (invariant #2).
  //   - `isResolving`: `true` only until the FIRST probe resolves.
  const identityExists: boolean | null = identityQuery.data ?? null;
  const isResolving = identityQuery.data === undefined;

  // Once resolved this is a stable boolean; `undefined` only while the initial
  // local read is in flight (mirrors `isResolving` above).
  const onboardingComplete: boolean = completeQuery.data ?? false;
  const isCompleteResolving = completeQuery.data === undefined;

  // Persist the monotonic onboarding-complete milestone the moment onboarding
  // genuinely completes ONLINE (a live session whose user has a username). This
  // is what lets the NEXT cold start route a returning user to the vault with no
  // network. Guarded on the cached flag so it writes at most once per identity;
  // `setQueryData` reflects it immediately for the current session. Never clears
  // it here — creation/import own the reset (see `useIdentity`).
  useEffect(() => {
    if (!isAuthenticated || !user?.username) return;
    if (completeQuery.data === true) return;
    void persistOnboardingComplete(true);
    queryClient.setQueryData(ONBOARDING_COMPLETE_QUERY_KEY, true);
  }, [isAuthenticated, user?.username, completeQuery.data, queryClient]);

  const status = useMemo<OnboardingStatus>(() => {
    // Genuinely unknown — still resolving the initial answer. `isAuthResolved`
    // flips true only once the SDK's device-first cold boot has concluded
    // (session committed OR definitively signed out) — `runProviderColdBoot`
    // always calls `markAuthResolved()` in its `finally`, so it never hangs.
    // Until then we cannot know whether a returning user's persisted device
    // session will restore, so we stay `'checking'` (neutral backdrop) rather
    // than prematurely reporting `'in_progress'` and bouncing the user through
    // create-identity.
    if (oxyLoading || !isAuthResolved || isResolving || isCompleteResolving) {
      return 'checking';
    }

    // INVARIANT: an active session can only exist if identity material is
    // on the device. If `hasIdentity()` said "no" but the session says
    // "authenticated", the storage lookup was a transient false-negative
    // (typical at cold-start before keychain unlock). Trust the session.
    if (isAuthenticated && user) {
      return user.username ? 'complete' : 'in_progress';
    }

    // No local identity → genuinely a fresh device. This is the ONLY path to
    // "create identity", and it is decided purely from the LOCAL keystore
    // (`hasIdentity()`), never from a network call.
    if (!identityExists) {
      return 'none';
    }

    // Identity EXISTS locally but there is no live session (e.g. the device is
    // OFFLINE, or the device session simply hasn't restored/minted yet). Decide
    // from the LOCAL onboarding milestone — NEVER from the network:
    //   - onboarding completed before on this device → this is a RETURNING user
    //     whose session is merely absent. Route them to the vault; the
    //     session restore/mint proceeds in the background and must not hide the
    //     local identity. This is the offline-loss fix: a fully-onboarded user
    //     with no connectivity reaches their vault, never the create flow.
    //   - never completed → a first-time onboarding still in progress (identity
    //     generated but username/sync not finished, e.g. an offline create) →
    //     resume the wizard.
    if (onboardingComplete) {
      return 'complete';
    }
    return 'in_progress';
  }, [
    identityExists,
    isResolving,
    isCompleteResolving,
    onboardingComplete,
    isAuthenticated,
    isAuthResolved,
    user,
    oxyLoading,
  ]);

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
    isLoading: isResolving || isCompleteResolving || oxyLoading || !isAuthResolved,
    // An active session implies identity exists — keep this in lockstep
    // with the `status` invariant above so consumers that gate on
    // `hasIdentity` (e.g. the redirect in `(auth)/index.tsx`) don't fall
    // out of sync during the transient false-negative window.
    hasIdentity: (isAuthenticated && Boolean(user)) || (identityExists ?? false),
    hasUsername: Boolean(isAuthenticated && user?.username),
  };
}

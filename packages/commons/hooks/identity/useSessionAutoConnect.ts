import { useEffect, useRef, useState } from 'react';
import { logger } from '@oxyhq/core';
import {
  createCircuitBreakerState,
  recordFailure,
  recordSuccess,
  type CircuitBreakerState,
} from './reconnectPolicy';
import { useSessionConnectStore } from './sessionConnectStore';

export interface SessionAutoConnectInput {
  /** The SDK's device-first cold boot has settled (`true`) or is still resolving. */
  isAuthResolved: boolean;
  /** A live session's user is present. */
  hasUser: boolean;
  /**
   * Onboarding is complete (`!needsAuth`) — i.e. a RETURNING user in the vault,
   * NOT someone mid create/import. Gating on this keeps auto-connect from racing
   * the onboarding flow's own register + sign-in for the freshly-made identity.
   */
  onboardingComplete: boolean;
  /** A healthy local identity key pair is present on this device. */
  identityPresent: boolean;
  /** The device currently has network connectivity. */
  online: boolean;
  /**
   * The vault's single-flight identity sync (`useIdentity().syncIdentity` —
   * register-if-needed + key sign-in with the device's PRIMARY key). It already
   * serializes via the global sync lock; the guards below stop this hook from
   * launching a second concurrent attempt on effect re-fires.
   */
  syncIdentity: () => Promise<unknown>;
}

/**
 * Auto-connects the vault's session from its OWN identity key — zero taps.
 *
 * Commons IS the identity; it must never ask its owner to "sign in". The
 * local-first router deliberately lands a returning user in the vault the moment
 * a healthy local identity is present, WITHOUT waiting on the network — so the
 * app can boot with `identityPresent === true`, `isAuthResolved === true`, and no
 * live session (the device-first cold boot's shared-key step signs in from the
 * SHARED slot, which can be absent / stale / a different identity than THIS
 * device's primary — it is not the authoritative path for the vault itself).
 * Nothing else triggers the vault's own key sign-in at boot; this hook is that
 * trigger.
 *
 * When `isAuthResolved && !hasUser && onboardingComplete && identityPresent &&
 * online`, it calls the existing `syncIdentity()` exactly once (ref-guarded
 * against effect re-fires and strict-mode double-invocation). On failure it backs
 * off on the SHARED `reconnectPolicy` circuit-breaker schedule and retries while
 * online; offline it stands down until connectivity returns (a precondition flip
 * re-runs the driver). A manual retry (the `SessionGate` "Retry" action, via the
 * store's `retryNonce`) jumps the backoff queue. Progress is published to
 * {@link useSessionConnectStore} so the gate can render the matching state.
 *
 * Mount ONCE at app boot (see `AppStackContent`).
 */
export function useSessionAutoConnect(input: SessionAutoConnectInput): void {
  const { isAuthResolved, hasUser, onboardingComplete, identityPresent, online, syncIdentity } =
    input;

  const retryNonce = useSessionConnectStore((state) => state.retryNonce);
  const setPhase = useSessionConnectStore((state) => state.setPhase);

  const shouldConnect =
    isAuthResolved && !hasUser && onboardingComplete && identityPresent && online;

  // Keep the latest `syncIdentity` in a ref so the driver effect stays keyed on
  // the connect conditions + retry signals only — a new `syncIdentity` identity
  // (useIdentity re-derives it when its own sync flag flips) must not tear down
  // an in-flight attempt.
  const syncIdentityRef = useRef(syncIdentity);
  useEffect(() => {
    syncIdentityRef.current = syncIdentity;
  }, [syncIdentity]);

  // `attemptingRef` — an attempt is in-flight (or its session is landing).
  // `backoffRef` — the last attempt failed and we are holding for the scheduled
  // retry. Together they stop a re-render / strict-mode double-invoke from
  // launching a second concurrent attempt.
  const attemptingRef = useRef(false);
  const backoffRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breakerRef = useRef<CircuitBreakerState>(createCircuitBreakerState());
  const lastNonceRef = useRef(retryNonce);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    // A manual retry (SessionGate "Retry") jumps the backoff queue: drop the
    // pending timer + hold and reset the backoff schedule so the attempt below
    // fires immediately.
    if (retryNonce !== lastNonceRef.current) {
      lastNonceRef.current = retryNonce;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      backoffRef.current = false;
      breakerRef.current = recordSuccess(breakerRef.current);
    }

    // A live session is up: the vault is connected. Reset every guard so a later
    // sign-out (session invalidation) re-arms auto-connect from scratch.
    if (hasUser) {
      attemptingRef.current = false;
      backoffRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      breakerRef.current = recordSuccess(breakerRef.current);
      setPhase('idle');
      return;
    }

    // Preconditions unmet (still cold-booting / mid-onboarding / no local keys /
    // offline): stand down. A precondition flip (e.g. offline→online) re-runs
    // this effect and resumes.
    if (!shouldConnect) return;
    // Already attempting, or holding for a scheduled backoff retry.
    if (attemptingRef.current || backoffRef.current) return;

    attemptingRef.current = true;
    setPhase('connecting');
    // Field-debugging breadcrumb (no secrets): the attempt is starting.
    logger.info('[commons] vault auto-connect: attempt starting', {
      component: 'useSessionAutoConnect',
    });

    void (async () => {
      try {
        await syncIdentityRef.current();
        // Success plants the session; `hasUser` flips on a following render and
        // the reset branch above runs. Leave `attemptingRef` TRUE until then so
        // no second attempt fires in the interim. Clear the breaker now.
        breakerRef.current = recordSuccess(breakerRef.current);
      } catch (error) {
        attemptingRef.current = false;
        backoffRef.current = true;
        breakerRef.current = recordFailure(breakerRef.current);
        setPhase('error');
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          backoffRef.current = false;
          // Re-run the driver; it re-checks the (possibly changed) conditions.
          setRetryTick((tick) => tick + 1);
        }, breakerRef.current.currentInterval);
        // Field-debugging breadcrumb (error message only — no secrets).
        logger.warn('[commons] vault auto-connect: attempt failed; scheduling retry', {
          component: 'useSessionAutoConnect',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [shouldConnect, hasUser, retryNonce, retryTick, setPhase]);

  // Clear any pending retry timer on unmount.
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);
}

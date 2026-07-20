import React from 'react';
import { Redirect } from 'expo-router';
import { useOxy, useOnlineStatus } from '@oxyhq/services';
import { useTranslation } from '@/lib/i18n';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useSessionConnectStore } from '@/hooks/identity/sessionConnectStore';
import { CenteredState } from './centered-state';
import { PrimaryButton } from './action-button';

interface SessionGateProps {
  /** The session-dependent content, rendered only once a live session is up. */
  children: React.ReactNode;
}

/**
 * Gate for vault screens whose data hangs off the current SESSION.
 *
 * Every civic/identity data screen keys its React Query calls on the signed-in
 * user's id (`user?.id ?? getCurrentUserId()`). With no session that id is
 * `null`, so those queries stay permanently `enabled: false` — which React Query
 * reports as `isPending: true` forever, i.e. an infinite spinner. Commons
 * legitimately reaches the vault without a live session: the local-first router
 * lands a returning user here the moment a healthy local identity is present,
 * without waiting on the network.
 *
 * Commons IS the identity — it NEVER asks its owner to "sign in". `AppStackContent`
 * mounts `useSessionAutoConnect`, which connects the session from the device's OWN
 * primary key with zero taps whenever the network allows. This gate renders the
 * matching state until that lands:
 *   - cold boot still resolving (`!isAuthResolved`) → a bounded neutral spinner;
 *   - live session → the children (their `isPending` is now a real fetch);
 *   - no session, connecting/idle → "Connecting your identity…" spinner;
 *   - no session, offline → a calm "offline, will reconnect" notice (no button —
 *     the auto-connector resumes on its own);
 *   - no session, the last auto-connect failed → a "couldn't connect" state with
 *     a Retry that jumps the backoff queue;
 *   - no local identity at all (impossible past the root onboarding gate) → route
 *     to onboarding, never a sign-in prompt.
 */
export function SessionGate({ children }: SessionGateProps) {
  const { isAuthResolved, user } = useOxy();
  const online = useOnlineStatus();
  const { identityPresent, status } = useOnboardingStatus();
  const phase = useSessionConnectStore((state) => state.phase);
  const requestRetry = useSessionConnectStore((state) => state.requestRetry);
  const { t } = useTranslation();

  // Cold boot still resolving → bounded neutral spinner.
  if (!isAuthResolved) {
    return <CenteredState loading body={t('civic.sessionGate.connecting')} />;
  }

  // A live session is up → the private content.
  if (user) {
    return <>{children}</>;
  }

  // No session. Defensive: if the local identity is somehow absent (impossible
  // past the root onboarding gate), route to onboarding rather than spin — never
  // a sign-in prompt. Never redirect on the transient probe-resolving window.
  if (!identityPresent) {
    if (status === 'checking') {
      return <CenteredState loading body={t('civic.sessionGate.connecting')} />;
    }
    return <Redirect href="/(auth)" />;
  }

  // Offline: the auto-connector stands down until connectivity returns. Say so
  // calmly — it reconnects on its own, so there is no action to offer.
  if (!online) {
    return (
      <CenteredState
        icon="cloud-off-outline"
        title={t('civic.sessionGate.offline.title')}
        body={t('civic.sessionGate.offline.body')}
      />
    );
  }

  // The last auto-connect attempt failed and the connector is backing off → let
  // the owner retry now (the Retry action jumps the backoff queue).
  if (phase === 'error') {
    return (
      <CenteredState
        icon="wifi-alert"
        title={t('civic.sessionGate.error.title')}
        body={t('civic.sessionGate.error.body')}
        action={
          <PrimaryButton label={t('common.retry')} onPress={requestRetry} fullWidth={false} />
        }
      />
    );
  }

  // Connecting the session from the device's own identity key.
  return <CenteredState loading body={t('civic.sessionGate.connecting')} />;
}

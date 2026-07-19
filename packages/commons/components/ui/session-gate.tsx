import React from 'react';
import { useOxy } from '@oxyhq/services';
import { useTranslation } from '@/lib/i18n';
import { CenteredState } from './centered-state';
import { PrimaryButton } from './action-button';

interface SessionGateProps {
  /** The session-dependent content, rendered only once a signed-in user resolves. */
  children: React.ReactNode;
}

/**
 * Gate for screens whose data hangs off the current SESSION.
 *
 * Every civic/identity data screen keys its React Query calls on the signed-in
 * user's id (`user?.id ?? oxyServices.getCurrentUserId()`). With no session that
 * id is `null`, so those queries stay permanently `enabled: false` — which React
 * Query v5 reports as `isPending: true` with `fetchStatus: 'idle'` forever, i.e.
 * an infinite spinner. Commons legitimately reaches these screens without a live
 * session: a returning user whose local identity is present passes the onboarding
 * gate into `(tabs)` while the SDK's device-first cold boot is still minting — or
 * has failed to mint (offline) — the session.
 *
 * This turns that dead state into a real one:
 *   - cold boot still resolving (`!isAuthResolved`) → a bounded neutral spinner
 *     (the SDK cold boot is deadline-bounded, so this genuinely ends);
 *   - resolved with no user → a "sign in to continue" state that opens the SDK
 *     sign-in dialog;
 *   - resolved with a user → the children (whose own `isPending` is now a real
 *     in-flight fetch, since the query is enabled).
 */
export function SessionGate({ children }: SessionGateProps) {
  const { isAuthResolved, user, openAccountDialog } = useOxy();
  const { t } = useTranslation();

  if (!isAuthResolved) {
    return <CenteredState loading body={t('civic.sessionGate.connecting')} />;
  }

  if (!user) {
    return (
      <CenteredState
        icon="account-lock-outline"
        title={t('civic.sessionGate.title')}
        body={t('civic.sessionGate.body')}
        action={
          <PrimaryButton
            label={t('civic.sessionGate.cta')}
            onPress={() => openAccountDialog('signin')}
            fullWidth={false}
          />
        }
      />
    );
  }

  return <>{children}</>;
}

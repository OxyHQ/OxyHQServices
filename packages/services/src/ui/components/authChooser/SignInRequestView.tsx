/**
 * The ACTIVE REQUEST surface (`qr` view) — the route Oxy chose, plus honest
 * progress (issue #691, Phase 5).
 *
 * The user already performed their one action. From here the surface only
 * REPORTS: the route-appropriate primary visual (`RequestPrimarySurface`), the
 * status line derived from the controller's real signals
 * (`signInProgressLabel`), and nothing else at the same weight. Alternatives
 * stay behind "Having trouble?" until `signIn.routeFailed` says the chosen route
 * could not be carried out — the controller never silently cascades, so
 * revealing them is this view's decision and this view's alone.
 *
 * Two surfaces take over when there is no working primary route to report on:
 *  - a FAILED request, whose reason is toasted by the container (never inline),
 *    leaves "Try again" as the primary action with the alternatives revealed;
 *  - a native device with NO Commons installed, where a same-device QR would be
 *    a dead end. There, "Get Commons" is the genuine primary route — not a
 *    fallback — so it renders as the one primary action and the QR handoff moves
 *    behind the disclosure ("I have Commons on another device").
 */

import type React from 'react';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@oxyhq/bloom/button';
import { Text } from '@oxyhq/bloom/typography';
import type { AccountDialogSnapshot } from '@oxyhq/core';
import TroubleDisclosure, { type TroubleAction } from './TroubleDisclosure';
import { SubtleLink } from './primitives';
import { GetCommonsPrompt, RequestPrimarySurface } from './requestSurfaces';
import { signInProgressLabel } from './signInProgress';
import { authChooserStyles as styles } from './styles';
import type { SignInAlternatives, Theme, Translate } from './types';

interface SignInRequestViewProps {
  snapshot: AccountDialogSnapshot;
  theme: Theme;
  t: Translate;
  /** Restart the request after a failure. */
  onRetry: () => void;
  alternatives: SignInAlternatives;
}

const SignInRequestView: React.FC<SignInRequestViewProps> = ({
  snapshot,
  theme,
  t,
  onRetry,
  alternatives,
}) => {
  const { signIn, commonsAvailability } = snapshot;
  // Set only from the disclosure's own "I have Commons on another device" —
  // an explicit user choice to leave the acquisition surface, never inferred.
  const [qrRequested, setQrRequested] = useState(false);

  // A ceremony is pointless once the request is already being confirmed, and a
  // ceremony FAILURE is toasted by the container — this link never renders an
  // error of its own (owner mandate).
  const passkeyAction: TroubleAction[] =
    alternatives.passkeyAvailable && signIn.phase !== 'authorized' && signIn.phase !== 'completed'
      ? [
          {
            key: 'passkey-signin-link',
            label: alternatives.passkeyPending
              ? t('accountSwitcher.passkeySigningIn')
              : t('accountSwitcher.useIdentityOnDevice'),
            onPress: alternatives.onSignInWithPasskey,
            disabled: alternatives.passkeyPending,
          },
        ]
      : [];

  const signUpLink = (
    // Account CREATION is not an authentication method, and on web this surface
    // is the FIRST one a signed-out user sees (the entry auto-starts straight
    // through it) — so the way in for someone with no Oxy ID stays visible as a
    // subordinate link rather than hiding behind a troubleshooting affordance.
    <SubtleLink
      label={t('signin.createAccountLink')}
      theme={theme}
      onPress={alternatives.onCreateAccount}
      testID="create-account-link"
    />
  );

  if (signIn.phase === 'error') {
    return (
      <View style={styles.centeredBlock}>
        <Button variant="primary" onPress={onRetry} style={styles.primaryButton}>
          {t('common.actions.tryAgain')}
        </Button>
        {signUpLink}
        <TroubleDisclosure actions={passkeyAction} revealed theme={theme} t={t} />
      </View>
    );
  }

  if (commonsAvailability === 'unavailable' && !qrRequested) {
    return (
      <View style={styles.centeredBlock}>
        <GetCommonsPrompt theme={theme} t={t} onGetCommons={alternatives.onGetCommons} />
        {signUpLink}
        <TroubleDisclosure
          actions={[
            {
              key: 'show-qr-anyway-link',
              label: t('accountSwitcher.showQrAnyway'),
              onPress: () => setQrRequested(true),
            },
            ...passkeyAction,
          ]}
          revealed={false}
          theme={theme}
          t={t}
        />
      </View>
    );
  }

  const status = signInProgressLabel(signIn.progress, signIn.route, t);
  const troubleActions: TroubleAction[] = [
    // Redundant while the QR already IS the primary surface.
    ...(signIn.route === 'qr'
      ? []
      : [
          {
            key: 'scan-qr-link',
            label: t('accountSwitcher.scanQr'),
            onPress: alternatives.onShowQr,
          },
        ]),
    ...passkeyAction,
    {
      key: 'get-commons-link',
      label: t('accountSwitcher.getCommons'),
      onPress: alternatives.onGetCommons,
    },
  ];

  return (
    <View style={styles.centeredBlock}>
      <RequestPrimarySurface signIn={signIn} theme={theme} t={t} />
      {status ? (
        <Text
          style={[styles.mutedText, { color: theme.colors.textSecondary }]}
          accessibilityLiveRegion="polite"
          testID="signin-progress"
        >
          {status}
        </Text>
      ) : null}
      {signUpLink}
      <TroubleDisclosure
        actions={troubleActions}
        revealed={signIn.routeFailed}
        theme={theme}
        t={t}
      />
    </View>
  );
};

export default SignInRequestView;

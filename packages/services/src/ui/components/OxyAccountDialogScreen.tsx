/**
 * OxyAccountDialogScreen — the ONE unified account dialog BODY for `@oxyhq/services`.
 *
 * The header (title/subtitle per view + back button) around the headless chooser
 * logic, which lives in `OxyAuthChooser` — the account switcher, sign-in,
 * sign-up, and QR views are ALL there, extracted so the same chooser can be
 * mounted bare by a future host with no Dialog chrome (e.g. an auth.oxy.so hub
 * page driving the cross-origin passkey popup, b2). This file owns ONLY the
 * header + the scroll body.
 *
 * It is presented as the `AccountDialog` route on the shared Bloom SURFACE STACK
 * (`@oxyhq/bloom/surfaces`) — `OxyContext.openAccountDialog` calls
 * `presentDetached('AccountDialog', …, { placement: { base: 'bottom', md:
 * 'center' }, dismissOnBackdrop: false, maxWidth: 420 })`, so the STACK owns the
 * responsive `<Dialog>` chrome and this component renders only its content. That
 * replaces the previous standalone controlled `<Dialog open={isAccountDialogOpen}>`
 * mount: dismissal now flows through the stack (backdrop/swipe disabled), and the
 * header close button (and `OxyAuthChooser`'s `onComplete`) drive
 * `useOxy().closeAccountDialog`, which dismisses the surface and runs its exit
 * animation. The view-enum (`accounts|signin|qr|add|signup`) stays internal here,
 * driven by the shared `AccountDialogController` in `@oxyhq/core`.
 */

import type React from 'react';
import { useCallback, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import type { AccountDialogSnapshot } from '@oxyhq/core';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import { useSurfaceHeader } from '../hooks/useSurfaceHeader';
import OxyAuthChooser from './OxyAuthChooser';

type Translate = ReturnType<typeof useI18n>['t'];

/**
 * The unified account dialog BODY — the header + `OxyAuthChooser` chooser.
 *
 * Presented as the `AccountDialog` surface (route) on the shared Bloom surface
 * stack; the surface owns the `<Dialog>` chrome (responsive `{ base: 'bottom',
 * md: 'center' }` placement, `dismissOnBackdrop={false}`, `maxWidth={420}` — set
 * by `OxyContext` when it presents this surface), so this component renders ONLY
 * the content. Open it via `useOxy().openAccountDialog(view?)` or the imperative
 * `openAccountDialog('signin')`; the view-enum (`accounts|signin|qr|add|signup`)
 * stays internal here, driven by the shared `AccountDialogController` in
 * `@oxyhq/core`. Closing routes through `useOxy().closeAccountDialog`, which
 * dismisses the surface and runs its exit animation.
 */
const OxyAccountDialogScreen: React.FC = () => {
  const { accountDialogController: controller, closeAccountDialog } = useOxy();
  const { t } = useI18n();

  // A lightweight, header-only binding to the same controller `OxyAuthChooser`
  // binds independently — cheap, and the established pattern here (
  // `useSwitchableAccounts` also binds to this controller on its own).
  const subscribe = useCallback(
    (listener: () => void) => (controller ? controller.subscribe(listener) : () => undefined),
    [controller],
  );
  const getSnapshot = useCallback(
    () => (controller ? controller.getSnapshot() : EMPTY_SNAPSHOT),
    [controller],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const { view } = snapshot;
  const showBack =
    view === 'qr' || view === 'signup' || (view === 'add' && snapshot.accounts.length > 0);
  const goToAccounts = useCallback(() => controller?.setView('accounts'), [controller]);
  const { title, subtitle } = headerCopy(view, snapshot.accounts.length, t);

  // The account dialog uses the SHARED Dialog nav header like every other screen
  // (the base): the large in-content title/subtitle that collapses into the nav
  // bar on scroll (default `largeTitle`), its per-view copy, and a per-view back
  // that returns to the account list (the Dialog renders the frosted back/close).
  useSurfaceHeader({
    title,
    subtitle: subtitle ?? undefined,
    onBack: showBack ? goToAccounts : undefined,
  });

  if (!controller) {
    return null;
  }

  return (
    <View style={styles.bodyContent}>
      <OxyAuthChooser onComplete={closeAccountDialog} />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Copy + helpers
// ---------------------------------------------------------------------------

function headerCopy(
  view: AccountDialogSnapshot['view'],
  accountCount: number,
  t: Translate,
): { title: string; subtitle: string | null } {
  switch (view) {
    case 'accounts':
      return {
        title: t('accountSwitcher.sections.yourAccounts') || 'Your accounts',
        subtitle: t('signin.chooser.subtitle') || 'Choose which account to continue with.',
      };
    case 'qr':
      return {
        title: t('accountSwitcher.scanTitle') || 'Sign in with Oxy',
        subtitle: t('accountSwitcher.scanSubtitle') || 'Scan with Commons on your phone.',
      };
    case 'signup':
      return {
        title: t('signup.title') || 'Create your account',
        subtitle: t('signup.subtitle') || 'One identity for the whole ecosystem.',
      };
    default:
      return accountCount > 0
        ? {
            title: t('signin.addAccountTitle') || 'Add another account',
            subtitle: t('signin.addAccountSubtitle') || 'Sign in with another account.',
          }
        : {
            title: t('signin.title') || 'Sign in',
            subtitle: t('signin.subtitle') || 'One identity for the whole ecosystem.',
          };
  }
}

const EMPTY_SNAPSHOT: AccountDialogSnapshot = {
  view: 'accounts',
  accounts: [],
  activeAccountId: null,
  loading: false,
  error: null,
  switchingAccountId: null,
  signIn: { phase: 'idle', authorizeCode: null, qrPayload: null, expiresAt: null, error: null },
  commonsAvailability: 'unknown',
};

const styles = StyleSheet.create({
  bodyContent: {
    paddingTop: 4,
    paddingBottom: 4,
  },
});

export default OxyAccountDialogScreen;

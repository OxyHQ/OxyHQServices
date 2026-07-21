/**
 * OxyAccountDialog — the ONE unified account dialog BODY for `@oxyhq/services`.
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
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import type { AccountDialogSnapshot } from '@oxyhq/core';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import OxyAuthChooser from './OxyAuthChooser';
import { LogoIcon } from './logo/LogoIcon';

type Theme = ReturnType<typeof useTheme>;
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
const OxyAccountDialog: React.FC = () => {
  const { accountDialogController: controller, closeAccountDialog } = useOxy();
  const theme = useTheme();
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

  if (!controller) {
    return null;
  }

  const { view } = snapshot;
  const showBack =
    view === 'qr' || view === 'signup' || (view === 'add' && snapshot.accounts.length > 0);

  return (
    <>
      <DialogHeader
        snapshot={snapshot}
        theme={theme}
        t={t}
        showBack={showBack}
        onBack={() => controller.setView('accounts')}
        onClose={closeAccountDialog}
      />
      <View style={styles.bodyContent}>
        <OxyAuthChooser onComplete={closeAccountDialog} />
      </View>
    </>
  );
};

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface HeaderProps {
  snapshot: AccountDialogSnapshot;
  theme: Theme;
  t: Translate;
  showBack: boolean;
  onBack: () => void;
  onClose: () => void;
}

const DialogHeader: React.FC<HeaderProps> = ({ snapshot, theme, t, showBack, onBack, onClose }) => {
  const { title, subtitle } = headerCopy(snapshot.view, snapshot.accounts.length, t);
  return (
    <View style={styles.header}>
      <View style={styles.headerBar}>
        {showBack ? (
          <Pressable
            onPress={onBack}
            style={[styles.iconButton, { backgroundColor: theme.colors.backgroundSecondary }]}
            accessibilityRole="button"
            accessibilityLabel={t('common.actions.back') || 'Back'}
          >
            <MaterialCommunityIcons name="chevron-left" size={22} color={theme.colors.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
        <LogoIcon height={34} color={theme.colors.primary} />
        <Pressable
          onPress={onClose}
          style={[styles.iconButton, { backgroundColor: theme.colors.backgroundSecondary }]}
          accessibilityRole="button"
          accessibilityLabel={t('common.actions.close') || 'Close'}
        >
          <MaterialCommunityIcons name="close" size={20} color={theme.colors.textSecondary} />
        </Pressable>
      </View>
      <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
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
  header: {
    alignItems: 'center',
    marginBottom: 12,
  },
  headerBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 4,
  },
  bodyContent: {
    paddingTop: 4,
    paddingBottom: 4,
  },
});

export default OxyAccountDialog;

/**
 * OxyAccountDialog — the ONE unified account dialog for `@oxyhq/services`.
 *
 * Bloom `<Dialog>` chrome (header, back button, placement, scroll body) around
 * the headless chooser logic, which lives in `OxyAuthChooser` — the account
 * switcher, sign-in, sign-up, and QR views are ALL there, extracted so the
 * same chooser can be mounted bare by a future host with no Dialog chrome
 * (e.g. an auth.oxy.so hub page driving the cross-origin passkey popup, b2).
 * This file owns ONLY the chrome: the title/subtitle per view, the back
 * button, and the Bloom `<Dialog>` surface itself.
 *
 * The surface is Bloom's `<Dialog>` (`@oxyhq/bloom/dialog`) with a responsive
 * `placement` — a bottom sheet on narrow viewports, a centered card on wide ones.
 * It REPLACES the hand-rolled RN `<Modal>` + `<GestureHandlerRootView>` + manual
 * backdrop/card wrapper this component used before. That RN `<Modal>` is invisible
 * under React StrictMode on web: react-native-web's `ModalPortal` appends its host
 * node during render but removes it in an effect cleanup and never re-attaches, so
 * the dialog never paints in a dev Vite build. Bloom's `<Dialog>` renders through
 * its own Portal and has no such lifecycle hazard.
 *
 * Open/close is CONTROLLED by `isAccountDialogOpen` (the `open` prop); the Dialog
 * stays mounted whenever the controller exists so it can animate its own close.
 * Backdrop / swipe-to-dismiss is disabled (`dismissOnBackdrop={false}`) on purpose:
 * Bloom's controlled `bottom` placement does not fire `onClose` on a gesture or
 * backdrop dismissal, so allowing it would desync `isAccountDialogOpen` from the
 * sheet and block reopening. The header close button (and `OxyAuthChooser`'s
 * `onComplete`) drive `closeAccountDialog`, which flips `open` and runs the exit
 * animation.
 */

import type React from 'react';
import { useCallback, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Dialog } from '@oxyhq/bloom/dialog';
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
 * The unified account dialog. Mounted once by `OxyProvider`; opened imperatively
 * via `useOxy().openAccountDialog(view?)` or imperative `openAccountDialog('signin')`.
 */
const OxyAccountDialog: React.FC = () => {
  const { accountDialogController: controller, isAccountDialogOpen, closeAccountDialog } = useOxy();
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
    <Dialog
      open={isAccountDialogOpen}
      onClose={closeAccountDialog}
      placement={{ base: 'bottom', md: 'center' }}
      dismissOnBackdrop={false}
      maxWidth={420}
      label={headerCopy(view, snapshot.accounts.length, t).title}
    >
      <DialogHeader
        snapshot={snapshot}
        theme={theme}
        t={t}
        showBack={showBack}
        onBack={() => controller.setView('accounts')}
        onClose={closeAccountDialog}
      />
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        <OxyAuthChooser onComplete={closeAccountDialog} />
      </ScrollView>
    </Dialog>
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
  body: {
    width: '100%',
  },
  bodyContent: {
    paddingTop: 4,
    paddingBottom: 4,
  },
});

export default OxyAccountDialog;

/**
 * OxyAccountDialog — the ONE unified account dialog for `@oxyhq/services`.
 *
 * A thin React Native binding over the headless `AccountDialogController` in
 * `@oxyhq/core` (bound via `useSyncExternalStore`), presented as a Bloom `<Dialog>`.
 * One surface for account switching and sign-in — data and state machine live in core.
 *
 * Views (from `snapshot.view`):
 *  - `accounts` — the unified `SwitchableAccount[]` list (device sign-ins ∪ graph
 *    accounts). Tapping a row switches through `controller.switchTo(accountId)`
 *    (the uniform switch), the active row is flagged, and a "+ Add account" row
 *    opens the sign-in entry. This is what `ProfileButton` opens.
 *  - `add` / `signin` — the sign-in entry: primary "Sign in with Oxy" (device
 *    flow), "Scan a QR", and a secondary "Use a password" hand-off that opens
 *    auth.oxy.so (password + 2FA are NOT in the SDK).
 *  - `qr` — the cross-device QR handoff + its waiting state.
 *
 * Per-account color re-theming uses Bloom's `APP_COLOR_PRESETS` + `BloomColorScope`
 * (same visual language auth.oxy.so uses). Base theming is `useTheme()` + a
 * `StyleSheet`, so the dialog renders correctly in EVERY consumer — including apps
 * that do not use NativeWind (e.g. the accounts app).
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
 * sheet and block reopening. The header close button (and a successful switch)
 * drive `closeAccountDialog`, which flips `open` and runs the exit animation.
 */

import type React from 'react';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { Avatar } from '@oxyhq/bloom/avatar';
import { Button } from '@oxyhq/bloom/button';
import { Dialog } from '@oxyhq/bloom/dialog';
import { Text } from '@oxyhq/bloom/typography';
import {
  useTheme,
  BloomColorScope,
  APP_COLOR_NAMES,
  APP_COLOR_PRESETS,
  type AppColorName,
} from '@oxyhq/bloom/theme';
import type { SwitchableAccount, AccountDialogSnapshot } from '@oxyhq/core';
import { isOxyRpOrigin } from '@oxyhq/core';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import { isWebBrowser } from '../utils/isWebBrowser';
import { LogoIcon } from './logo/LogoIcon';

/** Diameter of a row avatar. */
const ROW_AVATAR_SIZE = 40;
/** High-contrast QR colors — intentionally fixed (NOT themed) for scan reliability. */
const QR_PLATE_BG = '#FFFFFF';
const QR_FOREGROUND = '#000000';
const QR_SIZE = 196;

/**
 * Resolve an account's stored color (a named Bloom preset, e.g. `'purple'`) to
 * a concrete brand hex for the row accent. Falls back to the theme primary when
 * the account has no color or the value is not a recognized preset, so the accent
 * renders in EVERY consumer regardless of NativeWind availability.
 */
function resolveAccentHex(color: string | null, fallback: string): string {
  const preset = toPreset(color);
  return preset ? APP_COLOR_PRESETS[preset].hex : fallback;
}

/** Narrow a stored color string to a known `AppColorName`, or `undefined`. */
function toPreset(color: string | null): AppColorName | undefined {
  if (!color) return undefined;
  return (APP_COLOR_NAMES as readonly string[]).includes(color)
    ? (color as AppColorName)
    : undefined;
}

interface OxyAccountDialogHandlers {
  onSwitch: (accountId: string) => void;
  onAdd: () => void;
  onManage: () => void;
  onClose: () => void;
}

/**
 * The unified account dialog. Mounted once by `OxyProvider`; opened imperatively
 * via `useOxy().openAccountDialog(view?)` or imperative `openAccountDialog('signin')`.
 */
const OxyAccountDialog: React.FC = () => {
  const {
    accountDialogController: controller,
    isAccountDialogOpen,
    closeAccountDialog,
    showBottomSheet,
    logoutAll,
    refreshAccounts,
    signInWithPasskey,
  } = useOxy();
  const theme = useTheme();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Passkey sign-in is offered ONLY on a first-party Oxy web origin (a credential
  // minted for `oxy.so` can only be asserted there or on a loopback dev host).
  // Off the web / on a non-Oxy origin the button is hidden entirely (a hub popup
  // for arbitrary web origins is a later phase). This is environment-static.
  const passkeyAvailable = useMemo(() => isWebBrowser() && isOxyRpOrigin(), []);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  const handleSignInWithPasskey = useCallback(async () => {
    if (passkeyPending) return;
    setPasskeyPending(true);
    setPasskeyError(null);
    try {
      await signInWithPasskey();
      closeAccountDialog();
    } catch (error) {
      // A cancelled/failed ceremony keeps the dialog open so the user can retry
      // or fall back to another method — surface a concise message, never swallow.
      setPasskeyError(
        error instanceof Error && error.message ? error.message : 'Passkey sign-in failed.',
      );
    } finally {
      setPasskeyPending(false);
    }
  }, [passkeyPending, signInWithPasskey, closeAccountDialog]);

  // Bind the headless controller. `getSnapshot` returns a stable reference
  // between changes, so it is `useSyncExternalStore`-safe. Guard the no-provider
  // loading state (`controller` is `null`) with an inert store.
  const subscribe = useCallback(
    (listener: () => void) => (controller ? controller.subscribe(listener) : () => undefined),
    [controller],
  );
  const getSnapshot = useCallback(
    () => (controller ? controller.getSnapshot() : EMPTY_SNAPSHOT),
    [controller],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [switching, setSwitching] = useState(false);

  const handleSwitch = useCallback(
    async (accountId: string) => {
      if (!controller || switching) return;
      if (accountId === snapshot.activeAccountId) {
        closeAccountDialog();
        return;
      }
      setSwitching(true);
      try {
        await controller.switchTo(accountId);
        // A switch succeeds unless the controller recorded an error. On success
        // reload the app's account graph and drop cached account-scoped data so
        // the new active identity re-fetches — the same side effects the
        // context's own `switchToAccount` performs.
        if (!controller.getSnapshot().error) {
          void refreshAccounts();
          queryClient.invalidateQueries();
          closeAccountDialog();
        }
      } finally {
        setSwitching(false);
      }
    },
    [controller, switching, snapshot.activeAccountId, closeAccountDialog, refreshAccounts, queryClient],
  );

  const handleManage = useCallback(() => {
    closeAccountDialog();
    showBottomSheet?.('ManageAccount');
  }, [closeAccountDialog, showBottomSheet]);

  const handleSignOutAll = useCallback(() => {
    closeAccountDialog();
    void logoutAll();
  }, [closeAccountDialog, logoutAll]);

  const handlers = useMemo<OxyAccountDialogHandlers>(
    () => ({
      onSwitch: (accountId) => {
        void handleSwitch(accountId);
      },
      onAdd: () => controller?.add(),
      onManage: handleManage,
      onClose: closeAccountDialog,
    }),
    [handleSwitch, controller, handleManage, closeAccountDialog],
  );

  if (!controller) {
    return null;
  }

  const { view } = snapshot;
  const showBack = view === 'qr' || (view === 'add' && snapshot.accounts.length > 0);

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
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {view === 'accounts' ? (
          <AccountsView snapshot={snapshot} theme={theme} t={t} handlers={handlers} />
        ) : view === 'qr' ? (
          <QrView snapshot={snapshot} theme={theme} t={t} onRetry={() => void controller.showQr()} />
        ) : (
          <SignInView
            snapshot={snapshot}
            theme={theme}
            t={t}
            handlers={handlers}
            onSignInWithOxy={() => void controller.signInWithOxy()}
            onScanQr={() => void controller.showQr()}
            onSignInWithPasskey={passkeyAvailable ? () => void handleSignInWithPasskey() : undefined}
            passkeyPending={passkeyPending}
            passkeyError={passkeyError}
          />
        )}
      </ScrollView>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

type Theme = ReturnType<typeof useTheme>;
type Translate = ReturnType<typeof useI18n>['t'];

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
// Accounts view
// ---------------------------------------------------------------------------

interface AccountsViewProps {
  snapshot: AccountDialogSnapshot;
  theme: Theme;
  t: Translate;
  handlers: OxyAccountDialogHandlers;
}

const AccountsView: React.FC<AccountsViewProps> = ({ snapshot, theme, t, handlers }) => {
  if (snapshot.loading && snapshot.accounts.length === 0) {
    return (
      <View style={styles.centeredBlock}>
        <MaterialCommunityIcons name="loading" size={24} color={theme.colors.textSecondary} />
        <Text style={[styles.mutedText, { color: theme.colors.textSecondary }]}>
          {t('accountSwitcher.loading') || 'Loading accounts…'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.rows}>
      {snapshot.accounts.map((account) => (
        <AccountRow
          key={account.accountId}
          account={account}
          theme={theme}
          switching={snapshot.switchingAccountId === account.accountId}
          disabled={snapshot.switchingAccountId !== null}
          onPress={() => handlers.onSwitch(account.accountId)}
        />
      ))}

      <Pressable
        style={[styles.addRow, { borderColor: theme.colors.border }]}
        onPress={handlers.onAdd}
        accessibilityRole="button"
        accessibilityLabel={t('signin.addAccountTitle') || 'Add another account'}
      >
        <View style={[styles.addBadge, { borderColor: theme.colors.border }]}>
          <MaterialCommunityIcons name="plus" size={20} color={theme.colors.textSecondary} />
        </View>
        <Text style={[styles.rowName, { color: theme.colors.textSecondary }]}>
          {t('signin.addAccountTitle') || 'Add another account'}
        </Text>
      </Pressable>

      <View style={styles.footerLinks}>
        <Pressable onPress={handlers.onManage} accessibilityRole="button">
          <Text style={[styles.linkText, { color: theme.colors.primary }]}>
            {t('accountMenu.manage') || 'Manage accounts'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

interface AccountRowProps {
  account: SwitchableAccount;
  theme: Theme;
  switching: boolean;
  disabled: boolean;
  onPress: () => void;
}

const AccountRow: React.FC<AccountRowProps> = ({ account, theme, switching, disabled, onPress }) => {
  const accent = resolveAccentHex(account.color, theme.colors.primary);
  const rowStyle: StyleProp<ViewStyle> = [
    styles.accountRow,
    {
      borderColor: account.isCurrent ? accent : theme.colors.border,
      backgroundColor: theme.colors.card,
    },
    disabled && !switching ? styles.rowDisabled : null,
  ];

  return (
    <BloomColorScope colorPreset={toPreset(account.color)} asChild>
      <Pressable
        style={rowStyle}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ selected: account.isCurrent, disabled }}
        accessibilityLabel={account.displayName}
      >
        <View style={[styles.avatarRing, { borderColor: account.isCurrent ? accent : 'transparent' }]}>
          <Avatar
            source={account.avatarUrl ?? undefined}
            variant="thumb"
            name={account.displayName}
            size={ROW_AVATAR_SIZE}
          />
        </View>
        <View style={styles.rowMeta}>
          <Text style={[styles.rowName, { color: theme.colors.text }]} numberOfLines={1}>
            {account.displayName}
          </Text>
          {account.email ? (
            <Text style={[styles.rowHandle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {account.email}
            </Text>
          ) : null}
        </View>
        {switching ? (
          <MaterialCommunityIcons name="loading" size={20} color={accent} />
        ) : account.isCurrent ? (
          <MaterialCommunityIcons name="check-circle" size={20} color={accent} />
        ) : (
          <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.textSecondary} />
        )}
      </Pressable>
    </BloomColorScope>
  );
};

// ---------------------------------------------------------------------------
// Sign-in view (add / signin)
// ---------------------------------------------------------------------------

interface SignInViewProps {
  snapshot: AccountDialogSnapshot;
  theme: Theme;
  t: Translate;
  handlers: OxyAccountDialogHandlers;
  onSignInWithOxy: () => void;
  onScanQr: () => void;
  /** When present, offer a "Sign in with a passkey" button (first-party Oxy web only). */
  onSignInWithPasskey?: () => void;
  passkeyPending: boolean;
  passkeyError: string | null;
}

const SignInView: React.FC<SignInViewProps> = ({
  snapshot,
  theme,
  t,
  handlers,
  onSignInWithOxy,
  onScanQr,
  onSignInWithPasskey,
  passkeyPending,
  passkeyError,
}) => (
  <View style={styles.signInBlock}>
    {snapshot.accounts.length > 0 ? (
      <View style={styles.rows}>
        {snapshot.accounts.map((account) => (
          <AccountRow
            key={account.accountId}
            account={account}
            theme={theme}
            switching={snapshot.switchingAccountId === account.accountId}
            disabled={snapshot.switchingAccountId !== null}
            onPress={() => handlers.onSwitch(account.accountId)}
          />
        ))}
        <Dividerish theme={theme} label={t('signin.or') || 'or'} />
      </View>
    ) : null}

    <Button variant="primary" onPress={onSignInWithOxy} style={styles.primaryButton}>
      Sign in with Oxy
    </Button>

    {onSignInWithPasskey ? (
      <Button
        variant="secondary"
        onPress={onSignInWithPasskey}
        disabled={passkeyPending}
        style={styles.secondaryButton}
        testID="passkey-signin-button"
      >
        {passkeyPending
          ? t('accountSwitcher.passkeySigningIn') || 'Signing in…'
          : t('accountSwitcher.signInWithPasskey') || 'Sign in with a passkey'}
      </Button>
    ) : null}

    {passkeyError ? (
      <Text style={[styles.errorText, { color: theme.colors.error }]}>{passkeyError}</Text>
    ) : null}

    <Button variant="secondary" onPress={onScanQr} style={styles.secondaryButton}>
      {t('accountSwitcher.scanQr') || 'Scan a QR from another device'}
    </Button>
  </View>
);

const Dividerish: React.FC<{ theme: Theme; label: string }> = ({ theme, label }) => (
  <View style={styles.dividerRow}>
    <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
    <Text style={[styles.dividerText, { color: theme.colors.textSecondary }]}>{label}</Text>
    <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
  </View>
);

// ---------------------------------------------------------------------------
// QR view
// ---------------------------------------------------------------------------

interface QrViewProps {
  snapshot: AccountDialogSnapshot;
  theme: Theme;
  t: Translate;
  onRetry: () => void;
}

const QrView: React.FC<QrViewProps> = ({ snapshot, theme, t, onRetry }) => {
  const { signIn } = snapshot;

  if (signIn.phase === 'error') {
    return (
      <View style={styles.centeredBlock}>
        <Text style={[styles.errorText, { color: theme.colors.error }]}>
          {signIn.error || 'Sign-in failed. Please try again.'}
        </Text>
        <Button variant="secondary" onPress={onRetry} style={styles.secondaryButton}>
          {t('common.actions.tryAgain') || 'Try again'}
        </Button>
      </View>
    );
  }

  if (signIn.phase === 'starting' || signIn.phase === 'authorized' || !signIn.qrPayload) {
    const label =
      signIn.phase === 'authorized'
        ? t('signin.status.signingIn') || 'Signing in…'
        : t('accountSwitcher.loading') || 'Preparing sign-in…';
    return (
      <View style={styles.centeredBlock}>
        <MaterialCommunityIcons name="loading" size={26} color={theme.colors.primary} />
        <Text style={[styles.mutedText, { color: theme.colors.textSecondary }]}>{label}</Text>
      </View>
    );
  }

  return (
    <View style={styles.centeredBlock}>
      <View style={styles.qrPlate}>
        <QRCode value={signIn.qrPayload} size={QR_SIZE} backgroundColor={QR_PLATE_BG} color={QR_FOREGROUND} />
      </View>
      <Text style={[styles.mutedText, { color: theme.colors.textSecondary }]}>
        {t('accountSwitcher.scanWithOxy') || 'Scan with any Oxy app and approve.'}
      </Text>
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
        title: t('accountSwitcher.scanTitle') || 'Scan with Oxy',
        subtitle: t('accountSwitcher.scanSubtitle') || 'Approve from your phone.',
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

/** Current document URL on web; `undefined` where `location` is absent. */
function currentHref(): string | undefined {
  const location = (globalThis as { location?: { href?: string } }).location;
  return typeof location?.href === 'string' ? location.href : undefined;
}

const EMPTY_SNAPSHOT: AccountDialogSnapshot = {
  view: 'accounts',
  accounts: [],
  activeAccountId: null,
  loading: false,
  error: null,
  switchingAccountId: null,
  signIn: { phase: 'idle', authorizeCode: null, qrPayload: null, expiresAt: null, error: null },
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
  rows: {
    width: '100%',
    gap: 8,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rowDisabled: {
    opacity: 0.6,
  },
  avatarRing: {
    borderRadius: 9999,
    borderWidth: 2,
    padding: 1,
  },
  rowMeta: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowHandle: {
    fontSize: 12.5,
    marginTop: 1,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  addBadge: {
    width: ROW_AVATAR_SIZE,
    height: ROW_AVATAR_SIZE,
    borderRadius: 9999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLinks: {
    alignItems: 'center',
    marginTop: 16,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  signInBlock: {
    width: '100%',
  },
  primaryButton: {
    width: '100%',
    borderRadius: 14,
    marginTop: 8,
  },
  secondaryButton: {
    width: '100%',
    borderRadius: 14,
    marginTop: 10,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  mutedText: {
    fontSize: 14,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  qrPlate: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: QR_PLATE_BG,
  },
});

export default OxyAccountDialog;

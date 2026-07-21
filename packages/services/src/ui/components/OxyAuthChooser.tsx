/**
 * OxyAuthChooser — the account switcher + sign-in/sign-up surface, WITHOUT
 * any dialog chrome.
 *
 * A thin React Native binding over the headless `AccountDialogController` in
 * `@oxyhq/core` (bound via `useSyncExternalStore`) — the same data/state
 * machine {@link OxyAccountDialogScreen} renders, extracted so it can be mounted in
 * TWO places: wrapped in Bloom's `<Dialog>` by `OxyAccountDialogScreen` (the normal
 * in-app surface), and mounted bare by a future auth.oxy.so hub page for the
 * cross-origin passkey popup (b2) — same chooser, two hosts, two completion
 * strategies via the `onComplete` prop. Neither host duplicates view logic.
 *
 * Views (from `snapshot.view`):
 *  - `accounts` — the unified `SwitchableAccount[]` list. Tapping a row
 *    switches through `controller.switchTo(accountId)`, the active row is
 *    flagged, and a "+ Add account" row opens the sign-in entry.
 *  - `add` / `signin` — the sign-in entry. On WEB this auto-starts "Sign in
 *    with Oxy" (native shared-keychain silently, else the QR handoff) the
 *    instant the view is entered — the QR is the PRIMARY web surface, not a
 *    button behind a click. On NATIVE it stays button-driven (unchanged):
 *    primary "Sign in with Oxy", secondary "Scan a QR from another device".
 *    Both platforms get a footer entry into `signup`.
 *  - `signup` — account creation. Commons is ALWAYS the priority path (owner
 *    mandate) and leads everywhere it appears: native shows only "Create your
 *    identity in Commons" (or "Get Commons" first, if not installed); web on
 *    a first-party Oxy origin leads with the SAME "Get Commons" CTA, with
 *    inline passkey creation (username + `registerWithPasskey`) offered
 *    UNDERNEATH as the de-emphasized "don't want to install anything"
 *    alternative — never co-equal, never a competing button. Anywhere else (a
 *    non-Oxy web origin, before the b2 hub-relay ships) shows an honest "not
 *    available here yet" message instead of a broken button.
 *  - `qr` — the cross-device Commons handoff, and the PRIMARY web sign-in
 *    surface. On a first-party Oxy origin this ALSO carries a "No Commons?"
 *    passkey link — identity is ONE thing (Commons key or browser passkey,
 *    same Oxy ID), so there is no separate "sign in with a passkey" button
 *    anywhere in this file, but passkey is explicitly the LIGHTWEIGHT
 *    ALTERNATIVE for someone who doesn't want to install Commons, never
 *    co-equal: same small-text-link subordination, same framing, wherever it
 *    appears. Native additionally branches on `commonsAvailability`: when
 *    Commons isn't installed, this leads with a "Get Commons" CTA instead of
 *    a same-device dead-end QR.
 *
 * Per-account color re-theming uses Bloom's `APP_COLOR_PRESETS` + `BloomColorScope`
 * (same visual language auth.oxy.so uses). Base theming is `useTheme()` + a
 * `StyleSheet`, so this renders correctly in EVERY consumer — including apps
 * that do not use NativeWind (e.g. the accounts app).
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { Avatar } from '@oxyhq/bloom/avatar';
import { Button } from '@oxyhq/bloom/button';
import { toast } from '@oxyhq/bloom';
import { Text } from '@oxyhq/bloom/typography';
import {
  useTheme,
  BloomColorScope,
  APP_COLOR_NAMES,
  APP_COLOR_PRESETS,
  type AppColorName,
} from '@oxyhq/bloom/theme';
import type { AccountDialogSnapshot, OxyServices, SwitchableAccount } from '@oxyhq/core';
import { isOxyRpOrigin } from '@oxyhq/core';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import { isWebBrowser } from '../utils/isWebBrowser';
import { getCommonsAcquisitionUrl } from '../utils/commonsStoreLinks';
import { authChooserStyles as styles } from './oxyAuthChooserStyles';

/** Diameter of a row avatar. */
const ROW_AVATAR_SIZE = 40;
/** High-contrast QR colors — intentionally fixed (NOT themed) for scan reliability. */
const QR_PLATE_BG = '#FFFFFF';
const QR_FOREGROUND = '#000000';
const QR_SIZE = 196;
/** Commons' own identity-creation deep link (mirrors the `approve`/`attest`/`card` intents). */
const COMMONS_CREATE_IDENTITY_URL = 'oxycommons://create-identity';

export interface OxyAuthChooserProps {
  /** Called after a completed switch, sign-in, or sign-up. */
  onComplete?: () => void;
}

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

interface OxyAuthChooserHandlers {
  onSwitch: (accountId: string) => void;
  onAdd: () => void;
  onManage: () => void;
}

type Theme = ReturnType<typeof useTheme>;
type Translate = ReturnType<typeof useI18n>['t'];

/**
 * The account switcher + sign-in/sign-up chooser. Mounted by `OxyAccountDialogScreen`
 * (wrapped in Bloom's `<Dialog>`) today; mountable bare by any future host that
 * supplies its own `onComplete`.
 */
const OxyAuthChooser: React.FC<OxyAuthChooserProps> = ({ onComplete }) => {
  const {
    accountDialogController: controller,
    showBottomSheet,
    refreshAccounts,
    signInWithPasskey,
    registerWithPasskey,
    oxyServices,
  } = useOxy();
  const theme = useTheme();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // A credential minted for `oxy.so` can only be ASSERTED there (or a loopback
  // dev host) — a hard WebAuthn RP-ID boundary the browser enforces, not
  // feature detection. On a first-party Oxy web origin the ceremony runs
  // directly ('direct'). On any OTHER web origin (b2) it can't run locally, so
  // the passkey action instead opens a popup at the auth.oxy.so passkey hub —
  // where the SAME ceremony IS first-party — and relays the resulting session
  // back via `AccountDialogController.startPasskeyHubSignIn` ('hub'). Native
  // has neither: Commons owns identity there ('none'). `isOxyRpOrigin()` reads
  // `location` once and is stable for the component's lifetime.
  const passkeyMode = useMemo<'direct' | 'hub' | 'none'>(() => {
    if (!isWebBrowser()) return 'none';
    return isOxyRpOrigin() ? 'direct' : 'hub';
  }, []);
  const passkeyAvailable = passkeyMode !== 'none';

  const [signInPasskeyPending, setSignInPasskeyPending] = useState(false);
  const handleSignInWithPasskey = useCallback(async () => {
    if (signInPasskeyPending) return;
    setSignInPasskeyPending(true);
    try {
      await signInWithPasskey();
      onComplete?.();
    } catch (error) {
      // A cancelled/failed ceremony keeps the view open so the user can retry
      // or fall back to the QR — surface the reason as a toast (owner mandate:
      // errors never render inline inside the dialog), never swallow.
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('accountSwitcher.toasts.passkeySignInFailed') || 'Passkey sign-in failed.',
      );
    } finally {
      setSignInPasskeyPending(false);
    }
  }, [signInPasskeyPending, signInWithPasskey, onComplete, t]);

  const [createPasskeyPending, setCreatePasskeyPending] = useState(false);
  const handleCreateWithPasskey = useCallback(
    async (username: string) => {
      if (createPasskeyPending) return;
      setCreatePasskeyPending(true);
      try {
        await registerWithPasskey({ username });
        onComplete?.();
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t('signup.toasts.passkeyCreateFailed') || 'Account creation failed.',
        );
      } finally {
        setCreatePasskeyPending(false);
      }
    },
    [createPasskeyPending, registerWithPasskey, onComplete, t],
  );

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
  const { view } = snapshot;

  // Sign-in device-flow failures land on `snapshot.signIn` asynchronously (poll /
  // socket / popup cancel). Toast at the controller notification site — never an
  // inline banner in the QR view (owner mandate, same contract as account-switch).
  useEffect(() => {
    if (!controller) return;
    let lastToastedSignInError: string | null = null;
    const maybeToastSignInError = () => {
      const { signIn } = controller.getSnapshot();
      if (signIn.phase === 'error' && signIn.error && signIn.error !== lastToastedSignInError) {
        lastToastedSignInError = signIn.error;
        toast.error(
          signIn.error ||
            t('accountSwitcher.toasts.signInFailed') ||
            'Sign-in failed. Please try again.',
        );
      }
      if (signIn.phase !== 'error') {
        lastToastedSignInError = null;
      }
    };
    maybeToastSignInError();
    return controller.subscribe(maybeToastSignInError);
  }, [controller, t]);

  // Web: "Sign in with Oxy" auto-starts the instant the sign-in entry is
  // reached — no button tap needed. `signInWithOxy()` tries the shared
  // keychain first (silently, native-only) then falls to the QR handoff,
  // which is what actually renders: the QR is the primary web surface, not a
  // peer button among several. Gated on `phase === 'idle'` so navigating back
  // to this view while a flow is already active (or re-entering it) never
  // restarts/duplicates it. Native stays fully button-driven (unchanged) —
  // this effect is a no-op there.
  useEffect(() => {
    if (!controller || !isWebBrowser()) return;
    if ((view !== 'signin' && view !== 'add') || snapshot.signIn.phase !== 'idle') return;
    void controller.signInWithOxy();
  }, [controller, view, snapshot.signIn.phase]);

  const [switching, setSwitching] = useState(false);

  const handleSwitch = useCallback(
    async (accountId: string) => {
      if (!controller || switching) return;
      if (accountId === snapshot.activeAccountId) {
        onComplete?.();
        return;
      }
      setSwitching(true);
      try {
        await controller.switchTo(accountId);
        // `switchTo` never throws — it records a failure on the controller's
        // snapshot. Read it back at the point the switch settles and surface it
        // as a toast (event-driven, at the failure site — NOT an inline banner
        // and NOT a snapshot-reaction). On success reload the app's account
        // graph and drop cached account-scoped data so the new active identity
        // re-fetches — the same side effects the context's own
        // `switchToAccount` performs.
        if (controller.getSnapshot().error) {
          toast.error(
            t('accountSwitcher.toasts.switchFailed') ||
              'There was a problem switching accounts. Please try again.',
          );
          return;
        }
        void refreshAccounts();
        queryClient.invalidateQueries();
        onComplete?.();
      } finally {
        setSwitching(false);
      }
    },
    [controller, switching, snapshot.activeAccountId, onComplete, refreshAccounts, queryClient, t],
  );

  const handleManage = useCallback(() => {
    onComplete?.();
    showBottomSheet?.('ManageAccount');
  }, [onComplete, showBottomSheet]);

  const handlers = useMemo<OxyAuthChooserHandlers>(
    () => ({
      onSwitch: (accountId) => {
        void handleSwitch(accountId);
      },
      onAdd: () => controller?.add(),
      onManage: handleManage,
    }),
    [handleSwitch, controller, handleManage],
  );

  if (!controller) {
    return null;
  }

  if (view === 'accounts') {
    return <AccountsView snapshot={snapshot} theme={theme} t={t} handlers={handlers} />;
  }

  if (view === 'qr') {
    return (
      <QrView
        snapshot={snapshot}
        theme={theme}
        t={t}
        onRetry={() => void controller.showQr()}
        passkeyAvailable={passkeyAvailable}
        onSignInWithPasskey={
          passkeyMode === 'direct'
            ? () => void handleSignInWithPasskey()
            : () => void controller.startPasskeyHubSignIn()
        }
        // The hub-popup flow's pending state is `snapshot.signIn` (already
        // rendered elsewhere in this view) — only the DIRECT ceremony uses this
        // component-local pending flag. A ceremony FAILURE is surfaced as a
        // toast by `handleSignInWithPasskey`, never inline.
        passkeyPending={passkeyMode === 'direct' ? signInPasskeyPending : false}
        onCreateAccount={() => controller.startSignup()}
      />
    );
  }

  if (view === 'signup') {
    return (
      <SignUpView
        snapshot={snapshot}
        theme={theme}
        t={t}
        oxyServices={oxyServices}
        passkeyMode={passkeyMode}
        onCreateWithPasskey={handleCreateWithPasskey}
        createPending={createPasskeyPending}
        onOpenHub={() => void controller.startPasskeyHubSignIn()}
        onBackToSignIn={() => controller.setView('signin')}
      />
    );
  }

  return (
    <SignInView
      snapshot={snapshot}
      theme={theme}
      t={t}
      handlers={handlers}
      onSignInWithOxy={() => void controller.signInWithOxy()}
      onScanQr={() => void controller.showQr()}
      onCreateAccount={() => controller.startSignup()}
    />
  );
};

// ---------------------------------------------------------------------------
// Accounts view
// ---------------------------------------------------------------------------

interface AccountsViewProps {
  snapshot: AccountDialogSnapshot;
  theme: Theme;
  t: Translate;
  handlers: OxyAuthChooserHandlers;
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
// Sign-in view (add / signin) — NATIVE-facing today: on web the auto-start
// effect above moves the view to `qr` almost immediately, so this renders
// only for a brief instant there.
// ---------------------------------------------------------------------------

interface SignInViewProps {
  snapshot: AccountDialogSnapshot;
  theme: Theme;
  t: Translate;
  handlers: OxyAuthChooserHandlers;
  onSignInWithOxy: () => void;
  onScanQr: () => void;
  onCreateAccount: () => void;
}

const SignInView: React.FC<SignInViewProps> = ({
  snapshot,
  theme,
  t,
  handlers,
  onSignInWithOxy,
  onScanQr,
  onCreateAccount,
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
      {t('accountSwitcher.signInWithOxy') || 'Sign in with Oxy'}
    </Button>

    <Button variant="secondary" onPress={onScanQr} style={styles.secondaryButton}>
      {t('accountSwitcher.scanQr') || 'Scan a QR from another device'}
    </Button>

    <SignUpFooterLink theme={theme} t={t} onPress={onCreateAccount} />
  </View>
);

const Dividerish: React.FC<{ theme: Theme; label: string }> = ({ theme, label }) => (
  <View style={styles.dividerRow}>
    <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
    <Text style={[styles.dividerText, { color: theme.colors.textSecondary }]}>{label}</Text>
    <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
  </View>
);

/** "New to Oxy? Create one" — shared by `SignInView` and `QrView`. */
const SignUpFooterLink: React.FC<{ theme: Theme; t: Translate; onPress: () => void }> = ({
  theme,
  t,
  onPress,
}) => (
  <Pressable onPress={onPress} accessibilityRole="button" style={styles.footerLink}>
    <Text style={[styles.linkText, { color: theme.colors.textSecondary }]}>
      {t('signin.createAccountLink') || 'New to Oxy? Create one'}
    </Text>
  </Pressable>
);

/** "Already have an account? Sign in" — used by `SignUpView`. */
const SignInFooterLink: React.FC<{ theme: Theme; t: Translate; onPress: () => void }> = ({
  theme,
  t,
  onPress,
}) => (
  <Pressable onPress={onPress} accessibilityRole="button" style={styles.footerLink}>
    <Text style={[styles.linkText, { color: theme.colors.textSecondary }]}>
      {t('signup.backToSignInLink') || 'Already have an account? Sign in'}
    </Text>
  </Pressable>
);

// ---------------------------------------------------------------------------
// QR view — the PRIMARY web sign-in surface, and the ONLY sign-in surface on
// native. Commons is ALWAYS the priority path (owner mandate): the QR here
// and the "Get Commons" CTA below are the leading content everywhere they
// appear. The passkey link is explicitly the lightweight, de-emphasized
// alternative for someone who doesn't want to install Commons — same visual
// subordination (a small text link, never a button) and the same "No
// Commons?" framing in its copy wherever it's offered.
// ---------------------------------------------------------------------------

interface QrViewProps {
  snapshot: AccountDialogSnapshot;
  theme: Theme;
  t: Translate;
  onRetry: () => void;
  passkeyAvailable: boolean;
  onSignInWithPasskey: () => void;
  passkeyPending: boolean;
  onCreateAccount: () => void;
}

const QrView: React.FC<QrViewProps> = ({
  snapshot,
  theme,
  t,
  onRetry,
  passkeyAvailable,
  onSignInWithPasskey,
  passkeyPending,
  onCreateAccount,
}) => {
  const { signIn, commonsAvailability } = snapshot;
  const [showQrAnyway, setShowQrAnyway] = useState(false);

  // A ceremony FAILURE is surfaced as a toast by `handleSignInWithPasskey` — the
  // link itself never renders an inline error (owner mandate).
  const passkeyLink =
    passkeyAvailable && signIn.phase !== 'authorized' ? (
      <Pressable
        onPress={onSignInWithPasskey}
        disabled={passkeyPending}
        accessibilityRole="button"
        style={styles.footerLink}
        testID="passkey-signin-link"
      >
        <Text style={[styles.linkText, { color: theme.colors.textSecondary }]}>
          {passkeyPending
            ? t('accountSwitcher.passkeySigningIn') || 'Signing in…'
            : t('accountSwitcher.useIdentityOnDevice') || 'No Commons? Use a passkey on this device instead'}
        </Text>
      </Pressable>
    ) : null;

  // Native, Commons confirmed NOT installed: a same-device QR is a dead
  // end (the user can't scan their own screen) — lead with "Get Commons"
  // instead, and demote the QR to an explicit "I have it elsewhere" reveal.
  if (commonsAvailability === 'unavailable' && !showQrAnyway) {
    return (
      <View style={styles.centeredBlock}>
        <Text style={[styles.mutedText, { color: theme.colors.textSecondary }]}>
          {t('accountSwitcher.commonsNotInstalled') ||
            "Don't have Commons? Get the app to sign in with your Oxy ID."}
        </Text>
        <Button
          variant="primary"
          onPress={() => void Linking.openURL(getCommonsAcquisitionUrl(Platform.OS))}
          style={styles.primaryButton}
        >
          {t('accountSwitcher.getCommons') || 'Get Commons'}
        </Button>
        <Pressable onPress={() => setShowQrAnyway(true)} accessibilityRole="button" style={styles.footerLink}>
          <Text style={[styles.linkText, { color: theme.colors.textSecondary }]}>
            {t('accountSwitcher.showQrAnyway') || 'I have Commons on another device'}
          </Text>
        </Pressable>
        {passkeyLink}
        <SignUpFooterLink theme={theme} t={t} onPress={onCreateAccount} />
      </View>
    );
  }

  if (signIn.phase === 'error') {
    // The failure reason is toasted by the controller subscription above — no
    // inline error copy here (owner mandate).
    return (
      <View style={styles.centeredBlock}>
        <Button variant="secondary" onPress={onRetry} style={styles.secondaryButton}>
          {t('common.actions.tryAgain') || 'Try again'}
        </Button>
        {passkeyLink}
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
      <Text style={[styles.qrHeadline, { color: theme.colors.text }]}>
        {t('accountSwitcher.qrHeadline') || 'Sign in with your Oxy identity'}
      </Text>
      <View style={styles.qrPlate}>
        <QRCode value={signIn.qrPayload} size={QR_SIZE} backgroundColor={QR_PLATE_BG} color={QR_FOREGROUND} />
      </View>
      <Text style={[styles.mutedText, { color: theme.colors.textSecondary }]}>
        {t('accountSwitcher.scanWithOxy') || 'Scan with Commons on your phone to continue.'}
      </Text>
      {passkeyLink}
      <SignUpFooterLink theme={theme} t={t} onPress={onCreateAccount} />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Sign-up view
// ---------------------------------------------------------------------------

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';

/** Debounced username-availability check over the existing SDK method. */
function useUsernameAvailability(
  oxyServices: OxyServices,
  t: Translate,
): {
  status: UsernameStatus;
  check: (value: string) => void;
} {
  const [status, setStatus] = useState<UsernameStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  const check = useCallback(
    (value: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const seq = ++requestSeqRef.current;
      if (!value || value.length < 3) {
        setStatus('idle');
        return;
      }
      setStatus('checking');
      timerRef.current = setTimeout(() => {
        void oxyServices
          .checkUsernameAvailability(value)
          .then((result) => {
            if (seq !== requestSeqRef.current) return; // superseded by a newer check
            setStatus(result.available ? 'available' : 'taken');
          })
          .catch(() => {
            if (seq !== requestSeqRef.current) return;
            // Reset the (now stale) verdict rather than block on it, and surface
            // the failure as a toast — never an inline error inside the dialog.
            setStatus('idle');
            toast.error(
              t('accounts.create.username.checkFailed') || 'Could not check availability',
            );
          });
      }, 400);
    },
    [oxyServices, t],
  );

  return { status, check };
}

const UsernameStatusText: React.FC<{ status: UsernameStatus; theme: Theme; t: Translate }> = ({
  status,
  theme,
  t,
}) => {
  if (status === 'idle') return null;
  if (status === 'checking') {
    return (
      <Text style={[styles.mutedText, { color: theme.colors.textSecondary }]}>
        {t('signup.usernameChecking') || 'Checking…'}
      </Text>
    );
  }
  if (status === 'available') {
    return (
      <Text style={[styles.mutedText, { color: theme.colors.success }]}>
        {t('signup.usernameAvailable') || 'Available'}
      </Text>
    );
  }
  return (
    <Text style={[styles.mutedText, { color: theme.colors.error }]}>
      {t('signup.usernameTaken') || 'This username is taken'}
    </Text>
  );
};

interface SignUpViewProps {
  snapshot: AccountDialogSnapshot;
  theme: Theme;
  t: Translate;
  oxyServices: OxyServices;
  passkeyMode: 'direct' | 'hub' | 'none';
  onCreateWithPasskey: (username: string) => Promise<void>;
  createPending: boolean;
  /** Open the auth.oxy.so hub popup (b2) — the 'hub' mode's only path. */
  onOpenHub: () => void;
  onBackToSignIn: () => void;
}

const SignUpView: React.FC<SignUpViewProps> = ({
  snapshot,
  theme,
  t,
  oxyServices,
  passkeyMode,
  onCreateWithPasskey,
  createPending,
  onOpenHub,
  onBackToSignIn,
}) => {
  const [username, setUsername] = useState('');
  const { status: usernameStatus, check: checkUsername } = useUsernameAvailability(oxyServices, t);
  const canSubmit = username.trim().length >= 3 && usernameStatus === 'available' && !createPending;

  // Native — Commons owns identity creation. Mirrors the QR view's own
  // commonsAvailability branch: deep-link straight in when installed, else
  // lead with the same "Get Commons" fallback.
  if (!isWebBrowser()) {
    const commonsInstalled = snapshot.commonsAvailability === 'available';
    return (
      <View style={styles.centeredBlock}>
        <Button
          variant="primary"
          onPress={() =>
            void Linking.openURL(
              commonsInstalled ? COMMONS_CREATE_IDENTITY_URL : getCommonsAcquisitionUrl(Platform.OS),
            )
          }
          style={styles.primaryButton}
        >
          {commonsInstalled
            ? t('signup.createInCommons') || 'Create your identity in Commons'
            : t('accountSwitcher.getCommons') || 'Get Commons'}
        </Button>
        <SignInFooterLink theme={theme} t={t} onPress={onBackToSignIn} />
      </View>
    );
  }

  // Web, first-party Oxy origin. Commons leads (owner mandate: it's ALWAYS
  // the priority path, everywhere the two appear) with a "Get Commons" CTA;
  // passkey creation is the de-emphasized alternative underneath for someone
  // who doesn't want to install anything — secondary button, introduced by
  // its own "No Commons?" framing, same subordination as the QR view's link.
  if (passkeyMode === 'direct') {
    return (
      <View style={styles.signInBlock}>
        <Text style={[styles.qrHeadline, { color: theme.colors.text }]}>
          {t('signup.commonsHeadline') || 'Create your identity in Commons'}
        </Text>
        <Text style={[styles.mutedText, { color: theme.colors.textSecondary }]}>
          {t('signup.commonsExplainer') ||
            'Commons is your full self-custody Oxy identity — one app, works everywhere.'}
        </Text>
        <Button
          variant="primary"
          onPress={() => void Linking.openURL(getCommonsAcquisitionUrl(Platform.OS))}
          style={styles.primaryButton}
        >
          {t('accountSwitcher.getCommons') || 'Get Commons'}
        </Button>

        <Dividerish theme={theme} label={t('signin.or') || 'or'} />

        <Text style={[styles.mutedText, { color: theme.colors.textSecondary }]}>
          {t('signup.passkeyAlternative') || "No Commons? Create a passkey on this device instead"}
        </Text>
        <TextInput
          style={[styles.usernameInput, { borderColor: theme.colors.border, color: theme.colors.text }]}
          placeholder={t('signup.usernamePlaceholder') || 'Choose a username'}
          placeholderTextColor={theme.colors.textSecondary}
          value={username}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          onChangeText={(value) => {
            setUsername(value);
            checkUsername(value.trim());
          }}
          testID="signup-username-input"
        />
        <UsernameStatusText status={usernameStatus} theme={theme} t={t} />
        <Button
          variant="secondary"
          onPress={() => void onCreateWithPasskey(username.trim())}
          disabled={!canSubmit}
          style={styles.secondaryButton}
          testID="signup-create-button"
        >
          {createPending
            ? t('signup.creating') || 'Creating…'
            : t('signup.createAccount') || 'Create account'}
        </Button>
        <SignInFooterLink theme={theme} t={t} onPress={onBackToSignIn} />
      </View>
    );
  }

  // Web, non-Oxy origin (b2): passkey creation can't run locally here — the
  // same WebAuthn RP-ID boundary as sign-in — so this opens the SAME
  // auth.oxy.so passkey hub popup `QrView`'s "No Commons?" link uses.
  // Completing EITHER a sign-in OR a fresh sign-up there relays the resulting
  // session back via the SAME poll/socket engine `showQr` drives.
  return (
    <View style={styles.centeredBlock}>
      <Text style={[styles.mutedText, { color: theme.colors.textSecondary }]}>
        {t('signup.hubExplainer') ||
          'Create your Oxy ID in a secure window, then come right back.'}
      </Text>
      <Button variant="primary" onPress={onOpenHub} style={styles.primaryButton}>
        {t('signup.continueInWindow') || 'Continue in a new window'}
      </Button>
      <SignInFooterLink theme={theme} t={t} onPress={onBackToSignIn} />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Empty snapshot (no-provider loading state)
// ---------------------------------------------------------------------------

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

export default OxyAuthChooser;

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
import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Linking,
  Platform,
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { Avatar } from '@oxyhq/bloom/avatar';
import { AvatarGroup, type AvatarGroupItem } from '@oxyhq/bloom/avatar-group';
import { Button } from '@oxyhq/bloom/button';
import { PressableScale } from '@oxyhq/bloom/pressable-scale';
import { CompositionBar, type CompositionCategory } from '@oxyhq/bloom/composition-bar';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
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
import { getNormalizedUserHandle, isOxyRpOrigin } from '@oxyhq/core';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import { getAccountDialogConsumerHooks } from '../navigation/accountDialogManager';
import { isWebBrowser } from '../utils/isWebBrowser';
import { getCommonsAcquisitionUrl } from '../utils/commonsStoreLinks';
import { useAccountStorageUsage } from '../hooks/queries/useServicesQueries';
import { authChooserStyles as styles } from './oxyAuthChooserStyles';
import AvatarCameraBadge from './AvatarCameraBadge';

/** Diameter of a row avatar (the sign-in view's account rows). */
const ROW_AVATAR_SIZE = 40;
/** High-contrast QR colors — intentionally fixed (NOT themed) for scan reliability. */
const QR_PLATE_BG = '#FFFFFF';
const QR_FOREGROUND = '#000000';
const QR_SIZE = 196;
/** Commons' own identity-creation deep link (mirrors the `approve`/`attest`/`card` intents). */
const COMMONS_CREATE_IDENTITY_URL = 'oxycommons://create-identity';
/**
 * "Accounts by Oxy" management app — the canonical home for account settings,
 * data export, and storage management. The account-menu rows deep-link into it
 * (`/data`, `/storage`, or its root) the same way `getCommonsAcquisitionUrl`
 * hands off to Commons; nothing here invents new API endpoints.
 */
const ACCOUNTS_APP_URL = 'https://accounts.oxy.so';

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
  /**
   * Change the current account's photo — opens the avatar-change flow. Because
   * the account menu lives in the AccountDialog surface, this MORPHS that surface
   * into `ChangeAvatar` (via `openAvatarPicker` → `openWithinOrPresent`), the same
   * flow ManageAccount's avatar uses; it never stacks a new dialog.
   */
  onEditAvatar: () => void;
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
    logout,
    openAvatarPicker,
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

  // Web: auto-start "Sign in with Oxy" when the sign-in entry becomes the shown
  // view — the QR handoff is the PRIMARY web surface, not a button behind a tap.
  // `signInWithOxy()` tries the shared keychain first (silently, native-only)
  // then falls to the QR handoff, which is what actually renders. Driven from the
  // EVENTS that reach that view — the initial `subscribe` pass below (an
  // open-to-sign-in) and the add / back-to-sign-in handlers — never a watcher
  // effect. Guarded so it never restarts a live flow (phase must be idle) and is a
  // no-op on native (button-driven). Reads the live snapshot at call time (an
  // event callback, not render), so it is stable across renders.
  const autoStartSignIn = useCallback(() => {
    if (!controller || !isWebBrowser()) return;
    const { view: currentView, signIn } = controller.getSnapshot();
    if ((currentView !== 'signin' && currentView !== 'add') || signIn.phase !== 'idle') return;
    void controller.signInWithOxy();
  }, [controller]);

  // Bind the headless controller. `getSnapshot` returns a stable reference
  // between changes, so it is `useSyncExternalStore`-safe. Guard the no-provider
  // loading state (`controller` is `null`) with an inert store.
  //
  // The subscribe callback ALSO carries two owner-mandated reactions to the
  // controller. These run in the subscribe / notification callbacks — EVENT
  // callbacks, not render/effect — so neither is a React effect hook:
  //  1. Sign-in device-flow failures (poll / socket / popup-cancel land on
  //     `signIn` asynchronously) are toasted at the notification site, deduped
  //     per subscription — NEVER an inline banner in the QR view (owner mandate,
  //     same contract as account-switch).
  //  2. On subscribe (mount / re-subscribe — a passive effect, the SAME timing
  //     the removed effects had) the web sign-in flow auto-starts if the opening
  //     view is the sign-in entry.
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!controller) return () => undefined;
      let lastToastedSignInError: string | null = null;
      const maybeToastSignInError = () => {
        const { signIn } = controller.getSnapshot();
        if (signIn.phase === 'error' && signIn.error && signIn.error !== lastToastedSignInError) {
          lastToastedSignInError = signIn.error;
          toast.error(signIn.error);
        } else if (signIn.phase !== 'error') {
          lastToastedSignInError = null;
        }
      };
      maybeToastSignInError();
      autoStartSignIn();
      return controller.subscribe(() => {
        maybeToastSignInError();
        listener();
      });
    },
    [controller, autoStartSignIn],
  );
  const getSnapshot = useCallback(
    () => (controller ? controller.getSnapshot() : EMPTY_SNAPSHOT),
    [controller],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { view } = snapshot;

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
    const hooks = getAccountDialogConsumerHooks();
    if (hooks?.onNavigateManage) {
      hooks.onNavigateManage();
      return;
    }
    showBottomSheet?.('ManageAccount');
  }, [onComplete, showBottomSheet]);

  const handleAdd = useCallback(() => {
    const hooks = getAccountDialogConsumerHooks();
    if (hooks?.onAddAccount) {
      hooks.onAddAccount();
      return;
    }
    // No consumer override: enter the "add account" view and auto-start the web
    // sign-in flow, from this handler (the event that reaches the view).
    controller?.add();
    autoStartSignIn();
  }, [controller, autoStartSignIn]);

  const handlers = useMemo<OxyAuthChooserHandlers>(
    () => ({
      onSwitch: (accountId) => {
        void handleSwitch(accountId);
      },
      onAdd: handleAdd,
      onManage: handleManage,
      // Morphs the AccountDialog surface into `ChangeAvatar` (and back), then
      // uploads / clears the picked photo — the single shared avatar write path.
      onEditAvatar: () => openAvatarPicker(),
    }),
    [handleSwitch, handleAdd, handleManage, openAvatarPicker],
  );

  // Real storage usage for the account menu's "Oxy storage" block. Disabled
  // (no fetch) until a private-API session exists, so it is inert on the
  // sign-in/QR/sign-up views; when present the block shows live used/total.
  const storageQuery = useAccountStorageUsage();
  const storage = useMemo<AccountStorageModel | null>(
    () =>
      storageQuery.data
        ? {
            usedBytes: storageQuery.data.totalUsedBytes,
            limitBytes: storageQuery.data.totalLimitBytes,
          }
        : null,
    [storageQuery.data],
  );

  // The account-menu rows below the switcher: storage + data + settings + help
  // deep-link into the "Accounts by Oxy" app or open the matching in-app sheet
  // (Help, Legal); sign-out uses the SDK's own per-account sign-out. No new
  // endpoints — the same handoff pattern `handleManage`/`getCommonsAcquisitionUrl`
  // already use.
  const accountMenu = useMemo<AccountsMenuActions>(() => {
    const openUrl = (url: string) => {
      void Linking.openURL(url);
    };
    const openSheet = (config: Parameters<NonNullable<typeof showBottomSheet>>[0]) => {
      onComplete?.();
      showBottomSheet?.(config);
    };
    return {
      onOpenSettings: () => openUrl(ACCOUNTS_APP_URL),
      onOpenData: () => openUrl(`${ACCOUNTS_APP_URL}/data`),
      onManageStorage: () => openUrl(`${ACCOUNTS_APP_URL}/storage`),
      onUpgradeStorage: () => openUrl(`${ACCOUNTS_APP_URL}/payments`),
      onHelp: () => openSheet('HelpSupport'),
      onPrivacy: () => openSheet({ screen: 'LegalDocuments', props: { initialStep: 1 } }),
      onTerms: () => openSheet({ screen: 'LegalDocuments', props: { initialStep: 2 } }),
      onSignOut: () => {
        void logout();
        onComplete?.();
      },
    };
  }, [onComplete, showBottomSheet, logout]);

  if (!controller) {
    return null;
  }

  if (view === 'accounts') {
    return (
      <AccountsView
        snapshot={snapshot}
        theme={theme}
        t={t}
        handlers={handlers}
        storage={storage}
        menu={accountMenu}
      />
    );
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
        onBackToSignIn={() => {
          controller.setView('signin');
          autoStartSignIn();
        }}
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
// Accounts view — the signed-in Oxy account MENU (NativeWind)
// ---------------------------------------------------------------------------

/** Used/total storage bytes for the "Oxy storage" block, or `null` when unknown. */
interface AccountStorageModel {
  usedBytes: number;
  limitBytes: number;
}

/** The account-menu row actions the container wires (deep-links / sheets / sign-out). */
interface AccountsMenuActions {
  onOpenSettings: () => void;
  onOpenData: () => void;
  onManageStorage: () => void;
  onUpgradeStorage: () => void;
  onHelp: () => void;
  onPrivacy: () => void;
  onTerms: () => void;
  onSignOut: () => void;
}

interface AccountsViewProps {
  snapshot: AccountDialogSnapshot;
  theme: Theme;
  t: Translate;
  handlers: OxyAuthChooserHandlers;
  storage: AccountStorageModel | null;
  menu: AccountsMenuActions;
}

/**
 * Leading glyph for the rows that live in a Bloom grouped section (the MENU
 * block) and for the storage card's cloud, which lines its title up with them.
 * It is Bloom's OWN icon-slot size: `SettingsListItem` reserves a fixed 20px
 * leading column and Bloom is consumed exactly as it ships, so a menu glyph
 * larger than this would overhang into the row's title.
 */
const ROW_ICON_SIZE = 20;
/**
 * The switch card's two corner states. Collapsed it is one row and reads as a
 * PILL; opened it is a card holding rows, on the same 16px corner the Bloom
 * grouped section below it uses. Interpolated across the reveal, never snapped.
 */
const SWITCH_CARD_PILL_RADIUS = 999;
const SWITCH_CARD_RADIUS = 16;
/**
 * The fraction of the reveal over which the corner resolves. The corner is a
 * FASTER gesture than the reveal — it has to be finished before the rows read as
 * rows, or the card still looks like a pill while a list falls out of it — so it
 * is clamped to the reveal's opening fraction instead of tracking it end to end.
 * Measured in a browser against the 240ms reveal: the corner reaches its card
 * value ~120ms in, with the list only ~20% revealed, and (mirrored) the pill is
 * back ~250ms into the close, with the list already down to ~0.
 */
const SWITCH_CARD_RADIUS_SETTLE = 0.2;
/** Diameter of an account row's avatar in the switch list (own markup). */
const SWITCH_AVATAR_SIZE = 36;
/** Glyph inside a bordered affordance badge, sized to the avatar it stands in for. */
const BADGE_GLYPH_SIZE = 19;
/** The hero block's large current-account avatar. */
const HERO_AVATAR_SIZE = 72;

/**
 * The hero's address line, shown under the "Hi, <name>!" greeting: the account's
 * canonical `@oxy.so` email when it has one, else its normalized `@handle`. Never
 * synthesizes a `username@oxy.so` address (the identity contract forbids it) — a
 * non-Oxy or missing email falls back to `getNormalizedUserHandle`.
 */
function heroAddressLine(account: SwitchableAccount): string | null {
  if (account.email?.toLowerCase().endsWith('@oxy.so')) {
    return account.email;
  }
  const handle = getNormalizedUserHandle(account.user);
  return handle ? `@${handle}` : null;
}
/** Avatars shown in the switch row's facepile before it collapses into `+N`. */
const FACEPILE_MAX = 2;
/** Facepile avatar diameter — one clear step down from a switch-list avatar. */
const FACEPILE_AVATAR_SIZE = 32;
/**
 * Facepile overlap. Well under Bloom's `size / 3` default: the stack draws the
 * FIRST item on top, so a deep overlap would bury the trailing `+N` chip's own
 * label under the avatar before it.
 */
const FACEPILE_OVERLAP = 4;


/**
 * `bytes` → `"11.6 GB"`. Whole plan sizes read as whole numbers (`"17 GB"`, not
 * `"17.0 GB"`), and anything ≥ 100 GB drops the decimal entirely.
 */
function formatStorageGb(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 100 || Number.isInteger(gb)) return `${Math.round(gb)} GB`;
  return `${gb.toFixed(1)} GB`;
}

type HoverPressableProps = Omit<React.ComponentProps<typeof Pressable>, 'className'> & {
  baseClassName: string;
  hoverClassName: string;
};

/**
 * A `Pressable` that appends a hover-tint NativeWind token while pointer-hovered.
 * The Metro web pipeline here does NOT emit NativeWind `hover:` variants, so hover
 * is driven by RN's cross-platform `onHoverIn`/`onHoverOut` (they fire only on web
 * via react-native-web; a no-op on native) toggling a plain background token —
 * the tint stays a NativeWind class, only the trigger is JS.
 */
const HoverPressable: React.FC<HoverPressableProps> = ({
  baseClassName,
  hoverClassName,
  ...rest
}) => {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...rest}
      className={hovered ? `${baseClassName} ${hoverClassName}` : baseClassName}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    />
  );
};

/**
 * The signed-in Oxy account MENU — a Google-account-menu-style full menu built
 * entirely with NativeWind `className` (the dynamic per-account accent hex is
 * the one inline style NativeWind can't express). Structure mirrors the
 * approved demo:
 *  - ACCOUNT on its own distinct panel surface: a COMPACT current-account row
 *    (avatar + name + email + expand chevron) that toggles the switch list, a
 *    "Manage your Oxy account" pill, and — when expanded — the other switchable
 *    accounts + "Add another account" + "Manage accounts on this device".
 *  - OXY STORAGE: cloud + used/total + a progress bar + Upgrade / Manage chips.
 *  - MENU rows: Your data in Oxy · Oxy settings · Help & feedback · Sign out —
 *    Bloom's grouped section (`SettingsListGroup`/`SettingsListItem`), the same
 *    component every other SDK settings surface uses, not a local row copy.
 *  - FOOTER: Privacy Policy · Terms of Service.
 *
 * All three blocks share ONE rhythm taken from that grouped section: a 12px
 * content inset, a 12px gap after the leading element, 16px between blocks, and
 * a 16px trailing chevron column.
 *
 * Collapse state is a plain `useState` toggled in the current row's press
 * handler — no effect hook, no derived-from-props sync. With only ONE account
 * (nothing to switch to) the chevron is hidden and the list renders inline so
 * "Add another account" stays reachable without a pointless toggle.
 */
const AccountsView: React.FC<AccountsViewProps> = ({
  snapshot,
  theme,
  t,
  handlers,
  storage,
  menu,
}) => {
  const [expanded, setExpanded] = useState(false);
  // Measured natural height of the switch list, so the reveal animates to an
  // exact height (and the content below reflows down smoothly) instead of a
  // guessed max. The measuring wrapper is style-based, NOT className'd — on
  // RN-Web `onLayout` never fires for className'd Views (see AGENTS.md).
  const [listContentHeight, setListContentHeight] = useState(0);
  // 0 = collapsed, 1 = expanded. Set imperatively in the toggle handler (no
  // effect hook). On RN-Web there is no worklets plugin, so every shared value a
  // mapper reads MUST be in its deps array or it freezes on the first frame
  // (AGENTS.md "Reanimated (web)").
  const listProgress = useSharedValue(0);
  const listStyle = useAnimatedStyle(
    () => ({ height: listProgress.value * listContentHeight, opacity: listProgress.value }),
    [listProgress, listContentHeight],
  );
  const chevronStyle = useAnimatedStyle(
    () => ({ transform: [{ rotate: `${listProgress.value * 180}deg` }] }),
    [listProgress],
  );
  // Collapsed, the switch card is a single row and reads as a PILL; opened, it
  // becomes a card holding rows and takes the grouped-section corner. The corner
  // is driven off the SAME `listProgress` as the reveal — but clamped to its
  // opening fraction, so it resolves early instead of trailing the rows: the
  // card already reads as a card by the time they are visible. Collapsing is the
  // mirror image, the pill returning over the closing tail.
  const switchCardStyle = useAnimatedStyle(
    () => ({
      borderRadius: interpolate(
        listProgress.value,
        [0, SWITCH_CARD_RADIUS_SETTLE],
        [SWITCH_CARD_PILL_RADIUS, SWITCH_CARD_RADIUS],
        Extrapolation.CLAMP,
      ),
    }),
    [listProgress],
  );
  // `CompositionBar` ships as an interactive breakdown: a selected segment
  // replaces its hint line with that segment's readout. Tapping the selected one
  // again clears it.
  const [storageSegment, setStorageSegment] = useState<string | null>(null);
  const toggleStorageSegment = useCallback(
    (key: string) => setStorageSegment((previous) => (previous === key ? null : key)),
    [],
  );
  const toggleExpanded = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    listProgress.value = withTiming(next ? 1 : 0, { duration: 240 });
  }, [expanded, listProgress]);

  if (snapshot.loading && snapshot.accounts.length === 0) {
    return (
      <View className="items-center justify-center gap-space-12 py-space-24">
        <MaterialCommunityIcons name="loading" size={24} color={theme.colors.textSecondary} />
        <Text className="text-body text-text-secondary text-center">
          {t('accountSwitcher.loading')}
        </Text>
      </View>
    );
  }

  const switchingDisabled = snapshot.switchingAccountId !== null;
  const current = snapshot.accounts.find((account) => account.isCurrent) ?? snapshot.accounts[0];
  const others = current
    ? snapshot.accounts.filter((account) => account.accountId !== current.accountId)
    : snapshot.accounts;
  const currentAccent = current
    ? resolveAccentHex(current.color, theme.colors.primary)
    : theme.colors.primary;
  // The hero's address line under the greeting: the account's canonical @oxy.so
  // email when it has one, else its normalized `@handle` (never a synthesized
  // `username@oxy.so`, per the identity contract — `getNormalizedUserHandle`).
  const currentAddress = current ? heroAddressLine(current) : null;
  // The switch list repeats the CURRENT account (first, ringed) — unlike the old
  // compact header it is not represented anywhere else once the hero moved out
  // of the card, and the list is where you switch back to it.
  const switchableAccounts = current ? [current, ...others] : others;
  const facepile: AvatarGroupItem[] = switchableAccounts.map((account) => ({
    id: account.accountId,
    uri: account.avatarUrl ?? undefined,
    displayName: account.displayName,
  }));

  // Used vs free is a two-part COMPOSITION (the parts always fill the bar), not
  // a progress value — exactly what Bloom's `CompositionBar` models. Both colors
  // are theme tokens, so the bar is correct in light and dark.
  const storageCategories: CompositionCategory[] = storage
    ? [
        {
          key: 'used',
          name: t('accountMenu.storage.used'),
          amount: storage.usedBytes,
          color: theme.colors.primary,
        },
        {
          key: 'free',
          name: t('accountMenu.storage.free'),
          amount: Math.max(0, storage.limitBytes - storage.usedBytes),
          color: theme.colors.contrast50,
        },
      ]
    : [];
  const usageLabel = storage
    ? t('accountMenu.storage.usage', {
        used: formatStorageGb(storage.usedBytes),
        total: formatStorageGb(storage.limitBytes),
      })
    : t('accountMenu.storage.unavailable');

  // The switch list body, revealed under the "Switch account" row. Own markup,
  // not a Bloom grouped section: this is not a list of settings rows and the
  // component is not a card container. It mirrors the section's rhythm by hand —
  // 12px content inset, 12px after the avatar, a hairline between rows — and
  // draws those hairlines INSIDE the animated clip, so a collapsed list never
  // strands one against the header row.
  const listItems = (
    <>
      {switchableAccounts.map((account, index) => {
        const accent = resolveAccentHex(account.color, theme.colors.primary);
        const isSwitching = snapshot.switchingAccountId === account.accountId;
        return (
          <Fragment key={account.accountId}>
            {index > 0 ? <View className="h-px bg-border opacity-30 ml-space-12" /> : null}
            <HoverPressable
              baseClassName={`flex-row items-center gap-space-12 px-space-12 py-[10px]${
                switchingDisabled ? ' opacity-60' : ''
              }`}
              hoverClassName="bg-fill-secondary"
              onPress={() => handlers.onSwitch(account.accountId)}
              disabled={switchingDisabled}
              accessibilityRole="button"
              accessibilityLabel={account.displayName}
            >
              <View>
                <Avatar
                  source={account.avatarUrl ?? undefined}
                  variant="thumb"
                  name={account.displayName}
                  size={SWITCH_AVATAR_SIZE}
                />
                {/* The accent ring is an OVERLAY: it costs the row no width, so
                    every avatar in the list starts on the same content line. */}
                {account.isCurrent ? (
                  <View
                    style={[styles.currentAvatarRing, { borderColor: accent }]}
                    pointerEvents="none"
                  />
                ) : null}
              </View>
              <View className="flex-1 min-w-0">
                <Text className="text-body font-semibold text-text" numberOfLines={1}>
                  {account.displayName}
                </Text>
                {account.email ? (
                  <Text className="text-caption text-text-secondary" numberOfLines={1}>
                    {account.email}
                  </Text>
                ) : null}
              </View>
              {isSwitching ? (
                <MaterialCommunityIcons name="loading" size={20} color={accent} />
              ) : null}
            </HoverPressable>
          </Fragment>
        );
      })}

      <View className="h-px bg-border opacity-30 ml-space-12" />
      <AccountAffordanceRow
        icon="plus"
        label={t('accountMenu.addAnother')}
        onPress={handlers.onAdd}
        disabled={switchingDisabled}
        theme={theme}
      />
      <View className="h-px bg-border opacity-30 ml-space-12" />
      <AccountAffordanceRow
        icon="account-multiple-outline"
        label={t('accountSwitcher.manageOnDevice')}
        onPress={handlers.onManage}
        disabled={switchingDisabled}
        theme={theme}
      />
    </>
  );

  const manageLabel = t('accountMenu.manage');
  const switchLabel = t('accountMenu.switchAccount');

  return (
    <View>
      {/* HERO — chrome-free and centred, in the reference's reading order:
          NOTHING above the avatar (the nav bar's Oxy wordmark stands alone), the
          large pressable avatar (with a camera badge to change the photo), then
          the greeting, then the account address under it, then the manage action.
          The nav bar above stays BRANDED (see `OxyAccountDialogScreen`). */}
      <View style={styles.hero}>
        {current ? (
          <>
            <PressableScale
              onPress={handlers.onEditAvatar}
              accessibilityRole="button"
              accessibilityLabel={t('editProfile.changeAvatar')}
              style={styles.heroAvatarPressable}
            >
              <Avatar
                source={current.avatarUrl ?? undefined}
                name={current.displayName}
                size={HERO_AVATAR_SIZE}
              />
              <View
                style={[styles.heroAvatarRing, { borderColor: currentAccent }]}
                pointerEvents="none"
              />
              <AvatarCameraBadge />
            </PressableScale>
            <View style={styles.heroNameBlock}>
              <Text
                style={[styles.heroGreeting, { color: theme.colors.text }]}
                numberOfLines={2}
              >
                {t('accountMenu.greeting', { name: current.displayName })}
              </Text>
              {currentAddress ? (
                <Text
                  style={[styles.heroAddress, { color: theme.colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {currentAddress}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
        {/* Bloom's own compact outlined pill — `secondary` is the outlined
            variant, `small` the compact height; it hugs its label instead of
            spanning the surface. */}
        <Button
          variant="secondary"
          size="small"
          onPress={handlers.onManage}
          accessibilityLabel={manageLabel}
        >
          {manageLabel}
        </Button>
      </View>

      {/* SWITCH ACCOUNT — own NativeWind card, NOT a Bloom grouped section: it
          is a disclosure header over an animated list, not a list of settings
          rows, and the grouped section is not a bare card container. It borrows
          the section's LOOK by hand — the same `card` surface, 12px content inset
          and 16px gap to the next block — and its corner animates from a pill
          (collapsed, a single row) to that section's 16px card corner (opened,
          a card of rows) on the same `listProgress` the reveal runs on. */}
      <Animated.View className="bg-fill overflow-hidden mb-space-16" style={switchCardStyle}>
        <HoverPressable
          baseClassName={`flex-row items-center gap-space-12 px-space-12 py-[10px] min-h-[44px]${
            switchingDisabled ? ' opacity-60' : ''
          }`}
          hoverClassName="bg-fill-secondary"
          onPress={toggleExpanded}
          disabled={switchingDisabled}
          accessibilityRole="button"
          // The ARIA prop, not `accessibilityState`: react-native-web 0.21
          // forwards only this one, and RN maps it to
          // `accessibilityState.expanded` natively — so the disclosure state
          // reaches assistive tech on BOTH platforms.
          aria-expanded={expanded}
          accessibilityLabel={switchLabel}
        >
          <Text className="flex-1 text-body text-text" numberOfLines={1}>
            {switchLabel}
          </Text>
          {/* The facepile previews who you can switch to; once the list is open
              it would just restate the rows below it. */}
          {expanded ? null : (
            <AvatarGroup
              items={facepile}
              layout="stack"
              size={FACEPILE_AVATAR_SIZE}
              max={FACEPILE_MAX}
              overlap={FACEPILE_OVERLAP}
              variant="thumb"
              showInitials
              ringColor={theme.colors.card}
            />
          )}
          <View style={[styles.chevronCircle, { backgroundColor: theme.colors.contrast50 }]}>
            <Animated.View style={chevronStyle}>
              <MaterialCommunityIcons name="chevron-down" size={20} color={theme.colors.text} />
            </Animated.View>
          </View>
        </HoverPressable>

        {/* Animated reveal: an overflow-clipped container whose height + opacity
            are driven by `listProgress`; the inner style-based wrapper measures
            the natural content height via `onLayout`. */}
        <Animated.View
          style={[styles.collapse, listStyle]}
          pointerEvents={expanded ? 'auto' : 'none'}
        >
          <View
            style={styles.collapseMeasure}
            onLayout={(event) => setListContentHeight(event.nativeEvent.layout.height)}
          >
            <View>{listItems}</View>
          </View>
        </Animated.View>
      </Animated.View>

      {/* OXY STORAGE — own NativeWind card for the same reason: a title, a meter
          and two chips are not settings rows. Its cloud sits in the same 20px
          column Bloom's own rows use, so the title below lines up with the menu
          titles. `CompositionBar` is consumed exactly as it ships — an
          interactive breakdown at its own thickness, its hint line carrying the
          used/total copy and a tapped segment revealing that segment's share. */}
      <View className="bg-fill rounded-[16px] overflow-hidden mb-space-16 px-space-12 py-[10px] gap-space-12">
        <View className="flex-row items-center gap-space-12 min-h-[24px]">
          <View className="w-[20px] items-center">
            <MaterialCommunityIcons
              name="cloud-outline"
              size={ROW_ICON_SIZE}
              color={theme.colors.textSecondary}
            />
          </View>
          <Text className="flex-1 text-body font-semibold text-text" numberOfLines={1}>
            {t('accountMenu.storage.title')}
          </Text>
        </View>
        <CompositionBar
          categories={storageCategories}
          selectedKey={storageSegment}
          onSelect={toggleStorageSegment}
          hintLabel={usageLabel}
          formatReadout={(bytes, percent) => `${formatStorageGb(bytes)} · ${percent}%`}
        />
        <View className="flex-row gap-space-8">
          <StorageChip label={t('accountMenu.storage.upgrade')} onPress={menu.onUpgradeStorage} />
          <StorageChip label={t('accountMenu.storage.manage')} onPress={menu.onManageStorage} />
        </View>
      </View>

      {/* MENU — the same stock grouped section. */}
      <SettingsListGroup>
        <SettingsListItem
          icon={<MenuIcon name="tray-arrow-down" theme={theme} />}
          title={t('accountMenu.data')}
          onPress={menu.onOpenData}
        />
        <SettingsListItem
          icon={<MenuIcon name="cog-outline" theme={theme} />}
          title={t('accountMenu.settings')}
          onPress={menu.onOpenSettings}
        />
        <SettingsListItem
          icon={<MenuIcon name="help-circle-outline" theme={theme} />}
          title={t('accountMenu.help')}
          onPress={menu.onHelp}
        />
        <SettingsListItem
          icon={<MenuIcon name="logout" theme={theme} />}
          title={t('accountMenu.signOut')}
          onPress={menu.onSignOut}
          showChevron={false}
        />
      </SettingsListGroup>

      {/* FOOTER. */}
      <View className="flex-row items-center justify-center gap-space-12 px-space-12 pb-space-8">
        <Pressable onPress={menu.onPrivacy} accessibilityRole="link">
          <Text className="text-bodySmall text-text-secondary">{t('accountMenu.privacy')}</Text>
        </Pressable>
        <Text className="text-bodySmall text-text-tertiary">·</Text>
        <Pressable onPress={menu.onTerms} accessibilityRole="link">
          <Text className="text-bodySmall text-text-secondary">{t('accountMenu.terms')}</Text>
        </Pressable>
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Account-menu row building blocks (NativeWind)
// ---------------------------------------------------------------------------

/**
 * An account-list AFFORDANCE row ("Add another account", "Manage accounts on
 * this device") — a bordered circle sized to the avatar it stands in for, so its
 * label lands on the same line as every account name above it. Own markup, like
 * the account rows it closes: this list is not a Bloom grouped section.
 */
const AccountAffordanceRow: React.FC<{
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  theme: Theme;
}> = ({ icon, label, onPress, disabled, theme }) => (
  <HoverPressable
    baseClassName={`flex-row items-center gap-space-12 px-space-12 py-[10px]${
      disabled ? ' opacity-60' : ''
    }`}
    hoverClassName="bg-fill-secondary"
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <View className="w-[36px] h-[36px] items-center justify-center rounded-radius-max border border-border">
      <MaterialCommunityIcons name={icon} size={BADGE_GLYPH_SIZE} color={theme.colors.textSecondary} />
    </View>
    <Text className="flex-1 text-body font-semibold text-text" numberOfLines={1}>
      {label}
    </Text>
  </HoverPressable>
);

/**
 * The leading glyph for a grouped-section menu row, sized to Bloom's 20px icon
 * column so the icons, the storage block's cloud and every row title align.
 */
const MenuIcon: React.FC<{
  name: keyof typeof MaterialCommunityIcons.glyphMap;
  theme: Theme;
}> = ({ name, theme }) => (
  <MaterialCommunityIcons name={name} size={ROW_ICON_SIZE} color={theme.colors.textSecondary} />
);

/** A storage action chip — a bordered pill on the sheet background. */
const StorageChip: React.FC<{ label: string; onPress: () => void }> = ({ label, onPress }) => (
  <HoverPressable
    baseClassName="rounded-radius-max border border-border bg-bg py-[9px] px-[14px]"
    hoverClassName="bg-fill-secondary"
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Text className="text-bodySmall font-semibold text-text">{label}</Text>
  </HoverPressable>
);

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
// Sign-in view (add / signin) — NATIVE-facing today: on web `autoStartSignIn`
// (fired from the subscribe pass / the add / back-to-sign-in handlers) moves the
// view to `qr` almost immediately, so this renders only for a brief instant there.
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

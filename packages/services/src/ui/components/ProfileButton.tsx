import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import {
    View,
    Pressable,
    StyleSheet,
    Platform,
    type StyleProp,
    type ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Avatar } from '@oxyhq/bloom/avatar';
import { Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import { getAccountDisplayName, getAccountFallbackHandle } from '@oxyhq/core';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import ProfileMenu, { type ProfileMenuAnchor } from './ProfileMenu';

const isWeb = Platform.OS === 'web';

/**
 * Fixed popover width used by {@link ProfileMenu} on web. `ProfileButton`
 * mirrors this constant when computing the trigger-relative anchor so the
 * left-edge clamp keeps the panel fully on-screen. Keep the two in sync.
 */
const MENU_WIDTH = 300;

/** Gutter, in px, kept between the popover and the viewport edges on web. */
const VIEWPORT_GUTTER = 8;

/**
 * Web-only Bluesky-style hover animation timings, mirrored from
 * `social-app/src/view/shell/desktop/LeftNav.tsx`. The row background and the
 * name/handle/chevron opacity cross-fade quickly; the avatar shrink+slide is
 * slower and more deliberate. A short delay on the LEAVE transition keeps the
 * row from flickering when the pointer crosses a child boundary.
 */
const BG_TRANSITION_MS = 150;
const AVATAR_TRANSITION_MS = 250;
const OPACITY_TRANSITION_MS = 150;
const LEAVE_DELAY_MS = 50;

/** Shrunk-avatar scale on hover, matching Bluesky's `scale: 2/3`. */
const ACTIVE_AVATAR_SCALE = 2 / 3;

/**
 * Reads the OS "reduce motion" preference on web. Guards `window`/`matchMedia`
 * so it is safe during SSR and on native (where it is never called). When
 * reduced motion is on, the avatar transform snaps instead of transitioning.
 */
const prefersReducedMotion = (): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export interface ProfileButtonProps {
    /**
     * Expanded row (avatar + name + handle + chevron) when `true` (default), or a
     * bare avatar-only trigger when `false` (collapsed sidebar).
     */
    expanded?: boolean;
    /**
     * Avatar diameter in px. Defaults to 40 when expanded, 32 when collapsed.
     */
    avatarSize?: number;
    /** Navigate to the "Manage account" surface (settings). */
    onNavigateManage: () => void;
    /** Start the add-account / sign-in flow for an additional account. */
    onAddAccount: () => void;
    /** Optional: navigate to the signed-in user's own profile. */
    onNavigateProfile?: () => void;
    /** Called before the active identity changes so apps can clear scoped state. */
    onBeforeSessionChange?: () => void | Promise<void>;
    /**
     * Web-only popover direction relative to the trigger:
     *  - `'up'` (default): the menu opens UPWARD, for a trigger placed at the
     *    BOTTOM of a sidebar (the footer pattern). Pixel-identical to prior
     *    behavior.
     *  - `'down'`: the menu opens DOWNWARD, for a trigger placed at the TOP of a
     *    sidebar (the accounts app pattern).
     *  - `'auto'`: opens downward when there is more room below the trigger than
     *    above, otherwise upward.
     * Native (bottom-sheet) is unaffected — this only influences the web popover.
     */
    placement?: 'up' | 'down' | 'auto';
    /**
     * Extra className applied to the outer trigger. Kept for NativeWind consumers
     * that layer utility classes on top; the component's own layout is driven by
     * `StyleSheet` so it renders correctly with or without NativeWind.
     */
    className?: string;
    /** Extra style applied to the outer trigger. */
    style?: StyleProp<ViewStyle>;
}

/**
 * Self-contained sidebar account trigger, modeled on Bluesky's ProfileCard and
 * the Oxy inbox's `MailboxDrawer` footer. Owns its own open state + anchor
 * measurement, and renders {@link ProfileMenu} (the device-account switcher).
 *
 * Three auth states from {@link useAuth}:
 *  - **Undetermined** (`!isAuthResolved || isPrivateApiPending`): a neutral
 *    avatar-sized skeleton circle, no press.
 *  - **Signed in**: a pressable row — Bloom `Avatar` + display name + `@handle`
 *    + an `unfold-more-horizontal` chevron. Press opens the menu upward (web)
 *    against the measured trigger, or as a bottom sheet (native).
 *  - **Signed out**: a "Sign in" row that calls `useAuth().signIn()`.
 *
 * Styling uses react-native `StyleSheet` + the Bloom theme (via `useTheme`) so
 * the layout renders identically in EVERY consumer — including apps that do not
 * use NativeWind (e.g. the accounts app). Only the web hover animation keeps
 * dynamic inline `style` (the CSS transition/transform values), which is what
 * the `react-native-web-style.d.ts` augmentation exists for.
 *
 * All display strings resolve through `@oxyhq/core`'s
 * `getAccountDisplayName` / `getAccountFallbackHandle` — no hand-rolled name
 * fallbacks. Avatars pass the bare file id as `source` + `variant="thumb"`, so
 * the app's registered `ImageResolver` builds the thumbnail URL.
 */
const ProfileButton: React.FC<ProfileButtonProps> = ({
    expanded = true,
    avatarSize,
    onNavigateManage,
    onAddAccount,
    onNavigateProfile,
    onBeforeSessionChange,
    placement = 'up',
    className,
    style,
}) => {
    const {
        user,
        isAuthenticated,
        isAuthResolved,
        isPrivateApiPending,
        signIn,
    } = useAuth();
    const { colors } = useTheme();
    const { t, locale } = useI18n();

    const [menuOpen, setMenuOpen] = useState(false);
    const [anchor, setAnchor] = useState<ProfileMenuAnchor | null>(null);

    // Web-only hover/focus tracking for the Bluesky-style reveal animation.
    // Native has no hover, so these stay false and the row renders statically.
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);

    // Trigger ref for the web anchor measurement. RN-Web exposes `measure()` on
    // host views, so we anchor the popover to the button rect and open upward.
    const triggerRef = useRef<View | null>(null);

    const resolvedAvatarSize = avatarSize ?? (expanded ? 40 : 32);

    const openMenu = useCallback(() => {
        if (!isWeb) {
            setAnchor(null);
            setMenuOpen(true);
            return;
        }
        const node = triggerRef.current;
        if (!node || typeof node.measure !== 'function' || typeof window === 'undefined') {
            setAnchor(null);
            setMenuOpen(true);
            return;
        }
        node.measure((_x, _y, _w, height, pageX, pageY) => {
            if (typeof pageX !== 'number' || typeof pageY !== 'number') {
                setAnchor(null);
            } else {
                // Clamp the panel's left edge inside the viewport gutter.
                const maxLeft = Math.max(
                    VIEWPORT_GUTTER,
                    window.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER,
                );
                const left = Math.min(Math.max(VIEWPORT_GUTTER, pageX), maxLeft);
                // Bottom edge of the trigger in page coordinates. `height` is a
                // number for host views; guard defensively for non-web shims.
                const triggerBottom = pageY + (typeof height === 'number' ? height : 0);
                // Resolve `'auto'` by comparing the room below the trigger with
                // the room above it; pick whichever direction has more space.
                const openDown =
                    placement === 'down' ||
                    (placement === 'auto' &&
                        window.innerHeight - triggerBottom > pageY);
                if (openDown) {
                    // Anchor the panel's TOP edge just below the trigger bottom so
                    // the menu opens downward from a top-of-sidebar trigger.
                    const top = Math.max(VIEWPORT_GUTTER, triggerBottom + VIEWPORT_GUTTER);
                    setAnchor({ left, top });
                } else {
                    // Anchor the panel's BOTTOM edge just above the trigger top so
                    // the menu opens upward from this footer button.
                    const bottom = Math.max(
                        VIEWPORT_GUTTER,
                        window.innerHeight - pageY + VIEWPORT_GUTTER,
                    );
                    setAnchor({ left, bottom });
                }
            }
            setMenuOpen(true);
        });
    }, [placement]);

    const handleClose = useCallback(() => {
        setMenuOpen(false);
    }, []);

    // ── Undetermined: skeleton circle, no interaction. ──────────────────────
    if (!isAuthResolved || isPrivateApiPending) {
        return (
            <View
                className={className}
                style={style}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
            >
                <View
                    style={[
                        styles.skeletonCircle,
                        {
                            width: resolvedAvatarSize,
                            height: resolvedAvatarSize,
                            backgroundColor: colors.backgroundSecondary,
                        },
                    ]}
                />
            </View>
        );
    }

    // ── Signed out: "Sign in" row. ──────────────────────────────────────────
    if (!isAuthenticated || !user) {
        const signInLabel = t('common.actions.signIn') || 'Sign in';
        return (
            <Pressable
                className={className}
                style={[styles.row, expanded && styles.rowExpanded, style]}
                onPress={() => { void signIn(); }}
                accessibilityRole="button"
                accessibilityLabel={signInLabel}
            >
                <View
                    style={[
                        styles.avatarBadge,
                        {
                            width: resolvedAvatarSize,
                            height: resolvedAvatarSize,
                            backgroundColor: colors.backgroundSecondary,
                        },
                    ]}
                >
                    <MaterialCommunityIcons
                        name="login"
                        size={Math.round(resolvedAvatarSize * 0.5)}
                        color={colors.icon}
                    />
                </View>
                {expanded ? (
                    <Text
                        style={[styles.signInLabel, { color: colors.text }]}
                        numberOfLines={1}
                    >
                        {signInLabel}
                    </Text>
                ) : null}
            </Pressable>
        );
    }

    // ── Signed in: avatar + identity + chevron. ─────────────────────────────
    const displayName = getAccountDisplayName(user, locale);
    const handle = getAccountFallbackHandle(user);
    const handleLine = handle ? `@${handle}` : null;

    const avatarNode = (
        <Avatar
            source={user.avatar ?? undefined}
            variant="thumb"
            name={displayName}
            size={resolvedAvatarSize}
        />
    );

    // `active` combines hover, keyboard focus, and menu-open — exactly like
    // Bluesky's `state.hovered || state.focused || control.isOpen`. Only web
    // ever sets `hovered`/`focused`, so on native this reduces to `menuOpen`.
    const active = hovered || focused || menuOpen;
    const accountLabel = t('accountSwitcher.switchWhileSignedInAs', { name: displayName })
        || `Switch account, signed in as ${displayName}`;

    // Web-only pointer/focus handlers. RN-Web forwards `onHoverIn`/`onHoverOut`
    // to the underlying element; native Pressable ignores them harmlessly, but
    // we only attach them on web to keep the native path pristine.
    const webInteractionProps = isWeb
        ? {
            onHoverIn: () => setHovered(true),
            onHoverOut: () => setHovered(false),
            onFocus: () => setFocused(true),
            onBlur: () => setFocused(false),
        }
        : undefined;

    if (!expanded) {
        // Collapsed: avatar-only. On web, hovering just fades a subtle round
        // background behind the avatar — no shrink, no text.
        const collapsedBgStyle: ViewStyle | undefined = isWeb
            ? {
                backgroundColor: active ? colors.backgroundSecondary : 'transparent',
                transitionProperty: 'background-color',
                transitionDuration: `${BG_TRANSITION_MS}ms`,
                transitionDelay: active ? '0ms' : `${LEAVE_DELAY_MS}ms`,
            }
            : undefined;
        return (
            <View className={className} style={style}>
                <Pressable
                    ref={triggerRef}
                    style={[styles.collapsedTrigger, collapsedBgStyle]}
                    onPress={openMenu}
                    accessibilityRole="button"
                    accessibilityLabel={accountLabel}
                    {...webInteractionProps}
                >
                    {avatarNode}
                </Pressable>
                <ProfileMenu
                    open={menuOpen}
                    onClose={handleClose}
                    anchor={anchor}
                    onNavigateManage={onNavigateManage}
                    onAddAccount={onAddAccount}
                    onNavigateProfile={onNavigateProfile}
                    onBeforeSessionChange={onBeforeSessionChange}
                />
            </View>
        );
    }

    // ── Expanded row animation ──────────────────────────────────────────────
    // On native everything is statically visible (no hover exists). On web we
    // reproduce Bluesky's reveal: the row fills with a subtle contrast bg, the
    // avatar shrinks + slides left, and the name/handle/chevron fade in. The
    // negative left margin tucks the identity block under the shrunk avatar so
    // it slides out from behind it as the avatar contracts.
    const reducedMotion = isWeb && prefersReducedMotion();

    // Slide the shrunk avatar left so its visual left edge stays put as it
    // contracts. The avatar loses `size * (1 - scale)` of width; half of that
    // (the left half, since scale is centered) is the offset, plus the row's
    // left padding (8px) so it hugs the row edge like Bluesky's.
    const activeAvatarTranslateX =
        -(resolvedAvatarSize * (1 - ACTIVE_AVATAR_SCALE)) / 2 - 8;

    const rowStyle: StyleProp<ViewStyle> = isWeb
        ? {
            backgroundColor: active ? colors.backgroundSecondary : 'transparent',
            transitionProperty: 'background-color',
            transitionDuration: `${BG_TRANSITION_MS}ms`,
            transitionDelay: active ? '0ms' : `${LEAVE_DELAY_MS}ms`,
        }
        : undefined;

    const avatarWrapperStyle: ViewStyle | undefined = isWeb
        ? {
            zIndex: 10,
            ...(reducedMotion
                ? {}
                : {
                    transitionProperty: 'transform',
                    transitionDuration: `${AVATAR_TRANSITION_MS}ms`,
                    transitionDelay: active ? '0ms' : `${LEAVE_DELAY_MS}ms`,
                }),
            transform: active
                ? [{ scale: ACTIVE_AVATAR_SCALE }, { translateX: activeAvatarTranslateX }]
                : [{ scale: 1 }, { translateX: 0 }],
        }
        : undefined;

    const identityStyle: ViewStyle | undefined = isWeb
        ? {
            marginLeft: -resolvedAvatarSize / 2,
            opacity: active ? 1 : 0,
            transitionProperty: 'opacity',
            transitionDuration: `${OPACITY_TRANSITION_MS}ms`,
            transitionDelay: active ? '0ms' : `${LEAVE_DELAY_MS}ms`,
        }
        : undefined;

    const chevronStyle: ViewStyle | undefined = isWeb
        ? {
            opacity: active ? 1 : 0,
            transitionProperty: 'opacity',
            transitionDuration: `${OPACITY_TRANSITION_MS}ms`,
            transitionDelay: active ? '0ms' : `${LEAVE_DELAY_MS}ms`,
        }
        : undefined;

    return (
        <View className={className} style={[styles.fullWidth, style]}>
            <Pressable
                ref={triggerRef}
                style={[styles.row, styles.rowExpanded, rowStyle]}
                onPress={openMenu}
                accessibilityRole="button"
                accessibilityLabel={accountLabel}
                {...webInteractionProps}
            >
                <View style={avatarWrapperStyle}>{avatarNode}</View>
                <View style={[styles.identity, identityStyle]}>
                    <Text
                        style={[styles.displayName, { color: colors.text }]}
                        numberOfLines={1}
                    >
                        {displayName}
                    </Text>
                    {handleLine ? (
                        <Text
                            style={[styles.handle, { color: colors.textSecondary }]}
                            numberOfLines={1}
                        >
                            {handleLine}
                        </Text>
                    ) : null}
                </View>
                <View style={chevronStyle}>
                    <MaterialCommunityIcons
                        name="dots-horizontal"
                        size={18}
                        color={colors.textSecondary}
                    />
                </View>
            </Pressable>
            <ProfileMenu
                open={menuOpen}
                onClose={handleClose}
                anchor={anchor}
                onNavigateManage={onNavigateManage}
                onAddAccount={onAddAccount}
                onNavigateProfile={onNavigateProfile}
                onBeforeSessionChange={onBeforeSessionChange}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    fullWidth: {
        width: '100%',
    },
    // Neutral skeleton / signed-out avatar circle (`rounded-full`).
    skeletonCircle: {
        borderRadius: 9999,
    },
    // Shared trigger row (`flex-row items-center gap-3 rounded-full px-2 py-2`).
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 9999,
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    // `w-full` on the expanded row + its signed-out variant.
    rowExpanded: {
        width: '100%',
    },
    // Signed-out login badge (`items-center justify-center rounded-full`).
    avatarBadge: {
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9999,
    },
    // Signed-out label (`flex-1 font-semibold`).
    signInLabel: {
        flex: 1,
        fontWeight: '600',
    },
    // Collapsed avatar-only trigger (`rounded-full`).
    collapsedTrigger: {
        borderRadius: 9999,
    },
    // Identity block (`min-w-0 flex-1`).
    identity: {
        flex: 1,
        minWidth: 0,
    },
    // Display name (`font-bold`).
    displayName: {
        fontWeight: '700',
    },
    // Handle line (`text-xs`).
    handle: {
        fontSize: 12,
    },
});

export default ProfileButton;

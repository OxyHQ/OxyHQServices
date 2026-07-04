import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import {
    View,
    Pressable,
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
import AccountSwitcher, { type AccountMenuAnchor } from './AccountSwitcher';
import { showBottomSheet } from '../navigation/bottomSheetManager';

const isWeb = Platform.OS === 'web';

/**
 * Fixed popover width used by {@link AccountSwitcher} on web (its `PANEL_WIDTH`).
 * `ProfileButton` mirrors this constant when computing the trigger-relative
 * anchor so the left-edge clamp keeps the panel fully on-screen. Keep in sync.
 */
const MENU_WIDTH = 380;

/** Gutter, in px, kept between the popover and the viewport edges on web. */
const VIEWPORT_GUTTER = 8;

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
    /** Called before the active identity changes so apps can clear scoped state. */
    onBeforeSessionChange?: () => void | Promise<void>;
    /** Extra className applied to the outer trigger. */
    className?: string;
    /** Extra style applied to the outer trigger. */
    style?: StyleProp<ViewStyle>;
}

/**
 * Self-contained sidebar account trigger, modeled on Bluesky's ProfileCard and
 * the Oxy inbox's `MailboxDrawer` footer. Owns its own open state + anchor
 * measurement, and renders {@link AccountSwitcher} (the unified switcher).
 *
 * Three auth states from {@link useAuth}:
 *  - **Undetermined** (`!isAuthResolved || isPrivateApiPending`): a neutral
 *    avatar-sized skeleton circle, no press.
 *  - **Signed in**: a pressable row — Bloom `Avatar` + display name + `@handle`
 *    + an `unfold-more-horizontal` chevron. Press opens the menu upward (web)
 *    against the measured trigger, or as a bottom sheet (native).
 *  - **Signed out**: a "Sign in" row that calls `useAuth().signIn()`.
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
    onBeforeSessionChange,
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
    const [anchor, setAnchor] = useState<AccountMenuAnchor | null>(null);

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
        node.measure((_x, _y, _w, _h, pageX, pageY) => {
            if (typeof pageX !== 'number' || typeof pageY !== 'number') {
                setAnchor(null);
            } else {
                // Clamp the panel's left edge inside the viewport gutter.
                const maxLeft = Math.max(
                    VIEWPORT_GUTTER,
                    window.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER,
                );
                const left = Math.min(Math.max(VIEWPORT_GUTTER, pageX), maxLeft);
                // Anchor the panel's BOTTOM edge just above the trigger top so
                // the menu opens upward from this footer button.
                const bottom = Math.max(
                    VIEWPORT_GUTTER,
                    window.innerHeight - pageY + VIEWPORT_GUTTER,
                );
                setAnchor({ left, bottom });
            }
            setMenuOpen(true);
        });
    }, []);

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
                    className="rounded-full bg-secondary"
                    style={{ width: resolvedAvatarSize, height: resolvedAvatarSize }}
                />
            </View>
        );
    }

    // ── Signed out: "Sign in" row. ──────────────────────────────────────────
    if (!isAuthenticated || !user) {
        const signInLabel = t('common.actions.signIn') || 'Sign in';
        return (
            <Pressable
                className={`flex-row items-center gap-3 rounded-full px-2 py-2 ${className ?? ''}`}
                style={style}
                onPress={() => { void signIn(); }}
                accessibilityRole="button"
                accessibilityLabel={signInLabel}
            >
                <View
                    className="items-center justify-center rounded-full bg-secondary"
                    style={{ width: resolvedAvatarSize, height: resolvedAvatarSize }}
                >
                    <MaterialCommunityIcons
                        name="login"
                        size={Math.round(resolvedAvatarSize * 0.5)}
                        color={colors.icon}
                    />
                </View>
                {expanded ? (
                    <Text
                        className="flex-1 font-semibold text-foreground"
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

    if (!expanded) {
        return (
            <View className={className} style={style}>
                <Pressable
                    ref={triggerRef}
                    className="rounded-full"
                    onPress={openMenu}
                    accessibilityRole="button"
                    accessibilityLabel={t('accountSwitcher.switchWhileSignedInAs', { name: displayName })
                        || `Switch account, signed in as ${displayName}`}
                >
                    {avatarNode}
                </Pressable>
                <AccountSwitcher
                    open={menuOpen}
                    onClose={handleClose}
                    anchor={anchor}
                    onNavigateManage={onNavigateManage}
                    onAddAccount={onAddAccount}
                    onCreateAccount={() => showBottomSheet('CreateAccount')}
                    onOpenAccountSettings={(accountId) =>
                        showBottomSheet({ screen: 'AccountSettings', props: { accountId } })
                    }
                    onBeforeSessionChange={onBeforeSessionChange}
                />
            </View>
        );
    }

    return (
        <View className={className} style={style}>
            <Pressable
                ref={triggerRef}
                className="flex-row items-center gap-3 rounded-full px-2 py-2"
                onPress={openMenu}
                accessibilityRole="button"
                accessibilityLabel={t('accountSwitcher.switchWhileSignedInAs', { name: displayName })
                    || `Switch account, signed in as ${displayName}`}
            >
                {avatarNode}
                <View className="min-w-0 flex-1">
                    <Text className="font-bold text-foreground" numberOfLines={1}>
                        {displayName}
                    </Text>
                    {handleLine ? (
                        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                            {handleLine}
                        </Text>
                    ) : null}
                </View>
                <MaterialCommunityIcons
                    name="unfold-more-horizontal"
                    size={18}
                    color={colors.textSecondary}
                />
            </Pressable>
            <AccountSwitcher
                open={menuOpen}
                onClose={handleClose}
                anchor={anchor}
                onNavigateManage={onNavigateManage}
                onAddAccount={onAddAccount}
                onCreateAccount={() => showBottomSheet('CreateAccount')}
                onOpenAccountSettings={(accountId) =>
                    showBottomSheet({ screen: 'AccountSettings', props: { accountId } })
                }
                onBeforeSessionChange={onBeforeSessionChange}
            />
        </View>
    );
};

export default ProfileButton;

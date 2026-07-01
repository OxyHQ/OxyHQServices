import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
    View,
    Pressable,
    Modal,
    ScrollView,
    ActivityIndicator,
    StyleSheet,
    Platform,
    type ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Avatar } from '@oxyhq/bloom/avatar';
import { Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import { toast, useDialogControl, Dialog } from '@oxyhq/bloom';
import { Divider } from '@oxyhq/bloom/divider';
import { isDev, logger as loggerUtil } from '@oxyhq/core';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import { useDeviceAccounts } from '../hooks/useDeviceAccounts';

const isWeb = Platform.OS === 'web';

/** Fixed popover width on web. `ProfileButton` mirrors this when anchoring. */
const MENU_WIDTH = 300;

/**
 * Web-only anchor. `ProfileButton` measures its trigger and anchors the panel to
 * one corner so the menu opens either UPWARD (footer trigger) or DOWNWARD (a
 * trigger at the top of a sidebar). Exactly ONE vertical edge is pinned:
 *  - `bottom` set → the panel's BOTTOM edge is anchored, so it opens UPWARD.
 *  - `top` set → the panel's TOP edge is anchored, so it opens DOWNWARD.
 * Native ignores the anchor and docks the panel to the bottom as a sheet.
 */
export interface ProfileMenuAnchor {
    /** Distance from the viewport left, for the panel's LEFT edge. */
    left: number;
    /** Distance from the viewport bottom, for the panel's BOTTOM edge (opens upward). */
    bottom?: number;
    /** Distance from the viewport top, for the panel's TOP edge (opens downward). */
    top?: number;
}

export interface ProfileMenuProps {
    open: boolean;
    onClose: () => void;
    /** Web-only trigger anchor. Native ignores this (bottom-sheet style). */
    anchor?: ProfileMenuAnchor | null;
    /** Navigate to the "Manage account" surface (settings). */
    onNavigateManage: () => void;
    /** Start the add-account / sign-in flow for an additional account. */
    onAddAccount: () => void;
    /** Optional: navigate to the signed-in user's own profile. */
    onNavigateProfile?: () => void;
    /** Called before the active identity changes so apps can clear scoped state. */
    onBeforeSessionChange?: () => void | Promise<void>;
}

/** Everything `ProfileMenuContent` needs, minus the `open` flag (always open). */
type ProfileMenuContentProps = Omit<ProfileMenuProps, 'open'>;

/**
 * Clean device-account switcher, modeled on the inbox `AccountMenu` and styled
 * with react-native `StyleSheet` + the Bloom theme (via `useTheme`) so it
 * renders in EVERY consumer regardless of NativeWind. Lists every account
 * signed in on this device (from {@link useDeviceAccounts}); tapping a row
 * switches, and each inactive row carries a sign-out icon. Below the list:
 * Add account, Manage account, optional View profile, and Sign out of all.
 *
 * Heavy hooks (device accounts / refresh-all, Bloom dialog/toast controls, the
 * escape-key listener) live here so they run ONLY while the menu is open — the
 * outer {@link ProfileMenu} mounts this only when `open`. This component may
 * therefore assume it is always open.
 */
const ProfileMenuContent: React.FC<ProfileMenuContentProps> = ({
    onClose,
    onNavigateManage,
    onAddAccount,
    onNavigateProfile,
    onBeforeSessionChange,
}) => {
    const {
        activeSessionId,
        switchSession,
        logoutAll,
        removeSession,
    } = useOxy();
    const { t } = useI18n();
    const { colors } = useTheme();

    const { accounts } = useDeviceAccounts();

    const [busySessionId, setBusySessionId] = useState<string | null>(null);
    const [removingSessionId, setRemovingSessionId] = useState<string | null>(null);
    const [signingOutAll, setSigningOutAll] = useState(false);

    const signOutAllDialog = useDialogControl();

    const isSwitching = busySessionId !== null;
    const actionDisabled = isSwitching || removingSessionId !== null || signingOutAll;

    // Switch to a non-active account through the SDK's canonical switch path.
    const handleSwitch = useCallback(async (sessionId: string) => {
        if (sessionId === activeSessionId || busySessionId) {
            return;
        }
        setBusySessionId(sessionId);
        try {
            await onBeforeSessionChange?.();
            await switchSession(sessionId);
            toast.success(t('accountSwitcher.toasts.switchSuccess') || 'Switched account');
            onClose();
        } catch (error) {
            if (!isDev()) {
                loggerUtil.warn('Switch account failed', { component: 'ProfileMenu' }, error as unknown);
            }
            toast.error(t('accountSwitcher.toasts.switchFailed') || 'Failed to switch account');
        } finally {
            setBusySessionId(null);
        }
    }, [activeSessionId, busySessionId, switchSession, t, onClose, onBeforeSessionChange]);

    // Sign out a specific inactive account without switching/clearing the active
    // one. The menu stays open so the user can keep managing accounts.
    const handleRemove = useCallback(async (sessionId: string) => {
        if (sessionId === activeSessionId || removingSessionId) {
            return;
        }
        setRemovingSessionId(sessionId);
        try {
            await removeSession(sessionId);
            toast.success(t('common.actions.signedOut') || 'Signed out');
        } catch (error) {
            loggerUtil.warn('Remove account failed', { component: 'ProfileMenu' }, error as unknown);
            toast.error(t('common.errors.signOutFailed') || 'Failed to sign out');
        } finally {
            setRemovingSessionId(null);
        }
    }, [activeSessionId, removingSessionId, removeSession, t]);

    const performSignOutAll = useCallback(async () => {
        if (signingOutAll) {
            return;
        }
        setSigningOutAll(true);
        try {
            await onBeforeSessionChange?.();
            await logoutAll();
            toast.success(t('accountSwitcher.toasts.signOutAllSuccess') || 'Signed out of all accounts');
            onClose();
        } catch (error) {
            loggerUtil.warn('Sign out all failed', { component: 'ProfileMenu' }, error as unknown);
            toast.error(t('common.errors.signOutAllFailed') || 'Failed to sign out of all accounts');
        } finally {
            setSigningOutAll(false);
        }
    }, [signingOutAll, logoutAll, t, onClose, onBeforeSessionChange]);

    // Escape-to-close (web only). This component only mounts while open, so the
    // listener is attached exactly for the menu's lifetime.
    useEffect(() => {
        if (!isWeb || typeof document === 'undefined') {
            return undefined;
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    return (
        <>
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* 1) Device accounts — active first (checkmark), others switchable. */}
                {accounts.map((account) => {
                    const isActive = account.isCurrent;
                    const isBusy = busySessionId === account.sessionId;
                    const isRemoving = removingSessionId === account.sessionId;
                    return (
                        <Pressable
                            key={`account-${account.sessionId}`}
                            accessibilityRole="menuitem"
                            accessibilityLabel={account.displayName}
                            accessibilityState={{ selected: isActive }}
                            onPress={() => handleSwitch(account.sessionId)}
                            disabled={isActive || isBusy || isSwitching}
                            style={[
                                styles.accountRow,
                                isActive && { backgroundColor: colors.backgroundSecondary },
                                isSwitching && !isActive && styles.rowDimmed,
                            ]}
                        >
                            <Avatar
                                source={account.user.avatar ?? undefined}
                                uri={account.avatarUrl}
                                variant="thumb"
                                name={account.displayName}
                                size={isActive ? 40 : 32}
                            />
                            <View style={styles.accountInfo}>
                                <Text
                                    style={[
                                        isActive ? styles.accountNameActive : styles.accountName,
                                        { color: colors.text },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {account.displayName}
                                </Text>
                                {account.email ? (
                                    <Text
                                        style={[styles.accountEmail, { color: colors.textSecondary }]}
                                        numberOfLines={1}
                                    >
                                        {account.email}
                                    </Text>
                                ) : null}
                            </View>
                            {isBusy ? (
                                <ActivityIndicator color={colors.primary} size="small" />
                            ) : isActive ? (
                                <MaterialCommunityIcons name="check" size={20} color={colors.primary} />
                            ) : isRemoving ? (
                                <ActivityIndicator color={colors.textSecondary} size="small" />
                            ) : (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                        t('accountMenu.signOutAccount', { name: account.displayName })
                                        || `Sign out ${account.displayName}`
                                    }
                                    onPress={() => handleRemove(account.sessionId)}
                                    disabled={actionDisabled}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    style={styles.rowSignOutButton}
                                >
                                    <MaterialCommunityIcons
                                        name="logout"
                                        size={18}
                                        color={colors.textSecondary}
                                    />
                                </Pressable>
                            )}
                        </Pressable>
                    );
                })}

                {/* 2) Switching indicator. */}
                {isSwitching ? (
                    <View style={styles.switchingRow}>
                        <ActivityIndicator color={colors.textSecondary} size="small" />
                        <Text style={[styles.switchingText, { color: colors.textSecondary }]}>
                            {t('accountMenu.switching') || 'Switching account…'}
                        </Text>
                    </View>
                ) : null}

                <Divider color={colors.border} spacing={4} />

                {/* 3) Add another account. */}
                <ActionRow
                    icon="account-plus-outline"
                    iconColor={colors.icon}
                    textColor={colors.text}
                    label={t('accountMenu.addAnother') || 'Add another account'}
                    disabled={actionDisabled}
                    onPress={() => {
                        onClose();
                        onAddAccount();
                    }}
                />

                {/* 4) Manage account. */}
                <ActionRow
                    icon="cog-outline"
                    iconColor={colors.icon}
                    textColor={colors.text}
                    label={t('accountMenu.manage') || 'Manage your Oxy Account'}
                    disabled={actionDisabled}
                    onPress={() => {
                        onClose();
                        onNavigateManage();
                    }}
                />

                {/* 5) View profile (optional). */}
                {onNavigateProfile ? (
                    <ActionRow
                        icon="account-outline"
                        iconColor={colors.icon}
                        textColor={colors.text}
                        label={t('accountMenu.viewProfile') || 'View profile'}
                        disabled={actionDisabled}
                        onPress={() => {
                            onClose();
                            onNavigateProfile();
                        }}
                    />
                ) : null}

                {/* 6) Sign out of all accounts. */}
                <Divider color={colors.border} spacing={4} />
                <Pressable
                    accessibilityRole="menuitem"
                    accessibilityLabel={t('accountMenu.signOutAll') || 'Sign out of all accounts'}
                    onPress={() => signOutAllDialog.open()}
                    disabled={actionDisabled}
                    style={[styles.signOutAllRow, actionDisabled && styles.rowDimmed]}
                >
                    {signingOutAll ? (
                        <ActivityIndicator color={colors.error} size="small" />
                    ) : (
                        <MaterialCommunityIcons name="logout" size={18} color={colors.error} />
                    )}
                    <Text style={[styles.actionText, { color: colors.error }]}>
                        {t('accountMenu.signOutAll') || 'Sign out of all accounts'}
                    </Text>
                </Pressable>
            </ScrollView>

            <Dialog
                control={signOutAllDialog}
                title={t('accountMenu.signOutAll') || 'Sign out of all accounts'}
                description={t('common.confirms.signOutAll') || 'Are you sure you want to sign out of all accounts?'}
                actions={[
                    {
                        label: t('accountMenu.signOutAll') || 'Sign out of all accounts',
                        color: 'destructive',
                        onPress: performSignOutAll,
                    },
                    { label: t('common.cancel') || 'Cancel', color: 'cancel' },
                ]}
            />
        </>
    );
};

/**
 * Public wrapper. The RN `Modal` shell is ALWAYS mounted (only `visible` toggles)
 * so the react-native-web portal is created up front — mounting a web `Modal`
 * already-`visible` is fragile (the first interaction can be eaten / the button
 * "does nothing"). Only the heavy {@link ProfileMenuContent} mounts when open,
 * keeping the account hooks off the render path when the menu is closed. On
 * native that closed render is `<Modal visible={false}>{null}</Modal>` → no heavy
 * hooks run (preserving the native-drawer crash fix).
 *
 * This outer component calls ONLY light, always-safe hooks (`useTheme`,
 * `useI18n` for the overlay a11y label) and computes the panel/overlay layout.
 */
const ProfileMenu: React.FC<ProfileMenuProps> = ({
    open,
    onClose,
    anchor,
    onNavigateManage,
    onAddAccount,
    onNavigateProfile,
    onBeforeSessionChange,
}) => {
    const { t } = useI18n();
    const { colors } = useTheme();

    // Web: anchor the panel to the measured trigger. When the anchor pins `top`
    // the panel opens DOWNWARD from the trigger; otherwise it pins `bottom` and
    // opens UPWARD (the default footer behavior). With no anchor captured, fall
    // back to a bottom-left placement. Native ignores this (the panel docks to
    // the bottom via the overlay's flex-end).
    const panelAnchorStyle: ViewStyle | undefined = isWeb
        ? {
            position: 'absolute',
            width: MENU_WIDTH,
            left: anchor?.left ?? 8,
            ...(typeof anchor?.top === 'number'
                ? { top: anchor.top }
                : { bottom: anchor?.bottom ?? 8 }),
        }
        : undefined;

    return (
        <Modal
            visible={open}
            transparent
            animationType={isWeb ? 'fade' : 'slide'}
            onRequestClose={onClose}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.actions.close') || 'Close'}
                onPress={onClose}
                style={isWeb ? styles.webOverlay : styles.nativeOverlay}
            >
                <Pressable
                    // Swallow taps inside the panel so they never reach the overlay's
                    // outside-tap-to-close handler.
                    onPress={() => undefined}
                    style={[
                        isWeb ? styles.panelWeb : styles.panelNative,
                        { backgroundColor: colors.background },
                        isWeb && { borderColor: colors.border },
                        panelAnchorStyle,
                        styles.panelBounds,
                        styles.shadow,
                    ]}
                    accessibilityRole="menu"
                    accessibilityLabel={t('accountMenu.label') || 'Account menu'}
                >
                    {open ? (
                        <ProfileMenuContent
                            onClose={onClose}
                            anchor={anchor}
                            onNavigateManage={onNavigateManage}
                            onAddAccount={onAddAccount}
                            onNavigateProfile={onNavigateProfile}
                            onBeforeSessionChange={onBeforeSessionChange}
                        />
                    ) : null}
                </Pressable>
            </Pressable>
        </Modal>
    );
};

/** Bottom-section action row (Add account / Manage / View profile). */
const ActionRow: React.FC<{
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    iconColor: string;
    textColor: string;
    label: string;
    disabled: boolean;
    onPress: () => void;
}> = ({ icon, iconColor, textColor, label, disabled, onPress }) => (
    <Pressable
        accessibilityRole="menuitem"
        accessibilityLabel={label}
        onPress={onPress}
        disabled={disabled}
        style={[styles.actionRow, disabled && styles.rowDimmed]}
    >
        <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
        <Text style={[styles.actionText, { color: textColor }]}>{label}</Text>
    </Pressable>
);

const styles = StyleSheet.create({
    // Overlay (`flex-1 relative` web / `flex-1 justify-end` + scrim native).
    webOverlay: {
        flex: 1,
        position: 'relative',
    },
    nativeOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.32)',
    },
    // Panel shell — web popover (`overflow-hidden rounded-2xl border`).
    panelWeb: {
        overflow: 'hidden',
        borderRadius: 16,
        borderWidth: 1,
    },
    // Panel shell — native bottom sheet (`overflow-hidden rounded-t-3xl pb-3`).
    panelNative: {
        overflow: 'hidden',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingBottom: 12,
    },
    // Shared `maxHeight: '85%'` cap applied to both panel variants.
    panelBounds: {
        maxHeight: '85%',
    },
    // The panel's drop shadow — dynamic elevation with no class equivalent.
    shadow: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
    },
    // Scroll region (`grow-0` + `py-1` content).
    scroll: {
        flexGrow: 0,
    },
    scrollContent: {
        paddingVertical: 4,
    },
    // Account row (`flex-row items-center gap-3 px-4 py-2.5`).
    accountRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    // `opacity-40` dim applied to disabled / non-active-while-switching rows.
    rowDimmed: {
        opacity: 0.4,
    },
    // Identity block (`min-w-0 flex-1`).
    accountInfo: {
        flex: 1,
        minWidth: 0,
    },
    // Inactive account name (`font-medium`).
    accountName: {
        fontWeight: '500',
    },
    // Active account name (`font-semibold`).
    accountNameActive: {
        fontWeight: '600',
    },
    // Secondary email line (`text-xs`).
    accountEmail: {
        fontSize: 12,
    },
    // Per-row sign-out button (`h-7 w-7 items-center justify-center rounded-full opacity-60`).
    rowSignOutButton: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9999,
        opacity: 0.6,
    },
    // Switching indicator (`flex-row items-center justify-center gap-2 py-2`).
    switchingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 8,
    },
    switchingText: {
        fontSize: 12,
        fontWeight: '500',
    },
    // Bottom action rows (`flex-row items-center gap-3 px-4 py-3`).
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    // Sign-out-of-all row shares the action-row geometry.
    signOutAllRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    // Action / sign-out label (`font-medium`).
    actionText: {
        fontWeight: '500',
    },
});

export default ProfileMenu;

import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    View,
    Pressable,
    Modal,
    ScrollView,
    ActivityIndicator,
    Platform,
    StyleSheet,
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
import { useSwitchableAccounts, type SwitchableAccount } from '../hooks/useSwitchableAccounts';

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

/**
 * Clean account switcher, written with react-native `StyleSheet` + Bloom
 * theme colors (the package convention — no NativeWind, which is only an
 * optional peer and absent in the primary `accounts` consumer). Lists EVERY
 * switchable account from {@link useSwitchableAccounts}
 * — device sign-ins AND linked graph accounts (owned orgs + shared-with-you) —
 * and routes EVERY switch through the context's single
 * `switchToAccount(accountId)` dispatcher (there is no separate device-only
 * path). Each on-device inactive row carries a per-account sign-out icon;
 * graph-only rows carry a role badge and indent under their parent. Below the
 * list: Add account, Manage account, optional View profile, and Sign out of all.
 *
 * Renders as an upward-opening popover anchored to the trigger on web, and a
 * bottom-sheet style modal on native.
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
    const {
        switchToAccount,
        logoutAll,
        removeSession,
    } = useOxy();
    const { t } = useI18n();
    const { colors } = useTheme();

    const { accounts } = useSwitchableAccounts();

    const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
    const [removingSessionId, setRemovingSessionId] = useState<string | null>(null);
    const [signingOutAll, setSigningOutAll] = useState(false);

    const signOutAllDialog = useDialogControl();

    const isSwitching = busyAccountId !== null;
    const actionDisabled = isSwitching || removingSessionId !== null || signingOutAll;

    // Account ids currently in the list — used to decide whether a graph-only
    // row is a CHILD (its parent is also shown) so it can be indented.
    const listedAccountIds = useMemo(
        () => new Set(accounts.map((account) => account.accountId)),
        [accounts],
    );

    // The ONE uniform switch path: every row (device or linked) routes through
    // `switchToAccount(accountId)`. It reuses the device session when the account
    // is already signed in here, and mints one only on first entry.
    const handleSwitch = useCallback(async (account: SwitchableAccount) => {
        if (account.isCurrent || busyAccountId) {
            return;
        }
        setBusyAccountId(account.accountId);
        try {
            await onBeforeSessionChange?.();
            await switchToAccount(account.accountId);
            toast.success(t('accountSwitcher.toasts.switchSuccess') || 'Switched account');
            onClose();
        } catch (error) {
            if (!isDev()) {
                loggerUtil.warn('Switch account failed', { component: 'ProfileMenu' }, error as unknown);
            }
            toast.error(t('accountSwitcher.toasts.switchFailed') || 'Failed to switch account');
        } finally {
            setBusyAccountId(null);
        }
    }, [busyAccountId, switchToAccount, t, onClose, onBeforeSessionChange]);

    // Sign out a specific inactive account without switching/clearing the active
    // one. The menu stays open so the user can keep managing accounts.
    const handleRemove = useCallback(async (sessionId: string) => {
        if (removingSessionId) {
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
    }, [removingSessionId, removeSession, t]);

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

    // Escape-to-close (web only).
    useEffect(() => {
        if (!open || !isWeb || typeof document === 'undefined') {
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
    }, [open, onClose]);

    if (!open) {
        return null;
    }

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

    const content = (
        <Pressable
            // Swallow taps inside the panel so they never reach the overlay's
            // outside-tap-to-close handler.
            onPress={() => undefined}
            style={[
                isWeb ? styles.panelWeb : styles.panelNative,
                { backgroundColor: colors.background },
                isWeb ? { borderColor: colors.border } : null,
                panelAnchorStyle,
                styles.panelBounds,
                styles.shadow,
            ]}
            accessibilityRole="menu"
            accessibilityLabel={t('accountMenu.label') || 'Account menu'}
        >
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* 1) Every switchable account — device sign-ins AND linked graph
                    accounts. Active first (checkmark); on-device rows carry a
                    per-account sign-out icon; graph-only rows show a role badge
                    and indent under their parent. Every row switches through the
                    SAME `switchToAccount(accountId)` path. */}
                {accounts.map((account) => {
                    const isActive = account.isCurrent;
                    const isBusy = busyAccountId === account.accountId;
                    const sessionId = account.sessionId;
                    const isRemoving = sessionId ? removingSessionId === sessionId : false;
                    const isChild = Boolean(
                        account.parentAccountId && listedAccountIds.has(account.parentAccountId),
                    );
                    const role = account.callerMembership?.role;
                    return (
                        <Pressable
                            key={`account-${account.accountId}`}
                            accessibilityRole="menuitem"
                            accessibilityLabel={account.displayName}
                            accessibilityState={{ selected: isActive }}
                            onPress={() => handleSwitch(account)}
                            disabled={isActive || isBusy || isSwitching}
                            style={[
                                styles.accountRow,
                                isChild && styles.childRow,
                                isActive && { backgroundColor: colors.backgroundSecondary },
                                isSwitching && !isActive && styles.rowDimmed,
                            ]}
                        >
                            <Avatar
                                source={account.user.avatar ?? undefined}
                                uri={account.avatarUrl}
                                variant="thumb"
                                name={account.displayName}
                                size={isActive ? 40 : isChild ? 28 : 32}
                            />
                            <View style={styles.accountInfo}>
                                <View style={styles.nameRow}>
                                    <Text
                                        style={[
                                            styles.accountName,
                                            { color: colors.text },
                                            isActive && styles.accountNameActive,
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {account.displayName}
                                    </Text>
                                    {role ? (
                                        <View style={[styles.roleBadge, { backgroundColor: colors.card }]}>
                                            <Text style={[styles.roleBadgeText, { color: colors.textSecondary }]}>
                                                {t(`accounts.roles.${role}.label`) || role}
                                            </Text>
                                        </View>
                                    ) : null}
                                </View>
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
                            ) : sessionId ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                        t('accountMenu.signOutAccount', { name: account.displayName })
                                        || `Sign out ${account.displayName}`
                                    }
                                    onPress={() => handleRemove(sessionId)}
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
                            ) : null}
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
                    style={[styles.actionRow, actionDisabled && styles.rowDimmed]}
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
        </Pressable>
    );

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
                {content}
            </Pressable>

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
    // Overlay: web is a positioning context for the anchored panel; native dims
    // the backdrop and docks the sheet to the bottom.
    webOverlay: {
        flex: 1,
        position: 'relative',
    },
    nativeOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.32)',
    },
    // Panel shell — web popover / native bottom sheet.
    panelWeb: {
        overflow: 'hidden',
        borderRadius: 16,
        borderWidth: 1,
    },
    panelNative: {
        overflow: 'hidden',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingBottom: 12,
    },
    // Shared height cap applied to both panel variants.
    panelBounds: {
        maxHeight: '85%',
    },
    // The panel's drop shadow (dynamic elevation).
    shadow: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
    },
    scroll: {
        flexGrow: 0,
    },
    scrollContent: {
        paddingVertical: 4,
    },
    accountRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    childRow: {
        paddingLeft: 40,
    },
    rowDimmed: {
        opacity: 0.4,
    },
    accountInfo: {
        flex: 1,
        minWidth: 0,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    accountName: {
        fontWeight: '500',
        flexShrink: 1,
    },
    accountNameActive: {
        fontWeight: '600',
    },
    accountEmail: {
        fontSize: 12,
    },
    roleBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 8,
    },
    roleBadgeText: {
        fontSize: 10,
        fontWeight: '600',
        textTransform: 'capitalize',
    },
    rowSignOutButton: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9999,
        opacity: 0.6,
    },
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
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    actionText: {
        fontWeight: '500',
    },
});

export default ProfileMenu;

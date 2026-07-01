import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
    View,
    Pressable,
    Modal,
    ScrollView,
    ActivityIndicator,
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
 * Web-only anchor. `ProfileButton` measures its trigger and anchors the panel's
 * BOTTOM-LEFT corner so the menu opens UPWARD from the sidebar footer. Native
 * ignores the anchor and docks the panel to the bottom as a sheet.
 */
export interface ProfileMenuAnchor {
    /** Distance from the viewport left, for the panel's LEFT edge. */
    left: number;
    /** Distance from the viewport bottom, for the panel's BOTTOM edge (opens upward). */
    bottom: number;
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
 * Clean device-account switcher, modeled on the inbox `AccountMenu` but written
 * fresh with NativeWind classNames + Bloom primitives. Lists every account
 * signed in on this device (from {@link useDeviceAccounts}); tapping a row
 * switches, and each inactive row carries a sign-out icon. Below the list:
 * Add account, Manage account, optional View profile, and Sign out of all.
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

    // Web: anchor the panel's bottom-left corner to the measured trigger, falling
    // back to a bottom-left placement when no anchor was captured. Native ignores
    // this (the panel docks to the bottom via the overlay's flex-end).
    const panelAnchorStyle: ViewStyle | undefined = isWeb
        ? {
            position: 'absolute',
            width: MENU_WIDTH,
            left: anchor?.left ?? 8,
            bottom: anchor?.bottom ?? 8,
        }
        : undefined;

    const content = (
        <Pressable
            // Swallow taps inside the panel so they never reach the overlay's
            // outside-tap-to-close handler.
            onPress={() => undefined}
            className={
                isWeb
                    ? 'overflow-hidden rounded-2xl border border-border bg-background'
                    : 'overflow-hidden rounded-t-3xl bg-background pb-3'
            }
            style={[
                panelAnchorStyle,
                !isWeb ? { maxHeight: '85%' } : { maxHeight: '85%' },
                styles.shadow,
            ]}
            accessibilityRole="menu"
            accessibilityLabel={t('accountMenu.label') || 'Account menu'}
        >
            <ScrollView
                className="grow-0"
                contentContainerClassName="py-1"
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
                            className={`flex-row items-center gap-3 px-4 py-2.5 ${
                                isActive ? 'bg-secondary' : ''
                            } ${isSwitching && !isActive ? 'opacity-40' : ''}`}
                        >
                            <Avatar
                                source={account.user.avatar ?? undefined}
                                uri={account.avatarUrl}
                                variant="thumb"
                                name={account.displayName}
                                size={isActive ? 40 : 32}
                            />
                            <View className="min-w-0 flex-1">
                                <Text
                                    className={`text-foreground ${isActive ? 'font-semibold' : 'font-medium'}`}
                                    numberOfLines={1}
                                >
                                    {account.displayName}
                                </Text>
                                {account.email ? (
                                    <Text
                                        className="text-xs text-muted-foreground"
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
                                    className="h-7 w-7 items-center justify-center rounded-full opacity-60"
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
                    <View className="flex-row items-center justify-center gap-2 py-2">
                        <ActivityIndicator color={colors.textSecondary} size="small" />
                        <Text className="text-xs font-medium text-muted-foreground">
                            {t('accountMenu.switching') || 'Switching account…'}
                        </Text>
                    </View>
                ) : null}

                <Divider color={colors.border} spacing={4} />

                {/* 3) Add another account. */}
                <ActionRow
                    icon="account-plus-outline"
                    iconColor={colors.icon}
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
                    className={`flex-row items-center gap-3 px-4 py-3 ${actionDisabled ? 'opacity-40' : ''}`}
                >
                    {signingOutAll ? (
                        <ActivityIndicator color={colors.error} size="small" />
                    ) : (
                        <MaterialCommunityIcons name="logout" size={18} color={colors.error} />
                    )}
                    <Text className="font-medium" style={{ color: colors.error }}>
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
                className={isWeb ? 'flex-1 relative' : 'flex-1 justify-end'}
                style={!isWeb ? styles.nativeScrim : undefined}
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
    icon: string;
    iconColor: string;
    label: string;
    disabled: boolean;
    onPress: () => void;
}> = ({ icon, iconColor, label, disabled, onPress }) => (
    <Pressable
        accessibilityRole="menuitem"
        accessibilityLabel={label}
        onPress={onPress}
        disabled={disabled}
        className={`flex-row items-center gap-3 px-4 py-3 ${disabled ? 'opacity-40' : ''}`}
    >
        <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
        <Text className="font-medium text-foreground">{label}</Text>
    </Pressable>
);

// The panel's drop shadow and the native scrim are the only values with no
// NativeWind class equivalent in this package (dynamic elevation + rgba scrim),
// so they stay as small inline objects rather than raw class-replaceable styles.
const styles = {
    shadow: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
    } satisfies ViewStyle,
    nativeScrim: {
        backgroundColor: 'rgba(0,0,0,0.32)',
    } satisfies ViewStyle,
};

export default ProfileMenu;

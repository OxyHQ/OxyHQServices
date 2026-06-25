import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Modal,
    Pressable,
    Platform,
    ActivityIndicator,
    type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { toast, useDialogControl, Dialog } from '@oxyhq/bloom';
import { Divider } from '@oxyhq/bloom/divider';
import { useTheme } from '@oxyhq/bloom/theme';
import Avatar from './Avatar';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import { logger as loggerUtil } from '@oxyhq/core';
import { buildAccountRows, type AccountRow } from './accountMenuRows';
import { useDeviceAccounts } from '../hooks/useDeviceAccounts';

/**
 * Web-only anchor for the popover panel. Each field anchors the panel against
 * one viewport edge, so the popover can be placed against ANY corner: a
 * top-right avatar chip opens downward/right-aligned (`{ top, right }`), while a
 * bottom-left account button opens upward/left-aligned (`{ bottom, left }`).
 *
 * Callers MUST supply at most one vertical edge (`top` XOR `bottom`) and at most
 * one horizontal edge (`left` XOR `right`). The panel has a fixed width and
 * `maxHeight`, so a single vertical + single horizontal edge fully positions it.
 * Supplying both opposite edges (e.g. `top` AND `bottom`) would stretch the
 * panel on RN-Web and is unsupported.
 */
export interface AccountMenuAnchor {
    /** Distance from the viewport top, when anchoring the panel's TOP edge. */
    top?: number;
    /** Distance from the viewport bottom, when anchoring the panel's BOTTOM edge (opens upward). */
    bottom?: number;
    /** Distance from the viewport left, when anchoring the panel's LEFT edge. */
    left?: number;
    /** Distance from the viewport right, when anchoring the panel's RIGHT edge. */
    right?: number;
}

export interface AccountMenuProps {
    open: boolean;
    onClose: () => void;
    onNavigateManage: () => void;
    onAddAccount: () => void;
    /** Optional anchor (web only). Native ignores this and uses bottom-sheet style. */
    anchor?: AccountMenuAnchor | null;
    /** Called before the active identity changes so apps can clear tenant-scoped state. */
    onBeforeSessionChange?: () => void | Promise<void>;
}

const isWeb = Platform.OS === 'web';

/** Fixed popover width on web. Callers that compute an anchor (e.g. inbox's
 * MailboxDrawer) key their gutter math off this — keep them consistent. */
const PANEL_WIDTH = 360;

/**
 * Unified, canonical account switcher for the Oxy ecosystem. Gmail-style: the
 * accounts list sits at the top (current account first, with a checkmark), then
 * "Add another account", "Manage account", and the sign-out actions.
 *
 * Reads everything it needs from `useOxy()` / `useDeviceAccounts()` — never
 * receives a session via props. Renders as a popover anchored to the trigger on
 * web, and as a full-width bottom-sheet style modal on native.
 */
const AccountMenu: React.FC<AccountMenuProps> = ({
    open,
    onClose,
    onNavigateManage,
    onAddAccount,
    anchor,
    onBeforeSessionChange,
}) => {
    const {
        activeSessionId,
        switchSession,
        logout,
        logoutAll,
        removeSession,
    } = useOxy();
    const { t } = useI18n();
    const bloomTheme = useTheme();
    const colors = bloomTheme.colors;

    // Source EVERY account's real name/email/avatar/color from the unified
    // device-account hook (shared apex `refresh-all` path on `*.oxy.so`, local
    // `useOxy()` fallback on cross-domain web / native). This also synthesises a
    // live-user row when the probe is empty, so the signed-in user is always
    // represented (no "Not signed in" false negative).
    const { accounts: deviceAccounts } = useDeviceAccounts();

    const [busySessionId, setBusySessionId] = useState<string | null>(null);
    const [removingSessionId, setRemovingSessionId] = useState<string | null>(null);
    const [signingOut, setSigningOut] = useState(false);
    const [signingOutAll, setSigningOutAll] = useState(false);

    const signOutDialog = useDialogControl();
    const signOutAllDialog = useDialogControl();

    const containerRef = useRef<View | null>(null);

    // Current account first, then the rest in their existing order — matching
    // the Gmail-style chooser the inbox design ports from.
    const rows = useMemo<AccountRow[]>(() => {
        const built = buildAccountRows({ accounts: deviceAccounts });
        const current = built.filter((row) => row.isActive);
        const others = built.filter((row) => !row.isActive);
        return [...current, ...others];
    }, [deviceAccounts]);

    const isSwitching = busySessionId !== null;

    // Switch to a non-active account. We route ALL rows through
    // `useOxy().switchSession(sessionId)` — the SDK's canonical switch path. On
    // WEB it already performs the same silent activation the auth chooser uses:
    // when the target `ClientSession` carries an `authuser` slot, it rotates that
    // slot via `oxyServices.refreshTokenViaCookie({ authuser })` and plants the
    // fresh access token before validating (see `useSessionManagement.switchSession`).
    // On NATIVE it validates the session id directly. There is no separate
    // "activate by authuser" SDK entry point, so reusing `switchSession`
    // (rather than inventing a parallel mechanism) keeps a single source of truth.
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
            if (!__DEV__) {
                loggerUtil.warn('Switch account failed', { component: 'AccountMenu' }, error as unknown);
            }
            toast.error(t('accountSwitcher.toasts.switchFailed') || 'Failed to switch account');
        } finally {
            setBusySessionId(null);
        }
    }, [activeSessionId, busySessionId, switchSession, t, onClose, onBeforeSessionChange]);

    // Sign out a SPECIFIC inactive account from its per-row icon. `removeSession`
    // is the SDK's canonical per-session sign-out: it targets the given session
    // id (cookie-cleared logout via `authuser` slot on web, bearer logout
    // otherwise) and removes ONLY that account without switching/clearing the
    // active session. The menu stays open so the user can keep managing accounts.
    const handleRemove = useCallback(async (sessionId: string) => {
        if (sessionId === activeSessionId || removingSessionId) {
            return;
        }
        setRemovingSessionId(sessionId);
        try {
            await removeSession(sessionId);
            toast.success(t('common.actions.signedOut') || 'Signed out');
        } catch (error) {
            loggerUtil.warn('Remove account failed', { component: 'AccountMenu' }, error as unknown);
            toast.error(t('common.errors.signOutFailed') || 'Failed to sign out');
        } finally {
            setRemovingSessionId(null);
        }
    }, [activeSessionId, removingSessionId, removeSession, t]);

    const performSignOut = useCallback(async () => {
        if (signingOut) {
            return;
        }
        setSigningOut(true);
        try {
            await onBeforeSessionChange?.();
            await logout();
            toast.success(t('common.actions.signedOut') || 'Signed out');
            onClose();
        } catch (error) {
            loggerUtil.warn('Sign out failed', { component: 'AccountMenu' }, error as unknown);
            toast.error(t('common.errors.signOutFailed') || 'Failed to sign out');
        } finally {
            setSigningOut(false);
        }
    }, [signingOut, logout, t, onClose, onBeforeSessionChange]);

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
            loggerUtil.warn('Sign out all failed', { component: 'AccountMenu' }, error as unknown);
            toast.error(t('common.errors.signOutAllFailed') || 'Failed to sign out of all accounts');
        } finally {
            setSigningOutAll(false);
        }
    }, [signingOutAll, logoutAll, t, onClose, onBeforeSessionChange]);

    // Escape-to-close + focus management (web only).
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

    const overlayStyles: ViewStyle = isWeb
        ? styles.webOverlay
        : styles.nativeOverlay;

    // Apply ONLY the edges the anchor supplies (so the panel never sets
    // conflicting opposite edges). When no anchor is provided, fall back to the
    // historical top-right placement used by `AccountMenuButton`.
    const anchorStyle: ViewStyle = anchor
        ? {
            ...(anchor.top !== undefined ? { top: anchor.top } : null),
            ...(anchor.bottom !== undefined ? { bottom: anchor.bottom } : null),
            ...(anchor.left !== undefined ? { left: anchor.left } : null),
            ...(anchor.right !== undefined ? { right: anchor.right } : null),
        }
        : { top: 64, right: 16 };

    const panelStyles: ViewStyle[] = isWeb
        ? [
            styles.panelBase,
            styles.panelWeb,
            anchorStyle,
            { backgroundColor: colors.background, borderColor: colors.border },
        ]
        : [
            styles.panelBase,
            styles.panelNative,
            { backgroundColor: colors.background },
        ];

    const actionDisabled = isSwitching || signingOut || signingOutAll;

    const content = (
        <Pressable
            ref={containerRef}
            // Swallow taps inside the panel so they never reach the overlay's
            // outside-tap-to-close handler. (On web the panel is a direct,
            // absolutely-positioned child of the overlay so the anchor resolves
            // against the viewport.)
            onPress={() => undefined}
            style={panelStyles}
            accessibilityRole="menu"
            accessibilityLabel={t('accountMenu.label') || 'Account menu'}
        >
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* 1) Accounts list — current first (checkmark), then others. */}
                {rows.map((row) => {
                    const isBusy = busySessionId === row.sessionId;
                    const isRemoving = removingSessionId === row.sessionId;
                    return (
                        <TouchableOpacity
                            key={`account-${row.sessionId}`}
                            accessibilityRole="menuitem"
                            accessibilityLabel={row.displayName}
                            accessibilityState={{ selected: row.isActive }}
                            onPress={() => handleSwitch(row.sessionId)}
                            disabled={row.isActive || isBusy || isSwitching}
                            activeOpacity={0.6}
                            style={[
                                styles.accountRow,
                                row.isActive && { backgroundColor: colors.primarySubtle },
                                isSwitching && !row.isActive && styles.rowDisabled,
                            ]}
                        >
                            <Avatar
                                uri={row.avatarUri}
                                name={row.displayName}
                                size={row.isActive ? 40 : 32}
                            />
                            <View style={styles.accountInfo}>
                                <Text
                                    style={[
                                        styles.accountName,
                                        { color: colors.text },
                                        row.isActive && styles.accountNameActive,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {row.displayName}
                                </Text>
                                {row.secondary ? (
                                    <Text
                                        style={[styles.accountEmail, { color: colors.textSecondary }]}
                                        numberOfLines={1}
                                    >
                                        {row.secondary}
                                    </Text>
                                ) : null}
                            </View>
                            {isBusy ? (
                                <ActivityIndicator color={colors.primary} size="small" />
                            ) : row.isActive ? (
                                <Ionicons name="checkmark" size={20} color={colors.primary} />
                            ) : isRemoving ? (
                                <ActivityIndicator color={colors.textSecondary} size="small" />
                            ) : (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                        t('accountMenu.signOutAccount', { name: row.displayName })
                                        || `Sign out ${row.displayName}`
                                    }
                                    onPress={() => handleRemove(row.sessionId)}
                                    disabled={isSwitching || removingSessionId !== null}
                                    activeOpacity={0.6}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    style={styles.rowSignOutButton}
                                >
                                    <Ionicons
                                        name="log-out-outline"
                                        size={18}
                                        color={colors.textSecondary}
                                    />
                                </TouchableOpacity>
                            )}
                        </TouchableOpacity>
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
                <TouchableOpacity
                    accessibilityRole="menuitem"
                    accessibilityLabel={t('accountMenu.addAnother') || 'Add another account'}
                    onPress={() => {
                        onClose();
                        onAddAccount();
                    }}
                    disabled={actionDisabled}
                    activeOpacity={0.6}
                    style={[styles.actionRow, actionDisabled && styles.rowDisabled]}
                >
                    <Ionicons name="person-add-outline" size={20} color={colors.icon} />
                    <Text style={[styles.actionText, { color: colors.text }]}>
                        {t('accountMenu.addAnother') || 'Add another account'}
                    </Text>
                </TouchableOpacity>

                <Divider color={colors.border} spacing={4} />

                {/* 4) Manage account / Settings. */}
                <TouchableOpacity
                    accessibilityRole="menuitem"
                    accessibilityLabel={t('accountMenu.manage') || 'Manage your Oxy Account'}
                    onPress={() => {
                        onClose();
                        onNavigateManage();
                    }}
                    disabled={actionDisabled}
                    activeOpacity={0.6}
                    style={[styles.actionRow, actionDisabled && styles.rowDisabled]}
                >
                    <Ionicons name="settings-outline" size={18} color={colors.icon} />
                    <Text style={[styles.actionText, { color: colors.text }]}>
                        {t('accountMenu.manage') || 'Manage your Oxy Account'}
                    </Text>
                </TouchableOpacity>

                {/* 5) Sign out (current). */}
                <TouchableOpacity
                    accessibilityRole="menuitem"
                    accessibilityLabel={t('common.actions.signOut') || 'Sign out'}
                    onPress={() => signOutDialog.open()}
                    disabled={actionDisabled}
                    activeOpacity={0.6}
                    style={[styles.actionRow, actionDisabled && styles.rowDisabled]}
                >
                    {signingOut ? (
                        <ActivityIndicator color={colors.error} size="small" />
                    ) : (
                        <Ionicons name="log-out-outline" size={18} color={colors.error} />
                    )}
                    <Text style={[styles.actionText, { color: colors.error }]}>
                        {t('common.actions.signOut') || 'Sign out'}
                    </Text>
                </TouchableOpacity>

                {/* 6) Sign out of all accounts (only when >1 account). */}
                {rows.length > 1 ? (
                    <TouchableOpacity
                        accessibilityRole="menuitem"
                        accessibilityLabel={t('accountMenu.signOutAll') || 'Sign out of all accounts'}
                        onPress={() => signOutAllDialog.open()}
                        disabled={actionDisabled}
                        activeOpacity={0.6}
                        style={[styles.actionRow, actionDisabled && styles.rowDisabled]}
                    >
                        {signingOutAll ? (
                            <ActivityIndicator color={colors.error} size="small" />
                        ) : (
                            <Ionicons name="log-out-outline" size={18} color={colors.error} />
                        )}
                        <Text style={[styles.actionText, { color: colors.error }]}>
                            {t('accountMenu.signOutAll') || 'Sign out of all accounts'}
                        </Text>
                    </TouchableOpacity>
                ) : null}
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
                style={overlayStyles}
            >
                {/*
                 * Web: the panel is `position: absolute` and rendered as a DIRECT
                 * child of the full-viewport overlay, so its anchor edges resolve
                 * against the viewport. The panel swallows its own taps.
                 *
                 * Native: the overlay is `justify-content: flex-end`, so the
                 * (statically positioned) panel docks to the bottom as a sheet.
                 */}
                {content}
            </Pressable>

            <Dialog
                control={signOutDialog}
                title={t('common.actions.signOut') || 'Sign out'}
                description={t('common.confirms.signOut') || 'Are you sure you want to sign out?'}
                actions={[
                    {
                        label: t('common.actions.signOut') || 'Sign out',
                        color: 'destructive',
                        onPress: performSignOut,
                    },
                    { label: t('common.cancel') || 'Cancel', color: 'cancel' },
                ]}
            />
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

const styles = StyleSheet.create({
    webOverlay: {
        flex: 1,
        backgroundColor: 'transparent',
        // Explicit positioning context: the absolutely-positioned panel is a
        // direct child and resolves its anchor edges (top/bottom/left/right)
        // against this full-viewport overlay — matching the trigger-rect math
        // callers compute from `window.innerWidth` / `window.innerHeight`.
        position: 'relative',
    },
    nativeOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.32)',
        justifyContent: 'flex-end',
    },
    panelBase: {
        borderRadius: 12,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
        overflow: 'hidden',
    },
    panelWeb: {
        position: 'absolute',
        width: PANEL_WIDTH,
        maxHeight: '85%',
        borderWidth: 1,
    },
    panelNative: {
        marginHorizontal: 0,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        paddingBottom: 12,
        maxHeight: '85%',
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
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 10,
    },
    rowDisabled: {
        opacity: 0.4,
    },
    accountInfo: {
        flex: 1,
        minWidth: 0,
    },
    accountName: {
        fontSize: 13,
        fontWeight: '500',
    },
    accountNameActive: {
        fontWeight: '600',
    },
    accountEmail: {
        fontSize: 11,
        marginTop: 1,
    },
    rowSignOutButton: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        opacity: 0.6,
    },
    switchingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        gap: 8,
    },
    switchingText: {
        fontSize: 12,
        fontWeight: '500',
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
    },
    actionText: {
        fontSize: 13,
        fontWeight: '500',
    },
});

export default AccountMenu;

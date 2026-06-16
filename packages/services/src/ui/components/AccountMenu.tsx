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
}

const isWeb = Platform.OS === 'web';

/**
 * Reusable account menu modeled after the Google account chooser. Opens from
 * the avatar entry point (`AccountMenuButton`) or any other trigger.
 *
 * Reads everything it needs from `useOxy()` — never receive a session via
 * props. Renders as a popover anchored to the trigger on web, and as a
 * full-width bottom-sheet style modal on native.
 */
const AccountMenu: React.FC<AccountMenuProps> = ({
    open,
    onClose,
    onNavigateManage,
    onAddAccount,
    anchor,
}) => {
    const {
        activeSessionId,
        switchSession,
        logout,
        logoutAll,
    } = useOxy();
    const { t } = useI18n();
    const bloomTheme = useTheme();

    // Source EVERY account's real name/email/avatar/color from the unified
    // device-account hook (shared apex `refresh-all` path on `*.oxy.so`, local
    // `useOxy()` fallback on cross-domain web / native). This replaces the old
    // behaviour where only the active session's user was hydrated.
    const { accounts: deviceAccounts } = useDeviceAccounts();

    const [busySessionId, setBusySessionId] = useState<string | null>(null);
    const [signingOut, setSigningOut] = useState(false);
    const [signingOutAll, setSigningOutAll] = useState(false);

    const signOutDialog = useDialogControl();
    const signOutAllDialog = useDialogControl();

    const containerRef = useRef<View | null>(null);

    const rows = useMemo<AccountRow[]>(
        () => buildAccountRows({ accounts: deviceAccounts }),
        [deviceAccounts],
    );

    const activeRow = useMemo<AccountRow | null>(() => {
        return rows.find((r) => r.isActive) ?? null;
    }, [rows]);

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
    }, [activeSessionId, busySessionId, switchSession, t, onClose]);

    const performSignOut = useCallback(async () => {
        if (signingOut) {
            return;
        }
        setSigningOut(true);
        try {
            await logout();
            toast.success(t('common.actions.signedOut') || 'Signed out');
            onClose();
        } catch (error) {
            loggerUtil.warn('Sign out failed', { component: 'AccountMenu' }, error as unknown);
            toast.error(t('common.errors.signOutFailed') || 'Failed to sign out');
        } finally {
            setSigningOut(false);
        }
    }, [signingOut, logout, t, onClose]);

    const performSignOutAll = useCallback(async () => {
        if (signingOutAll) {
            return;
        }
        setSigningOutAll(true);
        try {
            await logoutAll();
            toast.success(t('accountSwitcher.toasts.signOutAllSuccess') || 'Signed out of all accounts');
            onClose();
        } catch (error) {
            loggerUtil.warn('Sign out all failed', { component: 'AccountMenu' }, error as unknown);
            toast.error(t('common.errors.signOutAllFailed') || 'Failed to sign out of all accounts');
        } finally {
            setSigningOutAll(false);
        }
    }, [signingOutAll, logoutAll, t, onClose]);

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
            { backgroundColor: bloomTheme.colors.background, borderColor: bloomTheme.colors.border },
        ]
        : [
            styles.panelBase,
            styles.panelNative,
            { backgroundColor: bloomTheme.colors.background },
        ];

    const content = (
        <Pressable
            ref={containerRef}
            // Swallow taps inside the panel so they never reach the overlay's
            // outside-tap-to-close handler. (Replaces the former wrapper
            // Pressable; on web the panel is a direct, absolutely-positioned
            // child of the overlay so the anchor resolves against the viewport.)
            onPress={() => undefined}
            style={panelStyles}
            accessibilityRole="menu"
            accessibilityLabel={t('accountMenu.label') || 'Account menu'}
        >
            {/* 1) Header */}
            {activeRow ? (
                <View style={styles.header}>
                    <Avatar
                        uri={activeRow.avatarUri}
                        name={activeRow.displayName}
                        size={64}
                    />
                    <Text
                        style={[styles.headerName, { color: bloomTheme.colors.text }]}
                        numberOfLines={1}
                    >
                        {activeRow.displayName}
                    </Text>
                    {activeRow.secondary ? (
                        <Text
                            style={[styles.headerSecondary, { color: bloomTheme.colors.textSecondary }]}
                            numberOfLines={1}
                        >
                            {activeRow.secondary}
                        </Text>
                    ) : null}
                </View>
            ) : (
                <View style={styles.header}>
                    <Text style={[styles.headerName, { color: bloomTheme.colors.text }]}>
                        {t('common.status.notSignedIn') || 'Not signed in'}
                    </Text>
                </View>
            )}

            {/* 2) Manage account */}
            <TouchableOpacity
                accessibilityRole="menuitem"
                accessibilityLabel={t('accountMenu.manage') || 'Manage your Oxy Account'}
                style={[styles.primaryButton, { borderColor: bloomTheme.colors.border }]}
                onPress={() => {
                    onClose();
                    onNavigateManage();
                }}
            >
                <Text style={[styles.primaryButtonText, { color: bloomTheme.colors.primary }]}>
                    {t('accountMenu.manage') || 'Manage your Oxy Account'}
                </Text>
            </TouchableOpacity>

            {/* 3) Account list */}
            {rows.length > 0 ? (
                <ScrollView
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                >
                    {rows.map((row) => {
                        const isBusy = busySessionId === row.sessionId;
                        return (
                            <TouchableOpacity
                                key={`account-${row.sessionId}`}
                                accessibilityRole="menuitem"
                                accessibilityLabel={row.displayName}
                                accessibilityState={{ selected: row.isActive }}
                                onPress={() => handleSwitch(row.sessionId)}
                                disabled={row.isActive || isBusy}
                                style={[
                                    styles.row,
                                    row.isActive && {
                                        backgroundColor: bloomTheme.colors.primarySubtle,
                                    },
                                ]}
                            >
                                <Avatar
                                    uri={row.avatarUri}
                                    name={row.displayName}
                                    size={36}
                                />
                                <View style={styles.rowInfo}>
                                    <Text
                                        style={[styles.rowName, { color: bloomTheme.colors.text }]}
                                        numberOfLines={1}
                                    >
                                        {row.displayName}
                                    </Text>
                                    {row.secondary ? (
                                        <Text
                                            style={[styles.rowSecondary, { color: bloomTheme.colors.textSecondary }]}
                                            numberOfLines={1}
                                        >
                                            {row.secondary}
                                        </Text>
                                    ) : null}
                                </View>
                                {isBusy ? (
                                    <ActivityIndicator color={bloomTheme.colors.primary} size="small" />
                                ) : row.isActive ? (
                                    <Ionicons
                                        name="checkmark-circle"
                                        size={20}
                                        color={bloomTheme.colors.primary}
                                    />
                                ) : null}
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            ) : null}

            {/* 4) Add another account */}
            <TouchableOpacity
                accessibilityRole="menuitem"
                accessibilityLabel={t('accountMenu.addAnother') || 'Add another account'}
                onPress={() => {
                    onClose();
                    onAddAccount();
                }}
                style={[styles.row, styles.actionRow]}
            >
                <View
                    style={[
                        styles.actionIcon,
                        { backgroundColor: bloomTheme.colors.primarySubtle },
                    ]}
                >
                    <Ionicons
                        name="person-add-outline"
                        size={18}
                        color={bloomTheme.colors.primary}
                    />
                </View>
                <View style={styles.rowInfo}>
                    <Text style={[styles.rowName, { color: bloomTheme.colors.text }]}>
                        {t('accountMenu.addAnother') || 'Add another account'}
                    </Text>
                </View>
            </TouchableOpacity>

            {/* 5) Sign out + sign out of all */}
            <View style={[styles.footer, { borderTopColor: bloomTheme.colors.border }]}>
                <TouchableOpacity
                    accessibilityRole="menuitem"
                    accessibilityLabel={t('common.actions.signOut') || 'Sign out'}
                    onPress={() => signOutDialog.open()}
                    disabled={signingOut || signingOutAll}
                    style={styles.footerButton}
                >
                    {signingOut ? (
                        <ActivityIndicator color={bloomTheme.colors.error} size="small" />
                    ) : (
                        <Text style={[styles.footerButtonText, { color: bloomTheme.colors.error }]}>
                            {t('common.actions.signOut') || 'Sign out'}
                        </Text>
                    )}
                </TouchableOpacity>
                {rows.length > 1 ? (
                    <TouchableOpacity
                        accessibilityRole="menuitem"
                        accessibilityLabel={t('accountMenu.signOutAll') || 'Sign out of all accounts'}
                        onPress={() => signOutAllDialog.open()}
                        disabled={signingOut || signingOutAll}
                        style={styles.footerButton}
                    >
                        {signingOutAll ? (
                            <ActivityIndicator color={bloomTheme.colors.error} size="small" />
                        ) : (
                            <Text style={[styles.footerButtonText, { color: bloomTheme.colors.error }]}>
                                {t('accountMenu.signOutAll') || 'Sign out of all accounts'}
                            </Text>
                        )}
                    </TouchableOpacity>
                ) : null}
            </View>
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
                 * Web: the panel is `position: absolute` and is rendered as a
                 * DIRECT child of the full-viewport overlay, so its anchor edges
                 * (top/bottom/left/right) resolve against the viewport — not a
                 * shrink-wrapped intermediate wrapper (which previously pushed
                 * the popover off-screen). The panel swallows its own taps.
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
        borderRadius: 24,
        paddingVertical: 12,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
        overflow: 'hidden',
    },
    panelWeb: {
        position: 'absolute',
        width: 360,
        maxHeight: '85%',
        borderWidth: 1,
    },
    panelNative: {
        marginHorizontal: 0,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        paddingTop: 20,
        paddingBottom: 24,
        maxHeight: '85%',
    },
    header: {
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    headerName: {
        fontSize: 18,
        fontWeight: '600',
        marginTop: 12,
        textAlign: 'center',
    },
    headerSecondary: {
        fontSize: 14,
        marginTop: 4,
        textAlign: 'center',
    },
    primaryButton: {
        marginHorizontal: 20,
        marginBottom: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: 'center',
    },
    primaryButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    list: {
        maxHeight: 280,
    },
    listContent: {
        paddingHorizontal: 12,
        paddingBottom: 4,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 16,
        marginVertical: 2,
    },
    actionRow: {
        marginHorizontal: 12,
        marginTop: 4,
    },
    actionIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowInfo: {
        flex: 1,
        marginLeft: 12,
    },
    rowName: {
        fontSize: 15,
        fontWeight: '500',
    },
    rowSecondary: {
        fontSize: 13,
        marginTop: 2,
    },
    footer: {
        marginTop: 12,
        paddingTop: 8,
        paddingHorizontal: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
    },
    footerButton: {
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    footerButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
});

export default AccountMenu;

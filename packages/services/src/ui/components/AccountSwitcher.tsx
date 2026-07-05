import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    TextInput,
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
import { isDev, logger as loggerUtil } from '@oxyhq/core';
import Avatar from './Avatar';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';
import { useSwitchableAccounts, type SwitchableAccount } from '../hooks/useSwitchableAccounts';
import type { AccountMenuAnchor } from './AccountMenu';

const isWeb = Platform.OS === 'web';
const PANEL_WIDTH = 380;

/**
 * The set of action callbacks the switcher body needs. Supplied by whichever
 * chrome wraps it — the {@link AccountSwitcher} modal/popover (web header chip,
 * native sheet) or the {@link AccountSwitcherScreen} bottom-sheet route.
 */
export interface AccountSwitcherActions {
    /** Close the surface (dismiss the modal, or pop the bottom sheet). */
    onClose: () => void;
    /** Start adding another device sign-in. */
    onAddAccount: () => void;
    /** Open "Manage your Oxy Account" (the caller's own personal account). */
    onNavigateManage: () => void;
    /** Open the create-account flow. */
    onCreateAccount: () => void;
    /** Open the per-account settings surface for a non-personal account. */
    onOpenAccountSettings?: (accountId: string) => void;
    /** Called before the active device session changes so apps can clear tenant state. */
    onBeforeSessionChange?: () => void | Promise<void>;
}

interface TreeEntry {
    root: SwitchableAccount;
    children: SwitchableAccount[];
}

/**
 * Group flat account rows into a 2-level tree (org → direct children). A row
 * whose parent is not in the set is treated as a root; any deeper row not
 * captured under a root is promoted to its own root row so nothing is hidden.
 */
function toTree(nodes: SwitchableAccount[]): TreeEntry[] {
    const byId = new Map(nodes.map((node) => [node.accountId, node]));
    const childrenOf = new Map<string, SwitchableAccount[]>();
    for (const node of nodes) {
        if (node.parentAccountId && byId.has(node.parentAccountId)) {
            const arr = childrenOf.get(node.parentAccountId) ?? [];
            arr.push(node);
            childrenOf.set(node.parentAccountId, arr);
        }
    }
    const rendered = new Set<string>();
    const result: TreeEntry[] = [];
    for (const node of nodes) {
        const isRoot = !node.parentAccountId || !byId.has(node.parentAccountId);
        if (!isRoot) continue;
        const children = childrenOf.get(node.accountId) ?? [];
        result.push({ root: node, children });
        rendered.add(node.accountId);
        for (const child of children) rendered.add(child.accountId);
    }
    for (const node of nodes) {
        if (!rendered.has(node.accountId)) {
            result.push({ root: node, children: [] });
            rendered.add(node.accountId);
        }
    }
    return result;
}

/**
 * The presentational, chrome-agnostic body of the unified account switcher.
 *
 * Two levels, relationship-aware, both sourced from the single
 * {@link useSwitchableAccounts} hook and switched through the SINGLE
 * `switchToAccount(accountId)` path:
 *  - Section A — accounts signed in on THIS device (`onDevice` rows). Tap to
 *    switch; per-row sign-out; "Add another account".
 *  - Section B — the account GRAPH not yet signed in here: "Your accounts"
 *    (self / owned) and "Shared with you" (member). 2-level tree (org →
 *    children), role badge, search, one-tap to switch.
 */
export const AccountSwitcherView: React.FC<AccountSwitcherActions> = ({
    onClose,
    onAddAccount,
    onNavigateManage,
    onCreateAccount,
    onOpenAccountSettings,
    onBeforeSessionChange,
}) => {
    const {
        switchToAccount,
        removeSession,
        logout,
        logoutAll,
    } = useOxy();
    const { t } = useI18n();
    const { colors } = useTheme();

    const { accounts } = useSwitchableAccounts();

    const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null);
    const [removingSessionId, setRemovingSessionId] = useState<string | null>(null);
    const [signingOut, setSigningOut] = useState(false);
    const [signingOutAll, setSigningOutAll] = useState(false);
    const [query, setQuery] = useState('');

    const signOutDialog = useDialogControl();
    const signOutAllDialog = useDialogControl();

    // Section A — accounts signed in on THIS device, current one first.
    const deviceRows = useMemo<SwitchableAccount[]>(() => {
        const onDevice = accounts.filter((account) => account.onDevice);
        const current = onDevice.filter((account) => account.isCurrent);
        const others = onDevice.filter((account) => !account.isCurrent);
        return [...current, ...others];
    }, [accounts]);

    // Section B — linked graph accounts NOT already signed in on this device.
    // (An account switched into becomes a device session, so it moves to Section
    // A automatically — the unified hook already deduped it there.)
    const graphAccounts = useMemo<SwitchableAccount[]>(
        () => accounts.filter((account) => !account.onDevice),
        [accounts],
    );

    const isSwitching = switchingAccountId !== null;
    const actionDisabled = isSwitching || signingOut || signingOutAll;

    const filtered = useMemo<SwitchableAccount[]>(() => {
        const q = query.trim().toLowerCase();
        if (!q) return graphAccounts;
        return graphAccounts.filter((account) => {
            const name = account.displayName.toLowerCase();
            const username = (account.user?.username ?? '').toLowerCase();
            return name.includes(q) || username.includes(q);
        });
    }, [graphAccounts, query]);

    const yourAccounts = useMemo(
        () => toTree(filtered.filter((account) => account.relationship !== 'member')),
        [filtered],
    );
    const sharedAccounts = useMemo(
        () => toTree(filtered.filter((account) => account.relationship === 'member')),
        [filtered],
    );

    // The ONE uniform switch path. Device rows AND graph rows both switch by
    // account id: `switchToAccount` reuses an existing device session (no mint)
    // and mints a real session only on the FIRST entry into a graph account.
    const handleSwitch = useCallback(async (account: SwitchableAccount) => {
        if (switchingAccountId) return;
        // Tapping the already-active account just closes — it IS the current one.
        if (account.isCurrent) {
            onClose();
            return;
        }
        setSwitchingAccountId(account.accountId);
        try {
            await onBeforeSessionChange?.();
            await switchToAccount(account.accountId);
            toast.success(t('accountSwitcher.toasts.switchSuccess') || 'Switched account');
            onClose();
        } catch (error) {
            if (!isDev()) {
                loggerUtil.warn('Switch account failed', { component: 'AccountSwitcher' }, error as unknown);
            }
            toast.error(t('accountSwitcher.toasts.switchFailed') || 'Failed to switch account');
        } finally {
            setSwitchingAccountId(null);
        }
    }, [switchingAccountId, switchToAccount, t, onClose, onBeforeSessionChange]);

    const handleRemoveDevice = useCallback(async (sessionId: string) => {
        if (removingSessionId) return;
        setRemovingSessionId(sessionId);
        try {
            await removeSession(sessionId);
            toast.success(t('common.actions.signedOut') || 'Signed out');
        } catch (error) {
            loggerUtil.warn('Remove account failed', { component: 'AccountSwitcher' }, error as unknown);
            toast.error(t('common.errors.signOutFailed') || 'Failed to sign out');
        } finally {
            setRemovingSessionId(null);
        }
    }, [removingSessionId, removeSession, t]);

    const performSignOut = useCallback(async () => {
        if (signingOut) return;
        setSigningOut(true);
        try {
            await onBeforeSessionChange?.();
            await logout();
            toast.success(t('common.actions.signedOut') || 'Signed out');
            onClose();
        } catch (error) {
            loggerUtil.warn('Sign out failed', { component: 'AccountSwitcher' }, error as unknown);
            toast.error(t('common.errors.signOutFailed') || 'Failed to sign out');
        } finally {
            setSigningOut(false);
        }
    }, [signingOut, logout, t, onClose, onBeforeSessionChange]);

    const performSignOutAll = useCallback(async () => {
        if (signingOutAll) return;
        setSigningOutAll(true);
        try {
            await onBeforeSessionChange?.();
            await logoutAll();
            toast.success(t('accountSwitcher.toasts.signOutAllSuccess') || 'Signed out of all accounts');
            onClose();
        } catch (error) {
            loggerUtil.warn('Sign out all failed', { component: 'AccountSwitcher' }, error as unknown);
            toast.error(t('common.errors.signOutAllFailed') || 'Failed to sign out of all accounts');
        } finally {
            setSigningOutAll(false);
        }
    }, [signingOutAll, logoutAll, t, onClose, onBeforeSessionChange]);

    const renderAccountNode = useCallback((account: SwitchableAccount, isChild: boolean) => {
        const displayName = account.displayName;
        const secondary = account.email;
        const active = account.isCurrent;
        const isNodeSwitching = switchingAccountId === account.accountId;
        const role = account.callerMembership?.role;
        const avatarUri = account.avatarUrl;
        const permissions = account.callerMembership?.permissions ?? [];
        const canManage = account.relationship !== 'member'
            || permissions.includes('account:update')
            || permissions.includes('members:read');
        const showSettings = account.relationship !== 'self' && !!onOpenAccountSettings && canManage;

        return (
            <TouchableOpacity
                key={`node-${account.accountId}`}
                accessibilityRole="menuitem"
                accessibilityLabel={displayName}
                accessibilityState={{ selected: active }}
                onPress={() => handleSwitch(account)}
                disabled={isSwitching}
                activeOpacity={0.6}
                style={[
                    styles.accountRow,
                    isChild && styles.childRow,
                    active && { backgroundColor: colors.primarySubtle },
                    isSwitching && !isNodeSwitching && styles.rowDisabled,
                ]}
            >
                <Avatar uri={avatarUri} name={displayName} size={isChild ? 28 : 34} />
                <View style={styles.accountInfo}>
                    <View style={styles.nameRow}>
                        <Text style={[styles.accountName, { color: colors.text }]} numberOfLines={1}>
                            {displayName}
                        </Text>
                        {role ? (
                            <View style={[styles.roleBadge, { backgroundColor: colors.card }]}>
                                <Text style={[styles.roleBadgeText, { color: colors.textSecondary }]}>
                                    {t(`accounts.roles.${role}.label`) || role}
                                </Text>
                            </View>
                        ) : null}
                    </View>
                    {secondary ? (
                        <Text style={[styles.accountEmail, { color: colors.textSecondary }]} numberOfLines={1}>
                            {secondary}
                        </Text>
                    ) : null}
                </View>
                {showSettings ? (
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={t('accounts.settings.title') || 'Account settings'}
                        onPress={() => onOpenAccountSettings?.(account.accountId)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.settingsButton}
                    >
                        <Ionicons name="settings-outline" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                ) : null}
                {isNodeSwitching ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                ) : active ? (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                ) : null}
            </TouchableOpacity>
        );
    }, [switchingAccountId, isSwitching, colors, handleSwitch, onOpenAccountSettings, t]);

    const renderTree = useCallback((entries: TreeEntry[]) => (
        entries.map((entry) => (
            <View key={`tree-${entry.root.accountId}`}>
                {renderAccountNode(entry.root, false)}
                {entry.children.map((child) => renderAccountNode(child, true))}
            </View>
        ))
    ), [renderAccountNode]);

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
        >
            {/* Section A — device sign-ins */}
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                {t('accountSwitcher.sections.thisDevice') || 'On this device'}
            </Text>
            {deviceRows.map((account) => {
                const sessionId = account.sessionId;
                const isBusy = switchingAccountId === account.accountId;
                const isRemoving = sessionId ? removingSessionId === sessionId : false;
                // The active device session IS the current account — there is no
                // separate acting-as concept; switching makes it the whole app.
                const isCurrentAccount = account.isCurrent;
                return (
                    <TouchableOpacity
                        key={`device-${account.accountId}`}
                        accessibilityRole="menuitem"
                        accessibilityLabel={account.displayName}
                        accessibilityState={{ selected: isCurrentAccount }}
                        onPress={() => handleSwitch(account)}
                        disabled={isCurrentAccount || isBusy || isSwitching}
                        activeOpacity={0.6}
                        style={[
                            styles.accountRow,
                            isCurrentAccount && { backgroundColor: colors.primarySubtle },
                            isSwitching && !isCurrentAccount && styles.rowDisabled,
                        ]}
                    >
                        <Avatar uri={account.avatarUrl} name={account.displayName} size={isCurrentAccount ? 40 : 32} />
                        <View style={styles.accountInfo}>
                            <Text
                                style={[styles.accountName, { color: colors.text }, isCurrentAccount && styles.accountNameActive]}
                                numberOfLines={1}
                            >
                                {account.displayName}
                            </Text>
                            {account.email ? (
                                <Text style={[styles.accountEmail, { color: colors.textSecondary }]} numberOfLines={1}>
                                    {account.email}
                                </Text>
                            ) : null}
                        </View>
                        {isBusy ? (
                            <ActivityIndicator color={colors.primary} size="small" />
                        ) : isCurrentAccount ? (
                            <Ionicons name="checkmark" size={20} color={colors.primary} />
                        ) : isRemoving ? (
                            <ActivityIndicator color={colors.textSecondary} size="small" />
                        ) : sessionId ? (
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={
                                    t('accountMenu.signOutAccount', { name: account.displayName })
                                    || `Sign out ${account.displayName}`
                                }
                                onPress={() => handleRemoveDevice(sessionId)}
                                disabled={isSwitching || removingSessionId !== null}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                style={styles.settingsButton}
                            >
                                <Ionicons name="log-out-outline" size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                        ) : null}
                    </TouchableOpacity>
                );
            })}

            {isSwitching ? (
                <View style={styles.switchingRow}>
                    <ActivityIndicator color={colors.textSecondary} size="small" />
                    <Text style={[styles.switchingText, { color: colors.textSecondary }]}>
                        {t('accountMenu.switching') || 'Switching account…'}
                    </Text>
                </View>
            ) : null}

            <TouchableOpacity
                accessibilityRole="menuitem"
                accessibilityLabel={t('accountMenu.addAnother') || 'Add another account'}
                onPress={() => { onClose(); onAddAccount(); }}
                disabled={actionDisabled}
                activeOpacity={0.6}
                style={[styles.actionRow, actionDisabled && styles.rowDisabled]}
            >
                <Ionicons name="person-add-outline" size={20} color={colors.icon} />
                <Text style={[styles.actionText, { color: colors.text }]}>
                    {t('accountMenu.addAnother') || 'Add another account'}
                </Text>
            </TouchableOpacity>

            {/* Section B — account graph (switchable accounts not already a device session) */}
            {graphAccounts.length > 0 ? (
                <>
                    <Divider color={colors.border} spacing={4} />

                    {graphAccounts.length > 6 ? (
                        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <Ionicons name="search" size={16} color={colors.textSecondary} />
                            <TextInput
                                value={query}
                                onChangeText={setQuery}
                                placeholder={t('accountSwitcher.searchPlaceholder') || 'Search accounts'}
                                placeholderTextColor={colors.textSecondary}
                                style={[styles.searchInput, { color: colors.text }]}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </View>
                    ) : null}

                    {yourAccounts.length > 0 ? (
                        <>
                            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                                {t('accountSwitcher.sections.yourAccounts') || 'Your accounts'}
                            </Text>
                            {renderTree(yourAccounts)}
                        </>
                    ) : null}

                    {sharedAccounts.length > 0 ? (
                        <>
                            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                                {t('accountSwitcher.sections.sharedWithYou') || 'Shared with you'}
                            </Text>
                            {renderTree(sharedAccounts)}
                        </>
                    ) : null}
                </>
            ) : null}

            <Divider color={colors.border} spacing={4} />

            {/* Footer actions */}
            <TouchableOpacity
                accessibilityRole="menuitem"
                accessibilityLabel={t('accounts.create.title') || 'Create account'}
                onPress={() => { onClose(); onCreateAccount(); }}
                disabled={actionDisabled}
                activeOpacity={0.6}
                style={[styles.actionRow, actionDisabled && styles.rowDisabled]}
            >
                <Ionicons name="add-circle-outline" size={20} color={colors.icon} />
                <Text style={[styles.actionText, { color: colors.text }]}>
                    {t('accounts.create.title') || 'Create account'}
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                accessibilityRole="menuitem"
                accessibilityLabel={t('accountMenu.manage') || 'Manage your Oxy Account'}
                onPress={() => { onClose(); onNavigateManage(); }}
                disabled={actionDisabled}
                activeOpacity={0.6}
                style={[styles.actionRow, actionDisabled && styles.rowDisabled]}
            >
                <Ionicons name="settings-outline" size={18} color={colors.icon} />
                <Text style={[styles.actionText, { color: colors.text }]}>
                    {t('accountMenu.manage') || 'Manage your Oxy Account'}
                </Text>
            </TouchableOpacity>

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

            {deviceRows.length > 1 ? (
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

            <Dialog
                control={signOutDialog}
                title={t('common.actions.signOut') || 'Sign out'}
                description={t('common.confirms.signOut') || 'Are you sure you want to sign out?'}
                actions={[
                    { label: t('common.actions.signOut') || 'Sign out', color: 'destructive', onPress: performSignOut },
                    { label: t('common.cancel') || 'Cancel', color: 'cancel' },
                ]}
            />
            <Dialog
                control={signOutAllDialog}
                title={t('accountMenu.signOutAll') || 'Sign out of all accounts'}
                description={t('common.confirms.signOutAll') || 'Are you sure you want to sign out of all accounts?'}
                actions={[
                    { label: t('accountMenu.signOutAll') || 'Sign out of all accounts', color: 'destructive', onPress: performSignOutAll },
                    { label: t('common.cancel') || 'Cancel', color: 'cancel' },
                ]}
            />
        </ScrollView>
    );
};

export interface AccountSwitcherProps extends AccountSwitcherActions {
    open: boolean;
    /** Optional anchor (web only). Native ignores this and docks as a bottom sheet. */
    anchor?: AccountMenuAnchor | null;
}

/**
 * Unified account switcher presented as a popover (web) / bottom-sheet style
 * modal (native). The canonical entry point opened by {@link AccountMenuButton}.
 */
const AccountSwitcher: React.FC<AccountSwitcherProps> = ({ open, anchor, ...actions }) => {
    const { t } = useI18n();
    const { colors } = useTheme();
    const containerRef = useRef<View | null>(null);
    const { onClose } = actions;

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

    const anchorStyle: ViewStyle = anchor
        ? {
            ...(anchor.top !== undefined ? { top: anchor.top } : null),
            ...(anchor.bottom !== undefined ? { bottom: anchor.bottom } : null),
            ...(anchor.left !== undefined ? { left: anchor.left } : null),
            ...(anchor.right !== undefined ? { right: anchor.right } : null),
        }
        : { top: 64, right: 16 };

    const panelStyles: ViewStyle[] = isWeb
        ? [styles.panelBase, styles.panelWeb, anchorStyle, { backgroundColor: colors.background, borderColor: colors.border }]
        : [styles.panelBase, styles.panelNative, { backgroundColor: colors.background }];

    return (
        <Modal visible={open} transparent animationType={isWeb ? 'fade' : 'slide'} onRequestClose={actions.onClose}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.actions.close') || 'Close'}
                onPress={actions.onClose}
                style={isWeb ? styles.webOverlay : styles.nativeOverlay}
            >
                <Pressable
                    ref={containerRef}
                    onPress={() => undefined}
                    style={panelStyles}
                    accessibilityRole="menu"
                    accessibilityLabel={t('accountSwitcher.label') || 'Account switcher'}
                >
                    <AccountSwitcherView {...actions} />
                </Pressable>
            </Pressable>
        </Modal>
    );
};

const styles = StyleSheet.create({
    webOverlay: {
        flex: 1,
        backgroundColor: 'transparent',
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
        paddingBottom: 12,
        maxHeight: '85%',
    },
    scroll: {
        flexGrow: 0,
    },
    scrollContent: {
        paddingVertical: 4,
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 4,
    },
    accountRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 10,
    },
    childRow: {
        paddingLeft: 34,
    },
    rowDisabled: {
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
        fontSize: 13,
        fontWeight: '500',
        flexShrink: 1,
    },
    accountNameActive: {
        fontWeight: '600',
    },
    accountEmail: {
        fontSize: 11,
        marginTop: 1,
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
    settingsButton: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
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
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 14,
        marginVertical: 6,
        paddingHorizontal: 10,
        height: 36,
        borderRadius: 10,
        borderWidth: 1,
    },
    searchInput: {
        flex: 1,
        fontSize: 13,
        padding: 0,
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

export default AccountSwitcher;

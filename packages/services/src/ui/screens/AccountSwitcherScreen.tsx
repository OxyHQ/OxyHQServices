import type React from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Platform,
    Image,
    Dimensions,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import type { ClientSession } from '@oxyhq/core';
import { fontFamilies } from '../styles/fonts';
import type { User } from '@oxyhq/core';
import { toast } from '../../lib/sonner';
import * as Prompt from '@oxyhq/bloom/prompt';
import { usePromptControl } from '@oxyhq/bloom/prompt';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';
import { Header, LoadingState } from '../components';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import { SettingsIcon } from '../components/SettingsIcon';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../context/OxyContext';

interface SessionWithUser extends ClientSession {
    userProfile?: User;
    isLoadingProfile?: boolean;
}

interface DeviceSession {
    sessionId: string;
    deviceId: string;
    deviceName: string;
    isActive: boolean;
    lastActive: string;
    expiresAt: string;
    isCurrent: boolean;
}

const ModernAccountSwitcherScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
    goBack,
}) => {
    const bloomTheme = useTheme();
    // Use useOxy() hook for OxyContext values
    const {
        oxyServices,
        user,
        sessions = [],
        activeSessionId = null,
        switchSession,
        removeSession,
        logoutAll,
        refreshSessions,
        isLoading = false,
        isAuthenticated = false,
        actingAs,
        managedAccounts,
        setActingAs,
    } = useOxy();

    const [sessionsWithUsers, setSessionsWithUsers] = useState<SessionWithUser[]>([]);
    const [switchingToUserId, setSwitchingToUserId] = useState<string | null>(null);
    const [removingUserId, setRemovingUserId] = useState<string | null>(null);
    const [switchingManagedId, setSwitchingManagedId] = useState<string | null>(null);

    // Device session management state
    const [showDeviceManagement, setShowDeviceManagement] = useState(false);
    const [deviceSessions, setDeviceSessions] = useState<DeviceSession[]>([]);
    const [loadingDeviceSessions, setLoadingDeviceSessions] = useState(false);
    const [remotingLogoutSessionId, setRemoteLogoutSessionId] = useState<string | null>(null);
    const [loggingOutAllDevices, setLoggingOutAllDevices] = useState(false);

    // Pending state for prompts
    const [pendingRemoveSession, setPendingRemoveSession] = useState<{ sessionId: string; displayName: string } | null>(null);
    const [pendingRemoteLogout, setPendingRemoteLogout] = useState<{ sessionId: string; deviceName: string } | null>(null);

    // Prompt controls
    const removeSessionPrompt = usePromptControl();
    const logoutAllPrompt = usePromptControl();
    const remoteLogoutPrompt = usePromptControl();
    const logoutAllDevicesPrompt = usePromptControl();

    const screenWidth = Dimensions.get('window').width;
    const { t } = useI18n();

    // Refresh sessions when screen loads
    useEffect(() => {
        if (isAuthenticated && activeSessionId && refreshSessions) {
            refreshSessions();
        }
    }, [isAuthenticated, activeSessionId, refreshSessions]);

    // Memoize session IDs to prevent unnecessary re-renders
    const sessionIds = useMemo(() => sessions.map(s => s.sessionId).join(','), [sessions]);

    // Load user profiles for sessions
    // Production-ready: Optimized with batching, memoization, and error handling
    useEffect(() => {
        let cancelled = false;

        const loadUserProfiles = async () => {
            if (!sessions.length || !oxyServices || cancelled) return;

            // Sessions are already deduplicated by userId at the core level (OxyContext)
            const uniqueSessions = sessions;

            // Initialize loading state
            setSessionsWithUsers(uniqueSessions.map(session => ({
                ...session,
                isLoadingProfile: true,
            })));

            // Batch load profiles for better performance using batch endpoint
            try {
                const sessionIds = uniqueSessions.map(s => s.sessionId);
                const batchResults = await oxyServices.getUsersBySessions(sessionIds);

                // Create a map for O(1) lookup
                const userProfileMap = new Map<string, User | null>();
                batchResults.forEach(({ sessionId, user }: { sessionId: string; user: any }) => {
                    userProfileMap.set(sessionId, user);
                });

                if (cancelled) return;

                // Update sessions with loaded profiles - optimized with Map for O(1) lookup
                setSessionsWithUsers(prev => {
                    return prev.map(session => {
                        const userProfile = userProfileMap.get(session.sessionId);
                        return {
                            ...session,
                            userProfile: userProfile || undefined,
                            isLoadingProfile: false,
                        };
                    });
                });
            } catch (error) {
                if (!cancelled && __DEV__) {
                    console.error('Failed to load user profiles:', error);
                }
                if (!cancelled) {
                    setSessionsWithUsers(prev =>
                        prev.map(s => ({ ...s, isLoadingProfile: false }))
                    );
                }
            }
        };

        loadUserProfiles();

        return () => {
            cancelled = true;
        };
    }, [sessionIds, oxyServices, sessions]);

    const handleSwitchSession = useCallback(async (sessionId: string) => {
        if (sessionId === (activeSessionId ?? null)) return; // Already active session
        if (switchingToUserId) return; // Already switching

        setSwitchingToUserId(sessionId);
        try {
            await switchSession(sessionId);
            toast.success(t('accountSwitcher.toasts.switchSuccess') || 'Account switched successfully!');
            if (onClose) {
                onClose();
            }
        } catch (error) {
            if (__DEV__) {
                console.error('Switch session failed:', error);
            }
            toast.error(t('accountSwitcher.toasts.switchFailed') || 'There was a problem switching accounts. Please try again.');
        } finally {
            setSwitchingToUserId(null);
        }
    }, [activeSessionId, switchSession, onClose, t, switchingToUserId]);

    const confirmRemoveSession = useCallback((sessionId: string, displayName: string) => {
        if (removingUserId) return;
        setPendingRemoveSession({ sessionId, displayName });
        removeSessionPrompt.open();
    }, [removingUserId, removeSessionPrompt]);

    const handleRemoveSession = useCallback(async () => {
        if (!pendingRemoveSession) return;
        const { sessionId } = pendingRemoveSession;
        setRemovingUserId(sessionId);
        try {
            await removeSession(sessionId);
            toast.success(t('accountSwitcher.toasts.removeSuccess') || 'Account removed successfully!');
        } catch (error) {
            if (__DEV__) {
                console.error('Remove session failed:', error);
            }
            toast.error(t('accountSwitcher.toasts.removeFailed') || 'There was a problem removing the account. Please try again.');
        } finally {
            setRemovingUserId(null);
            setPendingRemoveSession(null);
        }
    }, [pendingRemoveSession, removeSession, t]);

    const confirmLogoutAll = useCallback(() => {
        logoutAllPrompt.open();
    }, [logoutAllPrompt]);

    const handleLogoutAll = useCallback(async () => {
        try {
            await logoutAll();
            toast.success(t('accountSwitcher.toasts.signOutAllSuccess') || 'All accounts signed out successfully!');
            if (onClose) {
                onClose();
            }
        } catch (error) {
            if (__DEV__) {
                console.error('Logout all failed:', error);
            }
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            toast.error(t('accountSwitcher.toasts.signOutAllFailed', { error: errorMessage }) || `There was a problem signing out: ${errorMessage}`);
        }
    }, [logoutAll, onClose, t]);

    const handleSwitchToManagedAccount = useCallback(async (accountId: string) => {
        if (actingAs === accountId) return; // Already acting as this account
        if (switchingManagedId) return; // Already switching

        setSwitchingManagedId(accountId);
        try {
            setActingAs(accountId);
            toast.success(t('accountSwitcher.toasts.switchSuccess') || 'Switched identity successfully!');
            onClose?.();
        } catch (error) {
            if (__DEV__) {
                console.error('Switch managed account failed:', error);
            }
            toast.error('Failed to switch identity. Please try again.');
        } finally {
            setSwitchingManagedId(null);
        }
    }, [actingAs, switchingManagedId, setActingAs, t, onClose]);

    const handleSwitchBackToPrimary = useCallback(() => {
        setActingAs(null);
        toast.success('Switched back to primary account');
    }, [setActingAs]);

    // Device session management functions - optimized with useCallback
    const loadAllDeviceSessions = useCallback(async () => {
        const currentActiveSessionId = activeSessionId ?? null;
        if (!oxyServices || !currentActiveSessionId) return;

        setLoadingDeviceSessions(true);
        try {
            const allSessions = await oxyServices.getDeviceSessions(currentActiveSessionId);
            setDeviceSessions(allSessions || []);
        } catch (error) {
            if (__DEV__) {
                console.error('Failed to load device sessions:', error);
            }
            toast.error(t('accountSwitcher.toasts.deviceLoadFailed') || 'Failed to load device sessions. Please try again.');
        } finally {
            setLoadingDeviceSessions(false);
        }
    }, [oxyServices, activeSessionId, t]);

    const confirmRemoteSessionLogout = useCallback((sessionId: string, deviceName: string) => {
        if (remotingLogoutSessionId) return;
        setPendingRemoteLogout({ sessionId, deviceName });
        remoteLogoutPrompt.open();
    }, [remotingLogoutSessionId, remoteLogoutPrompt]);

    const handleRemoteSessionLogout = useCallback(async () => {
        if (!pendingRemoteLogout) return;
        const { sessionId } = pendingRemoteLogout;
        setRemoteLogoutSessionId(sessionId);
        try {
            await oxyServices?.logoutSession((activeSessionId ?? null) || '', sessionId);
            await loadAllDeviceSessions();
            toast.success(t('accountSwitcher.toasts.remoteSignOutSuccess', { deviceName: pendingRemoteLogout.deviceName }) || `Signed out from ${pendingRemoteLogout.deviceName} successfully!`);
        } catch (error) {
            if (__DEV__) {
                console.error('Remote logout failed:', error);
            }
            toast.error(t('accountSwitcher.toasts.remoteSignOutFailed') || 'There was a problem signing out from the device. Please try again.');
        } finally {
            setRemoteLogoutSessionId(null);
            setPendingRemoteLogout(null);
        }
    }, [pendingRemoteLogout, activeSessionId, oxyServices, loadAllDeviceSessions, t]);

    const confirmLogoutAllDevices = useCallback(() => {
        const otherDevicesCount = deviceSessions.filter(session => !session.isCurrent).length;

        if (otherDevicesCount === 0) {
            toast.info(t('accountSwitcher.toasts.noOtherDeviceSessions') || 'No other device sessions found to sign out from.');
            return;
        }

        if (loggingOutAllDevices) return;
        logoutAllDevicesPrompt.open();
    }, [deviceSessions, loggingOutAllDevices, logoutAllDevicesPrompt, t]);

    const handleLogoutAllDevices = useCallback(async () => {
        setLoggingOutAllDevices(true);
        try {
            await oxyServices?.logoutAllDeviceSessions((activeSessionId ?? null) || '');
            await loadAllDeviceSessions();
            toast.success(t('accountSwitcher.toasts.signOutOthersSuccess') || 'Signed out from all other devices successfully!');
        } catch (error) {
            if (__DEV__) {
                console.error('Logout all devices failed:', error);
            }
            toast.error(t('accountSwitcher.toasts.signOutOthersFailed') || 'There was a problem signing out from other devices. Please try again.');
        } finally {
            setLoggingOutAllDevices(false);
        }
    }, [activeSessionId, oxyServices, loadAllDeviceSessions, t]);

    // Memoize filtered sessions for performance
    const otherSessions = useMemo(
        () => sessionsWithUsers.filter(s => s.sessionId !== (activeSessionId ?? null)),
        [sessionsWithUsers, activeSessionId]
    );

    const otherDevicesCount = useMemo(
        () => deviceSessions.filter(session => !session.isCurrent).length,
        [deviceSessions]
    );

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            {/* Header */}
            <Header
                title={t('accountSwitcher.title') || 'Account Switcher'}

                onBack={goBack}
                onClose={onClose}
                showBackButton={true}
                showCloseButton={true}
                elevation="subtle"
                rightAction={{
                    icon: "refresh",
                    onPress: refreshSessions
                }}
            />

            <ScrollView style={styles.content}>
                {isLoading ? (
                    <LoadingState
                        message={t('accountSwitcher.loading') || 'Loading accounts...'}
                        color="#007AFF"
                    />
                ) : (
                    <>
                        {/* Current Account */}
                        {isAuthenticated && user && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>{t('accountSwitcher.sections.current') || 'Current Account'}</Text>

                                <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem, styles.currentAccountCard]}>
                                    <View style={styles.userIcon}>
                                        {user.avatar ? (
                                            <Image source={{ uri: oxyServices.getFileDownloadUrl(user.avatar, 'thumb') }} style={styles.accountAvatarImage} />
                                        ) : (
                                            <View style={styles.accountAvatarFallback}>
                                                <Text style={styles.accountAvatarText}>
                                                    {(typeof user.name === 'string' ? user.name : user.name?.first || user.username)?.charAt(0).toUpperCase()}
                                                </Text>
                                            </View>
                                        )}
                                        <View style={styles.activeBadge}>
                                            <OxyIcon name="checkmark" size={12} color="#fff" />
                                        </View>
                                    </View>
                                    <View style={styles.settingInfo}>
                                        <View>
                                            <Text style={styles.settingLabel}>
                                                {typeof user.name === 'string' ? user.name : user.name?.full || user.name?.first || user.username}
                                            </Text>
                                            <Text style={styles.settingDescription}>{user.email || user.username}</Text>
                                        </View>
                                    </View>
                                    <View style={styles.currentBadge}>
                                        <Text style={styles.currentBadgeText}>{t('accountSwitcher.currentBadge') || 'Current'}</Text>
                                    </View>
                                </View>
                            </View>
                        )}

                        {/* Other Accounts */}
                        {otherSessions.length > 0 && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>
                                    {t('accountSwitcher.sections.otherWithCount', { count: otherSessions.length }) || `Other Accounts (${otherSessions.length})`}
                                </Text>

                                {otherSessions.map((sessionWithUser, index, filteredArray) => {
                                    const isFirst = index === 0;
                                    const isLast = index === filteredArray.length - 1;
                                    const isSwitching = switchingToUserId === sessionWithUser.sessionId;
                                    const isRemoving = removingUserId === sessionWithUser.sessionId;
                                    const { userProfile, isLoadingProfile } = sessionWithUser;

                                    const displayName = typeof userProfile?.name === 'object'
                                        ? userProfile.name.full || userProfile.name.first || userProfile.username
                                        : userProfile?.name || userProfile?.username || 'Unknown User';

                                    return (
                                        <View
                                            key={`session-${sessionWithUser.sessionId}-${index}`}
                                            style={[
                                                styles.settingItem,
                                                isFirst && styles.firstSettingItem,
                                                isLast && styles.lastSettingItem,
                                            ]}
                                        >
                                            <View style={styles.userIcon}>
                                                {isLoadingProfile ? (
                                                    <View style={styles.accountAvatarFallback}>
                                                        <ActivityIndicator size="small" color="#007AFF" />
                                                    </View>
                                                ) : userProfile?.avatar ? (
                                                    <Image source={{ uri: oxyServices.getFileDownloadUrl(userProfile.avatar, 'thumb') }} style={styles.accountAvatarImage} />
                                                ) : (
                                                    <View style={styles.accountAvatarFallback}>
                                                        <Text style={styles.accountAvatarText}>
                                                            {displayName.charAt(0).toUpperCase()}
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>
                                            <View style={styles.settingInfo}>
                                                <View>
                                                    <Text style={styles.settingLabel}>{displayName}</Text>
                                                    <Text style={styles.settingDescription}>
                                                        @{userProfile?.username || 'unknown'}
                                                    </Text>
                                                </View>
                                            </View>
                                            <View style={styles.accountActions}>
                                                <TouchableOpacity
                                                    style={styles.switchButton}
                                                    onPress={() => handleSwitchSession(sessionWithUser.sessionId)}
                                                    disabled={isSwitching || isRemoving}
                                                >
                                                    {isSwitching ? (
                                                        <ActivityIndicator size="small" color="#007AFF" />
                                                    ) : (
                                                        <Text style={styles.switchButtonText}>Switch</Text>
                                                    )}
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={styles.removeButton}
                                                    onPress={() => confirmRemoveSession(sessionWithUser.sessionId, displayName)}
                                                    disabled={isSwitching || isRemoving}
                                                >
                                                    {isRemoving ? (
                                                        <ActivityIndicator size="small" color="#FF3B30" />
                                                    ) : (
                                                        <OxyIcon name="trash" size={16} color="#FF3B30" />
                                                    )}
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    );
                                })}
                            </View>
                        )}

                        {/* Acting as banner - show switch-back when acting as a managed account */}
                        {actingAs && (
                            <View style={styles.section}>
                                <TouchableOpacity
                                    style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem, styles.actingAsBanner]}
                                    onPress={handleSwitchBackToPrimary}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.settingInfo}>
                                        <Text style={styles.settingLabel}>Switch back to primary account</Text>
                                        <Text style={styles.settingDescription}>You are currently acting as another identity</Text>
                                    </View>
                                    <View style={styles.switchBackButton}>
                                        <Text style={styles.switchBackButtonText}>Switch Back</Text>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Managed Accounts */}
                        {managedAccounts.length > 0 && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Managed Accounts</Text>
                                <Text style={styles.sectionSubtitle}>Identities you manage</Text>

                                {managedAccounts.map((managed, index) => {
                                    const account = managed.account;
                                    if (!account) return null;

                                    const isActive = actingAs === managed.accountId;
                                    const isSwitching = switchingManagedId === managed.accountId;
                                    const isFirst = index === 0;
                                    const isLast = index === managedAccounts.length - 1;

                                    const managedDisplayName = typeof account.name === 'object'
                                        ? account.name.full || account.name.first || account.username
                                        : account.name || account.username || 'Unknown';

                                    // Determine the manager role for badge display
                                    const myRole = managed.managers?.find(
                                        (m) => m.userId === user?.id
                                    )?.role ?? 'owner';

                                    return (
                                        <TouchableOpacity
                                            key={`managed-${managed.accountId}`}
                                            style={[
                                                styles.settingItem,
                                                isFirst && styles.firstSettingItem,
                                                isLast && styles.lastSettingItem,
                                                isActive && styles.currentAccountCard,
                                            ]}
                                            onPress={() => handleSwitchToManagedAccount(managed.accountId)}
                                            disabled={isActive || isSwitching}
                                            activeOpacity={0.7}
                                        >
                                            <View style={styles.userIcon}>
                                                {account.avatar ? (
                                                    <Image source={{ uri: oxyServices.getFileDownloadUrl(account.avatar, 'thumb') }} style={styles.accountAvatarImage} />
                                                ) : (
                                                    <View style={[styles.accountAvatarFallback, styles.managedAvatarFallback]}>
                                                        <Text style={styles.accountAvatarText}>
                                                            {managedDisplayName.charAt(0).toUpperCase()}
                                                        </Text>
                                                    </View>
                                                )}
                                                {isActive && (
                                                    <View style={styles.activeBadge}>
                                                        <OxyIcon name="checkmark" size={12} color="#fff" />
                                                    </View>
                                                )}
                                            </View>
                                            <View style={styles.settingInfo}>
                                                <View>
                                                    <Text style={styles.settingLabel}>{managedDisplayName}</Text>
                                                    <Text style={styles.settingDescription}>@{account.username}</Text>
                                                </View>
                                            </View>
                                            <View style={styles.accountActions}>
                                                <View style={styles.roleBadge}>
                                                    <Text style={styles.roleBadgeText}>{myRole}</Text>
                                                </View>
                                                {isActive ? (
                                                    <View style={styles.currentBadge}>
                                                        <Text style={styles.currentBadgeText}>Current</Text>
                                                    </View>
                                                ) : (
                                                    <TouchableOpacity
                                                        style={styles.switchButton}
                                                        onPress={() => handleSwitchToManagedAccount(managed.accountId)}
                                                        disabled={isSwitching}
                                                    >
                                                        {isSwitching ? (
                                                            <ActivityIndicator size="small" color="#fff" />
                                                        ) : (
                                                            <Text style={styles.switchButtonText}>Act As</Text>
                                                        )}
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}

                                {/* Create New Identity */}
                                <TouchableOpacity
                                    style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem, { marginTop: 8 }]}
                                    onPress={() => navigate?.('CreateManagedAccount')}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.userIcon}>
                                        <View style={[styles.accountAvatarFallback, { backgroundColor: '#007AFF20' }]}>
                                            <OxyIcon name="add" size={20} color="#007AFF" />
                                        </View>
                                    </View>
                                    <View style={styles.settingInfo}>
                                        <Text style={[styles.settingLabel, { color: '#007AFF' }]}>Create New Identity</Text>
                                        <Text style={styles.settingDescription}>Add a managed sub-account</Text>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Create first managed account (when none exist yet) */}
                        {managedAccounts.length === 0 && isAuthenticated && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Managed Accounts</Text>
                                <TouchableOpacity
                                    style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}
                                    onPress={() => navigate?.('CreateManagedAccount')}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.userIcon}>
                                        <View style={[styles.accountAvatarFallback, { backgroundColor: '#007AFF20' }]}>
                                            <OxyIcon name="add" size={20} color="#007AFF" />
                                        </View>
                                    </View>
                                    <View style={styles.settingInfo}>
                                        <Text style={[styles.settingLabel, { color: '#007AFF' }]}>Create New Identity</Text>
                                        <Text style={styles.settingDescription}>Create a managed sub-account you control</Text>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Quick Actions */}
                        <View style={styles.section}>
                            <SettingsListGroup title="Quick Actions">
                                <SettingsListItem
                                    icon={<SettingsIcon name="account-plus" color="#007AFF" />}
                                    title="Add Another Account"
                                    description="Sign in with a different account"
                                    onPress={() => navigate?.('OxyAuth')}
                                />
                                <SettingsListItem
                                    icon={<SettingsIcon name="cellphone" color="#5856D6" />}
                                    title={`${showDeviceManagement ? 'Hide' : 'Manage'} Device Sessions`}
                                    description="View and manage sessions on other devices"
                                    onPress={() => setShowDeviceManagement(!showDeviceManagement)}
                                />
                                <SettingsListItem
                                    icon={<SettingsIcon name="logout" color="#FF3B30" />}
                                    title="Sign Out All Accounts"
                                    description="Remove all accounts from this device"
                                    onPress={confirmLogoutAll}
                                    disabled={sessionsWithUsers.length === 0}
                                    destructive={true}
                                />
                            </SettingsListGroup>
                        </View>

                        {/* Device Management Section */}
                        {showDeviceManagement && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>{t('accountSwitcher.sections.deviceSessions') || 'Device Sessions'}</Text>

                                {loadingDeviceSessions ? (
                                    <SettingsListGroup>
                                        <SettingsListItem
                                            icon={<SettingsIcon name="sync" color="#007AFF" />}
                                            title={t('accountSwitcher.device.loadingTitle') || 'Loading device sessions...'}
                                            description={t('accountSwitcher.device.loadingSubtitle') || 'Please wait while we fetch your device sessions'}
                                            disabled={true}
                                            rightElement={<ActivityIndicator size="small" color="#007AFF" />}
                                            showChevron={false}
                                        />
                                    </SettingsListGroup>
                                ) : deviceSessions.length === 0 ? (
                                    <SettingsListGroup>
                                        <SettingsListItem
                                            icon={<SettingsIcon name="cellphone" color="#ccc" />}
                                            title={t('accountSwitcher.device.noneTitle') || 'No device sessions found'}
                                            description={t('accountSwitcher.device.noneSubtitle') || 'Device session management not available'}
                                            disabled={true}
                                            showChevron={false}
                                        />
                                    </SettingsListGroup>
                                ) : (
                                    <SettingsListGroup>
                                        {deviceSessions.map((session) => (
                                            <SettingsListItem
                                                key={`device-session-${session.sessionId}`}
                                                icon={<SettingsIcon name={session.isCurrent ? 'cellphone' : 'cellphone-basic'} color={session.isCurrent ? '#34C759' : '#8E8E93'} />}
                                                title={`${session.deviceName} ${session.isCurrent ? `(${t('accountSwitcher.device.thisDevice') || 'This device'})` : ''}`}
                                                description={t('accountSwitcher.device.lastActive', { date: new Date(session.lastActive).toLocaleDateString() }) || `Last active: ${new Date(session.lastActive).toLocaleDateString()}`}
                                                onPress={session.isCurrent ? undefined : () => confirmRemoteSessionLogout(session.sessionId, session.deviceName)}
                                                disabled={session.isCurrent || remotingLogoutSessionId === session.sessionId}
                                                showChevron={false}
                                                rightElement={!session.isCurrent ? (
                                                    <TouchableOpacity
                                                        style={styles.removeButton}
                                                        onPress={() => confirmRemoteSessionLogout(session.sessionId, session.deviceName)}
                                                        disabled={remotingLogoutSessionId === session.sessionId}
                                                    >
                                                        {remotingLogoutSessionId === session.sessionId ? (
                                                            <ActivityIndicator size="small" color="#FF3B30" />
                                                        ) : (
                                                            <OxyIcon name="log-out" size={16} color="#FF3B30" />
                                                        )}
                                                    </TouchableOpacity>
                                                ) : undefined}
                                            />
                                        ))}
                                    </SettingsListGroup>
                                )}
                            </View>
                        )}

                        {/* Empty State */}
                        {sessionsWithUsers.length === 0 && (
                            <View style={styles.section}>
                                <SettingsListGroup>
                                    <SettingsListItem
                                        icon={<SettingsIcon name="account-outline" color="#ccc" />}
                                        title={t('accountSwitcher.empty.title') || 'No saved accounts'}
                                        description={t('accountSwitcher.empty.subtitle') || 'Add another account to switch between them quickly'}
                                        onPress={() => navigate?.('OxyAuth')}
                                        rightElement={
                                            <View style={styles.emptyStateContainer}>
                                                <OxyIcon name="person-outline" size={48} color="#ccc" />
                                                <Text style={styles.emptyStateTitle}>{t('accountSwitcher.empty.title') || 'No saved accounts'}</Text>
                                                <Text style={styles.emptyStateDescription}>
                                                    {t('accountSwitcher.empty.subtitle') || 'Add another account to switch between them quickly'}
                                                </Text>
                                                <TouchableOpacity
                                                    style={styles.addAccountButton}
                                                    onPress={() => navigate?.('OxyAuth')}
                                                >
                                                    <Text style={styles.addAccountButtonText}>{t('accountCenter.sections.addAccount') || 'Add Account'}</Text>
                                                </TouchableOpacity>
                                            </View>
                                        }
                                        showChevron={false}
                                    />
                                </SettingsListGroup>
                            </View>
                        )}
                    </>
                )}
            </ScrollView>
            <Prompt.Basic
                control={removeSessionPrompt}
                title={t('accountSwitcher.confirms.removeTitle') || 'Remove Account'}
                description={pendingRemoveSession ? (t('accountSwitcher.confirms.remove', { displayName: pendingRemoveSession.displayName }) || `Are you sure you want to remove ${pendingRemoveSession.displayName} from this device? You'll need to sign in again to access this account.`) : ''}
                onConfirm={handleRemoveSession}
                confirmButtonCta={t('common.remove') || 'Remove'}
                confirmButtonColor='negative'
            />
            <Prompt.Basic
                control={logoutAllPrompt}
                title={t('accountSwitcher.confirms.logoutAllTitle') || 'Sign Out All'}
                description={t('accountSwitcher.confirms.logoutAll') || 'Are you sure you want to sign out of all accounts? This will remove all saved accounts from this device.'}
                onConfirm={handleLogoutAll}
                confirmButtonCta={t('common.signOutAll') || 'Sign Out All'}
                confirmButtonColor='negative'
            />
            <Prompt.Basic
                control={remoteLogoutPrompt}
                title={t('accountSwitcher.confirms.remoteLogoutTitle') || 'Remote Sign Out'}
                description={pendingRemoteLogout ? (t('accountSwitcher.confirms.remoteLogout', { deviceName: pendingRemoteLogout.deviceName }) || `Are you sure you want to sign out from "${pendingRemoteLogout.deviceName}"? This will end the session on that device.`) : ''}
                onConfirm={handleRemoteSessionLogout}
                confirmButtonCta={t('common.signOut') || 'Sign Out'}
                confirmButtonColor='negative'
            />
            <Prompt.Basic
                control={logoutAllDevicesPrompt}
                title={t('accountSwitcher.confirms.logoutOthersTitle') || 'Sign Out Other Devices'}
                description={t('accountSwitcher.confirms.logoutOthers', { count: otherDevicesCount }) || `Are you sure you want to sign out from all ${otherDevicesCount} other device(s)? This will end sessions on all other devices except this one.`}
                onConfirm={handleLogoutAllDevices}
                confirmButtonCta={t('common.signOutAll') || 'Sign Out All'}
                confirmButtonColor='negative'
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f2f2f2',
    },

    content: {
        flex: 1,
        padding: 16,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: Platform.OS === 'web' ? '600' : undefined,
        fontFamily: fontFamilies.interSemiBold,
        color: '#333',
    },
    settingItem: {
        backgroundColor: '#fff',
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    firstSettingItem: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    lastSettingItem: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 8,
    },
    currentAccountCard: {
        borderWidth: 2,
        borderColor: '#007AFF',
        backgroundColor: '#007AFF08',
    },
    settingInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    settingLabel: {
        fontSize: 16,
        fontWeight: '500',
        color: '#333',
        marginBottom: 2,
    },
    settingDescription: {
        fontSize: 14,
        color: '#666',
    },
    userIcon: {
        marginRight: 12,
        position: 'relative',
    },
    accountAvatarImage: {
        width: 40,
        height: 40,
        borderRadius: 20,
    },
    accountAvatarFallback: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#d169e5',
        alignItems: 'center',
        justifyContent: 'center',
    },
    accountAvatarText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    activeBadge: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#34C759',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#fff',
    },
    currentBadge: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    currentBadgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    accountActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    switchButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 16,
        minWidth: 60,
        alignItems: 'center',
    },
    switchButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
    },
    removeButton: {
        padding: 8,
        borderRadius: 16,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#FF3B30',
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyStateContainer: {
        alignItems: 'center',
        paddingVertical: 32,
        paddingHorizontal: 20,
    },
    emptyStateTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        marginTop: 16,
        marginBottom: 8,
    },
    emptyStateDescription: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 20,
    },
    addAccountButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 20,
    },
    addAccountButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    sectionSubtitle: {
        fontSize: 13,
        color: '#888',
        marginBottom: 12,
    },
    managedAvatarFallback: {
        backgroundColor: '#5856D6',
    },
    roleBadge: {
        backgroundColor: '#F2F2F7',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    roleBadgeText: {
        color: '#666',
        fontSize: 11,
        fontWeight: '500',
        textTransform: 'capitalize',
    },
    actingAsBanner: {
        borderWidth: 2,
        borderColor: '#FF9500',
        backgroundColor: '#FF950010',
    },
    switchBackButton: {
        backgroundColor: '#FF9500',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 16,
    },
    switchBackButtonText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
    },
});

export default ModernAccountSwitcherScreen;

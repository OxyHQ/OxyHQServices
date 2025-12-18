import type React from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Alert,
    Platform,
    Image,
    Dimensions,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import type { ClientSession } from '../../models/session';
import { fontFamilies } from '../styles/fonts';
import type { User } from '../../models/interfaces';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';
import { Header, GroupedSection, LoadingState } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';
import { normalizeTheme } from '../utils/themeUtils';
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
    } = useOxy();

    const [sessionsWithUsers, setSessionsWithUsers] = useState<SessionWithUser[]>([]);
    const [switchingToUserId, setSwitchingToUserId] = useState<string | null>(null);
    const [removingUserId, setRemovingUserId] = useState<string | null>(null);

    // Device session management state
    const [showDeviceManagement, setShowDeviceManagement] = useState(false);
    const [deviceSessions, setDeviceSessions] = useState<DeviceSession[]>([]);
    const [loadingDeviceSessions, setLoadingDeviceSessions] = useState(false);
    const [remotingLogoutSessionId, setRemoteLogoutSessionId] = useState<string | null>(null);
    const [loggingOutAllDevices, setLoggingOutAllDevices] = useState(false);

    const screenWidth = Dimensions.get('window').width;
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const normalizedTheme = normalizeTheme(theme);
    const themeStyles = useThemeStyles(normalizedTheme, colorScheme);

    // Modern color scheme - memoized for performance
    // Uses themeStyles for base colors, with some custom additions for this screen
    const colors = useMemo(() => ({
        background: themeStyles.backgroundColor,
        surface: themeStyles.secondaryBackgroundColor,
        card: themeStyles.isDarkTheme ? '#2C2C2E' : '#FFFFFF',
        text: themeStyles.textColor,
        secondaryText: themeStyles.isDarkTheme ? '#8E8E93' : '#6D6D70',
        accent: themeStyles.primaryColor,
        destructive: themeStyles.dangerColor,
        success: themeStyles.successColor,
        border: themeStyles.borderColor,
        activeCard: themeStyles.isDarkTheme ? '#0A84FF20' : '#007AFF15',
        shadow: themeStyles.isDarkTheme ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)',
    }), [themeStyles]);

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
                batchResults.forEach(({ sessionId, user }) => {
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

    const handleRemoveSession = useCallback(async (sessionId: string, displayName: string) => {
        if (removingUserId) return; // Already removing

        confirmAction(
            t('accountSwitcher.confirms.remove', { displayName }) || `Are you sure you want to remove ${displayName} from this device? You'll need to sign in again to access this account.`,
            async () => {
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
                }
            }
        );
    }, [removeSession, t, removingUserId]);

    const handleLogoutAll = useCallback(() => {
        confirmAction(
            t('accountSwitcher.confirms.logoutAll') || 'Are you sure you want to sign out of all accounts? This will remove all saved accounts from this device.',
            async () => {
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
            }
        );
    }, [logoutAll, onClose, t]);

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

    const handleRemoteSessionLogout = useCallback((sessionId: string, deviceName: string) => {
        if (remotingLogoutSessionId) return; // Already processing

        confirmAction(
            t('accountSwitcher.confirms.remoteLogout', { deviceName }) || `Are you sure you want to sign out from "${deviceName}"? This will end the session on that device.`,
            async () => {
                setRemoteLogoutSessionId(sessionId);
                try {
                    await oxyServices?.logoutSession((activeSessionId ?? null) || '', sessionId);
                    await loadAllDeviceSessions();
                    toast.success(t('accountSwitcher.toasts.remoteSignOutSuccess', { deviceName }) || `Signed out from ${deviceName} successfully!`);
                } catch (error) {
                    if (__DEV__) {
                        console.error('Remote logout failed:', error);
                    }
                    toast.error(t('accountSwitcher.toasts.remoteSignOutFailed') || 'There was a problem signing out from the device. Please try again.');
                } finally {
                    setRemoteLogoutSessionId(null);
                }
            }
        );
    }, [activeSessionId, oxyServices, loadAllDeviceSessions, t, remotingLogoutSessionId]);

    const handleLogoutAllDevices = useCallback(() => {
        const otherDevicesCount = deviceSessions.filter(session => !session.isCurrent).length;

        if (otherDevicesCount === 0) {
            toast.info(t('accountSwitcher.toasts.noOtherDeviceSessions') || 'No other device sessions found to sign out from.');
            return;
        }

        if (loggingOutAllDevices) return; // Already processing

        confirmAction(
            t('accountSwitcher.confirms.logoutOthers', { count: otherDevicesCount }) || `Are you sure you want to sign out from all ${otherDevicesCount} other device(s)? This will end sessions on all other devices except this one.`,
            async () => {
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
            }
        );
    }, [deviceSessions, activeSessionId, oxyServices, loadAllDeviceSessions, t, loggingOutAllDevices]);

    // Memoize filtered sessions for performance
    const otherSessions = useMemo(
        () => sessionsWithUsers.filter(s => s.sessionId !== (activeSessionId ?? null)),
        [sessionsWithUsers, activeSessionId]
    );

    return (
        <View style={[styles.container, { backgroundColor: '#f2f2f2' }]}>
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
                                        {typeof user.avatar === 'string' && user.avatar ? (
                                            <Image source={{ uri: oxyServices.getFileDownloadUrl(user.avatar as string, 'thumb') }} style={styles.accountAvatarImage} />
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
                                                ) : (typeof userProfile?.avatar === 'string' && userProfile.avatar) ? (
                                                    <Image source={{ uri: oxyServices.getFileDownloadUrl(userProfile.avatar as string, 'thumb') }} style={styles.accountAvatarImage} />
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
                                                    onPress={() => handleRemoveSession(sessionWithUser.sessionId, displayName)}
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

                        {/* Quick Actions */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Quick Actions</Text>

                            <GroupedSection
                                items={[
                                    {
                                        id: 'add-account',
                                        icon: 'account-plus',
                                        iconColor: '#007AFF',
                                        title: 'Add Another Account',
                                        subtitle: 'Sign in with a different account',
                                        onPress: () => navigate?.('SignIn'),
                                    },
                                    {
                                        id: 'device-management',
                                        icon: 'cellphone',
                                        iconColor: '#5856D6',
                                        title: `${showDeviceManagement ? 'Hide' : 'Manage'} Device Sessions`,
                                        subtitle: 'View and manage sessions on other devices',
                                        onPress: () => setShowDeviceManagement(!showDeviceManagement),
                                    },
                                    {
                                        id: 'sign-out-all',
                                        icon: 'logout',
                                        iconColor: '#FF3B30',
                                        title: 'Sign Out All Accounts',
                                        subtitle: 'Remove all accounts from this device',
                                        onPress: handleLogoutAll,
                                        disabled: sessionsWithUsers.length === 0,
                                    },
                                ]}

                            />
                        </View>

                        {/* Device Management Section */}
                        {showDeviceManagement && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>{t('accountSwitcher.sections.deviceSessions') || 'Device Sessions'}</Text>

                                {loadingDeviceSessions ? (
                                    <GroupedSection
                                        items={[
                                            {
                                                id: 'loading-device-sessions',
                                                icon: 'sync',
                                                iconColor: '#007AFF',
                                                title: t('accountSwitcher.device.loadingTitle') || 'Loading device sessions...',
                                                subtitle: t('accountSwitcher.device.loadingSubtitle') || 'Please wait while we fetch your device sessions',
                                                disabled: true,
                                                customContent: (
                                                    <ActivityIndicator size="small" color="#007AFF" style={{ marginRight: 16 }} />
                                                ),
                                            },
                                        ]}

                                    />
                                ) : deviceSessions.length === 0 ? (
                                    <GroupedSection
                                        items={[
                                            {
                                                id: 'no-device-sessions',
                                                icon: 'cellphone',
                                                iconColor: '#ccc',
                                                title: t('accountSwitcher.device.noneTitle') || 'No device sessions found',
                                                subtitle: t('accountSwitcher.device.noneSubtitle') || 'Device session management not available',
                                                disabled: true,
                                            },
                                        ]}

                                    />
                                ) : (
                                    <GroupedSection
                                        items={deviceSessions.map((session, index) => ({
                                            id: `device-session-${session.sessionId}`,
                                            icon: session.isCurrent ? 'cellphone' : 'cellphone-basic',
                                            iconColor: session.isCurrent ? '#34C759' : '#8E8E93',
                                            title: `${session.deviceName} ${session.isCurrent ? '(' + (t('accountSwitcher.device.thisDevice') || 'This device') + ')' : ''}`,
                                            subtitle: t('accountSwitcher.device.lastActive', { date: new Date(session.lastActive).toLocaleDateString() }) || `Last active: ${new Date(session.lastActive).toLocaleDateString()}`,
                                            onPress: session.isCurrent ? undefined : () => handleRemoteSessionLogout(session.sessionId, session.deviceName),
                                            disabled: session.isCurrent || remotingLogoutSessionId === session.sessionId,
                                            customContent: !session.isCurrent ? (
                                                <TouchableOpacity
                                                    style={styles.removeButton}
                                                    onPress={() => handleRemoteSessionLogout(session.sessionId, session.deviceName)}
                                                    disabled={remotingLogoutSessionId === session.sessionId}
                                                >
                                                    {remotingLogoutSessionId === session.sessionId ? (
                                                        <ActivityIndicator size="small" color="#FF3B30" />
                                                    ) : (
                                                        <OxyIcon name="log-out" size={16} color="#FF3B30" />
                                                    )}
                                                </TouchableOpacity>
                                            ) : undefined,
                                        }))}

                                    />
                                )}
                            </View>
                        )}

                        {/* Empty State */}
                        {sessionsWithUsers.length === 0 && (
                            <View style={styles.section}>
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'empty-state',
                                            icon: 'account-outline',
                                            iconColor: '#ccc',
                                            title: t('accountSwitcher.empty.title') || 'No saved accounts',
                                            subtitle: t('accountSwitcher.empty.subtitle') || 'Add another account to switch between them quickly',
                                            onPress: () => navigate?.('SignIn'),
                                            customContent: (
                                                <View style={styles.emptyStateContainer}>
                                                    <OxyIcon name="person-outline" size={48} color="#ccc" />
                                                    <Text style={styles.emptyStateTitle}>{t('accountSwitcher.empty.title') || 'No saved accounts'}</Text>
                                                    <Text style={styles.emptyStateDescription}>
                                                        {t('accountSwitcher.empty.subtitle') || 'Add another account to switch between them quickly'}
                                                    </Text>
                                                    <TouchableOpacity
                                                        style={styles.addAccountButton}
                                                        onPress={() => navigate?.('SignIn')}
                                                    >
                                                        <Text style={styles.addAccountButtonText}>{t('accountCenter.sections.addAccount') || 'Add Account'}</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            ),
                                        },
                                    ]}

                                />
                            </View>
                        )}
                    </>
                )}
            </ScrollView>
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
        fontFamily: fontFamilies.phuduSemiBold,
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
});

export default ModernAccountSwitcherScreen;

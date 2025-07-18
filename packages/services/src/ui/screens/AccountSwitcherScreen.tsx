import React, { useState, useEffect } from 'react';
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
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { SecureClientSession } from '../../models/secureSession';
import { fontFamilies } from '../styles/fonts';
import { User } from '../../models/interfaces';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';

interface SessionWithUser extends SecureClientSession {
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
    oxyServices,
}) => {
    const {
        user,
        sessions,
        activeSessionId,
        switchSession,
        removeSession,
        logoutAll,
        isLoading,
        isAuthenticated
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
    const isDarkTheme = theme === 'dark';

    // Modern color scheme
    const colors = {
        background: isDarkTheme ? '#000000' : '#FFFFFF',
        surface: isDarkTheme ? '#1C1C1E' : '#F2F2F7',
        card: isDarkTheme ? '#2C2C2E' : '#FFFFFF',
        text: isDarkTheme ? '#FFFFFF' : '#000000',
        secondaryText: isDarkTheme ? '#8E8E93' : '#6D6D70',
        accent: '#007AFF',
        destructive: '#FF3B30',
        success: '#34C759',
        border: isDarkTheme ? '#38383A' : '#C6C6C8',
        activeCard: isDarkTheme ? '#0A84FF20' : '#007AFF15',
        shadow: isDarkTheme ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)',
    };

    // Load user profiles for sessions
    useEffect(() => {
        const loadUserProfiles = async () => {
            if (!sessions.length || !oxyServices) return;

            const updatedSessions: SessionWithUser[] = sessions.map(session => ({
                ...session,
                isLoadingProfile: true,
            }));
            setSessionsWithUsers(updatedSessions);

            // Load profiles for each session
            for (let i = 0; i < sessions.length; i++) {
                const session = sessions[i];
                try {
                    // Try to get user profile using the session
                    const userProfile = await oxyServices.getUserBySession(session.sessionId);

                    setSessionsWithUsers(prev =>
                        prev.map(s =>
                            s.sessionId === session.sessionId
                                ? { ...s, userProfile, isLoadingProfile: false }
                                : s
                        )
                    );
                } catch (error) {
                    console.error(`Failed to load profile for session ${session.sessionId}:`, error);
                    setSessionsWithUsers(prev =>
                        prev.map(s =>
                            s.sessionId === session.sessionId
                                ? { ...s, isLoadingProfile: false }
                                : s
                        )
                    );
                }
            }
        };

        loadUserProfiles();
    }, [sessions, oxyServices]);

    const handleSwitchSession = async (sessionId: string) => {
        if (sessionId === user?.sessionId) return; // Already active session

        setSwitchingToUserId(sessionId);
        try {
            await switchSession(sessionId);
            toast.success('Account switched successfully!');
            if (onClose) {
                onClose();
            }
        } catch (error) {
            console.error('Switch session failed:', error);
            toast.error('There was a problem switching accounts. Please try again.');
        } finally {
            setSwitchingToUserId(null);
        }
    };

    const handleRemoveSession = async (sessionId: string, displayName: string) => {
        confirmAction(
            `Are you sure you want to remove ${displayName} from this device? You'll need to sign in again to access this account.`,
            async () => {
                setRemovingUserId(sessionId);
                try {
                    await removeSession(sessionId);
                    toast.success('Account removed successfully!');
                } catch (error) {
                    console.error('Remove session failed:', error);
                    toast.error('There was a problem removing the account. Please try again.');
                } finally {
                    setRemovingUserId(null);
                }
            }
        );
    };

    const handleLogoutAll = async () => {
        // IMPORTANT DEBUG INFO - Check this in console
        console.log('🔴 DEBUG handleLogoutAll called');
        console.log('🔴 Current user:', user);
        console.log('🔴 activeSessionId:', activeSessionId);
        console.log('🔴 sessions count:', sessions?.length || 0);
        console.log('🔴 sessions array:', sessions);
        console.log('🔴 isLoading:', isLoading);
        console.log('🔴 logoutAll function type:', typeof logoutAll);

        // Check if we have the required data
        if (!activeSessionId) {
            console.error('🔴 ERROR: No activeSessionId found!');
            toast.error('No active session found. You may already be logged out.');
            return;
        }

        if (typeof logoutAll !== 'function') {
            console.error('🔴 ERROR: logoutAll is not a function!', typeof logoutAll);
            toast.error('Logout function not available. Please try refreshing the app.');
            return;
        }

        // TEMPORARY: Skip confirmation dialog to test direct logout
        console.log('🔴 TESTING: Bypassing confirmation dialog for direct test');
        try {
            console.log('🔴 TESTING: About to call logoutAll() directly');
            await logoutAll();
            console.log('🔴 TESTING: logoutAll() completed successfully');
            toast.success('All accounts signed out successfully!');
            if (onClose) {
                console.log('🔴 TESTING: Calling onClose');
                onClose();
            }
        } catch (error) {
            console.error('🔴 TESTING: Logout all failed:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            toast.error(`There was a problem signing out: ${errorMessage}`);
        }
    };

    // Device session management functions
    const loadAllDeviceSessions = async () => {
        if (!oxyServices || !user?.sessionId) return;

        setLoadingDeviceSessions(true);
        try {
            // This would call the API to get all device sessions for the current user
            const allSessions = await oxyServices.getDeviceSessions(user.sessionId);
            setDeviceSessions(allSessions || []);
        } catch (error) {
            console.error('Failed to load device sessions:', error);
            toast.error('Failed to load device sessions. Please try again.');
        } finally {
            setLoadingDeviceSessions(false);
        }
    };

    const handleRemoteSessionLogout = async (sessionId: string, deviceName: string) => {
        confirmAction(
            `Are you sure you want to sign out from "${deviceName}"? This will end the session on that device.`,
            async () => {
                setRemoteLogoutSessionId(sessionId);
                try {
                    await oxyServices?.logoutSecureSession(user?.sessionId || '', sessionId);
                    // Refresh device sessions list
                    await loadAllDeviceSessions();
                    toast.success(`Signed out from ${deviceName} successfully!`);
                } catch (error) {
                    console.error('Remote logout failed:', error);
                    toast.error('There was a problem signing out from the device. Please try again.');
                } finally {
                    setRemoteLogoutSessionId(null);
                }
            }
        );
    };

    const handleLogoutAllDevices = async () => {
        const otherDevicesCount = deviceSessions.filter(session => !session.isCurrent).length;

        if (otherDevicesCount === 0) {
            toast.info('No other device sessions found to sign out from.');
            return;
        }

        confirmAction(
            `Are you sure you want to sign out from all ${otherDevicesCount} other device(s)? This will end sessions on all other devices except this one.`,
            async () => {
                setLoggingOutAllDevices(true);
                try {
                    await oxyServices?.logoutAllDeviceSessions(user?.sessionId || '', undefined, true);
                    // Refresh device sessions list
                    await loadAllDeviceSessions();
                    toast.success('Signed out from all other devices successfully!');
                } catch (error) {
                    console.error('Logout all devices failed:', error);
                    toast.error('There was a problem signing out from other devices. Please try again.');
                } finally {
                    setLoggingOutAllDevices(false);
                }
            }
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: '#f2f2f2' }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={goBack}>
                    <OxyIcon name="chevron-back" size={24} color="#007AFF" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Account Switcher</Text>
                {onClose && (
                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <Text style={styles.closeButtonText}>×</Text>
                    </TouchableOpacity>
                )}
            </View>

            <ScrollView style={styles.content}>
                {isLoading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color="#007AFF" />
                        <Text style={styles.loadingText}>Loading accounts...</Text>
                    </View>
                ) : (
                    <>
                        {/* Current Account */}
                        {isAuthenticated && user && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Current Account</Text>

                                <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem, styles.currentAccountCard]}>
                                    <View style={styles.userIcon}>
                                        {user.avatar?.url ? (
                                            <Image source={{ uri: user.avatar.url }} style={styles.accountAvatarImage} />
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
                                        <Text style={styles.currentBadgeText}>Current</Text>
                                    </View>
                                </View>
                            </View>
                        )}

                        {/* Other Accounts */}
                        {sessionsWithUsers.filter(s => s.sessionId !== activeSessionId).length > 0 && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>
                                    Other Accounts ({sessionsWithUsers.filter(s => s.sessionId !== activeSessionId).length})
                                </Text>

                                {sessionsWithUsers
                                    .filter(s => s.sessionId !== activeSessionId)
                                    .map((sessionWithUser, index, filteredArray) => {
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
                                                key={sessionWithUser.sessionId}
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
                                                    ) : userProfile?.avatar?.url ? (
                                                        <Image source={{ uri: userProfile.avatar.url }} style={styles.accountAvatarImage} />
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

                            <TouchableOpacity
                                style={[styles.settingItem, styles.firstSettingItem]}
                                onPress={() => navigate?.('SignIn')}
                            >
                                <View style={styles.settingInfo}>
                                    <OxyIcon name="person-add" size={20} color="#007AFF" style={styles.settingIcon} />
                                    <View>
                                        <Text style={styles.settingLabel}>Add Another Account</Text>
                                        <Text style={styles.settingDescription}>Sign in with a different account</Text>
                                    </View>
                                </View>
                                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.settingItem}
                                onPress={() => setShowDeviceManagement(!showDeviceManagement)}
                            >
                                <View style={styles.settingInfo}>
                                    <OxyIcon name="devices" size={20} color="#5856D6" style={styles.settingIcon} />
                                    <View>
                                        <Text style={styles.settingLabel}>
                                            {showDeviceManagement ? 'Hide' : 'Manage'} Device Sessions
                                        </Text>
                                        <Text style={styles.settingDescription}>
                                            View and manage sessions on other devices
                                        </Text>
                                    </View>
                                </View>
                                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.settingItem, styles.lastSettingItem]}
                                onPress={handleLogoutAll}
                                disabled={sessionsWithUsers.length === 0}
                            >
                                <View style={styles.settingInfo}>
                                    <OxyIcon name="log-out" size={20} color="#FF3B30" style={styles.settingIcon} />
                                    <View>
                                        <Text style={[styles.settingLabel, { color: sessionsWithUsers.length === 0 ? '#ccc' : '#FF3B30' }]}>
                                            Sign Out All Accounts
                                        </Text>
                                        <Text style={styles.settingDescription}>
                                            Remove all accounts from this device
                                        </Text>
                                    </View>
                                </View>
                                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                            </TouchableOpacity>
                        </View>

                        {/* Device Management Section */}
                        {showDeviceManagement && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Device Sessions</Text>

                                {loadingDeviceSessions ? (
                                    <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}>
                                        <View style={styles.loadingContainer}>
                                            <ActivityIndicator size="small" color="#007AFF" />
                                            <Text style={styles.loadingText}>Loading device sessions...</Text>
                                        </View>
                                    </View>
                                ) : deviceSessions.length === 0 ? (
                                    <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}>
                                        <View style={styles.settingInfo}>
                                            <OxyIcon name="phone-portrait" size={20} color="#ccc" style={styles.settingIcon} />
                                            <View>
                                                <Text style={styles.settingLabel}>No device sessions found</Text>
                                                <Text style={styles.settingDescription}>
                                                    Device session management not available
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                ) : (
                                    <>
                                        {deviceSessions.map((session, index) => (
                                            <View
                                                key={session.sessionId}
                                                style={[
                                                    styles.settingItem,
                                                    index === 0 && styles.firstSettingItem,
                                                    index === deviceSessions.length - 1 && styles.lastSettingItem,
                                                ]}
                                            >
                                                <View style={styles.settingInfo}>
                                                    <OxyIcon
                                                        name={session.isCurrent ? "phone-portrait" : "phone-portrait-outline"}
                                                        size={20}
                                                        color={session.isCurrent ? "#34C759" : "#8E8E93"}
                                                        style={styles.settingIcon}
                                                    />
                                                    <View>
                                                        <Text style={styles.settingLabel}>
                                                            {session.deviceName} {session.isCurrent ? '(This device)' : ''}
                                                        </Text>
                                                        <Text style={styles.settingDescription}>
                                                            Last active: {new Date(session.lastActive).toLocaleDateString()}
                                                        </Text>
                                                    </View>
                                                </View>
                                                {!session.isCurrent && (
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
                                                )}
                                            </View>
                                        ))}
                                    </>
                                )}
                            </View>
                        )}

                        {/* Empty State */}
                        {sessionsWithUsers.length === 0 && (
                            <View style={styles.section}>
                                <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}>
                                    <View style={styles.emptyStateContainer}>
                                        <OxyIcon name="person-outline" size={48} color="#ccc" />
                                        <Text style={styles.emptyStateTitle}>No saved accounts</Text>
                                        <Text style={styles.emptyStateDescription}>
                                            Add another account to switch between them quickly
                                        </Text>
                                        <TouchableOpacity
                                            style={styles.addAccountButton}
                                            onPress={() => navigate?.('SignIn')}
                                        >
                                            <Text style={styles.addAccountButtonText}>Add Account</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
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
    header: {
        paddingHorizontal: 20,
        paddingTop: 60,
        paddingBottom: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000',
    },
    backButton: {
        padding: 8,
    },
    closeButton: {
        padding: 8,
    },
    closeButtonText: {
        fontSize: 24,
        color: '#000',
        fontWeight: '300',
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
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
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
    settingIcon: {
        marginRight: 12,
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
    loadingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 20,
        gap: 12,
    },
    loadingText: {
        fontSize: 16,
        color: '#666',
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

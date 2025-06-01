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
        isLoading 
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

    const handleRemoveSession = async (sessionId: string) => {
        const sessionToRemove = sessionsWithUsers.find(s => s.sessionId === sessionId);
        if (!sessionToRemove) return;

        const displayName = typeof sessionToRemove.userProfile?.name === 'object' 
            ? sessionToRemove.userProfile.name.full || sessionToRemove.userProfile.name.first || sessionToRemove.userProfile.username
            : sessionToRemove.userProfile?.name || sessionToRemove.userProfile?.username || 'this account';

        Alert.alert(
            'Remove Account',
            `Are you sure you want to remove ${displayName} from this device? You'll need to sign in again to access this account.`,
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
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
                    },
                },
            ],
            { cancelable: true }
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
        
        /* ORIGINAL CODE WITH CONFIRMATION - TEMPORARILY DISABLED
        Alert.alert(
            'Sign Out All',
            'Are you sure you want to sign out of all accounts on this device?',
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                    onPress: () => {
                        console.log('🔴 User cancelled logout');
                    }
                },
                {
                    text: 'Sign Out All',
                    style: 'destructive',
                    onPress: async () => {
                        console.log('🔴 CONFIRMATION: User confirmed logout all - proceeding...');
                        try {
                            console.log('🔴 CONFIRMATION: About to call logoutAll()');
                            await logoutAll();
                            console.log('🔴 CONFIRMATION: logoutAll() completed successfully');
                            toast.success('All accounts signed out successfully!');
                            if (onClose) {
                                console.log('🔴 CONFIRMATION: Calling onClose');
                                onClose();
                            }
                        } catch (error) {
                            console.error('🔴 CONFIRMATION: Logout all failed:', error);
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                            toast.error(`There was a problem signing out: ${errorMessage}`);
                        }
                    },
                },
            ],
            { cancelable: true }
        );
        */
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
        Alert.alert(
            'Remove Device Session',
            `Are you sure you want to sign out from "${deviceName}"? This will end the session on that device.`,
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Sign Out',
                    style: 'destructive',
                    onPress: async () => {
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
                    },
                },
            ],
            { cancelable: true }
        );
    };

    const handleLogoutAllDevices = async () => {
        const otherDevicesCount = deviceSessions.filter(session => !session.isCurrent).length;
        
        if (otherDevicesCount === 0) {
            toast.info('No other device sessions found to sign out from.');
            return;
        }

        Alert.alert(
            'Sign Out All Other Devices',
            `Are you sure you want to sign out from all ${otherDevicesCount} other device(s)? This will end sessions on all other devices except this one.`,
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Sign Out All',
                    style: 'destructive',
                    onPress: async () => {
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
                    },
                },
            ],
            { cancelable: true }
        );
    };

    const renderDeviceSessionItem = (deviceSession: DeviceSession) => {
        const isLoggingOut = remotingLogoutSessionId === deviceSession.sessionId;
        
        return (
            <View
                key={deviceSession.sessionId}
                style={[
                    styles.sessionCard,
                    {
                        backgroundColor: deviceSession.isCurrent ? colors.activeCard : colors.card,
                        borderColor: deviceSession.isCurrent ? colors.accent : colors.border,
                        borderWidth: deviceSession.isCurrent ? 2 : 1,
                    },
                ]}
            >
                <View style={styles.sessionHeader}>
                    <View style={styles.userInfo}>
                        <Text style={[styles.displayName, { color: colors.text }]} numberOfLines={1}>
                            {deviceSession.deviceName}
                            {deviceSession.isCurrent && (
                                <Text style={[styles.username, { color: colors.accent }]}>
                                    {' (This Device)'}
                                </Text>
                            )}
                        </Text>
                        <Text style={[styles.username, { color: colors.secondaryText }]} numberOfLines={1}>
                            ID: ...{deviceSession.deviceId.slice(-8)}
                        </Text>
                        <Text style={[styles.lastActive, { color: colors.secondaryText }]} numberOfLines={1}>
                            Last active: {new Date(deviceSession.lastActive).toLocaleDateString()}
                        </Text>
                    </View>
                    
                    {!deviceSession.isCurrent && (
                        <TouchableOpacity
                            style={[styles.removeButton, { 
                                borderColor: colors.destructive,
                                backgroundColor: colors.background,
                            }]}
                            onPress={() => handleRemoteSessionLogout(deviceSession.sessionId, deviceSession.deviceName)}
                            disabled={isLoggingOut}
                        >
                            {isLoggingOut ? (
                                <ActivityIndicator color={colors.destructive} size="small" />
                            ) : (
                                <Text style={[styles.removeButtonText, { color: colors.destructive }]}>
                                    Sign Out
                                </Text>
                            )}
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        );
    };

    // Load device sessions when device management is shown
    useEffect(() => {
        if (showDeviceManagement && deviceSessions.length === 0) {
            loadAllDeviceSessions();
        }
    }, [showDeviceManagement]);

    const renderSessionItem = (sessionWithUser: SessionWithUser) => {
        const isActive = sessionWithUser.sessionId === activeSessionId;
        const isSwitching = switchingToUserId === sessionWithUser.sessionId;
        const isRemoving = removingUserId === sessionWithUser.sessionId;
        const { userProfile, isLoadingProfile } = sessionWithUser;

        const displayName = typeof userProfile?.name === 'object' 
            ? userProfile.name.full || userProfile.name.first || userProfile.username 
            : userProfile?.name || userProfile?.username || 'Unknown User';
        const username = userProfile?.username || 'unknown';
        const avatarUrl = userProfile?.avatar?.url;

        return (
            <View
                key={sessionWithUser.sessionId}
                style={[
                    styles.sessionCard,
                    {
                        backgroundColor: isActive ? colors.activeCard : colors.card,
                        borderColor: isActive ? colors.accent : colors.border,
                        borderWidth: isActive ? 2 : 1,
                        shadowColor: colors.shadow,
                    },
                ]}
            >
                <View style={styles.sessionHeader}>
                    <View style={styles.avatarContainer}>
                        {isLoadingProfile ? (
                            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.surface }]}>
                                <ActivityIndicator size="small" color={colors.accent} />
                            </View>
                        ) : avatarUrl ? (
                            <Image 
                                source={{ uri: avatarUrl }} 
                                style={styles.avatar}
                            />
                        ) : (
                            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.surface }]}>
                                <Text style={[styles.avatarText, { color: colors.accent }]}>
                                    {displayName.charAt(0).toUpperCase()}
                                </Text>
                            </View>
                        )}
                        {isActive && (
                            <View style={[styles.activeBadge, { backgroundColor: colors.success }]}>
                                <Text style={styles.activeBadgeText}>✓</Text>
                            </View>
                        )}
                    </View>
                    
                    <View style={styles.userInfo}>
                        <Text style={[styles.displayName, { color: colors.text }]} numberOfLines={1}>
                            {displayName}
                        </Text>
                        <Text style={[styles.username, { color: colors.secondaryText }]} numberOfLines={1}>
                            @{username}
                        </Text>
                        <Text style={[styles.lastActive, { color: colors.secondaryText }]} numberOfLines={1}>
                            Last active: {new Date(sessionWithUser.lastActive).toLocaleDateString()}
                        </Text>
                    </View>
                </View>

                <View style={styles.sessionActions}>
                    {!isActive && (
                        <TouchableOpacity
                            style={[styles.switchButton, { 
                                borderColor: colors.accent,
                                backgroundColor: colors.background,
                            }]}
                            onPress={() => handleSwitchSession(sessionWithUser.sessionId)}
                            disabled={isSwitching || isRemoving}
                        >
                            {isSwitching ? (
                                <ActivityIndicator color={colors.accent} size="small" />
                            ) : (
                                <Text style={[styles.switchButtonText, { color: colors.accent }]}>
                                    Switch
                                </Text>
                            )}
                        </TouchableOpacity>
                    )}
                    
                    <TouchableOpacity
                        style={[styles.removeButton, { 
                            borderColor: colors.destructive,
                            backgroundColor: colors.background,
                        }]}
                        onPress={() => handleRemoveSession(sessionWithUser.sessionId)}
                        disabled={isSwitching || isRemoving}
                    >
                        {isRemoving ? (
                            <ActivityIndicator color={colors.destructive} size="small" />
                        ) : (
                            <Text style={[styles.removeButtonText, { color: colors.destructive }]}>
                                Remove
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={goBack}>
                    <Text style={[styles.backButtonText, { color: colors.accent }]}>‹ Back</Text>
                </TouchableOpacity>
                <Text style={[styles.title, { color: colors.text }]}>Accounts</Text>
                <View style={styles.headerSpacer} />
            </View>

            <ScrollView 
                style={styles.content} 
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                {isLoading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.accent} />
                        <Text style={[styles.loadingText, { color: colors.secondaryText }]}>
                            Loading accounts...
                        </Text>
                    </View>
                ) : (
                    <>
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>
                            Saved Accounts ({sessionsWithUsers.length})
                        </Text>
                        
                        {sessionsWithUsers.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                                    No saved accounts found
                                </Text>
                            </View>
                        ) : (
                            sessionsWithUsers.map(renderSessionItem)
                        )}

                        <View style={styles.actionsSection}>
                            <TouchableOpacity
                                style={[styles.actionButton, { 
                                    borderColor: colors.border,
                                    backgroundColor: colors.card,
                                }]}
                                onPress={() => navigate?.('SignIn')}
                            >
                                <Text style={[styles.actionButtonText, { color: colors.text }]}>
                                    + Add Another Account
                                </Text>
                            </TouchableOpacity>

                            {sessionsWithUsers.length > 0 && (
                                <TouchableOpacity
                                    style={[styles.actionButton, styles.dangerButton, { 
                                        borderColor: colors.destructive,
                                        backgroundColor: colors.background,
                                    }]}
                                    onPress={handleLogoutAll}
                                >
                                    <Text style={[styles.dangerButtonText, { color: colors.destructive }]}>
                                        Sign Out All Accounts
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Device Management Section */}
                        <View style={styles.actionsSection}>
                            <TouchableOpacity
                                style={[styles.actionButton, { 
                                    borderColor: colors.border,
                                    backgroundColor: colors.card,
                                }]}
                                onPress={() => setShowDeviceManagement(!showDeviceManagement)}
                            >
                                <Text style={[styles.actionButtonText, { color: colors.text }]}>
                                    {showDeviceManagement ? '− Hide Device Management' : '+ Manage Device Sessions'}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {showDeviceManagement && (
                            <View style={[styles.deviceManagementSection, {
                                backgroundColor: colors.card,
                                borderColor: colors.border,
                            }]}>
                                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                                    Device Sessions
                                </Text>
                                
                                {loadingDeviceSessions ? (
                                    <View style={styles.loadingContainer}>
                                        <ActivityIndicator size="large" color={colors.accent} />
                                        <Text style={[styles.loadingText, { color: colors.secondaryText }]}>
                                            Loading device sessions...
                                        </Text>
                                    </View>
                                ) : deviceSessions.length === 0 ? (
                                    <View style={styles.emptyState}>
                                        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                                            No device sessions found
                                        </Text>
                                    </View>
                                ) : (
                                    <>
                                        {deviceSessions.map(renderDeviceSessionItem)}
                                        
                                        {deviceSessions.filter(session => !session.isCurrent).length > 0 && (
                                            <TouchableOpacity
                                                style={[styles.actionButton, styles.dangerButton, { 
                                                    borderColor: colors.destructive,
                                                    backgroundColor: colors.background,
                                                    marginTop: 20,
                                                }]}
                                                onPress={handleLogoutAllDevices}
                                                disabled={loggingOutAllDevices}
                                            >
                                                {loggingOutAllDevices ? (
                                                    <ActivityIndicator color={colors.destructive} size="small" />
                                                ) : (
                                                    <Text style={[styles.dangerButtonText, { color: colors.destructive }]}>
                                                        Sign Out All Other Devices
                                                    </Text>
                                                )}
                                            </TouchableOpacity>
                                        )}
                                    </>
                                )}
                            </View>
                        )}

                        <View style={styles.actionsSection}>
                            <TouchableOpacity
                                style={[styles.actionButton, { 
                                    borderColor: colors.border,
                                    backgroundColor: colors.card,
                                }]}
                                onPress={() => navigate?.('SignIn')}
                            >
                                <Text style={[styles.actionButtonText, { color: colors.text }]}>
                                    + Add Another Account
                                </Text>
                            </TouchableOpacity>

                            {sessionsWithUsers.length > 0 && (
                                <TouchableOpacity
                                    style={[styles.actionButton, styles.dangerButton, { 
                                        borderColor: colors.destructive,
                                        backgroundColor: colors.background,
                                    }]}
                                    onPress={handleLogoutAll}
                                >
                                    <Text style={[styles.dangerButtonText, { color: colors.destructive }]}>
                                        Sign Out All Accounts
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </>
                )}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 10,
    },
    backButton: {
        padding: 8,
    },
    backButtonText: {
        fontSize: 18,
        fontFamily: fontFamilies.phuduMedium,
    },
    title: {
        fontSize: 24,
        fontFamily: fontFamilies.phuduBold,
        textAlign: 'center',
    },
    headerSpacer: {
        width: 40,
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
    },
    scrollContent: {
        paddingBottom: 40,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 60,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        fontFamily: fontFamilies.phudu,
    },
    sectionTitle: {
        fontSize: 20,
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 20,
        marginTop: 10,
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    emptyText: {
        fontSize: 16,
        fontFamily: fontFamilies.phudu,
        textAlign: 'center',
    },
    sessionCard: {
        borderRadius: 16,
        marginBottom: 16,
        padding: 20,
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
    },
    sessionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    avatarContainer: {
        position: 'relative',
        marginRight: 16,
    },
    avatar: {
        width: 60,
        height: 60,
        borderRadius: 30,
    },
    avatarPlaceholder: {
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        fontSize: 24,
        fontFamily: fontFamilies.phuduBold,
    },
    activeBadge: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: 20,
        height: 20,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    activeBadgeText: {
        color: 'white',
        fontSize: 12,
        fontFamily: fontFamilies.phuduBold,
    },
    userInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    displayName: {
        fontSize: 18,
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 4,
    },
    username: {
        fontSize: 14,
        fontFamily: fontFamilies.phudu,
        marginBottom: 4,
    },
    lastActive: {
        fontSize: 12,
        fontFamily: fontFamilies.phudu,
    },
    sessionActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
    },
    switchButton: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderWidth: 1,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    switchButtonText: {
        fontSize: 14,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    removeButton: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderWidth: 1,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    removeButtonText: {
        fontSize: 14,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    actionsSection: {
        marginTop: 40,
        gap: 16,
    },
    actionButton: {
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderWidth: 1,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionButtonText: {
        fontSize: 16,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    dangerButton: {
        // Additional styles for danger buttons if needed
    },
    dangerButtonText: {
        fontSize: 16,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    deviceManagementSection: {
        marginTop: 20,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
});

export default ModernAccountSwitcherScreen;

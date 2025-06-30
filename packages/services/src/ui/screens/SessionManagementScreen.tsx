import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Alert,
    Platform,
    RefreshControl,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { useThemeColors } from '../styles';
import { toast } from '../../lib/sonner';
import { Ionicons } from '@expo/vector-icons';

interface SessionDeviceInfo {
    deviceType: string;
    platform: string;
    browser?: string;
    os?: string;
    lastActive: string;
    ipAddress?: string;
    deviceName?: string;
}

interface Session {
    id: string;
    deviceInfo: SessionDeviceInfo;
    createdAt: string;
    isCurrent: boolean;
}

const SessionManagementScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
}) => {
    const { activeSessionId, oxyServices } = useOxy();
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const colors = useThemeColors(theme);

    const loadSessions = async (isRefresh = false) => {
        try {
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            if (!oxyServices) {
                throw new Error('OxyServices not available');
            }

            const sessionsArray = await oxyServices.getUserSessions();

            const sessionsData = sessionsArray.map((session: any) => ({
                id: session.id,
                deviceInfo: {
                    deviceType: session.deviceInfo?.deviceType || 'Unknown',
                    platform: session.deviceInfo?.platform || 'Unknown',
                    browser: session.deviceInfo?.browser || 'Unknown',
                    os: session.deviceInfo?.os || 'Unknown',
                    lastActive: session.deviceInfo?.lastActive || session.createdAt,
                    ipAddress: session.deviceInfo?.ipAddress || 'Unknown',
                    deviceName: session.deviceInfo?.deviceName || null,
                },
                createdAt: session.createdAt,
                isCurrent: session.id === activeSessionId,
            }));

            setSessions(sessionsData);
            console.log('[SessionManagement] Loaded sessions:', {
                count: sessionsData.length,
                activeSessionId: activeSessionId?.substring(0, 8) + '...',
                sessions: sessionsData.map((s: any) => ({
                    id: s.id.substring(0, 8) + '...',
                    isCurrent: s.isCurrent,
                    deviceType: s.deviceInfo.deviceType,
                    platform: s.deviceInfo.platform
                }))
            });
        } catch (error: any) {
            console.error('Failed to load sessions:', error);
            setSessions([]);
            Alert.alert(
                'Error',
                `Failed to load sessions: ${error?.message || 'Unknown error'}. Please try again.`,
                [{ text: 'OK' }]
            );
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleLogoutSession = async (sessionId: string) => {
        const session = sessions.find(s => s.id === sessionId);
        const deviceName = session?.deviceInfo.deviceName || getDeviceDisplayName(session!.deviceInfo);

        Alert.alert(
            'Remove session',
            `Remove "${deviceName}"?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setActionLoading(sessionId);

                            if (!oxyServices) {
                                throw new Error('OxyServices not available');
                            }

                            await oxyServices.logoutSession(sessionId);
                            await loadSessions();

                            toast.success(`Removed "${deviceName}"`);
                        } catch (error: any) {
                            console.error('Logout session failed:', error);
                            toast.error(`Failed to remove "${deviceName}"`);
                        } finally {
                            setActionLoading(null);
                        }
                    },
                },
            ]
        );
    };

    const handleLogoutOtherSessions = async () => {
        console.log('[SessionManagement] handleLogoutOtherSessions called');
        const otherSessions = sessions.filter(s => !s.isCurrent);
        console.log('[SessionManagement] Other sessions count:', otherSessions.length);
        console.log('[SessionManagement] All sessions:', sessions.map(s => ({ id: s.id.substring(0, 8), isCurrent: s.isCurrent })));

        if (otherSessions.length === 0) {
            console.log('[SessionManagement] No other sessions to remove');
            toast.info('No other sessions to remove');
            return;
        }

        // Helper to perform the removal
        const performRemoval = async () => {
            try {
                setActionLoading('others');

                if (!oxyServices) {
                    throw new Error('OxyServices not available');
                }

                console.log('[SessionManagement] Calling oxyServices.logoutOtherSessions()...');
                const result = await oxyServices.logoutOtherSessions();
                console.log('[SessionManagement] logoutOtherSessions result:', result);

                await loadSessions();
                toast.success('Other sessions removed');
            } catch (error: any) {
                console.error('[SessionManagement] Logout other sessions failed:', error);
                toast.error(`Failed to remove other sessions: ${error?.message || 'Unknown error'}`);
            } finally {
                setActionLoading(null);
                console.log('[SessionManagement] Cleared loading state');
            }
        };

        // On web, use window.confirm instead of Alert which doesn't support confirmation properly
        if (Platform.OS === 'web') {
            const confirmed = window.confirm(`Remove ${otherSessions.length} other session${otherSessions.length > 1 ? 's' : ''}?`);
            if (confirmed) {
                await performRemoval();
            }
            return;
        }

        Alert.alert(
            'Remove other sessions',
            `Remove ${otherSessions.length} other session${otherSessions.length > 1 ? 's' : ''}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: performRemoval,
                },
            ]
        );
    };

    const handleLogoutAllSessions = async () => {
        Alert.alert(
            'Remove all sessions',
            'This will sign you out everywhere and you\'ll need to sign in again.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove all',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setActionLoading('all');

                            if (!oxyServices) {
                                throw new Error('OxyServices not available');
                            }

                            await oxyServices.logoutAllSessions();
                        } catch (error: any) {
                            console.error('Logout all sessions failed:', error);
                            toast.error('Failed to remove all sessions');
                            setActionLoading(null);
                        }
                    },
                },
            ]
        );
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

        if (diffInMinutes < 1) return 'Active now';
        if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
        if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
        if (diffInMinutes < 10080) return `${Math.floor(diffInMinutes / 1440)}d ago`;

        return date.toLocaleDateString();
    };

    const getDeviceIcon = (deviceType: string, platform: string) => {
        const type = deviceType.toLowerCase();
        const plat = platform.toLowerCase();

        if (plat.includes('ios') || plat.includes('iphone')) {
            return '📱';
        }
        if (plat.includes('android')) {
            return '📱';
        }
        if (type.includes('mobile') || type.includes('phone')) {
            return '📱';
        }
        if (type.includes('tablet') || type.includes('ipad')) {
            return '📋';
        }
        if (plat.includes('mac') || plat.includes('darwin')) {
            return '💻';
        }
        if (plat.includes('windows')) {
            return '🖥';
        }
        if (plat.includes('linux')) {
            return '🖥';
        }
        if (plat.includes('web') || type.includes('web')) {
            return '🌐';
        }
        return '💻';
    };

    const getDeviceDisplayName = (deviceInfo: SessionDeviceInfo) => {
        if (deviceInfo.deviceName) {
            return deviceInfo.deviceName;
        }

        const platform = deviceInfo.platform;
        const browser = deviceInfo.browser;
        const os = deviceInfo.os;

        if (browser && browser !== 'Unknown') {
            if (os && os !== 'Unknown' && os !== platform) {
                return `${browser} on ${os}`;
            }
            return browser;
        }

        if (platform && platform !== 'Unknown') {
            return platform;
        }

        return 'Unknown device';
    };

    useEffect(() => {
        loadSessions();
    }, []);

    if (loading) {
        return (
            <View style={[styles.container, styles.centerContent, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.secondaryText }]}>Loading sessions...</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerContent}>
                    <Text style={[styles.title, { color: colors.text }]}>Sessions</Text>
                    <TouchableOpacity
                        style={styles.closeButton}
                        onPress={onClose}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons name="close" size={24} color={colors.secondaryText} />
                    </TouchableOpacity>
                </View>
                <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
                    {sessions.length} active session{sessions.length !== 1 ? 's' : ''}
                </Text>
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContainer}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => loadSessions(true)}
                        tintColor={colors.primary}
                    />
                }
                showsVerticalScrollIndicator={false}
            >
                {sessions.length > 0 ? (
                    <>
                        {/* Sessions List */}
                        <View style={styles.sessionsList}>
                            {sessions.map((session, index) => (
                                <View
                                    key={session.id}
                                    style={[
                                        styles.sessionCard,
                                        {
                                            backgroundColor: colors.inputBackground,
                                            borderWidth: 1,
                                            borderColor: colors.border,
                                        },
                                        index === sessions.length - 1 && styles.lastCard
                                    ]}
                                >
                                    <View style={styles.sessionHeader}>
                                        <View style={styles.deviceIconContainer}>
                                            <Text style={styles.deviceIcon}>
                                                {getDeviceIcon(session.deviceInfo.deviceType, session.deviceInfo.platform)}
                                            </Text>
                                        </View>
                                        <View style={styles.sessionInfo}>
                                            <View style={styles.sessionTitleRow}>
                                                <Text style={[styles.deviceName, { color: colors.text }]}>
                                                    {getDeviceDisplayName(session.deviceInfo)}
                                                </Text>
                                                {session.isCurrent && (
                                                    <View style={[styles.currentBadge, { backgroundColor: colors.success }]}>
                                                        <Text style={styles.currentBadgeText}>This device</Text>
                                                    </View>
                                                )}
                                            </View>
                                            <Text style={[styles.lastActive, { color: colors.secondaryText }]}>
                                                {formatDate(session.deviceInfo.lastActive)}
                                            </Text>
                                            <Text style={[styles.location, { color: colors.placeholder }]}>
                                                {session.deviceInfo.platform}
                                                {session.deviceInfo.ipAddress && session.deviceInfo.ipAddress !== 'Unknown' &&
                                                    ` • ${session.deviceInfo.ipAddress}`
                                                }
                                            </Text>
                                        </View>
                                        {!session.isCurrent && (
                                            <TouchableOpacity
                                                style={[styles.removeButton, { opacity: actionLoading === session.id ? 0.5 : 1 }]}
                                                onPress={() => handleLogoutSession(session.id)}
                                                disabled={actionLoading === session.id}
                                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                            >
                                                {actionLoading === session.id ? (
                                                    <ActivityIndicator size="small" color={colors.secondaryText} />
                                                ) : (
                                                    <Ionicons name="close" size={20} color={colors.secondaryText} />
                                                )}
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                </View>
                            ))}
                        </View>

                        {/* Actions */}
                        {sessions.filter(s => !s.isCurrent).length > 0 && (
                            <View style={styles.actionsSection}>
                                <TouchableOpacity
                                    style={[
                                        styles.actionButton,
                                        styles.secondaryButton,
                                        {
                                            backgroundColor: colors.background,
                                            borderColor: colors.border,
                                            opacity: actionLoading === 'others' ? 0.5 : 1
                                        }
                                    ]}
                                    onPress={handleLogoutOtherSessions}
                                    disabled={actionLoading === 'others'}
                                >
                                    {actionLoading === 'others' ? (
                                        <ActivityIndicator size="small" color={colors.secondaryText} />
                                    ) : (
                                        <Text style={[styles.actionButtonText, { color: colors.text }]}>
                                            Remove other sessions
                                        </Text>
                                    )}
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[
                                        styles.actionButton,
                                        styles.dangerButton,
                                        {
                                            backgroundColor: colors.error,
                                            opacity: actionLoading === 'all' ? 0.5 : 1
                                        }
                                    ]}
                                    onPress={handleLogoutAllSessions}
                                    disabled={actionLoading === 'all'}
                                >
                                    {actionLoading === 'all' ? (
                                        <ActivityIndicator size="small" color="#FFFFFF" />
                                    ) : (
                                        <Text style={[styles.actionButtonText, styles.dangerButtonText]}>
                                            Remove all sessions
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        )}
                    </>
                ) : (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyIcon}>🔒</Text>
                        <Text style={[styles.emptyStateTitle, { color: colors.text }]}>
                            No sessions
                        </Text>
                        <Text style={[styles.emptyStateText, { color: colors.secondaryText }]}>
                            Pull down to refresh
                        </Text>
                    </View>
                )}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    centerContent: {
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Header
    header: {
        paddingTop: Platform.OS === 'ios' ? 60 : 20,
        paddingHorizontal: 24,
        paddingBottom: 20,
    },
    headerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    title: {
        fontSize: 28,
        fontWeight: '600',
        letterSpacing: -0.5,
    },
    closeButton: {
        padding: 4,
    },
    subtitle: {
        fontSize: 16,
        fontWeight: '400',
    },

    // Scroll View
    scrollView: {
        flex: 1,
    },
    scrollContainer: {
        paddingHorizontal: 24,
        paddingBottom: 40,
    },

    // Sessions List
    sessionsList: {
        marginBottom: 32,
    },
    sessionCard: {
        borderRadius: 12,
        marginBottom: 16,
        overflow: 'hidden',
    },
    lastCard: {
        marginBottom: 0,
    },
    sessionHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 20,
    },
    deviceIconContainer: {
        marginRight: 16,
        marginTop: 2,
    },
    deviceIcon: {
        fontSize: 24,
    },
    sessionInfo: {
        flex: 1,
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
        flexWrap: 'wrap',
    },
    deviceName: {
        fontSize: 16,
        fontWeight: '600',
        marginRight: 12,
    },
    currentBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 12,
    },
    currentBadgeText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '500',
    },
    lastActive: {
        fontSize: 14,
        fontWeight: '400',
        marginBottom: 4,
    },
    location: {
        fontSize: 13,
        fontWeight: '400',
    },
    removeButton: {
        padding: 8,
        marginLeft: 12,
        marginTop: -4,
    },

    // Actions
    actionsSection: {
        gap: 12,
    },
    actionButton: {
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryButton: {
        borderWidth: 1,
    },
    dangerButton: {
        // No additional styling needed, backgroundColor is set inline
    },
    actionButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    dangerButtonText: {
        color: '#FFFFFF',
    },

    // Empty State
    emptyState: {
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyIcon: {
        fontSize: 48,
        marginBottom: 16,
    },
    emptyStateTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginBottom: 8,
    },
    emptyStateText: {
        fontSize: 16,
        fontWeight: '400',
    },

    // Loading
    loadingText: {
        fontSize: 16,
        fontWeight: '400',
        marginTop: 16,
    },
});

export default SessionManagementScreen;

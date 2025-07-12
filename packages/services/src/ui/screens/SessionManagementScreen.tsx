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
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { Ionicons } from '@expo/vector-icons';
import { SecureClientSession } from '../../models/secureSession';
import { confirmAction } from '../utils/confirmAction';

const SessionManagementScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
}) => {
    const { sessions: userSessions, activeSessionId, refreshSessions, logout, oxyServices } = useOxy();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#F5F5F5';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';
    const primaryColor = '#0066CC';
    const dangerColor = '#D32F2F';
    const successColor = '#2E7D32';

    const loadSessions = async (isRefresh = false) => {
        try {
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            await refreshSessions();
        } catch (error) {
            console.error('Failed to load sessions:', error);
            if (Platform.OS === 'web') {
                toast.error('Failed to load sessions. Please try again.');
            } else {
                Alert.alert(
                    'Error',
                    'Failed to load sessions. Please try again.',
                    [{ text: 'OK' }]
                );
            }
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleLogoutSession = async (sessionId: string) => {
        confirmAction('Are you sure you want to logout this session?', async () => {
            try {
                setActionLoading(sessionId);
                await logout(sessionId);
                await refreshSessions();
                toast.success('Session logged out successfully');
            } catch (error) {
                console.error('Logout session failed:', error);
                toast.error('Failed to logout session. Please try again.');
            } finally {
                setActionLoading(null);
            }
        });
    };

    const handleLogoutOtherSessions = async () => {
        const otherSessionsCount = userSessions.filter(s => s.sessionId !== activeSessionId).length;
        if (otherSessionsCount === 0) {
            toast.info('No other sessions to logout.');
            return;
        }
        confirmAction(
            `This will logout ${otherSessionsCount} other session${otherSessionsCount > 1 ? 's' : ''}. Continue?`,
            async () => {
                try {
                    setActionLoading('others');
                    for (const session of userSessions) {
                        if (session.sessionId !== activeSessionId) {
                            await logout(session.sessionId);
                        }
                    }
                    await refreshSessions();
                    toast.success('Other sessions logged out successfully');
                } catch (error) {
                    console.error('Logout other sessions failed:', error);
                    toast.error('Failed to logout other sessions. Please try again.');
                } finally {
                    setActionLoading(null);
                }
            }
        );
    };

    const handleLogoutAllSessions = async () => {
        confirmAction(
            'This will logout all sessions including this one and you will need to sign in again. Continue?',
            async () => {
                try {
                    setActionLoading('all');
                    await oxyServices.logoutAllSessions();
                } catch (error) {
                    console.error('Logout all sessions failed:', error);
                    toast.error('Failed to logout all sessions. Please try again.');
                    setActionLoading(null);
                }
            }
        );
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

        if (diffInMinutes < 1) return 'Just now';
        if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
        if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
        if (diffInMinutes < 10080) return `${Math.floor(diffInMinutes / 1440)}d ago`;

        return date.toLocaleDateString();
    };

    const getDeviceIcon = (deviceType: string, platform: string) => {
        if (platform.toLowerCase().includes('ios') || platform.toLowerCase().includes('iphone')) {
            return '📱';
        }
        if (platform.toLowerCase().includes('android')) {
            return '📱';
        }
        if (deviceType.toLowerCase().includes('mobile')) {
            return '📱';
        }
        if (deviceType.toLowerCase().includes('tablet')) {
            return '📱';
        }
        return '💻'; // Desktop/web
    };

    useEffect(() => {
        loadSessions();
    }, []);

    if (loading) {
        return (
            <View style={[styles.container, styles.centerContent, { backgroundColor }]}>
                <ActivityIndicator size="large" color={primaryColor} />
                <Text style={[styles.loadingText, { color: textColor }]}>Loading sessions...</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <View style={styles.header}>
                <Text style={[styles.title, { color: textColor }]}>Active Sessions</Text>
                <Text style={[styles.subtitle, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>Manage your active sessions across all devices</Text>
            </View>
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContainer}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => loadSessions(true)}
                        tintColor={primaryColor}
                    />
                }
            >
                {userSessions.length > 0 ? (
                    <>
                        {userSessions.map((session: SecureClientSession) => (
                            <View
                                key={session.sessionId}
                                style={[
                                    styles.sessionCard,
                                    {
                                        backgroundColor: secondaryBackgroundColor,
                                        borderColor,
                                        borderLeftColor: session.sessionId === activeSessionId ? successColor : borderColor,
                                    },
                                ]}
                            >
                                <View style={styles.sessionHeader}>
                                    <View style={styles.sessionTitleRow}>
                                        <Text style={styles.deviceIcon}>💻</Text>
                                        <View style={styles.sessionTitleText}>
                                            <Text style={[styles.deviceName, { color: textColor }]}>Session {session.sessionId.substring(0, 8)}...</Text>
                                            {session.sessionId === activeSessionId && (
                                                <Text style={[styles.currentBadge, { color: successColor }]}>Current Session</Text>
                                            )}
                                        </View>
                                    </View>
                                </View>
                                <View style={styles.sessionDetails}>
                                    <Text style={[styles.sessionDetail, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>Device ID: {session.deviceId ? session.deviceId.substring(0, 12) + '...' : 'Unknown'}</Text>
                                    <Text style={[styles.sessionDetail, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>Last active: {session.lastActive ? new Date(session.lastActive).toLocaleDateString() : 'Unknown'}</Text>
                                    <Text style={[styles.sessionDetail, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>Expires: {session.expiresAt ? new Date(session.expiresAt).toLocaleDateString() : 'Unknown'}</Text>
                                </View>
                                {session.sessionId !== activeSessionId && (
                                    <TouchableOpacity
                                        style={[styles.logoutButton, { backgroundColor: isDarkTheme ? '#400000' : '#FFEBEE' }]}
                                        onPress={() => handleLogoutSession(session.sessionId)}
                                        disabled={actionLoading === session.sessionId}
                                    >
                                        {actionLoading === session.sessionId ? (
                                            <ActivityIndicator size="small" color={dangerColor} />
                                        ) : (
                                            <Text style={[styles.logoutButtonText, { color: dangerColor }]}>Logout</Text>
                                        )}
                                    </TouchableOpacity>
                                )}
                            </View>
                        ))}
                        <View style={styles.bulkActions}>
                            <TouchableOpacity
                                style={[styles.bulkActionButton, { backgroundColor: isDarkTheme ? '#1A1A1A' : '#F0F0F0', borderColor }]}
                                onPress={handleLogoutOtherSessions}
                                disabled={actionLoading === 'others' || userSessions.filter(s => s.sessionId !== activeSessionId).length === 0}
                            >
                                {actionLoading === 'others' ? (
                                    <ActivityIndicator size="small" color={primaryColor} />
                                ) : (
                                    <Text style={[styles.bulkActionButtonText, { color: textColor }]}>Logout Other Sessions</Text>
                                )}
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.bulkActionButton, styles.dangerButton, { backgroundColor: isDarkTheme ? '#400000' : '#FFEBEE' }]}
                                onPress={handleLogoutAllSessions}
                                disabled={actionLoading === 'all'}
                            >
                                {actionLoading === 'all' ? (
                                    <ActivityIndicator size="small" color={dangerColor} />
                                ) : (
                                    <Text style={[styles.bulkActionButtonText, { color: dangerColor }]}>Logout All Sessions</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </>
                ) : (
                    <View style={styles.emptyState}>
                        <Text style={[styles.emptyStateText, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>No active sessions found</Text>
                    </View>
                )}
            </ScrollView>
            <View style={[styles.footer, { borderTopColor: borderColor }]}>
                <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                    <Text style={[styles.closeButtonText, { color: primaryColor }]}>Close</Text>
                </TouchableOpacity>
            </View>
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
    header: {
        padding: 20,
        paddingBottom: 16,
    },
    title: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'
            : 'phuduSemiBold',
        fontWeight: Platform.OS === 'web' ? '600' : undefined,
        fontSize: 24,
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        lineHeight: 20,
    },
    scrollView: {
        flex: 1,
    },
    scrollContainer: {
        padding: 20,
        paddingTop: 0,
    },
    sessionCard: {
        borderRadius: 12,
        borderWidth: 1,
        borderLeftWidth: 4,
        padding: 16,
        marginBottom: 12,
    },
    sessionHeader: {
        marginBottom: 12,
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    deviceIcon: {
        fontSize: 20,
        marginRight: 12,
    },
    sessionTitleText: {
        flex: 1,
    },
    deviceName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 2,
    },
    currentBadge: {
        fontSize: 12,
        fontWeight: '500',
    },
    sessionDetails: {
        marginBottom: 12,
    },
    sessionDetail: {
        fontSize: 14,
        marginBottom: 2,
    },
    logoutButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 6,
        alignItems: 'center',
        alignSelf: 'flex-start',
    },
    logoutButtonText: {
        fontSize: 14,
        fontWeight: '500',
    },
    bulkActions: {
        marginTop: 20,
        paddingTop: 20,
        borderTopWidth: 1,
        borderTopColor: '#E0E0E0',
    },
    bulkActionButton: {
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: 'center',
        marginBottom: 12,
    },
    dangerButton: {
        borderColor: 'transparent',
    },
    bulkActionButtonText: {
        fontSize: 16,
        fontWeight: '500',
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    emptyStateText: {
        fontSize: 16,
        fontStyle: 'italic',
    },
    loadingText: {
        fontSize: 16,
        marginTop: 16,
    },
    footer: {
        padding: 16,
        borderTopWidth: 1,
        alignItems: 'center',
    },
    closeButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    closeButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
});

export default SessionManagementScreen;

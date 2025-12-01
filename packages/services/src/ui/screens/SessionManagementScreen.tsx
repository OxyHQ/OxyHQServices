import type React from 'react';
import { useState, useEffect, useCallback, useMemo } from 'react';
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
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { toast } from '../../lib/sonner';
import type { ClientSession } from '../../models/session';
import { confirmAction } from '../utils/confirmAction';
import { Header, GroupedSection } from '../components';
import { useThemeStyles } from '../hooks/useThemeStyles';

const SessionManagementScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    const { sessions: userSessions, activeSessionId, refreshSessions, logout, logoutAll, switchSession } = useOxy();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [switchLoading, setSwitchLoading] = useState<string | null>(null);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

    // Use centralized theme styles hook for consistency
    const themeStyles = useThemeStyles(theme);
    // Extract commonly used colors for readability
    const { textColor, backgroundColor, secondaryBackgroundColor, borderColor, primaryColor, dangerColor, successColor, isDarkTheme } = themeStyles;

    // Memoized load sessions function - prevents unnecessary re-renders
    const loadSessions = useCallback(async (isRefresh = false) => {
        try {
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            await refreshSessions();
            setLastRefreshed(new Date());
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
    }, [refreshSessions]);

    // Memoized logout session handler - prevents unnecessary re-renders
    const handleLogoutSession = useCallback(async (sessionId: string) => {
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
    }, [logout, refreshSessions]);

    // Memoized logout other sessions handler - prevents unnecessary re-renders
    const handleLogoutOtherSessions = useCallback(async () => {
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
    }, [userSessions, activeSessionId, logout, refreshSessions]);

    // Memoized logout all sessions handler - prevents unnecessary re-renders
    const handleLogoutAllSessions = useCallback(async () => {
        confirmAction(
            'This will logout all sessions including this one and you will need to sign in again. Continue?',
            async () => {
                try {
                    setActionLoading('all');
                    await logoutAll();
                } catch (error) {
                    console.error('Logout all sessions failed:', error);
                    toast.error('Failed to logout all sessions. Please try again.');
                    setActionLoading(null);
                }
            }
        );
    }, [logoutAll]);

    // Memoized relative time formatter - prevents function recreation on every render
    const formatRelative = useCallback((dateString?: string) => {
        if (!dateString) return 'Unknown';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = date.getTime() - now.getTime();
        const absMin = Math.abs(diffMs) / 60000;
        const isFuture = diffMs > 0;
        const fmt = (n: number) => (n < 1 ? 'moments' : Math.floor(n));
        if (absMin < 1) return isFuture ? 'in moments' : 'just now';
        if (absMin < 60) return isFuture ? `in ${fmt(absMin)}m` : `${fmt(absMin)}m ago`;
        const hrs = absMin / 60;
        if (hrs < 24) return isFuture ? `in ${fmt(hrs)}h` : `${fmt(hrs)}h ago`;
        const days = hrs / 24;
        if (days < 7) return isFuture ? `in ${fmt(days)}d` : `${fmt(days)}d ago`;
        return date.toLocaleDateString();
    }, []);

    // Memoized switch session handler - prevents unnecessary re-renders
    const handleSwitchSession = useCallback(async (sessionId: string) => {
        if (sessionId === activeSessionId) return;
        setSwitchLoading(sessionId);
        try {
            await switchSession(sessionId);
            toast.success('Switched session');
        } catch (e) {
            console.error('Switch session failed', e);
            toast.error('Failed to switch session');
        } finally {
            setSwitchLoading(null);
        }
    }, [activeSessionId, switchSession]);

    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    if (loading) {
        return (
            <View style={[styles.container, styles.centerContent, { backgroundColor }]}>
                <ActivityIndicator size="large" color={primaryColor} />
                <Text style={[styles.loadingText, { color: textColor }]}>Loading sessions...</Text>
            </View>
        );
    }

    // Memoized session items - prevents unnecessary re-renders when dependencies haven't changed
    const sessionItems = useMemo(() => {
        return userSessions.map((session: ClientSession) => {
            const isCurrent = session.sessionId === activeSessionId;
            const subtitleParts: string[] = [];
            if (session.deviceId) subtitleParts.push(`Device ${session.deviceId.substring(0, 10)}...`);
            subtitleParts.push(`Last ${formatRelative(session.lastActive)}`);
            subtitleParts.push(`Expires ${formatRelative(session.expiresAt)}`);

            return {
                id: session.sessionId,
                icon: isCurrent ? 'shield-checkmark' : 'laptop-outline',
                iconColor: isCurrent ? successColor : primaryColor,
                title: isCurrent ? 'Current Session' : `Session ${session.sessionId.substring(0, 8)}...`,
                subtitle: subtitleParts.join(' \u2022 '),
                showChevron: false,
                multiRow: true,
                customContentBelow: !isCurrent ? (
                    <View style={styles.sessionActionsRow}>
                        <TouchableOpacity
                            onPress={() => handleSwitchSession(session.sessionId)}
                            style={[styles.sessionPillButton, { backgroundColor: isDarkTheme ? '#1E2A38' : '#E6F2FF', borderColor: primaryColor }]}
                            disabled={switchLoading === session.sessionId || actionLoading === session.sessionId}
                        >
                            {switchLoading === session.sessionId ? (
                                <ActivityIndicator size="small" color={primaryColor} />
                            ) : (
                                <Text style={[styles.sessionPillText, { color: primaryColor }]}>Switch</Text>
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => handleLogoutSession(session.sessionId)}
                            style={[styles.sessionPillButton, { backgroundColor: isDarkTheme ? '#3A1E1E' : '#FFEBEE', borderColor: dangerColor }]}
                            disabled={actionLoading === session.sessionId || switchLoading === session.sessionId}
                        >
                            {actionLoading === session.sessionId ? (
                                <ActivityIndicator size="small" color={dangerColor} />
                            ) : (
                                <Text style={[styles.sessionPillText, { color: dangerColor }]}>Logout</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={styles.sessionActionsRow}>
                        <Text style={[styles.currentBadgeText, { color: successColor }]}>Active</Text>
                    </View>
                ),
                selected: isCurrent,
                dense: true,
            };
        });
    }, [userSessions, activeSessionId, formatRelative, successColor, primaryColor, isDarkTheme, switchLoading, actionLoading, handleSwitchSession, handleLogoutSession, dangerColor]);

    // Memoized bulk action items - prevents unnecessary re-renders when dependencies haven't changed
    const otherSessionsCount = useMemo(() => 
        userSessions.filter(s => s.sessionId !== activeSessionId).length,
        [userSessions, activeSessionId]
    );

    const bulkItems = useMemo(() => [
        {
            id: 'logout-others',
            icon: 'exit-outline',
            iconColor: primaryColor,
            title: 'Logout Other Sessions',
            subtitle: otherSessionsCount === 0 ? 'No other sessions' : 'End all sessions except this one',
            onPress: handleLogoutOtherSessions,
            showChevron: false,
            customContent: actionLoading === 'others' ? <ActivityIndicator size="small" color={primaryColor} /> : undefined,
            disabled: actionLoading === 'others' || otherSessionsCount === 0,
            dense: true,
        },
        {
            id: 'logout-all',
            icon: 'warning-outline',
            iconColor: dangerColor,
            title: 'Logout All Sessions',
            subtitle: 'End all sessions including this one',
            onPress: handleLogoutAllSessions,
            showChevron: false,
            customContent: actionLoading === 'all' ? <ActivityIndicator size="small" color={dangerColor} /> : undefined,
            disabled: actionLoading === 'all',
            dense: true,
        },
    ], [otherSessionsCount, primaryColor, dangerColor, handleLogoutOtherSessions, handleLogoutAllSessions, actionLoading]);

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <Header
                title="Active Sessions"
                subtitle="Manage your active sessions across all devices"
                
                onBack={goBack || onClose}
                elevation="subtle"
            />
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
                        {lastRefreshed && (
                            <Text style={[styles.metaText, { color: isDarkTheme ? '#777' : '#777', marginBottom: 6 }]}>Last refreshed {formatRelative(lastRefreshed.toISOString())}</Text>
                        )}
                        <View style={styles.fullBleed}>
                            <GroupedSection items={sessionItems}  />
                        </View>
                        <View style={{ height: 12 }} />
                        <View style={styles.fullBleed}>
                            <GroupedSection items={bulkItems}  />
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


    scrollView: {
        flex: 1,
    },
    scrollContainer: {
        padding: 20,
        paddingTop: 0,
    },
    // Removed legacy session card & bulk action styles (now using GroupedSection)
    sessionActionsRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 6,
    },
    sessionPillButton: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    sessionPillText: {
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 0.3,
        textTransform: 'uppercase',
    },
    currentBadgeText: {
        fontSize: 12,
        fontWeight: '600',
        paddingHorizontal: 10,
        paddingVertical: 4,
        backgroundColor: '#2E7D3215',
        borderRadius: 16,
        overflow: 'hidden',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    metaText: {
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontWeight: '600',
    },
    fullBleed: {
        width: '100%',
        alignSelf: 'stretch',
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

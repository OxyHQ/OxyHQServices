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
import type { BaseScreenProps } from '../types/navigation';
import { screenContentStyle } from '../constants/spacing';
import { toast } from '../../lib/sonner';
import type { ClientSession } from '@oxyhq/core';
import { confirmAction } from '../utils/confirmAction';
import { Header, GroupedSection } from '../components';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';

// Button background colors for session actions
const SWITCH_BUTTON_BG = {
    dark: '#1E2A38',
    light: '#E6F2FF',
} as const;

const LOGOUT_BUTTON_BG = {
    dark: '#3A1E1E',
    light: '#FFEBEE',
} as const;

const SessionManagementScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    // Use useOxy() hook for OxyContext values
    const {
        sessions: userSessions,
        activeSessionId,
        refreshSessions,
        logout,
        logoutAll,
        switchSession,
    } = useOxy();
    const { t } = useI18n();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [switchLoading, setSwitchLoading] = useState<string | null>(null);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

    // Use bloom theme for non-style color props (ActivityIndicator, icon colors, etc.)
    const bloomTheme = useTheme();
    const isDarkTheme = bloomTheme.colorScheme === 'dark';
    const primaryColor = bloomTheme.colors.primary;
    const dangerColor = bloomTheme.colors.error;
    const successColor = bloomTheme.colors.success || '#34C759';

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
            if (__DEV__) {
                console.error('Failed to load sessions:', error);
            }
            if (Platform.OS === 'web') {
                toast.error(t('sessionManagement.toasts.loadFailed'));
            } else {
                Alert.alert(
                    'Error',
                    t('sessionManagement.toasts.loadFailed'),
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
        confirmAction(t('sessionManagement.confirms.logoutSession'), async () => {
            try {
                setActionLoading(sessionId);
                await logout(sessionId);
                await refreshSessions();
                toast.success(t('sessionManagement.toasts.logoutSuccess'));
            } catch (error) {
                if (__DEV__) {
                    console.error('Logout session failed:', error);
                }
                toast.error(t('sessionManagement.toasts.logoutFailed'));
            } finally {
                setActionLoading(null);
            }
        });
    }, [logout, refreshSessions]);

    // Memoized bulk action items - prevents unnecessary re-renders when dependencies haven't changed
    const otherSessionsCount = useMemo(() =>
        userSessions.filter(s => s.sessionId !== activeSessionId).length,
        [userSessions, activeSessionId]
    );

    // Memoized logout other sessions handler - prevents unnecessary re-renders
    const handleLogoutOtherSessions = useCallback(async () => {
        if (otherSessionsCount === 0) {
            toast.info(t('sessionManagement.toasts.noOtherSessions'));
            return;
        }
        confirmAction(
            t('sessionManagement.confirms.logoutOthers', { count: otherSessionsCount }),
            async () => {
                try {
                    setActionLoading('others');
                    for (const session of userSessions) {
                        if (session.sessionId !== activeSessionId) {
                            await logout(session.sessionId);
                        }
                    }
                    await refreshSessions();
                    toast.success(t('sessionManagement.toasts.logoutOthersSuccess'));
                } catch (error) {
                    if (__DEV__) {
                        console.error('Logout other sessions failed:', error);
                    }
                    toast.error(t('sessionManagement.toasts.logoutOthersFailed'));
                } finally {
                    setActionLoading(null);
                }
            }
        );
    }, [otherSessionsCount, userSessions, activeSessionId, logout, refreshSessions]);

    // Memoized logout all sessions handler - prevents unnecessary re-renders
    const handleLogoutAllSessions = useCallback(async () => {
        confirmAction(
            t('sessionManagement.confirms.logoutAll'),
            async () => {
                try {
                    setActionLoading('all');
                    await logoutAll();
                } catch (error) {
                    if (__DEV__) {
                        console.error('Logout all sessions failed:', error);
                    }
                    toast.error(t('sessionManagement.toasts.logoutAllFailed'));
                } finally {
                    setActionLoading(null);
                }
            }
        );
    }, [logoutAll]);

    // Memoized relative time formatter - prevents function recreation on every render
    const formatRelative = useCallback((dateString?: string) => {
        if (!dateString) return t('appInfo.items.unknown');
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
            toast.success(t('sessionManagement.toasts.switchSuccess'));
        } catch (e) {
            if (__DEV__) {
                console.error('Switch session failed', e);
            }
            toast.error(t('sessionManagement.toasts.switchFailed'));
        } finally {
            setSwitchLoading(null);
        }
    }, [activeSessionId, switchSession]);

    // Memoized refresh handler for pull-to-refresh
    const handleRefresh = useCallback(() => {
        loadSessions(true);
    }, [loadSessions]);

    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    // Memoized session items - prevents unnecessary re-renders when dependencies haven't changed
    const sessionItems = useMemo(() => {
        return userSessions.map((session) => {
            const isCurrent = session.sessionId === activeSessionId;
            const subtitleParts: string[] = [];
            if (session.deviceId) subtitleParts.push(`Device ${session.deviceId.substring(0, 10)}...`);
            subtitleParts.push(`Last ${formatRelative(session.lastActive)}`);
            subtitleParts.push(`Expires ${formatRelative(session.expiresAt)}`);

            return {
                id: session.sessionId,
                icon: isCurrent ? 'shield-checkmark' : 'laptop-outline',
                iconColor: isCurrent ? successColor : primaryColor,
                title: isCurrent ? t('sessionManagement.currentSession') : t('sessionManagement.sessionLabel', { id: session.sessionId.substring(0, 8) }),
                subtitle: subtitleParts.join(' \u2022 '),
                showChevron: false,
                multiRow: true,
                customContentBelow: !isCurrent ? (
                    <View style={styles.sessionActionsRow}>
                        <TouchableOpacity
                            onPress={() => handleSwitchSession(session.sessionId)}
                            style={[styles.sessionPillButton, { backgroundColor: isDarkTheme ? SWITCH_BUTTON_BG.dark : SWITCH_BUTTON_BG.light, borderColor: primaryColor }]}
                            disabled={switchLoading === session.sessionId || actionLoading === session.sessionId}
                        >
                            {switchLoading === session.sessionId ? (
                                <ActivityIndicator size="small" color={primaryColor} />
                            ) : (
                                <Text style={[styles.sessionPillText, { color: primaryColor }]}>{t('sessionManagement.switch')}</Text>
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => handleLogoutSession(session.sessionId)}
                            style={[styles.sessionPillButton, { backgroundColor: isDarkTheme ? LOGOUT_BUTTON_BG.dark : LOGOUT_BUTTON_BG.light, borderColor: dangerColor }]}
                            disabled={actionLoading === session.sessionId || switchLoading === session.sessionId}
                        >
                            {actionLoading === session.sessionId ? (
                                <ActivityIndicator size="small" color={dangerColor} />
                            ) : (
                                <Text style={[styles.sessionPillText, { color: dangerColor }]}>{t('sessionManagement.logout')}</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={styles.sessionActionsRow}>
                        <Text style={[styles.currentBadgeText, { color: successColor }]}>{t('sessionManagement.active')}</Text>
                    </View>
                ),
                selected: isCurrent,
                dense: true,
            };
        });
    }, [userSessions, activeSessionId, formatRelative, successColor, primaryColor, isDarkTheme, switchLoading, actionLoading, handleSwitchSession, handleLogoutSession, dangerColor]);

    const bulkItems = useMemo(() => [
        {
            id: 'logout-others',
            icon: 'exit-outline',
            iconColor: primaryColor,
            title: t('sessionManagement.logoutOthers.title'),
            subtitle: otherSessionsCount === 0 ? t('sessionManagement.logoutOthers.noOtherSessions') : t('sessionManagement.logoutOthers.subtitle'),
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
            title: t('sessionManagement.logoutAll.title'),
            subtitle: t('sessionManagement.logoutAll.subtitle'),
            onPress: handleLogoutAllSessions,
            showChevron: false,
            customContent: actionLoading === 'all' ? <ActivityIndicator size="small" color={dangerColor} /> : undefined,
            disabled: actionLoading === 'all',
            dense: true,
        },
    ], [otherSessionsCount, primaryColor, dangerColor, handleLogoutOtherSessions, handleLogoutAllSessions, actionLoading]);

    if (loading) {
        return (
            <View style={[styles.container, styles.centerContent]} className="bg-background">
                <ActivityIndicator size="large" color={primaryColor} />
                <Text style={styles.loadingText} className="text-foreground">{t('sessionManagement.loading')}</Text>
            </View>
        );
    }

    return (
        <View style={styles.container} className="bg-background">
            <Header
                title={t('sessionManagement.title')}
                subtitle={t('sessionManagement.subtitle')}

                onBack={goBack || onClose}
                elevation="subtle"
            />
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContainer}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        tintColor={primaryColor}
                    />
                }
            >
                {userSessions.length > 0 ? (
                    <>
                        {lastRefreshed && (
                            <Text style={[styles.metaText, { color: '#777', marginBottom: 6 }]}>{t('sessionManagement.lastRefreshed', { time: formatRelative(lastRefreshed.toISOString()) })}</Text>
                        )}
                        <View style={styles.fullBleed}>
                            <GroupedSection items={sessionItems} />
                        </View>
                        <View style={styles.sectionSpacer} />
                        <View style={styles.fullBleed}>
                            <GroupedSection items={bulkItems} />
                        </View>
                    </>
                ) : (
                    <View style={styles.emptyState}>
                        <Text style={[styles.emptyStateText, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>{t('sessionManagement.empty')}</Text>
                    </View>
                )}
            </ScrollView>
            <View style={styles.footer} className="border-border">
                <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                    <Text style={styles.closeButtonText} className="text-primary">{t('sessionManagement.close')}</Text>
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
        ...screenContentStyle,
        paddingTop: 0, // Header handles top spacing
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
    sectionSpacer: {
        height: 12,
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

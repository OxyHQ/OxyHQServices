import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { ScreenHeader } from '@/components/ui';
import { useOxy, OxySignInButton } from '@oxyhq/services';
import { AccountCard } from '@/components/ui';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { formatDate } from '@/utils/date-utils';
import type { ClientSession } from '@oxyhq/services';

export default function SessionsScreen() {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    
    // OxyServices integration
    const { sessions, activeSessionId, removeSession, switchSession, isLoading: oxyLoading, isAuthenticated, refreshSessions, showBottomSheet } = useOxy();
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Handle sign in
    const handleSignIn = useCallback(() => {
        if (showBottomSheet) {
            showBottomSheet('SignIn');
        }
    }, [showBottomSheet]);

    // Format relative time for last active
    const formatRelativeTime = useCallback((dateString?: string) => {
        if (!dateString) return 'Unknown';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const minutes = Math.floor(diffMs / 60000);
        
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d ago`;
        return formatDate(dateString);
    }, []);

    // Handle session removal
    const handleRemoveSession = useCallback(async (sessionId: string, isActive: boolean) => {
        if (isActive) {
            Alert.alert(
                'Cannot remove active session',
                'You cannot remove your current active session. Please switch to another session first.',
                [{ text: 'OK' }]
            );
            return;
        }

        Alert.alert(
            'Remove session',
            'Are you sure you want to remove this session?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setActionLoading(sessionId);
                            await removeSession(sessionId);
                            if (Platform.OS === 'web') {
                                // Toast would be shown here if toast library is available
                                console.log('Session removed successfully');
                            } else {
                                Alert.alert('Success', 'Session removed successfully');
                            }
                        } catch (error) {
                            console.error('Failed to remove session:', error);
                            Alert.alert('Error', 'Failed to remove session. Please try again.');
                        } finally {
                            setActionLoading(null);
                        }
                    },
                },
            ]
        );
    }, [removeSession]);

    // Handle session switch
    const handleSwitchSession = useCallback(async (sessionId: string) => {
        if (sessionId === activeSessionId) return;

        try {
            setActionLoading(sessionId);
            await switchSession(sessionId);
            if (Platform.OS === 'web') {
                console.log('Session switched successfully');
            } else {
                Alert.alert('Success', 'Session switched successfully');
            }
        } catch (error) {
            console.error('Failed to switch session:', error);
            Alert.alert('Error', 'Failed to switch session. Please try again.');
        } finally {
            setActionLoading(null);
        }
    }, [switchSession, activeSessionId]);

    // Format session items for display
    const sessionItems = useMemo(() => {
        if (!sessions || sessions.length === 0) return [];

        return sessions.map((session: ClientSession) => {
            const isActive = session.sessionId === activeSessionId;
            const isLoading = actionLoading === session.sessionId;

            return {
                id: session.sessionId,
                icon: 'devices' as any,
                iconColor: isActive ? colors.tint : colors.sidebarIconDevices,
                title: `Session ${session.deviceId?.substring(0, 8) || session.sessionId.substring(0, 8)}`,
                subtitle: isActive 
                    ? 'Current session • ' + formatRelativeTime(session.lastActive)
                    : 'Last active: ' + formatRelativeTime(session.lastActive),
                customContent: (
                    <View style={styles.sessionActions}>
                        {isActive && (
                            <View style={[styles.activeBadge, { backgroundColor: colors.tint }]}>
                                <Text style={[styles.activeBadgeText, { color: '#FFFFFF' }]}>Active</Text>
                            </View>
                        )}
                        {!isActive && (
                            <>
                                <TouchableOpacity
                                    style={[styles.actionButton, { backgroundColor: colors.card }]}
                                    onPress={() => handleSwitchSession(session.sessionId)}
                                    disabled={isLoading}
                                >
                                    {isLoading ? (
                                        <ActivityIndicator size="small" color={colors.text} />
                                    ) : (
                                        <MaterialCommunityIcons name="swap-horizontal" size={16} color={colors.text} />
                                    )}
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.actionButton, { backgroundColor: colors.card }]}
                                    onPress={() => handleRemoveSession(session.sessionId, isActive)}
                                    disabled={isLoading}
                                >
                                    <MaterialCommunityIcons name="delete-outline" size={16} color={colors.text} />
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                ),
            };
        });
    }, [sessions, activeSessionId, colors, formatRelativeTime, actionLoading, handleRemoveSession, handleSwitchSession]);

    // Show loading state
    if (oxyLoading) {
        return (
            <ScreenContentWrapper>
                <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
                    <ActivityIndicator size="large" color={colors.tint} />
                    <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading sessions...</ThemedText>
                </View>
            </ScreenContentWrapper>
        );
    }

    // Show message if not authenticated
    if (!isAuthenticated) {
        return (
            <ScreenContentWrapper>
                <View style={[styles.container, { backgroundColor: colors.background }]}>
                    <View style={styles.content}>
                        <ScreenHeader title="Sessions" subtitle="Manage your active sessions." />
                        <View style={styles.unauthenticatedPlaceholder}>
                            <ThemedText style={[styles.placeholderText, { color: colors.text }]}>
                                Please sign in to view your sessions.
                            </ThemedText>
                            <View style={styles.signInButtonWrapper}>
                                <OxySignInButton />
                                {showBottomSheet && (
                                    <TouchableOpacity
                                        style={[styles.alternativeSignInButton, { backgroundColor: colors.card, borderColor: colors.tint }]}
                                        onPress={handleSignIn}
                                    >
                                        <Text style={[styles.alternativeSignInText, { color: colors.tint }]}>
                                            Sign in with username
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    </View>
                </View>
            </ScreenContentWrapper>
        );
    }

    return (
        <ScreenContentWrapper>
            <View style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.content}>
                    <ScreenHeader title="Sessions" subtitle="Manage your active sessions." />
                    
                    {sessionItems.length === 0 ? (
                        <View style={styles.placeholder}>
                            <ThemedText style={[styles.placeholderText, { color: colors.icon }]}>
                                No active sessions found.
                            </ThemedText>
                        </View>
                    ) : (
                        <AccountCard>
                            <GroupedSection items={sessionItems} />
                        </AccountCard>
                    )}
                </View>
            </View>
        </ScreenContentWrapper>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    content: {
        padding: 20,
    },
    headerSection: {
        marginBottom: 24,
    },
    title: {
        fontSize: 32,
        fontWeight: '600',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        opacity: 0.6,
    },
    placeholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
    },
    placeholderText: {
        fontSize: 16,
        textAlign: 'center',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
    },
    loadingText: {
        fontSize: 16,
        opacity: 0.7,
    },
    sessionActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    activeBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    activeBadgeText: {
        fontSize: 12,
        fontWeight: '600',
    },
    actionButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    unauthenticatedPlaceholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        gap: 24,
    },
    signInButtonWrapper: {
        width: '100%',
        maxWidth: 300,
        gap: 12,
        marginTop: 16,
    },
    alternativeSignInButton: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    alternativeSignInText: {
        fontSize: 14,
        fontWeight: '500',
    },
});

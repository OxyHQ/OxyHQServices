import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { LinkButton, AccountCard, Switch, ScreenHeader, useAlert } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useOxy, useUserDevices, useRecentSecurityActivity, useUpdateProfile } from '@oxyhq/services';
import { formatDate } from '@/utils/date-utils';
import type { ClientSession, SecurityActivity } from '@oxyhq/services';
import { useBiometricSettings } from '@/hooks/useBiometricSettings';
import { getEventIcon, getSeverityColor, getEventSeverity, formatEventDescription } from '@/utils/security-utils';
import type { MaterialCommunityIconName } from '@/types/icons';

export default function SecurityScreen() {
    const colorScheme = useColorScheme() ?? 'light';
    const { width } = useWindowDimensions();
    const router = useRouter();

    const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
    const isDesktop = Platform.OS === 'web' && width >= 768;

    // OxyServices integration
    const { user, isAuthenticated, isLoading: oxyLoading, sessions, hasIdentity, getPublicKey, logoutAll, oxyServices } = useOxy();
    const alert = useAlert();
    const [enhancedSafeBrowsing, setEnhancedSafeBrowsing] = useState(false);
    const [darkWebReport, setDarkWebReport] = useState(false);
    const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);

    // Fetch devices using TanStack Query hook
    const { data: devices = [], isLoading: loading, error: devicesError } = useUserDevices({
        enabled: isAuthenticated,
    });

    // Fetch security activity
    const { data: securityActivities = [], isLoading: securityActivityLoading } = useRecentSecurityActivity(10);

    // Biometric settings
    const {
        enabled: biometricEnabled,
        canEnable: canEnableBiometric,
        hasHardware: hasBiometricHardware,
        isEnrolled: isBiometricEnrolled,
        supportedTypes: biometricTypes,
        isLoading: biometricLoading,
        isSaving: biometricSaving,
        toggleBiometricLogin,
        refreshCapabilities,
    } = useBiometricSettings();

    // Format relative time for dates
    const formatRelativeTime = useCallback((dateString?: string) => {
        if (!dateString) return '';
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

    // Get device icon based on type
    const getDeviceIcon = useCallback((deviceType?: string): MaterialCommunityIconName => {
        if (!deviceType) return 'devices';
        const type = deviceType.toLowerCase();
        if (type.includes('mobile') || type.includes('phone') || type.includes('iphone') || type.includes('android')) {
            return 'cellphone';
        }
        if (type.includes('tablet') || type.includes('ipad')) {
            return 'tablet';
        }
        if (type.includes('desktop') || type.includes('laptop') || type.includes('mac') || type.includes('windows') || type.includes('linux')) {
            return 'monitor';
        }
        return 'devices';
    }, []);

    // Compute security recommendations with actionable items
    const securityRecommendations = useMemo(() => {
        const recommendations: any[] = [];

        // 1. Recommend biometric if available but not enabled (High priority)
        if (canEnableBiometric && !biometricEnabled && !biometricLoading) {
            recommendations.push({
                id: 'biometric',
                priority: 1,
                icon: Platform.OS === 'ios' ? 'face-recognition' : 'fingerprint',
                iconColor: '#fbbc04',
                title: 'Enable biometric authentication',
                subtitle: 'Add an extra layer of security to your account',
                onPress: () => {
                    // Navigate to biometric section and show toggle
                    alert(
                        'Enable Biometric Authentication',
                        'You can enable biometric authentication in the "How you sign in" section below. This adds an extra layer of security to your account.',
                        [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Go to Settings',
                                onPress: () => {
                                    // Scroll to biometric section (user can enable it there)
                                    // For now, just show the section is below
                                },
                            },
                        ]
                    );
                },
                showChevron: true,
            });
        }

        // 2. Recommend recovery email (High priority)
        if (!user?.email) {
            recommendations.push({
                id: 'recovery-email',
                priority: 1,
                icon: 'email-alert-outline',
                iconColor: '#fbbc04',
                title: 'Add a recovery email',
                subtitle: 'Help secure your account and enable account recovery',
                onPress: () => {
                    alert(
                        'Add Recovery Email',
                        'A recovery email helps you regain access to your account if you lose your keys. Would you like to add one now?',
                        [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Add Email',
                                onPress: async () => {
                                    // Prompt for email
                                    alert(
                                        'Add Email',
                                        'Please go to your Profile settings to add an email address.',
                                        [
                                            { text: 'OK', onPress: () => router.push('/(tabs)/personal-info') },
                                        ]
                                    );
                                },
                            },
                        ]
                    );
                },
                showChevron: true,
            });
        }

        // 3. Check for old/inactive sessions (Medium priority)
        const activeSessionsCount = sessions?.filter(s => s.isCurrent !== false).length || 0;
        const oldSessions = sessions?.filter(s => {
            if (!s.lastActive) return false;
            const lastActive = new Date(s.lastActive);
            const daysSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24);
            return daysSinceActive > 30; // Older than 30 days
        }) || [];

        if (oldSessions.length > 0) {
            recommendations.push({
                id: 'old-sessions',
                priority: 2,
                icon: 'clock-alert-outline',
                iconColor: '#fbbc04',
                title: `Review ${oldSessions.length} inactive session${oldSessions.length !== 1 ? 's' : ''}`,
                subtitle: `Some sessions haven't been used in over 30 days`,
                onPress: () => {
                    router.push('/(tabs)/devices');
                },
                showChevron: true,
            });
        }

        // 4. Check for multiple devices (Low priority - informational)
        if (devices.length > 5) {
            recommendations.push({
                id: 'many-devices',
                priority: 3,
                icon: 'devices',
                iconColor: '#5AC8FA',
                title: `You're signed in on ${devices.length} devices`,
                subtitle: 'Review your active devices to ensure they\'re all yours',
                onPress: () => {
                    router.push('/(tabs)/devices');
                },
                showChevron: true,
            });
        }

        // 5. Check for suspicious activity (Critical priority)
        const recentSuspiciousActivity = securityActivities?.filter(
            (activity: SecurityActivity) =>
                activity.severity === 'critical' ||
                activity.eventType === 'suspicious_activity'
        ) || [];

        if (recentSuspiciousActivity.length > 0) {
            recommendations.push({
                id: 'suspicious-activity',
                priority: 0,
                icon: 'alert-octagon',
                iconColor: '#FF3B30',
                title: `${recentSuspiciousActivity.length} critical security event${recentSuspiciousActivity.length !== 1 ? 's' : ''} detected`,
                subtitle: 'Review your security activity immediately',
                onPress: () => {
                    alert(
                        'Critical Security Events',
                        `You have ${recentSuspiciousActivity.length} critical security event(s). Please review your security activity below and consider changing your password or signing out of all devices if you notice any suspicious activity.`,
                        [{ text: 'OK', style: 'default' }]
                    );
                },
                showChevron: true,
            });
        }

        // Sort by priority (lower number = higher priority)
        return recommendations.sort((a, b) => a.priority - b.priority);
    }, [
        canEnableBiometric,
        biometricEnabled,
        biometricLoading,
        user?.email,
        sessions,
        devices.length,
        securityActivities,
        router,
        alert,
    ]);

    // Recent activity from security events
    const recentActivity = useMemo(() => {
        if (!securityActivities || securityActivities.length === 0) return [];

        return securityActivities.slice(0, 5).map((activity: SecurityActivity) => {
            const eventIcon = getEventIcon(activity.eventType);
            // Use severity-based color for better consistency
            const severity = activity.severity || getEventSeverity(activity.eventType);
            const eventColor = getSeverityColor(severity, colorScheme);
            const description = formatEventDescription(activity);
            const deviceId = activity.deviceId;

            // Show details on press - include IP, device info, etc.
            const onPress = () => {
                const details = [
                    `Type: ${activity.eventType}`,
                    `Severity: ${severity}`,
                    activity.ipAddress ? `IP: ${activity.ipAddress}` : null,
                    activity.deviceId && activity.metadata?.deviceName
                        ? `Device: ${activity.metadata.deviceName}`
                        : activity.deviceId
                            ? `Device ID: ${activity.deviceId}`
                            : null,
                    activity.userAgent ? `Browser: ${activity.userAgent.substring(0, 50)}${activity.userAgent.length > 50 ? '...' : ''}` : null,
                    `Time: ${formatDate(activity.timestamp)}`,
                ].filter(Boolean).join('\n');

                alert(
                    description,
                    details,
                    [
                        // Add navigation to device if available
                        ...(deviceId && (activity.eventType === 'device_added' || activity.eventType === 'device_removed' || activity.eventType === 'sign_in')
                            ? [{
                                text: 'View Device',
                                onPress: () => router.push(`/(tabs)/devices/${deviceId}` as any),
                            }]
                            : []),
                        { text: 'OK', style: 'default' },
                    ]
                );
            };

            return {
                id: `activity-${activity.id}`,
                icon: eventIcon,
                iconColor: eventColor,
                title: description,
                subtitle: formatRelativeTime(activity.timestamp),
                onPress,
                showChevron: true, // Always show chevron since we show details
            };
        });
    }, [securityActivities, colorScheme, formatRelativeTime, router, alert, formatDate]);

    // Sign-in items
    const signInItems = useMemo(() => {
        const items: any[] = [];

        // Biometric authentication
        if (Platform.OS !== 'web') {
            let biometricSubtitle = '';
            if (biometricLoading) {
                biometricSubtitle = 'Checking...';
            } else if (!hasBiometricHardware) {
                biometricSubtitle = 'Not available on this device';
            } else if (!isBiometricEnrolled) {
                biometricSubtitle = 'Not set up - configure in device settings';
            } else if (biometricEnabled) {
                biometricSubtitle = biometricTypes.length > 0
                    ? `Enabled (${biometricTypes.join(', ')})`
                    : 'Enabled';
            } else {
                biometricSubtitle = canEnableBiometric
                    ? 'Available - tap to enable'
                    : 'Not available';
            }

            items.push({
                id: 'biometric',
                icon: Platform.OS === 'ios' ? 'face-recognition' : 'fingerprint',
                iconColor: biometricEnabled ? '#34C759' : colors.sidebarIconSecurity,
                title: Platform.OS === 'ios' ? 'Face ID / Touch ID' : 'Biometric Authentication',
                subtitle: biometricSubtitle,
                customContent: canEnableBiometric ? (
                    <Switch
                        value={biometricEnabled}
                        onValueChange={toggleBiometricLogin}
                        disabled={biometricSaving || biometricLoading}
                    />
                ) : biometricEnabled ? (
                    <View style={styles.statusContainer}>
                        <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                    </View>
                ) : undefined,
            });
        }

        // Public key authentication info
        items.push({
            id: 'public-key-auth',
            icon: 'key-outline',
            iconColor: '#34C759',
            title: 'Public key authentication',
            subtitle: 'Your account uses cryptographic keys for secure sign-in',
            showChevron: false,
        });

        return items;
    }, [
        colors,
        user,
        biometricEnabled,
        canEnableBiometric,
        hasBiometricHardware,
        isBiometricEnrolled,
        biometricTypes,
        biometricLoading,
        biometricSaving,
        toggleBiometricLogin,
        router,
    ]);

    // Device items grouped by type
    const deviceItems = useMemo(() => {
        if (!devices || devices.length === 0) return [];

        // Group devices by type
        const deviceGroups = new Map<string, { count: number; names: string[]; deviceIds: string[] }>();

        devices.forEach((device: any) => {
            const type = device.type || device.deviceType || 'unknown';
            const name = device.name || device.deviceName || 'Unknown Device';
            const deviceId = device.id || device.deviceId || '';

            if (!deviceGroups.has(type)) {
                deviceGroups.set(type, { count: 0, names: [], deviceIds: [] });
            }
            const group = deviceGroups.get(type)!;
            group.count++;
            group.deviceIds.push(deviceId);
            if (group.names.length < 3) {
                group.names.push(name);
            }
        });

        // Convert to items
        const items: any[] = [];
        deviceGroups.forEach((group, type) => {
            const icon = getDeviceIcon(type);
            const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
            const subtitle = group.names.length > 0
                ? group.names.join(', ') + (group.count > group.names.length ? '...' : '')
                : `${group.count} device(s)`;

            items.push({
                id: `device-${type}`,
                icon: icon,
                iconColor: colors.sidebarIconDevices,
                title: `${group.count} device${group.count !== 1 ? 's' : ''} (${typeLabel})`,
                subtitle,
                onPress: () => router.push('/(tabs)/devices'),
                showChevron: true,
            });
        });

        return items;
    }, [devices, colors, getDeviceIcon, router]);


    // Handle logout all sessions
    const handleLogoutAll = useCallback(async () => {
        alert(
            'Sign out of all devices?',
            `This will sign you out of all ${sessions?.length || 0} active session${sessions?.length !== 1 ? 's' : ''} except this one. You&apos;ll need to sign in again on other devices.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Sign out all',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setIsLoggingOutAll(true);
                            await logoutAll();
                            alert('Success', 'Signed out of all other devices');
                        } catch (error: any) {
                            alert('Error', error?.message || 'Failed to sign out of all devices');
                        } finally {
                            setIsLoggingOutAll(false);
                        }
                    },
                },
            ]
        );
    }, [logoutAll, sessions?.length, alert]);


    // Active sessions management
    const activeSessionsItems = useMemo(() => {
        const items: any[] = [];
        const activeSessionsCount = sessions?.filter(s => s.isCurrent !== false).length || 0;

        if (activeSessionsCount > 1) {
            items.push({
                id: 'logout-all',
                icon: 'logout',
                iconColor: '#FF3B30',
                title: 'Sign out of all other devices',
                subtitle: `Sign out of ${activeSessionsCount - 1} other active session${activeSessionsCount - 1 !== 1 ? 's' : ''}`,
                onPress: handleLogoutAll,
                showChevron: false,
                customContent: isLoggingOutAll ? (
                    <ActivityIndicator size="small" color="#FF3B30" />
                ) : undefined,
            });
        }

        return items;
    }, [sessions, handleLogoutAll, isLoggingOutAll]);

    // Feature cards
    const featureCards = useMemo(() => [
        {
            id: 'safe-browsing',
            icon: 'shield-check-outline',
            iconColor: colors.sidebarIconSecurity,
            title: 'Enhanced Safe Browsing for your account',
            subtitle: 'More personalized protections against dangerous websites, downloads, and extensions.',
            customContent: (
                <Switch
                    value={enhancedSafeBrowsing}
                    onValueChange={setEnhancedSafeBrowsing}
                />
            ),
        },
        {
            id: 'dark-web',
            icon: 'magnify',
            iconColor: colors.sidebarIconData,
            title: 'Dark web report',
            subtitle: 'Start monitoring to get alerts and guidance if your info is found on the dark web',
            customContent: (
                <Switch
                    value={darkWebReport}
                    onValueChange={setDarkWebReport}
                />
            ),
        },
    ], [colors, enhancedSafeBrowsing, darkWebReport]);

    // Show loading state
    if (oxyLoading || loading) {
        return (
            <ScreenContentWrapper>
                <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
                    <ActivityIndicator size="large" color={colors.tint} />
                    <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading security settings...</ThemedText>
                </View>
            </ScreenContentWrapper>
        );
    }

    // Show message if not authenticated
    if (!isAuthenticated) {
        return (
            <UnauthenticatedScreen
                title="Security & sign-in"
                subtitle="Manage your security settings and sign-in methods."
                message="Please sign in to view your security settings."
                isAuthenticated={isAuthenticated}
            />
        );
    }

    const renderContent = () => (
        <>
            {securityRecommendations.length > 0 && (
                <Section title="Security recommendations">
                    <AccountCard>
                        <GroupedSection items={securityRecommendations} />
                    </AccountCard>
                </Section>
            )}

            <Section title="Recent security activity">
                {securityActivityLoading ? (
                    <AccountCard>
                        <View style={styles.emptyStateContainer}>
                            <ActivityIndicator size="small" color={colors.tint} />
                            <ThemedText style={[styles.emptyStateSubtitle, { color: colors.text, marginTop: 12 }]}>
                                Loading security activity...
                            </ThemedText>
                        </View>
                    </AccountCard>
                ) : recentActivity.length > 0 ? (
                    <>
                        <AccountCard>
                            <GroupedSection items={recentActivity} />
                        </AccountCard>
                        <View style={{ marginTop: -8 }}>
                            <LinkButton
                                text="Review security activity"
                                count={securityActivities.length > 5 ? `${securityActivities.length - 5} more` : undefined}
                                onPress={() => {
                                    // Show all activities in an alert with details
                                    const allActivities = securityActivities.map((activity: SecurityActivity) => {
                                        const severity = activity.severity || getEventSeverity(activity.eventType);
                                        return `• ${formatEventDescription(activity)} (${severity}) - ${formatRelativeTime(activity.timestamp)}`;
                                    }).join('\n\n');

                                    alert(
                                        'Security Activity',
                                        allActivities || 'No security activity found.',
                                        [{ text: 'OK', style: 'default' }]
                                    );
                                }}
                            />
                        </View>
                    </>
                ) : (
                    <AccountCard>
                        <View style={styles.emptyStateContainer}>
                            <MaterialCommunityIcons
                                name="shield-check-outline"
                                size={40}
                                color={colors.text}
                                style={styles.emptyStateIcon}
                            />
                            <ThemedText style={[styles.emptyStateTitle, { color: colors.text }]}>
                                No recent activity
                            </ThemedText>
                            <ThemedText style={[styles.emptyStateSubtitle, { color: colors.text }]}>
                                Your recent sign-ins and security events will appear here
                            </ThemedText>
                        </View>
                    </AccountCard>
                )}
            </Section>

            <Section title="How you sign in to Oxy">
                <ThemedText style={styles.sectionSubtitle}>Make sure you can always access your Oxy Account by keeping this information up to date</ThemedText>
                <AccountCard>
                    <GroupedSection items={signInItems} />
                </AccountCard>
            </Section>

            {Platform.OS !== 'web' && (
                <Section title="Account recovery">
                    <ThemedText style={styles.sectionSubtitle}>Manage your recovery options</ThemedText>
                    <AccountCard>
                        <GroupedSection items={[                        {
                            id: 'manage-backup',
                            icon: 'shield-key-outline',
                            iconColor: '#F59E0B',
                            title: 'Backup & settings',
                            subtitle: 'Create backup file and manage account settings',
                            onPress: () => router.push('/(tabs)/about-identity'),
                            showChevron: true,
                        }]} />
                    </AccountCard>
                </Section>
            )}

            <Section title="Your devices">
                <ThemedText style={styles.sectionSubtitle}>
                    Where you're signed in ({devices.length} device{devices.length !== 1 ? 's' : ''} total)
                </ThemedText>
                {deviceItems.length > 0 ? (
                    <>
                        <AccountCard>
                            <GroupedSection items={deviceItems} />
                        </AccountCard>
                        <View style={{ marginTop: -8 }}>
                            <LinkButton
                                text="Manage all devices"
                                count={devices.length.toString()}
                                onPress={() => router.push('/(tabs)/devices')}
                            />
                        </View>
                    </>
                ) : (
                    <AccountCard>
                        <View style={styles.emptyStateContainer}>
                            <MaterialCommunityIcons
                                name="devices"
                                size={40}
                                color={colors.text}
                                style={styles.emptyStateIcon}
                            />
                            <ThemedText style={[styles.emptyStateTitle, { color: colors.text }]}>
                                No devices found
                            </ThemedText>
                            <ThemedText style={[styles.emptyStateSubtitle, { color: colors.text }]}>
                                Devices you sign in on will appear here
                            </ThemedText>
                        </View>
                    </AccountCard>
                )}
            </Section>

            {activeSessionsItems.length > 0 && (
                <Section title="Active sessions">
                    <ThemedText style={styles.sectionSubtitle}>
                        Manage your active sign-in sessions across all devices
                    </ThemedText>
                    <AccountCard>
                        <GroupedSection items={activeSessionsItems} />
                    </AccountCard>
                </Section>
            )}

            <Section title="Security features">
                <AccountCard>
                    <GroupedSection items={featureCards} />
                </AccountCard>
            </Section>
        </>
    );

    if (isDesktop) {
        return (
            <>
                <ScreenHeader title="Security & sign-in" subtitle="Manage your security settings and sign-in methods." />
                {renderContent()}
            </>
        );
    }

    return (
        <ScreenContentWrapper>
            <View style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.mobileContent}>
                    <ScreenHeader title="Security & sign-in" subtitle="Manage your security settings and sign-in methods." />
                    {renderContent()}
                </View>
            </View>
        </ScreenContentWrapper>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    desktopBody: {
        flex: 1,
        flexDirection: 'row',
    },
    desktopMain: {
        flex: 1,
        maxWidth: 720,
    },
    desktopMainContent: {
        padding: 32,
    },
    headerSection: {
        marginBottom: 24,
    },
    title: {
        fontSize: 32,
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        marginBottom: 8,
    },
    recommendationIconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionSubtitle: {
        fontSize: 14,
        opacity: 0.7,
    },
    statusContainer: {
        marginLeft: 8,
    },
    mobileContent: {
        padding: 16,
        paddingBottom: 120,
    },
    mobileHeaderSection: {
        marginBottom: 20,
    },
    mobileTitle: {
        fontSize: 28,
        fontWeight: '600',
        marginBottom: 6,
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
    placeholderText: {
        fontSize: 16,
        textAlign: 'center',
    },
    emptyText: {
        fontSize: 14,
        opacity: 0.6,
        textAlign: 'center',
        paddingVertical: 20,
    },
    emptyStateContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 32,
        paddingHorizontal: 24,
    },
    emptyStateIcon: {
        opacity: 0.4,
        marginBottom: 12,
    },
    emptyStateTitle: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 6,
        opacity: 0.8,
    },
    emptyStateSubtitle: {
        fontSize: 13,
        opacity: 0.6,
        textAlign: 'center',
        lineHeight: 18,
    },
});

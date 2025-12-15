import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { LinkButton, AccountCard, AppleSwitch, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useOxy, useUserDevices } from '@oxyhq/services';
import { formatDate } from '@/utils/date-utils';
import type { ClientSession } from '@oxyhq/services';
import { useBiometricSettings } from '@/hooks/useBiometricSettings';

export default function SecurityScreen() {
    const colorScheme = useColorScheme() ?? 'light';
    const { width } = useWindowDimensions();
    const router = useRouter();

    const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
    const isDesktop = Platform.OS === 'web' && width >= 768;

    // OxyServices integration
    const { user, isAuthenticated, isLoading: oxyLoading, sessions, hasIdentity, getPublicKey } = useOxy();
    const [enhancedSafeBrowsing, setEnhancedSafeBrowsing] = useState(false);
    const [darkWebReport, setDarkWebReport] = useState(false);

    // Fetch devices using TanStack Query hook
    const { data: devices = [], isLoading: loading, error: devicesError } = useUserDevices({
        enabled: isAuthenticated,
    });

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
    const getDeviceIcon = useCallback((deviceType?: string): string => {
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

    // Compute security recommendations
    const securityRecommendation = useMemo(() => {
        const recommendations: string[] = [];

        // Recommend biometric if available but not enabled
        if (canEnableBiometric && !biometricEnabled && !biometricLoading) {
            recommendations.push('Enable biometric authentication');
        }

        // Recommend recovery email
        if (!user?.email) {
            recommendations.push('Add a recovery email');
        }

        if (recommendations.length === 0) return [];

        return [{
            id: 'recommendation',
            customIcon: (
                <View style={[styles.recommendationIconContainer, { backgroundColor: '#FFC107' }]}>
                    <MaterialCommunityIcons name="shield-alert" size={22} color={darkenColor('#FFC107')} />
                </View>
            ),
            title: 'You have security recommendations',
            subtitle: recommendations.join(', '),
            onPress: () => {
                // Scroll to biometric section or show email prompt
                if (canEnableBiometric && !biometricEnabled) {
                    // The toggle will be visible in the biometric section
                }
            },
            showChevron: false,
        }];
    }, [canEnableBiometric, biometricEnabled, biometricLoading, user?.email]);

    // Recent activity from sessions - grouped by device to show unique sign-ins
    const recentActivity = useMemo(() => {
        if (!sessions || sessions.length === 0) return [];

        // Group sessions by deviceId and get the most recent session per device
        const deviceSessionsMap = new Map<string, ClientSession>();

        sessions.forEach((session: ClientSession) => {
            if (!session.deviceId) return;

            const existing = deviceSessionsMap.get(session.deviceId);
            if (!existing) {
                deviceSessionsMap.set(session.deviceId, session);
            } else {
                // Keep the most recent session for this device
                const existingTime = new Date(existing.lastActive || 0).getTime();
                const currentTime = new Date(session.lastActive || 0).getTime();
                if (currentTime > existingTime) {
                    deviceSessionsMap.set(session.deviceId, session);
                }
            }
        });

        // Get last 5 unique devices, sorted by most recent activity
        const uniqueDeviceSessions = Array.from(deviceSessionsMap.values())
            .sort((a, b) => {
                const aTime = new Date(a.lastActive || 0).getTime();
                const bTime = new Date(b.lastActive || 0).getTime();
                return bTime - aTime;
            })
            .slice(0, 5);

        return uniqueDeviceSessions.map((session: ClientSession) => {
            // Match device by deviceId - try both d.deviceId and d.id
            const device = devices.find((d: any) =>
                (d.deviceId === session.deviceId) || (d.id === session.deviceId)
            );

            // Use device info if available, otherwise infer from session
            const deviceType = device?.type || device?.deviceType || 'unknown';
            const deviceName = device?.name || device?.deviceName || 'Unknown Device';
            // Use device's lastActive if available (more accurate), otherwise session's lastActive
            const lastActive = device?.lastActive || device?.createdAt || session.lastActive;
            const deviceId = session.deviceId;

            return {
                id: `activity-${session.deviceId}`,
                icon: getDeviceIcon(deviceType) as any,
                iconColor: colors.sidebarIconDevices,
                title: `New sign-in on ${deviceName}`,
                subtitle: formatRelativeTime(lastActive),
                onPress: () => {
                    if (deviceId) {
                        router.push(`/(tabs)/devices/${deviceId}` as any);
                    }
                },
                showChevron: true,
            };
        });
    }, [sessions, devices, colors, formatRelativeTime, getDeviceIcon, router]);

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
                    <AppleSwitch
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

        // Notification email (optional, not used for login)
        if (user?.email) {
            items.push({
                id: 'notification-email',
                icon: 'email-outline',
                iconColor: colors.sidebarIconSecurity,
                title: 'Notification email',
                subtitle: user.email,
                onPress: () => router.push('/(tabs)/personal-info'),
                showChevron: true,
            });
        }

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
                icon: icon as any,
                iconColor: colors.sidebarIconDevices,
                title: `${group.count} device${group.count !== 1 ? 's' : ''} (${typeLabel})`,
                subtitle,
                onPress: () => router.push('/(tabs)/devices'),
                showChevron: true,
            });
        });

        return items;
    }, [devices, colors, getDeviceIcon, router]);

    // Feature cards
    const featureCards = useMemo(() => [
        {
            id: 'safe-browsing',
            icon: 'shield-check-outline',
            iconColor: colors.sidebarIconSecurity,
            title: 'Enhanced Safe Browsing for your account',
            subtitle: 'More personalized protections against dangerous websites, downloads, and extensions.',
            customContent: (
                <AppleSwitch
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
                <AppleSwitch
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
            {securityRecommendation.length > 0 && (
                <AccountCard>
                    <GroupedSection items={securityRecommendation} />
                </AccountCard>
            )}

            <Section title="Recent security activity">
                {recentActivity.length > 0 ? (
                    <>
                        <AccountCard>
                            <GroupedSection items={recentActivity} />
                        </AccountCard>
                        <View style={{ marginTop: -8 }}>
                            <LinkButton text="Review security activity" />
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

            <Section title="Account recovery">
                <ThemedText style={styles.sectionSubtitle}>Backup options to recover your account if you lose access</ThemedText>
                <AccountCard>
                    <GroupedSection items={[
                        {
                            id: 'recovery-phrase',
                            icon: 'shield-key-outline',
                            iconColor: '#F59E0B',
                            title: 'Recovery phrase',
                            subtitle: 'View your 12-word backup phrase',
                            onPress: () => {
                                Alert.alert(
                                    'Security Check',
                                    'Make sure no one is looking at your screen before viewing your recovery phrase.',
                                    [
                                        { text: 'Cancel', style: 'cancel' },
                                        { 
                                            text: 'Continue', 
                                            onPress: () => {
                                                if (Platform.OS !== 'web') {
                                                    router.push('/(tabs)/about-identity');
                                                } else {
                                                    Alert.alert('Info', 'Recovery phrase viewing is available in the mobile app.');
                                                }
                                            }
                                        },
                                    ]
                                );
                            },
                            showChevron: true,
                        },
                        ...(user?.email ? [{
                            id: 'recovery-email',
                            icon: 'email-outline',
                            iconColor: colors.sidebarIconSecurity,
                            title: 'Recovery email',
                            subtitle: user.email,
                            onPress: () => {
                                router.push('/(tabs)/personal-info');
                            },
                            showChevron: true,
                        }] : []),
                    ]} />
                </AccountCard>
            </Section>

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
        fontWeight: '600',
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
        marginBottom: 12,
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

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { LinkButton, AccountCard, AppleSwitch, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy, OxySignInButton } from '@oxyhq/services';
import { formatDate } from '@/utils/date-utils';
import type { ClientSession } from '@oxyhq/services';

interface SecurityInfo {
    twoFactorEnabled: boolean;
    totpCreatedAt: string | null;
    backupCodesCount: number;
    recoveryEmail: string | null;
}

export default function SecurityScreen() {
    const colorScheme = useColorScheme() ?? 'light';
    const { width } = useWindowDimensions();

    const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
    const isDesktop = Platform.OS === 'web' && width >= 768;

    // OxyServices integration
    const { oxyServices, user, isAuthenticated, isLoading: oxyLoading, sessions, showBottomSheet } = useOxy();
    const [skipPassword, setSkipPassword] = useState(true);
    const [enhancedSafeBrowsing, setEnhancedSafeBrowsing] = useState(false);
    const [darkWebReport, setDarkWebReport] = useState(false);
    const [securityInfo, setSecurityInfo] = useState<SecurityInfo | null>(null);
    const [devices, setDevices] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch security data
    useEffect(() => {
        const fetchSecurityData = async () => {
            if (!isAuthenticated || !oxyServices) return;

            setLoading(true);
            setError(null);
            try {
                const [securityData, devicesData] = await Promise.all([
                    (oxyServices as any).getSecurityInfo(),
                    oxyServices.getUserDevices(),
                ]);
                setSecurityInfo(securityData);
                setDevices(devicesData || []);
            } catch (err: any) {
                console.error('Failed to fetch security data:', err);
                setError(err?.message || 'Failed to load security data');
            } finally {
                setLoading(false);
            }
        };

        fetchSecurityData();
    }, [isAuthenticated, oxyServices]);

    // Handle sign in
    const handleSignIn = useCallback(() => {
        if (showBottomSheet) {
            showBottomSheet('SignIn');
        }
    }, [showBottomSheet]);

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

        if (!securityInfo?.twoFactorEnabled) {
            recommendations.push('Enable 2-Step Verification');
        }
        if (securityInfo && securityInfo.backupCodesCount === 0 && securityInfo.twoFactorEnabled) {
            recommendations.push('Generate backup codes');
        }
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
        }];
    }, [securityInfo, user]);

    // Recent activity from sessions
    const recentActivity = useMemo(() => {
        if (!sessions || sessions.length === 0) return [];

        // Get last 5 sessions, sorted by lastActive
        const recentSessions = [...sessions]
            .sort((a, b) => {
                const aTime = new Date(a.lastActive || 0).getTime();
                const bTime = new Date(b.lastActive || 0).getTime();
                return bTime - aTime;
            })
            .slice(0, 5);

        return recentSessions.map((session: ClientSession) => {
            // Use deviceId to match with devices data if available
            const device = devices.find((d: any) => d.deviceId === session.deviceId);
            const deviceType = device?.type || device?.deviceType || 'Unknown';
            const deviceName = device?.name || device?.deviceName || deviceType;
            const lastActive = session.lastActive;

            return {
                id: `activity-${session.sessionId}`,
                icon: getDeviceIcon(deviceType) as any,
                iconColor: colors.sidebarIconDevices,
                title: `New sign-in on ${deviceName}`,
                subtitle: formatRelativeTime(lastActive),
            };
        });
    }, [sessions, devices, colors, formatRelativeTime, getDeviceIcon]);

    // Sign-in items with real data
    const signInItems = useMemo(() => {
        const items: any[] = [];

        // 2-Step Verification
        if (securityInfo) {
            items.push({
                id: '2fa',
                icon: 'shield-check-outline',
                iconColor: colors.sidebarIconSecurity,
                title: '2-Step Verification',
                subtitle: securityInfo.twoFactorEnabled
                    ? securityInfo.totpCreatedAt
                        ? `On since ${formatDate(securityInfo.totpCreatedAt)}`
                        : 'On'
                    : 'Off',
                customContent: securityInfo.twoFactorEnabled ? (
                    <View style={styles.statusContainer}>
                        <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                    </View>
                ) : undefined,
            });
        }

        // Password
        items.push({
            id: 'password',
            icon: 'dots-horizontal',
            iconColor: colors.sidebarIconSecurity,
            title: 'Password',
            subtitle: user?.createdAt ? `Account created ${formatDate(user.createdAt)}` : 'Set a password',
        });

        // Skip password when possible
        items.push({
            id: 'skip-password',
            icon: 'key-minus',
            iconColor: colors.sidebarIconSecurity,
            title: 'Skip password when possible',
            subtitle: skipPassword ? 'On' : 'Off',
            customContent: (
                <AppleSwitch
                    value={skipPassword}
                    onValueChange={setSkipPassword}
                />
            ),
        });

        // Authenticator (if TOTP is enabled)
        if (securityInfo?.twoFactorEnabled && securityInfo.totpCreatedAt) {
            items.push({
                id: 'authenticator',
                icon: 'grid',
                iconColor: colors.sidebarIconSecurity,
                title: 'Authenticator',
                subtitle: `Added ${formatDate(securityInfo.totpCreatedAt)}`,
            });
        }

        // Recovery email
        if (user?.email || securityInfo?.recoveryEmail) {
            const email = user?.email || securityInfo?.recoveryEmail;
            items.push({
                id: 'recovery-email',
                icon: 'email-outline',
                iconColor: colors.sidebarIconSecurity,
                title: 'Recovery email',
                subtitle: email || 'Not set',
                customContent: !email ? (
                    <View style={styles.statusContainer}>
                        <Ionicons name="warning" size={20} color="#FFC107" />
                    </View>
                ) : undefined,
            });
        }

        // Backup codes
        if (securityInfo && securityInfo.twoFactorEnabled) {
            items.push({
                id: 'backup-codes',
                icon: 'grid',
                iconColor: colors.sidebarIconSecurity,
                title: 'Backup codes',
                subtitle: securityInfo.backupCodesCount > 0
                    ? `${securityInfo.backupCodesCount} codes available`
                    : 'No codes available',
            });
        }

        return items;
    }, [colors, skipPassword, securityInfo, user, formatDate]);

    // Device items grouped by type
    const deviceItems = useMemo(() => {
        if (!devices || devices.length === 0) return [];

        // Group devices by type
        const deviceGroups = new Map<string, { count: number; names: string[] }>();

        devices.forEach((device: any) => {
            const type = device.type || device.deviceType || 'unknown';
            const name = device.name || device.deviceName || 'Unknown Device';

            if (!deviceGroups.has(type)) {
                deviceGroups.set(type, { count: 0, names: [] });
            }
            const group = deviceGroups.get(type)!;
            group.count++;
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
                title: `${group.count} session${group.count !== 1 ? 's' : ''} on ${typeLabel} device${group.count !== 1 ? 's' : ''}`,
                subtitle,
            });
        });

        return items;
    }, [devices, colors, getDeviceIcon]);

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
            <ScreenContentWrapper>
                <View style={[styles.container, { backgroundColor: colors.background }]}>
                    <View style={styles.mobileContent}>
                        <ScreenHeader title="Security & sign-in" subtitle="Manage your security settings and sign-in methods." />
                        <View style={styles.unauthenticatedPlaceholder}>
                            <ThemedText style={[styles.placeholderText, { color: colors.text }]}>
                                Please sign in to view your security settings.
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
                        <LinkButton text="Review security activity" />
                    </>
                ) : (
                    <ThemedText style={[styles.emptyText, { color: colors.text }]}>
                        No recent activity
                    </ThemedText>
                )}
            </Section>

            <Section title="How you sign in to Oxy">
                <ThemedText style={styles.sectionSubtitle}>Make sure you can always access your Oxy Account by keeping this information up to date</ThemedText>
                <AccountCard>
                    <GroupedSection items={signInItems} />
                </AccountCard>
            </Section>

            <Section title="Your devices">
                <ThemedText style={styles.sectionSubtitle}>Where you're signed in</ThemedText>
                {deviceItems.length > 0 ? (
                    <>
                        <AccountCard>
                            <GroupedSection items={deviceItems} />
                        </AccountCard>
                        <View style={styles.deviceActions}>
                            <LinkButton text="Manage all devices" count={devices.length.toString()} />
                        </View>
                    </>
                ) : (
                    <ThemedText style={[styles.emptyText, { color: colors.text }]}>
                        No devices found
                    </ThemedText>
                )}
            </Section>

            <AccountCard>
                <GroupedSection items={featureCards} />
            </AccountCard>
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
    deviceActions: {
        flexDirection: 'row',
        gap: 24,
        marginTop: 8,
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
    unauthenticatedPlaceholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        gap: 24,
    },
    placeholderText: {
        fontSize: 16,
        textAlign: 'center',
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
    emptyText: {
        fontSize: 14,
        opacity: 0.6,
        textAlign: 'center',
        paddingVertical: 20,
    },
});

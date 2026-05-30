import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@oxyhq/bloom/theme';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { LinkButton, AccountCard, Switch, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy, useUserDevices, useRecentSecurityActivity, showBottomSheet } from '@oxyhq/services';
import { alert, toast } from '@oxyhq/bloom';
import { formatDate } from '@/utils/date-utils';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import type { ClientSession, SecurityActivity } from '@oxyhq/core';
import { useBiometricSettings } from '@/hooks/useBiometricSettings';
import { getEventIcon, getSeverityColor, getEventSeverity, formatEventDescription } from '@/utils/security-utils';
import { getDeviceIcon, getDeviceDisplayName, type DeviceRecord } from '@/utils/device-utils';
import type { MaterialCommunityIconName } from '@/types/icons';
import { useTranslation } from '@/lib/i18n';
import { getNativeLanguageName } from '@oxyhq/core';
import { useIdentityStore } from '@/hooks/identity/identityStore';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';

/**
 * A row rendered by `GroupedSection`. Mirrors the props that component
 * accepts; declared locally because the interface is not exported from
 * `components/grouped-section`.
 */
interface GroupedItem {
    id: string;
    icon?: MaterialCommunityIconName;
    iconColor?: string;
    title: string;
    subtitle?: string;
    onPress?: () => void;
    showChevron?: boolean;
    disabled?: boolean;
    customContent?: React.ReactNode;
    customIcon?: React.ReactNode;
}

/** A security recommendation row, sortable by ascending `priority`. */
interface RecommendationItem extends GroupedItem {
    priority: number;
}

export default function SecurityScreen() {
    const { mode } = useTheme();
    const colors = useColors();
    const { width } = useWindowDimensions();
    const router = useRouter();
    const isDesktop = Platform.OS === 'web' && width >= 768;
    const { t, locale } = useTranslation();

    // OxyServices integration — auth is enforced by the `(tabs)` layout.
    const { user, isLoading: oxyLoading, sessions, getPublicKey, logoutAll, oxyServices } = useOxy();
    // hasIdentity from useOxy is a function; pull the reactive boolean from
    // the onboarding status hook instead so we can use it in dependency
    // arrays and conditional rendering.
    const { hasIdentity: hasIdentityBoolean } = useOnboardingStatus();
    const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);

    // Fetch devices using TanStack Query hook — the `(tabs)` layout guarantees
    // an authenticated session by the time this hook mounts.
    const { data: rawDevices, isLoading: loading, error: devicesError } = useUserDevices();
    const devices = (rawDevices ?? []) as DeviceRecord[];

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

    // Whether the user has acknowledged writing down their recovery phrase.
    // If false on native (where identity exists), we surface a high-priority
    // backup recommendation. This is the single most important security
    // recommendation in the entire app — without a phrase backup, account
    // loss is irreversible.
    const recoveryPhraseAcknowledged = useIdentityStore(
        (state) => state.recoveryPhraseAcknowledged,
    );

    const formatRelativeTime = useRelativeTime();

    // Compute security recommendations with actionable items
    const securityRecommendations = useMemo(() => {
        const recommendations: RecommendationItem[] = [];

        // 0. CRITICAL: Recommend backing up the recovery phrase if the user
        //    has not acknowledged it. Without this, account loss is
        //    irreversible — Oxy cannot recover the account. We render this
        //    only on native because there is no identity to back up on web.
        if (Platform.OS !== 'web' && hasIdentityBoolean && !recoveryPhraseAcknowledged) {
            recommendations.push({
                id: 'recovery-phrase-backup',
                priority: 0,
                icon: 'shield-key-outline',
                iconColor: colors.error,
                title: t('security.recommendations.recoveryPhraseBackup'),
                subtitle: t('security.recommendations.recoveryPhraseBackupSubtitle'),
                onPress: () => router.push('/(tabs)/create-backup'),
                showChevron: true,
            });
        }

        // 1. Recommend biometric if available but not enabled (High priority)
        if (canEnableBiometric && !biometricEnabled && !biometricLoading) {
            recommendations.push({
                id: 'biometric',
                priority: 1,
                icon: Platform.OS === 'ios' ? 'face-recognition' : 'fingerprint',
                iconColor: colors.warning,
                title: t('security.recommendations.biometric'),
                subtitle: t('security.recommendations.biometricSubtitle'),
                onPress: () => {
                    // The biometric toggle lives in the "How you sign in"
                    // section on this same screen, so the recommendation is
                    // purely informational — point the user at the toggle
                    // below rather than offering a no-op navigation action.
                    alert(
                        t('security.recommendations.biometricAlertTitle'),
                        t('security.recommendations.biometricAlertMessage'),
                        [{ text: t('common.ok'), style: 'default' }]
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
                iconColor: colors.warning,
                title: t('security.recommendations.recoveryEmail'),
                subtitle: t('security.recommendations.recoveryEmailSubtitle'),
                onPress: () => {
                    // Single prompt: confirm → route straight to the profile
                    // screen where the email field lives. No nested alerts.
                    alert(
                        t('security.recommendations.recoveryEmailAlertTitle'),
                        t('security.recommendations.recoveryEmailGoToProfile'),
                        [
                            { text: t('common.cancel'), style: 'cancel' },
                            {
                                text: t('security.recommendations.recoveryEmailAddCta'),
                                onPress: () => router.push('/(tabs)/personal-info'),
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
                iconColor: colors.warning,
                title: t('security.recommendations.oldSessions', { count: oldSessions.length }),
                subtitle: t('security.recommendations.oldSessionsSubtitle'),
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
                iconColor: colors.sidebarIconDevices,
                title: t('security.recommendations.manyDevices', { count: devices.length }),
                subtitle: t('security.recommendations.manyDevicesSubtitle'),
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
                iconColor: colors.error,
                title: t('security.recommendations.suspicious', { count: recentSuspiciousActivity.length }),
                subtitle: t('security.recommendations.suspiciousSubtitle'),
                onPress: () => {
                    alert(
                        t('security.recommendations.suspiciousAlertTitle'),
                        t('security.recommendations.suspiciousAlertMessage', { count: recentSuspiciousActivity.length }),
                        [{ text: t('common.ok'), style: 'default' }]
                    );
                },
                showChevron: true,
            });
        }

        // Sort by priority (lower number = higher priority)
        return recommendations.sort((a, b) => a.priority - b.priority);
    }, [
        hasIdentityBoolean,
        recoveryPhraseAcknowledged,
        canEnableBiometric,
        biometricEnabled,
        biometricLoading,
        user?.email,
        sessions,
        devices.length,
        securityActivities,
        router,
        alert,
        t,
        colors.warning,
        colors.error,
        colors.sidebarIconDevices,
    ]);

    // Recent activity from security events
    const recentActivity = useMemo(() => {
        if (!securityActivities || securityActivities.length === 0) return [];

        return securityActivities.slice(0, 5).map((activity: SecurityActivity) => {
            const eventIcon = getEventIcon(activity.eventType);
            // Use severity-based color for better consistency
            const severity = activity.severity || getEventSeverity(activity.eventType);
            const eventColor = getSeverityColor(severity, mode);
            const description = formatEventDescription(activity);
            const deviceId = activity.deviceId;

            // Show details on press - include IP, device info, etc.
            const onPress = () => {
                const details = [
                    `${t('security.activity.detailType')}: ${activity.eventType}`,
                    `${t('security.activity.detailSeverity')}: ${severity}`,
                    activity.ipAddress ? `${t('security.activity.detailIp')}: ${activity.ipAddress}` : null,
                    activity.deviceId && activity.metadata?.deviceName
                        ? `${t('security.activity.detailDevice')}: ${activity.metadata.deviceName}`
                        : activity.deviceId
                            ? `${t('security.activity.detailDeviceId')}: ${activity.deviceId}`
                            : null,
                    activity.userAgent ? `${t('security.activity.detailBrowser')}: ${activity.userAgent.substring(0, 50)}${activity.userAgent.length > 50 ? '...' : ''}` : null,
                    `${t('security.activity.detailTime')}: ${formatDate(activity.timestamp)}`,
                ].filter(Boolean).join('\n');

                alert(
                    description,
                    details,
                    [
                        // Add navigation to device if available
                        ...(deviceId && (activity.eventType === 'device_added' || activity.eventType === 'device_removed' || activity.eventType === 'sign_in')
                            ? [{
                                text: t('security.activity.viewDevice'),
                                onPress: () => router.push({ pathname: '/(tabs)/devices/[deviceId]', params: { deviceId } }),
                            }]
                            : []),
                        { text: t('common.ok'), style: 'default' },
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
    }, [securityActivities, mode, formatRelativeTime, router, alert, t]);

    // Sign-in items
    const signInItems = useMemo(() => {
        const items: GroupedItem[] = [];

        // Biometric authentication
        if (Platform.OS !== 'web') {
            let biometricSubtitle = '';
            if (biometricLoading) {
                biometricSubtitle = t('security.signIn.biometricChecking');
            } else if (!hasBiometricHardware) {
                biometricSubtitle = t('security.signIn.biometricNoHardware');
            } else if (!isBiometricEnrolled) {
                biometricSubtitle = t('security.signIn.biometricNotEnrolled');
            } else if (biometricEnabled) {
                biometricSubtitle = biometricTypes.length > 0
                    ? t('security.signIn.biometricEnabledWithTypes', { types: biometricTypes.join(', ') })
                    : t('security.signIn.biometricEnabled');
            } else {
                biometricSubtitle = canEnableBiometric
                    ? t('security.signIn.biometricAvailableToggle')
                    : t('security.signIn.biometricNotAvailable');
            }

            items.push({
                id: 'biometric',
                icon: Platform.OS === 'ios' ? 'face-recognition' : 'fingerprint',
                iconColor: biometricEnabled ? colors.success : colors.sidebarIconSecurity,
                title: Platform.OS === 'ios' ? t('security.signIn.faceTouchId') : t('security.signIn.biometricAuthTitle'),
                subtitle: biometricSubtitle,
                customContent: canEnableBiometric ? (
                    <Switch
                        value={biometricEnabled}
                        onValueChange={toggleBiometricLogin}
                        disabled={biometricSaving || biometricLoading}
                    />
                ) : biometricEnabled ? (
                    <View style={styles.statusContainer}>
                        <Ionicons name="checkmark-circle" size={20} color={colors.iconSuccess} />
                    </View>
                ) : undefined,
            });
        }

        // Public key authentication info
        items.push({
            id: 'public-key-auth',
            icon: 'key-outline',
            iconColor: colors.success,
            title: t('security.signIn.publicKeyAuth'),
            subtitle: t('security.signIn.publicKeyAuthSubtitle'),
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
        t,
    ]);

    // Device items grouped by type
    const deviceItems = useMemo(() => {
        if (!devices || devices.length === 0) return [];

        // Group devices by type
        const deviceGroups = new Map<string, { count: number; names: string[]; deviceIds: string[] }>();

        devices.forEach((device: DeviceRecord) => {
            const type = device.type || device.deviceType || 'unknown';
            const name = getDeviceDisplayName(device, 'Unknown Device');
            const deviceId = device.id || device.deviceId || '';

            let group = deviceGroups.get(type);
            if (!group) {
                group = { count: 0, names: [], deviceIds: [] };
                deviceGroups.set(type, group);
            }
            group.count++;
            group.deviceIds.push(deviceId);
            if (group.names.length < 3) {
                group.names.push(name);
            }
        });

        // Convert to items
        const items: GroupedItem[] = [];
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
                title: t('security.devices.groupTitle', { count: group.count, type: typeLabel }),
                subtitle,
                onPress: () => router.push('/(tabs)/devices'),
                showChevron: true,
            });
        });

        return items;
    }, [devices, colors, router, t]);


    // Handle logout all sessions
    const handleLogoutAll = useCallback(async () => {
        const sessionCount = sessions?.length || 0;
        alert(
            t('security.sessions.logoutAllConfirmTitle'),
            t('security.sessions.logoutAllConfirmMessage', { count: sessionCount }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('security.sessions.logoutAllAction'),
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setIsLoggingOutAll(true);
                            await logoutAll();
                            toast.success(t('security.sessions.logoutAllSuccess'));
                        } catch (error: unknown) {
                            const message = error instanceof Error ? error.message : t('security.sessions.logoutAllFailed');
                            toast.error(message);
                        } finally {
                            setIsLoggingOutAll(false);
                        }
                    },
                },
            ]
        );
    }, [logoutAll, sessions?.length, alert, t]);


    // Active sessions management
    const activeSessionsItems = useMemo(() => {
        const items: GroupedItem[] = [];
        const activeSessionsCount = sessions?.filter(s => s.isCurrent !== false).length || 0;

        if (activeSessionsCount > 1) {
            items.push({
                id: 'logout-all',
                icon: 'logout',
                iconColor: colors.error,
                title: t('security.sessions.logoutAll'),
                subtitle: t('security.sessions.logoutAllSubtitle', { count: activeSessionsCount - 1 }),
                onPress: handleLogoutAll,
                showChevron: false,
                customContent: isLoggingOutAll ? (
                    <ActivityIndicator size="small" color={colors.error} />
                ) : undefined,
            });
        }

        return items;
    }, [sessions, handleLogoutAll, isLoggingOutAll, colors.error, t]);


    // Language section items
    const languageItems = useMemo(() => [{
        id: 'app-language',
        icon: 'translate' as MaterialCommunityIconName,
        iconColor: colors.sidebarIconData,
        title: t('security.language.label'),
        subtitle: getNativeLanguageName(locale) || locale,
        onPress: () => showBottomSheet('LanguageSelector'),
        showChevron: true,
    }], [colors.sidebarIconData, t, locale]);

    // Show loading state
    if (oxyLoading || loading) {
        return (
            <ScreenContentWrapper>
                <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
                    <ActivityIndicator size="large" color={colors.tint} />
                    <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('security.loading')}</ThemedText>
                </View>
            </ScreenContentWrapper>
        );
    }

    const renderContent = () => (
        <>
            {securityRecommendations.length > 0 && (
                <Section title={t('security.sections.recommendations')}>
                    <AccountCard>
                        <GroupedSection items={securityRecommendations} />
                    </AccountCard>
                </Section>
            )}

            <Section title={t('security.sections.recentActivity')}>
                {securityActivityLoading ? (
                    <AccountCard>
                        <View style={styles.emptyStateContainer}>
                            <ActivityIndicator size="small" color={colors.tint} />
                            <ThemedText style={[styles.emptyStateSubtitle, { color: colors.text, marginTop: 12 }]}>
                                {t('security.activity.loading')}
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
                                text={t('security.activity.reviewCta')}
                                count={securityActivities.length > 5 ? t('security.activity.moreCount', { count: securityActivities.length - 5 }) : undefined}
                                onPress={() => {
                                    // Show all activities in an alert with details
                                    const allActivities = securityActivities.map((activity: SecurityActivity) => {
                                        const severity = activity.severity || getEventSeverity(activity.eventType);
                                        return `• ${formatEventDescription(activity)} (${severity}) - ${formatRelativeTime(activity.timestamp)}`;
                                    }).join('\n\n');

                                    alert(
                                        t('security.activity.allTitle'),
                                        allActivities || t('security.activity.allEmpty'),
                                        [{ text: t('common.ok'), style: 'default' }]
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
                                {t('security.activity.noActivity')}
                            </ThemedText>
                            <ThemedText style={[styles.emptyStateSubtitle, { color: colors.text }]}>
                                {t('security.activity.noActivitySubtitle')}
                            </ThemedText>
                        </View>
                    </AccountCard>
                )}
            </Section>

            <Section title={t('security.sections.howYouSignIn')}>
                <ThemedText style={styles.sectionSubtitle}>{t('security.sections.howYouSignInSubtitle')}</ThemedText>
                <AccountCard>
                    <GroupedSection items={signInItems} />
                </AccountCard>
            </Section>

            <Section title={t('security.sections.language')}>
                <ThemedText style={styles.sectionSubtitle}>{t('security.sections.languageSubtitle')}</ThemedText>
                <AccountCard>
                    <GroupedSection items={languageItems} />
                </AccountCard>
            </Section>

            {Platform.OS !== 'web' && (
                <Section title={t('security.sections.accountRecovery')}>
                    <ThemedText style={styles.sectionSubtitle}>{t('security.sections.accountRecoverySubtitle')}</ThemedText>
                    <AccountCard>
                        <GroupedSection items={[{
                            id: 'manage-recovery',
                            icon: 'shield-key-outline',
                            iconColor: colors.warning,
                            title: t('security.recovery.title'),
                            subtitle: t('security.recovery.subtitle'),
                            onPress: () => router.push('/(tabs)/about-identity'),
                            showChevron: true,
                        }]} />
                    </AccountCard>
                </Section>
            )}

            <Section title={t('security.sections.yourDevices')}>
                <ThemedText style={styles.sectionSubtitle}>
                    {t('security.sections.yourDevicesSubtitle', { count: devices.length })}
                </ThemedText>
                {deviceItems.length > 0 ? (
                    <>
                        <AccountCard>
                            <GroupedSection items={deviceItems} />
                        </AccountCard>
                        <View style={{ marginTop: -8 }}>
                            <LinkButton
                                text={t('security.devices.manageAll')}
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
                                {t('security.devices.noDevices')}
                            </ThemedText>
                            <ThemedText style={[styles.emptyStateSubtitle, { color: colors.text }]}>
                                {t('security.devices.noDevicesSubtitle')}
                            </ThemedText>
                        </View>
                    </AccountCard>
                )}
            </Section>

            {activeSessionsItems.length > 0 && (
                <Section title={t('security.sections.activeSessions')}>
                    <ThemedText style={styles.sectionSubtitle}>
                        {t('security.sections.activeSessionsSubtitle')}
                    </ThemedText>
                    <AccountCard>
                        <GroupedSection items={activeSessionsItems} />
                    </AccountCard>
                </Section>
            )}

        </>
    );

    if (isDesktop) {
        return (
            <>
                <ScreenHeader title={t('security.title')} subtitle={t('security.subtitle')} />
                {renderContent()}
            </>
        );
    }

    return (
        <ScreenContentWrapper>
            <View style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.mobileContent}>
                    <ScreenHeader title={t('security.title')} subtitle={t('security.subtitle')} />
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

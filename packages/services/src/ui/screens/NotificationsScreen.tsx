import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import { Switch } from '@oxyhq/bloom/switch';
import { useTheme } from '@oxyhq/bloom/theme';
import type { NotificationPreferences } from '@oxyhq/core';
import type { BaseScreenProps } from '../types/navigation';
import Header from '../components/Header';
import { SettingsIcon } from '../components/SettingsIcon';
import { useI18n } from '../hooks/useI18n';
import { useOxy } from '../context/OxyContext';
import { useCurrentUser } from '../hooks/queries/useAccountQueries';
import { useUpdateNotificationPreferences } from '../hooks/mutations/useAccountMutations';
import { useSettingToggles } from '../hooks/useSettingToggle';
import { useColorScheme } from '../hooks/useColorScheme';
import { Colors } from '../constants/theme';
import { normalizeColorScheme, normalizeTheme } from '@oxyhq/core';

interface NotificationToggleValues {
    pushEnabled: boolean;
    emailDigest: boolean;
    securityAlerts: boolean;
    marketingEmails: boolean;
}

const DEFAULT_VALUES: NotificationToggleValues = {
    pushEnabled: true,
    emailDigest: true,
    securityAlerts: true,
    marketingEmails: false,
};

/**
 * NotificationsScreen — manage per-channel notification preferences.
 *
 * Persists every toggle change via `useUpdateNotificationPreferences`, which
 * uses optimistic updates + offline-queue support. The initial values seed
 * from the current user's `notificationPreferences` field, defaulting to the
 * platform defaults when the field has never been set.
 */
const NotificationsScreen: React.FC<BaseScreenProps> = ({ onClose, theme, goBack }) => {
    const bloomTheme = useTheme();
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const palette = useMemo(
        () => Colors[normalizeColorScheme(colorScheme, normalizeTheme(theme))],
        [colorScheme, theme],
    );
    const { isAuthenticated } = useOxy();
    const { data: user } = useCurrentUser({ enabled: isAuthenticated });
    const updateMutation = useUpdateNotificationPreferences();

    const initialValues = useMemo<NotificationToggleValues>(() => {
        const prefs = user?.notificationPreferences;
        return {
            pushEnabled: prefs?.pushEnabled ?? DEFAULT_VALUES.pushEnabled,
            emailDigest: prefs?.emailDigest ?? DEFAULT_VALUES.emailDigest,
            securityAlerts: prefs?.securityAlerts ?? DEFAULT_VALUES.securityAlerts,
            marketingEmails: prefs?.marketingEmails ?? DEFAULT_VALUES.marketingEmails,
        };
    }, [user?.notificationPreferences]);

    const handleSave = useCallback(
        async (key: keyof NotificationToggleValues, value: boolean) => {
            const patch: Partial<NotificationPreferences> = { [key]: value };
            await updateMutation.mutateAsync(patch);
        },
        [updateMutation],
    );

    const { values, toggle, savingKeys } = useSettingToggles<NotificationToggleValues>({
        initialValues,
        onSave: handleSave,
        errorMessage: t('notifications.updateError') || 'Failed to update notification preferences',
    });

    const isSaving = savingKeys.size > 0;

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <Header
                title={t('notifications.title') || 'Notifications'}
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                <SettingsListGroup
                    title={t('notifications.sections.channels') || 'Channels'}
                >
                    <SettingsListItem
                        icon={<SettingsIcon name="bell" color={palette.iconPersonalInfo} />}
                        title={t('notifications.items.push.title') || 'Push notifications'}
                        description={
                            t('notifications.items.push.subtitle')
                            || 'Real-time alerts on your devices'
                        }
                        rightElement={
                            <Switch
                                value={values.pushEnabled}
                                onValueChange={() => toggle('pushEnabled')}
                                disabled={isSaving}
                            />
                        }
                        showChevron={false}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="email" color={palette.iconData} />}
                        title={t('notifications.items.emailDigest.title') || 'Email digest'}
                        description={
                            t('notifications.items.emailDigest.subtitle')
                            || 'Periodic summary of your account activity'
                        }
                        rightElement={
                            <Switch
                                value={values.emailDigest}
                                onValueChange={() => toggle('emailDigest')}
                                disabled={isSaving}
                            />
                        }
                        showChevron={false}
                    />
                </SettingsListGroup>

                <SettingsListGroup
                    title={t('notifications.sections.alerts') || 'Alerts'}
                >
                    <SettingsListItem
                        icon={<SettingsIcon name="shield-check" color={palette.iconSecurity} />}
                        title={
                            t('notifications.items.securityAlerts.title') || 'Security alerts'
                        }
                        description={
                            t('notifications.items.securityAlerts.subtitle')
                            || 'Sign-ins, recovery codes, and key changes'
                        }
                        rightElement={
                            <Switch
                                value={values.securityAlerts}
                                onValueChange={() => toggle('securityAlerts')}
                                disabled={isSaving}
                            />
                        }
                        showChevron={false}
                    />
                </SettingsListGroup>

                <SettingsListGroup
                    title={t('notifications.sections.marketing') || 'Marketing'}
                >
                    <SettingsListItem
                        icon={<SettingsIcon name="megaphone" color={palette.iconSharing} />}
                        title={
                            t('notifications.items.marketingEmails.title')
                            || 'Marketing emails'
                        }
                        description={
                            t('notifications.items.marketingEmails.subtitle')
                            || 'Product news and occasional offers'
                        }
                        rightElement={
                            <Switch
                                value={values.marketingEmails}
                                onValueChange={() => toggle('marketingEmails')}
                                disabled={isSaving}
                            />
                        }
                        showChevron={false}
                    />
                </SettingsListGroup>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
});

export default React.memo(NotificationsScreen);

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, ScrollView } from 'react-native';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import { Switch } from '@oxyhq/bloom/switch';
import { useTheme } from '@oxyhq/bloom/theme';
import type { UserPreferences } from '@oxyhq/core';
import type { BaseScreenProps } from '../types/navigation';
import Header from '../components/Header';
import { SettingsIcon } from '../components/SettingsIcon';
import { useI18n } from '../hooks/useI18n';
import { useOxy } from '../context/OxyContext';
import { useCurrentUser } from '../hooks/queries/useAccountQueries';
import { useUpdateUserPreferences } from '../hooks/mutations/useAccountMutations';
import { useColorScheme } from '../hooks/useColorScheme';
import { Colors } from '../constants/theme';
import { normalizeColorScheme, normalizeTheme } from '../utils/themeUtils';

type ThemePreference = 'light' | 'dark' | 'system';

const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark'];

/**
 * Resolve the device's timezone using `Intl.DateTimeFormat`. Available on
 * every Hermes/JSC build we support; no `expo-localization` native module
 * needed.
 */
const getDeviceTimezone = (): string => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        return '';
    }
};

/**
 * PreferencesScreen — general user preferences applied across all Oxy apps.
 *
 * Language is delegated to the existing LanguageSelector screen. Theme,
 * reduce-motion, and timezone are persisted on the User document via
 * `useUpdateUserPreferences` so every Oxy app sees the same setting.
 */
const PreferencesScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
}) => {
    const bloomTheme = useTheme();
    const { t, locale } = useI18n();
    const colorScheme = useColorScheme();
    const palette = useMemo(
        () => Colors[normalizeColorScheme(colorScheme, normalizeTheme(theme))],
        [colorScheme, theme],
    );
    const { isAuthenticated } = useOxy();
    const { data: user } = useCurrentUser({ enabled: isAuthenticated });
    const updateMutation = useUpdateUserPreferences();

    const prefs = user?.userPreferences;
    const themePref: ThemePreference = (prefs?.theme as ThemePreference) ?? 'system';
    const reduceMotionPref = prefs?.reduceMotion ?? false;
    const deviceTimezone = useMemo(getDeviceTimezone, []);
    const timezone = prefs?.timezone || deviceTimezone;

    // Mirror the OS reduce-motion state on first mount so users can see whether
    // the device itself is in reduced-motion mode (independent of their saved
    // server preference). Persists into the saved value when toggled.
    const [systemReduceMotion, setSystemReduceMotion] = useState<boolean>(false);
    useEffect(() => {
        let cancelled = false;
        AccessibilityInfo.isReduceMotionEnabled()
            .then((value) => {
                if (!cancelled) {
                    setSystemReduceMotion(value);
                }
            })
            .catch(() => {
                // AccessibilityInfo not available on this platform — keep default
            });
        const sub = AccessibilityInfo.addEventListener(
            'reduceMotionChanged',
            (value) => setSystemReduceMotion(value),
        );
        return () => {
            cancelled = true;
            sub.remove();
        };
    }, []);

    const handleThemeChange = useCallback(
        async (nextTheme: ThemePreference) => {
            const patch: Partial<UserPreferences> = { theme: nextTheme };
            await updateMutation.mutateAsync(patch);
        },
        [updateMutation],
    );

    const handleReduceMotionToggle = useCallback(async () => {
        const next = !reduceMotionPref;
        const patch: Partial<UserPreferences> = { reduceMotion: next };
        await updateMutation.mutateAsync(patch);
    }, [reduceMotionPref, updateMutation]);

    const handleResetTimezone = useCallback(async () => {
        // Empty string means "follow device" — server-side default
        const patch: Partial<UserPreferences> = { timezone: '' };
        await updateMutation.mutateAsync(patch);
    }, [updateMutation]);

    const themeDisplay = useMemo(() => {
        switch (themePref) {
            case 'light':
                return t('preferences.theme.light') || 'Light';
            case 'dark':
                return t('preferences.theme.dark') || 'Dark';
            default:
                return t('preferences.theme.system') || 'System default';
        }
    }, [themePref, t]);

    const nextTheme: ThemePreference =
        THEME_ORDER[(THEME_ORDER.indexOf(themePref) + 1) % THEME_ORDER.length] ?? 'system';

    const languageDescription = useMemo(() => {
        if (prefs?.language) {
            return prefs.language;
        }
        return locale;
    }, [prefs?.language, locale]);

    const isSaving = updateMutation.isPending;

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <Header
                title={t('preferences.title') || 'Preferences'}
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                <SettingsListGroup
                    title={t('preferences.sections.appearance') || 'Appearance'}
                >
                    <SettingsListItem
                        icon={
                            <SettingsIcon
                                name="theme-light-dark"
                                color={palette.iconData}
                            />
                        }
                        title={t('preferences.items.theme.title') || 'Theme'}
                        description={themeDisplay}
                        onPress={() => handleThemeChange(nextTheme)}
                        disabled={isSaving}
                    />
                    <SettingsListItem
                        icon={
                            <SettingsIcon
                                name="motion"
                                color={palette.iconPersonalInfo}
                            />
                        }
                        title={
                            t('preferences.items.reduceMotion.title') || 'Reduce motion'
                        }
                        description={
                            systemReduceMotion
                                ? (t('preferences.items.reduceMotion.systemOn')
                                    || 'Following system: reduce motion is on')
                                : (t('preferences.items.reduceMotion.subtitle')
                                    || 'Minimise animations across Oxy apps')
                        }
                        rightElement={
                            <Switch
                                value={reduceMotionPref}
                                onValueChange={handleReduceMotionToggle}
                                disabled={isSaving}
                            />
                        }
                        showChevron={false}
                    />
                </SettingsListGroup>

                <SettingsListGroup
                    title={t('preferences.sections.language') || 'Language'}
                >
                    <SettingsListItem
                        icon={
                            <SettingsIcon
                                name="translate"
                                color={palette.iconPersonalInfo}
                            />
                        }
                        title={t('preferences.items.language.title') || 'Language'}
                        description={languageDescription}
                        onPress={() => navigate?.('LanguageSelector')}
                    />
                </SettingsListGroup>

                <SettingsListGroup
                    title={t('preferences.sections.region') || 'Region'}
                >
                    <SettingsListItem
                        icon={
                            <SettingsIcon
                                name="clock-outline"
                                color={palette.iconSecurity}
                            />
                        }
                        title={t('preferences.items.timezone.title') || 'Timezone'}
                        description={
                            timezone
                            || (t('preferences.items.timezone.unknown')
                                || 'Unable to detect timezone')
                        }
                        onPress={prefs?.timezone ? handleResetTimezone : undefined}
                        disabled={isSaving || !prefs?.timezone}
                        showChevron={false}
                    />
                </SettingsListGroup>

                {Platform.OS === 'web' ? null : (
                    <SettingsListGroup>
                        <SettingsListItem
                            icon={
                                <SettingsIcon
                                    name="information"
                                    color={palette.iconHome}
                                />
                            }
                            title={
                                t('preferences.items.about.title')
                                || 'About preferences'
                            }
                            description={
                                t('preferences.items.about.subtitle')
                                || 'Preferences sync across every Oxy app you sign into'
                            }
                            showChevron={false}
                            disabled
                        />
                    </SettingsListGroup>
                )}
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

export default React.memo(PreferencesScreen);

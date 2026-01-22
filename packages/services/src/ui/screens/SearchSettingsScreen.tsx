import React, { useState, useEffect } from 'react';
import {
    View,
    StyleSheet,
    ScrollView,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { Header, Section, LoadingState, SettingRow } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useSettingToggles } from '../hooks/useSettingToggle';
import { normalizeTheme } from '../utils/themeUtils';
import { useOxy } from '../context/OxyContext';
import type { User } from '../../models/interfaces';

interface SearchSettings {
    safeSearch: boolean;
    searchPersonalization: boolean;
}

const SearchSettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    const { oxyServices, user } = useOxy();
    const { t } = useI18n();
    const [isLoading, setIsLoading] = useState(true);

    // Use the existing useSettingToggles hook for toggle management
    const { values: settings, toggle, savingKeys, setValues } = useSettingToggles<SearchSettings>({
        initialValues: { safeSearch: false, searchPersonalization: true },
        onSave: async (key, value) => {
            if (!user?.id || !oxyServices) return;

            const fieldMap: Record<keyof SearchSettings, string> = {
                safeSearch: 'autoFilter',
                searchPersonalization: 'dataSharing',
            };

            await oxyServices.updateProfile({
                privacySettings: {
                    [fieldMap[key]]: value,
                },
            });
        },
        errorMessage: (key) => t(`searchSettings.${key}.error`) || `Failed to update ${key}`,
    });

    const isSaving = savingKeys.size > 0;

    // Load initial settings
    useEffect(() => {
        const loadSettings = async () => {
            try {
                setIsLoading(true);
                if (user?.id && oxyServices) {
                    const userData = await oxyServices.getCurrentUser() as User & { privacySettings?: { autoFilter?: boolean; dataSharing?: boolean } };
                    const privacySettings = userData?.privacySettings || {};

                    setValues({
                        safeSearch: privacySettings.autoFilter ?? false,
                        searchPersonalization: privacySettings.dataSharing ?? true,
                    });
                }
            } catch (error) {
                console.error('Failed to load search settings:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadSettings();
    }, [user?.id, oxyServices, setValues]);

    const normalizedTheme = normalizeTheme(theme);
    const themeStyles = useThemeStyles(normalizedTheme);

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
                <Header
                    title={t('searchSettings.title') || 'Search Settings'}
                    onBack={goBack || onClose}
                    variant="minimal"
                    elevation="subtle"
                />
                <LoadingState color={themeStyles.textColor} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <Header
                title={t('searchSettings.title') || 'Search Settings'}

                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                {/* SafeSearch */}
                <Section title={t('searchSettings.safeSearch.title') || 'SafeSearch'} isFirst={true}>
                    <SettingRow
                        title={t('searchSettings.safeSearch.label') || 'Enable SafeSearch'}
                        description={t('searchSettings.safeSearch.description') || 'Filter out explicit content from search results'}
                        value={settings.safeSearch}
                        onValueChange={() => toggle('safeSearch')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                </Section>

                {/* Search Personalization */}
                <Section title={t('searchSettings.personalization.title') || 'Search Personalization'}>
                    <SettingRow
                        title={t('searchSettings.personalization.label') || 'Personalized Search'}
                        description={t('searchSettings.personalization.description') || 'Use your activity to improve search results'}
                        value={settings.searchPersonalization}
                        onValueChange={() => toggle('searchPersonalization')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                </Section>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        padding: 16,
    },
});

export default React.memo(SearchSettingsScreen);


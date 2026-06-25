import React, { useState, useEffect } from 'react';
import { View, ScrollView } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import Header from '../components/Header';
import LoadingState from '../components/LoadingState';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import { Switch } from '@oxyhq/bloom/switch';
import { useTheme } from '@oxyhq/bloom/theme';
import { SettingsIcon } from '../components/SettingsIcon';
import { useI18n } from '../hooks/useI18n';
import { useSettingToggles } from '../hooks/useSettingToggle';
import { useOxy } from '../context/OxyContext';
import type { User } from '@oxyhq/core';

interface SearchSettings {
    safeSearch: boolean;
    searchPersonalization: boolean;
}

const SearchSettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    goBack,
}) => {
    const { oxyServices, user } = useOxy();
    const { t } = useI18n();
    const bloomTheme = useTheme();
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
                if (__DEV__) {
                    console.error('Failed to load search settings:', error);
                }
            } finally {
                setIsLoading(false);
            }
        };

        loadSettings();
    }, [user?.id, oxyServices, setValues]);

    if (isLoading) {
        return (
            <View className="flex-1 bg-bg">
                <Header
                    title={t('searchSettings.title') || 'Search Settings'}
                    onBack={goBack || onClose}
                    variant="minimal"
                    elevation="subtle"
                />
                <LoadingState color={bloomTheme.colors.text} />
            </View>
        );
    }

    return (
        <View className="flex-1 bg-bg">
            <Header
                title={t('searchSettings.title') || 'Search Settings'}
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView className="flex-1">
                <View className="px-screen-margin pb-space-24">
                    {/* SafeSearch */}
                    <SettingsListGroup title={t('searchSettings.safeSearch.title') || 'SafeSearch'}>
                        <SettingsListItem
                            icon={
                                <SettingsIcon
                                    name="shield-search"
                                    color={bloomTheme.colors.success}
                                />
                            }
                            title={t('searchSettings.safeSearch.label') || 'Enable SafeSearch'}
                            description={t('searchSettings.safeSearch.description') || 'Filter out explicit content from search results'}
                            rightElement={
                                <Switch
                                    value={settings.safeSearch}
                                    onValueChange={() => toggle('safeSearch')}
                                    disabled={isSaving}
                                />
                            }
                            showChevron={false}
                        />
                    </SettingsListGroup>

                    {/* Search Personalization */}
                    <SettingsListGroup title={t('searchSettings.personalization.title') || 'Search Personalization'}>
                        <SettingsListItem
                            icon={
                                <SettingsIcon
                                    name="account-search"
                                    color={bloomTheme.colors.primary}
                                />
                            }
                            title={t('searchSettings.personalization.label') || 'Personalized Search'}
                            description={t('searchSettings.personalization.description') || 'Use your activity to improve search results'}
                            rightElement={
                                <Switch
                                    value={settings.searchPersonalization}
                                    onValueChange={() => toggle('searchPersonalization')}
                                    disabled={isSaving}
                                />
                            }
                            showChevron={false}
                        />
                    </SettingsListGroup>
                </View>
            </ScrollView>
        </View>
    );
};

export default React.memo(SearchSettingsScreen);

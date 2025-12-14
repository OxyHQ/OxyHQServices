import React, { useState, useCallback, useEffect } from 'react';
import {
    View,
    StyleSheet,
    ScrollView,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '../../lib/sonner';
import { Header, Section, LoadingState, SettingRow } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { normalizeTheme } from '../utils/themeUtils';
import { useOxy } from '../context/OxyContext';

const SearchSettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    // Use useOxy() hook for OxyContext values
    const { oxyServices, user } = useOxy();
    const { t } = useI18n();
    const [safeSearch, setSafeSearch] = useState(false);
    const [searchPersonalization, setSearchPersonalization] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Load settings
    useEffect(() => {
        const loadSettings = async () => {
            try {
                setIsLoading(true);
                if (user?.id && oxyServices) {
                    // Load from user's privacy settings
                    const userData = await oxyServices.getCurrentUser();
                    const privacySettings = (userData as any)?.privacySettings || {};

                    // SafeSearch is typically stored in privacySettings.autoFilter or a separate field
                    setSafeSearch(privacySettings.autoFilter ?? false);
                    setSearchPersonalization(privacySettings.dataSharing ?? true);
                }
            } catch (error) {
                console.error('Failed to load search settings:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadSettings();
    }, [user?.id, oxyServices]);

    const handleSafeSearchToggle = useCallback(async (value: boolean) => {
        try {
            setIsSaving(true);
            setSafeSearch(value);

            if (user?.id && oxyServices) {
                // Update privacy settings
                await oxyServices.updateProfile({
                    privacySettings: {
                        autoFilter: value,
                    },
                });
                toast.success(t('searchSettings.safeSearch.updated') || 'SafeSearch setting updated');
            }
        } catch (error) {
            console.error('Failed to update SafeSearch:', error);
            toast.error(t('searchSettings.safeSearch.error') || 'Failed to update SafeSearch');
            setSafeSearch(!value); // Revert on error
        } finally {
            setIsSaving(false);
        }
    }, [user?.id, oxyServices, t]);

    const handlePersonalizationToggle = useCallback(async (value: boolean) => {
        try {
            setIsSaving(true);
            setSearchPersonalization(value);

            if (user?.id && oxyServices) {
                // Update privacy settings
                await oxyServices.updateProfile({
                    privacySettings: {
                        dataSharing: value,
                    },
                });
                toast.success(t('searchSettings.personalization.updated') || 'Search personalization updated');
            }
        } catch (error) {
            console.error('Failed to update personalization:', error);
            toast.error(t('searchSettings.personalization.error') || 'Failed to update personalization');
            setSearchPersonalization(!value); // Revert on error
        } finally {
            setIsSaving(false);
        }
    }, [user?.id, oxyServices, t]);

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
                        value={safeSearch}
                        onValueChange={handleSafeSearchToggle}
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
                        value={searchPersonalization}
                        onValueChange={handlePersonalizationToggle}
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


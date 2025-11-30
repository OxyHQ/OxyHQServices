import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Switch,
    ActivityIndicator,
} from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { toast } from '../../lib/sonner';
import { Header, Section, GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';

const SearchSettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
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

    const themeStyles = useMemo(() => {
        const isDarkTheme = theme === 'dark';
        return {
            textColor: isDarkTheme ? '#FFFFFF' : '#000000',
            backgroundColor: isDarkTheme ? '#121212' : '#FFFFFF',
            secondaryBackgroundColor: isDarkTheme ? '#222222' : '#F5F5F5',
            borderColor: isDarkTheme ? '#444444' : '#E0E0E0',
        };
    }, [theme]);

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
                <Header
                    title={t('searchSettings.title') || 'Search Settings'}
                    
                    onBack={goBack || onClose}
                    variant="minimal"
                    elevation="subtle"
                />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={themeStyles.textColor} />
                </View>
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
                <Section title={t('searchSettings.safeSearch.title') || 'SafeSearch'}  isFirst={true}>
                    <View style={[styles.settingRow, { borderBottomColor: themeStyles.borderColor }]}>
                        <View style={styles.settingInfo}>
                            <Text style={[styles.settingTitle, { color: themeStyles.textColor }]}>
                                {t('searchSettings.safeSearch.label') || 'Enable SafeSearch'}
                            </Text>
                            <Text style={[styles.settingDescription, { color: themeStyles.textColor }]}>
                                {t('searchSettings.safeSearch.description') || 'Filter out explicit content from search results'}
                            </Text>
                        </View>
                        <Switch
                            value={safeSearch}
                            onValueChange={handleSafeSearchToggle}
                            disabled={isSaving}
                            trackColor={{ false: '#767577', true: '#d169e5' }}
                            thumbColor={safeSearch ? '#fff' : '#f4f3f4'}
                        />
                    </View>
                </Section>

                {/* Search Personalization */}
                <Section title={t('searchSettings.personalization.title') || 'Search Personalization'} >
                    <View style={[styles.settingRow, { borderBottomColor: themeStyles.borderColor }]}>
                        <View style={styles.settingInfo}>
                            <Text style={[styles.settingTitle, { color: themeStyles.textColor }]}>
                                {t('searchSettings.personalization.label') || 'Personalized Search'}
                            </Text>
                            <Text style={[styles.settingDescription, { color: themeStyles.textColor }]}>
                                {t('searchSettings.personalization.description') || 'Use your activity to improve search results'}
                            </Text>
                        </View>
                        <Switch
                            value={searchPersonalization}
                            onValueChange={handlePersonalizationToggle}
                            disabled={isSaving}
                            trackColor={{ false: '#767577', true: '#d169e5' }}
                            thumbColor={searchPersonalization ? '#fff' : '#f4f3f4'}
                        />
                    </View>
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
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    settingRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    settingInfo: {
        flex: 1,
        marginRight: 16,
    },
    settingTitle: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 4,
    },
    settingDescription: {
        fontSize: 14,
        opacity: 0.7,
    },
});

export default React.memo(SearchSettingsScreen);


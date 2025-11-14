import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Switch,
    ActivityIndicator,
} from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { toast } from '../../lib/sonner';
import { Header, Section } from '../components';
import { useI18n } from '../hooks/useI18n';

interface PrivacySettings {
    isPrivateAccount: boolean;
    hideOnlineStatus: boolean;
    hideLastSeen: boolean;
    profileVisibility: boolean;
    twoFactorEnabled: boolean;
    loginAlerts: boolean;
    blockScreenshots: boolean;
    login: boolean;
    biometricLogin: boolean;
    showActivity: boolean;
    allowTagging: boolean;
    allowMentions: boolean;
    hideReadReceipts: boolean;
    allowDirectMessages: boolean;
    dataSharing: boolean;
    locationSharing: boolean;
    analyticsSharing: boolean;
    sensitiveContent: boolean;
    autoFilter: boolean;
    muteKeywords: boolean;
}

const PrivacySettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    const { oxyServices, user } = useOxy();
    const { t } = useI18n();
    const [settings, setSettings] = useState<PrivacySettings>({
        isPrivateAccount: false,
        hideOnlineStatus: false,
        hideLastSeen: false,
        profileVisibility: true,
        twoFactorEnabled: false,
        loginAlerts: true,
        blockScreenshots: false,
        login: true,
        biometricLogin: false,
        showActivity: true,
        allowTagging: true,
        allowMentions: true,
        hideReadReceipts: false,
        allowDirectMessages: true,
        dataSharing: true,
        locationSharing: false,
        analyticsSharing: true,
        sensitiveContent: false,
        autoFilter: true,
        muteKeywords: false,
    });
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Load settings
    useEffect(() => {
        const loadSettings = async () => {
            try {
                setIsLoading(true);
                if (user?.id && oxyServices) {
                    const privacySettings = await oxyServices.getPrivacySettings(user.id);
                    if (privacySettings) {
                        setSettings(privacySettings);
                    }
                }
            } catch (error) {
                console.error('Failed to load privacy settings:', error);
                toast.error(t('privacySettings.loadError') || 'Failed to load privacy settings');
            } finally {
                setIsLoading(false);
            }
        };

        loadSettings();
    }, [user?.id, oxyServices, t]);

    const updateSetting = useCallback(async (key: keyof PrivacySettings, value: boolean) => {
        try {
            setIsSaving(true);
            const newSettings = { ...settings, [key]: value };
            setSettings(newSettings);
            
            if (user?.id && oxyServices) {
                await oxyServices.updatePrivacySettings({ [key]: value }, user.id);
                toast.success(t('privacySettings.updated') || 'Privacy settings updated');
            }
        } catch (error) {
            console.error(`Failed to update ${key}:`, error);
            toast.error(t('privacySettings.updateError') || 'Failed to update privacy setting');
            // Revert on error
            setSettings(settings);
        } finally {
            setIsSaving(false);
        }
    }, [settings, user?.id, oxyServices, t]);

    const themeStyles = useMemo(() => {
        const isDarkTheme = theme === 'dark';
        return {
            textColor: isDarkTheme ? '#FFFFFF' : '#000000',
            backgroundColor: isDarkTheme ? '#121212' : '#FFFFFF',
            secondaryBackgroundColor: isDarkTheme ? '#222222' : '#F5F5F5',
            borderColor: isDarkTheme ? '#444444' : '#E0E0E0',
            mutedTextColor: isDarkTheme ? '#8E8E93' : '#8E8E93',
        };
    }, [theme]);

    const SettingRow: React.FC<{
        title: string;
        description?: string;
        value: boolean;
        onValueChange: (value: boolean) => void;
        disabled?: boolean;
    }> = ({ title, description, value, onValueChange, disabled }) => (
        <View style={[styles.settingRow, { borderBottomColor: themeStyles.borderColor }]}>
            <View style={styles.settingInfo}>
                <Text style={[styles.settingTitle, { color: themeStyles.textColor }]}>
                    {title}
                </Text>
                {description && (
                    <Text style={[styles.settingDescription, { color: themeStyles.mutedTextColor }]}>
                        {description}
                    </Text>
                )}
            </View>
            <Switch
                value={value}
                onValueChange={onValueChange}
                disabled={disabled || isSaving}
                trackColor={{ false: '#767577', true: '#d169e5' }}
                thumbColor={value ? '#fff' : '#f4f3f4'}
            />
        </View>
    );

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
                <Header
                    title={t('privacySettings.title') || 'Privacy Settings'}
                    theme={theme}
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
                title={t('privacySettings.title') || 'Privacy Settings'}
                theme={theme}
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                {/* Account Privacy */}
                <Section title={t('privacySettings.sections.account') || 'ACCOUNT PRIVACY'} theme={theme} isFirst={true}>
                    <SettingRow
                        title={t('privacySettings.isPrivateAccount') || 'Private Account'}
                        description={t('privacySettings.isPrivateAccountDesc') || 'Only approved followers can see your posts'}
                        value={settings.isPrivateAccount}
                        onValueChange={(value) => updateSetting('isPrivateAccount', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.profileVisibility') || 'Profile Visibility'}
                        description={t('privacySettings.profileVisibilityDesc') || 'Control who can view your profile'}
                        value={settings.profileVisibility}
                        onValueChange={(value) => updateSetting('profileVisibility', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.hideOnlineStatus') || 'Hide Online Status'}
                        description={t('privacySettings.hideOnlineStatusDesc') || 'Don\'t show when you\'re online'}
                        value={settings.hideOnlineStatus}
                        onValueChange={(value) => updateSetting('hideOnlineStatus', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.hideLastSeen') || 'Hide Last Seen'}
                        description={t('privacySettings.hideLastSeenDesc') || 'Don\'t show when you were last active'}
                        value={settings.hideLastSeen}
                        onValueChange={(value) => updateSetting('hideLastSeen', value)}
                    />
                </Section>

                {/* Interactions */}
                <Section title={t('privacySettings.sections.interactions') || 'INTERACTIONS'} theme={theme}>
                    <SettingRow
                        title={t('privacySettings.allowTagging') || 'Allow Tagging'}
                        description={t('privacySettings.allowTaggingDesc') || 'Let others tag you in posts'}
                        value={settings.allowTagging}
                        onValueChange={(value) => updateSetting('allowTagging', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.allowMentions') || 'Allow Mentions'}
                        description={t('privacySettings.allowMentionsDesc') || 'Let others mention you'}
                        value={settings.allowMentions}
                        onValueChange={(value) => updateSetting('allowMentions', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.allowDirectMessages') || 'Allow Direct Messages'}
                        description={t('privacySettings.allowDirectMessagesDesc') || 'Let others send you direct messages'}
                        value={settings.allowDirectMessages}
                        onValueChange={(value) => updateSetting('allowDirectMessages', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.hideReadReceipts') || 'Hide Read Receipts'}
                        description={t('privacySettings.hideReadReceiptsDesc') || 'Don\'t show read receipts in messages'}
                        value={settings.hideReadReceipts}
                        onValueChange={(value) => updateSetting('hideReadReceipts', value)}
                    />
                </Section>

                {/* Activity & Data */}
                <Section title={t('privacySettings.sections.activity') || 'ACTIVITY & DATA'} theme={theme}>
                    <SettingRow
                        title={t('privacySettings.showActivity') || 'Show Activity Status'}
                        description={t('privacySettings.showActivityDesc') || 'Display your activity on your profile'}
                        value={settings.showActivity}
                        onValueChange={(value) => updateSetting('showActivity', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.dataSharing') || 'Data Sharing'}
                        description={t('privacySettings.dataSharingDesc') || 'Allow sharing data for personalization'}
                        value={settings.dataSharing}
                        onValueChange={(value) => updateSetting('dataSharing', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.locationSharing') || 'Location Sharing'}
                        description={t('privacySettings.locationSharingDesc') || 'Share your location'}
                        value={settings.locationSharing}
                        onValueChange={(value) => updateSetting('locationSharing', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.analyticsSharing') || 'Analytics Sharing'}
                        description={t('privacySettings.analyticsSharingDesc') || 'Allow analytics data collection'}
                        value={settings.analyticsSharing}
                        onValueChange={(value) => updateSetting('analyticsSharing', value)}
                    />
                </Section>

                {/* Content & Safety */}
                <Section title={t('privacySettings.sections.content') || 'CONTENT & SAFETY'} theme={theme}>
                    <SettingRow
                        title={t('privacySettings.sensitiveContent') || 'Show Sensitive Content'}
                        description={t('privacySettings.sensitiveContentDesc') || 'Allow sensitive or explicit content'}
                        value={settings.sensitiveContent}
                        onValueChange={(value) => updateSetting('sensitiveContent', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.autoFilter') || 'Auto Filter'}
                        description={t('privacySettings.autoFilterDesc') || 'Automatically filter inappropriate content'}
                        value={settings.autoFilter}
                        onValueChange={(value) => updateSetting('autoFilter', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.muteKeywords') || 'Mute Keywords'}
                        description={t('privacySettings.muteKeywordsDesc') || 'Hide posts containing muted keywords'}
                        value={settings.muteKeywords}
                        onValueChange={(value) => updateSetting('muteKeywords', value)}
                    />
                    <SettingRow
                        title={t('privacySettings.blockScreenshots') || 'Block Screenshots'}
                        description={t('privacySettings.blockScreenshotsDesc') || 'Prevent screenshots of your content'}
                        value={settings.blockScreenshots}
                        onValueChange={(value) => updateSetting('blockScreenshots', value)}
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

export default React.memo(PrivacySettingsScreen);


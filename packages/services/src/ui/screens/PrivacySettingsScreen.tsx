import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '../../lib/sonner';
import { Header, Section, Avatar, SettingRow, LoadingState, EmptyState, GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useSettingToggles } from '../hooks/useSettingToggle';
import { normalizeTheme } from '../utils/themeUtils';
import type { BlockedUser, RestrictedUser } from '../../models/interfaces';
import { useOxy } from '../context/OxyContext';

interface PrivacySettings {
    isPrivateAccount: boolean;
    hideOnlineStatus: boolean;
    hideLastSeen: boolean;
    profileVisibility: boolean;
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

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
    isPrivateAccount: false,
    hideOnlineStatus: false,
    hideLastSeen: false,
    profileVisibility: true,
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
};

const PrivacySettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    const { oxyServices, user } = useOxy();
    const { t } = useI18n();
    const [isLoading, setIsLoading] = useState(true);
    const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
    const [restrictedUsers, setRestrictedUsers] = useState<RestrictedUser[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);

    // Use the existing useSettingToggles hook for toggle management
    const { values: settings, toggle, savingKeys, setValues } = useSettingToggles<PrivacySettings>({
        initialValues: DEFAULT_PRIVACY_SETTINGS,
        onSave: async (key, value) => {
            if (!user?.id || !oxyServices) return;
            await oxyServices.updatePrivacySettings({ [key]: value }, user.id);
        },
        errorMessage: t('privacySettings.updateError') || 'Failed to update privacy setting',
    });

    const isSaving = savingKeys.size > 0;

    // Load settings
    useEffect(() => {
        const loadSettings = async () => {
            try {
                setIsLoading(true);
                if (user?.id && oxyServices) {
                    const privacySettings = await oxyServices.getPrivacySettings(user.id);
                    if (privacySettings) {
                        setValues(privacySettings);
                    }
                }
            } catch (error) {
                if (__DEV__) {
                    console.error('Failed to load privacy settings:', error);
                }
                toast.error(t('privacySettings.loadError') || 'Failed to load privacy settings');
            } finally {
                setIsLoading(false);
            }
        };

        loadSettings();
    }, [user?.id, oxyServices, t, setValues]);

    // Load blocked and restricted users
    useEffect(() => {
        const loadUsers = async () => {
            if (!oxyServices) return;
            try {
                setIsLoadingUsers(true);
                const [blocked, restricted] = await Promise.all([
                    oxyServices.getBlockedUsers(),
                    oxyServices.getRestrictedUsers(),
                ]);
                setBlockedUsers(blocked);
                setRestrictedUsers(restricted);
            } catch (error) {
                if (__DEV__) {
                    console.error('Failed to load blocked/restricted users:', error);
                }
            } finally {
                setIsLoadingUsers(false);
            }
        };

        loadUsers();
    }, [oxyServices]);

    const handleUnblock = useCallback(async (userId: string) => {
        if (!oxyServices) return;
        try {
            await oxyServices.unblockUser(userId);
            setBlockedUsers(prev => prev.filter(u => {
                const id = typeof u.blockedId === 'string' ? u.blockedId : u.blockedId._id;
                return id !== userId;
            }));
            toast.success(t('privacySettings.userUnblocked') || 'User unblocked');
        } catch (error) {
            if (__DEV__) {
                console.error('Failed to unblock user:', error);
            }
            toast.error(t('privacySettings.unblockError') || 'Failed to unblock user');
        }
    }, [oxyServices, t]);

    const handleUnrestrict = useCallback(async (userId: string) => {
        if (!oxyServices) return;
        try {
            await oxyServices.unrestrictUser(userId);
            setRestrictedUsers(prev => prev.filter(u => {
                const id = typeof u.restrictedId === 'string' ? u.restrictedId : u.restrictedId._id;
                return id !== userId;
            }));
            toast.success(t('privacySettings.userUnrestricted') || 'User unrestricted');
        } catch (error) {
            if (__DEV__) {
                console.error('Failed to unrestrict user:', error);
            }
            toast.error(t('privacySettings.unrestrictError') || 'Failed to unrestrict user');
        }
    }, [oxyServices, t]);

    // Helper to extract user info from blocked/restricted objects
    const extractUserInfo = useCallback((
        item: BlockedUser | RestrictedUser,
        idField: 'blockedId' | 'restrictedId'
    ) => {
        let userIdField: string | { _id: string; username?: string; avatar?: string };
        let username: string;
        let avatar: string | undefined;

        if (idField === 'blockedId' && 'blockedId' in item) {
            userIdField = item.blockedId;
            username = typeof item.blockedId === 'string'
                ? (item.username || 'Unknown')
                : (item.blockedId.username || 'Unknown');
            avatar = typeof item.blockedId === 'string' ? item.avatar : item.blockedId.avatar;
        } else if (idField === 'restrictedId' && 'restrictedId' in item) {
            userIdField = item.restrictedId;
            username = typeof item.restrictedId === 'string'
                ? (item.username || 'Unknown')
                : (item.restrictedId.username || 'Unknown');
            avatar = typeof item.restrictedId === 'string' ? item.avatar : item.restrictedId.avatar;
        } else {
            // Fallback (should not happen)
            return { userId: '', username: 'Unknown', avatar: undefined };
        }

        const userId = typeof userIdField === 'string' ? userIdField : userIdField._id;
        return { userId, username, avatar };
    }, []);

    const normalizedTheme = normalizeTheme(theme);
    const themeStyles = useThemeStyles(normalizedTheme);

    // Convert blocked users to GroupedSection items
    const blockedUserItems = useMemo(() => {
        return blockedUsers.map((blocked) => {
            const { userId, username, avatar } = extractUserInfo(blocked, 'blockedId');
            const avatarUri = avatar && oxyServices 
                ? oxyServices.getFileDownloadUrl(avatar, 'thumb') 
                : undefined;
            
            return {
                id: userId,
                title: username,
                customIcon: (
                    <Avatar
                        uri={avatarUri}
                        name={username}
                        size={40}
                    />
                ),
                customContent: (
                    <TouchableOpacity
                        onPress={() => handleUnblock(userId)}
                        style={[styles.actionButton, { backgroundColor: themeStyles.secondaryBackgroundColor }]}
                    >
                        <Text style={[styles.actionButtonText, { color: themeStyles.dangerColor }]}>
                            {t('privacySettings.unblock') || 'Unblock'}
                        </Text>
                    </TouchableOpacity>
                ),
            };
        });
    }, [blockedUsers, oxyServices, themeStyles, handleUnblock, t]);

    // Convert restricted users to GroupedSection items
    const restrictedUserItems = useMemo(() => {
        return restrictedUsers.map((restricted) => {
            const { userId, username, avatar } = extractUserInfo(restricted, 'restrictedId');
            const avatarUri = avatar && oxyServices 
                ? oxyServices.getFileDownloadUrl(avatar, 'thumb') 
                : undefined;
            
            return {
                id: userId,
                title: username,
                subtitle: t('privacySettings.restrictedDescription') || 'Limited interactions',
                customIcon: (
                    <Avatar
                        uri={avatarUri}
                        name={username}
                        size={40}
                    />
                ),
                customContent: (
                    <TouchableOpacity
                        onPress={() => handleUnrestrict(userId)}
                        style={[styles.actionButton, { backgroundColor: themeStyles.secondaryBackgroundColor }]}
                    >
                        <Text style={[styles.actionButtonText, { color: themeStyles.primaryColor }]}>
                            {t('privacySettings.unrestrict') || 'Unrestrict'}
                        </Text>
                    </TouchableOpacity>
                ),
            };
        });
    }, [restrictedUsers, oxyServices, themeStyles, handleUnrestrict, t]);

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
                <Header
                    title={t('privacySettings.title') || 'Privacy Settings'}
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
                title={t('privacySettings.title') || 'Privacy Settings'}
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                {/* Account Privacy */}
                <Section title={t('privacySettings.sections.account') || 'ACCOUNT PRIVACY'}  isFirst={true}>
                    <SettingRow
                        title={t('privacySettings.isPrivateAccount') || 'Private Account'}
                        description={t('privacySettings.isPrivateAccountDesc') || 'Only approved followers can see your posts'}
                        value={settings.isPrivateAccount}
                        onValueChange={() => toggle('isPrivateAccount')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.profileVisibility') || 'Profile Visibility'}
                        description={t('privacySettings.profileVisibilityDesc') || 'Control who can view your profile'}
                        value={settings.profileVisibility}
                        onValueChange={() => toggle('profileVisibility')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.hideOnlineStatus') || 'Hide Online Status'}
                        description={t('privacySettings.hideOnlineStatusDesc') || 'Don\'t show when you\'re online'}
                        value={settings.hideOnlineStatus}
                        onValueChange={() => toggle('hideOnlineStatus')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.hideLastSeen') || 'Hide Last Seen'}
                        description={t('privacySettings.hideLastSeenDesc') || 'Don\'t show when you were last active'}
                        value={settings.hideLastSeen}
                        onValueChange={() => toggle('hideLastSeen')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                </Section>

                {/* Interactions */}
                <Section title={t('privacySettings.sections.interactions') || 'INTERACTIONS'} >
                    <SettingRow
                        title={t('privacySettings.allowTagging') || 'Allow Tagging'}
                        description={t('privacySettings.allowTaggingDesc') || 'Let others tag you in posts'}
                        value={settings.allowTagging}
                        onValueChange={() => toggle('allowTagging')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.allowMentions') || 'Allow Mentions'}
                        description={t('privacySettings.allowMentionsDesc') || 'Let others mention you'}
                        value={settings.allowMentions}
                        onValueChange={() => toggle('allowMentions')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.allowDirectMessages') || 'Allow Direct Messages'}
                        description={t('privacySettings.allowDirectMessagesDesc') || 'Let others send you direct messages'}
                        value={settings.allowDirectMessages}
                        onValueChange={() => toggle('allowDirectMessages')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.hideReadReceipts') || 'Hide Read Receipts'}
                        description={t('privacySettings.hideReadReceiptsDesc') || 'Don\'t show read receipts in messages'}
                        value={settings.hideReadReceipts}
                        onValueChange={() => toggle('hideReadReceipts')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                </Section>

                {/* Activity & Data */}
                <Section title={t('privacySettings.sections.activity') || 'ACTIVITY & DATA'} >
                    <SettingRow
                        title={t('privacySettings.showActivity') || 'Show Activity Status'}
                        description={t('privacySettings.showActivityDesc') || 'Display your activity on your profile'}
                        value={settings.showActivity}
                        onValueChange={() => toggle('showActivity')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.dataSharing') || 'Data Sharing'}
                        description={t('privacySettings.dataSharingDesc') || 'Allow sharing data for personalization'}
                        value={settings.dataSharing}
                        onValueChange={() => toggle('dataSharing')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.locationSharing') || 'Location Sharing'}
                        description={t('privacySettings.locationSharingDesc') || 'Share your location'}
                        value={settings.locationSharing}
                        onValueChange={() => toggle('locationSharing')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.analyticsSharing') || 'Analytics Sharing'}
                        description={t('privacySettings.analyticsSharingDesc') || 'Allow analytics data collection'}
                        value={settings.analyticsSharing}
                        onValueChange={() => toggle('analyticsSharing')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                </Section>

                {/* Content & Safety */}
                <Section title={t('privacySettings.sections.content') || 'CONTENT & SAFETY'} >
                    <SettingRow
                        title={t('privacySettings.sensitiveContent') || 'Show Sensitive Content'}
                        description={t('privacySettings.sensitiveContentDesc') || 'Allow sensitive or explicit content'}
                        value={settings.sensitiveContent}
                        onValueChange={() => toggle('sensitiveContent')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.autoFilter') || 'Auto Filter'}
                        description={t('privacySettings.autoFilterDesc') || 'Automatically filter inappropriate content'}
                        value={settings.autoFilter}
                        onValueChange={() => toggle('autoFilter')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.muteKeywords') || 'Mute Keywords'}
                        description={t('privacySettings.muteKeywordsDesc') || 'Hide posts containing muted keywords'}
                        value={settings.muteKeywords}
                        onValueChange={() => toggle('muteKeywords')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                    <SettingRow
                        title={t('privacySettings.blockScreenshots') || 'Block Screenshots'}
                        description={t('privacySettings.blockScreenshotsDesc') || 'Prevent screenshots of your content'}
                        value={settings.blockScreenshots}
                        onValueChange={() => toggle('blockScreenshots')}
                        disabled={isSaving}
                        textColor={themeStyles.textColor}
                        mutedTextColor={themeStyles.mutedTextColor}
                        borderColor={themeStyles.borderColor}
                    />
                </Section>

                {/* Blocked Users */}
                <Section title={t('privacySettings.sections.blockedUsers') || 'BLOCKED USERS'}>
                    {isLoadingUsers ? (
                        <LoadingState color={themeStyles.textColor} size="small" />
                    ) : blockedUsers.length === 0 ? (
                        <EmptyState
                            message={t('privacySettings.noBlockedUsers') || 'No blocked users'}
                            textColor={themeStyles.mutedTextColor}
                        />
                    ) : (
                        <GroupedSection items={blockedUserItems} />
                    )}
                </Section>

                {/* Restricted Users */}
                <Section title={t('privacySettings.sections.restrictedUsers') || 'RESTRICTED USERS'}>
                    {isLoadingUsers ? (
                        <LoadingState color={themeStyles.textColor} size="small" />
                    ) : restrictedUsers.length === 0 ? (
                        <EmptyState
                            message={t('privacySettings.noRestrictedUsers') || 'No restricted users'}
                            textColor={themeStyles.mutedTextColor}
                        />
                    ) : (
                        <GroupedSection items={restrictedUserItems} />
                    )}
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
    actionButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
    },
    actionButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
});

export default React.memo(PrivacySettingsScreen);


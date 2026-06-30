import React, { useState, useCallback, useEffect } from 'react';
import { View, ScrollView } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '@oxyhq/bloom';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import { Switch } from '@oxyhq/bloom/switch';
import { Button } from '@oxyhq/bloom/button';
import { useTheme } from '@oxyhq/bloom/theme';
import Header from '../components/Header';
import Avatar from '../components/Avatar';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import { SettingsIcon } from '../components/SettingsIcon';
import { useI18n } from '../hooks/useI18n';
import { useSettingToggles } from '../hooks/useSettingToggle';
import type { BlockedUser, RestrictedUser } from '@oxyhq/core';
import { getAccountDisplayName } from '@oxyhq/core';
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
    goBack,
}) => {
    // Privacy settings belong to the ACTIVE account (the org/project/bot when
    // switched, else the personal user).
    const { oxyServices, activeAccount } = useOxy();
    const { t, locale } = useI18n();
    const bloomTheme = useTheme();
    const [isLoading, setIsLoading] = useState(true);
    const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
    const [restrictedUsers, setRestrictedUsers] = useState<RestrictedUser[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);

    // Use the existing useSettingToggles hook for toggle management
    const { values: settings, toggle, savingKeys, setValues } = useSettingToggles<PrivacySettings>({
        initialValues: DEFAULT_PRIVACY_SETTINGS,
        onSave: async (key, value) => {
            if (!activeAccount?.id || !oxyServices) return;
            await oxyServices.updatePrivacySettings({ [key]: value }, activeAccount.id);
        },
        errorMessage: t('privacySettings.updateError') || 'Failed to update privacy setting',
    });

    const isSaving = savingKeys.size > 0;

    // Load settings
    useEffect(() => {
        const loadSettings = async () => {
            try {
                setIsLoading(true);
                if (activeAccount?.id && oxyServices) {
                    const privacySettings = await oxyServices.getPrivacySettings(activeAccount.id);
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
    }, [activeAccount?.id, oxyServices, t, setValues]);

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
        // Re-load when the active account changes so the block/restrict lists
        // reflect the account currently switched into (they resolve via the
        // X-Acting-As header).
    }, [oxyServices, activeAccount?.id]);

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

    // Helper to extract user info from blocked/restricted objects.
    // Display names go through the canonical helper so the fallback chain is
    // identical across every UI surface (name → username → publicKey → "Unnamed").
    const extractUserInfo = useCallback((
        item: BlockedUser | RestrictedUser,
        idField: 'blockedId' | 'restrictedId'
    ) => {
        let userIdField: string | { _id: string; username?: string; avatar?: string };
        let userShape: { username?: string };
        let avatar: string | undefined;

        if (idField === 'blockedId' && 'blockedId' in item) {
            userIdField = item.blockedId;
            userShape = typeof item.blockedId === 'string'
                ? { username: item.username }
                : { username: item.blockedId.username };
            avatar = typeof item.blockedId === 'string' ? item.avatar : item.blockedId.avatar;
        } else if (idField === 'restrictedId' && 'restrictedId' in item) {
            userIdField = item.restrictedId;
            userShape = typeof item.restrictedId === 'string'
                ? { username: item.username }
                : { username: item.restrictedId.username };
            avatar = typeof item.restrictedId === 'string' ? item.avatar : item.restrictedId.avatar;
        } else {
            return { userId: '', displayName: getAccountDisplayName(null, locale), avatar: undefined };
        }

        const userId = typeof userIdField === 'string' ? userIdField : userIdField._id;
        return { userId, displayName: getAccountDisplayName(userShape, locale), avatar };
    }, [locale]);

    if (isLoading) {
        return (
            <View className="flex-1 bg-bg">
                <Header
                    title={t('privacySettings.title') || 'Privacy Settings'}
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
                title={t('privacySettings.title') || 'Privacy Settings'}
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView className="flex-1">
                <View className="px-screen-margin pb-space-24">
                    {/* Account Privacy */}
                    <SettingsListGroup title={t('privacySettings.sections.account') || 'ACCOUNT PRIVACY'}>
                        <SettingsListItem
                            icon={<SettingsIcon name="lock-outline" color={bloomTheme.colors.primary} />}
                            title={t('privacySettings.isPrivateAccount') || 'Private Account'}
                            description={t('privacySettings.isPrivateAccountDesc') || 'Only approved followers can see your posts'}
                            rightElement={<Switch value={settings.isPrivateAccount} onValueChange={() => toggle('isPrivateAccount')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="account-eye-outline" color={bloomTheme.colors.info} />}
                            title={t('privacySettings.profileVisibility') || 'Profile Visibility'}
                            description={t('privacySettings.profileVisibilityDesc') || 'Control who can view your profile'}
                            rightElement={<Switch value={settings.profileVisibility} onValueChange={() => toggle('profileVisibility')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="circle-outline" color={bloomTheme.colors.success} />}
                            title={t('privacySettings.hideOnlineStatus') || 'Hide Online Status'}
                            description={t('privacySettings.hideOnlineStatusDesc') || 'Don\'t show when you\'re online'}
                            rightElement={<Switch value={settings.hideOnlineStatus} onValueChange={() => toggle('hideOnlineStatus')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="clock-outline" color={bloomTheme.colors.secondary} />}
                            title={t('privacySettings.hideLastSeen') || 'Hide Last Seen'}
                            description={t('privacySettings.hideLastSeenDesc') || 'Don\'t show when you were last active'}
                            rightElement={<Switch value={settings.hideLastSeen} onValueChange={() => toggle('hideLastSeen')} disabled={isSaving} />}
                            showChevron={false}
                        />
                    </SettingsListGroup>

                    {/* Interactions */}
                    <SettingsListGroup title={t('privacySettings.sections.interactions') || 'INTERACTIONS'}>
                        <SettingsListItem
                            icon={<SettingsIcon name="tag-outline" color={bloomTheme.colors.primary} />}
                            title={t('privacySettings.allowTagging') || 'Allow Tagging'}
                            description={t('privacySettings.allowTaggingDesc') || 'Let others tag you in posts'}
                            rightElement={<Switch value={settings.allowTagging} onValueChange={() => toggle('allowTagging')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="at" color={bloomTheme.colors.info} />}
                            title={t('privacySettings.allowMentions') || 'Allow Mentions'}
                            description={t('privacySettings.allowMentionsDesc') || 'Let others mention you'}
                            rightElement={<Switch value={settings.allowMentions} onValueChange={() => toggle('allowMentions')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="message-outline" color={bloomTheme.colors.success} />}
                            title={t('privacySettings.allowDirectMessages') || 'Allow Direct Messages'}
                            description={t('privacySettings.allowDirectMessagesDesc') || 'Let others send you direct messages'}
                            rightElement={<Switch value={settings.allowDirectMessages} onValueChange={() => toggle('allowDirectMessages')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="check-all" color={bloomTheme.colors.secondary} />}
                            title={t('privacySettings.hideReadReceipts') || 'Hide Read Receipts'}
                            description={t('privacySettings.hideReadReceiptsDesc') || 'Don\'t show read receipts in messages'}
                            rightElement={<Switch value={settings.hideReadReceipts} onValueChange={() => toggle('hideReadReceipts')} disabled={isSaving} />}
                            showChevron={false}
                        />
                    </SettingsListGroup>

                    {/* Activity & Data */}
                    <SettingsListGroup title={t('privacySettings.sections.activity') || 'ACTIVITY & DATA'}>
                        <SettingsListItem
                            icon={<SettingsIcon name="pulse" color={bloomTheme.colors.primary} />}
                            title={t('privacySettings.showActivity') || 'Show Activity Status'}
                            description={t('privacySettings.showActivityDesc') || 'Display your activity on your profile'}
                            rightElement={<Switch value={settings.showActivity} onValueChange={() => toggle('showActivity')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="database-outline" color={bloomTheme.colors.info} />}
                            title={t('privacySettings.dataSharing') || 'Data Sharing'}
                            description={t('privacySettings.dataSharingDesc') || 'Allow sharing data for personalization'}
                            rightElement={<Switch value={settings.dataSharing} onValueChange={() => toggle('dataSharing')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="map-marker-outline" color={bloomTheme.colors.warning} />}
                            title={t('privacySettings.locationSharing') || 'Location Sharing'}
                            description={t('privacySettings.locationSharingDesc') || 'Share your location'}
                            rightElement={<Switch value={settings.locationSharing} onValueChange={() => toggle('locationSharing')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="chart-line" color={bloomTheme.colors.secondary} />}
                            title={t('privacySettings.analyticsSharing') || 'Analytics Sharing'}
                            description={t('privacySettings.analyticsSharingDesc') || 'Allow analytics data collection'}
                            rightElement={<Switch value={settings.analyticsSharing} onValueChange={() => toggle('analyticsSharing')} disabled={isSaving} />}
                            showChevron={false}
                        />
                    </SettingsListGroup>

                    {/* Content & Safety */}
                    <SettingsListGroup title={t('privacySettings.sections.content') || 'CONTENT & SAFETY'}>
                        <SettingsListItem
                            icon={<SettingsIcon name="eye-off-outline" color={bloomTheme.colors.warning} />}
                            title={t('privacySettings.sensitiveContent') || 'Show Sensitive Content'}
                            description={t('privacySettings.sensitiveContentDesc') || 'Allow sensitive or explicit content'}
                            rightElement={<Switch value={settings.sensitiveContent} onValueChange={() => toggle('sensitiveContent')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="filter-outline" color={bloomTheme.colors.success} />}
                            title={t('privacySettings.autoFilter') || 'Auto Filter'}
                            description={t('privacySettings.autoFilterDesc') || 'Automatically filter inappropriate content'}
                            rightElement={<Switch value={settings.autoFilter} onValueChange={() => toggle('autoFilter')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="volume-off" color={bloomTheme.colors.info} />}
                            title={t('privacySettings.muteKeywords') || 'Mute Keywords'}
                            description={t('privacySettings.muteKeywordsDesc') || 'Hide posts containing muted keywords'}
                            rightElement={<Switch value={settings.muteKeywords} onValueChange={() => toggle('muteKeywords')} disabled={isSaving} />}
                            showChevron={false}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="cellphone-screenshot" color={bloomTheme.colors.secondary} />}
                            title={t('privacySettings.blockScreenshots') || 'Block Screenshots'}
                            description={t('privacySettings.blockScreenshotsDesc') || 'Prevent screenshots of your content'}
                            rightElement={<Switch value={settings.blockScreenshots} onValueChange={() => toggle('blockScreenshots')} disabled={isSaving} />}
                            showChevron={false}
                        />
                    </SettingsListGroup>

                    {/* Blocked Users */}
                    <SettingsListGroup title={t('privacySettings.sections.blockedUsers') || 'BLOCKED USERS'}>
                        {isLoadingUsers ? (
                            <LoadingState color={bloomTheme.colors.text} size="small" />
                        ) : blockedUsers.length === 0 ? (
                            <EmptyState
                                message={t('privacySettings.noBlockedUsers') || 'No blocked users'}
                                textColor={bloomTheme.colors.textSecondary}
                            />
                        ) : (
                            blockedUsers.map((blocked) => {
                                const { userId, displayName, avatar } = extractUserInfo(blocked, 'blockedId');
                                const avatarUri = avatar && oxyServices ? oxyServices.getFileDownloadUrl(avatar, 'thumb') : undefined;
                                return (
                                    <SettingsListItem
                                        key={userId}
                                        icon={<Avatar uri={avatarUri} name={displayName} size={20} />}
                                        title={displayName}
                                        rightElement={
                                            <Button
                                                variant="destructive"
                                                size="small"
                                                onPress={() => handleUnblock(userId)}
                                            >
                                                {t('privacySettings.unblock') || 'Unblock'}
                                            </Button>
                                        }
                                        showChevron={false}
                                    />
                                );
                            })
                        )}
                    </SettingsListGroup>

                    {/* Restricted Users */}
                    <SettingsListGroup title={t('privacySettings.sections.restrictedUsers') || 'RESTRICTED USERS'}>
                        {isLoadingUsers ? (
                            <LoadingState color={bloomTheme.colors.text} size="small" />
                        ) : restrictedUsers.length === 0 ? (
                            <EmptyState
                                message={t('privacySettings.noRestrictedUsers') || 'No restricted users'}
                                textColor={bloomTheme.colors.textSecondary}
                            />
                        ) : (
                            restrictedUsers.map((restricted) => {
                                const { userId, displayName, avatar } = extractUserInfo(restricted, 'restrictedId');
                                const avatarUri = avatar && oxyServices ? oxyServices.getFileDownloadUrl(avatar, 'thumb') : undefined;
                                return (
                                    <SettingsListItem
                                        key={userId}
                                        icon={<Avatar uri={avatarUri} name={displayName} size={20} />}
                                        title={displayName}
                                        description={t('privacySettings.restrictedDescription') || 'Limited interactions'}
                                        rightElement={
                                            <Button
                                                variant="secondary"
                                                size="small"
                                                onPress={() => handleUnrestrict(userId)}
                                            >
                                                {t('privacySettings.unrestrict') || 'Unrestrict'}
                                            </Button>
                                        }
                                        showChevron={false}
                                    />
                                );
                            })
                        )}
                    </SettingsListGroup>
                </View>
            </ScrollView>
        </View>
    );
};

export default React.memo(PrivacySettingsScreen);

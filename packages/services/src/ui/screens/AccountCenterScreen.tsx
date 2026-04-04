import type React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Platform,
} from 'react-native';
import { useCallback, useMemo } from 'react';
import type { BaseScreenProps } from '../types/navigation';
import { packageInfo } from '@oxyhq/core';
import { toast } from '../../lib/sonner';
import { fontFamilies } from '../styles/fonts';
import * as Prompt from '@oxyhq/bloom/prompt';
import { usePromptControl } from '@oxyhq/bloom/prompt';
import ProfileCard from '../components/ProfileCard';
import Section from '../components/Section';
import QuickActions from '../components/QuickActions';
import { SettingsIcon } from '../components/SettingsIcon';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useColorScheme } from '../hooks/useColorScheme';
import { Colors } from '../constants/theme';
import { normalizeColorScheme, normalizeTheme } from '../utils/themeUtils';
import { useOxy } from '../context/OxyContext';
import { screenContentStyle } from '../constants/spacing';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';

const AccountCenterScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
}) => {
    const { user, logout, isLoading, sessions, isAuthenticated, managedAccounts } = useOxy();
    const { t } = useI18n();
    const bloomTheme = useTheme();
    const colorScheme = useColorScheme();
    const normalizedTheme = normalizeTheme(theme);
    const dangerColor = bloomTheme.colors.error;
    const colors = Colors[normalizeColorScheme(colorScheme, normalizedTheme)];
    const logoutPrompt = usePromptControl();

    const handleLogout = useCallback(async () => {
        try {
            await logout();
            if (onClose) {
                onClose();
            }
        } catch (error) {
            if (__DEV__) {
                console.error('Logout failed:', error);
            }
            toast.error(t('common.errors.signOutFailed') || 'There was a problem signing you out. Please try again.');
        }
    }, [logout, onClose, t]);

    if (!isAuthenticated) {
        return (
            <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
                <Text style={styles.message} className="text-foreground">{t('common.status.notSignedIn') || 'Not signed in'}</Text>
            </View>
        );
    }

    if (isLoading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', backgroundColor: bloomTheme.colors.background }]}>
                <ActivityIndicator size="large" color={bloomTheme.colors.primary} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            {user && (
                <ProfileCard
                    user={user}
                    theme={normalizedTheme}
                    onEditPress={() => navigate?.('AccountSettings', { activeTab: 'profile' })}
                    onClosePress={onClose}
                    showCloseButton={!!onClose}
                />
            )}

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                <Section title={t('accountCenter.sections.quickActions') || 'Quick Actions'} isFirst={true}>
                    <QuickActions
                        theme={normalizedTheme}
                        actions={useMemo(() => [
                            { id: 'overview', icon: 'account-circle', iconColor: colors.iconSecurity, title: t('accountCenter.quickActions.overview') || 'Overview', onPress: () => navigate?.('AccountOverview') },
                            { id: 'settings', icon: 'cog', iconColor: colors.iconData, title: t('accountCenter.quickActions.editProfile') || 'Edit Profile', onPress: () => navigate?.('AccountSettings') },
                            { id: 'sessions', icon: 'shield-check', iconColor: colors.iconSecurity, title: t('accountCenter.quickActions.sessions') || 'Sessions', onPress: () => navigate?.('SessionManagement') },
                            { id: 'premium', icon: 'star', iconColor: colors.iconPayments, title: t('accountCenter.quickActions.premium') || 'Premium', onPress: () => navigate?.('PremiumSubscription') },
                            ...(user?.isPremium ? [{ id: 'billing', icon: 'card', iconColor: colors.iconPersonalInfo, title: t('accountCenter.quickActions.billing') || 'Billing', onPress: () => navigate?.('PaymentGateway') }] : []),
                            ...(sessions && sessions.length > 1 ? [{ id: 'switch', icon: 'swap-horizontal', iconColor: colors.iconStorage, title: t('accountCenter.quickActions.switch') || 'Switch', onPress: () => navigate?.('AccountSwitcher') }] : []),
                        ], [user?.isPremium, sessions, navigate, t, colors])}
                    />
                </Section>

                <SettingsListGroup title={t('accountCenter.sections.accountManagement') || 'Account Management'}>
                    <SettingsListItem icon={<SettingsIcon name="account-circle" color={colors.iconSecurity} />} title={t('accountCenter.items.accountOverview.title') || 'Account Overview'} description={t('accountCenter.items.accountOverview.subtitle') || 'Complete account information'} onPress={() => navigate?.('AccountOverview')} />
                    <SettingsListItem icon={<SettingsIcon name="cog" color={colors.iconData} />} title={t('accountCenter.items.editProfile.title') || 'Edit Profile'} description={t('accountCenter.items.editProfile.subtitle') || 'Manage your profile and preferences'} onPress={() => navigate?.('AccountSettings')} />
                    <SettingsListItem icon={<SettingsIcon name="shield-check" color={colors.iconSecurity} />} title={t('accountCenter.items.manageSessions.title') || 'Manage Sessions'} description={t('accountCenter.items.manageSessions.subtitle') || 'Security and active devices'} onPress={() => navigate?.('SessionManagement')} />
                    <SettingsListItem icon={<SettingsIcon name="folder" color={colors.iconStorage} />} title={t('accountCenter.items.fileManagement.title') || 'File Management'} description={t('accountCenter.items.fileManagement.subtitle') || 'Upload, download, and manage your files'} onPress={() => navigate?.('FileManagement')} />
                    <SettingsListItem icon={<SettingsIcon name="star" color={colors.iconPayments} />} title={t('accountCenter.items.premium.title') || 'Oxy+ Subscriptions'} description={user?.isPremium ? (t('accountCenter.items.premium.manage') || 'Manage your premium plan') : (t('accountCenter.items.premium.upgrade') || 'Upgrade to premium features')} onPress={() => navigate?.('PremiumSubscription')} />
                    {user?.isPremium ? (
                        <SettingsListItem icon={<SettingsIcon name="credit-card" color={colors.iconPersonalInfo} />} title={t('accountCenter.items.billing.title') || 'Billing Management'} description={t('accountCenter.items.billing.subtitle') || 'Payment methods and invoices'} onPress={() => navigate?.('PaymentGateway')} />
                    ) : null}
                </SettingsListGroup>

                {sessions && sessions.length > 1 && (
                    <SettingsListGroup title={t('accountCenter.sections.multiAccount') || 'Multi-Account'}>
                        <SettingsListItem icon={<SettingsIcon name="account-group" color={colors.iconStorage} />} title={t('accountCenter.items.switchAccount.title') || 'Switch Account'} description={t('accountCenter.items.switchAccount.subtitle', { count: sessions.length }) || `${sessions.length} accounts available`} onPress={() => navigate?.('AccountSwitcher')} />
                        <SettingsListItem icon={<SettingsIcon name="account-plus" color={colors.iconPersonalInfo} />} title={t('accountCenter.items.addAccount.title') || 'Add Another Account'} description={t('accountCenter.items.addAccount.subtitle') || 'Sign in with a different account'} onPress={() => navigate?.('OxyAuth')} />
                    </SettingsListGroup>
                )}

                {(!sessions || sessions.length <= 1) && (
                    <SettingsListGroup title={t('accountCenter.sections.addAccount') || 'Add Account'}>
                        <SettingsListItem icon={<SettingsIcon name="account-plus" color={colors.iconPersonalInfo} />} title={t('accountCenter.items.addAccount.title') || 'Add Another Account'} description={t('accountCenter.items.addAccount.subtitle') || 'Sign in with a different account'} onPress={() => navigate?.('OxyAuth')} />
                    </SettingsListGroup>
                )}

                {isAuthenticated && (
                    <SettingsListGroup title="Managed Accounts">
                        <SettingsListItem icon={<SettingsIcon name="account-switch" color={colors.iconStorage} />} title="Manage Identities" description={managedAccounts.length > 0 ? `${managedAccounts.length} managed ${managedAccounts.length === 1 ? 'identity' : 'identities'}` : 'Sub-accounts you control'} onPress={() => navigate?.('AccountSwitcher')} />
                        <SettingsListItem icon={<SettingsIcon name="account-plus" color={colors.iconPersonalInfo} />} title="Create New Identity" description="Add a managed sub-account" onPress={() => navigate?.('CreateManagedAccount')} />
                    </SettingsListGroup>
                )}

                <SettingsListGroup title={t('accountCenter.sections.moreOptions') || 'More Options'}>
                    {Platform.OS !== 'web' ? (
                        <SettingsListItem icon={<SettingsIcon name="bell" color={colors.iconStorage} />} title={t('accountCenter.items.notifications.title') || 'Notifications'} description={t('accountCenter.items.notifications.subtitle') || 'Manage notification settings'} onPress={() => navigate?.('AccountSettings', { activeTab: 'notifications' })} />
                    ) : null}
                    <SettingsListItem icon={<SettingsIcon name="translate" color={colors.iconPersonalInfo} />} title={t('language.title') || 'Language'} description={t('language.subtitle') || 'Choose your preferred language'} onPress={() => navigate?.('LanguageSelector')} />
                    <SettingsListItem icon={<SettingsIcon name="help-circle" color={colors.iconSecurity} />} title={t('accountOverview.items.help.title') || 'Help & Support'} description={t('accountOverview.items.help.subtitle') || 'Get help and contact support'} onPress={() => navigate?.('HelpSupport')} />
                    <SettingsListItem icon={<SettingsIcon name="information" color="#8E8E93" />} title={t('accountCenter.items.appInfo.title') || 'App Information'} description={t('accountCenter.items.appInfo.subtitle') || 'Version and system details'} onPress={() => navigate?.('AppInfo')} />
                </SettingsListGroup>

                <SettingsListGroup>
                    <SettingsListItem
                        icon={<SettingsIcon name="logout" color={dangerColor} />}
                        title={isLoading ? (t('accountCenter.signingOut') || 'Signing out...') : (t('common.actions.signOut') || 'Sign Out')}
                        onPress={() => logoutPrompt.open()}
                        destructive={true}
                        showChevron={false}
                        disabled={isLoading}
                        rightElement={isLoading ? (<ActivityIndicator color={dangerColor} size="small" />) : undefined}
                    />
                </SettingsListGroup>

                <View style={styles.versionContainer}>
                    <Text style={styles.versionText} className="text-muted-foreground">
                        {t('accountCenter.version', { version: packageInfo.version }) || `Version ${packageInfo.version}`}
                    </Text>
                </View>
            </ScrollView>

            <Prompt.Basic
                control={logoutPrompt}
                title={t('common.actions.signOut') || 'Sign Out'}
                description={t('common.confirms.signOut') || 'Are you sure you want to sign out?'}
                onConfirm={handleLogout}
                confirmButtonCta={t('common.actions.signOut') || 'Sign Out'}
                confirmButtonColor="negative"
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    scrollView: { flex: 1 },
    scrollContainer: screenContentStyle,
    versionContainer: { alignItems: 'center', marginTop: 20, marginBottom: 20 },
    versionText: { fontSize: 12, fontFamily: fontFamilies.inter },
    message: { fontSize: 16, textAlign: 'center', marginTop: 24 },
});

export default AccountCenterScreen;

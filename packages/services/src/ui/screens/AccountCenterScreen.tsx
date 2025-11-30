import type React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Alert,
    Platform,
} from 'react-native';
import { useCallback, useMemo } from 'react';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { packageInfo } from '../../constants/version';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import { Ionicons } from '@expo/vector-icons';
import { fontFamilies } from '../styles/fonts';
import ProfileCard from '../components/ProfileCard';
import Section from '../components/Section';
import QuickActions from '../components/QuickActions';
import GroupedSection from '../components/GroupedSection';
import GroupedItem from '../components/GroupedItem';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { Colors } from '../constants/theme';
import { useColorScheme } from '../hooks/use-color-scheme';

const AccountCenterScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
}) => {
    const { user, logout, isLoading, sessions, isAuthenticated } = useOxy();
    const { t } = useI18n();

    // Use centralized theme styles hook for consistency
    const themeStyles = useThemeStyles(theme);
    // AccountCenterScreen uses a slightly different light background
    const backgroundColor = themeStyles.isDarkTheme ? themeStyles.backgroundColor : '#f2f2f2';
    // Extract commonly used colors for readability
    const { textColor, secondaryBackgroundColor, borderColor, primaryColor, dangerColor } = themeStyles;

    // Memoized logout handler - prevents unnecessary re-renders
    const handleLogout = useCallback(async () => {
        try {
            await logout();
            if (onClose) {
                onClose();
            }
        } catch (error) {
            console.error('Logout failed:', error);
            toast.error(t('common.errors.signOutFailed') || 'There was a problem signing you out. Please try again.');
        }
    }, [logout, onClose, t]);

    // Memoized confirm logout handler - prevents unnecessary re-renders
    const confirmLogout = useCallback(() => {
        confirmAction(
            t('common.confirms.signOut') || 'Are you sure you want to sign out?',
            handleLogout
        );
    }, [handleLogout, t]);

    if (!isAuthenticated) {
        return (
            <View style={[styles.container, { backgroundColor }]}>
                <Text style={[styles.message, { color: textColor }]}>{t('common.status.notSignedIn') || 'Not signed in'}</Text>
            </View>
        );
    }

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={primaryColor} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor }]}>
            {/* Header with user profile */}
            {user && (
                <ProfileCard
                    user={user}
                    
                    onEditPress={() => navigate('EditProfile', { activeTab: 'profile' })}
                    onClosePress={onClose}
                    showCloseButton={!!onClose}
                />
            )}

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                {/* Quick Actions */}
                <Section title={t('accountCenter.sections.quickActions') || 'Quick Actions'}  isFirst={true}>
                    <QuickActions
                        actions={useMemo(() => [
                            { id: 'overview', icon: 'person-circle', iconColor: colors.iconSecurity, title: t('accountCenter.quickActions.overview') || 'Overview', onPress: () => navigate('AccountOverview') },
                            { id: 'settings', icon: 'settings', iconColor: colors.iconData, title: t('accountCenter.quickActions.editProfile') || 'Edit Profile', onPress: () => navigate('EditProfile') },
                            { id: 'sessions', icon: 'shield-checkmark', iconColor: colors.iconSecurity, title: t('accountCenter.quickActions.sessions') || 'Sessions', onPress: () => navigate('SessionManagement') },
                            { id: 'premium', icon: 'star', iconColor: colors.iconPayments, title: t('accountCenter.quickActions.premium') || 'Premium', onPress: () => navigate('PremiumSubscription') },
                            ...(user?.isPremium ? [{ id: 'billing', icon: 'card', iconColor: colors.iconPersonalInfo, title: t('accountCenter.quickActions.billing') || 'Billing', onPress: () => navigate('PaymentGateway') }] : []),
                            ...(sessions && sessions.length > 1 ? [{ id: 'switch', icon: 'swap-horizontal', iconColor: colors.iconStorage, title: t('accountCenter.quickActions.switch') || 'Switch', onPress: () => navigate('AccountSwitcher') }] : []),
                        ], [user?.isPremium, sessions, navigate, t])}
                        
                    />
                </Section>

                {/* Account Management */}
                <Section title={t('accountCenter.sections.accountManagement') || 'Account Management'} >
                    <GroupedSection
                        items={useMemo(() => [
                            {
                                id: 'overview',
                                icon: 'person-circle',
                                iconColor: colors.iconSecurity,
                                title: t('accountCenter.items.accountOverview.title') || 'Account Overview',
                                subtitle: t('accountCenter.items.accountOverview.subtitle') || 'Complete account information',
                                onPress: () => navigate('AccountOverview'),
                            },
                            {
                                id: 'settings',
                                icon: 'settings',
                                iconColor: colors.iconData,
                                title: t('accountCenter.items.editProfile.title') || 'Edit Profile',
                                subtitle: t('accountCenter.items.editProfile.subtitle') || 'Manage your profile and preferences',
                                onPress: () => navigate('EditProfile'),
                            },
                            {
                                id: 'sessions',
                                icon: 'shield-checkmark',
                                iconColor: colors.iconSecurity,
                                title: t('accountCenter.items.manageSessions.title') || 'Manage Sessions',
                                subtitle: t('accountCenter.items.manageSessions.subtitle') || 'Security and active devices',
                                onPress: () => navigate('SessionManagement'),
                            },
                            {
                                id: 'files',
                                icon: 'folder',
                                iconColor: colors.iconStorage,
                                title: t('accountCenter.items.fileManagement.title') || 'File Management',
                                subtitle: t('accountCenter.items.fileManagement.subtitle') || 'Upload, download, and manage your files',
                                onPress: () => navigate('FileManagement'),
                            },
                            {
                                id: 'premium',
                                icon: 'star',
                                iconColor: colors.iconPayments,
                                title: t('accountCenter.items.premium.title') || 'Oxy+ Subscriptions',
                                subtitle: user?.isPremium ? (t('accountCenter.items.premium.manage') || 'Manage your premium plan') : (t('accountCenter.items.premium.upgrade') || 'Upgrade to premium features'),
                                onPress: () => navigate('PremiumSubscription'),
                            },
                            ...(user?.isPremium ? [{
                                id: 'billing',
                                icon: 'card',
                                iconColor: colors.iconPersonalInfo,
                                title: t('accountCenter.items.billing.title') || 'Billing Management',
                                subtitle: t('accountCenter.items.billing.subtitle') || 'Payment methods and invoices',
                                onPress: () => navigate('PaymentGateway'),
                            }] : []),
                        ], [user?.isPremium, navigate, t])}
                        
                    />
                </Section>

                {/* Multi-Account Management */}
                {sessions && sessions.length > 1 && (
                    <Section title={t('accountCenter.sections.multiAccount') || 'Multi-Account'} >
                        <GroupedSection
                            items={useMemo(() => [
                                {
                                    id: 'switch',
                                    icon: 'people',
                                    iconColor: '#FF9500',
                                    title: t('accountCenter.items.switchAccount.title') || 'Switch Account',
                                    subtitle: t('accountCenter.items.switchAccount.subtitle', { count: sessions.length }) || `${sessions.length} accounts available`,
                                    onPress: () => navigate('AccountSwitcher'),
                                },
                                {
                                    id: 'add',
                                    icon: 'person-add',
                                    iconColor: '#30D158',
                                    title: t('accountCenter.items.addAccount.title') || 'Add Another Account',
                                    subtitle: t('accountCenter.items.addAccount.subtitle') || 'Sign in with a different account',
                                    onPress: () => navigate('SignIn'),
                                },
                            ], [sessions.length, navigate, t])}
                            
                        />
                    </Section>
                )}

                {/* Single Account Setup */}
                {(!sessions || sessions.length <= 1) && (
                    <Section title={t('accountCenter.sections.addAccount') || 'Add Account'} >
                        <GroupedSection
                            items={useMemo(() => [
                                {
                                    id: 'add',
                                    icon: 'person-add',
                                    iconColor: '#30D158',
                                    title: t('accountCenter.items.addAccount.title') || 'Add Another Account',
                                    subtitle: t('accountCenter.items.addAccount.subtitle') || 'Sign in with a different account',
                                    onPress: () => navigate('SignIn'),
                                },
                            ], [navigate, t])}
                            
                        />
                    </Section>
                )}

                {/* Additional Options */}
                <Section title={t('accountCenter.sections.moreOptions') || 'More Options'} >
                    <GroupedSection
                        items={useMemo(() => [
                            ...(Platform.OS !== 'web' ? [{
                                id: 'notifications',
                                icon: 'notifications',
                                iconColor: '#FF9500',
                                title: t('accountCenter.items.notifications.title') || 'Notifications',
                                subtitle: t('accountCenter.items.notifications.subtitle') || 'Manage notification settings',
                                onPress: () => toast.info(t('accountCenter.items.notifications.coming') || 'Notifications feature coming soon!'),
                            }] : []),
                            {
                                id: 'language',
                                icon: 'language',
                                iconColor: '#32D74B',
                                title: t('language.title') || 'Language',
                                subtitle: t('language.subtitle') || 'Choose your preferred language',
                                onPress: () => navigate('LanguageSelector'),
                            },
                            {
                                id: 'help',
                                icon: 'help-circle',
                                iconColor: '#007AFF',
                                title: t('accountOverview.items.help.title') || 'Help & Support',
                                subtitle: t('accountOverview.items.help.subtitle') || 'Get help and contact support',
                                onPress: () => toast.info(t('accountOverview.items.help.coming') || 'Help & Support feature coming soon!'),
                            },
                            {
                                id: 'appinfo',
                                icon: 'information-circle',
                                iconColor: '#8E8E93',
                                title: t('accountCenter.items.appInfo.title') || 'App Information',
                                subtitle: t('accountCenter.items.appInfo.subtitle') || 'Version and system details',
                                onPress: () => navigate('AppInfo'),
                            },
                        ], [navigate, t])}
                        
                    />
                </Section>

                {/* Sign Out Section */}
                <Section >
                    <GroupedItem
                        icon="log-out"
                        iconColor={dangerColor}
                        title={isLoading ? (t('accountCenter.signingOut') || 'Signing out...') : (t('common.actions.signOut') || 'Sign Out')}
                        
                        onPress={confirmLogout}
                        isFirst={true}
                        isLast={true}
                        showChevron={false}
                        disabled={isLoading}
                        customContent={isLoading ? (
                            <ActivityIndicator color={dangerColor} size="small" style={{ marginRight: 16 }} />
                        ) : null}
                    />
                </Section>

                <View style={styles.versionContainer}>
                    <Text style={[styles.versionText, { color: isDarkTheme ? '#666666' : '#999999' }]}>
                        {t('accountCenter.version', { version: packageInfo.version }) || `Version ${packageInfo.version}`}
                    </Text>
                </View>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    scrollContainer: {
        padding: 16,
        paddingBottom: 20,
    },
    versionContainer: {
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 20,
    },
    versionText: {
        fontSize: 12,
        fontFamily: fontFamilies.phudu,
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 24,
    },
});

export default AccountCenterScreen;

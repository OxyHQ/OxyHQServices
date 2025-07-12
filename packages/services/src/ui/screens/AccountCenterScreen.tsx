import React from 'react';
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
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { packageInfo } from '../../constants/version';
import { toast } from '../../lib/sonner';
import { Ionicons } from '@expo/vector-icons';
import { fontFamilies } from '../styles/fonts';
import {
    ProfileCard,
    Section,
    QuickActions,
    GroupedSection,
    GroupedItem
} from '../components';

const AccountCenterScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
}) => {
    const { user, logout, isLoading, sessions, isAuthenticated } = useOxy();

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#f2f2f2';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#FFFFFF';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';
    const primaryColor = '#0066CC';
    const dangerColor = '#D32F2F';

    const handleLogout = async () => {
        try {
            await logout();
            if (onClose) {
                onClose();
            }
        } catch (error) {
            console.error('Logout failed:', error);
            toast.error('There was a problem signing you out. Please try again.');
        }
    };

    const confirmLogout = () => {
        Alert.alert(
            'Sign Out',
            'Are you sure you want to sign out?',
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Sign Out',
                    onPress: handleLogout,
                    style: 'destructive',
                },
            ],
            { cancelable: true }
        );
    };

    if (!isAuthenticated) {
        return (
            <View style={[styles.container, { backgroundColor }]}>
                <Text style={[styles.message, { color: textColor }]}>Not signed in</Text>
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
                    theme={theme}
                    onEditPress={() => navigate('AccountSettings', { activeTab: 'profile' })}
                    onClosePress={onClose}
                    showCloseButton={!!onClose}
                />
            )}

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                {/* Quick Actions */}
                <Section title="Quick Actions" theme={theme} isFirst={true}>
                    <QuickActions
                        actions={[
                            { id: 'overview', icon: 'person-circle', iconColor: '#007AFF', title: 'Overview', onPress: () => navigate('AccountOverview') },
                            { id: 'settings', icon: 'settings', iconColor: '#5856D6', title: 'Settings', onPress: () => navigate('AccountSettings') },
                            { id: 'sessions', icon: 'shield-checkmark', iconColor: '#30D158', title: 'Sessions', onPress: () => navigate('SessionManagement') },
                            { id: 'premium', icon: 'star', iconColor: '#FFD700', title: 'Premium', onPress: () => navigate('PremiumSubscription') },
                            ...(user?.isPremium ? [{ id: 'billing', icon: 'card', iconColor: '#34C759', title: 'Billing', onPress: () => navigate('') }] : []),
                            ...(sessions && sessions.length > 1 ? [{ id: 'switch', icon: 'swap-horizontal', iconColor: '#FF9500', title: 'Switch', onPress: () => navigate('AccountSwitcher') }] : []),
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* Account Management */}
                <Section title="Account Management" theme={theme}>
                    <GroupedSection
                        items={[
                            {
                                id: 'overview',
                                icon: 'person-circle',
                                iconColor: '#007AFF',
                                title: 'Account Overview',
                                subtitle: 'Complete account information',
                                onPress: () => navigate('AccountOverview'),
                            },
                            {
                                id: 'settings',
                                icon: 'settings',
                                iconColor: '#5856D6',
                                title: 'Account Settings',
                                subtitle: 'Manage your preferences',
                                onPress: () => navigate('AccountSettings'),
                            },
                            {
                                id: 'sessions',
                                icon: 'shield-checkmark',
                                iconColor: '#30D158',
                                title: 'Manage Sessions',
                                subtitle: 'Security and active devices',
                                onPress: () => navigate('SessionManagement'),
                            },
                            {
                                id: 'files',
                                icon: 'folder',
                                iconColor: '#FF9500',
                                title: 'File Management',
                                subtitle: 'Upload, download, and manage your files',
                                onPress: () => navigate('FileManagement'),
                            },
                            {
                                id: 'premium',
                                icon: 'star',
                                iconColor: '#FFD700',
                                title: 'Oxy+ Subscriptions',
                                subtitle: user?.isPremium ? 'Manage your premium plan' : 'Upgrade to premium features',
                                onPress: () => navigate('PremiumSubscription'),
                            },
                            ...(user?.isPremium ? [{
                                id: 'billing',
                                icon: 'card',
                                iconColor: '#34C759',
                                title: 'Billing Management',
                                subtitle: 'Payment methods and invoices',
                                onPress: () => navigate(''),
                            }] : []),
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* Multi-Account Management */}
                {sessions && sessions.length > 1 && (
                    <Section title="Multi-Account" theme={theme}>
                        <GroupedSection
                            items={[
                                {
                                    id: 'switch',
                                    icon: 'people',
                                    iconColor: '#FF9500',
                                    title: 'Switch Account',
                                    subtitle: `${sessions.length} accounts available`,
                                    onPress: () => navigate('AccountSwitcher'),
                                },
                                {
                                    id: 'add',
                                    icon: 'person-add',
                                    iconColor: '#30D158',
                                    title: 'Add Another Account',
                                    subtitle: 'Sign in with a different account',
                                    onPress: () => navigate('SignIn'),
                                },
                            ]}
                            theme={theme}
                        />
                    </Section>
                )}

                {/* Single Account Setup */}
                {(!sessions || sessions.length <= 1) && (
                    <Section title="Add Account" theme={theme}>
                        <GroupedSection
                            items={[
                                {
                                    id: 'add',
                                    icon: 'person-add',
                                    iconColor: '#30D158',
                                    title: 'Add Another Account',
                                    subtitle: 'Sign in with a different account',
                                    onPress: () => navigate('SignIn'),
                                },
                            ]}
                            theme={theme}
                        />
                    </Section>
                )}

                {/* Additional Options */}
                <Section title="More Options" theme={theme}>
                    <GroupedSection
                        items={[
                            ...(Platform.OS !== 'web' ? [{
                                id: 'notifications',
                                icon: 'notifications',
                                iconColor: '#FF9500',
                                title: 'Notifications',
                                subtitle: 'Manage notification settings',
                                onPress: () => toast.info('Notifications feature coming soon!'),
                            }] : []),
                            {
                                id: 'help',
                                icon: 'help-circle',
                                iconColor: '#007AFF',
                                title: 'Help & Support',
                                subtitle: 'Get help and contact support',
                                onPress: () => toast.info('Help & Support feature coming soon!'),
                            },
                            {
                                id: 'appinfo',
                                icon: 'information-circle',
                                iconColor: '#8E8E93',
                                title: 'App Information',
                                subtitle: 'Version and system details',
                                onPress: () => navigate('AppInfo'),
                            },
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* Sign Out Section */}
                <Section theme={theme}>
                    <GroupedItem
                        icon="log-out"
                        iconColor={dangerColor}
                        title={isLoading ? "Signing out..." : "Sign Out"}
                        theme={theme}
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
                        Version {packageInfo.version}
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

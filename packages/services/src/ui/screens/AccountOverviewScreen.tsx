import React, { useState, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Alert,
    Platform,
    Image,
    TextStyle,
} from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import OxyLogo from '../components/OxyLogo';
import Avatar from '../components/Avatar';
import OxyIcon from '../components/icon/OxyIcon';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import { Ionicons } from '@expo/vector-icons';
import { Header, Section, GroupedSection, GroupedItem } from '../components';

/**
 * AccountOverviewScreen - Optimized for performance
 * 
 * Performance optimizations implemented:
 * - useMemo for theme calculations (only recalculates when theme changes)
 * - useMemo for additional accounts filtering (only recalculates when dependencies change)
 * - useCallback for event handlers to prevent unnecessary re-renders
 * - React.memo wrapper to prevent re-renders when props haven't changed
 * - GroupedSection components for better organization and cleaner code
 */
const AccountOverviewScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
}) => {
    const { user, logout, isLoading, sessions, activeSessionId, oxyServices, isAuthenticated } = useOxy();
    const [showMoreAccounts, setShowMoreAccounts] = useState(false);
    const [additionalAccountsData, setAdditionalAccountsData] = useState<any[]>([]);
    const [loadingAdditionalAccounts, setLoadingAdditionalAccounts] = useState(false);

    // Memoize theme-related calculations to prevent unnecessary recalculations
    const themeStyles = useMemo(() => {
        const isDarkTheme = theme === 'dark';
        return {
            isDarkTheme,
            textColor: isDarkTheme ? '#FFFFFF' : '#000000',
            backgroundColor: isDarkTheme ? '#121212' : '#FFFFFF',
            secondaryBackgroundColor: isDarkTheme ? '#222222' : '#F5F5F5',
            borderColor: isDarkTheme ? '#444444' : '#E0E0E0',
            primaryColor: '#d169e5',
            dangerColor: '#D32F2F',
            iconColor: isDarkTheme ? '#BBBBBB' : '#666666',
        };
    }, [theme]);

    // Memoize additional accounts filtering to prevent recalculation on every render
    const additionalAccounts = useMemo(() =>
        sessions.filter(session =>
            session.sessionId !== activeSessionId && session.userId !== user?.id
        ), [sessions, activeSessionId, user?.id]
    );

    // Load user profiles for additional accounts
    React.useEffect(() => {
        const loadAdditionalAccountsData = async () => {
            if (!oxyServices || additionalAccounts.length === 0) {
                setAdditionalAccountsData([]);
                return;
            }

            setLoadingAdditionalAccounts(true);
            try {
                const accountsData = await Promise.all(
                    additionalAccounts.map(async (session) => {
                        try {
                            const userProfile = await oxyServices.getUserBySession(session.sessionId);
                            return {
                                id: session.sessionId,
                                sessionId: session.sessionId,
                                username: userProfile.username,
                                email: userProfile.email,
                                name: userProfile.name,
                                avatar: userProfile.avatar,
                                userProfile
                            };
                        } catch (error) {
                            console.error(`Failed to load profile for session ${session.sessionId}:`, error);
                            return {
                                id: session.sessionId,
                                sessionId: session.sessionId,
                                username: 'Unknown User',
                                email: 'No email available',
                                avatar: null,
                                userProfile: null
                            };
                        }
                    })
                );
                setAdditionalAccountsData(accountsData);
            } catch (error) {
                console.error('Failed to load additional accounts:', error);
                setAdditionalAccountsData([]);
            } finally {
                setLoadingAdditionalAccounts(false);
            }
        };

        loadAdditionalAccountsData();
    }, [sessions, activeSessionId, user?.id, oxyServices]);

    // Feature settings (with mock values)
    const features = {
        safeSearch: false,
        language: 'English',
    };

    // Memoize event handlers to prevent recreation on every render
    const handleLogout = useCallback(async () => {
        try {
            await logout();
            if (onClose) {
                onClose();
            }
        } catch (error) {
            console.error('Logout failed:', error);
            toast.error('There was a problem signing you out. Please try again.');
        }
    }, [logout, onClose]);

    const confirmLogout = useCallback(() => {
        confirmAction(
            'Are you sure you want to sign out?',
            handleLogout
        );
    }, [handleLogout]);

    const handleAddAccount = useCallback(() => {
        toast.info('Add another account feature coming soon!');
    }, []);

    const handleSignOutAll = useCallback(() => {
        confirmAction(
            'Are you sure you want to sign out of all accounts?',
            handleLogout
        );
    }, [handleLogout]);

    if (!isAuthenticated) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
                <Text style={[styles.message, { color: themeStyles.textColor }]}>Not signed in</Text>
            </View>
        );
    }

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={themeStyles.primaryColor} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: '#f2f2f2' }]}>
            {/* Header */}
            <Header
                title="Account"
                theme={theme}
                onBack={onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                {/* User Profile Section */}
                <Section title="Profile" theme={theme} isFirst={true}>
                    <GroupedSection
                        items={[
                            {
                                id: 'profile-info',
                                icon: 'person',
                                iconColor: '#007AFF',
                                title: user ? (typeof user.name === 'string' ? user.name : user.name?.full || user.name?.first || user.username) : 'Loading...',
                                subtitle: user ? (user.email || user.username) : 'Loading...',
                                onPress: () => toast.info('Manage your Oxy Account feature coming soon!'),
                                customContent: (
                                    <>
                                        <View style={styles.userIcon}>
                                            <Avatar
                                                uri={user?.avatar?.url}
                                                name={user?.name?.full}
                                                size={40}
                                                theme={theme}
                                            />
                                        </View>
                                        <TouchableOpacity
                                            style={styles.manageButton}
                                            onPress={() => toast.info('Manage your Oxy Account feature coming soon!')}
                                        >
                                            <Text style={styles.manageButtonText}>Manage</Text>
                                        </TouchableOpacity>
                                    </>
                                ),
                            },
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* Account Settings */}
                <Section title="Account Settings" theme={theme}>
                    <GroupedSection
                        items={[
                            {
                                id: 'edit-profile',
                                icon: 'person-circle',
                                iconColor: '#007AFF',
                                title: 'Edit Profile',
                                subtitle: 'Update your personal information',
                                onPress: () => navigate?.('EditProfile', { activeTab: 'profile' }),
                            },
                            {
                                id: 'security-privacy',
                                icon: 'shield-checkmark',
                                iconColor: '#30D158',
                                title: 'Security & Privacy',
                                subtitle: 'Password, 2FA, and privacy settings',
                                onPress: () => navigate?.('EditProfile', { activeTab: 'password' }),
                            },
                            {
                                id: 'notifications',
                                icon: 'notifications',
                                iconColor: '#FF9500',
                                title: 'Notifications',
                                subtitle: 'Manage your notification preferences',
                                onPress: () => navigate?.('EditProfile', { activeTab: 'notifications' }),
                            },
                            {
                                id: 'premium-subscription',
                                icon: 'star',
                                iconColor: '#FFD700',
                                title: 'Oxy+ Subscriptions',
                                subtitle: user?.isPremium ? 'Manage your premium plan' : 'Upgrade to premium features',
                                onPress: () => navigate?.('PremiumSubscription'),
                            },
                            ...(user?.isPremium ? [{
                                id: 'billing-management',
                                icon: 'card',
                                iconColor: '#34C759',
                                title: 'Billing Management',
                                subtitle: 'Payment methods and invoices',
                                onPress: () => toast.info('Billing management feature coming soon!'),
                            }] : []),
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* Additional Accounts */}
                {showMoreAccounts && (
                    <Section title={`Additional Accounts${additionalAccountsData.length > 0 ? ` (${additionalAccountsData.length})` : ''}`} theme={theme}>
                        {loadingAdditionalAccounts ? (
                            <GroupedSection
                                items={[
                                    {
                                        id: 'loading-accounts',
                                        icon: 'sync',
                                        iconColor: '#007AFF',
                                        title: 'Loading accounts...',
                                        subtitle: 'Please wait while we load your additional accounts',
                                        customContent: (
                                            <View style={styles.loadingContainer}>
                                                <ActivityIndicator size="small" color="#007AFF" />
                                                <Text style={styles.loadingText}>Loading accounts...</Text>
                                            </View>
                                        ),
                                    },
                                ]}
                                theme={theme}
                            />
                        ) : additionalAccountsData.length > 0 ? (
                            <GroupedSection
                                items={additionalAccountsData.map((account, index) => ({
                                    id: `account-${account.id}`,
                                    icon: 'person',
                                    iconColor: '#5856D6',
                                    title: typeof account.name === 'object'
                                        ? account.name?.full || account.name?.first || account.username
                                        : account.name || account.username,
                                    subtitle: account.email || account.username,
                                    onPress: () => {
                                        toast.info(`Switch to ${account.username}?`);
                                        // TODO: Implement account switching logic
                                        // switchSession(account.sessionId);
                                    },
                                    customContent: (
                                        <>
                                            <View style={styles.userIcon}>
                                                {account.avatar?.url ? (
                                                    <Image source={{ uri: account.avatar.url }} style={styles.accountAvatarImage} />
                                                ) : (
                                                    <View style={styles.accountAvatarFallback}>
                                                        <Text style={styles.accountAvatarText}>
                                                            {account.username?.charAt(0).toUpperCase() || '?'}
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>
                                            <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                                        </>
                                    ),
                                }))}
                                theme={theme}
                            />
                        ) : (
                            <GroupedSection
                                items={[
                                    {
                                        id: 'no-accounts',
                                        icon: 'person-outline',
                                        iconColor: '#ccc',
                                        title: 'No other accounts',
                                        subtitle: 'Add another account to switch between them',
                                    },
                                ]}
                                theme={theme}
                            />
                        )}
                    </Section>
                )}

                {/* Account Management */}
                {showMoreAccounts && (
                    <Section title="Account Management" theme={theme}>
                        <GroupedSection
                            items={[
                                {
                                    id: 'add-account',
                                    icon: 'add',
                                    iconColor: '#007AFF',
                                    title: 'Add another account',
                                    subtitle: 'Sign in with a different account',
                                    onPress: handleAddAccount,
                                },
                                {
                                    id: 'sign-out-all',
                                    icon: 'log-out',
                                    iconColor: '#FF3B30',
                                    title: 'Sign out of all accounts',
                                    subtitle: 'Remove all accounts from this device',
                                    onPress: handleSignOutAll,
                                },
                            ]}
                            theme={theme}
                        />
                    </Section>
                )}

                {/* Quick Actions */}
                <Section title="Quick Actions" theme={theme}>
                    <GroupedSection
                        items={[
                            {
                                id: 'account-switcher',
                                icon: 'people',
                                iconColor: '#5856D6',
                                title: `${showMoreAccounts ? 'Hide' : 'Show'} Account Switcher`,
                                subtitle: showMoreAccounts
                                    ? 'Hide account switcher'
                                    : additionalAccountsData.length > 0
                                        ? `Switch between ${additionalAccountsData.length + 1} accounts`
                                        : loadingAdditionalAccounts
                                            ? 'Loading additional accounts...'
                                            : 'Manage multiple accounts',
                                onPress: () => setShowMoreAccounts(!showMoreAccounts),
                            },
                            {
                                id: 'download-data',
                                icon: 'download',
                                iconColor: '#34C759',
                                title: 'Download My Data',
                                subtitle: 'Export your account information',
                                onPress: () => toast.info('Download account data feature coming soon!'),
                            },
                            {
                                id: 'delete-account',
                                icon: 'trash',
                                iconColor: '#FF3B30',
                                title: 'Delete Account',
                                subtitle: 'Permanently delete your account',
                                onPress: () => toast.info('Delete account feature coming soon!'),
                            },
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* Support & Settings */}
                <Section title="Support & Settings" theme={theme}>
                    <GroupedSection
                        items={[
                            {
                                id: 'account-preferences',
                                icon: 'settings',
                                iconColor: '#8E8E93',
                                title: 'Account Preferences',
                                subtitle: 'Customize your account experience',
                                onPress: () => toast.info('Account preferences coming soon!'),
                            },
                            {
                                id: 'help-support',
                                icon: 'help-circle',
                                iconColor: '#007AFF',
                                title: 'Help & Support',
                                subtitle: 'Get help with your account',
                                onPress: () => toast.info('Help & support feature coming soon!'),
                            },
                            {
                                id: 'connected-apps',
                                icon: 'link',
                                iconColor: '#32D74B',
                                title: 'Connected Apps',
                                subtitle: 'Manage third-party app access',
                                onPress: () => toast.info('Connected apps feature coming soon!'),
                            },
                            {
                                id: 'about',
                                icon: 'information-circle',
                                iconColor: '#8E8E93',
                                title: 'About',
                                subtitle: 'App version and information',
                                onPress: () => navigate?.('AppInfo'),
                            },
                        ]}
                        theme={theme}
                    />
                </Section>

                {/* Sign Out */}
                <Section title="Account Actions" theme={theme}>
                    <GroupedItem
                        icon="log-out"
                        iconColor="#FF3B30"
                        title="Sign Out"
                        subtitle="Sign out of your current account"
                        theme={theme}
                        onPress={confirmLogout}
                        isFirst={true}
                        isLast={true}
                        showChevron={false}
                    />
                </Section>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f2f2f2',
    },
    content: {
        flex: 1,
        padding: 16,
    },

    userIcon: {
        marginRight: 12,
    },
    manageButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 16,
    },
    manageButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
    },
    accountAvatarImage: {
        width: 40,
        height: 40,
        borderRadius: 20,
    },
    accountAvatarFallback: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#d169e5',
        alignItems: 'center',
        justifyContent: 'center',
    },
    accountAvatarText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 24,
        color: '#333',
    },
    loadingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 20,
        gap: 12,
    },
    loadingText: {
        fontSize: 16,
        color: '#666',
    },
});

export default React.memo(AccountOverviewScreen);

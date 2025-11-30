import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
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
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import OxyLogo from '../components/OxyLogo';
import Avatar from '../components/Avatar';
import OxyIcon from '../components/icon/OxyIcon';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import { Ionicons } from '@expo/vector-icons';
import { Header, Section, GroupedSection, GroupedItem, getHeaderHeight } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { getDisplayName, getShortDisplayName } from '../utils/user-utils';

// Optional Lottie import - gracefully handle if not available
let LottieView: any = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    LottieView = require('lottie-react-native').default;
} catch {
    // Lottie not available, will use fallback
}

// Import Lottie animation - will be undefined if file doesn't exist
let lottieAnimation: any = undefined;
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lottieAnimation = require('../assets/lottie/welcomeheader_background_op1.json');
} catch {
    // Animation file not available
}

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
    const { t } = useI18n();
    const [showMoreAccounts, setShowMoreAccounts] = useState(false);
    const [additionalAccountsData, setAdditionalAccountsData] = useState<any[]>([]);
    const [loadingAdditionalAccounts, setLoadingAdditionalAccounts] = useState(false);
    const lottieRef = useRef<any>(null);
    const hasPlayedRef = useRef(false);
    const insets = useSafeAreaInsets();
    const scrollY = useSharedValue(0);

    // Calculate header height for padding
    const headerHeight = useMemo(() => getHeaderHeight('minimal', insets.top), [insets.top]);

    // Use centralized theme styles hook for consistency
    const baseThemeStyles = useThemeStyles(theme);
    const themeStyles = useMemo(() => ({
        ...baseThemeStyles,
        // AccountOverviewScreen uses a custom primary color (purple) instead of the default blue
        primaryColor: '#d169e5',
        // Keep custom icon color for this screen
        iconColor: baseThemeStyles.isDarkTheme ? '#BBBBBB' : '#666666',
    }), [baseThemeStyles]);

    // Compute user data for display
    const displayName = useMemo(() => getDisplayName(user), [user]);
    const shortDisplayName = useMemo(() => getShortDisplayName(user), [user]);
    const avatarUrl = useMemo(() => {
        if (user?.avatar && oxyServices) {
            return oxyServices.getFileDownloadUrl(user.avatar, 'thumb');
        }
        return undefined;
    }, [user?.avatar, oxyServices]);

    // Handle avatar press to navigate to EditProfile
    const handleAvatarPress = useCallback(() => {
        navigate?.('EditProfile', { initialSection: 'profilePicture', initialField: 'avatar' });
    }, [navigate]);

    // Play Lottie animation once when component mounts
    useEffect(() => {
        if (hasPlayedRef.current || !LottieView || !lottieRef.current || !lottieAnimation) return;

        const timer = setTimeout(() => {
            if (lottieRef.current && !hasPlayedRef.current) {
                lottieRef.current.play();
                hasPlayedRef.current = true;
            }
        }, 100);

        return () => clearTimeout(timer);
    }, []);

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
            toast.error(t('common.errors.signOutFailed'));
        }
    }, [logout, onClose]);

    const confirmLogout = useCallback(() => {
        confirmAction(t('common.confirms.signOut'), handleLogout);
    }, [handleLogout]);

    const handleAddAccount = useCallback(() => {
        toast.info(t('accountOverview.addAccountComing'));
    }, [t]);

    const handleSignOutAll = useCallback(() => {
        confirmAction(t('common.confirms.signOutAll'), handleLogout);
    }, [handleLogout]);

    const handleDownloadData = useCallback(async () => {
        if (!oxyServices || !user) {
            toast.error(t('accountOverview.items.downloadData.error') || 'Service not available');
            return;
        }

        try {
            Alert.alert(
                t('accountOverview.items.downloadData.confirmTitle') || 'Download Account Data',
                t('accountOverview.items.downloadData.confirmMessage') || 'Choose the format for your account data export:',
                [
                    {
                        text: t('common.cancel') || 'Cancel',
                        style: 'cancel',
                    },
                    {
                        text: 'JSON',
                        onPress: async () => {
                            try {
                                toast.loading(t('accountOverview.items.downloadData.downloading') || 'Preparing download...');
                                const blob = await oxyServices.downloadAccountData('json');

                                // Create download link for web
                                if (Platform.OS === 'web') {
                                    const url = URL.createObjectURL(blob);
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.download = `account-data-${Date.now()}.json`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                    URL.revokeObjectURL(url);
                                    toast.success(t('accountOverview.items.downloadData.success') || 'Data downloaded successfully');
                                } else {
                                    // For React Native, you'd need to use a library like expo-file-system
                                    toast.success(t('accountOverview.items.downloadData.success') || 'Data downloaded successfully');
                                }
                            } catch (error: any) {
                                console.error('Failed to download data:', error);
                                toast.error(error?.message || t('accountOverview.items.downloadData.error') || 'Failed to download data');
                            }
                        },
                    },
                    {
                        text: 'CSV',
                        onPress: async () => {
                            try {
                                toast.loading(t('accountOverview.items.downloadData.downloading') || 'Preparing download...');
                                const blob = await oxyServices.downloadAccountData('csv');

                                // Create download link for web
                                if (Platform.OS === 'web') {
                                    const url = URL.createObjectURL(blob);
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.download = `account-data-${Date.now()}.csv`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                    URL.revokeObjectURL(url);
                                    toast.success(t('accountOverview.items.downloadData.success') || 'Data downloaded successfully');
                                } else {
                                    // For React Native, you'd need to use a library like expo-file-system
                                    toast.success(t('accountOverview.items.downloadData.success') || 'Data downloaded successfully');
                                }
                            } catch (error: any) {
                                console.error('Failed to download data:', error);
                                toast.error(error?.message || t('accountOverview.items.downloadData.error') || 'Failed to download data');
                            }
                        },
                    },
                ]
            );
        } catch (error: any) {
            console.error('Failed to initiate download:', error);
            toast.error(error?.message || t('accountOverview.items.downloadData.error') || 'Failed to download data');
        }
    }, [oxyServices, user, t]);

    const handleDeleteAccount = useCallback(() => {
        if (!user) {
            toast.error(t('accountOverview.items.deleteAccount.error') || 'User not available');
            return;
        }

        confirmAction(
            t('accountOverview.items.deleteAccount.confirmMessage') || `This action cannot be undone. This will permanently delete your account and all associated data.\n\nAre you sure you want to delete your account?`,
            async () => {
                // For React Native, we'd need a separate modal for password/confirmation input
                // For now, we'll use a simplified confirmation
                // In production, you'd want to create a modal with password and username confirmation fields
                if (!oxyServices) {
                    toast.error(t('accountOverview.items.deleteAccount.error') || 'Service not available');
                    return;
                }

                Alert.alert(
                    t('accountOverview.items.deleteAccount.confirmTitle') || 'Delete Account',
                    t('accountOverview.items.deleteAccount.finalConfirm') || `This is your final warning. Your account will be permanently deleted and cannot be recovered. Type "${user.username}" to confirm.`,
                    [
                        {
                            text: t('common.cancel') || 'Cancel',
                            style: 'cancel',
                        },
                        {
                            text: t('accountOverview.items.deleteAccount.confirm') || 'Delete Forever',
                            style: 'destructive',
                            onPress: async () => {
                                try {
                                    // Note: In a production app, you'd want to show a modal with password and username confirmation fields
                                    // For now, we'll require the user to enter these via a custom modal or prompt
                                    toast.error(t('accountOverview.items.deleteAccount.passwordRequired') || 'Password confirmation required. This feature needs a modal with password input.');
                                } catch (error: any) {
                                    console.error('Failed to delete account:', error);
                                    toast.error(error?.message || t('accountOverview.items.deleteAccount.error') || 'Failed to delete account');
                                }
                            },
                        },
                    ]
                );
            }
        );
    }, [user, oxyServices, logout, onClose, t]);

    if (!isAuthenticated) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
                <Text style={[styles.message, { color: themeStyles.textColor }]}>{t('common.status.notSignedIn')}</Text>
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

    // Scroll handler for sticky header on native
    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y;
        },
    });

    const AnimatedScrollView = Platform.OS === 'web' ? ScrollView : Animated.ScrollView;

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            {Platform.OS === 'web' ? (
                <>
                    {/* Header - outside ScrollView for web sticky */}
                    <Header
                        title={t('accountOverview.title')}
                        onBack={onClose}
                        variant="minimal"
                        elevation="subtle"
                    />
                    <AnimatedScrollView
                        style={styles.content}
                        contentContainerStyle={[
                            styles.scrollContent,
                            { paddingTop: headerHeight + 8 }
                        ]}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Centered Avatar and Name Header Section */}
                        {user && (
                            <View style={styles.headerSection}>
                                <View style={styles.avatarSectionWrapper}>
                                    <View style={styles.avatarContainer}>
                                        {LottieView && lottieAnimation && (
                                            <LottieView
                                                ref={lottieRef}
                                                source={lottieAnimation}
                                                style={styles.lottieBackground}
                                            />
                                        )}
                                        <TouchableOpacity
                                            style={styles.avatarWrapper}
                                            onPress={handleAvatarPress}
                                            activeOpacity={0.8}
                                        >
                                            <Avatar
                                                uri={avatarUrl}
                                                name={displayName}
                                                size={100}
                                                theme={theme}
                                            />
                                        </TouchableOpacity>
                                    </View>
                                    <View style={styles.nameWrapper}>
                                        <Text style={[styles.welcomeText, { color: themeStyles.textColor }]}>
                                            Welcome, {shortDisplayName}.
                                        </Text>
                                        <Text style={[styles.welcomeSubtext, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                            Manage your Oxy account.
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        )}

                        {/* User Profile Section */}
                        <Section title={t('accountOverview.sections.profile')} isFirst={true}>
                            <GroupedSection
                                items={[
                                    {
                                        id: 'profile-info',
                                        icon: 'person',
                                        iconColor: '#007AFF',
                                        title: displayName,
                                        subtitle: user ? (user.email || user.username) : (t('common.status.loading') || 'Loading...'),
                                        onPress: () => navigate?.('EditProfile', { activeTab: 'profile' }),
                                    },
                                ]}
                            />
                        </Section>

                        {/* Account Settings */}
                        <Section title={t('accountOverview.sections.accountSettings')} >
                            <GroupedSection
                                items={[
                                    {
                                        id: 'edit-profile',
                                        icon: 'person-circle',
                                        iconColor: '#007AFF',
                                        title: t('accountOverview.items.editProfile.title'),
                                        subtitle: t('accountOverview.items.editProfile.subtitle'),
                                        onPress: () => navigate?.('EditProfile', { activeTab: 'profile' }),
                                    },
                                    {
                                        id: 'security-privacy',
                                        icon: 'shield-checkmark',
                                        iconColor: '#30D158',
                                        title: t('accountOverview.items.security.title'),
                                        subtitle: t('accountOverview.items.security.subtitle'),
                                        onPress: () => navigate?.('EditProfile', { activeTab: 'password' }),
                                    },
                                    {
                                        id: 'notifications',
                                        icon: 'notifications',
                                        iconColor: '#FF9500',
                                        title: t('accountOverview.items.notifications.title'),
                                        subtitle: t('accountOverview.items.notifications.subtitle'),
                                        onPress: () => navigate?.('EditProfile', { activeTab: 'notifications' }),
                                    },
                                    {
                                        id: 'premium-subscription',
                                        icon: 'star',
                                        iconColor: '#FFD700',
                                        title: t('accountOverview.items.premium.title'),
                                        subtitle: user?.isPremium ? t('accountOverview.items.premium.manage') : t('accountOverview.items.premium.upgrade'),
                                        onPress: () => navigate?.('PremiumSubscription'),
                                    },
                                    ...(user?.isPremium ? [{
                                        id: 'billing-management',
                                        icon: 'card',
                                        iconColor: '#34C759',
                                        title: t('accountOverview.items.billing.title'),
                                        subtitle: t('accountOverview.items.billing.subtitle'),
                                        onPress: () => toast.info(t('accountOverview.items.billing.coming')),
                                    }] : []),
                                ]}

                            />
                        </Section>

                        {/* Additional Accounts */}
                        {showMoreAccounts && (
                            <Section title={`${t('accountOverview.sections.additionalAccounts') || 'Additional Accounts'}${additionalAccountsData.length > 0 ? ` (${additionalAccountsData.length})` : ''}`} >
                                {loadingAdditionalAccounts ? (
                                    <GroupedSection
                                        items={[
                                            {
                                                id: 'loading-accounts',
                                                icon: 'sync',
                                                iconColor: '#007AFF',
                                                title: t('accountOverview.loadingAdditional.title') || 'Loading accounts...',
                                                subtitle: t('accountOverview.loadingAdditional.subtitle') || 'Please wait while we load your additional accounts',
                                                customContent: (
                                                    <View style={styles.loadingContainer}>
                                                        <ActivityIndicator size="small" color="#007AFF" />
                                                        <Text style={styles.loadingText}>{t('accountOverview.loadingAdditional.title') || 'Loading accounts...'}</Text>
                                                    </View>
                                                ),
                                            },
                                        ]}

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
                                                toast.info(t('accountOverview.items.accountSwitcher.switchPrompt', { username: account.username }) || `Switch to ${account.username}?`);
                                            },
                                            customContent: (
                                                <>
                                                    <View style={styles.userIcon}>
                                                        {account.avatar ? (
                                                            <Image
                                                                source={{ uri: oxyServices.getFileDownloadUrl(account.avatar as string, 'thumb') }}
                                                                style={styles.accountAvatarImage}
                                                            />
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

                                    />
                                ) : (
                                    <GroupedSection
                                        items={[
                                            {
                                                id: 'no-accounts',
                                                icon: 'person-outline',
                                                iconColor: '#ccc',
                                                title: t('accountOverview.additional.noAccounts.title') || 'No other accounts',
                                                subtitle: t('accountOverview.additional.noAccounts.subtitle') || 'Add another account to switch between them',
                                            },
                                        ]}

                                    />
                                )}
                            </Section>
                        )}

                        {/* Account Management */}
                        {showMoreAccounts && (
                            <Section title={t('accountOverview.sections.accountManagement') || 'Account Management'} >
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'add-account',
                                            icon: 'add',
                                            iconColor: '#007AFF',
                                            title: t('accountOverview.items.addAccount.title') || 'Add Another Account',
                                            subtitle: t('accountOverview.items.addAccount.subtitle') || 'Sign in with a different account',
                                            onPress: handleAddAccount,
                                        },
                                        {
                                            id: 'sign-out-all',
                                            icon: 'log-out',
                                            iconColor: '#FF3B30',
                                            title: t('accountOverview.items.signOutAll.title') || 'Sign out of all accounts',
                                            subtitle: t('accountOverview.items.signOutAll.subtitle') || 'Remove all accounts from this device',
                                            onPress: handleSignOutAll,
                                        },
                                    ]}

                                />
                            </Section>
                        )}

                        {/* Quick Actions */}
                        <Section title={t('accountOverview.sections.quickActions')} >
                            <GroupedSection
                                items={[
                                    {
                                        id: 'account-switcher',
                                        icon: 'people',
                                        iconColor: '#5856D6',
                                        title: showMoreAccounts
                                            ? t('accountOverview.items.accountSwitcher.titleHide')
                                            : t('accountOverview.items.accountSwitcher.titleShow'),
                                        subtitle: showMoreAccounts
                                            ? t('accountOverview.items.accountSwitcher.subtitleHide')
                                            : additionalAccountsData.length > 0
                                                ? t('accountOverview.items.accountSwitcher.subtitleSwitchBetween', { count: String(additionalAccountsData.length + 1) })
                                                : loadingAdditionalAccounts
                                                    ? t('accountOverview.items.accountSwitcher.subtitleLoading')
                                                    : t('accountOverview.items.accountSwitcher.subtitleManageMultiple'),
                                        onPress: () => setShowMoreAccounts(!showMoreAccounts),
                                    },
                                    {
                                        id: 'history-view',
                                        icon: 'time',
                                        iconColor: '#007AFF',
                                        title: t('accountOverview.items.history.title') || 'History',
                                        subtitle: t('accountOverview.items.history.subtitle') || 'View and manage your search history',
                                        onPress: () => navigate?.('HistoryView'),
                                    },
                                    {
                                        id: 'saves-collections',
                                        icon: 'bookmark',
                                        iconColor: '#FF9500',
                                        title: t('accountOverview.items.saves.title') || 'Saves & Collections',
                                        subtitle: t('accountOverview.items.saves.subtitle') || 'View your saved items and collections',
                                        onPress: () => navigate?.('SavesCollections'),
                                    },
                                    {
                                        id: 'download-data',
                                        icon: 'download',
                                        iconColor: '#34C759',
                                        title: t('accountOverview.items.downloadData.title'),
                                        subtitle: t('accountOverview.items.downloadData.subtitle'),
                                        onPress: handleDownloadData,
                                    },
                                    {
                                        id: 'delete-account',
                                        icon: 'trash',
                                        iconColor: '#FF3B30',
                                        title: t('accountOverview.items.deleteAccount.title'),
                                        subtitle: t('accountOverview.items.deleteAccount.subtitle'),
                                        onPress: handleDeleteAccount,
                                    },
                                ]}

                            />
                        </Section>

                        {/* Support & Settings */}
                        <Section title={t('accountOverview.sections.support')} >
                            <GroupedSection
                                items={[
                                    {
                                        id: 'search-settings',
                                        icon: 'search',
                                        iconColor: '#007AFF',
                                        title: t('accountOverview.items.searchSettings.title') || 'Search Settings',
                                        subtitle: t('accountOverview.items.searchSettings.subtitle') || 'SafeSearch and personalization',
                                        onPress: () => navigate?.('SearchSettings'),
                                    },
                                    {
                                        id: 'language-settings',
                                        icon: 'language',
                                        iconColor: '#32D74B',
                                        title: t('accountOverview.items.language.title') || 'Language',
                                        subtitle: t('accountOverview.items.language.subtitle') || 'Choose your preferred language',
                                        onPress: () => navigate?.('LanguageSelector'),
                                    },
                                    {
                                        id: 'account-preferences',
                                        icon: 'settings',
                                        iconColor: '#8E8E93',
                                        title: t('accountOverview.items.preferences.title'),
                                        subtitle: t('accountOverview.items.preferences.subtitle'),
                                        onPress: () => toast.info(t('accountOverview.items.preferences.coming')),
                                    },
                                    {
                                        id: 'help-support',
                                        icon: 'help-circle',
                                        iconColor: '#007AFF',
                                        title: t('accountOverview.items.help.title'),
                                        subtitle: t('accountOverview.items.help.subtitle'),
                                        onPress: () => navigate?.('HelpSupport'),
                                    },
                                    {
                                        id: 'privacy-policy',
                                        icon: 'shield-checkmark',
                                        iconColor: '#30D158',
                                        title: t('accountOverview.items.privacyPolicy.title') || 'Privacy Policy',
                                        subtitle: t('accountOverview.items.privacyPolicy.subtitle') || 'How we handle your data',
                                        onPress: () => navigate?.('LegalDocuments', { initialStep: 1 }),
                                    },
                                    {
                                        id: 'terms-of-service',
                                        icon: 'document-text',
                                        iconColor: '#007AFF',
                                        title: t('accountOverview.items.termsOfService.title') || 'Terms of Service',
                                        subtitle: t('accountOverview.items.termsOfService.subtitle') || 'Terms and conditions of use',
                                        onPress: () => navigate?.('LegalDocuments', { initialStep: 2 }),
                                    },
                                    {
                                        id: 'connected-apps',
                                        icon: 'link',
                                        iconColor: '#32D74B',
                                        title: t('accountOverview.items.connectedApps.title'),
                                        subtitle: t('accountOverview.items.connectedApps.subtitle'),
                                        onPress: () => toast.info(t('accountOverview.items.connectedApps.coming')),
                                    },
                                    {
                                        id: 'about',
                                        icon: 'information-circle',
                                        iconColor: '#8E8E93',
                                        title: t('accountOverview.items.about.title'),
                                        subtitle: t('accountOverview.items.about.subtitle'),
                                        onPress: () => navigate?.('AppInfo'),
                                    },
                                ]}

                            />
                        </Section>

                        {/* Sign Out */}
                        <Section title={t('accountOverview.sections.actions')} >
                            <GroupedItem
                                icon="log-out"
                                iconColor="#FF3B30"
                                title={t('accountOverview.items.signOut.title')}
                                subtitle={t('accountOverview.items.signOut.subtitle')}

                                onPress={confirmLogout}
                                isFirst={true}
                                isLast={true}
                                showChevron={false}
                            />
                        </Section>
                    </AnimatedScrollView>
                </>
            ) : (
                <AnimatedScrollView
                    style={styles.content}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    onScroll={scrollHandler}
                    scrollEventThrottle={16}
                >
                    {/* Header - inside ScrollView for native sticky */}
                    <Header
                        title={t('accountOverview.title')}
                        onBack={onClose}
                        variant="minimal"
                        elevation="subtle"
                        scrollY={scrollY}
                    />
                    <View style={{ paddingTop: 8 }}>
                        {/* Centered Avatar and Name Header Section */}
                        {user && (
                            <View style={styles.headerSection}>
                                <View style={styles.avatarSectionWrapper}>
                                    <View style={styles.avatarContainer}>
                                        {LottieView && lottieAnimation && (
                                            <LottieView
                                                ref={lottieRef}
                                                source={lottieAnimation}
                                                style={styles.lottieBackground}
                                            />
                                        )}
                                        <TouchableOpacity
                                            style={styles.avatarWrapper}
                                            onPress={handleAvatarPress}
                                            activeOpacity={0.8}
                                        >
                                            <Avatar
                                                uri={avatarUrl}
                                                name={displayName}
                                                size={100}
                                                theme={theme}
                                            />
                                        </TouchableOpacity>
                                    </View>
                                    <View style={styles.nameWrapper}>
                                        <Text style={[styles.welcomeText, { color: themeStyles.textColor }]}>
                                            Welcome, {shortDisplayName}.
                                        </Text>
                                        <Text style={[styles.welcomeSubtext, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                            Manage your Oxy account.
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        )}

                        {/* User Profile Section */}
                        <Section title={t('accountOverview.sections.profile')} isFirst={true}>
                            <GroupedSection
                                items={[
                                    {
                                        id: 'profile-info',
                                        icon: 'person',
                                        iconColor: '#007AFF',
                                        title: displayName,
                                        subtitle: user ? (user.email || user.username) : (t('common.status.loading') || 'Loading...'),
                                        onPress: () => navigate?.('EditProfile', { activeTab: 'profile' }),
                                    },
                                ]}
                            />
                        </Section>

                        {/* Account Settings */}
                        <Section title={t('accountOverview.sections.accountSettings')} >
                            <GroupedSection
                                items={[
                                    {
                                        id: 'edit-profile',
                                        icon: 'person-circle',
                                        iconColor: '#007AFF',
                                        title: t('accountOverview.items.editProfile.title'),
                                        subtitle: t('accountOverview.items.editProfile.subtitle'),
                                        onPress: () => navigate?.('EditProfile', { activeTab: 'profile' }),
                                    },
                                    {
                                        id: 'security-privacy',
                                        icon: 'shield-checkmark',
                                        iconColor: '#30D158',
                                        title: t('accountOverview.items.security.title'),
                                        subtitle: t('accountOverview.items.security.subtitle'),
                                        onPress: () => navigate?.('EditProfile', { activeTab: 'password' }),
                                    },
                                    {
                                        id: 'notifications',
                                        icon: 'notifications',
                                        iconColor: '#FF9500',
                                        title: t('accountOverview.items.notifications.title'),
                                        subtitle: t('accountOverview.items.notifications.subtitle'),
                                        onPress: () => navigate?.('EditProfile', { activeTab: 'notifications' }),
                                    },
                                    {
                                        id: 'premium-subscription',
                                        icon: 'star',
                                        iconColor: '#FFD700',
                                        title: t('accountOverview.items.premium.title'),
                                        subtitle: user?.isPremium ? t('accountOverview.items.premium.manage') : t('accountOverview.items.premium.upgrade'),
                                        onPress: () => navigate?.('PremiumSubscription'),
                                    },
                                    ...(user?.isPremium ? [{
                                        id: 'billing-management',
                                        icon: 'card',
                                        iconColor: '#34C759',
                                        title: t('accountOverview.items.billing.title'),
                                        subtitle: t('accountOverview.items.billing.subtitle'),
                                        onPress: () => toast.info(t('accountOverview.items.billing.coming')),
                                    }] : []),
                                ]}
                            />
                        </Section>

                        {/* Additional Accounts */}
                        {showMoreAccounts && (
                            <Section title={`${t('accountOverview.sections.additionalAccounts') || 'Additional Accounts'}${additionalAccountsData.length > 0 ? ` (${additionalAccountsData.length})` : ''}`} >
                                {loadingAdditionalAccounts ? (
                                    <GroupedSection
                                        items={[
                                            {
                                                id: 'loading-accounts',
                                                icon: 'sync',
                                                iconColor: '#007AFF',
                                                title: t('accountOverview.loadingAdditional.title') || 'Loading accounts...',
                                                subtitle: t('accountOverview.loadingAdditional.subtitle') || 'Please wait while we load your additional accounts',
                                                customContent: (
                                                    <View style={styles.loadingContainer}>
                                                        <ActivityIndicator size="small" color="#007AFF" />
                                                        <Text style={styles.loadingText}>{t('accountOverview.loadingAdditional.title') || 'Loading accounts...'}</Text>
                                                    </View>
                                                ),
                                            },
                                        ]}
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
                                                toast.info(t('accountOverview.items.accountSwitcher.switchPrompt', { username: account.username }) || `Switch to ${account.username}?`);
                                            },
                                            customContent: (
                                                <>
                                                    <View style={styles.userIcon}>
                                                        {account.avatar ? (
                                                            <Image
                                                                source={{ uri: oxyServices.getFileDownloadUrl(account.avatar as string, 'thumb') }}
                                                                style={styles.accountAvatarImage}
                                                            />
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
                                    />
                                ) : (
                                    <GroupedSection
                                        items={[
                                            {
                                                id: 'no-accounts',
                                                icon: 'person-outline',
                                                iconColor: '#ccc',
                                                title: t('accountOverview.additional.noAccounts.title') || 'No other accounts',
                                                subtitle: t('accountOverview.additional.noAccounts.subtitle') || 'Add another account to switch between them',
                                            },
                                        ]}
                                    />
                                )}
                            </Section>
                        )}

                        {/* Account Management */}
                        {showMoreAccounts && (
                            <Section title={t('accountOverview.sections.accountManagement') || 'Account Management'} >
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'add-account',
                                            icon: 'add',
                                            iconColor: '#007AFF',
                                            title: t('accountOverview.items.addAccount.title') || 'Add Another Account',
                                            subtitle: t('accountOverview.items.addAccount.subtitle') || 'Sign in with a different account',
                                            onPress: handleAddAccount,
                                        },
                                        {
                                            id: 'sign-out-all',
                                            icon: 'log-out',
                                            iconColor: '#FF3B30',
                                            title: t('accountOverview.items.signOutAll.title') || 'Sign out of all accounts',
                                            subtitle: t('accountOverview.items.signOutAll.subtitle') || 'Remove all accounts from this device',
                                            onPress: handleSignOutAll,
                                        },
                                    ]}
                                />
                            </Section>
                        )}

                        {/* Quick Actions */}
                        <Section title={t('accountOverview.sections.quickActions')} >
                            <GroupedSection
                                items={[
                                    {
                                        id: 'account-switcher',
                                        icon: 'people',
                                        iconColor: '#5856D6',
                                        title: showMoreAccounts
                                            ? t('accountOverview.items.accountSwitcher.titleHide')
                                            : t('accountOverview.items.accountSwitcher.titleShow'),
                                        subtitle: showMoreAccounts
                                            ? t('accountOverview.items.accountSwitcher.subtitleHide')
                                            : additionalAccountsData.length > 0
                                                ? t('accountOverview.items.accountSwitcher.subtitleSwitchBetween', { count: String(additionalAccountsData.length + 1) })
                                                : loadingAdditionalAccounts
                                                    ? t('accountOverview.items.accountSwitcher.subtitleLoading')
                                                    : t('accountOverview.items.accountSwitcher.subtitleManageMultiple'),
                                        onPress: () => setShowMoreAccounts(!showMoreAccounts),
                                    },
                                    {
                                        id: 'history-view',
                                        icon: 'time',
                                        iconColor: '#007AFF',
                                        title: t('accountOverview.items.history.title') || 'History',
                                        subtitle: t('accountOverview.items.history.subtitle') || 'View and manage your search history',
                                        onPress: () => navigate?.('HistoryView'),
                                    },
                                    {
                                        id: 'saves-collections',
                                        icon: 'bookmark',
                                        iconColor: '#FF9500',
                                        title: t('accountOverview.items.saves.title') || 'Saves & Collections',
                                        subtitle: t('accountOverview.items.saves.subtitle') || 'View your saved items and collections',
                                        onPress: () => navigate?.('SavesCollections'),
                                    },
                                    {
                                        id: 'download-data',
                                        icon: 'download',
                                        iconColor: '#34C759',
                                        title: t('accountOverview.items.downloadData.title'),
                                        subtitle: t('accountOverview.items.downloadData.subtitle'),
                                        onPress: handleDownloadData,
                                    },
                                    {
                                        id: 'delete-account',
                                        icon: 'trash',
                                        iconColor: '#FF3B30',
                                        title: t('accountOverview.items.deleteAccount.title'),
                                        subtitle: t('accountOverview.items.deleteAccount.subtitle'),
                                        onPress: handleDeleteAccount,
                                    },
                                ]}
                            />
                        </Section>

                        {/* Support & Settings */}
                        <Section title={t('accountOverview.sections.support')} >
                            <GroupedSection
                                items={[
                                    {
                                        id: 'search-settings',
                                        icon: 'search',
                                        iconColor: '#007AFF',
                                        title: t('accountOverview.items.searchSettings.title') || 'Search Settings',
                                        subtitle: t('accountOverview.items.searchSettings.subtitle') || 'SafeSearch and personalization',
                                        onPress: () => navigate?.('SearchSettings'),
                                    },
                                    {
                                        id: 'language-settings',
                                        icon: 'language',
                                        iconColor: '#32D74B',
                                        title: t('accountOverview.items.language.title') || 'Language',
                                        subtitle: t('accountOverview.items.language.subtitle') || 'Choose your preferred language',
                                        onPress: () => navigate?.('LanguageSelector'),
                                    },
                                    {
                                        id: 'account-preferences',
                                        icon: 'settings',
                                        iconColor: '#8E8E93',
                                        title: t('accountOverview.items.preferences.title'),
                                        subtitle: t('accountOverview.items.preferences.subtitle'),
                                        onPress: () => toast.info(t('accountOverview.items.preferences.coming')),
                                    },
                                    {
                                        id: 'help-support',
                                        icon: 'help-circle',
                                        iconColor: '#007AFF',
                                        title: t('accountOverview.items.help.title'),
                                        subtitle: t('accountOverview.items.help.subtitle'),
                                        onPress: () => navigate?.('HelpSupport'),
                                    },
                                    {
                                        id: 'privacy-policy',
                                        icon: 'shield-checkmark',
                                        iconColor: '#30D158',
                                        title: t('accountOverview.items.privacyPolicy.title') || 'Privacy Policy',
                                        subtitle: t('accountOverview.items.privacyPolicy.subtitle') || 'How we handle your data',
                                        onPress: () => navigate?.('LegalDocuments', { initialStep: 1 }),
                                    },
                                    {
                                        id: 'terms-of-service',
                                        icon: 'document-text',
                                        iconColor: '#007AFF',
                                        title: t('accountOverview.items.termsOfService.title') || 'Terms of Service',
                                        subtitle: t('accountOverview.items.termsOfService.subtitle') || 'Terms and conditions of use',
                                        onPress: () => navigate?.('LegalDocuments', { initialStep: 2 }),
                                    },
                                    {
                                        id: 'connected-apps',
                                        icon: 'link',
                                        iconColor: '#32D74B',
                                        title: t('accountOverview.items.connectedApps.title'),
                                        subtitle: t('accountOverview.items.connectedApps.subtitle'),
                                        onPress: () => toast.info(t('accountOverview.items.connectedApps.coming')),
                                    },
                                    {
                                        id: 'about',
                                        icon: 'information-circle',
                                        iconColor: '#8E8E93',
                                        title: t('accountOverview.items.about.title'),
                                        subtitle: t('accountOverview.items.about.subtitle'),
                                        onPress: () => navigate?.('AppInfo'),
                                    },
                                ]}
                            />
                        </Section>

                        {/* Sign Out */}
                        <Section title={t('accountOverview.sections.actions')} >
                            <GroupedItem
                                icon="log-out"
                                iconColor="#FF3B30"
                                title={t('accountOverview.items.signOut.title')}
                                subtitle={t('accountOverview.items.signOut.subtitle')}
                                onPress={confirmLogout}
                                isFirst={true}
                                isLast={true}
                                showChevron={false}
                            />
                        </Section>
                    </View>
                </AnimatedScrollView>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
    },
    headerSection: {
        alignItems: 'center',
        marginBottom: 24,
        paddingTop: 16,
    },
    avatarSectionWrapper: {
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
    },
    avatarContainer: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
        width: 600,
        height: 100,
        overflow: 'hidden',
        alignSelf: 'center',
    },
    lottieBackground: {
        position: 'absolute',
        width: 600,
        height: 100,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 0,
    },
    avatarWrapper: {
        zIndex: 1,
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
        width: 100,
        height: 100,
        left: 250,
        top: 0,
    },
    nameWrapper: {
        marginTop: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    welcomeText: {
        fontSize: 24,
        fontWeight: '600',
        marginBottom: 8,
        fontFamily: fontFamilies.phuduBold,
    },
    welcomeSubtext: {
        fontSize: 16,
        fontWeight: '400',
        opacity: 0.6,
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

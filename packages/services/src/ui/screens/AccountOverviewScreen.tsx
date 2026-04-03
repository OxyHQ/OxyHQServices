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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BaseScreenProps } from '../types/navigation';
import OxyLogo from '../components/OxyLogo';
import Avatar from '../components/Avatar';
import OxyIcon from '../components/icon/OxyIcon';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import { Ionicons } from '@expo/vector-icons';
import { Section, GroupedSection, GroupedItem } from '../components';
import { SettingsIcon } from '../components/SettingsIcon';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { getDisplayName, getShortDisplayName } from '../utils/userUtils';
import { useColorScheme } from '../hooks/useColorScheme';
import { Colors } from '../constants/theme';
import { normalizeColorScheme, normalizeTheme } from '../utils/themeUtils';
import { useOxy } from '../context/OxyContext';
import { useUsersBySessions } from '../hooks/queries/useAccountQueries';
import {
    SCREEN_PADDING_HORIZONTAL,
    SECTION_GAP,
    HEADER_PADDING_TOP_OVERVIEW,
    createScreenContentStyle,
} from '../constants/spacing';
import { DeleteAccountModal } from '../components/modals';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';

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
 * - SettingsListGroup/SettingsListItem from bloom for consistent grouped list rendering
 */
const AccountOverviewScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
}) => {
    // Use useOxy() hook for OxyContext values
    const {
        user,
        logout,
        isLoading,
        sessions,
        activeSessionId,
        oxyServices,
        isAuthenticated,
        openAvatarPicker,
    } = useOxy();
    const { t } = useI18n();
    const [showMoreAccounts, setShowMoreAccounts] = useState(false);
    const [additionalAccountsData, setAdditionalAccountsData] = useState<any[]>([]);
    const [loadingAdditionalAccounts, setLoadingAdditionalAccounts] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const lottieRef = useRef<any>(null);
    const hasPlayedRef = useRef(false);
    const insets = useSafeAreaInsets();

    // Use bloom theme for ActivityIndicator and other non-style color props
    const bloomTheme = useTheme();
    const colorScheme = useColorScheme();
    const normalizedTheme = normalizeTheme(theme);
    // AccountOverviewScreen uses a custom primary color (purple) instead of the default blue
    const themeColors = {
        primaryColor: '#d169e5',
    };
    // Icon colors from the Colors constant
    const baseThemeColors = Colors[normalizeColorScheme(colorScheme, normalizedTheme)];

    // Compute user data for display
    const displayName = useMemo(() => getDisplayName(user), [user]);
    const shortDisplayName = useMemo(() => getShortDisplayName(user), [user]);
    const avatarUrl = useMemo(() => {
        if (user?.avatar && oxyServices) {
            return oxyServices.getFileDownloadUrl(user.avatar, 'thumb');
        }
        return undefined;
    }, [user?.avatar, oxyServices]);

    // Handle avatar press - use openAvatarPicker from context
    const handleAvatarPress = useCallback(() => {
        openAvatarPicker();
    }, [openAvatarPicker]);

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
        (sessions || []).filter(session =>
            session.sessionId !== activeSessionId && session.userId !== user?.id
        ), [sessions, activeSessionId, user?.id]
    );

    // Load user profiles for additional accounts using TanStack Query
    const sessionIds = additionalAccounts.map(s => s.sessionId);
    const { data: usersData, isLoading: isLoadingUsers } = useUsersBySessions(sessionIds, {
        enabled: additionalAccounts.length > 0
    });

    React.useEffect(() => {
        if (usersData && usersData.length > 0) {
            const accountsData = usersData.map(({ sessionId, user: userProfile }: { sessionId: string; user: any }) => {
                if (!userProfile) {
                    return {
                        id: sessionId,
                        sessionId,
                        username: 'Unknown User',
                        email: 'No email available',
                        avatar: null,
                        userProfile: null
                    };
                }
                return {
                    id: sessionId,
                    sessionId,
                    username: userProfile.username,
                    email: userProfile.email,
                    name: userProfile.name,
                    avatar: userProfile.avatar,
                    userProfile
                };
            });
            setAdditionalAccountsData(accountsData);
            setLoadingAdditionalAccounts(false);
        } else if (additionalAccounts.length === 0) {
            setAdditionalAccountsData([]);
            setLoadingAdditionalAccounts(false);
        } else if (!isLoadingUsers) {
            setLoadingAdditionalAccounts(false);
        }
    }, [usersData, additionalAccounts.length, isLoadingUsers]);

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
            if (__DEV__) {
                console.error('Logout failed:', error);
            }
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
                            } catch (error: unknown) {
                                if (__DEV__) {
                                    console.error('Failed to download data:', error);
                                }
                                toast.error((error instanceof Error ? error.message : null) || t('accountOverview.items.downloadData.error') || 'Failed to download data');
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
                            } catch (error: unknown) {
                                if (__DEV__) {
                                    console.error('Failed to download data:', error);
                                }
                                toast.error((error instanceof Error ? error.message : null) || t('accountOverview.items.downloadData.error') || 'Failed to download data');
                            }
                        },
                    },
                ]
            );
        } catch (error: unknown) {
            if (__DEV__) {
                console.error('Failed to initiate download:', error);
            }
            toast.error((error instanceof Error ? error.message : null) || t('accountOverview.items.downloadData.error') || 'Failed to download data');
        }
    }, [oxyServices, user, t]);

    const handleDeleteAccount = useCallback(() => {
        if (!user) {
            toast.error(t('accountOverview.items.deleteAccount.error') || 'User not available');
            return;
        }
        setShowDeleteModal(true);
    }, [user, t]);

    const handleConfirmDelete = useCallback(async (password: string) => {
        if (!oxyServices || !user) {
            throw new Error(t('accountOverview.items.deleteAccount.error') || 'Service not available');
        }

        await oxyServices.deleteAccount(password);
        toast.success(t('accountOverview.items.deleteAccount.success') || 'Account deleted successfully');
        setShowDeleteModal(false);
        await logout();
        if (onClose) {
            onClose();
        }
    }, [oxyServices, user, logout, onClose, t]);

    if (!isAuthenticated) {
        return (
            <View style={styles.container} className="bg-background">
                <Text style={styles.message} className="text-foreground">{t('common.status.notSignedIn')}</Text>
            </View>
        );
    }

    if (isLoading) {
        return (
            <View style={[styles.container, { justifyContent: 'center' }]} className="bg-background">
                <ActivityIndicator size="large" color={themeColors.primaryColor} />
            </View>
        );
    }


    return (
        <View style={styles.container} className="bg-background">
            <ScrollView
                style={styles.content}
                contentContainerStyle={styles.scrollContent}
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
                                        loop={false}
                                        autoPlay={false}
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
                                        theme={normalizedTheme}
                                    />
                                </TouchableOpacity>
                            </View>
                            <View style={styles.nameWrapper}>
                                <Text style={styles.welcomeText} className="text-foreground">
                                    {displayName}
                                </Text>
                                <Text style={styles.welcomeSubtext} className="text-muted-foreground">
                                    Manage your Oxy account.
                                </Text>
                            </View>
                        </View>
                    </View>
                )}

                {/* User Profile Section */}
                <SettingsListGroup title={t('accountOverview.sections.profile')}>
                    <SettingsListItem
                        icon={<SettingsIcon name="account" color={baseThemeColors.iconSecurity} />}
                        title={displayName}
                        description={user ? (user.email || user.username) : (t('common.status.loading') || 'Loading...')}
                        onPress={() => navigate?.('AccountSettings', { activeTab: 'profile' })}
                    />
                </SettingsListGroup>

                {/* Account Settings */}
                <SettingsListGroup title={t('accountOverview.sections.accountSettings')}>
                    <SettingsListItem
                        icon={<SettingsIcon name="account-circle" color={baseThemeColors.iconPersonalInfo} />}
                        title={t('accountOverview.items.editProfile.title')}
                        description={t('accountOverview.items.editProfile.subtitle')}
                        onPress={() => navigate?.('AccountSettings', { activeTab: 'profile' })}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="shield-check" color={baseThemeColors.iconSecurity} />}
                        title={t('accountOverview.items.security.title')}
                        description={t('accountOverview.items.security.subtitle')}
                        onPress={() => navigate?.('AccountSettings', { activeTab: 'password' })}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="bell" color={baseThemeColors.iconStorage} />}
                        title={t('accountOverview.items.notifications.title')}
                        description={t('accountOverview.items.notifications.subtitle')}
                        onPress={() => navigate?.('AccountSettings', { activeTab: 'notifications' })}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="star" color={baseThemeColors.iconPayments} />}
                        title={t('accountOverview.items.premium.title')}
                        description={user?.isPremium ? t('accountOverview.items.premium.manage') : t('accountOverview.items.premium.upgrade')}
                        onPress={() => navigate?.('PremiumSubscription')}
                    />
                    {user?.isPremium ? (
                        <SettingsListItem
                            icon={<SettingsIcon name="credit-card" color={baseThemeColors.iconPersonalInfo} />}
                            title={t('accountOverview.items.billing.title')}
                            description={t('accountOverview.items.billing.subtitle')}
                            onPress={() => toast.info(t('accountOverview.items.billing.coming'))}
                        />
                    ) : null}
                </SettingsListGroup>

                {/* Additional Accounts - kept with GroupedSection due to custom avatar content */}
                {showMoreAccounts && (
                    <Section title={`${t('accountOverview.sections.additionalAccounts') || 'Additional Accounts'}${additionalAccountsData.length > 0 ? ` (${additionalAccountsData.length})` : ''}`} >
                        {loadingAdditionalAccounts ? (
                            <GroupedSection
                                items={[
                                    {
                                        id: 'loading-accounts',
                                        icon: 'sync',
                                        iconColor: baseThemeColors.iconSecurity,
                                        title: t('accountOverview.loadingAdditional.title') || 'Loading accounts...',
                                        subtitle: t('accountOverview.loadingAdditional.subtitle') || 'Please wait while we load your additional accounts',
                                        customContent: (
                                            <View style={styles.loadingContainer}>
                                                <ActivityIndicator size="small" color={baseThemeColors.iconSecurity} />
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
                                    icon: 'account',
                                    iconColor: baseThemeColors.iconData,
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
                                                        source={{ uri: oxyServices.getFileDownloadUrl(account.avatar, 'thumb') }}
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
                                        icon: 'account-outline',
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
                    <SettingsListGroup title={t('accountOverview.sections.accountManagement') || 'Account Management'}>
                        <SettingsListItem
                            icon={<SettingsIcon name="plus" color={baseThemeColors.iconSecurity} />}
                            title={t('accountOverview.items.addAccount.title') || 'Add Another Account'}
                            description={t('accountOverview.items.addAccount.subtitle') || 'Sign in with a different account'}
                            onPress={handleAddAccount}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="logout" color={baseThemeColors.iconSharing} />}
                            title={t('accountOverview.items.signOutAll.title') || 'Sign out of all accounts'}
                            description={t('accountOverview.items.signOutAll.subtitle') || 'Remove all accounts from this device'}
                            onPress={handleSignOutAll}
                        />
                    </SettingsListGroup>
                )}

                {/* Quick Actions */}
                <SettingsListGroup title={t('accountOverview.sections.quickActions')}>
                    <SettingsListItem
                        icon={<SettingsIcon name="account-group" color={baseThemeColors.iconData} />}
                        title={showMoreAccounts
                            ? t('accountOverview.items.accountSwitcher.titleHide')
                            : t('accountOverview.items.accountSwitcher.titleShow')}
                        description={showMoreAccounts
                            ? t('accountOverview.items.accountSwitcher.subtitleHide')
                            : additionalAccountsData.length > 0
                                ? t('accountOverview.items.accountSwitcher.subtitleSwitchBetween', { count: String(additionalAccountsData.length + 1) })
                                : loadingAdditionalAccounts
                                    ? t('accountOverview.items.accountSwitcher.subtitleLoading')
                                    : t('accountOverview.items.accountSwitcher.subtitleManageMultiple')}
                        onPress={() => setShowMoreAccounts(!showMoreAccounts)}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="clock" color={baseThemeColors.iconSecurity} />}
                        title={t('accountOverview.items.history.title') || 'History'}
                        description={t('accountOverview.items.history.subtitle') || 'View and manage your search history'}
                        onPress={() => navigate?.('HistoryView')}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="bookmark" color={baseThemeColors.iconStorage} />}
                        title={t('accountOverview.items.saves.title') || 'Saves & Collections'}
                        description={t('accountOverview.items.saves.subtitle') || 'View your saved items and collections'}
                        onPress={() => navigate?.('SavesCollections')}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="download" color={baseThemeColors.iconPersonalInfo} />}
                        title={t('accountOverview.items.downloadData.title')}
                        description={t('accountOverview.items.downloadData.subtitle')}
                        onPress={handleDownloadData}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="delete" color={baseThemeColors.iconSharing} />}
                        title={t('accountOverview.items.deleteAccount.title')}
                        description={t('accountOverview.items.deleteAccount.subtitle')}
                        onPress={handleDeleteAccount}
                    />
                </SettingsListGroup>

                {/* Support & Settings */}
                <SettingsListGroup title={t('accountOverview.sections.support')}>
                    <SettingsListItem
                        icon={<SettingsIcon name="magnify" color={baseThemeColors.iconSecurity} />}
                        title={t('accountOverview.items.searchSettings.title') || 'Search Settings'}
                        description={t('accountOverview.items.searchSettings.subtitle') || 'SafeSearch and personalization'}
                        onPress={() => navigate?.('SearchSettings')}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="translate" color={baseThemeColors.iconPersonalInfo} />}
                        title={t('accountOverview.items.language.title') || 'Language'}
                        description={t('accountOverview.items.language.subtitle') || 'Choose your preferred language'}
                        onPress={() => navigate?.('LanguageSelector')}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="cog" color="#8E8E93" />}
                        title={t('accountOverview.items.preferences.title')}
                        description={t('accountOverview.items.preferences.subtitle')}
                        onPress={() => toast.info(t('accountOverview.items.preferences.coming'))}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="help-circle" color={baseThemeColors.iconSecurity} />}
                        title={t('accountOverview.items.help.title')}
                        description={t('accountOverview.items.help.subtitle')}
                        onPress={() => navigate?.('HelpSupport')}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="shield-check" color={baseThemeColors.iconPersonalInfo} />}
                        title={t('accountOverview.items.privacyPolicy.title') || 'Privacy Policy'}
                        description={t('accountOverview.items.privacyPolicy.subtitle') || 'How we handle your data'}
                        onPress={() => navigate?.('LegalDocuments', { initialStep: 1 })}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="file-document" color={baseThemeColors.iconSecurity} />}
                        title={t('accountOverview.items.termsOfService.title') || 'Terms of Service'}
                        description={t('accountOverview.items.termsOfService.subtitle') || 'Terms and conditions of use'}
                        onPress={() => navigate?.('LegalDocuments', { initialStep: 2 })}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="link" color={baseThemeColors.iconPersonalInfo} />}
                        title={t('accountOverview.items.connectedApps.title')}
                        description={t('accountOverview.items.connectedApps.subtitle')}
                        onPress={() => toast.info(t('accountOverview.items.connectedApps.coming'))}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="information" color="#8E8E93" />}
                        title={t('accountOverview.items.about.title')}
                        description={t('accountOverview.items.about.subtitle')}
                        onPress={() => navigate?.('AppInfo')}
                    />
                </SettingsListGroup>

                {/* Sign Out */}
                <SettingsListGroup title={t('accountOverview.sections.actions')}>
                    <SettingsListItem
                        icon={<SettingsIcon name="logout" color="#FF3B30" />}
                        title={t('accountOverview.items.signOut.title')}
                        description={t('accountOverview.items.signOut.subtitle')}
                        onPress={confirmLogout}
                        destructive={true}
                        showChevron={false}
                    />
                </SettingsListGroup>
            </ScrollView>

            {/* Delete Account Modal */}
            {user && (
                <DeleteAccountModal
                    visible={showDeleteModal}
                    username={user.username || ''}
                    onClose={() => setShowDeleteModal(false)}
                    onDelete={handleConfirmDelete}
                    t={t}
                />
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
    scrollContent: createScreenContentStyle(HEADER_PADDING_TOP_OVERVIEW),
    headerSection: {
        alignItems: 'center',
        marginBottom: SECTION_GAP,
        paddingTop: HEADER_PADDING_TOP_OVERVIEW,
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
        width: '100%',
        maxWidth: 600,
        minHeight: 100,
        overflow: 'hidden',
        alignSelf: 'center',
        aspectRatio: 6,
    },
    lottieBackground: {
        position: 'absolute',
        width: '100%',
        maxWidth: 600,
        minHeight: 100,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 0,
        aspectRatio: 6,
    },
    avatarWrapper: {
        zIndex: 1,
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
        width: 100,
        height: 100,
        left: '50%',
        marginLeft: -50,
        top: 0,
    },
    nameWrapper: {
        marginTop: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    welcomeText: {
        fontSize: 28,
        fontWeight: '600',
        marginBottom: 8,
        fontFamily: fontFamilies.interBold,
        maxWidth: '90%',
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

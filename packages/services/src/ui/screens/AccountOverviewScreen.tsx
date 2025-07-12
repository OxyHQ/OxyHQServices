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
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import OxyLogo from '../components/OxyLogo';
import Avatar from '../components/Avatar';
import OxyIcon from '../components/icon/OxyIcon';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import { Ionicons } from '@expo/vector-icons';

/**
 * AccountOverviewScreen - Optimized for performance
 * 
 * Performance optimizations implemented:
 * - useMemo for theme calculations (only recalculates when theme changes)
 * - useMemo for additional accounts filtering (only recalculates when dependencies change)
 * - useCallback for event handlers to prevent unnecessary re-renders
 * - React.memo wrapper to prevent re-renders when props haven't changed
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
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Account</Text>
                {onClose && (
                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <Text style={styles.closeButtonText}>×</Text>
                    </TouchableOpacity>
                )}
            </View>

            <ScrollView style={styles.content}>
                {/* User Profile Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Profile</Text>

                    <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}>
                        <View style={styles.userIcon}>
                            <Avatar
                                uri={user?.avatar?.url}
                                name={user?.name?.full}
                                size={40}
                                theme={theme}
                            />
                        </View>
                        <View style={styles.settingInfo}>
                            <View>
                                <Text style={styles.settingLabel}>
                                    {user ? (typeof user.name === 'string' ? user.name : user.name?.full || user.name?.first || user.username) : 'Loading...'}
                                </Text>
                                <Text style={styles.settingDescription}>{user ? (user.email || user.username) : 'Loading...'}</Text>
                            </View>
                        </View>
                        <TouchableOpacity
                            style={styles.manageButton}
                            onPress={() => toast.info('Manage your Oxy Account feature coming soon!')}
                        >
                            <Text style={styles.manageButtonText}>Manage</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Account Settings */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Account Settings</Text>

                    <TouchableOpacity
                        style={[styles.settingItem, styles.firstSettingItem]}
                        onPress={() => navigate?.('AccountSettings', { activeTab: 'profile' })}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="person-circle" size={20} color="#007AFF" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Edit Profile</Text>
                                <Text style={styles.settingDescription}>Update your personal information</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.settingItem}
                        onPress={() => navigate?.('AccountSettings', { activeTab: 'password' })}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="shield-checkmark" size={20} color="#30D158" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Security & Privacy</Text>
                                <Text style={styles.settingDescription}>Password, 2FA, and privacy settings</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.settingItem}
                        onPress={() => navigate?.('AccountSettings', { activeTab: 'notifications' })}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="notifications" size={20} color="#FF9500" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Notifications</Text>
                                <Text style={styles.settingDescription}>Manage your notification preferences</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.settingItem]}
                        onPress={() => navigate?.('PremiumSubscription')}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="star" size={20} color="#FFD700" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Oxy+ Subscriptions</Text>
                                <Text style={styles.settingDescription}>{user?.isPremium ? 'Manage your premium plan' : 'Upgrade to premium features'}</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    {user?.isPremium && (
                        <TouchableOpacity
                            style={[styles.settingItem, styles.lastSettingItem]}
                        >
                            <View style={styles.settingInfo}>
                                <OxyIcon name="card" size={20} color="#34C759" style={styles.settingIcon} />
                                <View>
                                    <Text style={styles.settingLabel}>Billing Management</Text>
                                    <Text style={styles.settingDescription}>Payment methods and invoices</Text>
                                </View>
                            </View>
                            <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Additional Accounts */}
                {showMoreAccounts && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Additional Accounts{additionalAccountsData.length > 0 ? ` (${additionalAccountsData.length})` : ''}</Text>

                        {loadingAdditionalAccounts ? (
                            <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}>
                                <View style={styles.loadingContainer}>
                                    <ActivityIndicator size="small" color="#007AFF" />
                                    <Text style={styles.loadingText}>Loading accounts...</Text>
                                </View>
                            </View>
                        ) : additionalAccountsData.length > 0 ? (
                            <>
                                {additionalAccountsData.map((account, index) => (
                                    <TouchableOpacity
                                        key={account.id}
                                        style={[
                                            styles.settingItem,
                                            index === 0 && styles.firstSettingItem,
                                            index === additionalAccountsData.length - 1 && styles.lastSettingItem
                                        ]}
                                        onPress={() => {
                                            toast.info(`Switch to ${account.username}?`);
                                            // TODO: Implement account switching logic
                                            // switchSession(account.sessionId);
                                        }}
                                    >
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
                                        <View style={styles.settingInfo}>
                                            <View>
                                                <Text style={styles.settingLabel}>
                                                    {typeof account.name === 'object'
                                                        ? account.name?.full || account.name?.first || account.username
                                                        : account.name || account.username
                                                    }
                                                </Text>
                                                <Text style={styles.settingDescription}>{account.email || account.username}</Text>
                                            </View>
                                        </View>
                                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                                    </TouchableOpacity>
                                ))}
                            </>
                        ) : (
                            <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}>
                                <View style={styles.settingInfo}>
                                    <OxyIcon name="person-outline" size={20} color="#ccc" style={styles.settingIcon} />
                                    <View>
                                        <Text style={styles.settingLabel}>No other accounts</Text>
                                        <Text style={styles.settingDescription}>Add another account to switch between them</Text>
                                    </View>
                                </View>
                            </View>
                        )}
                    </View>
                )}

                {/* Account Management */}
                {showMoreAccounts && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Account Management</Text>

                        <TouchableOpacity
                            style={[styles.settingItem, styles.firstSettingItem]}
                            onPress={handleAddAccount}
                        >
                            <View style={styles.settingInfo}>
                                <OxyIcon name="add" size={20} color="#007AFF" style={styles.settingIcon} />
                                <View>
                                    <Text style={styles.settingLabel}>Add another account</Text>
                                    <Text style={styles.settingDescription}>Sign in with a different account</Text>
                                </View>
                            </View>
                            <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.settingItem, styles.lastSettingItem]}
                            onPress={handleSignOutAll}
                        >
                            <View style={styles.settingInfo}>
                                <OxyIcon name="log-out" size={20} color="#FF3B30" style={styles.settingIcon} />
                                <View>
                                    <Text style={styles.settingLabel}>Sign out of all accounts</Text>
                                    <Text style={styles.settingDescription}>Remove all accounts from this device</Text>
                                </View>
                            </View>
                            <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                        </TouchableOpacity>
                    </View>
                )}

                {/* Quick Actions */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Quick Actions</Text>

                    <TouchableOpacity
                        style={[styles.settingItem, styles.firstSettingItem]}
                        onPress={() => setShowMoreAccounts(!showMoreAccounts)}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="people" size={20} color="#5856D6" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>
                                    {showMoreAccounts ? 'Hide' : 'Show'} Account Switcher
                                </Text>
                                <Text style={styles.settingDescription}>
                                    {showMoreAccounts
                                        ? 'Hide account switcher'
                                        : additionalAccountsData.length > 0
                                            ? `Switch between ${additionalAccountsData.length + 1} accounts`
                                            : loadingAdditionalAccounts
                                                ? 'Loading additional accounts...'
                                                : 'Manage multiple accounts'
                                    }
                                </Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.settingItem}
                        onPress={() => toast.info('Download account data feature coming soon!')}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="download" size={20} color="#34C759" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Download My Data</Text>
                                <Text style={styles.settingDescription}>Export your account information</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.settingItem, styles.lastSettingItem]}
                        onPress={() => toast.info('Delete account feature coming soon!')}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="trash" size={20} color="#FF3B30" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Delete Account</Text>
                                <Text style={styles.settingDescription}>Permanently delete your account</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>
                </View>

                {/* Support & Settings */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Support & Settings</Text>

                    <TouchableOpacity
                        style={[styles.settingItem, styles.firstSettingItem]}
                        onPress={() => toast.info('Account preferences coming soon!')}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="settings" size={20} color="#8E8E93" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Account Preferences</Text>
                                <Text style={styles.settingDescription}>Customize your account experience</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.settingItem}
                        onPress={() => toast.info('Help & support feature coming soon!')}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="help-circle" size={20} color="#007AFF" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Help & Support</Text>
                                <Text style={styles.settingDescription}>Get help with your account</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.settingItem}
                        onPress={() => toast.info('Connected apps feature coming soon!')}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="link" size={20} color="#32D74B" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Connected Apps</Text>
                                <Text style={styles.settingDescription}>Manage third-party app access</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.settingItem}
                        onPress={() => toast.info('Privacy Policy feature coming soon!')}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="document-lock" size={20} color="#FF9F0A" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Privacy Policy</Text>
                                <Text style={styles.settingDescription}>Learn about data protection</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.settingItem, styles.lastSettingItem]}
                        onPress={() => toast.info('Terms of Service feature coming soon!')}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="document-text" size={20} color="#5856D6" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Terms of Service</Text>
                                <Text style={styles.settingDescription}>Read our terms and conditions</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>
                </View>

                {/* Sign Out */}
                <View style={styles.section}>
                    <TouchableOpacity
                        style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem, styles.signOutButton]}
                        onPress={confirmLogout}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="log-out" size={20} color="#ff4757" style={styles.settingIcon} />
                            <View>
                                <Text style={[styles.settingLabel, { color: '#ff4757' }]}>Sign Out</Text>
                                <Text style={styles.settingDescription}>Sign out of your account</Text>
                            </View>
                        </View>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f2f2f2',
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 60,
        paddingBottom: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000',
    },
    closeButton: {
        padding: 8,
    },
    closeButtonText: {
        fontSize: 24,
        color: '#000',
        fontWeight: '300',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
    },
    settingItem: {
        backgroundColor: '#fff',
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    firstSettingItem: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    lastSettingItem: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 8,
    },
    settingInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    settingIcon: {
        marginRight: 12,
    },
    settingLabel: {
        fontSize: 16,
        fontWeight: '500',
        color: '#333',
        marginBottom: 2,
    },
    settingDescription: {
        fontSize: 14,
        color: '#666',
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
    signOutButton: {
        borderWidth: 1,
        borderColor: '#ff4757',
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

import React, { useState } from 'react';
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

const AccountOverviewScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
}) => {
    const { user, logout, isLoading } = useOxy();
    const [showMoreAccounts, setShowMoreAccounts] = useState(false);

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#F5F5F5';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';
    const primaryColor = '#d169e5';
    const dangerColor = '#D32F2F';
    const iconColor = isDarkTheme ? '#BBBBBB' : '#666666';

    // Mock additional accounts (for demo purposes)
    const additionalAccounts = [
        {
            id: '2',
            username: 'Albert Isern Alvarez',
            email: 'albert.isern.alvarez@gmail.com',
            avatar: {
                url: 'https://example.com/avatar2.jpg',
            }
        }
    ];

    // Feature settings (with mock values)
    const features = {
        safeSearch: false,
        language: 'English',
    };

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

    const handleAddAccount = () => {
        toast.info('Add another account feature coming soon!');
    };

    const handleSignOutAll = () => {
        Alert.alert(
            'Sign Out of All Accounts',
            'Are you sure you want to sign out of all accounts?',
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Sign Out All',
                    onPress: handleLogout,
                    style: 'destructive',
                },
            ],
            { cancelable: true }
        );
    };

    if (!user) {
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
                                    {typeof user.name === 'string' ? user.name : user.name?.full || user.name?.first || user.username}
                                </Text>
                                <Text style={styles.settingDescription}>{user.email || user.username}</Text>
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
                        onPress={() => toast.info('Edit profile feature coming soon!')}
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
                        onPress={() => toast.info('Account security feature coming soon!')}
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
                        onPress={() => toast.info('Notification preferences coming soon!')}
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
                        style={[styles.settingItem, styles.lastSettingItem]}
                        onPress={() => toast.info('Subscription management coming soon!')}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="card" size={20} color="#5856D6" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Subscription & Billing</Text>
                                <Text style={styles.settingDescription}>Manage your subscription and payments</Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>
                </View>

                {/* Additional Accounts */}
                {showMoreAccounts && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Additional Accounts</Text>
                        
                        {additionalAccounts.map((account) => (
                            <TouchableOpacity
                                key={account.id}
                                style={[styles.settingItem, styles.firstSettingItem]}
                                onPress={() => toast.info(`Switch to ${account.username}?`)}
                            >
                                <View style={styles.userIcon}>
                                    {account.avatar.url ? (
                                        <Image source={{ uri: account.avatar.url }} style={styles.accountAvatarImage} />
                                    ) : (
                                        <View style={styles.accountAvatarFallback}>
                                            <Text style={styles.accountAvatarText}>
                                                {account.username.charAt(0).toUpperCase()}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                                <View style={styles.settingInfo}>
                                    <View>
                                        <Text style={styles.settingLabel}>{account.username}</Text>
                                        <Text style={styles.settingDescription}>{account.email}</Text>
                                    </View>
                                </View>
                                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                            </TouchableOpacity>
                        ))}

                        <TouchableOpacity
                            style={styles.settingItem}
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
                                    {showMoreAccounts ? 'Hide' : 'Switch between'} multiple accounts
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
});

export default AccountOverviewScreen;

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
    TextStyle,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';
import { packageInfo } from '../../constants/version';
import { toast } from '../../lib/sonner';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';

const AccountCenterScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
}) => {
    const { user, logout, isLoading, sessions } = useOxy();

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#F5F5F5';
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
        <View style={[styles.container, { backgroundColor }]}>
            {/* Header with user profile */}
            <View style={[styles.header, { borderBottomColor: borderColor }]}>
                <View style={styles.userProfile}>
                    <Avatar
                        uri={user?.avatar?.url}
                        name={user?.name?.full || user?.username}
                        size={60}
                        theme={theme}
                    />
                    <View style={styles.userInfo}>
                        <Text style={[styles.userName, { color: textColor }]}>{user.username}</Text>
                        {user.email && (
                            <Text style={[styles.userEmail, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                {user.email}
                            </Text>
                        )}
                        <TouchableOpacity 
                            style={styles.editProfileButton}
                            onPress={() => navigate('AccountSettings', { activeTab: 'profile' })}
                        >
                            <Text style={[styles.editProfileText, { color: primaryColor }]}>Edit Profile</Text>
                        </TouchableOpacity>
                    </View>
                </View>
                {onClose && (
                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <Ionicons name="close" size={24} color={textColor} />
                    </TouchableOpacity>
                )}
            </View>

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                {/* Quick Actions */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: textColor }]}>Quick Actions</Text>
                    <View style={styles.quickActionsGrid}>
                        <TouchableOpacity
                            style={[styles.quickActionCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}
                            onPress={() => navigate('AccountOverview')}
                        >
                            <Ionicons name="person-circle" size={24} color="#007AFF" />
                            <Text style={[styles.quickActionText, { color: textColor }]}>Overview</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.quickActionCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}
                            onPress={() => navigate('AccountSettings')}
                        >
                            <Ionicons name="settings" size={24} color="#5856D6" />
                            <Text style={[styles.quickActionText, { color: textColor }]}>Settings</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.quickActionCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}
                            onPress={() => navigate('SessionManagement')}
                        >
                            <Ionicons name="shield-checkmark" size={24} color="#30D158" />
                            <Text style={[styles.quickActionText, { color: textColor }]}>Sessions</Text>
                        </TouchableOpacity>

                        {sessions && sessions.length > 1 && (
                            <TouchableOpacity
                                style={[styles.quickActionCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}
                                onPress={() => navigate('AccountSwitcher')}
                            >
                                <Ionicons name="swap-horizontal" size={24} color="#FF9500" />
                                <Text style={[styles.quickActionText, { color: textColor }]}>Switch</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>

                {/* Account Management */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: textColor }]}>Account Management</Text>
                    
                    {/* Show Account Switcher if multiple sessions exist */}
                    {sessions && sessions.length > 1 && (
                        <TouchableOpacity
                            style={[styles.actionButton, { borderColor, backgroundColor: secondaryBackgroundColor }]}
                            onPress={() => navigate('AccountSwitcher')}
                        >
                            <View style={styles.actionButtonContent}>
                                <Ionicons name="people" size={20} color="#FF9500" style={styles.actionIcon} />
                                <View style={styles.actionTextContainer}>
                                    <Text style={[styles.actionButtonText, { color: textColor }]}>
                                        Switch Account
                                    </Text>
                                    <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        {sessions.length} accounts available
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
                            </View>
                        </TouchableOpacity>
                    )}

                    {/* Add Account Overview button for comprehensive account view */}
                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor, backgroundColor: secondaryBackgroundColor }]}
                        onPress={() => navigate('AccountOverview')}
                    >
                        <View style={styles.actionButtonContent}>
                            <Ionicons name="person-circle" size={20} color="#007AFF" style={styles.actionIcon} />
                            <View style={styles.actionTextContainer}>
                                <Text style={[styles.actionButtonText, { color: textColor }]}>Account Overview</Text>
                                <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Complete account information
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
                        </View>
                    </TouchableOpacity>

                    {/* Add Account button - always shown for multi-user functionality */}
                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor, backgroundColor: secondaryBackgroundColor }]}
                        onPress={() => navigate('SignIn')}
                    >
                        <View style={styles.actionButtonContent}>
                            <Ionicons name="person-add" size={20} color="#30D158" style={styles.actionIcon} />
                            <View style={styles.actionTextContainer}>
                                <Text style={[styles.actionButtonText, { color: textColor }]}>Add Another Account</Text>
                                <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Sign in with a different account
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
                        </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor, backgroundColor: secondaryBackgroundColor }]}
                        onPress={() => navigate('AccountSettings')}
                    >
                        <View style={styles.actionButtonContent}>
                            <Ionicons name="settings" size={20} color="#5856D6" style={styles.actionIcon} />
                            <View style={styles.actionTextContainer}>
                                <Text style={[styles.actionButtonText, { color: textColor }]}>Account Settings</Text>
                                <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Manage your preferences
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
                        </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor, backgroundColor: secondaryBackgroundColor }]}
                        onPress={() => navigate('SessionManagement')}
                    >
                        <View style={styles.actionButtonContent}>
                            <Ionicons name="shield-checkmark" size={20} color="#30D158" style={styles.actionIcon} />
                            <View style={styles.actionTextContainer}>
                                <Text style={[styles.actionButtonText, { color: textColor }]}>Manage Sessions</Text>
                                <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Security and active devices
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
                        </View>
                    </TouchableOpacity>
                </View>

                {/* Additional Options */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: textColor }]}>More Options</Text>

                    {Platform.OS !== 'web' && (
                        <TouchableOpacity
                            style={[styles.actionButton, { borderColor, backgroundColor: secondaryBackgroundColor }]}
                            onPress={() => toast.info('Notifications feature coming soon!')}
                        >
                            <View style={styles.actionButtonContent}>
                                <Ionicons name="notifications" size={20} color="#FF9500" style={styles.actionIcon} />
                                <View style={styles.actionTextContainer}>
                                    <Text style={[styles.actionButtonText, { color: textColor }]}>Notifications</Text>
                                    <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                        Manage notification settings
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
                            </View>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor, backgroundColor: secondaryBackgroundColor }]}
                        onPress={() => toast.info('Help & Support feature coming soon!')}
                    >
                        <View style={styles.actionButtonContent}>
                            <Ionicons name="help-circle" size={20} color="#007AFF" style={styles.actionIcon} />
                            <View style={styles.actionTextContainer}>
                                <Text style={[styles.actionButtonText, { color: textColor }]}>Help & Support</Text>
                                <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Get help and contact support
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
                        </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor, backgroundColor: secondaryBackgroundColor }]}
                        onPress={() => navigate('AppInfo')}
                    >
                        <View style={styles.actionButtonContent}>
                            <Ionicons name="information-circle" size={20} color="#8E8E93" style={styles.actionIcon} />
                            <View style={styles.actionTextContainer}>
                                <Text style={[styles.actionButtonText, { color: textColor }]}>App Information</Text>
                                <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    Version and system details
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
                        </View>
                    </TouchableOpacity>
                </View>

                {/* Sign Out Section */}
                <View style={styles.section}>
                    <TouchableOpacity
                        style={[styles.logoutButton, { backgroundColor: isDarkTheme ? '#400000' : '#FFEBEE', borderColor: dangerColor }]}
                        onPress={confirmLogout}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <ActivityIndicator color={dangerColor} size="small" />
                        ) : (
                            <View style={styles.logoutContent}>
                                <Ionicons name="log-out" size={20} color={dangerColor} style={styles.actionIcon} />
                                <Text style={[styles.logoutButtonText, { color: dangerColor }]}>Sign Out</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>

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
    header: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    userProfile: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    userInfo: {
        marginLeft: 16,
        flex: 1,
    },
    userName: {
        fontSize: 22,
        fontWeight: 'bold',
        fontFamily: fontFamilies.phuduBold,
        marginBottom: 4,
    },
    userEmail: {
        fontSize: 14,
        marginBottom: 8,
    },
    editProfileButton: {
        alignSelf: 'flex-start',
    },
    editProfileText: {
        fontSize: 14,
        fontWeight: '600',
    },
    closeButton: {
        padding: 8,
    },
    scrollView: {
        flex: 1,
    },
    scrollContainer: {
        paddingBottom: 20,
    },
    section: {
        marginTop: 24,
        paddingHorizontal: 20,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 16,
    },
    quickActionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -6,
    },
    quickActionCard: {
        width: '23%',
        aspectRatio: 1,
        marginHorizontal: '1%',
        marginBottom: 12,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
    },
    quickActionText: {
        fontSize: 12,
        fontWeight: '500',
        marginTop: 6,
        textAlign: 'center',
    },
    actionButton: {
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 12,
        overflow: 'hidden',
    },
    actionButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    actionIcon: {
        marginRight: 12,
    },
    actionTextContainer: {
        flex: 1,
    },
    actionButtonText: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 2,
    },
    actionButtonSubtext: {
        fontSize: 13,
        lineHeight: 18,
    },
    logoutButton: {
        borderRadius: 12,
        borderWidth: 1,
        marginTop: 8,
        overflow: 'hidden',
    },
    logoutContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    logoutButtonText: {
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    versionContainer: {
        alignItems: 'center',
        marginTop: 20,
        paddingHorizontal: 20,
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

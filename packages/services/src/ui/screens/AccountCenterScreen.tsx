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
                    
                    <View style={[
                        styles.quickActionsContainer,
                        styles.firstGroupedItem,
                        styles.lastGroupedItem,
                        { backgroundColor: secondaryBackgroundColor }
                    ]}>
                        <View style={styles.quickActionsRow}>
                            <View style={styles.quickActionItem}>
                                <TouchableOpacity
                                    style={[
                                        styles.quickActionCircle,
                                        { backgroundColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.03)' }
                                    ]}
                                    onPress={() => navigate('AccountOverview')}
                                >
                                    <Ionicons name="person-circle" size={24} color="#007AFF" />
                                </TouchableOpacity>
                                <Text style={[styles.quickActionText, { color: textColor }]}>Overview</Text>
                            </View>

                            <View style={styles.quickActionItem}>
                                <TouchableOpacity
                                    style={[
                                        styles.quickActionCircle,
                                        { backgroundColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.03)' }
                                    ]}
                                    onPress={() => navigate('AccountSettings')}
                                >
                                    <Ionicons name="settings" size={24} color="#5856D6" />
                                </TouchableOpacity>
                                <Text style={[styles.quickActionText, { color: textColor }]}>Settings</Text>
                            </View>

                            <View style={styles.quickActionItem}>
                                <TouchableOpacity
                                    style={[
                                        styles.quickActionCircle,
                                        { backgroundColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.03)' }
                                    ]}
                                    onPress={() => navigate('SessionManagement')}
                                >
                                    <Ionicons name="shield-checkmark" size={24} color="#30D158" />
                                </TouchableOpacity>
                                <Text style={[styles.quickActionText, { color: textColor }]}>Sessions</Text>
                            </View>

                            <View style={styles.quickActionItem}>
                                <TouchableOpacity
                                    style={[
                                        styles.quickActionCircle,
                                        { backgroundColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.03)' }
                                    ]}
                                    onPress={() => navigate('PremiumSubscription')}
                                >
                                    <Ionicons name="star" size={24} color="#FFD700" />
                                </TouchableOpacity>
                                <Text style={[styles.quickActionText, { color: textColor }]}>Premium</Text>
                            </View>

                            {user?.isPremium && (
                                <View style={styles.quickActionItem}>
                                    <TouchableOpacity
                                        style={[
                                            styles.quickActionCircle,
                                            { backgroundColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.03)' }
                                        ]}
                                        onPress={() => navigate('BillingManagement')}
                                    >
                                        <Ionicons name="card" size={24} color="#34C759" />
                                    </TouchableOpacity>
                                    <Text style={[styles.quickActionText, { color: textColor }]}>Billing</Text>
                                </View>
                            )}

                            {sessions && sessions.length > 1 && (
                                <View style={styles.quickActionItem}>
                                    <TouchableOpacity
                                        style={[
                                            styles.quickActionCircle,
                                            { backgroundColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.03)' }
                                        ]}
                                        onPress={() => navigate('AccountSwitcher')}
                                    >
                                        <Ionicons name="swap-horizontal" size={24} color="#FF9500" />
                                    </TouchableOpacity>
                                    <Text style={[styles.quickActionText, { color: textColor }]}>Switch</Text>
                                </View>
                            )}
                        </View>
                    </View>
                </View>

                {/* Account Management */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: textColor }]}>Account Management</Text>
                    
                    {/* Create grouped items array for proper styling */}
                    {(() => {
                        const groupedItems = [];
                        
                        // Account Overview
                        groupedItems.push(
                            <TouchableOpacity
                                key="overview"
                                style={[
                                    styles.groupedItem,
                                    styles.firstGroupedItem,
                                    { backgroundColor: secondaryBackgroundColor }
                                ]}
                                onPress={() => navigate('AccountOverview')}
                            >
                                <View style={styles.groupedItemContent}>
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
                        );

                        // Account Settings
                        groupedItems.push(
                            <TouchableOpacity
                                key="settings"
                                style={[
                                    styles.groupedItem,
                                    { backgroundColor: secondaryBackgroundColor }
                                ]}
                                onPress={() => navigate('AccountSettings')}
                            >
                                <View style={styles.groupedItemContent}>
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
                        );

                        // Session Management
                        groupedItems.push(
                            <TouchableOpacity
                                key="sessions"
                                style={[
                                    styles.groupedItem,
                                    { backgroundColor: secondaryBackgroundColor }
                                ]}
                                onPress={() => navigate('SessionManagement')}
                            >
                                <View style={styles.groupedItemContent}>
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
                        );

                        // Premium Subscription
                        groupedItems.push(
                            <TouchableOpacity
                                key="premium"
                                style={[
                                    styles.groupedItem,
                                    user?.isPremium ? {} : styles.lastGroupedItem,
                                    { backgroundColor: secondaryBackgroundColor }
                                ]}
                                onPress={() => navigate('PremiumSubscription')}
                            >
                                <View style={styles.groupedItemContent}>
                                    <Ionicons name="star" size={20} color="#FFD700" style={styles.actionIcon} />
                                    <View style={styles.actionTextContainer}>
                                        <Text style={[styles.actionButtonText, { color: textColor }]}>Oxy+ Subscriptions</Text>
                                        <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                            {user.isPremium ? 'Manage your premium plan' : 'Upgrade to premium features'}
                                        </Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
                                </View>
                            </TouchableOpacity>
                        );

                        // Billing Management (only for premium users)
                        if (user?.isPremium) {
                            groupedItems.push(
                                <TouchableOpacity
                                    key="billing"
                                    style={[
                                        styles.groupedItem,
                                        styles.lastGroupedItem,
                                        { backgroundColor: secondaryBackgroundColor }
                                    ]}
                                    onPress={() => navigate('BillingManagement')}
                                >
                                    <View style={styles.groupedItemContent}>
                                        <Ionicons name="card" size={20} color="#34C759" style={styles.actionIcon} />
                                        <View style={styles.actionTextContainer}>
                                            <Text style={[styles.actionButtonText, { color: textColor }]}>Billing Management</Text>
                                            <Text style={[styles.actionButtonSubtext, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                                Payment methods and invoices
                                            </Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={16} color={isDarkTheme ? '#666666' : '#999999'} />
                                    </View>
                                </TouchableOpacity>
                            );
                        }

                        return groupedItems;
                    })()}
                </View>

                {/* Multi-Account Management */}
                {sessions && sessions.length > 1 && (
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: textColor }]}>Multi-Account</Text>
                        
                        <TouchableOpacity
                            style={[
                                styles.groupedItem,
                                styles.firstGroupedItem,
                                { backgroundColor: secondaryBackgroundColor }
                            ]}
                            onPress={() => navigate('AccountSwitcher')}
                        >
                            <View style={styles.groupedItemContent}>
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

                        <TouchableOpacity
                            style={[
                                styles.groupedItem,
                                styles.lastGroupedItem,
                                { backgroundColor: secondaryBackgroundColor }
                            ]}
                            onPress={() => navigate('SignIn')}
                        >
                            <View style={styles.groupedItemContent}>
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
                    </View>
                )}

                {/* Single Account Setup */}
                {(!sessions || sessions.length <= 1) && (
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: textColor }]}>Add Account</Text>
                        
                        <TouchableOpacity
                            style={[
                                styles.groupedItem,
                                styles.firstGroupedItem,
                                styles.lastGroupedItem,
                                { backgroundColor: secondaryBackgroundColor }
                            ]}
                            onPress={() => navigate('SignIn')}
                        >
                            <View style={styles.groupedItemContent}>
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
                    </View>
                )}

                {/* Additional Options */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: textColor }]}>More Options</Text>

                    {(() => {
                        const additionalItems = [];

                        // Notifications (for non-web platforms)
                        if (Platform.OS !== 'web') {
                            additionalItems.push(
                                <TouchableOpacity
                                    key="notifications"
                                    style={[
                                        styles.groupedItem,
                                        styles.firstGroupedItem,
                                        { backgroundColor: secondaryBackgroundColor }
                                    ]}
                                    onPress={() => toast.info('Notifications feature coming soon!')}
                                >
                                    <View style={styles.groupedItemContent}>
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
                            );
                        }

                        // Help & Support
                        additionalItems.push(
                            <TouchableOpacity
                                key="help"
                                style={[
                                    styles.groupedItem,
                                    Platform.OS === 'web' ? styles.firstGroupedItem : {},
                                    { backgroundColor: secondaryBackgroundColor }
                                ]}
                                onPress={() => toast.info('Help & Support feature coming soon!')}
                            >
                                <View style={styles.groupedItemContent}>
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
                        );

                        // App Information
                        additionalItems.push(
                            <TouchableOpacity
                                key="appinfo"
                                style={[
                                    styles.groupedItem,
                                    styles.lastGroupedItem,
                                    { backgroundColor: secondaryBackgroundColor }
                                ]}
                                onPress={() => navigate('AppInfo')}
                            >
                                <View style={styles.groupedItemContent}>
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
                        );

                        return additionalItems;
                    })()}
                </View>

                {/* Sign Out Section */}
                <View style={styles.section}>
                    <TouchableOpacity
                        style={[
                            styles.groupedItem,
                            styles.firstGroupedItem,
                            styles.lastGroupedItem,
                            { 
                                backgroundColor: isDarkTheme ? '#2C1810' : '#FEF7F0',
                                borderWidth: 1,
                                borderColor: isDarkTheme ? '#8B4513' : dangerColor,
                            }
                        ]}
                        onPress={confirmLogout}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <View style={styles.groupedItemContent}>
                                <ActivityIndicator color={dangerColor} size="small" style={styles.actionIcon} />
                                <Text style={[styles.logoutButtonText, { color: dangerColor }]}>Signing out...</Text>
                            </View>
                        ) : (
                            <View style={styles.groupedItemContent}>
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
        padding: 16,
        paddingBottom: 20,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 12,
    },
    quickActionsContainer: {
        padding: 16,
        marginBottom: 8,
    },
    quickActionsRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-around',
        flexWrap: 'wrap',
    },
    quickActionItem: {
        alignItems: 'center',
        minWidth: 70,
        marginBottom: 8,
    },
    quickActionCircle: {
        width: 50,
        height: 50,
        borderRadius: 25,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    quickActionTextContainer: {
        alignItems: 'center',
        marginBottom: 16,
        minWidth: 60,
    },
    quickActionText: {
        fontSize: 12,
        fontWeight: '500',
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
    // New grouped item styles similar to AccountSettingsScreen
    groupedItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
        overflow: 'hidden',
    },
    firstGroupedItem: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    lastGroupedItem: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 8,
    },
    groupedItemContent: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        width: '100%',
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
    logoutButtonText: {
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
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

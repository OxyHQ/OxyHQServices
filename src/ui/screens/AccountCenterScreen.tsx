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
            Alert.alert('Logout Failed', 'There was a problem signing you out. Please try again.');
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
            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContainer}>
                <View style={styles.header}>
                    <Text style={[styles.title, { color: textColor }]}>Account</Text>
                </View>

                <View style={[styles.userInfoContainer, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                    <Text style={[styles.userName, { color: textColor }]}>{user.username}</Text>
                    {user.email && (
                        <Text style={[styles.userEmail, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {user.email}
                        </Text>
                    )}
                </View>

                <View style={styles.actionsContainer}>
                    {/* Show Account Switcher if multiple sessions exist */}
                    {sessions && sessions.length > 1 && (
                        <TouchableOpacity
                            style={[styles.actionButton, { borderColor }]}
                            onPress={() => navigate('AccountSwitcher')}
                        >
                            <Text style={[styles.actionButtonText, { color: textColor }]}>
                                Switch Account ({sessions.length} accounts)
                            </Text>
                        </TouchableOpacity>
                    )}

                    {/* Add Account button - always shown for multi-user functionality */}
                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor }]}
                        onPress={() => navigate('SignIn')}
                    >
                        <Text style={[styles.actionButtonText, { color: textColor }]}>Add Another Account</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor }]}
                        onPress={() => navigate('AccountSettings', { activeTab: 'profile' })}
                    >
                        <Text style={[styles.actionButtonText, { color: textColor }]}>Edit Profile</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor }]}
                        onPress={() => navigate('AccountSettings')}
                    >
                        <Text style={[styles.actionButtonText, { color: textColor }]}>Account Settings</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor }]}
                        onPress={() => navigate('SessionManagement')}
                    >
                        <Text style={[styles.actionButtonText, { color: textColor }]}>Manage Sessions</Text>
                    </TouchableOpacity>

                    {Platform.OS !== 'web' && (
                        <TouchableOpacity
                            style={[styles.actionButton, { borderColor }]}
                            onPress={() => Alert.alert('Notifications', 'Notifications feature coming soon!')}
                        >
                            <Text style={[styles.actionButtonText, { color: textColor }]}>Notifications</Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor }]}
                        onPress={() => Alert.alert('Help', 'Help & Support feature coming soon!')}
                    >
                        <Text style={[styles.actionButtonText, { color: textColor }]}>Help & Support</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor }]}
                        onPress={() => navigate('AppInfo')}
                    >
                        <Text style={[styles.actionButtonText, { color: textColor }]}>App Information</Text>
                    </TouchableOpacity>
                </View>

                <TouchableOpacity
                    style={[styles.logoutButton, { backgroundColor: isDarkTheme ? '#300000' : '#FFEBEE' }]}
                    onPress={confirmLogout}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        <ActivityIndicator color={dangerColor} size="small" />
                    ) : (
                        <Text style={[styles.logoutButtonText, { color: dangerColor }]}>Sign Out</Text>
                    )}
                </TouchableOpacity>

                <View style={styles.versionContainer}>
                    <Text style={[styles.versionText, { color: isDarkTheme ? '#666666' : '#999999' }]}>
                        Version {packageInfo.version}
                    </Text>
                </View>
            </ScrollView>

            <View style={styles.footer}>
                <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                    <Text style={[styles.closeButtonText, { color: primaryColor }]}>Close</Text>
                </TouchableOpacity>
            </View>
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
        padding: 20,
    },
    header: {
        marginBottom: 24,
        alignItems: 'center',
    },
    title: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'  // Use CSS font name directly for web
            : 'Phudu-Bold',  // Use exact font name as registered with Font.loadAsync
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
        fontSize: 24,
    },
    userInfoContainer: {
        padding: 20,
        borderRadius: 35,
        borderWidth: 1,
        marginBottom: 24,
        alignItems: 'center',
    },
    userName: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    userEmail: {
        fontSize: 16,
    },
    actionsContainer: {
        marginBottom: 24,
    },
    actionButton: {
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
    },
    actionButtonText: {
        fontSize: 16,
    },
    logoutButton: {
        height: 50,
        borderRadius: 35,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    logoutButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    versionContainer: {
        alignItems: 'center',
        marginBottom: 20,
    },
    versionText: {
        fontSize: 14,
    },
    footer: {
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#E0E0E0',
        alignItems: 'center',
    },
    closeButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    closeButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 24,
    },
});

export default AccountCenterScreen;

import React, { useState, useEffect } from 'react';
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
import { useOxy, AuthenticatedUser } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';

const AccountSwitcherScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
    goBack,
}) => {
    const { 
        user, 
        users, 
        switchUser, 
        removeUser, 
        logoutAll,
        isLoading 
    } = useOxy();

    const [switchingToUserId, setSwitchingToUserId] = useState<string | null>(null);
    const [removingUserId, setRemovingUserId] = useState<string | null>(null);

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#F5F5F5';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';
    const primaryColor = '#0066CC';
    const dangerColor = '#D32F2F';
    const successColor = '#2E7D32';

    const handleSwitchUser = async (userId: string) => {
        if (userId === user?._id) return; // Already active user

        setSwitchingToUserId(userId);
        try {
            await switchUser(userId);
            Alert.alert('Success', 'Account switched successfully!');
            if (onClose) {
                onClose();
            }
        } catch (error) {
            console.error('Switch user failed:', error);
            Alert.alert('Switch Failed', 'There was a problem switching accounts. Please try again.');
        } finally {
            setSwitchingToUserId(null);
        }
    };

    const handleRemoveUser = async (userId: string) => {
        const userToRemove = users.find(u => u._id === userId);
        if (!userToRemove) return;

        Alert.alert(
            'Remove Account',
            `Are you sure you want to remove ${userToRemove.username} from this device? You'll need to sign in again to access this account.`,
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        setRemovingUserId(userId);
                        try {
                            await removeUser(userId);
                            Alert.alert('Success', 'Account removed successfully!');
                        } catch (error) {
                            console.error('Remove user failed:', error);
                            Alert.alert('Remove Failed', 'There was a problem removing the account. Please try again.');
                        } finally {
                            setRemovingUserId(null);
                        }
                    },
                },
            ],
            { cancelable: true }
        );
    };

    const handleLogoutAll = async () => {
        Alert.alert(
            'Sign Out All',
            'Are you sure you want to sign out of all accounts on this device?',
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Sign Out All',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await logoutAll();
                            Alert.alert('Success', 'All accounts signed out successfully!');
                            if (onClose) {
                                onClose();
                            }
                        } catch (error) {
                            console.error('Logout all failed:', error);
                            Alert.alert('Logout Failed', 'There was a problem signing out. Please try again.');
                        }
                    },
                },
            ],
            { cancelable: true }
        );
    };

    const renderUserItem = (userItem: AuthenticatedUser) => {
        const isActive = userItem._id === user?._id;
        const isSwitching = switchingToUserId === userItem._id;
        const isRemoving = removingUserId === userItem._id;

        return (
            <View
                key={userItem._id}
                style={[
                    styles.userItem,
                    {
                        backgroundColor: isActive ? primaryColor + '20' : secondaryBackgroundColor,
                        borderColor: isActive ? primaryColor : borderColor,
                    },
                ]}
            >
                <View style={styles.userInfo}>
                    <Text style={[styles.username, { color: textColor }]}>{userItem.username}</Text>
                    {userItem.email && (
                        <Text style={[styles.email, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {userItem.email}
                        </Text>
                    )}
                    {isActive && (
                        <View style={[styles.activeBadge, { backgroundColor: successColor }]}>
                            <Text style={styles.activeBadgeText}>Active</Text>
                        </View>
                    )}
                </View>

                <View style={styles.userActions}>
                    {!isActive && (
                        <TouchableOpacity
                            style={[styles.switchButton, { borderColor: primaryColor }]}
                            onPress={() => handleSwitchUser(userItem._id)}
                            disabled={isSwitching || isRemoving}
                        >
                            {isSwitching ? (
                                <ActivityIndicator color={primaryColor} size="small" />
                            ) : (
                                <Text style={[styles.switchButtonText, { color: primaryColor }]}>Switch</Text>
                            )}
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        style={[styles.removeButton, { borderColor: dangerColor }]}
                        onPress={() => handleRemoveUser(userItem._id)}
                        disabled={isSwitching || isRemoving || users.length === 1}
                    >
                        {isRemoving ? (
                            <ActivityIndicator color={dangerColor} size="small" />
                        ) : (
                            <Text style={[styles.removeButtonText, { color: dangerColor }]}>Remove</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={goBack}>
                    <Text style={[styles.backButtonText, { color: primaryColor }]}>‹ Back</Text>
                </TouchableOpacity>
                <Text style={[styles.title, { color: textColor }]}>Account Switcher</Text>
                <View style={styles.placeholder} />
            </View>

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContainer}>
                <View style={styles.description}>
                    <Text style={[styles.descriptionText, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                        Manage multiple accounts on this device. Switch between accounts or remove them from this device.
                    </Text>
                </View>

                <View style={styles.usersContainer}>
                    <Text style={[styles.sectionTitle, { color: textColor }]}>
                        Accounts ({users.length})
                    </Text>
                    
                    {users.map(renderUserItem)}
                </View>

                <View style={styles.actionsContainer}>
                    <TouchableOpacity
                        style={[styles.actionButton, { borderColor }]}
                        onPress={() => navigate('SignIn')}
                    >
                        <Text style={[styles.actionButtonText, { color: textColor }]}>
                            Add Another Account
                        </Text>
                    </TouchableOpacity>

                    {users.length > 1 && (
                        <TouchableOpacity
                            style={[styles.dangerButton, { backgroundColor: isDarkTheme ? '#300000' : '#FFEBEE' }]}
                            onPress={handleLogoutAll}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <ActivityIndicator color={dangerColor} size="small" />
                            ) : (
                                <Text style={[styles.dangerButtonText, { color: dangerColor }]}>
                                    Sign Out All Accounts
                                </Text>
                            )}
                        </TouchableOpacity>
                    )}
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
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'ios' ? 50 : 20,
        paddingBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0, 0, 0, 0.1)',
    },
    backButton: {
        paddingVertical: 8,
        paddingHorizontal: 4,
    },
    backButtonText: {
        fontSize: 18,
        fontFamily: fontFamilies.phudu,
    },
    title: {
        fontSize: 20,
        fontFamily: fontFamilies.phuduSemiBold,
        textAlign: 'center',
    },
    placeholder: {
        width: 60, // Same as back button to center title
    },
    scrollView: {
        flex: 1,
    },
    scrollContainer: {
        padding: 20,
    },
    description: {
        marginBottom: 24,
    },
    descriptionText: {
        fontSize: 14,
        fontFamily: fontFamilies.phudu,
        lineHeight: 20,
    },
    usersContainer: {
        marginBottom: 32,
    },
    sectionTitle: {
        fontSize: 16,
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 16,
    },
    userItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 12,
    },
    userInfo: {
        flex: 1,
    },
    username: {
        fontSize: 16,
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 4,
    },
    email: {
        fontSize: 14,
        fontFamily: fontFamilies.phudu,
        marginBottom: 8,
    },
    activeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        alignSelf: 'flex-start',
    },
    activeBadgeText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontFamily: fontFamilies.phuduMedium,
    },
    userActions: {
        flexDirection: 'row',
        gap: 8,
    },
    switchButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        minWidth: 70,
        alignItems: 'center',
    },
    switchButtonText: {
        fontSize: 14,
        fontFamily: fontFamilies.phuduMedium,
    },
    removeButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        minWidth: 70,
        alignItems: 'center',
    },
    removeButtonText: {
        fontSize: 14,
        fontFamily: fontFamilies.phuduMedium,
    },
    actionsContainer: {
        gap: 16,
    },
    actionButton: {
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
    },
    actionButtonText: {
        fontSize: 16,
        fontFamily: fontFamilies.phuduMedium,
    },
    dangerButton: {
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderRadius: 12,
        alignItems: 'center',
    },
    dangerButtonText: {
        fontSize: 16,
        fontFamily: fontFamilies.phuduMedium,
    },
});

export default AccountSwitcherScreen;

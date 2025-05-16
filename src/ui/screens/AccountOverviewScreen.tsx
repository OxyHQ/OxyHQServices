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
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import OxyLogo from '../components/OxyLogo';
import { fontStyles } from '../styles/fonts';

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
            avatarUrl: 'https://example.com/avatar2.jpg',
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

    const handleAddAccount = () => {
        Alert.alert('Add Account', 'Add another account feature coming soon!');
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

    const renderFeatureItem = (
        icon: React.ReactNode,
        title: string,
        value: string | null | undefined,
        onPress: () => void
    ) => (
        <TouchableOpacity
            style={[styles.featureItem, { borderColor }]}
            onPress={onPress}
        >
            <View style={styles.featureItemLeft}>
                <View style={styles.iconContainer}>
                    {icon}
                </View>
                <Text style={[styles.featureItemTitle, { color: textColor }]}>{title}</Text>
            </View>
            {value !== undefined && (
                <Text style={[styles.featureItemValue, { color: iconColor }]}>{value}</Text>
            )}
        </TouchableOpacity>
    );

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

    // Default avatar if no avatarUrl provided
    const avatarSource = user.avatarUrl
        ? { uri: user.avatarUrl }
        : null; // We'll handle this with a text avatar instead

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContainer}>
                <View style={styles.header}>
                    <Text style={[styles.accountEmail, { color: textColor }]}>
                        {user.email || user.username}
                    </Text>
                    <TouchableOpacity style={styles.closeIcon} onPress={onClose}>
                        <Text style={{ fontSize: 24, color: textColor }}>×</Text>
                    </TouchableOpacity>
                </View>

                <View style={[styles.profileContainer, { backgroundColor: secondaryBackgroundColor }]}>
                    <View style={styles.avatarContainer}>
                        {user.avatarUrl ? (
                            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
                        ) : (
                            <View style={[styles.avatar, { backgroundColor: primaryColor }]}>
                                <Text style={styles.avatarText}>
                                    {user.username.charAt(0).toUpperCase()}
                                </Text>
                            </View>
                        )}
                    </View>
                    <Text style={[styles.greeting, { color: textColor }]}>Hi, {user.username.split(' ')[0]}!</Text>

                    <TouchableOpacity
                        style={[styles.manageAccountButton, { borderColor }]}
                        onPress={() => Alert.alert('Account', 'Manage your Oxy Account feature coming soon!')}
                    >
                        <Text style={[styles.manageAccountText, { color: textColor }]}>
                            Manage your Oxy Account
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Multiple accounts section */}
                <TouchableOpacity
                    style={[styles.sectionHeader, { borderColor }]}
                    onPress={() => setShowMoreAccounts(!showMoreAccounts)}
                >
                    <Text style={[styles.sectionHeaderText, { color: textColor }]}>
                        {showMoreAccounts ? "Hide more accounts" : "Show more accounts"}
                    </Text>
                    <Text style={{ color: textColor, fontSize: 16 }}>
                        {showMoreAccounts ? "▲" : "▼"}
                    </Text>
                </TouchableOpacity>

                {showMoreAccounts && (
                    <View style={[styles.accountsContainer, { backgroundColor: secondaryBackgroundColor }]}>
                        {additionalAccounts.map((account) => (
                            <TouchableOpacity
                                key={account.id}
                                style={[styles.accountItem, { borderColor }]}
                                onPress={() => Alert.alert('Switch Account', `Switch to ${account.username}?`)}
                            >
                                <View style={styles.accountItemLeft}>
                                    {account.avatarUrl ? (
                                        <Image source={{ uri: account.avatarUrl }} style={styles.accountAvatar} />
                                    ) : (
                                        <View style={[styles.accountAvatar, { backgroundColor: primaryColor }]}>
                                            <Text style={styles.avatarText}>
                                                {account.username.charAt(0).toUpperCase()}
                                            </Text>
                                        </View>
                                    )}
                                    <View>
                                        <Text style={[styles.accountName, { color: textColor }]}>
                                            {account.username}
                                        </Text>
                                        <Text style={[styles.accountEmail, { color: iconColor }]}>
                                            {account.email}
                                        </Text>
                                    </View>
                                </View>
                            </TouchableOpacity>
                        ))}

                        <TouchableOpacity
                            style={[styles.accountItem, { borderColor }]}
                            onPress={handleAddAccount}
                        >
                            <View style={styles.accountItemLeft}>
                                <View style={[styles.accountAvatar, styles.addAccountIcon, { borderColor }]}>
                                    <Text style={{ fontSize: 20, color: textColor }}>+</Text>
                                </View>
                                <Text style={[styles.accountItemAction, { color: textColor }]}>
                                    Add another account
                                </Text>
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.accountItem, { borderColor }]}
                            onPress={handleSignOutAll}
                        >
                            <View style={styles.accountItemLeft}>
                                <View style={[styles.accountAvatar, styles.signOutIcon, { borderColor }]}>
                                    <Text style={{ fontSize: 20, color: textColor }}>←</Text>
                                </View>
                                <Text style={[styles.accountItemAction, { color: textColor }]}>
                                    Sign out of all accounts
                                </Text>
                            </View>
                        </TouchableOpacity>
                    </View>
                )}

                <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionHeaderText, { color: textColor }]}>
                        More from Oxy
                    </Text>
                </View>

                <View style={[styles.featuresContainer, { backgroundColor: secondaryBackgroundColor }]}>
                    {renderFeatureItem(
                        <Text style={{ fontSize: 18 }}>🕒</Text>,
                        'History',
                        'Saving',
                        () => Alert.alert('History', 'View your history feature coming soon!')
                    )}

                    {renderFeatureItem(
                        <Text style={{ fontSize: 18 }}>⏱️</Text>,
                        'Delete last 15 minutes',
                        null,
                        () => Alert.alert('Delete History', 'Delete recent history feature coming soon!')
                    )}

                    {renderFeatureItem(
                        <Text style={{ fontSize: 18 }}>📋</Text>,
                        'Saves & Collections',
                        null,
                        () => Alert.alert('Saves', 'Saved items feature coming soon!')
                    )}

                    {renderFeatureItem(
                        <Text style={{ fontSize: 18 }}>🔍</Text>,
                        'Search personalization',
                        null,
                        () => Alert.alert('Personalization', 'Search personalization feature coming soon!')
                    )}

                    {renderFeatureItem(
                        <Text style={{ fontSize: 18 }}>🛡️</Text>,
                        'SafeSearch',
                        features.safeSearch ? 'On' : 'Off',
                        () => Alert.alert('SafeSearch', 'SafeSearch settings feature coming soon!')
                    )}

                    {renderFeatureItem(
                        <Text style={{ fontSize: 18 }}>🌐</Text>,
                        'Language',
                        features.language,
                        () => Alert.alert('Language', 'Language settings feature coming soon!')
                    )}
                </View>

                <View style={styles.footerContainer}>
                    <View style={styles.footerButtonsRow}>
                        <TouchableOpacity
                            style={styles.footerButton}
                            onPress={() => Alert.alert('Settings', 'More settings feature coming soon!')}
                        >
                            <Text style={[styles.footerButtonText, { color: textColor }]}>
                                More settings
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.footerButton}
                            onPress={() => Alert.alert('Help', 'Help & support feature coming soon!')}
                        >
                            <Text style={[styles.footerButtonText, { color: textColor }]}>
                                Help
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.footerLinksRow}>
                        <TouchableOpacity onPress={() => Alert.alert('Privacy', 'Privacy Policy feature coming soon!')}>
                            <Text style={[styles.footerLink, { color: iconColor }]}>Privacy Policy</Text>
                        </TouchableOpacity>
                        <Text style={[{ color: iconColor, marginHorizontal: 5 }]}>•</Text>
                        <TouchableOpacity onPress={() => Alert.alert('Terms', 'Terms of Service feature coming soon!')}>
                            <Text style={[styles.footerLink, { color: iconColor }]}>Terms of Service</Text>
                        </TouchableOpacity>
                    </View>
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
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    closeIcon: {
        padding: 8,
    },
    profileContainer: {
        padding: 20,
        borderRadius: 15,
        alignItems: 'center',
        marginBottom: 20,
    },
    avatarContainer: {
        margin: 10,
    },
    avatar: {
        width: 70,
        height: 70,
        borderRadius: 35,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        color: 'white',
        fontSize: 30,
        fontWeight: 'bold',
    },
    greeting: {
        ...fontStyles.titleSmall,
        marginVertical: 10,
    },
    manageAccountButton: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderWidth: 1,
        borderRadius: 20,
        marginTop: 10,
    },
    manageAccountText: {
        fontSize: 14,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 15,
        borderBottomWidth: 1,
        marginBottom: 10,
    },
    sectionHeaderText: {
        ...fontStyles.titleSmall,
        fontSize: 16,
    },
    accountsContainer: {
        borderRadius: 15,
        marginBottom: 20,
        overflow: 'hidden',
    },
    accountItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 15,
        borderBottomWidth: 1,
    },
    accountItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    accountAvatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        marginRight: 15,
        justifyContent: 'center',
        alignItems: 'center',
    },
    accountName: {
        fontSize: 15,
        fontWeight: '500',
    },
    accountEmail: {
        fontSize: 14,
    },
    accountItemAction: {
        fontSize: 15,
    },
    addAccountIcon: {
        backgroundColor: 'transparent',
        borderWidth: 1,
    },
    signOutIcon: {
        backgroundColor: 'transparent',
        borderWidth: 1,
    },
    featuresContainer: {
        borderRadius: 15,
        overflow: 'hidden',
        marginBottom: 20,
    },
    featureItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 15,
        borderBottomWidth: 1,
    },
    featureItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconContainer: {
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 15,
    },
    featureItemTitle: {
        fontSize: 15,
        fontWeight: '500',
    },
    featureItemValue: {
        fontSize: 14,
    },
    footerContainer: {
        marginBottom: 30,
    },
    footerButtonsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    footerButton: {
        flex: 1,
        padding: 15,
        alignItems: 'center',
    },
    footerButtonText: {
        fontSize: 15,
    },
    footerLinksRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    footerLink: {
        fontSize: 13,
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 24,
    },
});

export default AccountOverviewScreen;

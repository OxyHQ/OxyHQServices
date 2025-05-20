import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Alert,
    Platform,
    Switch,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import Avatar from '../components/Avatar';

interface AccountSettingsScreenProps extends BaseScreenProps {
    activeTab?: 'profile' | 'password' | 'notifications';
}

const AccountSettingsScreen: React.FC<AccountSettingsScreenProps> = ({
    goBack,
    theme,
    activeTab = 'profile',
}) => {
    const { user, oxyServices, isLoading: authLoading } = useOxy();
    const [currentTab, setCurrentTab] = useState<'profile' | 'password' | 'notifications'>(activeTab);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // Profile form state
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [bio, setBio] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');

    // Password form state
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // Notification preferences
    const [emailNotifications, setEmailNotifications] = useState(true);
    const [pushNotifications, setPushNotifications] = useState(true);

    // Theme and styling
    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#F5F5F5';
    const inputBackgroundColor = isDarkTheme ? '#333333' : '#F5F5F5';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';
    const primaryColor = '#0066CC';
    const placeholderColor = isDarkTheme ? '#AAAAAA' : '#999999';

    // Load user data
    useEffect(() => {
        if (user) {
            setUsername(user.username || '');
            setEmail(user.email || '');
            setBio(user.bio || '');
            setAvatarUrl(user.avatar?.url || '');
        }
    }, [user]);

    const validateEmail = (email: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    const handleSaveProfile = async () => {
        // Validate inputs
        if (!username) {
            setErrorMessage('Username is required');
            return;
        }

        if (email && !validateEmail(email)) {
            setErrorMessage('Please enter a valid email address');
            return;
        }

        try {
            setIsLoading(true);
            setErrorMessage('');
            setSuccessMessage('');

            // Prepare updates object
            const updates: Record<string, any> = {
                username,
                bio,
            };

            if (email) {
                updates.email = email;
            }

            // Only include avatar if it's been changed
            if (avatarUrl !== user?.avatar?.url) {
                updates.avatar = { url: avatarUrl };
            }

            // Call API to update user
            await oxyServices.updateUser(user!.id, updates);
            setSuccessMessage('Profile updated successfully');
        } catch (error: any) {
            setErrorMessage(error.message || 'Failed to update profile');
        } finally {
            setIsLoading(false);
        }
    };

    const handleChangePassword = async () => {
        // Validate inputs
        if (!currentPassword || !newPassword || !confirmPassword) {
            setErrorMessage('Please fill in all password fields');
            return;
        }

        if (newPassword !== confirmPassword) {
            setErrorMessage('New passwords do not match');
            return;
        }

        if (newPassword.length < 8) {
            setErrorMessage('Password must be at least 8 characters long');
            return;
        }

        try {
            setIsLoading(true);
            setErrorMessage('');
            setSuccessMessage('');

            // Call API to update password
            await oxyServices.updateUser(user!.id, {
                currentPassword,
                password: newPassword,
            });

            // Clear form fields after successful update
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setSuccessMessage('Password updated successfully');
        } catch (error: any) {
            setErrorMessage(error.message || 'Failed to update password');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveNotifications = async () => {
        try {
            setIsLoading(true);
            setErrorMessage('');
            setSuccessMessage('');

            // Call API to update notification preferences
            await oxyServices.updateUser(user!.id, {
                notificationPreferences: {
                    email: emailNotifications,
                    push: pushNotifications,
                },
            });
            setSuccessMessage('Notification preferences updated successfully');
        } catch (error: any) {
            setErrorMessage(error.message || 'Failed to update notification preferences');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAvatarUpdate = () => {
        // In a real app, this would open an image picker
        // For now, we'll use a mock URL to demonstrate the concept
        Alert.alert(
            'Update Avatar',
            'This would open an image picker in a real app. For now, we\'ll use a mock URL.',
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Use Mock URL',
                    onPress: () => {
                        const mockUrl = `https://ui-avatars.com/api/?name=${username}&background=random`;
                        setAvatarUrl(mockUrl);
                    },
                },
            ]
        );
    };

    if (authLoading || !user) {
        return (
            <View style={[styles.container, { backgroundColor, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={primaryColor} />
            </View>
        );
    }

    const renderProfileTab = () => (
        <View style={styles.tabContent}>
            <View style={styles.avatarSection}>
                <Avatar 
                    imageUrl={avatarUrl} 
                    name={username} 
                    size={100} 
                    theme={theme} 
                />
                <TouchableOpacity
                    style={[styles.changeAvatarButton, { backgroundColor: primaryColor }]}
                    onPress={handleAvatarUpdate}
                >
                    <Text style={styles.changeAvatarText}>Change Avatar</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: textColor }]}>Username</Text>
                <TextInput
                    style={[
                        styles.input,
                        { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                    ]}
                    placeholder="Enter your username"
                    placeholderTextColor={placeholderColor}
                    value={username}
                    onChangeText={setUsername}
                    testID="username-input"
                />
            </View>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: textColor }]}>Email</Text>
                <TextInput
                    style={[
                        styles.input,
                        { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                    ]}
                    placeholder="Enter your email"
                    placeholderTextColor={placeholderColor}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    testID="email-input"
                />
            </View>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: textColor }]}>Bio</Text>
                <TextInput
                    style={[
                        styles.textArea,
                        { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                    ]}
                    placeholder="Tell us about yourself"
                    placeholderTextColor={placeholderColor}
                    value={bio}
                    onChangeText={setBio}
                    multiline
                    numberOfLines={4}
                    testID="bio-input"
                />
            </View>

            <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: primaryColor, opacity: isLoading ? 0.7 : 1 }]}
                onPress={handleSaveProfile}
                disabled={isLoading}
                testID="save-profile-button"
            >
                {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                    <Text style={styles.saveButtonText}>Save Profile</Text>
                )}
            </TouchableOpacity>
        </View>
    );

    const renderPasswordTab = () => (
        <View style={styles.tabContent}>
            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: textColor }]}>Current Password</Text>
                <TextInput
                    style={[
                        styles.input,
                        { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                    ]}
                    placeholder="Enter your current password"
                    placeholderTextColor={placeholderColor}
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    secureTextEntry
                    testID="current-password-input"
                />
            </View>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: textColor }]}>New Password</Text>
                <TextInput
                    style={[
                        styles.input,
                        { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                    ]}
                    placeholder="Enter your new password"
                    placeholderTextColor={placeholderColor}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry
                    testID="new-password-input"
                />
                <Text style={[styles.passwordHint, { color: isDarkTheme ? '#AAAAAA' : '#666666' }]}>
                    Password must be at least 8 characters long
                </Text>
            </View>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: textColor }]}>Confirm New Password</Text>
                <TextInput
                    style={[
                        styles.input,
                        { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                    ]}
                    placeholder="Confirm your new password"
                    placeholderTextColor={placeholderColor}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    testID="confirm-password-input"
                />
            </View>

            <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: primaryColor, opacity: isLoading ? 0.7 : 1 }]}
                onPress={handleChangePassword}
                disabled={isLoading}
                testID="change-password-button"
            >
                {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                    <Text style={styles.saveButtonText}>Change Password</Text>
                )}
            </TouchableOpacity>
        </View>
    );

    const renderNotificationsTab = () => (
        <View style={styles.tabContent}>
            <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: textColor }]}>Email Notifications</Text>
                <Switch
                    value={emailNotifications}
                    onValueChange={setEmailNotifications}
                    trackColor={{ false: '#767577', true: primaryColor }}
                    thumbColor="#f4f3f4"
                    testID="email-notifications-switch"
                />
            </View>

            <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: textColor }]}>Push Notifications</Text>
                <Switch
                    value={pushNotifications}
                    onValueChange={setPushNotifications}
                    trackColor={{ false: '#767577', true: primaryColor }}
                    thumbColor="#f4f3f4"
                    testID="push-notifications-switch"
                />
            </View>

            <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: primaryColor, opacity: isLoading ? 0.7 : 1 }]}
                onPress={handleSaveNotifications}
                disabled={isLoading}
                testID="save-notifications-button"
            >
                {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                    <Text style={styles.saveButtonText}>Save Preferences</Text>
                )}
            </TouchableOpacity>
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContainer}>
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={goBack}
                    >
                        <Text style={[styles.backButtonText, { color: primaryColor }]}>Back</Text>
                    </TouchableOpacity>
                    <Text style={[styles.title, { color: textColor }]}>Account Settings</Text>
                    <View style={styles.backButtonPlaceholder} />
                </View>

                <View style={[styles.tabsContainer, { borderColor }]}>
                    <TouchableOpacity
                        style={[
                            styles.tabButton,
                            currentTab === 'profile' && [styles.activeTabButton, { borderColor: primaryColor }]
                        ]}
                        onPress={() => setCurrentTab('profile')}
                    >
                        <Text
                            style={[
                                styles.tabButtonText,
                                { color: currentTab === 'profile' ? primaryColor : textColor }
                            ]}
                        >
                            Profile
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.tabButton,
                            currentTab === 'password' && [styles.activeTabButton, { borderColor: primaryColor }]
                        ]}
                        onPress={() => setCurrentTab('password')}
                    >
                        <Text
                            style={[
                                styles.tabButtonText,
                                { color: currentTab === 'password' ? primaryColor : textColor }
                            ]}
                        >
                            Password
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.tabButton,
                            currentTab === 'notifications' && [styles.activeTabButton, { borderColor: primaryColor }]
                        ]}
                        onPress={() => setCurrentTab('notifications')}
                    >
                        <Text
                            style={[
                                styles.tabButtonText,
                                { color: currentTab === 'notifications' ? primaryColor : textColor }
                            ]}
                        >
                            Notifications
                        </Text>
                    </TouchableOpacity>
                </View>

                {errorMessage ? (
                    <View style={styles.errorContainer}>
                        <Text style={styles.errorText}>{errorMessage}</Text>
                    </View>
                ) : null}

                {successMessage ? (
                    <View style={styles.successContainer}>
                        <Text style={styles.successText}>{successMessage}</Text>
                    </View>
                ) : null}

                {currentTab === 'profile' && renderProfileTab()}
                {currentTab === 'password' && renderPasswordTab()}
                {currentTab === 'notifications' && renderNotificationsTab()}
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
        marginBottom: 24,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    backButton: {
        padding: 10,
    },
    backButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    backButtonPlaceholder: {
        width: 40,
    },
    tabsContainer: {
        flexDirection: 'row',
        marginBottom: 24,
        borderBottomWidth: 1,
    },
    tabButton: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 12,
    },
    activeTabButton: {
        borderBottomWidth: 2,
    },
    tabButtonText: {
        fontSize: 16,
        fontWeight: '500',
    },
    tabContent: {
        marginBottom: 24,
    },
    avatarSection: {
        alignItems: 'center',
        marginBottom: 24,
    },
    changeAvatarButton: {
        marginTop: 12,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
    },
    changeAvatarText: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    inputContainer: {
        marginBottom: 16,
    },
    label: {
        fontSize: 16,
        marginBottom: 8,
    },
    input: {
        height: 50,
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 12,
        fontSize: 16,
    },
    textArea: {
        minHeight: 100,
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingTop: 12,
        fontSize: 16,
        textAlignVertical: 'top',
    },
    passwordHint: {
        fontSize: 14,
        marginTop: 4,
    },
    saveButton: {
        height: 50,
        borderRadius: 25,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 16,
    },
    saveButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    settingRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    settingLabel: {
        fontSize: 16,
    },
    errorContainer: {
        backgroundColor: '#FFEBEE',
        padding: 16,
        borderRadius: 8,
        marginBottom: 16,
    },
    errorText: {
        color: '#D32F2F',
        fontSize: 14,
    },
    successContainer: {
        backgroundColor: '#E8F5E9',
        padding: 16,
        borderRadius: 8,
        marginBottom: 16,
    },
    successText: {
        color: '#2E7D32',
        fontSize: 14,
    },
});

export default AccountSettingsScreen;
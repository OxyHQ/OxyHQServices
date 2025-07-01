import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Alert,
    TextInput,
    Animated,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { fontFamilies } from '../styles/fonts';
import LocationPickerPanel, { AddressObj as PickerAddressObj } from '../components/LocationPickerPanel';
import ProfilePictureSection from './accountSettings/ProfilePictureSection';
import BasicInformationSection from './accountSettings/BasicInformationSection';
import AboutYouSection from './accountSettings/AboutYouSection';
import QuickActionsSection from './accountSettings/QuickActionsSection';
import SecuritySection from './accountSettings/SecuritySection';
import NotificationSection from './accountSettings/NotificationSection';
import AppearanceSection from './accountSettings/AppearanceSection';
import PrivacySection from './accountSettings/PrivacySection';
import AccountSection from './accountSettings/AccountSection';

type LinkObj = { url: string; title?: string | null; description?: string | null; image?: string | null };
type AddressObj = {
    id: string;
    formatted: string;
    street: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    latitude?: number;
    longitude?: number;
};

const AccountSettingsScreenNew: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
}) => {
    const {
        oxyServices,
        isAuthenticated,
        ensureToken,
        // User Settings from new store
        settings,
        settingsLoading,
        settingsSaving,
        settingsError,
        settingsOffline,
        loadSettings,
        saveSettings,
        syncSettings,
        setSettings,
    } = useOxy();

    const [isRefreshing, setIsRefreshing] = useState(false);

    // Animation refs
    const saveButtonScale = useRef(new Animated.Value(1)).current;

    // Editing states
    const [editingField, setEditingField] = useState<string | null>(null);

    // Temporary input states for inline editing
    const [tempDisplayName, setTempDisplayName] = useState('');
    const [tempFirstName, setTempFirstName] = useState('');
    const [tempMiddleName, setTempMiddleName] = useState('');
    const [tempLastName, setTempLastName] = useState('');
    const [tempUsername, setTempUsername] = useState('');
    const [tempEmail, setTempEmail] = useState('');
    const [tempBio, setTempBio] = useState('');
    const [tempLocation, setTempLocation] = useState('');
    const [tempLink, setTempLink] = useState('');
    const [tempDescription, setTempDescription] = useState('');

    // New addresses state
    const [addresses, setAddresses] = useState<AddressObj[]>([]);
    const [showAddressPicker, setShowAddressPicker] = useState(false);
    const editingAddressIndexRef = useRef<number | null>(null);

    // Temp state for adding a new address (formatted string for now)
    const [tempAddressFormatted, setTempAddressFormatted] = useState('');

    // Memoize theme-related calculations to prevent unnecessary recalculations
    const themeStyles = useMemo(() => {
        const isDarkTheme = theme === 'dark';
        return {
            isDarkTheme,
            backgroundColor: isDarkTheme ? '#121212' : '#f2f2f2',
            primaryColor: '#007AFF',
        };
    }, [theme]);

    // Helper function to extract display name
    const extractDisplayName = useCallback((userData: any) => {
        if (!userData) return '';

        if (userData.name) {
            if (typeof userData.name === 'string') {
                return userData.name;
            }
            const { first, middle, last } = userData.name;
            return [first, middle, last].filter(Boolean).join(' ');
        }

        return userData.username || '';
    }, []);

    // Load settings when screen mounts
    useEffect(() => {
        const initializeSettings = async () => {
            if (!isAuthenticated || !oxyServices) {
                console.log('AccountSettingsScreen: Not authenticated or no services available');
                return;
            }

            try {
                console.log('AccountSettingsScreen: Loading settings on mount...');
                setIsRefreshing(true);

                // Ensure token is set
                await ensureToken();

                // Load settings from backend first, fallback to local
                await loadSettings();

                console.log('AccountSettingsScreen: Settings loaded successfully');
            } catch (error) {
                console.error('AccountSettingsScreen: Failed to load settings:', error);
                toast.error('Failed to load settings');
            } finally {
                setIsRefreshing(false);
            }
        };

        initializeSettings();
    }, [isAuthenticated, oxyServices, ensureToken, loadSettings]);

    // Update local state when settings change
    useEffect(() => {
        if (settings) {
            console.log('AccountSettingsScreen: Settings updated:', settings);

            // Update temporary states for editing
            setTempFirstName(settings.name?.first || '');
            setTempMiddleName(settings.name?.middle || '');
            setTempLastName(settings.name?.last || '');
            setTempUsername(settings.username || '');
            setTempEmail(settings.email || '');
            setTempBio(settings.bio || '');
            setTempDescription(settings.description || '');
            setTempLocation(settings.location || '');
            setAddresses(settings.addresses || []);
        }
    }, [settings]);

    // Add loading state for when settings are not yet available
    const isDataLoading = settingsLoading || !settings || isRefreshing;

    const handleSave = async () => {
        if (!settings || !oxyServices) {
            console.error('handleSave: Missing settings or oxyServices', { settings: !!settings, oxyServices: !!oxyServices });
            return;
        }

        try {
            animateSaveButton(0.95); // Scale down slightly for animation

            console.log('handleSave: Starting settings update...');

            // Ensure the token is set before making API calls
            await ensureToken();

            const updates: Record<string, any> = {
                username: settings.username,
                email: settings.email,
                bio: settings.bio,
                description: settings.description,
                location: settings.location,
                addresses: settings.addresses,
                links: settings.links,
            };

            // Include name parts if any have changed
            if (settings.name?.first || settings.name?.middle || settings.name?.last) {
                updates.name = {
                    first: settings.name.first,
                    middle: settings.name.middle,
                    last: settings.name.last
                };
            }

            // Handle avatar
            if (settings.avatar?.url) {
                updates.avatar = { url: settings.avatar.url };
            }

            console.log('handleSave: Making API call with updates:', updates);

            // Save settings to backend first
            await saveSettings(updates);
            console.log('handleSave: Settings update successful');

            toast.success('Settings updated successfully');

            animateSaveButton(1); // Scale back to normal

        } catch (error: any) {
            console.error('handleSave: Settings update failed:', error);
            toast.error(error?.message || 'Failed to update settings');
            animateSaveButton(1);
        }
    };

    const animateSaveButton = (scale: number) => {
        Animated.spring(saveButtonScale, {
            toValue: scale,
            useNativeDriver: true,
        }).start();
    };

    const startEditing = (type: string, currentValue: string) => {
        setEditingField(type);

        // Set temp values based on current settings
        switch (type) {
            case 'displayName':
                setTempFirstName(settings?.name?.first || '');
                setTempMiddleName(settings?.name?.middle || '');
                setTempLastName(settings?.name?.last || '');
                break;
            case 'username':
                setTempUsername(settings?.username || '');
                break;
            case 'email':
                setTempEmail(settings?.email || '');
                break;
            case 'bio':
                setTempBio(settings?.bio || '');
                break;
            case 'description':
                setTempDescription(settings?.description || '');
                break;
            case 'location':
                setTempLocation(settings?.location || '');
                break;
            case 'link':
                setTempLink('');
                break;
        }
    };

    const cancelEditing = () => {
        setEditingField(null);
        setTempDisplayName('');
        setTempFirstName('');
        setTempMiddleName('');
        setTempLastName('');
        setTempUsername('');
        setTempEmail('');
        setTempBio('');
        setTempLocation('');
        setTempLink('');
        setTempDescription('');
        setTempAddressFormatted('');
    };

    const saveField = async (type: string) => {
        if (!settings) return;

        try {
            animateSaveButton(0.95);

            // Ensure the token is set before making API calls
            await ensureToken();

            // Prepare the update data based on the field type
            let updateData: Record<string, any> = {};

            switch (type) {
                case 'displayName':
                    const newFirst = tempFirstName;
                    const newMiddle = tempMiddleName;
                    const newLast = tempLastName;
                    updateData.name = {
                        first: newFirst,
                        middle: newMiddle,
                        last: newLast
                    };
                    break;
                case 'username':
                    updateData.username = tempUsername;
                    break;
                case 'email':
                    const newEmail = tempEmail.trim();
                    // Basic front-end email format check
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (newEmail && !emailRegex.test(newEmail)) {
                        toast.error('Please enter a valid email address');
                        animateSaveButton(1);
                        return;
                    }
                    updateData.email = newEmail;
                    break;
                case 'bio':
                    const newBio = tempBio;
                    if (newBio.length > 500) {
                        toast.error('Bio cannot exceed 500 characters');
                        animateSaveButton(1);
                        return;
                    }
                    updateData.bio = newBio;
                    break;
                case 'description':
                    const newDescription = tempDescription;
                    if (newDescription.length > 1000) {
                        toast.error('About section cannot exceed 1000 characters');
                        animateSaveButton(1);
                        return;
                    }
                    updateData.description = newDescription;
                    break;
                case 'location':
                    updateData.location = tempLocation;
                    break;
                case 'address':
                    updateData.addresses = addresses;
                    break;
                case 'link':
                    updateData.links = settings.links || [];
                    setTempLink('');
                    break;
                case 'theme':
                    updateData.theme = settings.theme;
                    break;
            }

            // Save to backend first
            console.log(`saveField: Saving ${type} with data:`, updateData);
            await saveSettings(updateData);

            toast.success(`${getFieldLabel(type)} updated successfully`);
            setEditingField(null);

        } catch (error: any) {
            console.error(`saveField: Failed to save ${type}:`, error);
            toast.error(error?.message || `Failed to update ${getFieldLabel(type)}`);
        } finally {
            animateSaveButton(1);
        }
    };

    const getFieldLabel = (type: string) => {
        const labels = {
            displayName: 'Display Name',
            username: 'Username',
            email: 'Email',
            bio: 'Short Bio',
            description: 'About Me',
            location: 'Location',
            address: 'Locations',
            link: 'Links',
            theme: 'Theme'
        };
        return labels[type as keyof typeof labels] || 'Field';
    };

    const getFieldIcon = (type: string) => {
        const icons = {
            displayName: { name: 'person', color: '#007AFF' },
            username: { name: 'at', color: '#5856D6' },
            email: { name: 'mail', color: '#FF9500' },
            bio: { name: 'chatbubble-ellipses', color: '#FF9500' },
            description: { name: 'document-text', color: '#34C759' },
            location: { name: 'location', color: '#FF3B30' },
            address: { name: 'location', color: '#FF3B30' },
            link: { name: 'link', color: '#32D74B' },
            theme: { name: 'moon', color: '#5856D6' }
        };
        return icons[type as keyof typeof icons] || { name: 'person', color: '#007AFF' };
    };

    const handleAvatarUpdate = () => {
        toast.info('Avatar update coming soon!');
    };

    const handleUpdatePassword = () => {
        toast.info('Password update coming soon!');
    };

    const handleToggleTwoFactor = () => {
        toast.info('Two-factor authentication coming soon!');
    };

    const handleManageSessions = () => {
        toast.info('Session management coming soon!');
    };

    const handleSecurityLog = () => {
        toast.info('Security log coming soon!');
    };

    // Notification section handlers
    const handleTogglePushNotifications = async (value: boolean) => {
        try {
            await saveSettings({ pushNotifications: value });
            toast.success(value ? 'Push notifications enabled' : 'Push notifications disabled');
        } catch (error) {
            toast.error('Failed to update notification settings');
        }
    };

    const handleToggleEmailNotifications = async (value: boolean) => {
        try {
            await saveSettings({ emailNotifications: value });
            toast.success(value ? 'Email notifications enabled' : 'Email notifications disabled');
        } catch (error) {
            toast.error('Failed to update notification settings');
        }
    };

    const handleToggleMarketingEmails = async (value: boolean) => {
        try {
            await saveSettings({ marketingEmails: value });
            toast.success(value ? 'Marketing emails enabled' : 'Marketing emails disabled');
        } catch (error) {
            toast.error('Failed to update notification settings');
        }
    };

    const handleToggleSound = async (value: boolean) => {
        try {
            await saveSettings({ soundEnabled: value });
            toast.success(value ? 'Notification sounds enabled' : 'Notification sounds disabled');
        } catch (error) {
            toast.error('Failed to update notification settings');
        }
    };

    const handleNotificationPreferences = () => {
        toast.info('Notification preferences coming soon!');
    };

    // Appearance section handlers
    const handleThemeChange = () => {
        startEditing('theme', settings?.theme || 'auto');
    };

    const handleThemeSelect = async (selectedTheme: 'light' | 'dark' | 'auto') => {
        try {
            await saveSettings({ theme: selectedTheme });
            toast.success('Theme updated successfully');
        } catch (error) {
            toast.error('Failed to update theme');
        }
    };

    const handleFontSizeChange = () => {
        toast.info('Font size selection coming soon!');
    };

    const handleLanguageChange = () => {
        toast.info('Language selection coming soon!');
    };

    // Privacy section handlers
    const handleProfileVisibilityChange = async (visibility: 'public' | 'private' | 'friends') => {
        try {
            await saveSettings({ profileVisibility: visibility });
            toast.success('Profile visibility updated');
        } catch (error) {
            toast.error('Failed to update profile visibility');
        }
    };

    const handleToggleOnlineStatus = async (value: boolean) => {
        try {
            await saveSettings({ showOnlineStatus: value });
            toast.success(value ? 'Online status visible' : 'Online status hidden');
        } catch (error) {
            toast.error('Failed to update online status');
        }
    };

    const handleMessagesFromChange = async (setting: 'everyone' | 'friends' | 'none') => {
        try {
            await saveSettings({ allowMessagesFrom: setting });
            toast.success('Message settings updated');
        } catch (error) {
            toast.error('Failed to update message settings');
        }
    };

    const handleToggleActivityStatus = async (value: boolean) => {
        try {
            await saveSettings({ showActivityStatus: value });
            toast.success(value ? 'Activity status visible' : 'Activity status hidden');
        } catch (error) {
            toast.error('Failed to update activity status');
        }
    };

    const renderEditingField = (type: string) => {
        const fieldConfig = {
            displayName: { label: 'Display Name', value: extractDisplayName(settings), placeholder: 'Enter your display name', icon: 'person', color: '#007AFF', multiline: false, keyboardType: 'default' as const },
            username: { label: 'Username', value: settings?.username || '', placeholder: 'Choose a username', icon: 'at', color: '#5856D6', multiline: false, keyboardType: 'default' as const },
            email: { label: 'Email', value: settings?.email || '', placeholder: 'Enter your email address', icon: 'mail', color: '#FF9500', multiline: false, keyboardType: 'email-address' as const },
            bio: { label: 'Short Bio', value: settings?.bio || '', placeholder: 'Write a brief introduction (max 500 characters)...', icon: 'chatbubble-ellipses', color: '#FF9500', multiline: true, keyboardType: 'default' as const },
            description: { label: 'About Me', value: settings?.description || '', placeholder: 'Share your story, interests, and more (max 1000 characters)...', icon: 'document-text', color: '#34C759', multiline: true, keyboardType: 'default' as const },
            location: { label: 'Location', value: settings?.location || '', placeholder: 'Enter your location', icon: 'location', color: '#FF3B30', multiline: false, keyboardType: 'default' as const },
            address: { label: 'Locations', value: tempAddressFormatted, placeholder: 'Search or enter address', icon: 'location', color: '#FF3B30', multiline: false, keyboardType: 'default' as const },
            link: { label: 'Links', value: tempLink, placeholder: 'Enter URL', icon: 'link', color: '#32D74B', multiline: false, keyboardType: 'url' as const },
            theme: { label: 'Theme', value: settings?.theme || 'auto', placeholder: 'Choose your theme', icon: 'moon', color: '#5856D6', multiline: false, keyboardType: 'default' as const }
        };

        const config = fieldConfig[type as keyof typeof fieldConfig];
        if (!config && type !== 'theme') return null;

        const tempValue = (() => {
            switch (type) {
                case 'displayName': return tempDisplayName;
                case 'username': return tempUsername;
                case 'email': return tempEmail;
                case 'bio': return tempBio;
                case 'description': return tempDescription;
                case 'location': return tempLocation;
                case 'address': return tempAddressFormatted;
                case 'link': return tempLink;
                default: return '';
            }
        })();

        const setTempValue = (text: string) => {
            switch (type) {
                case 'displayName': setTempDisplayName(text); break;
                case 'username': setTempUsername(text); break;
                case 'email': setTempEmail(text); break;
                case 'bio': setTempBio(text); break;
                case 'description': setTempDescription(text); break;
                case 'location': setTempLocation(text); break;
                case 'address': setTempAddressFormatted(text); break;
                case 'link': setTempLink(text); break;
            }
        };

        if (type === 'theme') {
            return (
                <View style={styles.editingFieldContainer}>
                    <View style={styles.editingFieldContent}>
                        <Text style={styles.editingFieldLabel}>Choose Theme:</Text>
                        <View style={styles.themeOptions}>
                            {(['light', 'dark', 'auto'] as const).map((themeOption) => (
                                <TouchableOpacity
                                    key={themeOption}
                                    style={[
                                        styles.themeOption,
                                        {
                                            backgroundColor: themeStyles.isDarkTheme ? '#333' : '#fff',
                                            borderColor: settings?.theme === themeOption ? themeStyles.primaryColor : '#ddd',
                                        }
                                    ]}
                                    onPress={() => handleThemeSelect(themeOption)}
                                >
                                    <Text style={[
                                        styles.themeOptionText,
                                        { color: themeStyles.isDarkTheme ? '#fff' : '#000' }
                                    ]}>
                                        {themeOption.charAt(0).toUpperCase() + themeOption.slice(1)}
                                    </Text>
                                    {settings?.theme === themeOption && (
                                        <Ionicons name="checkmark" size={20} color={themeStyles.primaryColor} />
                                    )}
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                </View>
            );
        }

        return (
            <View style={styles.editingFieldContainer}>
                <View style={styles.editingFieldContent}>
                    <View style={styles.newValueSection}>
                        <Text style={styles.editingFieldLabel}>
                            {`Enter ${config.label.toLowerCase()}:`}
                        </Text>
                        <TextInput
                            style={[
                                config.multiline ? styles.editingFieldTextArea : styles.editingFieldInput,
                                {
                                    backgroundColor: themeStyles.isDarkTheme ? '#333' : '#fff',
                                    color: themeStyles.isDarkTheme ? '#fff' : '#000',
                                    borderColor: themeStyles.primaryColor
                                }
                            ]}
                            value={tempValue}
                            onChangeText={setTempValue}
                            placeholder={config.placeholder}
                            placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
                            multiline={config.multiline}
                            numberOfLines={config.multiline ? 6 : 1}
                            keyboardType={config.keyboardType}
                            autoFocus
                            selectionColor={themeStyles.primaryColor}
                            maxLength={type === 'bio' ? 500 : type === 'description' ? 1000 : undefined}
                        />
                    </View>
                </View>
            </View>
        );
    };

    const renderField = (
        type: string,
        label: string,
        value: string,
        placeholder: string,
        icon: string,
        iconColor: string,
        multiline = false,
        keyboardType: 'default' | 'email-address' | 'url' = 'default',
        isFirst = false,
        isLast = false
    ) => {
        const itemStyles = [
            styles.settingItem,
            isFirst && styles.firstSettingItem,
            isLast && styles.lastSettingItem
        ];

        return (
            <TouchableOpacity
                style={itemStyles}
                onPress={() => startEditing(type, value)}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name={icon} size={20} color={iconColor} style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>{label}</Text>
                        <Text style={styles.settingDescription}>
                            {value || placeholder}
                        </Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>
        );
    };

    if (isDataLoading) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={themeStyles.primaryColor} />
            </View>
        );
    }

    const displayName = extractDisplayName(settings);

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            {/* Header */}
            <View style={styles.header}>
                {editingField ? (
                    <View style={styles.editingHeader}>
                        <View style={styles.editingHeaderTop}>
                            <TouchableOpacity style={styles.cancelButton} onPress={cancelEditing}>
                                <Ionicons name="close" size={24} color="#666" />
                            </TouchableOpacity>
                            <Animated.View style={{ transform: [{ scale: saveButtonScale }] }}>
                                <TouchableOpacity
                                    style={[
                                        styles.saveHeaderButton,
                                        {
                                            opacity: settingsSaving ? 0.7 : 1,
                                            backgroundColor: editingField ? getFieldIcon(editingField).color : '#007AFF'
                                        }
                                    ]}
                                    onPress={() => saveField(editingField)}
                                    disabled={settingsSaving}
                                >
                                    {settingsSaving ? (
                                        <ActivityIndicator size="small" color="#fff" />
                                    ) : (
                                        <Text style={styles.saveButtonText}>Save</Text>
                                    )}
                                </TouchableOpacity>
                            </Animated.View>
                        </View>
                        <Text style={styles.editingHeaderTitle}>
                            Edit {getFieldLabel(editingField)}
                        </Text>
                    </View>
                ) : (
                    <View style={styles.normalHeader}>
                        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                            <Ionicons name="close" size={24} color="#666" />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Account Settings</Text>
                        <Animated.View style={{ transform: [{ scale: saveButtonScale }] }}>
                            <TouchableOpacity
                                style={[
                                    styles.saveHeaderButton,
                                    { opacity: settingsSaving ? 0.7 : 1 }
                                ]}
                                onPress={handleSave}
                                disabled={settingsSaving}
                            >
                                {settingsSaving ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <Text style={styles.saveButtonText}>Save All</Text>
                                )}
                            </TouchableOpacity>
                        </Animated.View>
                    </View>
                )}
            </View>

            <ScrollView style={editingField ? styles.contentEditing : styles.content}>
                {editingField ? (
                    // Show only the editing interface when editing
                    <View style={styles.editingOnlyContainer}>
                        {renderEditingField(editingField)}
                    </View>
                ) : (
                    // Show all settings when not editing
                    <>
                        <ProfilePictureSection
                            avatarUrl={settings?.avatar?.url || ''}
                            displayName={displayName}
                            username={settings?.username || ''}
                            theme={theme}
                            onUpdateAvatar={handleAvatarUpdate}
                        />

                        <BasicInformationSection
                            renderField={renderField}
                            displayName={displayName}
                            username={settings?.username || ''}
                            email={settings?.email || ''}
                        />

                        <AboutYouSection
                            renderField={renderField}
                            bio={settings?.bio || ''}
                            description={settings?.description || ''}
                            addresses={settings?.addresses || []}
                            links={settings?.links || []}
                        />

                        <QuickActionsSection />

                        <SecuritySection
                            hasTwoFactorEnabled={settings?.hasTwoFactorEnabled || false}
                            lastPasswordChange={settings?.lastPasswordChange}
                            activeSessions={settings?.activeSessions || 1}
                            onUpdatePassword={handleUpdatePassword}
                            onToggleTwoFactor={handleToggleTwoFactor}
                            onManageSessions={handleManageSessions}
                            onSecurityLog={handleSecurityLog}
                        />

                        <NotificationSection
                            pushNotifications={settings?.pushNotifications !== false}
                            emailNotifications={settings?.emailNotifications !== false}
                            marketingEmails={settings?.marketingEmails || false}
                            soundEnabled={settings?.soundEnabled !== false}
                            onTogglePushNotifications={handleTogglePushNotifications}
                            onToggleEmailNotifications={handleToggleEmailNotifications}
                            onToggleMarketingEmails={handleToggleMarketingEmails}
                            onToggleSound={handleToggleSound}
                            onNotificationPreferences={handleNotificationPreferences}
                        />

                        <AppearanceSection
                            theme={settings?.theme || 'auto'}
                            fontSize={settings?.fontSize || 'medium'}
                            language={settings?.language || 'en-US'}
                            onThemeChange={handleThemeChange}
                            onFontSizeChange={handleFontSizeChange}
                            onLanguageChange={handleLanguageChange}
                        />

                        <PrivacySection
                            profileVisibility={settings?.profileVisibility || 'public'}
                            showOnlineStatus={settings?.showOnlineStatus !== false}
                            allowMessagesFrom={settings?.allowMessagesFrom || 'friends'}
                            showActivityStatus={settings?.showActivityStatus !== false}
                            onProfileVisibilityChange={handleProfileVisibilityChange}
                            onToggleOnlineStatus={handleToggleOnlineStatus}
                            onMessagesFromChange={handleMessagesFromChange}
                            onToggleActivityStatus={handleToggleActivityStatus}
                        />

                        <AccountSection
                            accountCreated={settings?.accountCreated || 'January 2024'}
                            lastLogin={settings?.lastLogin || 'Today at 2:30 PM'}
                        />
                    </>
                )}
            </ScrollView>

            {/* Offline indicator */}
            {settingsOffline && (
                <View style={styles.offlineIndicator}>
                    <Text style={styles.offlineText}>Offline Mode - Changes saved locally</Text>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 60,
        paddingBottom: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    normalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    editingHeader: {
        flexDirection: 'column',
    },
    editingHeaderTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    editingHeaderTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        textAlign: 'center',
    },
    closeButton: {
        padding: 8,
    },
    cancelButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000',
    },
    saveHeaderButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 16,
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    contentEditing: {
        flex: 1,
        padding: 16,
    },
    editingOnlyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    editingFieldContainer: {
        width: '100%',
        maxWidth: 400,
    },
    editingFieldContent: {
        backgroundColor: '#fff',
        borderRadius: 24,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    editingFieldLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    newValueSection: {
        marginBottom: 16,
    },
    editingFieldInput: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        fontFamily: fontFamilies.phuduRegular,
    },
    editingFieldTextArea: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        fontFamily: fontFamilies.phuduRegular,
        minHeight: 120,
        textAlignVertical: 'top',
    },
    themeOptions: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginTop: 16,
    },
    themeOption: {
        flex: 1,
        marginHorizontal: 8,
        padding: 16,
        borderRadius: 12,
        borderWidth: 2,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    themeOptionText: {
        fontSize: 16,
        fontWeight: '500',
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
    offlineIndicator: {
        position: 'absolute',
        bottom: 20,
        left: 20,
        right: 20,
        backgroundColor: '#FF9500',
        padding: 12,
        borderRadius: 12,
        alignItems: 'center',
    },
    offlineText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
    },
});

export default AccountSettingsScreenNew; 
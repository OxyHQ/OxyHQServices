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
    Platform,
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
import { useThemeStoreStandalone } from '../../stores/themeStore';

type LinkObj = { url: string; title?: string | null; description?: string | null; image?: string | null };

// New address object type allowing label & rich address details
export type AddressObj = {
    label?: string; // e.g., "home", "work", "other"
    formatted?: string; // Single-line formatted string shown in UI
    street?: string;
    number?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    lat?: number;
    lng?: number;
};

const AccountSettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
}) => {
    const {
        user,
        oxyServices,
        isLoading: authLoading,
        isAuthenticated,
        ensureToken,
        activeSessionId,
        refreshUserData,
        updateProfile,
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

    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Animation refs
    const saveButtonScale = useRef(new Animated.Value(1)).current;

    // Form state - derived from user data
    const [displayName, setDisplayName] = useState('');
    const [firstName, setFirstName] = useState('');
    const [middleName, setMiddleName] = useState('');
    const [lastName, setLastName] = useState('');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [bio, setBio] = useState('');
    const [description, setDescription] = useState('');
    const [location, setLocation] = useState('');
    const [links, setLinks] = useState<LinkObj[]>([]);
    const [avatarUrl, setAvatarUrl] = useState('');

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

    // Security section state
    const [hasTwoFactorEnabled, setHasTwoFactorEnabled] = useState(false);
    const [lastPasswordChange, setLastPasswordChange] = useState<string | undefined>();
    const [activeSessions, setActiveSessions] = useState(1);

    // Notification section state
    const [pushNotifications, setPushNotifications] = useState(true);
    const [emailNotifications, setEmailNotifications] = useState(true);
    const [marketingEmails, setMarketingEmails] = useState(false);
    const [soundEnabled, setSoundEnabled] = useState(true);

    // Theme store
    const themeStore = useThemeStoreStandalone();
    const currentTheme = themeStore.theme;
    const fontSize = themeStore.fontSize;
    const language = themeStore.language;

    // Privacy section state
    const [profileVisibility, setProfileVisibility] = useState<'public' | 'private' | 'friends'>('public');
    const [showOnlineStatus, setShowOnlineStatus] = useState(true);
    const [allowMessagesFrom, setAllowMessagesFrom] = useState<'everyone' | 'friends' | 'none'>('friends');
    const [showActivityStatus, setShowActivityStatus] = useState(true);

    // Account section state
    const [accountCreated, setAccountCreated] = useState('January 2024');
    const [lastLogin, setLastLogin] = useState('Today at 2:30 PM');

    // Memoize theme-related calculations to prevent unnecessary recalculations
    const themeStyles = useMemo(() => {
        const isDarkTheme = theme === 'dark';
        return {
            isDarkTheme,
            backgroundColor: isDarkTheme ? '#121212' : '#f2f2f2',
            primaryColor: '#007AFF',
        };
    }, [theme]);

    // Memoize animation function to prevent recreation on every render
    const animateSaveButton = useCallback((toValue: number) => {
        Animated.spring(saveButtonScale, {
            toValue,
            useNativeDriver: true,
            tension: 150,
            friction: 8,
        }).start();
    }, [saveButtonScale]);

    // Helper function to extract display name from user data
    const extractDisplayName = useCallback((userData: any) => {
        if (!userData) return '';

        if (typeof userData.name === 'string') {
            return userData.name;
        } else if (userData.name && typeof userData.name === 'object') {
            const first = userData.name.first || '';
            const middle = userData.name.middle || '';
            const last = userData.name.last || '';
            return [first, middle, last].filter(Boolean).join(' ').trim();
        }
        return '';
    }, []);

    // Load settings when screen mounts
    useEffect(() => {
        const loadUserData = async () => {
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

        loadUserData();
    }, [isAuthenticated, oxyServices, ensureToken, loadSettings]);

    // Update local state when settings change
    useEffect(() => {
        if (settings && !isRefreshing) {
            console.log('AccountSettingsScreen: Settings updated:', settings);

            const userDisplayName = extractDisplayName(settings);

            setDisplayName(userDisplayName);
            setFirstName(settings.name?.first || '');
            setMiddleName(settings.name?.middle || '');
            setLastName(settings.name?.last || '');
            setUsername(settings.username || '');
            setEmail(settings.email || '');
            setBio(settings.bio || '');
            setDescription(settings.description || '');
            setLocation(settings.location || '');
            setAddresses(settings.addresses || []);
            setLinks(settings.links || []);
            setAvatarUrl(settings.avatar?.url || '');

            console.log('AccountSettingsScreen: Data loaded from settings:', {
                displayName: userDisplayName,
                username: settings.username,
                email: settings.email,
                bio: settings.bio,
                description: settings.description,
                location: settings.location,
                addresses: settings.addresses,
                links: settings.links,
                avatarUrl: settings.avatar?.url
            });
        } else if (!settings) {
            console.log('AccountSettingsScreen: No settings available');
        }
    }, [settings, isRefreshing, extractDisplayName]);

    // Add loading state for when settings are not yet available
    const isDataLoading = settingsLoading || !settings || isRefreshing;

    const handleSave = async () => {
        if (!settings || !oxyServices) {
            console.error('handleSave: Missing settings or oxyServices', { settings: !!settings, oxyServices: !!oxyServices });
            return;
        }

        try {
            setIsSaving(true);
            animateSaveButton(0.95); // Scale down slightly for animation

            console.log('handleSave: Starting settings update...');

            // Ensure the token is set before making API calls
            await ensureToken();

            const updates: Record<string, any> = {
                username,
                email,
                bio,
                description,
                location,
                addresses,
                links,
            };

            // Include name parts if any have changed
            if (firstName || middleName || lastName) {
                updates.name = {
                    first: firstName,
                    middle: middleName,
                    last: lastName
                };
            }

            // Handle avatar
            if (avatarUrl !== settings.avatar?.url) {
                updates.avatar = { url: avatarUrl };
            }

            console.log('handleSave: Making API call with updates:', updates);

            // Save settings to backend first
            await saveSettings(updates);
            console.log('handleSave: Settings update successful');

            toast.success('Settings updated successfully');

            animateSaveButton(1); // Scale back to normal

            if (onClose) {
                onClose();
            } else if (goBack) {
                goBack();
            }
        } catch (error: any) {
            console.error('Settings update error:', error);

            // Provide more specific error messages
            let errorMessage = 'Failed to update settings';
            if (error.code === 'INVALID_TOKEN' || error.status === 401) {
                errorMessage = 'Authentication expired. Please log in again.';
            } else if (error.message) {
                errorMessage = error.message;
            }

            toast.error(errorMessage);
            animateSaveButton(1); // Scale back to normal on error
        } finally {
            setIsSaving(false);
        }
    };

    const handleAvatarUpdate = () => {
        Alert.alert(
            'Update Avatar',
            'Choose how you want to update your profile picture',
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Use Mock URL',
                    onPress: () => {
                        const mockUrl = `https://ui-avatars.com/api/?name=${displayName || username}&background=random`;
                        setAvatarUrl(mockUrl);
                    },
                },
                {
                    text: 'Remove Avatar',
                    onPress: () => setAvatarUrl(''),
                    style: 'destructive',
                },
            ]
        );
    };

    const startEditing = (type: string, currentValue: string) => {
        switch (type) {
            case 'displayName':
                setTempFirstName(firstName);
                setTempMiddleName(middleName);
                setTempLastName(lastName);
                break;
            case 'username':
                setTempUsername(currentValue);
                break;
            case 'email':
                setTempEmail(currentValue);
                break;
            case 'bio':
                setTempBio(currentValue);
                break;
            case 'location':
                setTempLocation(currentValue);
                break;
            case 'link':
                setTempLink('');
                break;
            case 'address':
                setTempAddressFormatted('');
                break;
            case 'description':
                setTempDescription(currentValue);
                break;
            case 'theme':
                // No temp value needed for theme selection
                break;
        }
        setEditingField(type);
    };

    const saveField = async (type: string) => {
        try {
            animateSaveButton(0.95); // Scale down slightly for animation

            // Ensure the token is set before making API calls
            await ensureToken();

            // Prepare the update data based on the field type
            let updateData: Record<string, any> = {};
            let newValue = '';

            switch (type) {
                case 'displayName':
                    const newFirst = tempFirstName;
                    const newMiddle = tempMiddleName;
                    const newLast = tempLastName;
                    newValue = [newFirst, newMiddle, newLast].filter(Boolean).join(' ');
                    updateData.name = {
                        first: newFirst,
                        middle: newMiddle,
                        last: newLast
                    };
                    setFirstName(newFirst);
                    setMiddleName(newMiddle);
                    setLastName(newLast);
                    setDisplayName(newValue);
                    break;
                case 'username':
                    newValue = tempUsername;
                    updateData.username = newValue;
                    setUsername(newValue);
                    break;
                case 'email':
                    newValue = tempEmail.trim();
                    // Basic front-end email format check
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (newValue && !emailRegex.test(newValue)) {
                        toast.error('Please enter a valid email address');
                        animateSaveButton(1);
                        return;
                    }
                    updateData.email = newValue;
                    setEmail(newValue);
                    break;
                case 'bio':
                    newValue = tempBio;
                    if (newValue.length > 500) {
                        toast.error('Bio cannot exceed 500 characters');
                        animateSaveButton(1);
                        return;
                    }
                    updateData.bio = newValue;
                    setBio(newValue);
                    break;
                case 'description':
                    newValue = tempDescription;
                    if (newValue.length > 1000) {
                        toast.error('About section cannot exceed 1000 characters');
                        animateSaveButton(1);
                        return;
                    }
                    updateData.description = newValue;
                    setDescription(newValue);
                    break;
                case 'location':
                    newValue = tempLocation;
                    updateData.location = newValue;
                    setLocation(newValue);
                    break;
                case 'address':
                    // For now, just update addresses array (no inline editing of single item)
                    updateData.addresses = addresses;
                    break;
                case 'link':
                    // Always include links in the update, even if the array is empty, so that the backend clears the links
                    updateData.links = links;
                    // clear temp
                    setTempLink('');
                    break;
                case 'theme':
                    newValue = currentTheme;
                    updateData.theme = newValue;
                    break;
            }

            // Save to backend first
            console.log(`saveField: Saving ${type} with value:`, newValue);
            console.log('saveField: API update data:', updateData);

            await saveSettings(updateData);
            console.log(`saveField: ${type} saved successfully`);

            toast.success(`${getFieldLabel(type)} updated successfully`);

            // Refresh user data to ensure UI shows latest data
            setIsRefreshing(true);
            try {
                await refreshUserData();
                console.log(`saveField: User data refreshed after ${type} update`);
            } catch (error) {
                console.error(`saveField: Failed to refresh user data after ${type} update:`, error);
                // Don't show error to user as the save was successful
            } finally {
                setIsRefreshing(false);
            }

            // Brief delay for animation, then reset and close editing
            setTimeout(() => {
                animateSaveButton(1);
                setEditingField(null);
            }, 150);
        } catch (error: any) {
            console.error('Field save error:', error);
            console.error('Error details:', {
                message: error.message,
                status: error.status,
                code: error.code,
                response: error.response
            });

            // Provide more specific error messages
            let errorMessage = 'Failed to save field. Please try again.';
            if (error.code === 'INVALID_TOKEN' || error.status === 401) {
                errorMessage = 'Authentication expired. Please log in again.';
            } else if (error.message) {
                errorMessage = error.message;
            }

            toast.error(errorMessage);
            animateSaveButton(1);
        }
    };

    const cancelEditing = () => {
        setEditingField(null);
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

    const handleAddLink = () => {
        const url = tempLink.trim();
        if (!url) return;
        if (links.some(l => l.url === url)) {
            toast.error('Link already added');
            return;
        }

        const addLinkWithMeta = async () => {
            try {
                // Ensure token before calling preview endpoint (if it requires auth)
                await ensureToken();

                let meta: { title?: string | null; description?: string | null; image?: string | null } = {};

                if (oxyServices?.getLinkPreview) {
                    try {
                        const preview = await oxyServices.getLinkPreview(url);
                        meta = preview || {};
                    } catch (previewErr) {
                        console.warn('handleAddLink: Failed to fetch link preview, proceeding without meta', previewErr);
                    }
                }

                setLinks(prev => [...prev, { url, ...meta }]);
                toast.success('Link added');
            } catch (error) {
                console.error('handleAddLink: Failed to add link', error);
                toast.error('Failed to add link');
            } finally {
                setTempLink('');
            }
        };

        // We run the async logic but do not await here to keep UI responsive
        addLinkWithMeta();
    };

    const handleRemoveLink = (index: number) => {
        setLinks(prev => prev.filter((_, i) => i !== index));
    };

    const moveLink = (index: number, direction: 'up' | 'down') => {
        setLinks(prev => {
            const newArr = [...prev];
            const newIndex = direction === 'up' ? index - 1 : index + 1;
            if (newIndex < 0 || newIndex >= newArr.length) return prev;
            [newArr[index], newArr[newIndex]] = [newArr[newIndex], newArr[index]];
            return newArr;
        });
    };

    const handleAddAddress = () => {
        showPickerForIndex(null);
    };

    const showPickerForIndex = (index: number | null) => {
        editingAddressIndexRef.current = index;
        setShowAddressPicker(true);
    };

    const handleAddressPicked = (addr: PickerAddressObj) => {
        const editingIndex = editingAddressIndexRef.current;
        if (typeof editingIndex === 'number' && editingIndex >= 0) {
            // replace existing
            setAddresses(prev => prev.map((a, i) => i === editingIndex ? addr : a));
        } else {
            // add new
            if (addresses.some(a => a.formatted === addr.formatted)) {
                toast.error('Address already added');
            } else {
                setAddresses(prev => [...prev, addr]);
                toast.success('Location added');
            }
        }
        editingAddressIndexRef.current = null;
        setShowAddressPicker(false);
    };

    const handleCancelPick = () => setShowAddressPicker(false);

    const handleRemoveAddress = (index: number) => {
        setAddresses(prev => prev.filter((_, i) => i !== index));
    };

    const moveAddress = (index: number, direction: 'up' | 'down') => {
        setAddresses(prev => {
            const newArr = [...prev];
            const newIndex = direction === 'up' ? index - 1 : index + 1;
            if (newIndex < 0 || newIndex >= newArr.length) return prev;
            [newArr[index], newArr[newIndex]] = [newArr[newIndex], newArr[index]];
            return newArr;
        });
    };

    const editAddressLocation = (index: number) => {
        showPickerForIndex(index);
    };

    // Security section handlers
    const handleUpdatePassword = () => {
        toast.info('Password update coming soon!');
    };

    const handleToggleTwoFactor = () => {
        setHasTwoFactorEnabled(prev => !prev);
        toast.success(hasTwoFactorEnabled ? 'Two-factor authentication disabled' : 'Two-factor authentication enabled');
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
        startEditing('theme', currentTheme);
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

    const handleAccessibilitySettings = () => {
        toast.info('Accessibility settings coming soon!');
    };

    // Privacy section handlers
    const handleProfileVisibilityChange = () => {
        toast.info('Profile visibility settings coming soon!');
    };

    const handleToggleOnlineStatus = (value: boolean) => {
        setShowOnlineStatus(value);
        toast.success(value ? 'Online status visible' : 'Online status hidden');
    };

    const handleMessagePrivacyChange = () => {
        toast.info('Message privacy settings coming soon!');
    };

    const handleToggleActivityStatus = (value: boolean) => {
        setShowActivityStatus(value);
        toast.success(value ? 'Activity status visible' : 'Activity status hidden');
    };

    const handleBlockedUsers = () => {
        toast.info('Blocked users management coming soon!');
    };

    const handleDataExport = () => {
        toast.info('Data export coming soon!');
    };

    // Account section handlers
    const handleDeactivateAccount = () => {
        toast.info('Account deactivation coming soon!');
    };

    const handleDeleteAccount = () => {
        toast.info('Account deletion coming soon!');
    };

    const handleLogout = () => {
        toast.info('Logout functionality coming soon!');
    };

    const handleHelpSupport = () => {
        toast.info('Help & support coming soon!');
    };

    const handleTermsPrivacy = () => {
        toast.info('Terms & privacy coming soon!');
    };

    const renderEditingField = (type: string) => {
        const fieldConfig = {
            displayName: { label: 'Display Name', value: displayName, placeholder: 'Enter your display name', icon: 'person', color: '#007AFF', multiline: false, keyboardType: 'default' as const },
            username: { label: 'Username', value: username, placeholder: 'Choose a username', icon: 'at', color: '#5856D6', multiline: false, keyboardType: 'default' as const },
            email: { label: 'Email', value: email, placeholder: 'Enter your email address', icon: 'mail', color: '#FF9500', multiline: false, keyboardType: 'email-address' as const },
            bio: { label: 'Short Bio', value: bio, placeholder: 'Write a brief introduction (max 500 characters)...', icon: 'chatbubble-ellipses', color: '#FF9500', multiline: true, keyboardType: 'default' as const },
            description: { label: 'About Me', value: description, placeholder: 'Share your story, interests, and more (max 1000 characters)...', icon: 'document-text', color: '#34C759', multiline: true, keyboardType: 'default' as const },
            location: { label: 'Location', value: location, placeholder: 'Enter your location', icon: 'location', color: '#FF3B30', multiline: false, keyboardType: 'default' as const },
            address: { label: 'Locations', value: tempAddressFormatted, placeholder: 'Search or enter address', icon: 'location', color: '#FF3B30', multiline: false, keyboardType: 'default' as const },
            link: { label: 'Links', value: tempLink, placeholder: 'Enter URL', icon: 'link', color: '#32D74B', multiline: false, keyboardType: 'url' as const },
            theme: { label: 'Theme', value: currentTheme, placeholder: 'Choose your theme', icon: 'moon', color: '#5856D6', multiline: false, keyboardType: 'default' as const }
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
            const themeOptions = [
                { value: 'light', label: 'Light', icon: 'sunny', color: '#FF9500' },
                { value: 'dark', label: 'Dark', icon: 'moon', color: '#5856D6' },
                { value: 'auto', label: 'Auto', icon: 'settings', color: '#007AFF' },
            ];

            return (
                <View style={styles.newValueSection}>
                    <Text style={styles.editingFieldLabel}>Choose Theme:</Text>
                    {themeOptions.map((option, index) => (
                        <TouchableOpacity
                            key={option.value}
                            style={[
                                styles.settingItem,
                                index === 0 && styles.firstSettingItem,
                                index === themeOptions.length - 1 && styles.lastSettingItem,
                            ]}
                            onPress={() => handleThemeSelect(option.value as 'light' | 'dark' | 'auto')}
                        >
                            <View style={styles.settingInfo}>
                                <OxyIcon
                                    name={option.icon}
                                    size={20}
                                    color={option.color}
                                    style={styles.settingIcon}
                                />
                                <View>
                                    <Text style={styles.settingLabel}>{option.label}</Text>
                                    <Text style={styles.settingDescription}>
                                        {option.value === 'light' ? 'Light appearance for bright environments' :
                                            option.value === 'dark' ? 'Dark appearance for low-light environments' :
                                                'Automatically adjust based on system settings'}
                                    </Text>
                                </View>
                            </View>
                            <View style={styles.settingValue}>
                                {currentTheme === option.value && (
                                    <OxyIcon name="checkmark-circle" size={20} color="#007AFF" />
                                )}
                            </View>
                        </TouchableOpacity>
                    ))}
                </View>
            );
        }

        if (type === 'displayName') {
            return (
                <View style={styles.editingFieldContainer}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <Text style={styles.editingFieldLabel}>First Name:</Text>
                            <TextInput
                                style={[styles.editingFieldInput, { backgroundColor: themeStyles.isDarkTheme ? '#333' : '#fff', color: themeStyles.isDarkTheme ? '#fff' : '#000', borderColor: themeStyles.primaryColor }]}
                                value={tempFirstName}
                                onChangeText={setTempFirstName}
                                placeholder="Enter first name"
                                placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
                                autoFocus
                                selectionColor={themeStyles.primaryColor}
                            />

                            <Text style={[styles.editingFieldLabel, { marginTop: 16 }]}>Middle Name:</Text>
                            <TextInput
                                style={[styles.editingFieldInput, { backgroundColor: themeStyles.isDarkTheme ? '#333' : '#fff', color: themeStyles.isDarkTheme ? '#fff' : '#000', borderColor: themeStyles.primaryColor }]}
                                value={tempMiddleName}
                                onChangeText={setTempMiddleName}
                                placeholder="Enter middle name"
                                placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
                                selectionColor={themeStyles.primaryColor}
                            />

                            <Text style={[styles.editingFieldLabel, { marginTop: 16 }]}>Last Name:</Text>
                            <TextInput
                                style={[styles.editingFieldInput, { backgroundColor: themeStyles.isDarkTheme ? '#333' : '#fff', color: themeStyles.isDarkTheme ? '#fff' : '#000', borderColor: themeStyles.primaryColor }]}
                                value={tempLastName}
                                onChangeText={setTempLastName}
                                placeholder="Enter last name"
                                placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
                                selectionColor={themeStyles.primaryColor}
                            />
                        </View>
                    </View>
                </View>
            );
        }

        if (type === 'link') {
            return (
                <View style={styles.editingFieldContainer}>
                    <View style={styles.editingFieldContent}>
                        {/* Existing links list */}
                        {links.map((l, idx) => (
                            <View key={`link-${idx}`} style={{ marginBottom: 12 }}>
                                <Text style={{ fontWeight: '600', color: themeStyles.isDarkTheme ? '#fff' : '#000' }}>{l.title || l.url}</Text>
                                {l.description && (
                                    <Text style={{ color: '#666', marginBottom: 4 }}>{l.description}</Text>
                                )}
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <TouchableOpacity onPress={() => moveLink(idx as number, 'up')} disabled={idx === 0} style={{ padding: 4 }}>
                                        <Ionicons name="arrow-up" size={18} color="#888" />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => moveLink(idx as number, 'down')} disabled={idx === links.length - 1} style={{ padding: 4 }}>
                                        <Ionicons name="arrow-down" size={18} color="#888" />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => handleRemoveLink(idx as number)} style={{ padding: 4 }}>
                                        <Ionicons name="trash" size={18} color="#FF3B30" />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ))}

                        {/* Add new link */}
                        <Text style={[styles.editingFieldLabel, { marginTop: 16 }]}>Add New Link:</Text>
                        <TextInput
                            style={[styles.editingFieldInput, { backgroundColor: themeStyles.isDarkTheme ? '#333' : '#fff', color: themeStyles.isDarkTheme ? '#fff' : '#000', borderColor: themeStyles.primaryColor }]}
                            value={tempLink}
                            onChangeText={setTempLink}
                            placeholder={config.placeholder}
                            placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
                            keyboardType="url"
                            selectionColor={themeStyles.primaryColor}
                        />
                        <TouchableOpacity onPress={handleAddLink} disabled={tempLink.trim() === ''} style={{ marginTop: 12, alignSelf: 'flex-start', backgroundColor: tempLink.trim() === '' ? '#ccc' : themeStyles.primaryColor, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 }}>
                            <Text style={{ color: '#fff', fontWeight: '600' }}>Add</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }

        if (type === 'address') {
            if (showAddressPicker) {
                return (
                    <LocationPickerPanel
                        onCancel={handleCancelPick}
                        onSave={handleAddressPicked}
                        initialAddress={typeof editingAddressIndexRef.current === 'number' && editingAddressIndexRef.current! >= 0 ? addresses[editingAddressIndexRef.current] : undefined}
                    />
                );
            }

            return (
                <View style={styles.editingFieldContainer}>
                    <View style={styles.editingFieldContent}>
                        {/* Existing addresses list */}
                        {addresses.map((addr, idx) => (
                            <View key={`addr-${idx}`} style={{ marginBottom: 12 }}>
                                <Text style={{ fontWeight: '600', color: themeStyles.isDarkTheme ? '#fff' : '#000' }}>{addr.label ? `${addr.label}: ` : ''}{addr.formatted || addr.city || addr.street}</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <TouchableOpacity onPress={() => moveAddress(idx as number, 'up')} disabled={idx === 0} style={{ padding: 4 }}>
                                        <Ionicons name="arrow-up" size={18} color="#888" />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => moveAddress(idx as number, 'down')} disabled={idx === addresses.length - 1} style={{ padding: 4 }}>
                                        <Ionicons name="arrow-down" size={18} color="#888" />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => editAddressLocation(idx)} style={{ padding: 4 }}>
                                        <Ionicons name="pencil" size={18} color="#007AFF" />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => handleRemoveAddress(idx as number)} style={{ padding: 4 }}>
                                        <Ionicons name="trash" size={18} color="#FF3B30" />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ))}

                        {/* Add new address */}
                        <TouchableOpacity onPress={handleAddAddress} style={{ marginTop: 16, alignSelf: 'flex-start', backgroundColor: themeStyles.primaryColor, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 }}>
                            <Text style={{ color: '#fff', fontWeight: '600' }}>Add Location</Text>
                        </TouchableOpacity>
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
                        {(type === 'bio' || type === 'description') && (
                            <Text style={[
                                styles.characterCount,
                                {
                                    color: (() => {
                                        const maxLength = type === 'bio' ? 500 : 1000;
                                        const currentLength = tempValue.length;
                                        if (currentLength >= maxLength) return '#FF3B30';
                                        if (currentLength >= maxLength * 0.9) return '#FF9500';
                                        return themeStyles.isDarkTheme ? '#aaa' : '#666';
                                    })()
                                }
                            ]}>
                                {tempValue.length} / {type === 'bio' ? 500 : 1000} characters
                            </Text>
                        )}
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
                                            opacity: isSaving ? 0.7 : 1,
                                            backgroundColor: editingField ? getFieldIcon(editingField).color : '#007AFF'
                                        }
                                    ]}
                                    onPress={() => saveField(editingField)}
                                    disabled={isSaving}
                                >
                                    {isSaving ? (
                                        <ActivityIndicator size="small" color="#fff" />
                                    ) : (
                                        <Text style={styles.saveButtonText}>Save</Text>
                                    )}
                                </TouchableOpacity>
                            </Animated.View>
                        </View>
                        <View style={styles.editingHeaderBottom}>
                            <View style={styles.headerTitleWithIcon}>
                                <OxyIcon
                                    name={getFieldIcon(editingField).name}
                                    size={50}
                                    color={getFieldIcon(editingField).color}
                                    style={styles.headerIcon}
                                />
                                <Text style={styles.headerTitleLarge}>{getFieldLabel(editingField)}</Text>
                            </View>
                        </View>
                    </View>
                ) : (
                    <View style={styles.normalHeader}>
                        <TouchableOpacity style={styles.cancelButton} onPress={onClose || goBack}>
                            <Ionicons name="close" size={24} color="#666" />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Account Settings</Text>
                        <Animated.View style={{ transform: [{ scale: saveButtonScale }] }}>
                            <TouchableOpacity
                                style={[styles.saveIconButton, { opacity: isSaving ? 0.7 : 1 }]}
                                onPress={handleSave}
                                disabled={isSaving}
                            >
                                {isSaving ? (
                                    <ActivityIndicator size="small" color={themeStyles.primaryColor} />
                                ) : (
                                    <Ionicons name="checkmark" size={24} color={themeStyles.primaryColor} />
                                )}
                            </TouchableOpacity>
                        </Animated.View>
                    </View>
                )}
            </View>

            <View style={editingField ? styles.contentEditing : styles.content}>
                {editingField ? (
                    // Show only the editing interface when editing
                    <View style={styles.editingOnlyContainer}>
                        {renderEditingField(editingField)}
                    </View>
                ) : (
                    // Show all settings when not editing
                    <>
                        <ProfilePictureSection
                            avatarUrl={avatarUrl}
                            displayName={displayName}
                            username={username}
                            theme={theme}
                            onUpdateAvatar={handleAvatarUpdate}
                        />

                        <BasicInformationSection
                            renderField={renderField}
                            displayName={displayName}
                            username={username}
                            email={email}
                        />

                        <AboutYouSection
                            renderField={renderField}
                            bio={bio}
                            description={description}
                            addresses={addresses}
                            links={links}
                        />

                        <QuickActionsSection />

                        <SecuritySection
                            hasTwoFactorEnabled={hasTwoFactorEnabled}
                            lastPasswordChange={lastPasswordChange}
                            activeSessions={activeSessions}
                            onUpdatePassword={handleUpdatePassword}
                            onToggleTwoFactor={handleToggleTwoFactor}
                            onManageSessions={handleManageSessions}
                            onSecurityLog={handleSecurityLog}
                        />

                        <NotificationSection
                            pushNotifications={pushNotifications}
                            emailNotifications={emailNotifications}
                            marketingEmails={marketingEmails}
                            soundEnabled={soundEnabled}
                            onTogglePushNotifications={handleTogglePushNotifications}
                            onToggleEmailNotifications={handleToggleEmailNotifications}
                            onToggleMarketingEmails={handleToggleMarketingEmails}
                            onToggleSound={handleToggleSound}
                            onNotificationPreferences={handleNotificationPreferences}
                        />

                        <AppearanceSection
                            theme={currentTheme}
                            fontSize={fontSize}
                            language={language}
                            onThemeChange={handleThemeChange}
                            onFontSizeChange={handleFontSizeChange}
                            onLanguageChange={handleLanguageChange}
                            onAccessibilitySettings={handleAccessibilitySettings}
                        />

                        <PrivacySection
                            profileVisibility={profileVisibility}
                            showOnlineStatus={showOnlineStatus}
                            allowMessagesFrom={allowMessagesFrom}
                            showActivityStatus={showActivityStatus}
                            onProfileVisibilityChange={handleProfileVisibilityChange}
                            onToggleOnlineStatus={handleToggleOnlineStatus}
                            onMessagePrivacyChange={handleMessagePrivacyChange}
                            onToggleActivityStatus={handleToggleActivityStatus}
                            onBlockedUsers={handleBlockedUsers}
                            onDataExport={handleDataExport}
                        />

                        <AccountSection
                            accountCreated={accountCreated}
                            lastLogin={lastLogin}
                            onDeactivateAccount={handleDeactivateAccount}
                            onDeleteAccount={handleDeleteAccount}
                            onLogout={handleLogout}
                            onHelpSupport={handleHelpSupport}
                            onTermsPrivacy={handleTermsPrivacy}
                        />
                    </>
                )}
            </View>
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
        paddingVertical: 10,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        ...Platform.select({
            // Make the header stick to the top when rendered on the web
            web: { position: 'sticky', top: 0, zIndex: 1000 } as any,
        }),
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
        marginBottom: 16,
    },
    editingHeaderBottom: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000',
        fontFamily: fontFamilies.phuduBold,
    },
    headerTitleWithIcon: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        flex: 1,
        justifyContent: 'flex-start',
        maxWidth: '90%',
    },
    headerTitleLarge: {
        fontSize: 48,
        fontWeight: '800',
        color: '#000',
        fontFamily: fontFamilies.phuduExtraBold,
        textAlign: 'left',
    },
    headerIcon: {
        marginBottom: 2,
    },
    cancelButton: {
        padding: 5,
    },
    saveHeaderButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        minWidth: 60,
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveIconButton: {
        padding: 5,
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    content: {
        flex: 1,
        padding: 16,
    },
    contentEditing: {
        flex: 1,
        padding: 0,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
        fontFamily: fontFamilies.phuduSemiBold,
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
    settingValue: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    userIcon: {
        marginRight: 12,
    },
    // Inline editing styles
    editingContainer: {
        flex: 1,
    },
    editingActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    editingButton: {
        padding: 8,
    },
    editingButtonText: {
        fontSize: 16,
        fontWeight: '500',
    },
    inlineInput: {
        backgroundColor: '#f8f8f8',
        borderWidth: 1,
        borderColor: '#e0e0e0',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        minHeight: 44,
    },
    inlineTextArea: {
        backgroundColor: '#f8f8f8',
        borderWidth: 1,
        borderColor: '#e0e0e0',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        minHeight: 100,
        textAlignVertical: 'top',
    },
    // Editing-only mode styles
    editingOnlyContainer: {
        flex: 1,
    },
    editingFieldContainer: {
        backgroundColor: '#fff',
        padding: 16,
        flex: 1,
    },
    editingFieldHeader: {
        marginBottom: 16,
    },
    editingFieldTitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    editingFieldIcon: {
        marginRight: 12,
    },
    editingFieldTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#000',
    },
    editingFieldContent: {
        flex: 1,
    },
    newValueSection: {
        flex: 1,
        padding: 16,
    },
    editingFieldLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    editingFieldInput: {
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#e0e0e0',
        borderRadius: 12,
        padding: 16,
        fontSize: 17,
        minHeight: 52,
        fontWeight: '400',
    },
    editingFieldTextArea: {
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#e0e0e0',
        borderRadius: 12,
        padding: 16,
        fontSize: 17,
        minHeight: 120,
        textAlignVertical: 'top',
        fontWeight: '400',
    },
    characterCount: {
        fontSize: 12,
        marginTop: 8,
        textAlign: 'right',
        fontFamily: fontFamilies.phudu,
    },
});

export default React.memo(AccountSettingsScreen);

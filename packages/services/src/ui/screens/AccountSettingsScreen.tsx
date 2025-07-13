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
import Avatar from '../components/Avatar';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { fontFamilies } from '../styles/fonts';
import { confirmAction } from '../utils/confirmAction';

const AccountSettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
}) => {
    const { user, oxyServices, isLoading: authLoading, isAuthenticated } = useOxy();
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Animation refs
    const saveButtonScale = useRef(new Animated.Value(1)).current;

    // Form state
    const [displayName, setDisplayName] = useState('');
    const [lastName, setLastName] = useState('');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [bio, setBio] = useState('');
    const [location, setLocation] = useState('');
    const [website, setWebsite] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');

    // Editing states
    const [editingField, setEditingField] = useState<string | null>(null);

    // Temporary input states for inline editing
    const [tempDisplayName, setTempDisplayName] = useState('');
    const [tempLastName, setTempLastName] = useState('');
    const [tempUsername, setTempUsername] = useState('');
    const [tempEmail, setTempEmail] = useState('');
    const [tempBio, setTempBio] = useState('');
    const [tempLocation, setTempLocation] = useState('');
    const [tempWebsite, setTempWebsite] = useState('');

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

    // Load user data
    useEffect(() => {
        if (user) {
            const userDisplayName = typeof user.name === 'string'
                ? user.name
                : user.name?.first || user.name?.full || '';
            const userLastName = typeof user.name === 'object' ? user.name?.last || '' : '';
            setDisplayName(userDisplayName);
            setLastName(userLastName);
            setUsername(user.username || '');
            setEmail(user.email || '');
            setBio(user.bio || '');
            setLocation(user.location || '');
            setWebsite(user.website || '');
            setAvatarUrl(user.avatar?.url || '');
        }
    }, [user]);

    const handleSave = async () => {
        if (!user) return;

        try {
            setIsSaving(true);
            animateSaveButton(0.95); // Scale down slightly for animation

            const updates: Record<string, any> = {
                username,
                email,
                bio,
                location,
                website,
            };

            // Handle name field
            if (displayName || lastName) {
                updates.name = { first: displayName, last: lastName };
            }

            // Handle avatar
            if (avatarUrl !== user.avatar?.url) {
                updates.avatar = { url: avatarUrl };
            }

            await oxyServices.updateProfile(updates);
            toast.success('Profile updated successfully');

            animateSaveButton(1); // Scale back to normal

            if (onClose) {
                onClose();
            } else if (goBack) {
                goBack();
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to update profile');
            animateSaveButton(1); // Scale back to normal on error
        } finally {
            setIsSaving(false);
        }
    };

    const handleAvatarUpdate = () => {
        // Always use confirmAction for both web and native
        confirmAction('Remove your profile picture?', () => {
            setAvatarUrl('');
            toast.success('Avatar removed');
        });
    };

    const startEditing = (type: string, currentValue: string) => {
        switch (type) {
            case 'displayName':
                setTempDisplayName(displayName);
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
            case 'website':
                setTempWebsite(currentValue);
                break;
        }
        setEditingField(type);
    };

    const saveField = (type: string) => {
        animateSaveButton(0.95); // Scale down slightly for animation

        switch (type) {
            case 'displayName':
                setDisplayName(tempDisplayName);
                setLastName(tempLastName);
                break;
            case 'username':
                setUsername(tempUsername);
                break;
            case 'email':
                setEmail(tempEmail);
                break;
            case 'bio':
                setBio(tempBio);
                break;
            case 'location':
                setLocation(tempLocation);
                break;
            case 'website':
                setWebsite(tempWebsite);
                break;
        }

        // Brief delay for animation, then reset and close editing
        setTimeout(() => {
            animateSaveButton(1);
            setEditingField(null);
        }, 150);
    };

    const cancelEditing = () => {
        setEditingField(null);
    };

    const getFieldLabel = (type: string) => {
        const labels = {
            displayName: 'Display Name',
            username: 'Username',
            email: 'Email',
            bio: 'Bio',
            location: 'Location',
            website: 'Website'
        };
        return labels[type as keyof typeof labels] || 'Field';
    };

    const getFieldIcon = (type: string) => {
        const icons = {
            displayName: { name: 'person', color: '#007AFF' },
            username: { name: 'at', color: '#5856D6' },
            email: { name: 'mail', color: '#FF9500' },
            bio: { name: 'document-text', color: '#34C759' },
            location: { name: 'location', color: '#FF3B30' },
            website: { name: 'link', color: '#32D74B' }
        };
        return icons[type as keyof typeof icons] || { name: 'person', color: '#007AFF' };
    };

    const renderEditingField = (type: string) => {
        if (type === 'displayName') {
            return (
                <View style={styles.editingFieldContainer}>
                    <View style={styles.editingFieldContent}>
                        <View style={[styles.newValueSection, { flexDirection: 'row', gap: 12 }]}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.editingFieldLabel}>First Name</Text>
                                <TextInput
                                    style={styles.editingFieldInput}
                                    value={tempDisplayName}
                                    onChangeText={setTempDisplayName}
                                    placeholder="Enter your first name"
                                    placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
                                    autoFocus
                                    selectionColor={themeStyles.primaryColor}
                                />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.editingFieldLabel}>Last Name</Text>
                                <TextInput
                                    style={styles.editingFieldInput}
                                    value={tempLastName}
                                    onChangeText={setTempLastName}
                                    placeholder="Enter your last name"
                                    placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
                                    selectionColor={themeStyles.primaryColor}
                                />
                            </View>
                        </View>
                    </View>
                </View>
            );
        }
        const fieldConfig = {
            displayName: { label: 'Display Name', value: displayName, placeholder: 'Enter your display name', icon: 'person', color: '#007AFF', multiline: false, keyboardType: 'default' as const },
            username: { label: 'Username', value: username, placeholder: 'Choose a username', icon: 'at', color: '#5856D6', multiline: false, keyboardType: 'default' as const },
            email: { label: 'Email', value: email, placeholder: 'Enter your email address', icon: 'mail', color: '#FF9500', multiline: false, keyboardType: 'email-address' as const },
            bio: { label: 'Bio', value: bio, placeholder: 'Tell people about yourself...', icon: 'document-text', color: '#34C759', multiline: true, keyboardType: 'default' as const },
            location: { label: 'Location', value: location, placeholder: 'Enter your location', icon: 'location', color: '#FF3B30', multiline: false, keyboardType: 'default' as const },
            website: { label: 'Website', value: website, placeholder: 'Enter your website URL', icon: 'link', color: '#32D74B', multiline: false, keyboardType: 'url' as const }
        };

        const config = fieldConfig[type as keyof typeof fieldConfig];
        if (!config) return null;

        const tempValue = (() => {
            switch (type) {
                case 'displayName': return tempDisplayName;
                case 'username': return tempUsername;
                case 'email': return tempEmail;
                case 'bio': return tempBio;
                case 'location': return tempLocation;
                case 'website': return tempWebsite;
                default: return '';
            }
        })();

        const setTempValue = (text: string) => {
            switch (type) {
                case 'displayName': setTempDisplayName(text); break;
                case 'username': setTempUsername(text); break;
                case 'email': setTempEmail(text); break;
                case 'bio': setTempBio(text); break;
                case 'location': setTempLocation(text); break;
                case 'website': setTempWebsite(text); break;
            }
        };

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

    if (authLoading || !isAuthenticated) {
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

            <ScrollView style={editingField ? styles.contentEditing : styles.content}>
                {editingField ? (
                    // Show only the editing interface when editing
                    <View style={styles.editingOnlyContainer}>
                        {renderEditingField(editingField)}
                    </View>
                ) : (
                    // Show all settings when not editing
                    <>
                        {/* Profile Picture Section */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Profile Picture</Text>

                            <TouchableOpacity
                                style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}
                                onPress={handleAvatarUpdate}
                            >
                                <View style={styles.userIcon}>
                                    <Avatar
                                        uri={avatarUrl}
                                        name={displayName || username}
                                        size={50}
                                        theme={theme}
                                    />
                                </View>
                                <View style={styles.settingInfo}>
                                    <View>
                                        <Text style={styles.settingLabel}>Profile Photo</Text>
                                        <Text style={styles.settingDescription}>
                                            {avatarUrl ? 'Tap to change your profile picture' : 'Tap to add a profile picture'}
                                        </Text>
                                    </View>
                                </View>
                                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                            </TouchableOpacity>
                        </View>

                        {/* Basic Information */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Basic Information</Text>

                            {renderField(
                                'displayName',
                                'Display Name',
                                displayName,
                                'Add your display name',
                                'person',
                                '#007AFF',
                                false,
                                'default',
                                true,
                                false
                            )}

                            {renderField(
                                'username',
                                'Username',
                                username,
                                'Choose a username',
                                'at',
                                '#5856D6',
                                false,
                                'default',
                                false,
                                false
                            )}

                            {renderField(
                                'email',
                                'Email',
                                email,
                                'Add your email address',
                                'mail',
                                '#FF9500',
                                false,
                                'email-address',
                                false,
                                true
                            )}
                        </View>

                        {/* About You */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>About You</Text>

                            {renderField(
                                'bio',
                                'Bio',
                                bio,
                                'Tell people about yourself',
                                'document-text',
                                '#34C759',
                                true,
                                'default',
                                true,
                                false
                            )}

                            {renderField(
                                'location',
                                'Location',
                                location,
                                'Add your location',
                                'location',
                                '#FF3B30',
                                false,
                                'default',
                                false,
                                false
                            )}

                            {renderField(
                                'website',
                                'Website',
                                website,
                                'Add your website',
                                'link',
                                '#32D74B',
                                false,
                                'url',
                                false,
                                true
                            )}
                        </View>

                        {/* Quick Actions */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Quick Actions</Text>

                            <TouchableOpacity
                                style={[styles.settingItem, styles.firstSettingItem]}
                                onPress={() => toast.info('Privacy settings coming soon!')}
                            >
                                <View style={styles.settingInfo}>
                                    <OxyIcon name="shield-checkmark" size={20} color="#8E8E93" style={styles.settingIcon} />
                                    <View>
                                        <Text style={styles.settingLabel}>Privacy Settings</Text>
                                        <Text style={styles.settingDescription}>Control who can see your profile</Text>
                                    </View>
                                </View>
                                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.settingItem, styles.lastSettingItem]}
                                onPress={() => toast.info('Account verification coming soon!')}
                            >
                                <View style={styles.settingInfo}>
                                    <OxyIcon name="checkmark-circle" size={20} color="#30D158" style={styles.settingIcon} />
                                    <View>
                                        <Text style={styles.settingLabel}>Verify Account</Text>
                                        <Text style={styles.settingDescription}>Get a verified badge</Text>
                                    </View>
                                </View>
                                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                            </TouchableOpacity>
                        </View>
                    </>
                )}
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
        paddingVertical: 10,
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
});

export default React.memo(AccountSettingsScreen);

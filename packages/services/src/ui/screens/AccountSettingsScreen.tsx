import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Alert,
    TextInput,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import Avatar from '../components/Avatar';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '../../lib/icons';
import { toast } from '../../lib/sonner';

const AccountSettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    const { user, oxyServices, isLoading: authLoading } = useOxy();
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Form state
    const [displayName, setDisplayName] = useState('');
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
    const [tempUsername, setTempUsername] = useState('');
    const [tempEmail, setTempEmail] = useState('');
    const [tempBio, setTempBio] = useState('');
    const [tempLocation, setTempLocation] = useState('');
    const [tempWebsite, setTempWebsite] = useState('');

    const isDarkTheme = theme === 'dark';
    const backgroundColor = isDarkTheme ? '#121212' : '#f2f2f2';
    const primaryColor = '#007AFF';

    // Load user data
    useEffect(() => {
        if (user) {
            const userDisplayName = typeof user.name === 'string' 
                ? user.name 
                : user.name?.full || user.name?.first || '';
            
            setDisplayName(userDisplayName);
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

            const updates: Record<string, any> = {
                username,
                email,
                bio,
                location,
                website,
            };

            // Handle name field
            if (displayName) {
                updates.name = displayName;
            }

            // Handle avatar
            if (avatarUrl !== user.avatar?.url) {
                updates.avatar = { url: avatarUrl };
            }

            await oxyServices.updateUser(user.id, updates);
            toast.success('Profile updated successfully');
            
            if (onClose) {
                onClose();
            } else if (goBack) {
                goBack();
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to update profile');
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
                setTempDisplayName(currentValue);
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
        switch (type) {
            case 'displayName':
                setDisplayName(tempDisplayName);
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
        setEditingField(null);
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
                    {config.value ? (
                        <View style={styles.currentValueSection}>
                            <Text style={styles.editingFieldLabel}>Current:</Text>
                            <Text style={styles.editingFieldCurrentValue}>
                                {config.value}
                            </Text>
                        </View>
                    ) : null}
                    
                    <View style={styles.newValueSection}>
                        <Text style={styles.editingFieldLabel}>
                            {config.value ? 'New value:' : `Enter ${config.label.toLowerCase()}:`}
                        </Text>
                        <TextInput
                            style={[
                                config.multiline ? styles.editingFieldTextArea : styles.editingFieldInput,
                                { 
                                    backgroundColor: isDarkTheme ? '#333' : '#fff',
                                    color: isDarkTheme ? '#fff' : '#000',
                                    borderColor: isDarkTheme ? '#444' : '#e0e0e0'
                                }
                            ]}
                            value={tempValue}
                            onChangeText={setTempValue}
                            placeholder={config.placeholder}
                            placeholderTextColor={isDarkTheme ? '#aaa' : '#999'}
                            multiline={config.multiline}
                            numberOfLines={config.multiline ? 6 : 1}
                            keyboardType={config.keyboardType}
                            autoFocus
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

    if (authLoading || !user) {
        return (
            <View style={[styles.container, { backgroundColor, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={primaryColor} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.cancelButton} onPress={editingField ? cancelEditing : (onClose || goBack)}>
                    <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
                
                {editingField ? (
                    <View style={styles.headerTitleWithIcon}>
                        <OxyIcon 
                            name={getFieldIcon(editingField).name} 
                            size={20} 
                            color={getFieldIcon(editingField).color} 
                            style={styles.headerIcon} 
                        />
                        <Text style={styles.headerTitle}>{getFieldLabel(editingField)}</Text>
                    </View>
                ) : (
                    <Text style={styles.headerTitle}>Account Settings</Text>
                )}
                
                <TouchableOpacity 
                    style={[styles.saveHeaderButton, { opacity: isSaving ? 0.7 : 1 }]} 
                    onPress={editingField ? () => saveField(editingField) : handleSave}
                    disabled={isSaving}
                >
                    {isSaving ? (
                        <ActivityIndicator size="small" color={primaryColor} />
                    ) : (
                        <Ionicons name="checkmark" size={24} color={primaryColor} />
                    )}
                </TouchableOpacity>
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
    headerTitleWithIcon: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerIcon: {
        marginRight: 8,
    },
    cancelButton: {
        padding: 8,
    },
    saveHeaderButton: {
        padding: 8,
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
    editingHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
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
    currentValueSection: {
        marginBottom: 20,
    },
    newValueSection: {
        flex: 1,
    },
    editingFieldLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#666',
        marginBottom: 8,
    },
    editingFieldCurrentValue: {
        fontSize: 16,
        color: '#333',
        backgroundColor: '#f8f8f8',
        padding: 12,
        borderRadius: 8,
        marginBottom: 4,
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

export default AccountSettingsScreen;

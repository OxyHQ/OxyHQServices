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
    Modal,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import Avatar from '../components/Avatar';
import OxyIcon from '../components/icon/OxyIcon';
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

    // Modal states
    const [showDisplayNameModal, setShowDisplayNameModal] = useState(false);
    const [showUsernameModal, setShowUsernameModal] = useState(false);
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [showBioModal, setShowBioModal] = useState(false);
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [showWebsiteModal, setShowWebsiteModal] = useState(false);

    // Temporary input states for modals
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

    const openModal = (type: string, currentValue: string) => {
        switch (type) {
            case 'displayName':
                setTempDisplayName(currentValue);
                setShowDisplayNameModal(true);
                break;
            case 'username':
                setTempUsername(currentValue);
                setShowUsernameModal(true);
                break;
            case 'email':
                setTempEmail(currentValue);
                setShowEmailModal(true);
                break;
            case 'bio':
                setTempBio(currentValue);
                setShowBioModal(true);
                break;
            case 'location':
                setTempLocation(currentValue);
                setShowLocationModal(true);
                break;
            case 'website':
                setTempWebsite(currentValue);
                setShowWebsiteModal(true);
                break;
        }
    };

    const saveModalInput = (type: string) => {
        switch (type) {
            case 'displayName':
                setDisplayName(tempDisplayName);
                setShowDisplayNameModal(false);
                break;
            case 'username':
                setUsername(tempUsername);
                setShowUsernameModal(false);
                break;
            case 'email':
                setEmail(tempEmail);
                setShowEmailModal(false);
                break;
            case 'bio':
                setBio(tempBio);
                setShowBioModal(false);
                break;
            case 'location':
                setLocation(tempLocation);
                setShowLocationModal(false);
                break;
            case 'website':
                setWebsite(tempWebsite);
                setShowWebsiteModal(false);
                break;
        }
    };

    const renderEditModal = (
        visible: boolean,
        title: string,
        value: string,
        onChangeText: (text: string) => void,
        onSave: () => void,
        onCancel: () => void,
        placeholder: string,
        multiline = false,
        keyboardType: 'default' | 'email-address' | 'url' = 'default'
    ) => (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onCancel}
        >
            <View style={[styles.modalContainer, { backgroundColor }]}>
                <View style={styles.modalHeader}>
                    <TouchableOpacity onPress={onCancel}>
                        <Text style={[styles.modalButton, { color: '#666' }]}>Cancel</Text>
                    </TouchableOpacity>
                    <Text style={styles.modalTitle}>{title}</Text>
                    <TouchableOpacity onPress={onSave}>
                        <Text style={[styles.modalButton, { color: primaryColor }]}>Save</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.modalContent}>
                    <TextInput
                        style={[
                            multiline ? styles.modalTextArea : styles.modalInput,
                            { 
                                backgroundColor: isDarkTheme ? '#333' : '#fff',
                                color: isDarkTheme ? '#fff' : '#000',
                                borderColor: isDarkTheme ? '#444' : '#e0e0e0'
                            }
                        ]}
                        value={value}
                        onChangeText={onChangeText}
                        placeholder={placeholder}
                        placeholderTextColor={isDarkTheme ? '#aaa' : '#999'}
                        multiline={multiline}
                        numberOfLines={multiline ? 4 : 1}
                        keyboardType={keyboardType}
                        autoFocus
                    />
                </View>
            </View>
        </Modal>
    );

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
                <TouchableOpacity style={styles.cancelButton} onPress={onClose || goBack}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Account Settings</Text>
                <TouchableOpacity 
                    style={[styles.saveHeaderButton, { opacity: isSaving ? 0.7 : 1 }]} 
                    onPress={handleSave}
                    disabled={isSaving}
                >
                    {isSaving ? (
                        <ActivityIndicator size="small" color={primaryColor} />
                    ) : (
                        <Text style={[styles.saveHeaderButtonText, { color: primaryColor }]}>Save</Text>
                    )}
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.content}>
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
                    
                    <TouchableOpacity 
                        style={[styles.settingItem, styles.firstSettingItem]}
                        onPress={() => openModal('displayName', displayName)}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="person" size={20} color="#007AFF" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Display Name</Text>
                                <Text style={styles.settingDescription}>
                                    {displayName || 'Add your display name'}
                                </Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity 
                        style={styles.settingItem}
                        onPress={() => openModal('username', username)}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="at" size={20} color="#5856D6" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Username</Text>
                                <Text style={styles.settingDescription}>
                                    {username ? `@${username}` : 'Choose a username'}
                                </Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity 
                        style={[styles.settingItem, styles.lastSettingItem]}
                        onPress={() => openModal('email', email)}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="mail" size={20} color="#FF9500" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Email</Text>
                                <Text style={styles.settingDescription}>
                                    {email || 'Add your email address'}
                                </Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>
                </View>

                {/* About You */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>About You</Text>
                    
                    <TouchableOpacity 
                        style={[styles.settingItem, styles.firstSettingItem]}
                        onPress={() => openModal('bio', bio)}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="document-text" size={20} color="#34C759" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Bio</Text>
                                <Text style={styles.settingDescription}>
                                    {bio || 'Tell people about yourself'}
                                </Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity 
                        style={styles.settingItem}
                        onPress={() => openModal('location', location)}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="location" size={20} color="#FF3B30" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Location</Text>
                                <Text style={styles.settingDescription}>
                                    {location || 'Add your location'}
                                </Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>

                    <TouchableOpacity 
                        style={[styles.settingItem, styles.lastSettingItem]}
                        onPress={() => openModal('website', website)}
                    >
                        <View style={styles.settingInfo}>
                            <OxyIcon name="link" size={20} color="#32D74B" style={styles.settingIcon} />
                            <View>
                                <Text style={styles.settingLabel}>Website</Text>
                                <Text style={styles.settingDescription}>
                                    {website || 'Add your website'}
                                </Text>
                            </View>
                        </View>
                        <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                    </TouchableOpacity>
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
            </ScrollView>

            {/* Modals */}
            {renderEditModal(
                showDisplayNameModal,
                'Display Name',
                tempDisplayName,
                setTempDisplayName,
                () => saveModalInput('displayName'),
                () => setShowDisplayNameModal(false),
                'Enter your display name'
            )}

            {renderEditModal(
                showUsernameModal,
                'Username',
                tempUsername,
                setTempUsername,
                () => saveModalInput('username'),
                () => setShowUsernameModal(false),
                'Choose a username'
            )}

            {renderEditModal(
                showEmailModal,
                'Email',
                tempEmail,
                setTempEmail,
                () => saveModalInput('email'),
                () => setShowEmailModal(false),
                'Enter your email address',
                false,
                'email-address'
            )}

            {renderEditModal(
                showBioModal,
                'Bio',
                tempBio,
                setTempBio,
                () => saveModalInput('bio'),
                () => setShowBioModal(false),
                'Tell people about yourself...',
                true
            )}

            {renderEditModal(
                showLocationModal,
                'Location',
                tempLocation,
                setTempLocation,
                () => saveModalInput('location'),
                () => setShowLocationModal(false),
                'Enter your location'
            )}

            {renderEditModal(
                showWebsiteModal,
                'Website',
                tempWebsite,
                setTempWebsite,
                () => saveModalInput('website'),
                () => setShowWebsiteModal(false),
                'Enter your website URL',
                false,
                'url'
            )}
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
    cancelButton: {
        padding: 8,
    },
    cancelButtonText: {
        fontSize: 16,
        color: '#666',
        fontWeight: '400',
    },
    saveHeaderButton: {
        padding: 8,
    },
    saveHeaderButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    content: {
        flex: 1,
        padding: 16,
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
    // Modal styles
    modalContainer: {
        flex: 1,
        backgroundColor: '#f2f2f2',
    },
    modalHeader: {
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
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#000',
    },
    modalButton: {
        fontSize: 16,
        fontWeight: '500',
    },
    modalContent: {
        padding: 20,
    },
    modalInput: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e0e0e0',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        minHeight: 50,
    },
    modalTextArea: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e0e0e0',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        minHeight: 120,
        textAlignVertical: 'top',
    },
});

export default AccountSettingsScreen;

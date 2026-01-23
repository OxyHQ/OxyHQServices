import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Platform,
    Image,
    TextInputProps,
    KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BaseScreenProps } from '../types/navigation';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';
import { normalizeTheme } from '../utils/themeUtils';
import { Header } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useOxy } from '../context/OxyContext';
import { useProfileEditing } from '../hooks/useProfileEditing';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { EMAIL_REGEX } from '../../utils/validationUtils';

/**
 * Field types supported by EditProfileFieldScreen
 */
export type ProfileFieldType =
    | 'displayName'
    | 'username'
    | 'email'
    | 'bio'
    | 'phone'
    | 'address'
    | 'birthday'
    | 'location'
    | 'locations'
    | 'links';

/**
 * Field configuration for each field type
 */
interface FieldConfig {
    title: string;
    subtitle?: string;
    fields: Array<{
        key: string;
        label: string;
        placeholder: string;
        type?: 'text' | 'email' | 'textarea';
        validation?: (value: string) => string | undefined;
        inputProps?: Partial<TextInputProps>;
    }>;
    isList?: boolean;
}

interface EditProfileFieldScreenProps extends BaseScreenProps {
    /** The field type to edit */
    fieldType?: ProfileFieldType;
}

/**
 * EditProfileFieldScreen - A dedicated screen for editing profile fields
 *
 * Navigate to this screen with a fieldType prop to edit that specific field.
 *
 * @example
 * navigate('EditProfileField', { fieldType: 'username' })
 */
const EditProfileFieldScreen: React.FC<EditProfileFieldScreenProps> = ({
    goBack,
    onClose,
    theme,
    fieldType = 'displayName',
}) => {
    const { user } = useOxy();
    const { t } = useI18n();
    const { saveProfile, updateField, isSaving } = useProfileEditing();
    const colorScheme = useColorScheme();
    const normalizedTheme = normalizeTheme(theme);
    const themeStyles = useThemeStyles(normalizedTheme, colorScheme);
    const colors = themeStyles.colors;

    // State for field values
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

    // State for list fields (locations, links)
    const [listItems, setListItems] = useState<Array<{ id: string; [key: string]: unknown }>>([]);
    const [newItemValue, setNewItemValue] = useState('');

    // Get field configuration based on fieldType
    const fieldConfig = useMemo((): FieldConfig => {
        switch (fieldType) {
            case 'displayName':
                return {
                    title: t('editProfile.items.displayName.title') || 'Display Name',
                    subtitle: t('editProfile.items.displayName.subtitle') || 'This is how your name will appear to others',
                    fields: [
                        {
                            key: 'displayName',
                            label: t('editProfile.items.displayName.firstName') || 'First Name',
                            placeholder: t('editProfile.items.displayName.firstNamePlaceholder') || 'Enter first name',
                        },
                        {
                            key: 'lastName',
                            label: t('editProfile.items.displayName.lastName') || 'Last Name',
                            placeholder: t('editProfile.items.displayName.lastNamePlaceholder') || 'Enter last name (optional)',
                        },
                    ],
                };
            case 'username':
                return {
                    title: t('editProfile.items.username.title') || 'Username',
                    subtitle: t('editProfile.items.username.subtitle') || 'Your unique identifier on the platform',
                    fields: [
                        {
                            key: 'username',
                            label: t('editProfile.items.username.label') || 'Username',
                            placeholder: t('editProfile.items.username.placeholder') || 'Choose a username',
                            validation: (value) => {
                                if (!value.trim()) {
                                    return t('editProfile.items.username.required') || 'Username is required';
                                }
                                if (value.length < 3) {
                                    return t('editProfile.items.username.tooShort') || 'Username must be at least 3 characters';
                                }
                                return undefined;
                            },
                            inputProps: {
                                autoCapitalize: 'none',
                                autoCorrect: false,
                            },
                        },
                    ],
                };
            case 'email':
                return {
                    title: t('editProfile.items.email.title') || 'Email',
                    subtitle: t('editProfile.items.email.subtitle') || 'Your primary email address',
                    fields: [
                        {
                            key: 'email',
                            label: t('editProfile.items.email.label') || 'Email Address',
                            placeholder: t('editProfile.items.email.placeholder') || 'Enter your email address',
                            type: 'email',
                            validation: (value) => {
                                if (!EMAIL_REGEX.test(value)) {
                                    return t('editProfile.items.email.invalid') || 'Please enter a valid email address';
                                }
                                return undefined;
                            },
                            inputProps: {
                                keyboardType: 'email-address',
                                autoCapitalize: 'none',
                                autoCorrect: false,
                            },
                        },
                    ],
                };
            case 'bio':
                return {
                    title: t('editProfile.items.bio.title') || 'Bio',
                    subtitle: t('editProfile.items.bio.subtitle') || 'Tell people a bit about yourself',
                    fields: [
                        {
                            key: 'bio',
                            label: t('editProfile.items.bio.label') || 'Bio',
                            placeholder: t('editProfile.items.bio.placeholder') || 'Tell people about yourself...',
                            type: 'textarea',
                            inputProps: {
                                multiline: true,
                                numberOfLines: 6,
                                textAlignVertical: 'top',
                            },
                        },
                    ],
                };
            case 'phone':
                return {
                    title: t('editProfile.items.phone.title') || 'Phone Number',
                    subtitle: t('editProfile.items.phone.subtitle') || 'Your contact phone number',
                    fields: [
                        {
                            key: 'phone',
                            label: t('editProfile.items.phone.label') || 'Phone Number',
                            placeholder: t('editProfile.items.phone.placeholder') || 'Enter your phone number',
                            inputProps: {
                                keyboardType: 'phone-pad',
                                autoCapitalize: 'none',
                                autoCorrect: false,
                            },
                        },
                    ],
                };
            case 'address':
                return {
                    title: t('editProfile.items.address.title') || 'Address',
                    subtitle: t('editProfile.items.address.subtitle') || 'Your physical address',
                    fields: [
                        {
                            key: 'address',
                            label: t('editProfile.items.address.label') || 'Address',
                            placeholder: t('editProfile.items.address.placeholder') || 'Enter your address',
                            type: 'textarea',
                            inputProps: {
                                multiline: true,
                                numberOfLines: 3,
                                textAlignVertical: 'top',
                            },
                        },
                    ],
                };
            case 'birthday':
                return {
                    title: t('editProfile.items.birthday.title') || 'Birthday',
                    subtitle: t('editProfile.items.birthday.subtitle') || 'Your date of birth',
                    fields: [
                        {
                            key: 'birthday',
                            label: t('editProfile.items.birthday.label') || 'Birthday',
                            placeholder: t('editProfile.items.birthday.placeholder') || 'YYYY-MM-DD',
                            inputProps: {
                                autoCapitalize: 'none',
                                autoCorrect: false,
                            },
                        },
                    ],
                };
            case 'locations':
                return {
                    title: t('editProfile.items.locations.title') || 'Locations',
                    subtitle: t('editProfile.items.locations.subtitle') || 'Places you\'ve been or live',
                    fields: [],
                    isList: true,
                };
            case 'links':
                return {
                    title: t('editProfile.items.links.title') || 'Links',
                    subtitle: t('editProfile.items.links.subtitle') || 'Share your website, social profiles, etc.',
                    fields: [],
                    isList: true,
                };
            default:
                return {
                    title: 'Edit Field',
                    fields: [],
                };
        }
    }, [fieldType, t]);

    // Initialize field values from user data
    useEffect(() => {
        if (!user) return;

        // Cast user to any to access dynamic properties
        const userData = user as any;

        if (fieldConfig.isList) {
            if (fieldType === 'locations') {
                const locations = Array.isArray(userData.locations) ? userData.locations : [];
                setListItems(locations.map((loc: any, i: number) => ({
                    id: loc.id || `location-${i}`,
                    name: loc.name || '',
                    ...loc,
                })));
            } else if (fieldType === 'links') {
                const linksMetadata = Array.isArray(userData.linksMetadata) ? userData.linksMetadata : [];
                const links = Array.isArray(userData.links) ? userData.links : [];
                // Use linksMetadata if available, otherwise convert links array
                if (linksMetadata.length > 0) {
                    setListItems(linksMetadata.map((link: any, i: number) => ({
                        id: link.id || `link-${i}`,
                        url: link.url || link.link || '',
                        title: link.title || '',
                        ...link,
                    })));
                } else {
                    setListItems(links.map((item: any, i: number) => {
                        const url = typeof item === 'string' ? item : (item.link || item.url || '');
                        return {
                            id: `link-${i}`,
                            url,
                            title: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                        };
                    }));
                }
            }
        } else {
            const initialValues: Record<string, string> = {};
            fieldConfig.fields.forEach(field => {
                if (field.key === 'displayName') {
                    initialValues[field.key] = String(userData.displayName || userData.name?.first || '');
                } else if (field.key === 'lastName') {
                    initialValues[field.key] = String(userData.lastName || userData.name?.last || '');
                } else if (field.key === 'birthday') {
                    initialValues[field.key] = String(userData.birthday || userData.dateOfBirth || '');
                } else if (field.key === 'address') {
                    initialValues[field.key] = String(userData.address || userData.location || '');
                } else {
                    initialValues[field.key] = String(userData[field.key] || '');
                }
            });
            setFieldValues(initialValues);
        }
    }, [user, fieldConfig, fieldType]);

    // Field change handler
    const handleFieldChange = useCallback((key: string, value: string) => {
        setFieldValues(prev => ({ ...prev, [key]: value }));
        if (fieldErrors[key]) {
            setFieldErrors(prev => ({ ...prev, [key]: undefined }));
        }
    }, [fieldErrors]);

    // Validate all fields
    const validateFields = useCallback((): boolean => {
        const errors: Record<string, string | undefined> = {};
        let isValid = true;

        fieldConfig.fields.forEach(field => {
            if (field.validation) {
                const error = field.validation(fieldValues[field.key] || '');
                if (error) {
                    errors[field.key] = error;
                    isValid = false;
                }
            }
        });

        setFieldErrors(errors);
        return isValid;
    }, [fieldConfig.fields, fieldValues]);

    // Add item to list
    const handleAddItem = useCallback(() => {
        if (!newItemValue.trim()) return;

        if (fieldType === 'locations') {
            const newItem = {
                id: `location-${Date.now()}`,
                name: newItemValue.trim(),
            };
            setListItems(prev => [...prev, newItem]);
        } else if (fieldType === 'links') {
            const newItem = {
                id: `link-${Date.now()}`,
                url: newItemValue.trim(),
                title: newItemValue.replace(/^https?:\/\//, '').replace(/\/$/, ''),
            };
            setListItems(prev => [...prev, newItem]);
        }
        setNewItemValue('');
    }, [newItemValue, fieldType]);

    // Remove item from list
    const handleRemoveItem = useCallback((id: string) => {
        setListItems(prev => prev.filter(item => item.id !== id));
    }, []);

    // Save handler
    const handleSave = async () => {
        if (fieldConfig.isList) {
            let success = false;
            if (fieldType === 'locations') {
                success = await saveProfile({ locations: listItems as any });
            } else if (fieldType === 'links') {
                success = await saveProfile({
                    linksMetadata: listItems as any,
                    links: listItems.map((item: any) => item.url),
                });
            }
            if (success) {
                toast.success(t('common.saved') || 'Saved successfully');
                (onClose || goBack)?.();
            }
        } else {
            if (!validateFields()) return;

            let success = false;
            if (fieldType === 'displayName') {
                success = await saveProfile({
                    displayName: fieldValues.displayName,
                    lastName: fieldValues.lastName,
                });
            } else {
                const key = fieldConfig.fields[0]?.key;
                if (key) {
                    success = await updateField(key, fieldValues[key]);
                }
            }

            if (success) {
                toast.success(t('common.saved') || 'Saved successfully');
                (onClose || goBack)?.();
            }
        }
    };

    // Render a single field input
    const renderField = (field: FieldConfig['fields'][0], index: number) => {
        const isTextarea = field.type === 'textarea';

        return (
            <View key={field.key} style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>
                    {field.label}
                </Text>
                <TextInput
                    style={[
                        isTextarea ? styles.textArea : styles.input,
                        {
                            backgroundColor: colors.card,
                            color: colors.text,
                            borderColor: fieldErrors[field.key] ? '#FF3B30' : colors.border,
                        },
                    ]}
                    value={fieldValues[field.key] || ''}
                    onChangeText={(value) => handleFieldChange(field.key, value)}
                    placeholder={field.placeholder}
                    placeholderTextColor={colors.secondaryText}
                    autoFocus={index === 0}
                    selectionColor={colors.tint}
                    {...field.inputProps}
                />
                {fieldErrors[field.key] && (
                    <Text style={styles.errorText}>{fieldErrors[field.key]}</Text>
                )}
            </View>
        );
    };

    // Render list content (locations or links)
    const renderListContent = () => {
        const addLabel = fieldType === 'locations'
            ? (t('editProfile.items.locations.add') || 'Add Location')
            : (t('editProfile.items.links.add') || 'Add Link');
        const placeholder = fieldType === 'locations'
            ? (t('editProfile.items.locations.placeholder') || 'Enter location name')
            : (t('editProfile.items.links.placeholder') || 'Enter URL');
        const listTitle = fieldType === 'locations'
            ? (t('editProfile.items.locations.yourLocations') || 'Your Locations')
            : (t('editProfile.items.links.yourLinks') || 'Your Links');

        return (
            <>
                <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: colors.text }]}>{addLabel}</Text>
                    <View style={styles.addItemRow}>
                        <TextInput
                            style={[
                                styles.input,
                                {
                                    backgroundColor: colors.card,
                                    color: colors.text,
                                    borderColor: colors.border,
                                    flex: 1,
                                },
                            ]}
                            value={newItemValue}
                            onChangeText={setNewItemValue}
                            placeholder={placeholder}
                            placeholderTextColor={colors.secondaryText}
                            selectionColor={colors.tint}
                            autoCapitalize="none"
                            autoCorrect={false}
                            onSubmitEditing={handleAddItem}
                            returnKeyType="done"
                            keyboardType={fieldType === 'links' ? 'url' : 'default'}
                        />
                        <TouchableOpacity
                            style={[
                                styles.addButton,
                                { backgroundColor: newItemValue.trim() ? colors.tint : colors.border }
                            ]}
                            onPress={handleAddItem}
                            disabled={!newItemValue.trim()}
                        >
                            <Ionicons name="add" size={20} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </View>

                {listItems.length > 0 && (
                    <View style={styles.listSection}>
                        <Text style={[styles.listTitle, { color: colors.text }]}>
                            {listTitle} ({listItems.length})
                        </Text>
                        {listItems.map((item: any) => (
                            <View
                                key={item.id}
                                style={[
                                    styles.listItem,
                                    { backgroundColor: colors.card, borderColor: colors.border }
                                ]}
                            >
                                {fieldType === 'links' && item.image && (
                                    <Image source={{ uri: item.image }} style={styles.linkImage} />
                                )}
                                <View style={styles.listItemContent}>
                                    <Text style={[styles.listItemTitle, { color: colors.text }]} numberOfLines={1}>
                                        {fieldType === 'locations' ? item.name : (item.title || item.url)}
                                    </Text>
                                    {fieldType === 'links' && (
                                        <Text style={[styles.listItemSubtitle, { color: colors.secondaryText }]} numberOfLines={1}>
                                            {item.url}
                                        </Text>
                                    )}
                                </View>
                                <TouchableOpacity
                                    onPress={() => handleRemoveItem(item.id)}
                                    style={styles.removeButton}
                                >
                                    <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                                </TouchableOpacity>
                            </View>
                        ))}
                    </View>
                )}
            </>
        );
    };

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: normalizedTheme === 'dark' ? '#000000' : '#F5F5F5' }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <Header
                title=""
                subtitle=""
                theme={normalizedTheme}
                onBack={onClose || goBack}
                variant="minimal"
                elevation="none"
                rightAction={{
                    text: isSaving ? (t('common.saving') || 'Saving...') : (t('common.save') || 'Save'),
                    onPress: handleSave,
                    disabled: isSaving,
                    loading: isSaving,
                }}
            />

            <ScrollView
                style={styles.content}
                contentContainerStyle={styles.contentContainer}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {/* Big Title */}
                <View style={styles.titleContainer}>
                    <Text style={[styles.bigTitle, { color: colors.text }]}>
                        {fieldConfig.title}
                    </Text>
                    {fieldConfig.subtitle && (
                        <Text style={[styles.bigSubtitle, { color: colors.secondaryText }]}>
                            {fieldConfig.subtitle}
                        </Text>
                    )}
                </View>

                {/* Form Content */}
                <View style={[styles.formCard, { backgroundColor: colors.card }]}>
                    {fieldConfig.isList ? renderListContent() : fieldConfig.fields.map(renderField)}
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
    },
    contentContainer: {
        padding: 16,
        paddingTop: 24,
        paddingBottom: 40,
    },
    titleContainer: {
        marginBottom: 24,
    },
    bigTitle: {
        fontSize: 34,
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontFamily: fontFamilies.phuduBold,
        lineHeight: 40,
        marginBottom: 8,
        letterSpacing: -0.5,
    },
    bigSubtitle: {
        fontSize: 16,
        lineHeight: 22,
        opacity: 0.7,
        marginTop: 4,
    },
    formCard: {
        borderRadius: 16,
        padding: 16,
        gap: 16,
    },
    inputGroup: {
        gap: 8,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    input: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        minHeight: 52,
    },
    textArea: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        minHeight: 140,
    },
    errorText: {
        fontSize: 12,
        color: '#FF3B30',
        marginTop: 4,
    },
    addItemRow: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
    },
    addButton: {
        width: 52,
        height: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    listSection: {
        marginTop: 8,
    },
    listTitle: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 12,
    },
    listItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        gap: 12,
        marginBottom: 8,
    },
    listItemContent: {
        flex: 1,
        gap: 4,
    },
    listItemTitle: {
        fontSize: 16,
        fontWeight: '500',
    },
    listItemSubtitle: {
        fontSize: 13,
    },
    linkImage: {
        width: 40,
        height: 40,
        borderRadius: 8,
    },
    removeButton: {
        padding: 8,
    },
});

export default React.memo(EditProfileFieldScreen);

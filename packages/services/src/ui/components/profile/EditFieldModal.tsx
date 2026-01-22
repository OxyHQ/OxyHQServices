import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Platform,
    ScrollView,
    TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { useI18n } from '../../hooks/useI18n';
import { fontFamilies } from '../../styles/fonts';
import { useProfileEditing } from '../../hooks/useProfileEditing';

/**
 * Field configuration for single/multi field variants
 */
export interface FieldConfig {
    /** Unique key for the field */
    key: string;
    /** Label displayed above the input */
    label: string;
    /** Initial value for the field */
    initialValue: string;
    /** Placeholder text */
    placeholder?: string;
    /** Validation function - returns error message or undefined */
    validation?: (value: string) => string | undefined;
    /** Additional TextInput props (multiline, keyboardType, etc.) */
    inputProps?: Partial<TextInputProps>;
}

/**
 * List item for list variant
 */
export interface ListItem {
    id: string;
    [key: string]: unknown;
}

/**
 * Configuration for list variant
 */
export interface ListConfig<T extends ListItem> {
    /** Initial items */
    items: T[];
    /** Render function for each item */
    renderItem: (item: T, onRemove: () => void, colors: Record<string, string>) => React.ReactNode;
    /** Placeholder for add input */
    addItemPlaceholder: string;
    /** Label for add input section */
    addItemLabel?: string;
    /** Function to create a new item from input value */
    createItem: (value: string) => T;
    /** List title shown above items */
    listTitle?: string;
}

/**
 * Props for EditFieldModal
 */
export interface EditFieldModalProps<T extends ListItem = ListItem> {
    /** Whether the modal is visible */
    visible: boolean;
    /** Close handler */
    onClose: () => void;
    /** Modal title */
    title: string;
    /** Theme override */
    theme?: 'light' | 'dark';
    /** Called after successful save */
    onSave?: () => void;

    /** Modal variant: single input, multiple inputs, or list management */
    variant: 'single' | 'multi' | 'list';

    /** Field configuration for single/multi variants */
    fields?: FieldConfig[];

    /** List configuration for list variant */
    listConfig?: ListConfig<T>;

    /** Custom submit handler - receives field values or list items */
    onSubmit: (data: Record<string, unknown>) => Promise<boolean>;

    /** Whether save button should be disabled */
    saveDisabled?: boolean;
}

/**
 * Generic modal component for editing profile fields.
 *
 * Supports three variants:
 * - single: Single text input (username, email, bio)
 * - multi: Multiple text inputs (display name with first/last)
 * - list: Add/remove list items (links, locations)
 *
 * @example
 * // Single field (bio)
 * <EditFieldModal
 *     visible={showBioModal}
 *     onClose={() => setShowBioModal(false)}
 *     title="Bio"
 *     variant="single"
 *     fields={[{
 *         key: 'bio',
 *         label: 'Bio',
 *         initialValue: user.bio,
 *         placeholder: 'Tell people about yourself...',
 *         inputProps: { multiline: true, numberOfLines: 6 }
 *     }]}
 *     onSubmit={async (data) => updateField('bio', data.bio)}
 * />
 *
 * @example
 * // Multi field (display name)
 * <EditFieldModal
 *     visible={showNameModal}
 *     onClose={() => setShowNameModal(false)}
 *     title="Display Name"
 *     variant="multi"
 *     fields={[
 *         { key: 'firstName', label: 'First Name', initialValue: user.name?.first },
 *         { key: 'lastName', label: 'Last Name', initialValue: user.name?.last }
 *     ]}
 *     onSubmit={async (data) => saveProfile({ displayName: data.firstName, lastName: data.lastName })}
 * />
 */
export function EditFieldModal<T extends ListItem = ListItem>({
    visible,
    onClose,
    title,
    theme = 'light',
    onSave,
    variant,
    fields = [],
    listConfig,
    onSubmit,
    saveDisabled = false,
}: EditFieldModalProps<T>): React.ReactElement {
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme || 'light', colorScheme);
    const colors = themeStyles.colors;
    const { isSaving } = useProfileEditing();

    // State for field values (single/multi variants)
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

    // State for list items (list variant)
    const [listItems, setListItems] = useState<T[]>([]);
    const [newItemValue, setNewItemValue] = useState('');

    // Initialize field values when modal opens
    useEffect(() => {
        if (visible) {
            if (variant === 'list' && listConfig) {
                setListItems(listConfig.items);
                setNewItemValue('');
            } else if (fields.length > 0) {
                const initialValues: Record<string, string> = {};
                fields.forEach(field => {
                    initialValues[field.key] = field.initialValue || '';
                });
                setFieldValues(initialValues);
                setFieldErrors({});
            }
        }
    }, [visible, variant, fields, listConfig]);

    // Field change handler with validation
    const handleFieldChange = useCallback((key: string, value: string) => {
        setFieldValues(prev => ({ ...prev, [key]: value }));

        // Clear error on change
        if (fieldErrors[key]) {
            setFieldErrors(prev => ({ ...prev, [key]: undefined }));
        }
    }, [fieldErrors]);

    // Validate all fields
    const validateFields = useCallback((): boolean => {
        const errors: Record<string, string | undefined> = {};
        let isValid = true;

        fields.forEach(field => {
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
    }, [fields, fieldValues]);

    // Add item to list
    const handleAddItem = useCallback(() => {
        if (!newItemValue.trim() || !listConfig) return;

        const newItem = listConfig.createItem(newItemValue.trim());
        setListItems(prev => [...prev, newItem]);
        setNewItemValue('');
    }, [newItemValue, listConfig]);

    // Remove item from list
    const handleRemoveItem = useCallback((id: string) => {
        setListItems(prev => prev.filter(item => item.id !== id));
    }, []);

    // Save handler
    const handleSave = async () => {
        if (variant === 'list') {
            const success = await onSubmit({ items: listItems });
            if (success) {
                onSave?.();
                onClose();
            }
        } else {
            if (!validateFields()) return;

            const success = await onSubmit(fieldValues);
            if (success) {
                onSave?.();
                onClose();
            }
        }
    };

    // Render field inputs for single/multi variants
    const renderFields = () => (
        <View style={styles.modalBody}>
            {fields.map((field, index) => (
                <View key={field.key} style={styles.inputGroup}>
                    <Text style={[styles.label, { color: colors.text }]}>
                        {field.label}
                    </Text>
                    <TextInput
                        style={[
                            field.inputProps?.multiline ? styles.textArea : styles.input,
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
                        textAlignVertical={field.inputProps?.multiline ? 'top' : 'center'}
                        {...field.inputProps}
                    />
                    {fieldErrors[field.key] && (
                        <Text style={styles.errorText}>{fieldErrors[field.key]}</Text>
                    )}
                </View>
            ))}
        </View>
    );

    // Render list for list variant
    const renderList = () => {
        if (!listConfig) return null;

        return (
            <ScrollView style={styles.modalBody}>
                <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: colors.text }]}>
                        {listConfig.addItemLabel || t('common.add') || 'Add'}
                    </Text>
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
                            placeholder={listConfig.addItemPlaceholder}
                            placeholderTextColor={colors.secondaryText}
                            selectionColor={colors.tint}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <TouchableOpacity
                            style={[styles.addButton, { backgroundColor: colors.tint }]}
                            onPress={handleAddItem}
                            disabled={!newItemValue.trim()}
                        >
                            <Ionicons name="add" size={20} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </View>

                {listItems.length > 0 && (
                    <View style={styles.listSection}>
                        {listConfig.listTitle && (
                            <Text style={[styles.listTitle, { color: colors.text }]}>
                                {listConfig.listTitle} ({listItems.length})
                            </Text>
                        )}
                        {listItems.map((item) => (
                            <View key={item.id}>
                                {listConfig.renderItem(
                                    item,
                                    () => handleRemoveItem(item.id),
                                    colors
                                )}
                            </View>
                        ))}
                    </View>
                )}
            </ScrollView>
        );
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
                    <View style={styles.modalHeader}>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>
                            {title}
                        </Text>
                        <TouchableOpacity
                            onPress={handleSave}
                            disabled={isSaving || saveDisabled}
                            style={[styles.saveButton, { opacity: (isSaving || saveDisabled) ? 0.5 : 1 }]}
                        >
                            <Text style={[styles.saveButtonText, { color: colors.tint }]}>
                                {isSaving ? (t('common.saving') || 'Saving...') : (t('common.save') || 'Save')}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {variant === 'list' ? renderList() : renderFields()}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: Platform.OS === 'ios' ? 20 : 16,
        maxHeight: '80%',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E5E5EA',
    },
    closeButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        flex: 1,
        textAlign: 'center',
    },
    saveButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    modalBody: {
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
        minHeight: 120,
    },
    errorText: {
        fontSize: 12,
        color: '#FF3B30',
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
        gap: 8,
        marginTop: 16,
    },
    listTitle: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 8,
    },
});

export default EditFieldModal;

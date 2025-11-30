import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { useI18n } from '../../hooks/useI18n';
import { fontFamilies } from '../../styles/fonts';
import { useProfileEditing } from '../../hooks/useProfileEditing';

interface EditEmailModalProps {
    visible: boolean;
    onClose: () => void;
    initialValue?: string;
    theme?: 'light' | 'dark';
    onSave?: () => void;
}

export const EditEmailModal: React.FC<EditEmailModalProps> = ({
    visible,
    onClose,
    initialValue = '',
    theme = 'light',
    onSave,
}) => {
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme || 'light', colorScheme);
    const colors = themeStyles.colors;
    const { updateField, isSaving } = useProfileEditing();

    const [email, setEmail] = useState(initialValue);

    useEffect(() => {
        if (visible) {
            setEmail(initialValue);
        }
    }, [visible, initialValue]);

    const handleSave = async () => {
        const success = await updateField('email', email);
        if (success) {
            onSave?.();
            onClose();
        }
    };

    const isValidEmail = (email: string) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
                            {t('editProfile.items.email.title') || 'Email'}
                        </Text>
                        <TouchableOpacity
                            onPress={handleSave}
                            disabled={isSaving || !isValidEmail(email)}
                            style={[styles.saveButton, { opacity: (isSaving || !isValidEmail(email)) ? 0.5 : 1 }]}
                        >
                            <Text style={[styles.saveButtonText, { color: colors.tint }]}>
                                {isSaving ? 'Saving...' : 'Save'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.modalBody}>
                        <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: colors.text }]}>
                                {t('editProfile.items.email.label') || 'Email Address'}
                            </Text>
                            <TextInput
                                style={[
                                    styles.input,
                                    {
                                        backgroundColor: colors.card,
                                        color: colors.text,
                                        borderColor: colors.border,
                                    },
                                ]}
                                value={email}
                                onChangeText={setEmail}
                                placeholder={t('editProfile.items.email.placeholder') || 'Enter your email address'}
                                placeholderTextColor={colors.secondaryText}
                                autoFocus
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                                selectionColor={colors.tint}
                            />
                        </View>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

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
});


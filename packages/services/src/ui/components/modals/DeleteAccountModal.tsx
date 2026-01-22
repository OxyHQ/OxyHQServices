import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Modal,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import OxyIcon from '../icon/OxyIcon';

interface DeleteAccountModalProps {
    visible: boolean;
    username: string;
    onClose: () => void;
    onDelete: (password: string) => Promise<void>;
    colors: {
        background: string;
        text: string;
        secondaryText: string;
        border: string;
        danger: string;
        inputBackground: string;
    };
    t: (key: string, params?: Record<string, string>) => string | undefined;
}

const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({
    visible,
    username,
    onClose,
    onDelete,
    colors,
    t,
}) => {
    const [password, setPassword] = useState('');
    const [confirmUsername, setConfirmUsername] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    const isValid = password.length > 0 && confirmUsername === username;

    const handleDelete = useCallback(async () => {
        if (!isValid) return;

        setError(null);
        setIsDeleting(true);

        try {
            await onDelete(password);
            // Modal will be closed by parent on success
        } catch (err: any) {
            setError(err?.message || t('deleteAccount.error') || 'Failed to delete account');
        } finally {
            setIsDeleting(false);
        }
    }, [isValid, password, onDelete, t]);

    const handleClose = useCallback(() => {
        if (isDeleting) return;
        setPassword('');
        setConfirmUsername('');
        setError(null);
        onClose();
    }, [isDeleting, onClose]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={handleClose}
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.overlay}
            >
                <TouchableOpacity
                    style={styles.backdrop}
                    activeOpacity={1}
                    onPress={handleClose}
                />
                <View style={[styles.modal, { backgroundColor: colors.background }]}>
                    <View style={styles.header}>
                        <OxyIcon name="alert" size={32} color={colors.danger} />
                        <Text style={[styles.title, { color: colors.danger }]}>
                            {t('deleteAccount.title') || 'Delete Account'}
                        </Text>
                    </View>

                    <Text style={[styles.warning, { color: colors.text }]}>
                        {t('deleteAccount.warning') || 'This action cannot be undone. Your account and all associated data will be permanently deleted.'}
                    </Text>

                    {error && (
                        <View style={[styles.errorContainer, { backgroundColor: colors.danger + '20' }]}>
                            <Text style={[styles.errorText, { color: colors.danger }]}>
                                {error}
                            </Text>
                        </View>
                    )}

                    <View style={styles.inputGroup}>
                        <Text style={[styles.label, { color: colors.secondaryText }]}>
                            {t('deleteAccount.passwordLabel') || 'Enter your password'}
                        </Text>
                        <View style={[styles.inputContainer, { borderColor: colors.border, backgroundColor: colors.inputBackground }]}>
                            <TextInput
                                style={[styles.input, { color: colors.text }]}
                                value={password}
                                onChangeText={setPassword}
                                placeholder={t('deleteAccount.passwordPlaceholder') || 'Password'}
                                placeholderTextColor={colors.secondaryText}
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                                editable={!isDeleting}
                            />
                            <TouchableOpacity
                                onPress={() => setShowPassword(!showPassword)}
                                style={styles.eyeButton}
                            >
                                <OxyIcon
                                    name={showPassword ? 'eye-off' : 'eye'}
                                    size={20}
                                    color={colors.secondaryText}
                                />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={[styles.label, { color: colors.secondaryText }]}>
                            {t('deleteAccount.confirmLabel', { username }) || `Type "${username}" to confirm`}
                        </Text>
                        <TextInput
                            style={[
                                styles.input,
                                styles.confirmInput,
                                {
                                    borderColor: confirmUsername === username ? '#34C759' : colors.border,
                                    backgroundColor: colors.inputBackground,
                                    color: colors.text,
                                },
                            ]}
                            value={confirmUsername}
                            onChangeText={setConfirmUsername}
                            placeholder={username}
                            placeholderTextColor={colors.secondaryText}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!isDeleting}
                        />
                    </View>

                    <View style={styles.buttons}>
                        <TouchableOpacity
                            style={[styles.button, styles.cancelButton, { borderColor: colors.border }]}
                            onPress={handleClose}
                            disabled={isDeleting}
                        >
                            <Text style={[styles.buttonText, { color: colors.text }]}>
                                {t('common.cancel') || 'Cancel'}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.button,
                                styles.deleteButton,
                                { backgroundColor: isValid ? colors.danger : colors.danger + '50' },
                            ]}
                            onPress={handleDelete}
                            disabled={!isValid || isDeleting}
                        >
                            {isDeleting ? (
                                <ActivityIndicator color="#fff" size="small" />
                            ) : (
                                <Text style={styles.deleteButtonText}>
                                    {t('deleteAccount.confirm') || 'Delete Forever'}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modal: {
        width: '90%',
        maxWidth: 400,
        borderRadius: 16,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
        gap: 12,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
    },
    warning: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 20,
    },
    errorContainer: {
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
    },
    errorText: {
        fontSize: 14,
        textAlign: 'center',
    },
    inputGroup: {
        marginBottom: 16,
    },
    label: {
        fontSize: 13,
        marginBottom: 8,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 8,
    },
    input: {
        flex: 1,
        fontSize: 16,
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    confirmInput: {
        borderWidth: 1,
        borderRadius: 8,
    },
    eyeButton: {
        padding: 12,
    },
    buttons: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 8,
    },
    button: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButton: {
        borderWidth: 1,
    },
    deleteButton: {
        minHeight: 48,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    deleteButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
    },
});

export default DeleteAccountModal;

import type React from 'react';
import { useState, useCallback } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Modal,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import OxyIcon from '../icon/OxyIcon';
import { useTheme } from '@oxyhq/bloom/theme';
import { Loading } from '@oxyhq/bloom/loading';

interface DeleteAccountModalProps {
    visible: boolean;
    username: string;
    onClose: () => void;
    onDelete: (password: string) => Promise<void>;
    t: (key: string, params?: Record<string, string>) => string | undefined;
}

const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({
    visible,
    username,
    onClose,
    onDelete,
    t,
}) => {
    const theme = useTheme();
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
        } catch (err: unknown) {
            setError((err instanceof Error ? err.message : null) || t('deleteAccount.error') || 'Failed to delete account');
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
                    style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
                    activeOpacity={1}
                    onPress={handleClose}
                />
                <View style={[styles.modal, { backgroundColor: theme.colors.background }]}>
                    <View style={styles.header}>
                        <OxyIcon name="alert" size={32} color={theme.colors.error} />
                        <Text className="text-destructive" style={styles.title}>
                            {t('deleteAccount.title') || 'Delete Account'}
                        </Text>
                    </View>

                    <Text className="text-foreground" style={styles.warning}>
                        {t('deleteAccount.warning') || 'This action cannot be undone. Your account and all associated data will be permanently deleted.'}
                    </Text>

                    {error && (
                        <View style={[styles.errorContainer, { backgroundColor: `${theme.colors.error}20` }]}>
                            <Text className="text-destructive" style={styles.errorText}>
                                {error}
                            </Text>
                        </View>
                    )}

                    <View style={styles.inputGroup}>
                        <Text className="text-muted-foreground" style={styles.label}>
                            {t('deleteAccount.passwordLabel') || 'Enter your password'}
                        </Text>
                        <View className="border-border bg-background" style={styles.inputContainer}>
                            <TextInput
                                className="text-foreground"
                                style={styles.input}
                                value={password}
                                onChangeText={setPassword}
                                placeholder={t('deleteAccount.passwordPlaceholder') || 'Password'}
                                placeholderTextColor={theme.colors.textSecondary}
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
                                    color={theme.colors.textSecondary}
                                />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.inputGroup}>
                        <Text className="text-muted-foreground" style={styles.label}>
                            {t('deleteAccount.confirmLabel', { username }) || `Type "${username}" to confirm`}
                        </Text>
                        <TextInput
                            className="text-foreground bg-background"
                            style={[
                                styles.input,
                                styles.confirmInput,
                                {
                                    borderColor: confirmUsername === username ? theme.colors.success : theme.colors.border,
                                },
                            ]}
                            value={confirmUsername}
                            onChangeText={setConfirmUsername}
                            placeholder={username}
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!isDeleting}
                        />
                    </View>

                    <View style={styles.buttons}>
                        <TouchableOpacity
                            className="border-border"
                            style={[styles.button, styles.cancelButton]}
                            onPress={handleClose}
                            disabled={isDeleting}
                        >
                            <Text className="text-foreground" style={styles.buttonText}>
                                {t('common.cancel') || 'Cancel'}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.button,
                                styles.deleteButton,
                                { backgroundColor: isValid ? theme.colors.error : `${theme.colors.error}50` },
                            ]}
                            onPress={handleDelete}
                            disabled={!isValid || isDeleting}
                        >
                            {isDeleting ? (
                                <Loading size="small" />
                            ) : (
                                <Text style={[styles.deleteButtonText, { color: theme.colors.card }]}>
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
    },
});

export default DeleteAccountModal;
